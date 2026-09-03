/**
 * TJGROUPS CRM - HTTP API
 *
 * The security boundary. Every request passes through:
 *
 *   parse -> resolve identity from session token -> authorise action
 *         -> validate payload -> execute -> scope/redact response
 *
 * The caller's claimed userId/role is never trusted. Identity comes only
 * from a session token resolved against the Sessions sheet.
 *
 * TRANSPORT NOTE: Apps Script cannot answer a CORS preflight, so the client
 * posts text/plain with no custom headers. The session token therefore
 * travels in the JSON body (POST) or the query string (GET). Do not move it
 * to an Authorization header.
 */

/* ================================================================== *
 * Entry points
 * ================================================================== */

function doOptions(e) {
  return createJsonResponse({ status: 'ok' });
}

function doGet(e) {
  return handleRequest(e, 'GET');
}

function doPost(e) {
  return handleRequest(e, 'POST');
}

function handleRequest(e, method) {
  var requestId = beginRequest();
  resetRequestCaches();

  try {
    var body = {};
    var action;
    var payload;

    if (method === 'POST') {
      if (!e || !e.postData || !e.postData.contents) {
        return createErrorResponse('Request body is missing.', 'BAD_REQUEST');
      }
      try {
        body = JSON.parse(e.postData.contents);
      } catch (parseErr) {
        return createErrorResponse('Request body is not valid JSON.', 'BAD_REQUEST');
      }
      if (!body || typeof body !== 'object') {
        return createErrorResponse('Request body must be a JSON object.', 'BAD_REQUEST');
      }
      action = body.action;
      payload = body.payload || {};
      if (typeof payload !== 'object') {
        return createErrorResponse('payload must be an object.', 'BAD_REQUEST');
      }
    } else {
      action = e && e.parameter ? e.parameter.action : null;

      // On a GET the payload IS the query string, which also carries the
      // routing key and the session token. Handing that straight to a handler
      // means any field it reads called `action` or `token` silently receives
      // the router's value instead of the caller's — a log filter named
      // `action` matched the string "getLogs" and therefore nothing at all.
      // Strip them here so no handler can ever inherit the collision.
      payload = {};
      if (e && e.parameter) {
        for (var key in e.parameter) {
          if (!Object.prototype.hasOwnProperty.call(e.parameter, key)) continue;
          if (key === 'action' || key === 'token') continue;
          payload[key] = e.parameter[key];
        }
      }
    }

    if (!action) {
      return createErrorResponse('Missing action parameter.', 'BAD_REQUEST');
    }

    if (!getActionPolicy(action)) {
      return createErrorResponse('Unknown action: ' + action, 'UNKNOWN_ACTION');
    }

    var token = extractToken(e, body);
    var identity = resolveActor({ token: token });
    var gate = authoriseAction(action, identity);
    var actor = gate.actor;

    var data = dispatch(action, payload, actor, e, body);

    return createSuccessResponse(data, { requestId: requestId });

  } catch (err) {
    if (!isApiError(err)) {
      Logger.log('UNHANDLED ' + (method || '') + ' error: ' + (err && err.stack ? err.stack : err));
    }
    return errorResponseFrom(err);
  } finally {
    endRequest();
  }
}

/* ================================================================== *
 * Dispatch
 * ================================================================== */

/**
 * Read-only actions a `batch` request may contain.
 *
 * An allowlist, not a blocklist. Batching a write would make one HTTP request
 * that partially succeeds with no way to roll back, and would let a caller
 * smuggle a mutation past anything that inspects the top-level action. Every
 * entry here is a pure read; each still runs its own permission check, so
 * batching grants nothing that calling them one at a time would not.
 */
var BATCHABLE_ACTIONS = [
  'getUsers', 'getLeads', 'getLeadById', 'getDeals', 'getProjects',
  'getAdminRequests', 'getCommissions', 'getKPIs', 'getLogs',
  'getActivityFeed', 'getProductivity', 'getAnalytics',
  'getStoredEmails', 'getEmailDrafts', 'getEmailAnalytics', 'getSignaturePreview', 'getEmailObservations',
  'getUnmatchedEmails', 'getDeletedLeads', 'getTeamOverview'
];

var MAX_BATCH_SIZE = 10;

/**
 * Run several reads in ONE execution.
 *
 * This is the single biggest thing that makes the deployed CRM feel slow. Work
 * per request is measured in tens of milliseconds, but every Apps Script
 * invocation carries a fixed cost — cold start, session lookup, opening the
 * spreadsheet — of a second or more on the free tier. The lead page needed six
 * of those to draw itself; batched, it needs one, and the six reads share the
 * per-request sheet cache instead of each re-reading the same sheets.
 *
 * One failing sub-request does not fail the batch: each result carries its own
 * status, so a page still renders what it could load. Anything else would make
 * a single unreachable mailbox blank the whole screen.
 */
function runBatch(actor, payload) {
  payload = payload || {};
  var requests = payload.requests;

  if (Object.prototype.toString.call(requests) !== '[object Array]') {
    throw new ApiError('BAD_REQUEST', 'batch requires a requests array.');
  }
  if (!requests.length) return { results: [] };
  if (requests.length > MAX_BATCH_SIZE) {
    throw new ApiError('BAD_REQUEST',
      'A batch may contain at most ' + MAX_BATCH_SIZE + ' requests.');
  }

  var results = [];
  for (var i = 0; i < requests.length; i++) {
    var req = requests[i] || {};
    var name = String(req.action || '');
    var key = String(req.key || name || i);

    if (BATCHABLE_ACTIONS.indexOf(name) === -1) {
      results.push({
        key: key, status: 'error', code: 'BAD_REQUEST',
        message: name ? name + ' cannot be batched.' : 'Missing action.'
      });
      continue;
    }

    // The same role check the action gets when called on its own. Batching is
    // a transport optimisation; it must never be a way around the policy.
    var verdict = roleMayCallAction(actor ? actor.role : null, name);
    if (!verdict.allowed) {
      results.push({
        key: key, status: 'error', code: 'FORBIDDEN', message: verdict.reason
      });
      continue;
    }

    try {
      results.push({
        key: key, status: 'success',
        data: dispatch(name, req.payload || {}, actor, null, null)
      });
    } catch (err) {
      results.push({
        key: key, status: 'error',
        code: err && err.code ? err.code : 'INTERNAL',
        message: err && err.message ? err.message : 'Request failed.'
      });
    }
  }

  return { results: results };
}

function dispatch(action, payload, actor, e, body) {
  switch (action) {

    case 'batch':
      return runBatch(actor, payload);

    /* ---------------- session ---------------- */

    case 'login':
      return login(payload, {
        userAgent: e && e.parameter ? e.parameter.ua : ''
      });

    case 'logout':
      return logout(extractToken(e, body), actor);

    case 'getSession':
      if (!actor) throw new ApiError('UNAUTHENTICATED', 'No active session.');
      return { user: publicUser(getRecordByIdRaw('Users', actor.ID)) };

    case 'changePassword':
      if (!actor) throw new ApiError('UNAUTHENTICATED', 'Sign in first.');
      return changePassword(actor, payload);

    /* ---------------- reads ---------------- */

    case 'getUsers':
      // Directory data is needed across the app (assignment dropdowns, names),
      // but it is always redacted and an ADMIN only sees their own team.
      return redactSecrets(stripAll(getScopedRecords('Users', 'getUsers', actor)));

    case 'getLeads':
      return stripAll(getScopedRecords('Leads', 'getLeads', actor));

    case 'getLeadById':
      return stripInternal(
        getScopedRecordById('Leads', payload.id, 'getLeadById', actor)
      );

    case 'getDeals':
      return stripAll(getScopedRecords('Deals', 'getDeals', actor));

    case 'getProjects':
      return stripAll(getScopedRecords('Projects', 'getProjects', actor));

    case 'getAdminRequests':
      return stripAll(getScopedRecords('AdminRequests', 'getAdminRequests', actor));

    case 'getCommissions':
      return stripAll(getScopedRecords('Commissions', 'getCommissions', actor));

    case 'getKPIs':
      return getFinancialKPIs();

    case 'getLogs':
      // Deliberately NOT called `action`: on a GET the query string already
      // carries `action=getLogs` as the routing key, so a filter of that name
      // silently reads the router's own value and matches nothing.
      return scopedLogs(payload.id, actor, {
        action: payload.logAction,
        fromTime: payload.since ? Date.parse(String(payload.since)) : null
      });

    case 'getActivityFeed':
      return getActivityFeed(actor, payload);

    /* ---------------- reporting ---------------- */

    case 'getProductivity':
      return getProductivity(actor, payload);

    case 'getAnalytics':
      return getAnalytics(actor, payload);

    case 'exportAllData':
      return exportAllData(actor, payload);

    /* ---------------- leads ---------------- */

    case 'createLead':
      return createEntity('Leads', payload, actor, validateLead, function (clean) {
        if (actor && !clean.OwnerRepId) clean.OwnerRepId = actor.ID;
        if (!clean.Status) clean.Status = 'New';
        return clean;
      });

    case 'updateLead':
      return updateEntity('Leads', payload, actor, 'updateLead', validateLead, canTransitionLead);

    case 'assignLead':
      return assignLead(actor, payload);

    case 'assignCloser':
      return assignCloser(actor, payload);

    case 'assignSetter':
      return assignSetter(actor, payload);

    case 'getTeamOverview':
      return getTeamOverview(actor, payload);

    case 'setUserTeam':
      return setUserTeam(actor, payload);

    case 'deleteLead':
      return deleteLead(actor, payload);

    case 'restoreLead':
      return restoreLead(actor, payload);

    case 'getDeletedLeads':
      return getDeletedLeads(actor, payload);

    case 'completeFollowUp':
      return completeFollowUp(actor, payload);

    case 'cancelFollowUp':
      return cancelFollowUp(actor, payload);

    case 'explainFollowUpDelay':
      return explainFollowUpDelay(actor, payload);

    case 'convertLead':
      return convertLead(actor, payload);

    /* ---------------- deals ---------------- */

    case 'createDeal':
      return createEntity('Deals', payload, actor, validateDeal, function (clean) {
        if (actor && !clean.OwnerRepId) clean.OwnerRepId = actor.ID;
        if (!clean.Status) clean.Status = 'Open';
        if (clean.LeadId && !getRecordByIdRaw('Leads', clean.LeadId)) {
          throw new ApiError('VALIDATION_FAILED', 'That lead does not exist.');
        }
        // One lead, at most one deal — the same invariant convertLead holds.
        if (clean.LeadId && findDealForLead(clean.LeadId)) {
          throw new ApiError('DUPLICATE', 'That lead already has a deal.');
        }
        return clean;
      });

    case 'updateDeal':
      return updateDealCompat(payload, actor);

    case 'markDealWon':
      return markDealWon(actor, payload);

    case 'markDealLost':
      return markDealLost(actor, payload);

    case 'reviseCommission':
      return reviseCommission(actor, payload);

    /* ---------------- projects ---------------- */

    case 'createProject':
      return createEntity('Projects', payload, actor, validateProject, function (clean) {
        if (!clean.Status) clean.Status = 'Onboarding';
        return clean;
      });

    case 'updateProject':
      return updateEntity('Projects', payload, actor, 'updateProject',
                          validateProject, canTransitionProject);

    /* ---------------- admin requests ---------------- */

    case 'createAdminRequest':
      return createEntity('AdminRequests', payload, actor, validateAdminRequest, function (clean) {
        if (actor) clean.RequestedBy = actor.ID;   // never client-supplied
        if (!clean.Status) clean.Status = 'Pending';
        return clean;
      });

    case 'updateAdminRequest':
      return updateEntity('AdminRequests', payload, actor, 'updateAdminRequest',
                          validateAdminRequest, canTransitionRequest);

    case 'approveRequest':
      return approveRequest(actor, payload);

    case 'rejectRequest':
      return rejectRequest(actor, payload);

    /* ---------------- finance ---------------- */

    case 'processCommission':
      return processCommission(actor, payload);

    /* ---------------- users ---------------- */

    case 'createUser':
      return createUserAccount(actor, payload);

    case 'updateUser':
      return updateUserAccount(actor, payload);

    case 'deactivateUser':
      return deactivateUser(actor, payload);

    case 'setAvailability':
      if (!actor) throw new ApiError('UNAUTHENTICATED', 'Sign in first.');
      return updateUserAccount(actor, { id: actor.ID, Availability: payload.availability });

    case 'setTimeZone':
      if (!actor) throw new ApiError('UNAUTHENTICATED', 'Sign in first.');
      return setUserTimeZone(actor, payload);

    /* ---------------- logs ---------------- */

    case 'createLog':
      return createAuditEntry(payload, actor);

    /* ---------------- zoho ---------------- */

    case 'getZohoAuthUrl':
      return buildZohoAuthUrl(actor, payload);

    case 'linkZoho':
      return linkZoho(actor, payload);

    case 'unlinkZoho':
      return unlinkZoho(actor, payload);

    case 'getZohoEmails':
      return getZohoEmails(actor, payload);

    case 'sendZohoEmail':
      return sendZohoEmail(actor, payload);

    case 'getStoredEmails':
      return getStoredEmails(actor, payload);

    case 'getEmailObservations':
      return getEmailObservations(actor, payload);

    case 'getSignaturePreview':
      return getSignaturePreview(actor, payload);

    case 'recordObservationFetch':
      return recordObservationFetch(payload);

    case 'getEmailContent':
      return getEmailContent(actor, payload);

    case 'saveEmailDraft':
      return saveEmailDraft(actor, payload);

    case 'getEmailDrafts':
      return getEmailDrafts(actor, payload);

    case 'deleteEmailDraft':
      return deleteEmailDraft(actor, payload);

    case 'syncMailbox':
      return syncMailbox(actor, payload);

    case 'syncAllMailboxes':
      return syncAllMailboxesAction(actor, payload);

    case 'getEmailAnalytics':
      return getEmailAnalytics(actor, payload);

    case 'getUnmatchedEmails':
      return getUnmatchedEmails(actor, payload);

    default:
      throw new ApiError('UNKNOWN_ACTION', 'Unknown action: ' + action);
  }
}

/* ================================================================== *
 * Generic entity handlers
 * ================================================================== */

function createEntity(sheetName, payload, actor, validator, prepare) {
  var clean = filterWritableFields(sheetName, payload, actor ? actor.role : null);
  if (prepare) clean = prepare(clean);

  var check = validator(clean);
  if (!check.ok) throw new ApiError('VALIDATION_FAILED', check.errors[0].message, check.errors);

  var created = withLock(function () {
    if (sheetName === 'Leads') {
      var existingLeads = getRecordsRaw('Leads');
      var cleanEmail = bareAddress(clean.Email);
      for (var i = 0; i < existingLeads.length; i++) {
        if (isDeletedRow(existingLeads[i])) continue;
        var exEmail = bareAddress(existingLeads[i].Email);
        if (cleanEmail && exEmail && cleanEmail === exEmail) {
          throw new ApiError('DUPLICATE', 'A lead with email ' + clean.Email + ' already exists.');
        }
      }
    }
    return appendRecordRaw(sheetName, clean);
  }, 'create' + sheetName);

  auditLog({
    entityId: created.ID, entityType: singular(sheetName), action: 'CREATED',
    userId: actor ? actor.ID : 'ANONYMOUS',
    details: singular(sheetName) + ' created.'
  });

  return stripInternal(created);
}

function updateEntity(sheetName, payload, actor, action, validator, transitionCheck) {
  var id = String(payload.id || payload.ID || '');
  if (!id) throw new ApiError('BAD_REQUEST', 'An id is required.');

  return withLock(function () {
    var existing = getScopedRecordById(sheetName, id, action, actor);

    var patch = filterWritableFields(sheetName, payload, actor ? actor.role : null, 'update');
    if (!Object.keys(patch).length) {
      throw new ApiError('BAD_REQUEST',
        'No updatable fields were supplied, or none you have permission to change.');
    }

    var check = validator(patch, { partial: true });
    if (!check.ok) throw new ApiError('VALIDATION_FAILED', check.errors[0].message, check.errors);

    if (patch.Status !== undefined && transitionCheck) {
      var verdict = transitionCheck(existing.Status, patch.Status);
      if (!verdict.allowed) throw new ApiError('ILLEGAL_TRANSITION', verdict.reason);
    }

    // Moving a long-overdue follow-up date requires saying why. May add the
    // explanation to the patch, so it runs before `before` is captured.
    var explainedDelay = sheetName === 'Leads' &&
      guardStaleReschedule(existing, patch, payload, actor);

    var before = {};
    for (var k in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) before[k] = existing[k];
    }

    // Who last revised the qualification record, stamped server-side so it
    // cannot be back-dated by the client.
    var isResearch = sheetName === 'Leads' && (
      patch.ResearchFindings !== undefined ||
      patch.QualificationReason !== undefined ||
      patch.ResearchSource !== undefined
    );
    if (isResearch) {
      patch.ResearchUpdatedAt = new Date().toISOString();
      patch.ResearchUpdatedBy = actor ? actor.ID : 'SYSTEM';
    }

    var updated = updateRecordRaw(sheetName, id, patch);

    // A status move is the thing people actually read in the history, so it
    // gets its own action and a sentence that says what changed. Everything
    // else is a generic UPDATED entry.
    //
    // This is the ONLY place an update is logged. The client used to write a
    // second STATUS_CHANGE of its own, which produced two rows for one edit.
    var isStatusChange = patch.Status !== undefined && patch.Status !== before.Status;

    // A rescheduled stale follow-up is filed under its own action so managers
    // can find every slip and its stated reason, rather than reading them out
    // of generic UPDATED rows.
    var action2 = isStatusChange  ? 'STATUS_CHANGE'
                : explainedDelay  ? 'FOLLOWUP_DELAYED'
                : isResearch      ? 'RESEARCH_UPDATED'
                                  : 'UPDATED';

    auditLog({
      entityId: id, entityType: singular(sheetName),
      action: action2,
      userId: actor ? actor.ID : 'ANONYMOUS',
      details: isStatusChange
        ? 'Status changed from ' + (before.Status || 'none') + ' to ' + patch.Status + '.'
        : explainedDelay
        ? 'Follow-up moved from ' + (before.NextFollowUp || 'none') + ' to ' +
          patch.NextFollowUp + ': ' + patch.FollowUpDelayReason
        : isResearch
        ? 'Research and qualification notes updated.'
        : singular(sheetName) + ' updated: ' + Object.keys(patch).join(', ') + '.',
      contactMode: payload.contactMode,
      metadata: { before: before, after: patch }
    });

    return stripInternal(updated);
  }, 'update' + sheetName);
}

/**
 * Backwards compatibility for the existing frontend.
 *
 * The current DealsPage still calls updateDeal with Status:'Won'. Routing
 * that through markDealWon means even the un-upgraded client gets the
 * atomic, idempotent, audited path instead of the old five-call sequence.
 */
function updateDealCompat(payload, actor) {
  var requested = payload.Status || payload.status;

  if (requested === 'Won') {
    var wonVerdict = roleMayCallAction(actor ? actor.role : null, 'markDealWon');
    if (actor && !wonVerdict.allowed) throw new ApiError('FORBIDDEN', wonVerdict.reason);
    return markDealWon(actor, {
      dealId: payload.id || payload.ID,
      setterId: payload.SetterId, closerId: payload.CloserId,
      setterAmount: payload.SetterAmount, closerAmount: payload.CloserAmount
    });
  }

  if (requested === 'Lost') {
    return markDealLost(actor, { dealId: payload.id || payload.ID });
  }

  return updateEntity('Deals', payload, actor, 'updateDeal', validateDeal, canTransitionDeal);
}

/**
 * Audit entries are append-only and always attributed to the authenticated
 * caller. A client can no longer forge the actor by sending userId.
 */
function createAuditEntry(payload, actor) {
  var entry = {
    entityId: payload.EntityId || payload.entityId || '',
    entityType: payload.EntityType || payload.entityType || '',
    action: payload.Action || payload.action || 'NOTE',
    userId: actor ? actor.ID : String(payload.UserId || payload.userId || 'ANONYMOUS'),
    details: payload.Details || payload.details || '',
    metadata: payload.Metadata || payload.metadata || '',
    // Structured channel for the interaction, validated against CONTACT_MODES.
    contactMode: payload.ContactMode || payload.contactMode || ''
  };
  auditLog(entry);
  return { ok: true };
}

/**
 * Log visibility follows record visibility: a rep sees history for entities
 * they own, managers see their team, SUPER_ADMIN sees everything.
 */
function scopedLogs(entityId, actor, window) {
  var logs = getLogs(entityId, window);
  if (!actor) return logs;

  var scope = effectiveScope(actor, 'getLogs');
  if (scope === 'all') return stripAll(logs);

  var teamOf = makeTeamResolver();
  installRoleResolver();
  var visible = [];

  for (var i = 0; i < logs.length; i++) {
    var log = logs[i];
    if (String(log.UserId) === String(actor.ID)) { visible.push(log); continue; }

    var entity = resolveLogEntity(log);
    if (!entity.record) continue;
    if (canAccessRecord(scope, entity.sheet, entity.record, actor, teamOf)) {
      visible.push(log);
    }
  }
  return stripAll(visible);
}

function resolveLogEntity(log) {
  var map = {
    Lead: 'Leads', Deal: 'Deals', Project: 'Projects',
    User: 'Users', Commission: 'Commissions', AdminRequest: 'AdminRequests'
  };
  var sheet = map[String(log.EntityType)];
  if (!sheet) return { sheet: null, record: null };
  return { sheet: sheet, record: getRecordByIdRaw(sheet, log.EntityId) };
}

/* ================================================================== *
 * Helpers
 * ================================================================== */

function stripAll(rows) {
  if (!rows) return [];
  var out = [];
  for (var i = 0; i < rows.length; i++) out.push(stripInternal(rows[i]));
  return out;
}

function singular(sheetName) {
  if (sheetName === 'AdminRequests') return 'AdminRequest';
  return sheetName.replace(/s$/, '');
}
