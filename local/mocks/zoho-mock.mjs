/**
 * Deterministic Zoho Mail mock.
 *
 * Serves accounts.zoho.in (OAuth) and mail.zoho.in (Mail API) so the real
 * ZohoMail.gs can be exercised end to end without touching a live mailbox,
 * live OAuth client, or live refresh tokens.
 *
 * Every mailbox is keyed by refresh token, which is what makes cross-account
 * isolation testable: if the backend ever uses the wrong token, the mock
 * returns the wrong mailbox and the isolation test fails loudly.
 *
 * A mock that is MORE PERMISSIVE than the real service is worse than no mock,
 * because it turns a production bug into a passing test. This one has been
 * wrong that way four times: it accepted mixed argument types where
 * Utilities.computeHmacSha256Signature does not, it returned booleans where
 * Sheets coerces them to strings, it returned an empty list for an
 * unrecognised search key where Zoho returns the whole mailbox, and it served
 * every message regardless of folder where Zoho serves only the Inbox. Each
 * time, the fix was to make the MOCK stricter first and watch the test fail.
 */

/** Folder ids, matching the shape Zoho returns from /folders. */
const FOLDER_INBOX = '1';
const FOLDER_SENT = '2';

export function createZohoMock(opts = {}) {
  const state = {
    /** authCode -> { refreshToken, email, accountId, consumed, expired } */
    codes: new Map(),
    /** refreshToken -> { email, accountId, valid } */
    tokens: new Map(),
    /** accessToken -> { refreshToken, expiresAt } */
    accessTokens: new Map(),
    /** accountId -> { email, messages: [] } */
    mailboxes: new Map(),
    sent: [],
    uploads: [],
    calls: [],
    faults: {
      tokenExchange: null,
      refresh: null,
      accounts: null,
      search: null,
      // A token issued before ZohoMail.folders.READ was requested can read
      // messages but answers 401 to a folder listing. That is the live state
      // of every mailbox connected before this scope existed.
      folders: null,
      content: null,
      send: null,
      rateLimit: false,
    },
    clientId: opts.clientId || 'LOCAL_TEST_CLIENT_ID',
    clientSecret: opts.clientSecret || 'LOCAL_TEST_CLIENT_SECRET',
    seq: 0,
  };

  const nextId = (p) => `${p}-${++state.seq}`;

  /* ---------------- fixture helpers ---------------- */

  function addAccount({ email, refreshToken, accountId }) {
    const acct = accountId || nextId('acct');
    const rt = refreshToken || nextId('rtok');
    state.tokens.set(rt, { email, accountId: acct, valid: true });
    state.mailboxes.set(acct, { email, messages: [] });
    return { email, refreshToken: rt, accountId: acct };
  }

  function issueAuthCode({ email, accountId, refreshToken }) {
    const code = nextId('authcode');
    let rt = refreshToken;
    if (!rt) {
      const created = addAccount({ email, accountId });
      rt = created.refreshToken;
    }
    state.codes.set(code, { refreshToken: rt, email, consumed: false, expired: false });
    return code;
  }

  function addMessage(accountId, msg) {
    const box = state.mailboxes.get(accountId);
    if (!box) throw new Error(`No mailbox ${accountId}`);
    const messageId = msg.messageId || nextId('msg');
    box.messages.push({
      messageId,
      folderId: msg.folderId || '1',
      subject: msg.subject || '(No Subject)',
      summary: msg.summary || '',
      content: msg.content || '',
      sender: msg.sender || '',
      toAddress: msg.toAddress || '',
      ccAddress: msg.ccAddress || '',
      receivedTime: String(msg.receivedTime || Date.parse('2026-01-02T10:00:00Z')),
    });
    return messageId;
  }

  function invalidateToken(rt) {
    const t = state.tokens.get(rt);
    if (t) t.valid = false;
  }

  /* ---------------- response helpers ---------------- */

  const resp = (code, bodyObj, text) => ({
    getResponseCode: () => code,
    getContentText: () => (text !== undefined ? text : JSON.stringify(bodyObj)),
    getHeaders: () => ({ 'Content-Type': 'application/json' }),
    getAllHeaders: () => ({ 'Content-Type': 'application/json' }),
  });

  function parseFormPayload(params) {
    const p = params && params.payload;
    if (!p) return {};
    if (typeof p === 'string') {
      return Object.fromEntries(new URLSearchParams(p));
    }
    return p;
  }

  function bearerOf(params) {
    const h = (params && params.headers) || {};
    const auth = h.Authorization || h.authorization || '';
    return String(auth).replace(/^Zoho-oauthtoken\s+/, '').trim();
  }

  function accountFromRequest(params) {
    const at = bearerOf(params);
    const rec = state.accessTokens.get(at);
    if (!rec) return null;
    const tok = state.tokens.get(rec.refreshToken);
    if (!tok || !tok.valid) return null;
    return { accountId: tok.accountId, email: tok.email, refreshToken: rec.refreshToken };
  }

  /* ---------------- the UrlFetchApp handler ---------------- */

  function handleFetch(url, params = {}) {
    state.calls.push({ url, method: params.method || 'get' });
    const u = String(url);

    if (state.faults.rateLimit) {
      return resp(429, { status: { code: 429, description: 'Rate limit exceeded' } });
    }

    /* ---- OAuth token endpoint ---- */
    if (u.startsWith('https://accounts.zoho.in/oauth/v2/token')) {
      const body = parseFormPayload(params);

      if (body.grant_type === 'authorization_code') {
        if (state.faults.tokenExchange) return state.faults.tokenExchange;
        if (body.client_id !== state.clientId || body.client_secret !== state.clientSecret) {
          return resp(400, { error: 'invalid_client' });
        }
        const rec = state.codes.get(body.code);
        if (!rec) return resp(400, { error: 'invalid_code' });
        if (rec.expired) return resp(400, { error: 'expired_code' });
        if (rec.consumed) return resp(400, { error: 'invalid_code', detail: 'already used' });
        rec.consumed = true;
        const at = nextId('atok');
        state.accessTokens.set(at, { refreshToken: rec.refreshToken });
        return resp(200, {
          access_token: at,
          refresh_token: rec.refreshToken,
          expires_in: 3600,
          token_type: 'Bearer',
        });
      }

      if (body.grant_type === 'refresh_token') {
        if (state.faults.refresh) return state.faults.refresh;
        const tok = state.tokens.get(body.refresh_token);
        if (!tok || !tok.valid) return resp(400, { error: 'invalid_token' });
        const at = nextId('atok');
        state.accessTokens.set(at, { refreshToken: body.refresh_token });
        return resp(200, { access_token: at, expires_in: 3600, token_type: 'Bearer' });
      }

      return resp(400, { error: 'unsupported_grant_type' });
    }

    /* ---- accounts listing ---- */
    if (u === 'https://mail.zoho.in/api/accounts') {
      if (state.faults.accounts) return state.faults.accounts;
      const acct = accountFromRequest(params);
      if (!acct) return resp(401, { status: { code: 401, description: 'Invalid OAuth token' } });
      return resp(200, {
        status: { code: 200 },
        data: [
          {
            accountId: acct.accountId,
            primaryEmailAddress: acct.email,
            incomingMailAddress: acct.email,
            accountDisplayName: acct.email,
          },
        ],
      });
    }

    /* ---- message search ---- */
    const searchMatch = u.match(/^https:\/\/mail\.zoho\.in\/api\/accounts\/([^/]+)\/messages\/search\?(.*)$/);
    if (searchMatch) {
      if (state.faults.search) return state.faults.search;
      const acct = accountFromRequest(params);
      if (!acct) return resp(401, { status: { code: 401, description: 'Invalid OAuth token' } });
      const requestedAccount = searchMatch[1];
      // Zoho scopes by the token; requesting another account must fail.
      if (requestedAccount !== acct.accountId) {
        return resp(403, { status: { code: 403, description: 'Forbidden account access' } });
      }
      const qs = new URLSearchParams(searchMatch[2]);
      const key = qs.get('searchKey') || '';
      const box = state.mailboxes.get(acct.accountId) || { messages: [] };
      let out = box.messages;
      const to = key.match(/^to:(.*)$/);
      const from = key.match(/^from:(.*)$/);

      if (to) {
        out = out.filter((m) => (m.toAddress || '').includes(to[1]));
      } else if (from) {
        out = out.filter((m) => (m.sender || '').includes(from[1]));
      } else {
        // AN UNRECOGNISED KEY RETURNS THE WHOLE MAILBOX.
        //
        // This is what the live service actually does, and it is far more
        // dangerous than returning nothing: a lead with no correspondence was
        // shown ten unrelated messages, including private threads between
        // colleagues. The mock previously returned [] here, which made the
        // backend look correct while it was leaking other people's mail onto
        // a lead page.
        out = box.messages;
      }
      return resp(200, { status: { code: 200 }, data: out.map(stripContent) });
    }

    /* ---- mailbox listing (newest first, bounded) ---- */
    const viewMatch = u.match(/^https:\/\/mail\.zoho\.in\/api\/accounts\/([^/]+)\/messages\/view\?(.*)$/);
    if (viewMatch) {
      if (state.faults.search) return state.faults.search;
      const acct = accountFromRequest(params);
      if (!acct) return resp(401, { status: { code: 401, description: 'Invalid OAuth token' } });
      if (viewMatch[1] !== acct.accountId) {
        return resp(403, { status: { code: 403, description: 'Forbidden account access' } });
      }
      const qs = new URLSearchParams(viewMatch[2]);
      const limit = Number(qs.get('limit') || 50);
      const box = state.mailboxes.get(acct.accountId) || { messages: [] };

      // A listing is ALWAYS scoped to one folder, and with no folderId Zoho
      // gives you the Inbox — it does not give you the whole mailbox.
      //
      // This mock used to return everything regardless of folder, which is
      // strictly more generous than the real API. A sync that only ever asked
      // for the default listing therefore looked like it collected sent mail
      // in tests, and collected none of it in production: 50 messages
      // archived, every one inbound, nothing matched to a lead.
      const wanted = qs.get('folderId') || FOLDER_INBOX;
      const inFolder = box.messages.filter(
        (m) => String(m.folderId || FOLDER_INBOX) === String(wanted)
      );

      const ordered = inFolder.sort(
        (a, b) => Number(b.receivedTime || 0) - Number(a.receivedTime || 0)
      );
      return resp(200, {
        status: { code: 200 },
        data: ordered.slice(0, limit).map(stripContent),
      });
    }

    /* ---- folder listing ---- */
    const foldersMatch = u.match(/^https:\/\/mail\.zoho\.in\/api\/accounts\/([^/]+)\/folders$/);
    if (foldersMatch) {
      if (state.faults.folders) return state.faults.folders;
      const acct = accountFromRequest(params);
      if (!acct) return resp(401, { status: { code: 401, description: 'Invalid OAuth token' } });
      if (foldersMatch[1] !== acct.accountId) {
        return resp(403, { status: { code: 403, description: 'Forbidden account access' } });
      }
      return resp(200, {
        status: { code: 200 },
        data: [
          { folderId: FOLDER_INBOX, folderName: 'Inbox', folderType: 'Inbox' },
          { folderId: FOLDER_SENT, folderName: 'Sent', folderType: 'Sent' },
          { folderId: '3', folderName: 'Drafts', folderType: 'Drafts' },
          { folderId: '4', folderName: 'Trash', folderType: 'Trash' },
          { folderId: '5', folderName: 'Spam', folderType: 'Spam' },
        ],
      });
    }

    /* ---- attachment upload ---- */
    const attachMatch = u.match(/^https:\/\/mail\.zoho\.in\/api\/accounts\/([^/]+)\/messages\/attachments\?(.*)$/);
    if (attachMatch && String(params.method || '').toLowerCase() === 'post') {
      if (state.faults.attachment) return state.faults.attachment;
      const acct = accountFromRequest(params);
      if (!acct) return resp(401, { status: { code: 401, description: 'Invalid OAuth token' } });
      if (attachMatch[1] !== acct.accountId) {
        return resp(403, { status: { code: 403, description: 'Forbidden account access' } });
      }
      const qs = new URLSearchParams(attachMatch[2]);
      const fileName = qs.get('fileName') || 'attachment';
      const blob = params.payload;
      const record = {
        fileName,
        bytes: blob && typeof blob.getBytes === 'function' ? blob.getBytes().length : 0,
        mimeType: blob && typeof blob.getContentType === 'function' ? blob.getContentType() : '',
      };
      state.uploads.push(record);
      return resp(200, {
        status: { code: 200 },
        data: {
          storeName: `store-${state.uploads.length}`,
          attachmentPath: `/att/${state.uploads.length}`,
          attachmentName: fileName,
        },
      });
    }

    /* ---- message content ---- */
    const contentMatch = u.match(/^https:\/\/mail\.zoho\.in\/api\/accounts\/([^/]+)\/(?:folders\/[^/]+\/)?messages?\/([^/]+)(?:\/content)?$/);
    if (contentMatch) {
      if (state.faults.content) return state.faults.content;
      const acct = accountFromRequest(params);
      if (!acct) return resp(401, { status: { code: 401, description: 'Invalid OAuth token' } });
      if (contentMatch[1] !== acct.accountId) {
        return resp(403, { status: { code: 403, description: 'Forbidden account access' } });
      }
      const box = state.mailboxes.get(acct.accountId) || { messages: [] };
      const msg = box.messages.find((m) => m.messageId === contentMatch[2]);
      if (!msg) return resp(404, { status: { code: 404, description: 'Message not found' } });
      return resp(200, { status: { code: 200 }, data: { content: msg.content } });
    }

    /* ---- send ---- */
    const sendMatch = u.match(/^https:\/\/mail\.zoho\.in\/api\/accounts\/([^/]+)\/messages$/);
    if (sendMatch && String(params.method || '').toLowerCase() === 'post') {
      if (state.faults.send) return state.faults.send;
      const acct = accountFromRequest(params);
      if (!acct) return resp(401, { status: { code: 401, description: 'Invalid OAuth token' } });
      if (sendMatch[1] !== acct.accountId) {
        return resp(403, { status: { code: 403, description: 'Forbidden account access' } });
      }
      let body = {};
      try {
        body = JSON.parse(params.payload);
      } catch {
        return resp(400, { status: { code: 400, description: 'Malformed payload' } });
      }
      const record = { ...body, accountId: acct.accountId, fromMailbox: acct.email };
      state.sent.push(record);
      return resp(200, { status: { code: 200, description: 'success' }, data: { messageId: nextId('sent') } });
    }

    if (u.startsWith('https://accounts.zoho.in')) {
      return resp(200, {}, 'ok');
    }

    return resp(404, { status: { code: 404, description: `Unmocked Zoho endpoint: ${u}` } });
  }

  function stripContent(m) {
    const { content, ...rest } = m;
    return rest;
  }

  return {
    handleFetch,
    state,
    addAccount,
    issueAuthCode,
    addMessage,
    invalidateToken,
    expireCode: (code) => {
      const r = state.codes.get(code);
      if (r) r.expired = true;
    },
    setFault: (k, v) => {
      state.faults[k] = v;
    },
    clearFaults: () => {
      state.faults = {
        tokenExchange: null, refresh: null, accounts: null,
        search: null, folders: null, content: null, send: null, attachment: null,
        rateLimit: false,
      };
    },
    networkError: () => {
      throw new Error('Simulated network failure contacting Zoho');
    },
    get sentMail() {
      return state.sent;
    },
    get uploadedAttachments() {
      return state.uploads;
    },
    get callCount() {
      return state.calls.length;
    },
    resetCalls: () => {
      state.calls.length = 0;
    },
  };
}
