/**
 * TJGROUPS CRM - Zoho Mail Integration
 *
 * Rewritten for account isolation and secret hygiene.
 *
 * WHAT CHANGED AND WHY
 * --------------------
 * 1. The client id/secret were hardcoded in this file. They now come from
 *    Script Properties. THE OLD CREDENTIALS MUST BE ROTATED IN THE ZOHO API
 *    CONSOLE — they exist in the file history and must be treated as burned.
 *
 * 2. getUserRefreshToken() used to fall back to "any user in the org who has
 *    linked Zoho". That let any user read and send mail from a colleague's
 *    mailbox. The fallback is gone: a user without their own link gets a
 *    clear error telling them to connect their account.
 *
 * 3. The user id came from the request body. It now comes from the
 *    authenticated session, so a caller cannot name someone else's account.
 *
 * 4. The OAuth callback now validates a signed state parameter, so an
 *    authorization code cannot be replayed against a different user.
 */

/* ================================================================== *
 * Configuration
 * ================================================================== */

function getZohoConfig() {
  var props = PropertiesService.getScriptProperties();
  var clientId = props.getProperty('ZOHO_CLIENT_ID');
  var clientSecret = props.getProperty('ZOHO_CLIENT_SECRET');

  if (!clientId || !clientSecret) {
    throw new ApiError('EXTERNAL_ERROR',
      'Zoho is not configured. Set ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET in ' +
      'Project Settings > Script Properties.');
  }

  return {
    clientId: clientId,
    clientSecret: clientSecret,
    accountsHost: props.getProperty('ZOHO_ACCOUNTS_HOST') || 'https://accounts.zoho.in',
    mailHost: props.getProperty('ZOHO_MAIL_HOST') || 'https://mail.zoho.in',
    redirectUri: props.getProperty('ZOHO_REDIRECT_URI') ||
                 'https://crm.tjgroups.com/oauth/callback'
  };
}

/* ================================================================== *
 * OAuth state — binds an authorization code to one user
 * ================================================================== */

function signZohoState(userId, nonce) {
  var sig = Utilities.computeHmacSha256Signature(
    userId + '|' + nonce, getPasswordPepper()
  );
  return bytesToHex(sig).slice(0, 32);
}

function buildZohoAuthUrl(actor, payload) {
  if (!actor) throw new ApiError('UNAUTHENTICATED', 'Sign in before linking Zoho.');
  var cfg = getZohoConfig();

  var nonce = Utilities.getUuid();
  var state = actor.ID + '.' + nonce + '.' + signZohoState(actor.ID, nonce);

  try {
    CacheService.getScriptCache().put('zoho_state:' + nonce, actor.ID, 900);
  } catch (e) { /* cache is advisory; the signature is the real check */ }

  // folders.READ is needed to find the Sent folder. Without it a mailbox can
  // only ever be listed as its Inbox, so replies never reach the archive and a
  // manager sees half of every conversation. Tokens issued before this scope
  // existed keep working for messages and simply cannot list folders — see
  // syncableFolders, which degrades rather than failing.
  var scope = 'ZohoMail.messages.ALL,ZohoMail.accounts.READ,ZohoMail.folders.READ';
  var url = cfg.accountsHost + '/oauth/v2/auth' +
    '?response_type=code' +
    '&client_id=' + encodeURIComponent(cfg.clientId) +
    '&scope=' + encodeURIComponent(scope) +
    '&redirect_uri=' + encodeURIComponent(payload && payload.redirectUri ? payload.redirectUri : cfg.redirectUri) +
    '&access_type=offline' +
    '&prompt=consent' +
    '&state=' + encodeURIComponent(state);

  return { url: url, state: state };
}

function verifyZohoState(state, actorId) {
  if (!state) return false;
  var parts = String(state).split('.');
  if (parts.length !== 3) return false;
  var userId = parts[0], nonce = parts[1], sig = parts[2];
  if (String(userId) !== String(actorId)) return false;
  return safeEquals(sig, signZohoState(userId, nonce));
}

/* ================================================================== *
 * Linking
 * ================================================================== */

/**
 * Exchange an authorization code for a refresh token and store it against
 * the AUTHENTICATED user. The user id is never taken from the payload.
 */
function linkZoho(actor, payload) {
  payload = payload || {};
  if (!actor) throw new ApiError('UNAUTHENTICATED', 'Sign in before linking Zoho.');

  var cfg = getZohoConfig();
  var code = String(payload.code || '');
  if (!code) throw new ApiError('BAD_REQUEST', 'Missing authorization code.');

  // If a state was issued, it must match this user. Absent state is tolerated
  // while the old frontend is still deployed, and logged so it is visible.
  if (payload.state) {
    if (!verifyZohoState(payload.state, actor.ID)) {
      auditLog({
        entityId: actor.ID, entityType: 'User', action: 'ZOHO_STATE_REJECTED',
        userId: actor.ID, details: 'OAuth state did not validate for this user.'
      });
      throw new ApiError('FORBIDDEN', 'This authorization request is not valid for your account.');
    }
  } else {
    auditLog({
      entityId: actor.ID, entityType: 'User', action: 'ZOHO_LINK_NO_STATE',
      userId: actor.ID, details: 'OAuth callback arrived without a state parameter.'
    });
  }

  var redirectUri = String(payload.redirectUri || cfg.redirectUri);

  var response = zohoFetch(cfg.accountsHost + '/oauth/v2/token', {
    method: 'post',
    payload: {
      code: code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    },
    muteHttpExceptions: true
  });

  var data = parseZohoJson(response, 'token exchange');

  if (!data.refresh_token) {
    // Never echo the raw body: it can contain token material.
    throw new ApiError('EXTERNAL_ERROR',
      'Zoho did not return a refresh token' +
      (data.error ? ' (' + data.error + ')' : '') +
      '. Re-authorise with offline access.');
  }

  var accounts = zohoAccounts(data.access_token, cfg);
  var acct = accounts && accounts.length ? accounts[0] : {};
  var zohoEmail = acct.primaryEmailAddress || acct.incomingMailAddress ||
                  acct.mailboxAddress || acct.emailAddress || '';

  if (!zohoEmail) {
    throw new ApiError('EXTERNAL_ERROR',
      'Could not determine the Zoho mailbox address for this account.');
  }

  updateRecordRaw('Users', actor.ID, {
    ZohoEmail: zohoEmail,
    ZohoRefreshToken: data.refresh_token,
    ZohoAccountId: acct.accountId || '',
    ZohoLinkedAt: new Date().toISOString()
  });

  auditLog({
    entityId: actor.ID, entityType: 'User', action: 'ZOHO_LINKED',
    userId: actor.ID, details: 'Zoho mailbox linked: ' + zohoEmail
  });

  // The refresh token is deliberately NOT part of the response.
  return { status: 'success', email: zohoEmail };
}

function unlinkZoho(actor, payload) {
  payload = payload || {};
  if (!actor) throw new ApiError('UNAUTHENTICATED', 'Sign in first.');

  // Only a SUPER_ADMIN may unlink somebody else.
  var targetId = actor.ID;
  if (payload.id && String(payload.id) !== String(actor.ID)) {
    if (actor.role !== 'SUPER_ADMIN') {
      throw new ApiError('FORBIDDEN', 'You may only unlink your own Zoho account.');
    }
    targetId = String(payload.id);
  }

  // Drop any cached access token first, while the refresh token is still
  // readable — afterwards there is nothing left to derive the cache key from,
  // and a live token would sit in the cache for the rest of its window.
  var current = getRecordByIdRaw('Users', targetId);
  if (current && current.ZohoRefreshToken) {
    forgetZohoAccessToken(String(current.ZohoRefreshToken));
  }

  updateRecordRaw('Users', targetId, {
    ZohoEmail: '', ZohoRefreshToken: '', ZohoAccountId: '', ZohoLinkedAt: ''
  });

  auditLog({
    entityId: targetId, entityType: 'User', action: 'ZOHO_UNLINKED',
    userId: actor.ID, details: 'Zoho mailbox unlinked.'
  });

  return { status: 'success' };
}

/* ================================================================== *
 * Token handling — strictly per user
 * ================================================================== */

/**
 * Return THIS user's refresh token, or fail.
 *
 * There is deliberately no fallback to another account. The previous
 * fallback was the mechanism behind the cross-mailbox access defect.
 */
function requireUserZoho(userId) {
  var user = getRecordByIdRaw('Users', userId);
  if (!user) throw new ApiError('NOT_FOUND', 'User not found.');

  var token = user.ZohoRefreshToken ? String(user.ZohoRefreshToken) : '';
  if (!token) {
    throw new ApiError('EXTERNAL_ERROR',
      'Your Zoho Mail account is not connected. Link it from your dashboard ' +
      'before sending or reading mail.');
  }

  return { user: user, refreshToken: token };
}

/**
 * Access tokens last an hour; cache for slightly less.
 *
 * Zoho limits how often a refresh token may mint new access tokens, and
 * refuses with "Access Denied" once you cross it — which reads exactly like a
 * revoked connection. Every Zoho operation used to mint a fresh token, so
 * opening a handful of leads was enough to trip it: sending mail worked one
 * moment and reading it failed the next, on the same account.
 */
var ZOHO_TOKEN_CACHE_SECONDS = 3300;

/** Cache under a digest — never store a refresh token as a lookup key. */
function zohoTokenCacheKey(refreshToken) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, String(refreshToken));
  return 'zoho_at:' + Utilities.base64EncodeWebSafe(digest);
}

function forgetZohoAccessToken(refreshToken) {
  try {
    CacheService.getScriptCache().remove(zohoTokenCacheKey(refreshToken));
  } catch (e) { /* a cache miss is not worth failing a request over */ }
}

function getZohoAccessToken(refreshToken) {
  var cacheKey = zohoTokenCacheKey(refreshToken);
  try {
    var hit = CacheService.getScriptCache().get(cacheKey);
    if (hit) return hit;
  } catch (e) { /* fall through and mint a new one */ }

  var cfg = getZohoConfig();
  var response = zohoFetch(cfg.accountsHost + '/oauth/v2/token', {
    method: 'post',
    payload: {
      refresh_token: refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: 'refresh_token'
    },
    muteHttpExceptions: true
  });

  // A refusal here is PERMANENT until somebody reconnects — the token has been
  // revoked, has expired, or was issued for different credentials. Reported as
  // a generic external error it was indistinguishable from a transient Zoho
  // blip, so the client re-attempted it on every single lead and paid a full
  // round trip each time for a call that could not succeed.
  var data;
  try {
    data = parseZohoJson(response, 'token refresh');
  } catch (err) {
    throw new ApiError('ZOHO_REAUTH_REQUIRED',
      'Your Zoho Mail connection has expired or been revoked. Reconnect your ' +
      'mailbox from the dashboard to read and send mail again.' +
      (err && err.message ? ' (Zoho said: ' + err.message + ')' : ''));
  }

  if (!data.access_token) {
    throw new ApiError('ZOHO_REAUTH_REQUIRED',
      'Zoho rejected the stored credentials. Reconnect your mailbox from the ' +
      'dashboard.');
  }

  try {
    CacheService.getScriptCache().put(cacheKey, data.access_token, ZOHO_TOKEN_CACHE_SECONDS);
  } catch (e) { /* caching is an optimisation, never a requirement */ }

  return data.access_token;
}

function zohoAccounts(accessToken, cfg) {
  cfg = cfg || getZohoConfig();
  var res = zohoFetch(cfg.mailHost + '/api/accounts', {
    headers: { Authorization: 'Zoho-oauthtoken ' + accessToken },
    muteHttpExceptions: true
  });
  var body = parseZohoJson(res, 'account lookup');
  return body.data || [];
}

/** Resolve the caller's own mailbox handle. */
function openMailbox(userId) {
  var link = requireUserZoho(userId);
  var accessToken = getZohoAccessToken(link.refreshToken);

  // The account id and address never change once known, and they are already
  // stored on the user row — so re-asking Zoho for them on every operation was
  // a round trip that could only ever return the same answer.
  var knownId = String(link.user.ZohoAccountId || '');
  var knownEmail = String(link.user.ZohoEmail || '');
  if (knownId && knownEmail) {
    return {
      accessToken: accessToken, accountId: knownId,
      email: knownEmail, user: link.user
    };
  }

  var accounts;
  try {
    accounts = zohoAccounts(accessToken);
  } catch (err) {
    // A cached token that Zoho has since invalidated — a reconnect, most
    // often — would otherwise keep failing for the rest of the cache window.
    // Drop it and try once with a fresh one.
    forgetZohoAccessToken(link.refreshToken);
    accessToken = getZohoAccessToken(link.refreshToken);
    accounts = zohoAccounts(accessToken);
  }

  if (!accounts.length) {
    throw new ApiError('EXTERNAL_ERROR', 'No Zoho mailbox is available for this account.');
  }

  var acct = accounts[0];
  var email = acct.primaryEmailAddress || acct.incomingMailAddress ||
              acct.mailboxAddress || acct.emailAddress || link.user.ZohoEmail || '';

  // Backfill anything missing, so later calls are cheaper.
  var patch = {};
  if (!link.user.ZohoEmail && email) patch.ZohoEmail = email;
  if (!link.user.ZohoAccountId && acct.accountId) patch.ZohoAccountId = acct.accountId;
  if (Object.keys(patch).length) updateRecordRaw('Users', userId, patch);

  return {
    accessToken: accessToken,
    accountId: acct.accountId,
    email: email,
    user: link.user
  };
}

/* ================================================================== *
 * Reading mail
 * ================================================================== */

/**
 * Fetch the conversation with one lead, from the CALLER's own mailbox.
 *
 * Cost note: the original implementation fetched the full body of every
 * matched message on every page load. Bodies are now fetched only for the
 * most recent MAX_BODY_FETCH messages, which keeps this inside the free-tier
 * UrlFetch quota.
 */
var MAX_BODY_FETCH = 15;

/**
 * Ceiling on a whole-mailbox sync.
 *
 * One listing call returns envelopes only, so this is cheap in requests but
 * expensive in Sheets writes when a mailbox is first connected. Capped so a
 * single sync cannot exhaust the free-tier execution budget; syncing again
 * picks up the next batch because everything is deduplicated on message id.
 */
var MAX_MAILBOX_SYNC = 200;

/**
 * Did this message come FROM the lead?
 *
 * Zoho reports the sender in several shapes — a bare address, a display name
 * wrapper like a display name wrapping the address in angle brackets, or nothing at all with the address
 * only in `fromAddress`. Matching is case-insensitive because mail addresses
 * are, and a mismatch here silently files an inbound reply as outbound.
 */
/**
 * Is this message genuinely part of the conversation with `address`?
 *
 * Checks every party field Zoho populates. Used to validate what a search
 * returned rather than assuming the server filtered it, because it does not
 * reliably do so.
 */
function messageInvolves(msg, address) {
  var needle = bareAddress(address);
  if (!needle || !msg) return false;

  var parties = [
    msg.sender, msg.fromAddress, msg.toAddress, msg.ccAddress, msg.bccAddress
  ];

  for (var i = 0; i < parties.length; i++) {
    var field = decodeEntities(parties[i]).toLowerCase();
    if (!field) continue;
    // A field may hold several addresses. Match each one whole, never as a
    // substring: two addresses differing by a single leading character belong
    // to different people, and a contains-check would merge their mail.
    var parts = field.split(/[,;]/);
    for (var p = 0; p < parts.length; p++) {
      if (bareAddress(parts[p]) === needle) return true;
    }
    // Fall back to a bounded containment check for shapes bareAddress cannot
    // parse, e.g. a raw header blob.
    if (field.indexOf('<' + needle + '>') !== -1) return true;
  }
  return false;
}

function extractAllAddresses(msg) {
  if (!msg) return [];
  var fields = [msg.sender, msg.fromAddress, msg.toAddress, msg.ccAddress, msg.bccAddress];
  var addrs = [];
  for (var f = 0; f < fields.length; f++) {
    var raw = decodeEntities(fields[f] || '');
    if (!raw) continue;
    var parts = raw.split(/[,;]/);
    for (var p = 0; p < parts.length; p++) {
      var addr = bareAddress(parts[p]);
      if (addr && addrs.indexOf(addr) === -1) {
        addrs.push(addr);
      }
    }
  }
  return addrs;
}

function isInboundFrom(msg, leadEmail) {
  var needle = String(leadEmail || '').trim().toLowerCase();
  if (!needle) return false;
  var from = (String(msg.sender || '') + ' ' + String(msg.fromAddress || '')).toLowerCase();
  return from.indexOf(needle) !== -1;
}

function getZohoEmails(actor, params) {
  params = params || {};
  if (!actor) throw new ApiError('UNAUTHENTICATED', 'Sign in first.');

  var leadEmail = String(params.leadEmail || '').trim();
  if (!leadEmail) throw new ApiError('BAD_REQUEST', 'leadEmail is required.');
  if (!isEmail(leadEmail)) throw new ApiError('VALIDATION_FAILED', 'leadEmail is not a valid address.');

  // Always the caller's own mailbox. A userId in the request is ignored.
  var box = openMailbox(actor.ID);
  var cfg = getZohoConfig();

  // Ask by recipient and by sender, using both spellings of the sender key
  // because Zoho's accepted vocabulary varies by endpoint version.
  var merged = zohoSearch(box, cfg, 'to:' + leadEmail);
  var senderKeys = ['from:', 'sender:'];
  for (var s = 0; s < senderKeys.length; s++) {
    merged = merged.concat(zohoSearch(box, cfg, senderKeys[s] + leadEmail));
  }

  var seen = {};
  var unique = [];
  for (var i = 0; i < merged.length; i++) {
    var m = merged[i];
    if (!m || !m.messageId || seen[m.messageId]) continue;

    // THE SEARCH RESULT IS NOT TRUSTED.
    //
    // A search key Zoho does not recognise does not return an empty list — it
    // appears to ignore the filter and return the whole mailbox. So a lead
    // with no correspondence at all was shown ten unrelated messages,
    // including private threads between colleagues that had nothing to do
    // with that company. Wrong data on a lead page is worse than missing
    // data: it is acted on.
    //
    // Every message is therefore verified here against the lead's actual
    // address. Whatever the search does or does not filter, only genuine
    // correspondence with this lead survives.
    if (!messageInvolves(m, leadEmail)) continue;

    seen[m.messageId] = true;
    unique.push(m);
  }

  unique.sort(function (a, b) {
    return Date.parse(toIsoTimestamp(a.receivedTime)) -
           Date.parse(toIsoTimestamp(b.receivedTime));
  });

  var bodyBudget = Math.max(0, unique.length - MAX_BODY_FETCH);

  // Fetch the bodies we are allowed to, ONCE, and reuse them for both the
  // response and the archive. Doing it here rather than inside the map means
  // the stored copy is the real message, not Zoho's truncated summary.
  var fetchedBodies = {};
  for (var b = bodyBudget; b < unique.length; b++) {
    var body = fetchZohoMessageContent(box, cfg, unique[b].folderId, unique[b].messageId);
    if (body) fetchedBodies[String(unique[b].messageId)] = body;
  }

  // Persist the conversation so it survives the mailbox.
  persistEmailLog(actor, params.leadId, leadEmail, unique, fetchedBodies);

  return unique.map(function (m, index) {
    var content = fetchedBodies[String(m.messageId)] || '';
    return {
      id: m.messageId,
      subject: m.subject || '(No Subject)',
      summary: m.summary || '',
      content: content || m.summary || '',
      contentTruncated: index < bodyBudget,
      sender: m.sender || '',
      toAddress: m.toAddress || '',
      ccAddress: m.ccAddress || '',
      direction: isInboundFrom(m, leadEmail) ? 'in' : 'out',
      timestamp: toIsoTimestamp(m.receivedTime)
    };
  });
}

/**
 * Copy newly-seen messages into the EmailLog sheet.
 *
 * Dedupes on Zoho's MessageId, so re-opening a lead does not duplicate the
 * thread. Only NEW messages cost a write, which keeps this inside the
 * free-tier quota even on a busy lead.
 *
 * Never throws: failing to archive mail must not stop the user reading it.
 */
/**
 * A Google Sheets cell holds 50,000 characters. Leave headroom rather than
 * discovering the ceiling mid-write.
 */
var MAX_STORED_BODY = 45000;

/** Store a message body, saying honestly whether it is the whole thing. */
function bodyForStorage(content) {
  var s = String(content == null ? '' : content);
  if (s.length <= MAX_STORED_BODY) return { body: s, complete: s.length > 0 };
  return { body: s.slice(0, MAX_STORED_BODY), complete: false };
}

/** The archived body of one message, or null. */
function readMessageBody(messageId) {
  var rows = getRecordsRaw('EmailBodies');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].MessageId) !== String(messageId)) continue;
    return {
      body: String(rows[i].Body || ''),
      complete: isTrueFlag(rows[i].BodyComplete)
    };
  }
  return null;
}

/**
 * Archive a message body, once.
 *
 * Never throws: keeping a copy is a convenience, and failing to store it must
 * not stop somebody reading their mail.
 */
function storeMessageBody(messageId, content) {
  try {
    if (!messageId || !content) return false;

    var existing = readMessageBody(messageId);
    if (existing && existing.body) return false;   // already have it

    var prepared = bodyForStorage(content);
    appendRecordRaw('EmailBodies', {
      MessageId: String(messageId),
      Body: prepared.body,
      BodyComplete: prepared.complete ? 'TRUE' : '',
      StoredAt: new Date().toISOString()
    });
    return true;
  } catch (e) {
    Logger.log('Could not archive message body: ' + e.message);
    return false;
  }
}

function persistEmailLog(actor, leadId, leadEmail, messages, bodies) {
  if (!messages || !messages.length) return 0;

  try {
    var existing = getRecordsRaw('EmailLog');
    var seen = {};
    for (var i = 0; i < existing.length; i++) {
      seen[String(existing[i].MessageId)] = true;
    }

    var now = new Date().toISOString();
    var stored = 0;
    var inboundSeen = 0;

    for (var m = 0; m < messages.length; m++) {
      var msg = messages[m];
      var id = String(msg.messageId || '');
      if (!id || seen[id]) continue;

      var inbound = isInboundFrom(msg, leadEmail);
      var sentAt = toIsoTimestamp(msg.receivedTime, now);
      var subject = String(msg.subject || '(No Subject)').slice(0, 500);


      appendRecordRaw('EmailLog', {
        MessageId: id,
        LeadId: String(leadId || ''),
        LeadEmail: leadEmail,
        UserId: actor ? actor.ID : '',
        Direction: inbound ? 'in' : 'out',
        Subject: subject,
        Summary: String(msg.summary || '').slice(0, 2000),
        // Prefer whichever field actually carries an address: Zoho sometimes
        // puts only a display name in `sender`, which cannot be matched
        // against anything later.
        Sender: String(bareAddress(msg.sender) ? msg.sender
                     : (msg.fromAddress || msg.sender || '')),
        ToAddress: String(msg.toAddress || ''),
        SentAt: sentAt,
        SyncedAt: now,
        FolderId: String(msg.folderId || '')
      });

      // The body goes to its own sheet, so listing a conversation never has
      // to read it.
      if (bodies && bodies[id]) storeMessageBody(id, bodies[id]);
      seen[id] = true;
      stored++;

      // A reply from the client is an event the whole team wants to see, so
      // it gets its own feed entry rather than being buried in a batch count.
      //
      // Dated when the message ARRIVED, not when the sync noticed it. A lead
      // opened after a quiet week would otherwise dump the week's replies onto
      // today and make the daily feed lie about when the client got in touch.
      //
      // Outbound messages are not logged here: whoever sent them already has
      // an EMAIL_SENT entry, and re-logging them on sync would double-count.
      if (inbound && leadId) {
        inboundSeen++;
        auditLog({
          entityId: leadId, entityType: 'Lead', action: 'EMAIL_RECEIVED',
          userId: actor ? actor.ID : 'SYSTEM',
          contactMode: 'EMAIL',
          occurredAt: sentAt,
          details: 'Reply received from ' + leadEmail + ': ' + subject,
          metadata: { messageId: id, subject: subject }
        });
      }
    }

    // One line for whatever else the sync picked up, so the batch is still
    // accounted for without a row per outbound message.
    var quiet = stored - inboundSeen;
    if (quiet > 0 && leadId) {
      auditLog({
        entityId: leadId, entityType: 'Lead', action: 'EMAIL_SYNCED',
        userId: actor ? actor.ID : 'SYSTEM',
        contactMode: 'EMAIL',
        details: quiet + ' sent message' + (quiet === 1 ? '' : 's') +
                 ' recorded from the conversation with ' + leadEmail + '.'
      });
    }

    return stored;
  } catch (e) {
    Logger.log('EmailLog sync failed: ' + e.message);
    return 0;
  }
}

/** Stored correspondence for a lead, newest first. Served without Zoho. */
function getStoredEmails(actor, params) {
  params = params || {};
  var leadId = String(params.leadId || '');
  var leadEmail = String(params.leadEmail || '').trim().toLowerCase();

  if (!leadId && !leadEmail) {
    throw new ApiError('BAD_REQUEST', 'A leadId or leadEmail is required.');
  }

  // Reading a lead's mail requires the right to read the lead itself.
  var lead = leadId ? getScopedRecordById('Leads', leadId, 'getLeadById', actor) : null;

  // The lead's REAL address, from the record — not from the request, and not
  // from whatever LeadEmail happens to be stored on the row.
  var authoritative = bareAddress(lead ? lead.Email : leadEmail);

  var rows = getRecordsRaw('EmailLog');
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];

    var filedHere = (leadId && String(r.LeadId) === leadId) ||
                    (leadEmail && String(r.LeadEmail).toLowerCase() === leadEmail);

    var involves = authoritative && messageInvolves({
      sender: r.Sender, fromAddress: r.Sender,
      toAddress: r.ToAddress, ccAddress: r.CcAddress
    }, authoritative);

    if (!filedHere && !involves) continue;

    // If filed under this lead but doesn't actually involve this lead, reject
    if (filedHere && authoritative && !involves) continue;

    // Backfill LeadId if message was recorded earlier with blank/unmatched LeadId
    if (leadId && String(r.LeadId) !== leadId && involves) {
      try {
        updateRecordRaw('EmailLog', r.ID, { LeadId: leadId, LeadEmail: authoritative });
        r.LeadId = leadId;
        r.LeadEmail = authoritative;
      } catch (e) {}
    }

    out.push(r);
  }

  out.sort(function (a, b) {
    return Date.parse(b.SentAt || 0) - Date.parse(a.SentAt || 0);
  });

  return stripAll(out);
}

/**
 * Find archive rows filed against a lead they have nothing to do with.
 *
 * Reports only. Run it, read the output, then run repairEmailLog() if the
 * list is what you expect.
 */
function auditEmailLogAttribution() {
  var rows = getRecordsRaw('EmailLog');
  var leads = getRecordsRaw('Leads');

  var emailOf = {};
  for (var l = 0; l < leads.length; l++) {
    emailOf[String(leads[l].ID)] = bareAddress(leads[l].Email);
  }

  var bad = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var leadId = String(r.LeadId || '');
    if (!leadId) continue;

    var expected = emailOf[leadId];
    if (!expected) continue;   // lead deleted or unknown; leave it alone

    // Same rule the display uses, deliberately. LeadEmail records which lead
    // was open when the row was written, not who was on the message — so
    // accepting it here would report rows as correctly filed that the lead
    // page refuses to show, and the two would quietly disagree about what
    // belongs to whom.
    var involves = messageInvolves({
      sender: r.Sender, fromAddress: r.Sender,
      toAddress: r.ToAddress, ccAddress: r.CcAddress
    }, expected);

    if (!involves) {
      bad.push({
        id: String(r.ID), leadId: leadId, expected: expected,
        subject: String(r.Subject || ''),
        sender: String(r.Sender || ''), to: String(r.ToAddress || '')
      });
    }
  }

  Logger.log('==================================================');
  Logger.log(' EMAIL ARCHIVE ATTRIBUTION AUDIT');
  Logger.log('==================================================');
  Logger.log(' rows checked      : ' + rows.length);
  Logger.log(' wrongly attributed: ' + bad.length);
  for (var b = 0; b < Math.min(bad.length, 40); b++) {
    Logger.log('   ' + bad[b].subject + '  [from ' + bad[b].sender +
               ' to ' + bad[b].to + '] filed under a lead whose address is ' +
               bad[b].expected);
  }
  if (bad.length > 40) Logger.log('   ... and ' + (bad.length - 40) + ' more');
  Logger.log('');
  if (bad.length) {
    Logger.log(' Nothing was changed. Run repairEmailLog() to detach these.');
  } else {
    // Do not prompt an action that is not needed: it reads as though the
    // clean result were somehow incomplete.
    Logger.log(' Every archived message is filed against a lead it belongs to.');
    Logger.log(' No action required.');
  }
  Logger.log('==================================================');

  return { checked: rows.length, wronglyAttributed: bad.length, rows: bad };
}

/**
 * Detach wrongly-attributed archive rows from their lead.
 *
 * The row is NOT deleted — only its LeadId is cleared. The message is real
 * mail from a real mailbox; it simply does not belong to that company. Once
 * detached it appears under "no matching lead" instead, where it can be
 * looked at rather than silently discarded.
 */
function repairEmailLog() {
  var audit = auditEmailLogAttribution();
  if (!audit.wronglyAttributed) {
    Logger.log('Nothing to repair.');
    return { detached: 0 };
  }

  var detached = 0;
  for (var i = 0; i < audit.rows.length; i++) {
    try {
      updateRecordRaw('EmailLog', audit.rows[i].id, { LeadId: '' });
      detached++;
    } catch (e) {
      Logger.log('Could not detach ' + audit.rows[i].id + ': ' + e.message);
    }
  }

  Logger.log('');
  Logger.log(' Detached ' + detached + ' row(s) from the wrong lead.');
  Logger.log(' No message was deleted; they now show as having no matching lead.');

  auditLog({
    entityId: 'SYSTEM', entityType: 'System', action: 'EMAILLOG_REPAIRED',
    userId: 'SYSTEM',
    details: detached + ' archive row(s) detached from a lead they did not belong to.'
  });

  return { detached: detached };
}

/**
 * The full body of ONE message, fetched on demand.
 *
 * Neither source of a stored message carries the whole thing: Zoho's search
 * returns a `summary` that is cut off mid-sentence, and the archive stores
 * that same summary. So "Full view" was showing a truncated paragraph and
 * calling it the full text.
 *
 * Fetching every body up front is not an option — it is one UrlFetch call per
 * message on a shared free-tier quota. Fetching one when someone actually
 * opens it costs a single call and is the only way to show the real content.
 */
/**
 * The archive row for one message id, or null.
 *
 * One scan, reused for the authorisation decision, the folder id and the
 * summary fallback. Reading a body used to walk the whole EmailLog sheet twice
 * for a single request, which on the free tier is the part that costs.
 */
function findEmailLogRow(messageId) {
  var id = String(messageId || '');
  if (!id) return null;
  var rows = getRecordsRaw('EmailLog');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].MessageId) === id) return rows[i];
  }
  return null;
}

function getEmailContent(actor, params) {
  params = params || {};
  if (!actor) throw new ApiError('UNAUTHENTICATED', 'Sign in first.');

  var messageId = String(params.messageId || '');
  if (!messageId) throw new ApiError('BAD_REQUEST', 'messageId is required.');

  var logRow = findEmailLogRow(messageId);

  // A leadId the caller names is checked whether or not it turns out to be the
  // right one — claiming a lead you cannot see is refused on its own.
  var leadId = String(params.leadId || '');
  if (leadId) getScopedRecordById('Leads', leadId, 'getLeadById', actor);

  // Authorise the MESSAGE, not the claim attached to the request.
  //
  // leadId used to be optional and was the ONLY check, so omitting it skipped
  // authorisation entirely — and the archived-body shortcut below answered
  // before the mailbox was ever opened. Any signed-in user could therefore
  // read any archived body by guessing or replaying a message id, straight
  // past the scoping getStoredEmails and getUnmatchedEmails apply to the
  // lists those bodies appear in.
  if (logRow) {
    var ownerLead = String(logRow.LeadId || '');
    var leadRecord = ownerLead ? getRecordByIdRaw('Leads', ownerLead) : null;

    if (leadRecord) {
      // A filed message inherits its lead's permissions.
      getScopedRecordById('Leads', ownerLead, 'getLeadById', actor);
    } else {
      // Unfiled — or filed against a lead that no longer exists. Either way
      // the rule is the one getUnmatchedEmails uses, so opening a message can
      // never reveal more than the list that offered it.
      var allowed = mailVisibleUserIds(actor);
      if (allowed !== null && allowed.indexOf(String(logRow.UserId)) === -1) {
        throw new ApiError('FORBIDDEN', 'That message is not yours to read.');
      }
    }
  } else if (!leadId) {
    // Not in the archive and no lead named: nothing to authorise against.
    throw new ApiError('BAD_REQUEST',
      'A leadId is required to read a message that is not in the archive.');
  }

  // Already archived in full? Serve it and skip the round trip entirely.
  var cached = readMessageBody(messageId);
  if (cached && cached.complete && cached.body) {
    return { messageId: messageId, content: cached.body, complete: true };
  }

  // The folder id is REQUIRED by Zoho to address a message body. The caller
  // rarely has it, so recover it from the archive rather than guessing '0'
  // and getting an empty response.
  var folderId = String(params.folderId || '');
  if (!folderId && logRow) folderId = String(logRow.FolderId || '');

  var cfg = getZohoConfig();
  var content = '';

  // Determine mailboxes to query:
  // 1. If message was logged under a specific user's mailbox (logRow.UserId), query that mailbox first.
  // 2. Query the actor's own mailbox.
  var targetUserIds = [];
  if (logRow && logRow.UserId) {
    targetUserIds.push(String(logRow.UserId));
  }
  if (actor && targetUserIds.indexOf(String(actor.ID)) === -1) {
    targetUserIds.push(String(actor.ID));
  }

  for (var u = 0; u < targetUserIds.length; u++) {
    try {
      var box = openMailbox(targetUserIds[u]);
      content = fetchZohoMessageContent(box, cfg, folderId, messageId);
      if (content) break;
    } catch (e) {
      // mailbox not connected or token expired; try next target
    }
  }
  if (!content) {
    // The message may have left the mailbox. Fall back to what was archived,
    // and say so, rather than showing an empty panel.
    if (cached && cached.body) {
      return {
        messageId: messageId, content: cached.body, complete: cached.complete,
        note: 'This message is no longer in the mailbox. Showing the copy the ' +
              'CRM kept.'
      };
    }
    if (logRow) {
      return {
        messageId: messageId,
        content: String(logRow.Summary || ''),
        complete: false,
        note: 'This message is no longer in the mailbox. Showing the summary ' +
              'recorded when it was first seen.'
      };
    }
    throw new ApiError('NOT_FOUND', 'That message could not be retrieved.');
  }

  // Keep it. The archive completes itself as people read older mail, and
  // nobody pays for this fetch twice.
  storeMessageBody(messageId, content);

  return { messageId: messageId, content: content, complete: true };
}

/* ================================================================== *
 * Mailbox-wide sync and email analytics
 * ================================================================== */

/** Pull the bare address out of a display name wrapping the address in angle brackets or a bare one. */
/**
 * Undo the HTML escaping Zoho applies to address headers.
 *
 * Stored values genuinely look like
 *   &quot;Someone&quot;&lt;someone@example.com&gt;
 * so a parser expecting literal quotes and angle brackets finds no address at
 * all. That is not cosmetic: an address that fails to parse fails to match,
 * and a row of real mail would be detached from its lead as "unrelated" on
 * the strength of a formatting artefact.
 */
function decodeEntities(value) {
  return String(value == null ? '' : value)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');   // last: an escaped ampersand may encode the rest
}

function bareAddress(value) {
  var s = decodeEntities(value).trim();
  var angled = s.match(/<([^>]+)>/);
  if (angled) s = angled[1];
  var first = s.split(/[,;]/)[0];
  s = String(first || '').trim().toLowerCase();

  // A display name with no address ("Dhiraj T H") is not an address. Saying
  // so explicitly stops it being compared as though it were one.
  return s.indexOf('@') === -1 ? '' : s;
}

/**
 * Index every lead by email address, so a message can be filed against the
 * right record without a lookup per message.
 */
function leadIndexByEmail() {
  var leads = getRecordsRaw('Leads');
  var index = {};
  for (var i = 0; i < leads.length; i++) {
    if (isDeletedRow(leads[i])) continue;
    var addr = bareAddress(leads[i].Email);
    // First writer wins: if two leads share an address, filing under the
    // older one is at least deterministic.
    if (addr && !index[addr]) index[addr] = leads[i];
  }
  return index;
}

/**
 * Sync the caller's whole mailbox, not just one lead's thread.
 *
 * This is what surfaces correspondence with people who are NOT in the CRM.
 * Everything is filed into EmailLog either against a matching lead or with a
 * blank LeadId, which is what `getUnmatchedEmails` then reports on.
 *
 * Deliberately bounded. A mailbox listing is the most expensive thing this
 * backend does, and it runs on a free-tier quota, so it reads a page of recent
 * messages rather than the entire history and stores only what is new.
 */
/* ---------------- where each mailbox got to last time ---------------- */

/**
 * Sync bookmarks live in Script Properties, not in a sheet column.
 *
 * This is operational bookkeeping rather than business data: it describes the
 * sync process, not the CRM's records. Keeping it out of the Users sheet means
 * no schema migration, nothing to add by hand, and no risk of a bookmark
 * colliding with a column somebody edits.
 */
function mailSyncStateKey(userId) {
  return 'MAILSYNC_' + String(userId);
}

function readMailSyncState(userId) {
  var raw = PropertiesService.getScriptProperties().getProperty(mailSyncStateKey(userId));
  if (!raw) return { newestMessageId: '', lastSyncAt: '', lastError: '' };
  try {
    return JSON.parse(raw);
  } catch (e) {
    return { newestMessageId: '', lastSyncAt: '', lastError: '' };
  }
}

function writeMailSyncState(userId, state) {
  PropertiesService.getScriptProperties()
    .setProperty(mailSyncStateKey(userId), JSON.stringify(state));
}

/**
 * Work shared by every mailbox in one run.
 *
 * The EmailLog scan and the lead index are the same for all of them, so a run
 * over six mailboxes reads each once instead of six times.
 */
function newSyncContext() {
  var existing = getRecordsRaw('EmailLog');
  var seen = {};
  for (var e = 0; e < existing.length; e++) seen[String(existing[e].MessageId)] = true;
  return { seen: seen, leadIndex: leadIndexByEmail(), now: new Date().toISOString() };
}

/**
 * Archive one person's mailbox. Works for ANY user id, not just the caller.
 *
 * Callable with someone else's id only from the scheduled job — every HTTP
 * path passes actor.ID, so a request can still never read another person's
 * mailbox.
 *
 * Incremental. Zoho returns newest-first, so the walk stops at the first
 * message already in the archive: after the initial run each sync reads one
 * page and usually writes nothing. The bookmark makes the common case cheaper
 * still — if the newest message is the one we ended on last time, there is
 * nothing new and it returns without touching the sheet at all.
 */
/**
 * The folders worth archiving: what arrived, and what we sent.
 *
 * A listing is always scoped to one folder, and asking without one gives the
 * INBOX — not the whole mailbox. Syncing only the default therefore collected
 * inbound mail and none of the replies, which is the half a manager most needs
 * to see. Drafts, Trash and Spam are deliberately excluded: an unsent draft is
 * not correspondence, and filing spam against a lead is worse than missing it.
 */
function syncableFolders(box, cfg) {
  var body;
  try {
    var res = zohoFetch(cfg.mailHost + '/api/accounts/' + box.accountId + '/folders', {
      headers: { Authorization: 'Zoho-oauthtoken ' + box.accessToken },
      muteHttpExceptions: true
    });
    body = parseZohoJson(res, 'folder listing');
  } catch (err) {
    // A token issued before ZohoMail.folders.READ was requested can read
    // messages but not list folders, and answers 401 here. Failing the whole
    // mailbox over that would stop archiving mail that was syncing perfectly
    // well a moment ago — so fall back to the default listing, which is the
    // Inbox, and say plainly what reconnecting would add.
    return {
      folders: [{ id: '', name: 'Inbox (default)' }],
      degraded: 'This mailbox was connected before the CRM asked for folder ' +
                'access, so only received mail can be archived. Reconnect it ' +
                'from the dashboard to include sent mail.'
    };
  }

  var all = body.data || [];
  var want = { INBOX: true, SENT: true };
  var out = [];

  for (var i = 0; i < all.length; i++) {
    var f = all[i];
    var kind = String(f.folderType || f.folderName || '').toUpperCase();
    if (want[kind]) out.push({ id: String(f.folderId), name: String(f.folderName || kind) });
  }

  // A mailbox that reports no folders we recognise still gets the default
  // listing rather than being skipped entirely.
  if (!out.length) out.push({ id: '', name: 'default' });
  return { folders: out, degraded: '' };
}

function syncMailboxForUser(userId, ctx, limit) {
  if (isNaN(limit) || limit < 1) limit = 50;
  if (limit > MAX_MAILBOX_SYNC) limit = MAX_MAILBOX_SYNC;

  var box = openMailbox(userId);
  var cfg = getZohoConfig();
  var state = readMailSyncState(userId);
  var marks = state.folders || {};

  var picked = syncableFolders(box, cfg);
  var folders = picked.folders;
  var mine = String(box.email).toLowerCase();
  var stored = 0, matched = 0, unmatched = 0, scanned = 0, foldersUpToDate = 0;

  for (var f = 0; f < folders.length; f++) {
    var folder = folders[f];

    var url = cfg.mailHost + '/api/accounts/' + box.accountId +
              '/messages/view?limit=' + limit + '&start=1' +
              (folder.id ? '&folderId=' + encodeURIComponent(folder.id) : '');
    var res = zohoFetch(url, {
      headers: { Authorization: 'Zoho-oauthtoken ' + box.accessToken },
      muteHttpExceptions: true
    });

    var body = parseZohoJson(res, 'mailbox listing');
    var messages = body.data || [];
    // An empty folder has nothing to do, which is as up to date as it gets.
    // Counted explicitly, because otherwise a mailbox with an empty Sent
    // folder could never report itself finished and every run looked like it
    // had found work to do.
    if (!messages.length) {
      foldersUpToDate++;
      continue;
    }

    var newestId = String(messages[0].messageId || '');

    // Nothing has arrived in this folder since last time.
    if (newestId && newestId === String(marks[folder.id] || '')) {
      foldersUpToDate++;
      continue;
    }

    for (var m = 0; m < messages.length; m++) {
      var msg = messages[m];
      var id = String(msg.messageId || '');
      if (!id) continue;
      scanned++;

      // Newest-first: the first message already held means every message after
      // it is older and already held too.
      if (ctx.seen[id]) break;

      var allAddrs = extractAllAddresses(msg);
      var sender = bareAddress(msg.sender || msg.fromAddress);
      var recipient = bareAddress(msg.toAddress);
      var inbound = sender !== '' && sender !== mine;

      // Find any matching lead from all parties involved in this message
      var lead = null;
      var matchedAddr = '';
      for (var a = 0; a < allAddrs.length; a++) {
        var addr = allAddrs[a];
        if (addr !== mine && ctx.leadIndex[addr]) {
          lead = ctx.leadIndex[addr];
          matchedAddr = addr;
          break;
        }
      }

      // The counterparty is whoever is not us.
      var other = matchedAddr || (inbound ? sender : recipient) || (allAddrs.length ? allAddrs[0] : '');

      appendRecordRaw('EmailLog', {
        MessageId: id,
        LeadId: lead ? String(lead.ID) : '',
        LeadEmail: lead ? bareAddress(lead.Email) : other,
        UserId: userId,
        Direction: inbound ? 'in' : 'out',
        Subject: String(msg.subject || '(No Subject)').slice(0, 500),
        Summary: String(msg.summary || '').slice(0, 2000),
        Sender: String(msg.sender || msg.fromAddress || ''),
        ToAddress: String(msg.toAddress || ''),
        CcAddress: String(msg.ccAddress || ''),
        SentAt: toIsoTimestamp(msg.receivedTime, ctx.now),
        SyncedAt: ctx.now,
        // Zoho addresses a body as folder + message, so without this the full
        // text can never be fetched later.
        FolderId: String(msg.folderId || folder.id || '')
      });

      ctx.seen[id] = true;
      stored++;
      if (lead) matched++; else unmatched++;

      // A reply from a client is the one notification people actually need,
      // and it is what puts incoming mail in the global activity feed.
      //
      // The per-lead archive path already wrote this; the scheduled sync did
      // not — so mail that arrived while nobody had the lead open was filed
      // silently and nobody was told. Dated when the message ARRIVED, not when
      // the sync noticed it, or a quiet week would dump itself onto today.
      if (inbound && lead) {
        auditLog({
          entityId: String(lead.ID), entityType: 'Lead', action: 'EMAIL_RECEIVED',
          userId: userId,
          contactMode: 'EMAIL',
          occurredAt: toIsoTimestamp(msg.receivedTime, ctx.now),
          details: 'Reply received from ' + other + ': ' +
                   String(msg.subject || '(No Subject)').slice(0, 200),
          metadata: { messageId: id }
        });
      }
    }

    if (newestId) marks[folder.id] = newestId;
  }

  writeMailSyncState(userId, {
    folders: marks, lastSyncAt: ctx.now, lastError: picked.degraded || ''
  });

  if (stored > 0) {
    auditLog({
      entityId: userId, entityType: 'User', action: 'MAILBOX_SYNCED',
      userId: userId,
      details: stored + ' new message' + (stored === 1 ? '' : 's') + ' recorded — ' +
               matched + ' matched to a lead, ' + unmatched + ' with no matching lead.'
    });
  }

  return {
    scanned: scanned, stored: stored,
    matchedToLead: matched, withoutLead: unmatched,
    mailbox: box.email,
    folders: folders.length,
    degraded: picked.degraded || '',
    upToDate: foldersUpToDate === folders.length
  };
}

function syncMailbox(actor, payload) {
  payload = payload || {};
  if (!actor) throw new ApiError('UNAUTHENTICATED', 'Sign in first.');
  // Always the caller's own mailbox, whatever the request says.
  return syncMailboxForUser(actor.ID, newSyncContext(), Number(payload.limit));
}

/** Leave this much of the 6-minute execution budget unused, so the run ends tidily. */
var MAIL_SYNC_TIME_BUDGET_MS = 4.5 * 60 * 1000;

/**
 * Archive EVERY linked mailbox. This is the scheduled job.
 *
 * Why it has to exist: a request only ever reads the CALLER's mailbox, which
 * is what stops one person reading a colleague's inbox. The consequence was
 * that mail somebody sent from their own Zoho account never reached the CRM at
 * all unless they happened to open that lead — so a manager reviewing a lead
 * saw a conversation with pieces missing, and could not tell that anything was
 * missing.
 *
 * Running as a trigger, this is the script acting as itself rather than on
 * behalf of a user, so reading every mailbox is legitimate. Nothing changes
 * about who can READ the archive: getStoredEmails still scopes by which leads
 * you may see.
 *
 * One broken mailbox never stops the rest — a revoked token is recorded
 * against that user and the loop continues.
 */
function syncAllMailboxes(opts) {
  opts = opts || {};
  var started = Date.now();
  var limit = Number(opts.limit);

  var users = getRecordsRaw('Users');
  var ctx = newSyncContext();

  var report = {
    startedAt: ctx.now, mailboxes: 0, skipped: 0,
    stored: 0, matchedToLead: 0, withoutLead: 0,
    upToDate: 0, failed: [], inboxOnly: [], ranOutOfTime: false
  };

  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    if (String(u.Status || '') !== 'Active') { report.skipped++; continue; }
    if (!String(u.ZohoRefreshToken || '')) { report.skipped++; continue; }

    // Stop before Apps Script kills the run mid-write. Whatever is left is
    // picked up on the next tick, and the bookmarks mean nothing is redone.
    if (Date.now() - started > MAIL_SYNC_TIME_BUDGET_MS) {
      report.ranOutOfTime = true;
      break;
    }

    try {
      var r = syncMailboxForUser(String(u.ID), ctx, limit);
      report.mailboxes++;
      report.stored += r.stored;
      report.matchedToLead += r.matchedToLead;
      report.withoutLead += r.withoutLead;
      if (r.upToDate) report.upToDate++;
      // Syncing, but Inbox only — sent mail is still missing for this person.
      if (r.degraded) report.inboxOnly.push(String(u.Username || u.ID));
    } catch (err) {
      var why = err && err.message ? err.message : String(err);
      report.failed.push({ userId: String(u.ID), username: String(u.Username || ''), reason: why });
      writeMailSyncState(String(u.ID), {
        newestMessageId: readMailSyncState(String(u.ID)).newestMessageId || '',
        lastSyncAt: ctx.now,
        lastError: why
      });
    }
  }

  Logger.log('syncAllMailboxes: ' + JSON.stringify(report));

  if (report.stored > 0 || report.failed.length) {
    auditLog({
      entityId: 'SYSTEM', entityType: 'System', action: 'MAILBOX_SYNC_ALL',
      userId: 'SYSTEM',
      details: report.mailboxes + ' mailbox(es) synced, ' + report.stored +
               ' new message(s) recorded' +
               (report.failed.length ? ', ' + report.failed.length + ' needing reconnection' : '') + '.',
      metadata: report
    });
  }

  return report;
}

/**
 * Super Admin's manual "sync everyone now".
 *
 * Same job the trigger runs. Restricted to SUPER_ADMIN because it reads every
 * mailbox — and even then it only WRITES the archive; it returns counts, never
 * message contents, so it is not a way to read a colleague's mail.
 */
function syncAllMailboxesAction(actor, payload) {
  payload = payload || {};
  if (!actor) throw new ApiError('UNAUTHENTICATED', 'Sign in first.');
  if (String(actor.role) !== 'SUPER_ADMIN') {
    throw new ApiError('FORBIDDEN', 'Only a Super Admin may sync every mailbox.');
  }
  return syncAllMailboxes({ limit: payload.limit });
}

/**
 * Which users' mail may this actor see?
 *
 * Returns null for "everyone" so callers can skip filtering entirely rather
 * than building a set of every id in the org.
 */
function mailVisibleUserIds(actor) {
  if (!actor) return [];
  var role = String(actor.role || '');
  if (role === 'SUPER_ADMIN') return null;

  // ADMIN is this organisation's team-lead role — there is no separate one.
  // Their reach is their team, which is set in Admin → Team Structure rather
  // than hardcoded here.
  if (role === 'ADMIN') {
    var users = getRecordsRaw('Users');
    var team = String(actor.team || actor.Team || '');
    var ids = [String(actor.ID)];
    for (var i = 0; i < users.length; i++) {
      if (sameTeam(users[i].Team, team)) ids.push(String(users[i].ID));
    }
    return ids;
  }

  // Everyone else sees only their own correspondence.
  return [String(actor.ID)];
}

/**
 * Mail with no matching lead.
 *
 * The point is coverage: a conversation happening in a rep's mailbox that has
 * no record in the CRM is invisible to management, and that is exactly the
 * mail worth looking at. A Super Admin sees all of it; an Admin or team lead
 * sees their own team's; everyone else sees their own.
 */
function getUnmatchedEmails(actor, params) {
  params = params || {};
  if (!actor) throw new ApiError('UNAUTHENTICATED', 'Sign in first.');

  var allowed = mailVisibleUserIds(actor);
  var limit = Number(params.limit);
  if (isNaN(limit) || limit < 1 || limit > 500) limit = 200;

  var rows = getRecordsRaw('EmailLog');
  var leadIndex = leadIndexByEmail();
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (String(r.LeadId || '')) continue;

    // Check if this message actually matches a lead now (e.g. imported after mailbox sync)
    var leadEmail = bareAddress(r.LeadEmail);
    var sender = bareAddress(r.Sender);
    var to = bareAddress(r.ToAddress);
    var matchedLead = (leadEmail && leadIndex[leadEmail]) ||
                      (sender && leadIndex[sender]) ||
                      (to && leadIndex[to]);
    if (matchedLead) {
      try {
        updateRecordRaw('EmailLog', r.ID, {
          LeadId: String(matchedLead.ID),
          LeadEmail: bareAddress(matchedLead.Email)
        });
      } catch (e) {}
      continue;
    }

    if (allowed !== null && allowed.indexOf(String(r.UserId)) === -1) continue;
    out.push(r);
  }

  out.sort(function (a, b) {
    return Date.parse(b.SentAt || 0) - Date.parse(a.SentAt || 0);
  });

  return {
    total: out.length,
    truncated: out.length > limit,
    messages: stripAll(out.slice(0, limit))
  };
}

/**
 * Email activity, scoped to what the caller may see.
 *
 * Every role gets their own figures; managers additionally get a per-person
 * breakdown for their team, and a Super Admin gets the whole organisation.
 *
 * Counts come from EmailLog rather than the audit trail, because EmailLog is
 * deduplicated on Zoho's message id — the audit trail records actions, and one
 * message can produce several.
 */
function getEmailAnalytics(actor, params) {
  params = params || {};
  if (!actor) throw new ApiError('UNAUTHENTICATED', 'Sign in first.');

  var days = Number(params.days);
  if (isNaN(days) || days < 1 || days > 3650) days = 30;
  var fromTime = Date.parse(startOfCrmDay(days));

  var allowed = mailVisibleUserIds(actor);
  var rows = getRecordsRaw('EmailLog');
  var users = getRecordsRaw('Users');

  var nameOf = {};
  for (var u = 0; u < users.length; u++) {
    nameOf[String(users[u].ID)] = String(users[u].Username || users[u].ID);
  }

  var totals = { sent: 0, received: 0, matchedToLead: 0, withoutLead: 0 };
  var perUser = {};
  var perDay = {};
  var leadsContacted = {};
  var leadsThatReplied = {};

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var uid = String(r.UserId || '');
    if (allowed !== null && allowed.indexOf(uid) === -1) continue;

    var ts = Date.parse(String(r.SentAt || ''));
    if (isNaN(ts) || ts < fromTime) continue;

    var inbound = String(r.Direction) === 'in';
    var leadId = String(r.LeadId || '');

    if (!perUser[uid]) {
      perUser[uid] = {
        userId: uid, username: nameOf[uid] || uid,
        sent: 0, received: 0, withoutLead: 0
      };
    }

    if (inbound) { totals.received++; perUser[uid].received++; }
    else { totals.sent++; perUser[uid].sent++; }

    if (leadId) {
      totals.matchedToLead++;
      if (inbound) leadsThatReplied[leadId] = true;
      else leadsContacted[leadId] = true;
    } else {
      totals.withoutLead++;
      perUser[uid].withoutLead++;
    }

    var day = String(r.SentAt).slice(0, 10);
    if (!perDay[day]) perDay[day] = { date: day, sent: 0, received: 0 };
    if (inbound) perDay[day].received++; else perDay[day].sent++;
  }

  var contactedCount = Object.keys(leadsContacted).length;
  var repliedCount = 0;
  for (var lid in leadsThatReplied) {
    if (Object.prototype.hasOwnProperty.call(leadsThatReplied, lid) &&
        leadsContacted[lid]) repliedCount++;
  }

  var breakdown = [];
  for (var k in perUser) {
    if (Object.prototype.hasOwnProperty.call(perUser, k)) breakdown.push(perUser[k]);
  }
  breakdown.sort(function (a, b) { return (b.sent + b.received) - (a.sent + a.received); });

  var series = [];
  for (var d in perDay) {
    if (Object.prototype.hasOwnProperty.call(perDay, d)) series.push(perDay[d]);
  }
  series.sort(function (a, b) { return a.date < b.date ? -1 : 1; });

  return {
    window: { days: days, from: startOfCrmDay(days), timeZone: getCrmTimeZone() },
    scope: allowed === null ? 'organisation'
         : allowed.length > 1 ? 'team' : 'self',
    totals: totals,
    // Only counts leads we actually emailed in the window, so it cannot
    // exceed 100% by counting replies to older outreach.
    engagement: {
      leadsEmailed: contactedCount,
      leadsThatReplied: repliedCount,
      replyRatePercent: contactedCount
        ? Math.round((repliedCount / contactedCount) * 1000) / 10
        : null
    },
    byUser: breakdown,
    byDay: series,
    // Said plainly: this counts what the CRM has synced, which is not
    // necessarily everything in everyone's mailbox.
    coverage: {
      note: 'Counts messages recorded in the CRM. Mail in a mailbox that has ' +
            'never been synced is not included.',
      mailboxesReporting: breakdown.length
    }
  };
}

function zohoSearch(box, cfg, searchKey) {
  var url = cfg.mailHost + '/api/accounts/' + box.accountId +
            '/messages/search?searchKey=' + encodeURIComponent(searchKey);
  var res = zohoFetch(url, {
    headers: { Authorization: 'Zoho-oauthtoken ' + box.accessToken },
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) return [];
  try {
    var body = JSON.parse(res.getContentText());
    return body.data || [];
  } catch (e) {
    return [];
  }
}

function fetchZohoMessageContent(box, cfg, folderId, messageId) {
  var endpoints = [
    cfg.mailHost + '/api/accounts/' + box.accountId + '/messages/' + messageId + '/content',
    cfg.mailHost + '/api/accounts/' + box.accountId + '/folders/' + (folderId || '0') +
      '/messages/' + messageId + '/content'
  ];

  for (var i = 0; i < endpoints.length; i++) {
    try {
      var res = zohoFetch(endpoints[i], {
        headers: { Authorization: 'Zoho-oauthtoken ' + box.accessToken },
        muteHttpExceptions: true
      });
      if (res.getResponseCode() !== 200) continue;
      var json = JSON.parse(res.getContentText());
      if (json && json.data) {
        if (typeof json.data.content === 'string' && json.data.content) return json.data.content;
        if (typeof json.data.description === 'string' && json.data.description) return json.data.description;
      }
    } catch (e) {
      // try the next shape
    }
  }
  return '';
}

/* ================================================================== *
 * Sending mail
 * ================================================================== */

/**
 * Send as plain text unless the body actually contains markup.
 *
 * This used to be hard-coded to 'html'. The composer is a plain textarea, so
 * every message was declared HTML while containing none: HTML collapses
 * whitespace, which silently destroyed every line break the sender typed.
 * It also made all outbound mail HTML-only with no text alternative, which
 * spam filters score against (SpamAssassin's MIME_HTML_ONLY, among others).
 *
 * A body that genuinely holds tags is still sent as HTML.
 */
function detectMailFormat(content) {
  return /<(a|b|br|div|em|h[1-6]|i|img|li|ol|p|span|strong|table|ul)\b[^>]*>/i
    .test(String(content)) ? 'html' : 'plaintext';
}

/**
 * Total attachment payload accepted in one message.
 *
 * The whole request arrives as base64 inside a JSON body, which inflates a
 * file by about a third, and Apps Script has to hold all of it in memory at
 * once. 8 MB of encoded data is roughly a 6 MB file — comfortably more than a
 * proposal or a deck, and well inside what the runtime can handle.
 */
var MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
var MAX_ATTACHMENT_COUNT = 5;

/** Filenames come from the client, so they are treated as hostile. */
function safeAttachmentName(name) {
  var s = String(name || 'attachment');
  // Windows and POSIX path separators, plus characters no filesystem or
  // mail client copes with, become underscores.
  s = s.replace(/[\\/:*?"<>|]/g, '_');
  // Control characters written as ESCAPES. A literal control byte here
  // survives Node happily but corrupts the paste into the Apps Script
  // editor, which is how this file is actually deployed.
  s = s.replace(/[\x00-\x1F\x7F]/g, '');
  s = s.replace(/\.\.+/g, '.');
  s = s.replace(/^\.+/, '');
  if (!s) s = 'attachment';
  return s.slice(0, 200);
}

/**
 * Upload each attachment and return the handles Zoho expects on the message.
 *
 * Throws rather than silently dropping a file: someone who attached a
 * document and pressed send must not be told the mail went out intact when
 * the attachment did not.
 */
function uploadAttachments(box, cfg, attachments) {
  if (!attachments || !attachments.length) return [];

  if (attachments.length > MAX_ATTACHMENT_COUNT) {
    throw new ApiError('VALIDATION_FAILED',
      'At most ' + MAX_ATTACHMENT_COUNT + ' attachments per message.');
  }

  var totalBytes = 0;
  for (var c = 0; c < attachments.length; c++) {
    totalBytes += String(attachments[c].data || '').length;
  }
  if (totalBytes > MAX_ATTACHMENT_BYTES) {
    throw new ApiError('VALIDATION_FAILED',
      'Attachments are too large. The limit is about ' +
      Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024) * 0.75) + ' MB in total.');
  }

  var handles = [];
  for (var i = 0; i < attachments.length; i++) {
    var a = attachments[i] || {};
    var name = safeAttachmentName(a.name);
    var data = String(a.data || '');
    if (!data) throw new ApiError('VALIDATION_FAILED', 'Attachment "' + name + '" is empty.');

    var bytes;
    try {
      bytes = Utilities.base64Decode(data);
    } catch (e) {
      throw new ApiError('VALIDATION_FAILED', 'Attachment "' + name + '" is not valid base64.');
    }

    var blob = Utilities.newBlob(bytes, String(a.mimeType || 'application/octet-stream'), name);
    var url = cfg.mailHost + '/api/accounts/' + box.accountId +
              '/messages/attachments?fileName=' + encodeURIComponent(name);

    var res = zohoFetch(url, {
      method: 'post',
      headers: { Authorization: 'Zoho-oauthtoken ' + box.accessToken },
      payload: blob,
      muteHttpExceptions: true
    });

    var body = parseZohoJson(res, 'attachment upload');
    var d = body.data;
    if (Object.prototype.toString.call(d) === '[object Array]') d = d[0];
    if (!d || !d.storeName) {
      throw new ApiError('EXTERNAL_ERROR',
        'Zoho did not accept the attachment "' + name + '".');
    }

    handles.push({
      storeName: d.storeName,
      attachmentPath: d.attachmentPath,
      attachmentName: d.attachmentName || name
    });
  }

  return handles;
}

/**
 * Turn a login handle into something a person would recognise.
 *
 * "dhiraj_th" -> "Dhiraj Th". Crude, and deliberately so: it is only a
 * fallback for accounts with no DisplayName set. Anyone whose name it gets
 * wrong should have DisplayName filled in — that column exists precisely
 * because no rule can derive "Dhiraj T H" from a username.
 */
function prettifyUsername(username) {
  var parts = String(username || '').split(/[._\-\s]+/);
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (!p) continue;
    out.push(p.charAt(0).toUpperCase() + p.slice(1).toLowerCase());
  }
  return out.join(' ');
}

/**
 * RFC 5322 `"Display Name" <address>`, or the bare address if we have no name.
 *
 * The quoted string is escaped: a name containing a quote or backslash would
 * otherwise produce a malformed header, and Zoho would either reject the
 * message or send it with a mangled From.
 */
function formatFromAddress(actor, mailboxAddress) {
  var name = '';
  if (actor) {
    var row = getRecordByIdRaw('Users', actor.ID);
    if (row) {
      name = String(row.DisplayName || '').trim() || prettifyUsername(row.Username);
    }
  }
  if (!name) return mailboxAddress;

  var escaped = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return '"' + escaped + '" <' + mailboxAddress + '>';
}

function sendZohoEmail(actor, payload) {
  payload = payload || {};
  if (!actor) throw new ApiError('UNAUTHENTICATED', 'Sign in first.');

  var to = String(payload.to || '').trim();
  var subject = String(payload.subject || '').trim();
  var content = String(payload.content || '');

  if (!to) throw new ApiError('BAD_REQUEST', 'A recipient is required.');
  if (!isEmail(to)) throw new ApiError('VALIDATION_FAILED', 'Recipient address is not valid.');
  if (subject.length > 500) throw new ApiError('VALIDATION_FAILED', 'Subject is too long.');
  if (content.length > 200000) throw new ApiError('VALIDATION_FAILED', 'Message body is too large.');

  // Always the caller's own mailbox; a userId in the payload is ignored.
  var box = openMailbox(actor.ID);
  var cfg = getZohoConfig();

  // Zoho takes attachments in two steps: upload each file, then reference the
  // handles it hands back. Uploading first means a rejected file fails before
  // the message goes out, rather than sending an email that promised an
  // attachment it does not have.
  var attached = uploadAttachments(box, cfg, payload.attachments);

  var sendBody = {
    // A bare address makes the recipient's inbox show the local part of the
    // mailbox — "dhiraj.th" — rather than a person. Every mail client renders
    // the display name when one is supplied, and mail from a name rather than
    // a handle also reads less like automated bulk to a spam filter.
    fromAddress: formatFromAddress(actor, box.email),
    toAddress: to,
    subject: subject,
    content: content,
    mailFormat: detectMailFormat(content)
  };
  if (payload.cc) sendBody.ccAddress = String(payload.cc).trim();
  if (attached.length) sendBody.attachments = attached;

  var res = zohoFetch(cfg.mailHost + '/api/accounts/' + box.accountId + '/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Zoho-oauthtoken ' + box.accessToken },
    payload: JSON.stringify(sendBody),
    muteHttpExceptions: true
  });

  var body = parseZohoJson(res, 'send');
  if (body.status && body.status.code !== 200) {
    throw new ApiError('EXTERNAL_ERROR',
      'Zoho refused the message: ' + (body.status.description || 'unknown error'));
  }

  // Record it here too, so the conversation is complete in the CRM even
  // before the next Zoho sync — and remains so if the mailbox is later
  // cleaned out.
  try {
    var sentId = (body.data && body.data.messageId) ? String(body.data.messageId)
                                                    : 'sent-' + Utilities.getUuid();
    appendRecordRaw('EmailLog', {
      MessageId: sentId,
      LeadId: String(payload.leadId || ''),
      LeadEmail: to,
      UserId: actor.ID,
      Direction: 'out',
      Subject: subject || '(No Subject)',
      Summary: String(content).replace(/<[^>]*>/g, ' ').slice(0, 500),
      Sender: box.email,
      ToAddress: to,
      SentAt: new Date().toISOString(),
      SyncedAt: new Date().toISOString()
    });
  } catch (e) {
    Logger.log('Could not record sent mail: ' + e.message);
  }

  // A draft that has now been sent is closed out rather than left dangling.
  if (payload.draftId) {
    try {
      updateRecordRaw('EmailDrafts', String(payload.draftId), {
        SentAt: new Date().toISOString()
      });
    } catch (e) { /* the mail went out; a stale draft is not worth failing on */ }
  }

  auditLog({
    entityId: payload.leadId || to, entityType: 'Lead', action: 'EMAIL_SENT',
    userId: actor.ID,
    contactMode: 'EMAIL',
    details: 'Email sent to ' + to + ' from ' + box.email + '.',
    metadata: { subject: subject }
  });

  return { status: 'success', from: box.email, to: to };
}

/* ================================================================== *
 * Drafts
 *
 * Kept in the CRM rather than in Zoho's own drafts folder, so a half-written
 * reply is visible next to the lead it belongs to, survives a browser
 * refresh, and does not depend on a live mailbox connection.
 * ================================================================== */

function saveEmailDraft(actor, payload) {
  payload = payload || {};
  if (!actor) throw new ApiError('UNAUTHENTICATED', 'Sign in first.');

  var leadId = String(payload.leadId || '');
  if (!leadId) throw new ApiError('BAD_REQUEST', 'leadId is required.');

  // You may only draft against a lead you can see.
  getScopedRecordById('Leads', leadId, 'getLeadById', actor);

  var to = String(payload.to || '').trim();
  if (to && !isEmail(to)) {
    throw new ApiError('VALIDATION_FAILED', 'Recipient address is not valid.');
  }

  var subject = String(payload.subject || '').slice(0, 500);
  var content = String(payload.content || '');
  if (content.length > 200000) {
    throw new ApiError('VALIDATION_FAILED', 'Draft is too large.');
  }

  return withLock(function () {
    var draftId = String(payload.draftId || '');

    if (draftId) {
      var existing = getRecordByIdRaw('EmailDrafts', draftId);
      if (!existing) throw new ApiError('NOT_FOUND', 'Draft not found.');
      if (String(existing.UserId) !== String(actor.ID)) {
        throw new ApiError('FORBIDDEN', 'That draft belongs to someone else.');
      }
      if (existing.SentAt) {
        throw new ApiError('CONFLICT', 'That draft has already been sent.');
      }
      var updated = updateRecordRaw('EmailDrafts', draftId, {
        ToAddress: to, Subject: subject, Content: content
      });
      return { draft: stripInternal(updated), created: false };
    }

    var created = appendRecordRaw('EmailDrafts', {
      LeadId: leadId,
      UserId: actor.ID,
      ToAddress: to,
      Subject: subject,
      Content: content,
      SentAt: ''
    });

    return { draft: stripInternal(created), created: true };
  }, 'saveEmailDraft');
}

/** A user's unsent drafts. Drafts are private to their author. */
function getEmailDrafts(actor, params) {
  params = params || {};
  if (!actor) throw new ApiError('UNAUTHENTICATED', 'Sign in first.');

  var leadId = String(params.leadId || '');
  var includeSent = params.includeSent === true || params.includeSent === 'true';

  var rows = getRecordsRaw('EmailDrafts');
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    var d = rows[i];
    // A half-written message is personal; it is not team-readable.
    if (String(d.UserId) !== String(actor.ID)) continue;
    if (leadId && String(d.LeadId) !== leadId) continue;
    if (!includeSent && d.SentAt) continue;
    out.push(d);
  }

  out.sort(function (a, b) {
    return Date.parse(b.UpdatedAt || b.CreatedAt || 0) -
           Date.parse(a.UpdatedAt || a.CreatedAt || 0);
  });

  return stripAll(out);
}

function deleteEmailDraft(actor, payload) {
  payload = payload || {};
  if (!actor) throw new ApiError('UNAUTHENTICATED', 'Sign in first.');

  var draftId = String(payload.draftId || payload.id || '');
  if (!draftId) throw new ApiError('BAD_REQUEST', 'draftId is required.');

  return withLock(function () {
    var draft = getRecordByIdRaw('EmailDrafts', draftId);
    if (!draft) return { deleted: false, idempotent: true };
    if (String(draft.UserId) !== String(actor.ID)) {
      throw new ApiError('FORBIDDEN', 'That draft belongs to someone else.');
    }
    // A draft was never sent to anyone, so there is nothing to preserve.
    deleteRecordRaw('EmailDrafts', draftId);
    return { deleted: true, idempotent: false };
  }, 'deleteEmailDraft');
}

/* ================================================================== *
 * Transport helpers
 * ================================================================== */

function zohoFetch(url, options) {
  try {
    return UrlFetchApp.fetch(url, options);
  } catch (e) {
    throw new ApiError('EXTERNAL_ERROR', 'Could not reach Zoho: ' + e.message);
  }
}

function parseZohoJson(response, label) {
  var code = response.getResponseCode();
  var text = response.getContentText();

  if (code === 429) {
    throw new ApiError('RATE_LIMITED', 'Zoho rate limit reached. Please retry shortly.');
  }

  var json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new ApiError('EXTERNAL_ERROR',
      'Zoho returned an unreadable response during ' + label + '.');
  }

  if (code >= 400 && !json.access_token && !json.refresh_token) {
    var desc = (json.status && json.status.description) || json.error || ('HTTP ' + code);
    throw new ApiError('EXTERNAL_ERROR', 'Zoho ' + label + ' failed: ' + desc);
  }

  return json;
}