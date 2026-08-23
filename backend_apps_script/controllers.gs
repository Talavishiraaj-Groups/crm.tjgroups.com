/**
 * TJGROUPS CRM - Storage & Business Operations
 *
 *   PART 1 - STORAGE
 *     Google Sheets access: per-request read caching, batched row writes,
 *     script locking, and permission-scoped reads.
 *
 *   PART 2 - BUSINESS OPERATIONS
 *     Multi-step transactions (mark a deal won, convert a lead, settle a
 *     payout, approve a request, manage accounts). These run entirely
 *     server-side, under a lock, and are idempotent wherever money or
 *     record creation is involved.
 *
 * They live in one file because every operation in PART 2 is written
 * directly against PART 1 and the two are always deployed and reasoned about
 * together. Splitting them produced a file boundary with no dependency
 * boundary behind it.
 */

/* ================================================================== *
 * ==================        PART 1: STORAGE        ================== *
 * ================================================================== */
/* ================================================================== *
 * Sheet handles
 * ================================================================== */

var __sheetHandleCache = {};
var __recordCache = {};

function resetRequestCaches() {
  __sheetHandleCache = {};
  __recordCache = {};
}

function invalidateSheetCache(sheetName) {
  delete __recordCache[sheetName];
}

function getSheetByName(sheetName) {
  if (__sheetHandleCache[sheetName]) return __sheetHandleCache[sheetName];

  var dbFolderId = PropertiesService.getScriptProperties().getProperty('DB_FOLDER_ID');
  if (!dbFolderId) {
    throw new ApiError('STORAGE_ERROR',
      'Database not initialised. Run setupCRMDatabase() from the Apps Script editor.');
  }

  var folder;
  try {
    folder = DriveApp.getFolderById(dbFolderId);
  } catch (e) {
    throw new ApiError('STORAGE_ERROR', 'Database folder is unreachable: ' + e.message);
  }

  var files = folder.getFilesByName(sheetName);
  if (!files.hasNext()) {
    throw new ApiError('STORAGE_ERROR', 'Database sheet "' + sheetName + '" not found.');
  }

  var sheet = SpreadsheetApp.openById(files.next().getId()).getActiveSheet();
  __sheetHandleCache[sheetName] = sheet;
  return sheet;
}

/* ================================================================== *
 * Reads
 * ================================================================== */

/**
 * All rows of a sheet as objects. Cached for the lifetime of the request.
 *
 * Storage failures propagate as STORAGE_ERROR — they are never converted
 * into an empty array, because "the database is down" and "there are no
 * records" must remain distinguishable all the way to the UI.
 */
function getRecordsRaw(sheetName) {
  if (__recordCache[sheetName]) return __recordCache[sheetName];

  var sheet = getSheetByName(sheetName);
  var data;
  try {
    data = sheet.getDataRange().getValues();
  } catch (e) {
    throw new ApiError('STORAGE_ERROR',
      'Failed reading "' + sheetName + '": ' + e.message);
  }

  if (!data || data.length <= 1) {
    __recordCache[sheetName] = [];
    return [];
  }

  var headers = data[0];
  var out = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    // Skip fully blank rows — clearContent() leaves these behind.
    var blank = true;
    for (var c = 0; c < row.length; c++) {
      if (row[c] !== '' && row[c] !== null && row[c] !== undefined) { blank = false; break; }
    }
    if (blank) continue;

    var obj = {};
    for (var h = 0; h < headers.length; h++) {
      if (!headers[h]) continue;
      // Undo the formula-injection guard on the way out.
      //
      // Values beginning + = - @ are stored with a leading apostrophe so
      // Sheets treats them as text. Real Sheets hides that apostrophe on
      // read, but relying on that would mean the API returns different
      // strings depending on where it runs — and phone numbers here start
      // with "+", so a stray apostrophe would reach the UI.
      obj[headers[h]] = desanitiseCell(row[h]);
    }
    obj.__rowIndex = i + 1; // 1-based sheet row, saves a re-scan on update
    out.push(obj);
  }

  __recordCache[sheetName] = out;
  return out;
}

function getRecordByIdRaw(sheetName, id) {
  if (!id) return null;
  var target = String(id);
  var rows = getRecordsRaw(sheetName);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].ID) === target) return rows[i];
  }
  return null;
}

/* ================================================================== *
 * Writes
 * ================================================================== */

/**
 * Append a row. Values are sanitised against formula injection first.
 * Server-owned fields (ID / CreatedAt / UpdatedAt) are stamped here.
 */
function appendRecordRaw(sheetName, payload) {
  var sheet = getSheetByName(sheetName);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  var record = sanitiseRecord(payload);
  if (!record.ID) record.ID = Utilities.getUuid();
  var stamp = new Date().toISOString();
  if (headers.indexOf('CreatedAt') !== -1 && !record.CreatedAt) record.CreatedAt = stamp;
  if (headers.indexOf('UpdatedAt') !== -1) record.UpdatedAt = stamp;

  var row = [];
  for (var i = 0; i < headers.length; i++) {
    var h = headers[i];
    row.push(record[h] !== undefined ? record[h] : '');
  }

  try {
    sheet.appendRow(row);
  } catch (e) {
    throw new ApiError('STORAGE_ERROR',
      'Failed writing to "' + sheetName + '": ' + e.message);
  }

  invalidateSheetCache(sheetName);
  delete record.__rowIndex;
  return record;
}

/**
 * Patch an existing row.
 *
 * Writes the entire row in ONE setValues() call. The original implementation
 * issued a separate setValue() per column, which multiplied both latency and
 * quota consumption and left a partially-updated row if it failed midway.
 */
function updateRecordRaw(sheetName, id, patch) {
  if (!id) throw new ApiError('BAD_REQUEST', 'An id is required to update a record.');

  var sheet = getSheetByName(sheetName);
  var data;
  try {
    data = sheet.getDataRange().getValues();
  } catch (e) {
    throw new ApiError('STORAGE_ERROR', 'Failed reading "' + sheetName + '": ' + e.message);
  }

  var headers = data[0];
  var idCol = headers.indexOf('ID');
  if (idCol === -1) {
    throw new ApiError('STORAGE_ERROR', 'Sheet "' + sheetName + '" has no ID column.');
  }

  var rowIndex = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(id)) { rowIndex = i; break; }
  }
  if (rowIndex === -1) {
    throw new ApiError('NOT_FOUND',
      'Record ' + id + ' was not found in ' + sheetName + '.');
  }

  var clean = sanitiseRecord(patch);
  var next = data[rowIndex].slice();

  for (var c = 0; c < headers.length; c++) {
    var header = headers[c];
    if (!header) continue;
    if (header === 'ID' || header === 'CreatedAt') continue;   // immutable
    if (clean[header] === undefined) continue;
    next[c] = clean[header];
  }

  var updatedCol = headers.indexOf('UpdatedAt');
  if (updatedCol !== -1) next[updatedCol] = new Date().toISOString();

  // Pad so setValues never receives a short row.
  while (next.length < headers.length) next.push('');

  try {
    sheet.getRange(rowIndex + 1, 1, 1, headers.length).setValues([next.slice(0, headers.length)]);
  } catch (e) {
    throw new ApiError('STORAGE_ERROR',
      'Failed writing to "' + sheetName + '": ' + e.message);
  }

  invalidateSheetCache(sheetName);

  var result = {};
  for (var k = 0; k < headers.length; k++) {
    if (headers[k]) result[headers[k]] = next[k];
  }
  return result;
}

function deleteRecordRaw(sheetName, id) {
  var sheet = getSheetByName(sheetName);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var idCol = headers.indexOf('ID');
  if (idCol === -1) throw new ApiError('STORAGE_ERROR', 'No ID column in ' + sheetName);

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(id)) {
      sheet.deleteRow(i + 1);
      invalidateSheetCache(sheetName);
      return { status: 'deleted', id: id };
    }
  }
  throw new ApiError('NOT_FOUND', 'Record ' + id + ' not found in ' + sheetName + '.');
}

/* ================================================================== *
 * Locking
 * ================================================================== */

var LOCK_TIMEOUT_MS = 20000;

/**
 * Run `fn` under the script lock.
 *
 * Every read-modify-write and every multi-sheet business transaction must be
 * wrapped in this. Without it, two concurrent "mark won" executions can both
 * observe status=Open and both write a commission.
 */
function withLock(fn, label) {
  var lock = LockService.getScriptLock();
  var acquired = false;
  try {
    acquired = lock.tryLock(LOCK_TIMEOUT_MS);
  } catch (e) {
    acquired = false;
  }

  if (!acquired) {
    throw new ApiError('LOCK_TIMEOUT',
      'The system is busy processing another change' +
      (label ? ' (' + label + ')' : '') + '. Please retry.');
  }

  try {
    // Another execution may have mutated the sheets while we waited.
    resetRequestCaches();
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/* ================================================================== *
 * Backwards-compatible aliases
 *
 * The original function names are retained so any code or editor-run helper
 * that calls them keeps working.
 * ================================================================== */

function getRecords(sheetName)          { return getRecordsRaw(sheetName); }
function getRecordById(sheetName, id)   { return getRecordByIdRaw(sheetName, id); }
function createRecord(sheetName, payload) { return appendRecordRaw(sheetName, payload); }
function updateRecord(sheetName, id, payload) { return updateRecordRaw(sheetName, id, payload); }
function deleteRecord(sheetName, id)    { return deleteRecordRaw(sheetName, id); }

/* ================================================================== *
 * Scoped reads
 * ================================================================== */

/** userId -> Team, memoised per request. */
function makeTeamResolver() {
  var map = null;
  return function (userId) {
    if (!map) {
      map = {};
      var users = getRecordsRaw('Users');
      for (var i = 0; i < users.length; i++) {
        map[String(users[i].ID)] = users[i].Team;
      }
    }
    return map[String(userId)] || null;
  };
}

/**
 * Install a userId -> role lookup for the visibility rules.
 *
 * The domain layer in utils.gs is pure by design — no SpreadsheetApp — so it
 * cannot read Users itself. This injects the lookup for the duration of a
 * scoped read, the same pattern as makeTeamResolver.
 */
function installRoleResolver() {
  var map = null;
  ROLE_OF_USER = function (userId) {
    if (!map) {
      map = {};
      var users = getRecordsRaw('Users');
      for (var i = 0; i < users.length; i++) {
        map[String(users[i].ID)] = users[i].Role;
      }
    }
    return map[String(userId)] || null;
  };
  return ROLE_OF_USER;
}

/**
 * Read a sheet through the caller's permission scope.
 *
 * This is the function that replaces the frontend `.filter(...)` calls in
 * services.ts. Filtering now happens before data leaves the server, so
 * changing a role in localStorage cannot widen what is returned.
 */
/**
 * The record scope applied to this caller.
 *
 * Team membership is data, not configuration: a SUPER_ADMIN decides who sits
 * on which team from the Team Management panel, and an ADMIN sees exactly the
 * people assigned to theirs. There is deliberately no script property that
 * widens a manager's reach, because a permission boundary buried in a
 * settings page is one nobody reviews.
 */
function effectiveScope(actor, action) {
  return scopeForAction(actor ? actor.role : null, action);
}

function getScopedRecords(sheetName, action, actor, options) {
  var rows = getRecordsRaw(sheetName);

  // Soft-deleted rows are hidden everywhere by default. They still exist in
  // the sheet and in DeletedLeads; they simply stop appearing in the CRM.
  if (sheetName === 'Leads' && !(options && options.includeDeleted)) {
    var visible = [];
    for (var d = 0; d < rows.length; d++) {
      if (!isDeletedRow(rows[d])) visible.push(rows[d]);
    }
    rows = visible;
  }

  // Rollout mode with no session: preserve legacy behaviour.
  if (!actor) return rows;

  var scope = effectiveScope(actor, action);
  if (scope === 'all') return rows;
  if (scope === 'none') return [];

  var teamOf = makeTeamResolver();
  installRoleResolver();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (canAccessRecord(scope, sheetName, rows[i], actor, teamOf)) out.push(rows[i]);
  }
  return out;
}

/**
 * Fetch one record and assert the caller may see it.
 * Returns NOT_FOUND rather than FORBIDDEN so the endpoint cannot be used to
 * probe which IDs exist.
 */
function getScopedRecordById(sheetName, id, action, actor, options) {
  var row = getRecordByIdRaw(sheetName, id);
  if (!row) throw new ApiError('NOT_FOUND', 'Record not found.');

  // A deleted lead reads as absent unless the caller explicitly asks for it
  // (restore and the archive view do).
  if (sheetName === 'Leads' && isDeletedRow(row) && !(options && options.includeDeleted)) {
    throw new ApiError('NOT_FOUND', 'Record not found.');
  }

  if (!actor) return row;

  var scope = effectiveScope(actor, action);
  var teamOf = makeTeamResolver();
  installRoleResolver();
  if (!canAccessRecord(scope, sheetName, row, actor, teamOf)) {
    auditLog({
      entityId: id, entityType: sheetName, action: 'ACCESS_DENIED',
      userId: actor.ID, details: 'Attempted ' + action + ' on out-of-scope record.'
    });
    throw new ApiError('NOT_FOUND', 'Record not found.');
  }
  return row;
}

/* ================================================================== *
 * Aggregates
 * ================================================================== */

function getFinancialKPIs() {
  var deals = getRecordsRaw('Deals');
  var commissions = getRecordsRaw('Commissions');

  var totalValue = 0;
  for (var i = 0; i < deals.length; i++) {
    if (normaliseDealStatus(deals[i].Status) === 'Won') {
      totalValue += Number(deals[i].Value || 0);
    }
  }

  var totalCommissions = 0, payoutsPending = 0, payoutsPaid = 0;
  for (var j = 0; j < commissions.length; j++) {
    var c = commissions[j];
    var amount = Number(c.SetterAmount || 0) + Number(c.CloserAmount || 0);
    totalCommissions += amount;
    if (c.PayoutStatus === 'Paid') payoutsPaid += amount;
    else payoutsPending += amount;
  }

  return {
    totalValue: totalValue,
    totalCommissions: totalCommissions,
    payoutsPending: payoutsPending,
    payoutsPaid: payoutsPaid
  };
}

/**
 * Audit history. Sorted newest-first.
 * `entityId` omitted returns the global feed (managers only — enforced by
 * the router's scope policy).
 */
/**
 * Log rows, newest first.
 *
 * @param {string} [entityId]  restrict to one entity
 * @param {object} [window]    { fromTime, untilTime } as epoch ms
 *
 * The window matters for cost, not just correctness. The daily feed wants one
 * calendar day out of the whole history; discarding the rest here means the
 * sort and the per-row permission resolution that follow only ever run over
 * that day. Without it both ran over every row the CRM has ever written, which
 * grows without bound while the answer stays the same size.
 */
function getLogs(entityId, window) {
  var all = getRecordsRaw('Logs');
  var fromTime = window && window.fromTime != null ? window.fromTime : null;
  var untilTime = window && window.untilTime != null ? window.untilTime : null;
  // An action filter is a payload saving, not a security control. Screens want
  // one or two kinds of entry — daily summaries, meetings; without this they
  // pulled every row the CRM has ever written and discarded 99% of them in the
  // browser, over a connection that is the slowest part of the system.
  //
  // A comma-separated list is accepted so a screen needing two kinds still
  // makes one request rather than two.
  var wantActions = null;
  if (window && window.action) {
    wantActions = {};
    var names = String(window.action).split(',');
    for (var n = 0; n < names.length; n++) {
      var wanted = names[n].replace(/^\s+|\s+$/g, '');
      if (wanted) wantActions[wanted] = true;
    }
  }

  var out = [];
  for (var i = 0; i < all.length; i++) {
    var row = all[i];
    if (entityId && String(row.EntityId) !== String(entityId)) continue;
    if (wantActions && !wantActions[String(row.Action)]) continue;

    if (fromTime !== null || untilTime !== null) {
      var t = Date.parse(String(row.Timestamp || ''));
      if (isNaN(t)) continue;
      if (fromTime !== null && t < fromTime) continue;
      if (untilTime !== null && t >= untilTime) continue;
    }
    out.push(row);
  }

  out.sort(function (a, b) {
    return Date.parse(b.Timestamp || 0) - Date.parse(a.Timestamp || 0);
  });
  return out;
}


/* ================================================================== *
 * ===========      PART 2: BUSINESS OPERATIONS      ================= *
 * ================================================================== */
/* ================================================================== *
 * Deals
 * ================================================================== */

/**
 * Mark a deal Won and generate its commission, exactly once.
 *
 * INVARIANT: a deal has at most one commission record. Replaying this call —
 * double click, retried fetch, browser refresh mid-request — returns the
 * existing commission instead of creating another.
 */
function markDealWon(actor, payload) {
  payload = payload || {};
  var dealId = String(payload.dealId || payload.id || '');
  if (!dealId) throw new ApiError('BAD_REQUEST', 'dealId is required.');

  return withLock(function () {
    var deal = getRecordByIdRaw('Deals', dealId);
    if (!deal) throw new ApiError('NOT_FOUND', 'Deal not found.');

    var existing = findCommissionForDeal(dealId);
    var currentStatus = normaliseDealStatus(deal.Status);

    // ---- Idempotent replay ----
    if (currentStatus === 'Won' && existing) {
      return {
        deal: stripInternal(deal),
        commission: stripInternal(existing),
        idempotent: true,
        message: 'Deal was already won; existing commission returned.'
      };
    }

    // ---- Transition check ----
    if (currentStatus !== 'Won') {
      var verdict = canTransitionDeal(deal.Status, 'Won');
      if (!verdict.allowed) throw new ApiError('ILLEGAL_TRANSITION', verdict.reason);
    }

    // ---- Attribution ----
    var lead = deal.LeadId ? getRecordByIdRaw('Leads', deal.LeadId) : null;
    var setterId = String(payload.setterId || deal.SetterId ||
                          (lead && lead.SetterId) || (lead && lead.OwnerRepId) || '');
    var closerId = String(payload.closerId || deal.CloserId || deal.OwnerRepId || '');

    assertUserExists(setterId, 'Setter');
    assertUserExists(closerId, 'Closer');

    var split = computeCommission(deal.Value, {
      setterAmount: payload.setterAmount,
      closerAmount: payload.closerAmount
    });

    var commissionPayload = {
      DealId: dealId,
      SetterId: setterId,
      SetterAmount: split.setterAmount,
      CloserId: closerId,
      CloserAmount: split.closerAmount,
      PayoutStatus: 'Pending'
    };
    var check = validateCommission(commissionPayload);
    if (!check.ok) {
      throw new ApiError('VALIDATION_FAILED', check.errors[0].message, check.errors);
    }

    // ---- Write: deal first, then commission, then audit ----
    var updatedDeal = updateRecordRaw('Deals', dealId, {
      Status: 'Won',
      SetterId: setterId,
      CloserId: closerId
    });

    var commission;
    if (existing) {
      commission = existing; // status was not Won but a commission existed
    } else {
      try {
        commission = appendRecordRaw('Commissions', commissionPayload);
      } catch (err) {
        // Roll the deal back so we never leave "Won with no commission".
        updateRecordRaw('Deals', dealId, { Status: deal.Status });
        auditLog({
          entityId: dealId, entityType: 'Deal', action: 'WON_ROLLED_BACK',
          userId: actor ? actor.ID : 'SYSTEM',
          details: 'Commission write failed; deal status restored to ' + deal.Status +
                   '. Cause: ' + err.message
        });
        throw err;
      }
    }

    auditLog({
      entityId: dealId, entityType: 'Deal', action: 'DEAL_WON',
      userId: actor ? actor.ID : 'SYSTEM',
      details: 'Deal marked Won. Commission ' + commission.ID +
               ' setter=' + split.setterAmount + ' closer=' + split.closerAmount,
      metadata: {
        dealValue: Number(deal.Value || 0),
        setterId: setterId, closerId: closerId,
        exceedsDealValue: commissionExceedsDeal(deal.Value, split)
      }
    });

    return {
      deal: stripInternal(updatedDeal),
      commission: stripInternal(commission),
      idempotent: false
    };
  }, 'markDealWon');
}

function markDealLost(actor, payload) {
  payload = payload || {};
  var dealId = String(payload.dealId || payload.id || '');
  if (!dealId) throw new ApiError('BAD_REQUEST', 'dealId is required.');

  return withLock(function () {
    var deal = getRecordByIdRaw('Deals', dealId);
    if (!deal) throw new ApiError('NOT_FOUND', 'Deal not found.');

    var current = normaliseDealStatus(deal.Status);
    if (current === 'Lost') {
      return { deal: stripInternal(deal), idempotent: true };
    }

    var verdict = canTransitionDeal(deal.Status, 'Lost');
    if (!verdict.allowed) throw new ApiError('ILLEGAL_TRANSITION', verdict.reason);

    var updated = updateRecordRaw('Deals', dealId, { Status: 'Lost' });
    auditLog({
      entityId: dealId, entityType: 'Deal', action: 'DEAL_LOST',
      userId: actor ? actor.ID : 'SYSTEM',
      details: 'Deal marked Lost' + (payload.reason ? ': ' + payload.reason : '') + '.'
    });
    return { deal: stripInternal(updated), idempotent: false };
  }, 'markDealLost');
}

/**
 * Amend an existing commission.
 *
 * This exists so that correcting a payout is an explicit, audited revision
 * rather than a second commission row. It is what the "EDIT COMM" button in
 * DealsPage should have been calling all along — that button previously
 * re-ran the whole win flow and silently duplicated the record.
 */
function reviseCommission(actor, payload) {
  payload = payload || {};
  var dealId = String(payload.dealId || '');
  if (!dealId) throw new ApiError('BAD_REQUEST', 'dealId is required.');

  return withLock(function () {
    var commission = findCommissionForDeal(dealId);
    if (!commission) throw new ApiError('NOT_FOUND', 'No commission exists for this deal.');

    if (String(commission.PayoutStatus) === 'Paid') {
      throw new ApiError('CONFLICT',
        'This commission has already been paid and can no longer be revised.');
    }

    var deal = getRecordByIdRaw('Deals', dealId);
    var split = computeCommission(deal ? deal.Value : 0, {
      setterAmount: payload.setterAmount,
      closerAmount: payload.closerAmount
    });

    var setterId = String(payload.setterId || commission.SetterId);
    var closerId = String(payload.closerId || commission.CloserId);
    assertUserExists(setterId, 'Setter');
    assertUserExists(closerId, 'Closer');

    var before = {
      setterId: commission.SetterId, setterAmount: Number(commission.SetterAmount || 0),
      closerId: commission.CloserId, closerAmount: Number(commission.CloserAmount || 0)
    };

    var updated = updateRecordRaw('Commissions', commission.ID, {
      SetterId: setterId, SetterAmount: split.setterAmount,
      CloserId: closerId, CloserAmount: split.closerAmount
    });

    auditLog({
      entityId: commission.ID, entityType: 'Commission', action: 'COMMISSION_REVISED',
      userId: actor ? actor.ID : 'SYSTEM',
      details: 'Commission revised for deal ' + dealId + '.',
      metadata: { before: before, after: {
        setterId: setterId, setterAmount: split.setterAmount,
        closerId: closerId, closerAmount: split.closerAmount
      } }
    });

    return { commission: stripInternal(updated) };
  }, 'reviseCommission');
}

/**
 * Settle a payout. Idempotent: paying an already-paid commission is a no-op
 * rather than a silent second settlement.
 */
function processCommission(actor, payload) {
  payload = payload || {};
  var commissionId = String(payload.commissionId || payload.id || '');
  if (!commissionId) throw new ApiError('BAD_REQUEST', 'commissionId is required.');

  return withLock(function () {
    var commission = getRecordByIdRaw('Commissions', commissionId);
    if (!commission) throw new ApiError('NOT_FOUND', 'Commission not found.');

    if (String(commission.PayoutStatus) === 'Paid') {
      return {
        commission: stripInternal(commission),
        idempotent: true,
        message: 'Commission was already paid.'
      };
    }

    var verdict = canTransitionPayout(commission.PayoutStatus || 'Pending', 'Paid');
    if (!verdict.allowed) throw new ApiError('ILLEGAL_TRANSITION', verdict.reason);

    var updated = updateRecordRaw('Commissions', commissionId, {
      PayoutStatus: 'Paid',
      PayoutDate: new Date().toISOString()
    });

    auditLog({
      entityId: commissionId, entityType: 'Commission', action: 'PAYOUT_PROCESSED',
      userId: actor ? actor.ID : 'SYSTEM',
      details: 'Payout settled: setter ' + Number(commission.SetterAmount || 0) +
               ', closer ' + Number(commission.CloserAmount || 0) + '.',
      metadata: { dealId: commission.DealId }
    });

    return { commission: stripInternal(updated), idempotent: false };
  }, 'processCommission');
}

/* ================================================================== *
 * Leads
 * ================================================================== */

/**
 * Convert a lead into a deal atomically.
 *
 * Previously three independent client calls; a failure between them left a
 * deal with an unconverted lead, or a converted lead with no deal.
 */
function convertLead(actor, payload) {
  payload = payload || {};
  var leadId = String(payload.leadId || payload.id || '');
  var value = Number(payload.value);

  if (!leadId) throw new ApiError('BAD_REQUEST', 'leadId is required.');
  if (isNaN(value) || value < 0) {
    throw new ApiError('VALIDATION_FAILED', 'A non-negative deal value is required.');
  }

  return withLock(function () {
    var lead = getRecordByIdRaw('Leads', leadId);
    if (!lead) throw new ApiError('NOT_FOUND', 'Lead not found.');

    // INVARIANT: a lead has at most one deal.
    //
    // This is checked before the status check, because the two can disagree:
    // production data contains leads that already have a deal but were never
    // flipped to Converted (the old client-side flow could fail between the
    // two writes). Creating a second deal there would double-count pipeline
    // value and later produce two commissions.
    var existingDeal = findDealForLead(leadId);
    if (existingDeal) {
      if (String(lead.Status) !== 'Converted') {
        // Repair the half-finished conversion rather than duplicating.
        updateRecordRaw('Leads', leadId, { Status: 'Converted' });
        auditLog({
          entityId: leadId, entityType: 'Lead', action: 'CONVERSION_REPAIRED',
          userId: actor ? actor.ID : 'SYSTEM',
          details: 'Lead already had deal ' + existingDeal.ID +
                   ' but was still ' + lead.Status + '; status corrected.'
        });
      }
      return {
        lead: stripInternal(getRecordByIdRaw('Leads', leadId)),
        deal: stripInternal(existingDeal),
        idempotent: true,
        message: 'This lead already has a deal.'
      };
    }

    if (String(lead.Status) !== 'Converted') {
      var verdict = canTransitionLead(lead.Status, 'Converted');
      if (!verdict.allowed) throw new ApiError('ILLEGAL_TRANSITION', verdict.reason);
    }

    var ownerId = String(payload.ownerRepId || lead.OwnerRepId || (actor && actor.ID) || '');
    var dealPayload = {
      LeadId: leadId,
      Value: value,
      Status: 'Open',
      OwnerRepId: ownerId,
      SetterId: String(lead.SetterId || lead.OwnerRepId || ''),
      CloserId: String(lead.CloserId || ownerId)
    };

    var check = validateDeal(dealPayload);
    if (!check.ok) {
      throw new ApiError('VALIDATION_FAILED', check.errors[0].message, check.errors);
    }

    var deal = appendRecordRaw('Deals', dealPayload);

    try {
      updateRecordRaw('Leads', leadId, { Status: 'Converted' });
    } catch (err) {
      // Undo the deal so we never leave an orphan.
      try { deleteRecordRaw('Deals', deal.ID); } catch (e2) { /* best effort */ }
      auditLog({
        entityId: leadId, entityType: 'Lead', action: 'CONVERSION_ROLLED_BACK',
        userId: actor ? actor.ID : 'SYSTEM',
        details: 'Lead status write failed; created deal removed. Cause: ' + err.message
      });
      throw err;
    }

    auditLog({
      entityId: leadId, entityType: 'Lead', action: 'CONVERSION',
      userId: actor ? actor.ID : 'SYSTEM',
      details: 'Lead converted to deal ' + deal.ID + ' with value ' + value + '.',
      metadata: { dealId: deal.ID, value: value }
    });

    return {
      lead: stripInternal(getRecordByIdRaw('Leads', leadId)),
      deal: stripInternal(deal),
      idempotent: false
    };
  }, 'convertLead');
}

function assignLead(actor, payload) {
  payload = payload || {};
  var leadId = String(payload.leadId || payload.id || '');
  if (!leadId) throw new ApiError('BAD_REQUEST', 'leadId is required.');

  return withLock(function () {
    var lead = getRecordByIdRaw('Leads', leadId);
    if (!lead) throw new ApiError('NOT_FOUND', 'Lead not found.');

    var patch = {};
    ['OwnerRepId', 'SetterId', 'CloserId'].forEach(function (field) {
      var key = field.charAt(0).toLowerCase() + field.slice(1);
      if (payload[key] !== undefined) {
        var uid = String(payload[key] || '');
        if (uid) assertUserExists(uid, field);
        patch[field] = uid;
      }
    });

    if (!Object.keys(patch).length) {
      throw new ApiError('BAD_REQUEST', 'No assignment fields supplied.');
    }

    var before = {
      OwnerRepId: lead.OwnerRepId, SetterId: lead.SetterId, CloserId: lead.CloserId
    };
    var updated = updateRecordRaw('Leads', leadId, patch);

    auditLog({
      entityId: leadId, entityType: 'Lead', action: 'LEAD_REASSIGNED',
      userId: actor ? actor.ID : 'SYSTEM',
      details: 'Lead assignment changed.',
      metadata: { before: before, after: patch }
    });

    return { lead: stripInternal(updated) };
  }, 'assignLead');
}

/* ================================================================== *
 * Admin requests
 * ================================================================== */

function decideRequest(actor, payload, decision) {
  payload = payload || {};
  var requestId = String(payload.requestId || payload.id || '');
  if (!requestId) throw new ApiError('BAD_REQUEST', 'requestId is required.');

  return withLock(function () {
    var req = getRecordByIdRaw('AdminRequests', requestId);
    if (!req) throw new ApiError('NOT_FOUND', 'Request not found.');

    if (String(req.Status) === decision) {
      return { request: stripInternal(req), idempotent: true };
    }

    var verdict = canTransitionRequest(req.Status || 'Pending', decision);
    if (!verdict.allowed) throw new ApiError('ILLEGAL_TRANSITION', verdict.reason);

    var patch = { Status: decision };
    if (payload.paymentLink !== undefined) patch.PaymentLink = payload.paymentLink;
    if (payload.documentUrl !== undefined) patch.DocumentUrl = payload.documentUrl;
    if (payload.notes !== undefined) patch.Notes = payload.notes;

    var check = validateAdminRequest(patch, { partial: true });
    if (!check.ok) {
      throw new ApiError('VALIDATION_FAILED', check.errors[0].message, check.errors);
    }

    var updated = updateRecordRaw('AdminRequests', requestId, patch);

    auditLog({
      entityId: requestId, entityType: 'AdminRequest',
      action: decision === 'Approved' ? 'REQUEST_APPROVED' : 'REQUEST_REJECTED',
      userId: actor ? actor.ID : 'SYSTEM',
      details: 'Request ' + decision.toLowerCase() + '.',
      metadata: { relatedDealId: req.RelatedDealId, type: req.Type }
    });

    return { request: stripInternal(updated), idempotent: false };
  }, 'decideRequest');
}

function approveRequest(actor, payload) { return decideRequest(actor, payload, 'Approved'); }
function rejectRequest(actor, payload)  { return decideRequest(actor, payload, 'Rejected'); }

/* ================================================================== *
 * Users
 * ================================================================== */

/**
 * Create a user, with a password, in one transaction.
 * The original createUser accepted a Password field and silently discarded
 * it because the sheet had no such column.
 */
function createUserAccount(actor, payload) {
  payload = payload || {};

  var userPayload = filterWritableFields('Users', payload, actor ? actor.role : null);
  if (!userPayload.Status) userPayload.Status = 'Active';
  if (!userPayload.Availability) userPayload.Availability = 'Offline';

  var check = validateUser(userPayload);
  if (!check.ok) throw new ApiError('VALIDATION_FAILED', check.errors[0].message, check.errors);

  var password = payload.Password || payload.password;
  if (password) {
    var pw = validatePassword(password);
    if (!pw.ok) throw new ApiError('VALIDATION_FAILED', pw.errors[0].message, pw.errors);
  }

  return withLock(function () {
    var existing = getRecordsRaw('Users');
    for (var i = 0; i < existing.length; i++) {
      if (String(existing[i].Username).toLowerCase() ===
          String(userPayload.Username).toLowerCase()) {
        throw new ApiError('DUPLICATE', 'That username is already taken.');
      }
    }

    var created = appendRecordRaw('Users', userPayload);
    if (password) setUserPassword(created.ID, password);

    auditLog({
      entityId: created.ID, entityType: 'User', action: 'USER_CREATED',
      userId: actor ? actor.ID : 'SYSTEM',
      details: 'Created user ' + created.Username + ' with role ' + created.Role + '.'
    });

    return publicUser(getRecordByIdRaw('Users', created.ID));
  }, 'createUserAccount');
}

/**
 * Update a user. Role and status changes revoke live sessions so a
 * demotion or deactivation takes effect immediately.
 */
function updateUserAccount(actor, payload) {
  payload = payload || {};
  var userId = String(payload.id || payload.ID || '');
  if (!userId) throw new ApiError('BAD_REQUEST', 'A user id is required.');

  return withLock(function () {
    var target = getRecordByIdRaw('Users', userId);
    if (!target) throw new ApiError('NOT_FOUND', 'User not found.');

    // An ADMIN may not touch a SUPER_ADMIN account.
    if (actor && actor.role === 'ADMIN' && String(target.Role) === 'SUPER_ADMIN') {
      throw new ApiError('FORBIDDEN', 'Administrators cannot modify a Super Admin account.');
    }

    var patch = filterWritableFields('Users', payload, actor ? actor.role : null);
    var check = validateUser(patch, { partial: true });
    if (!check.ok) throw new ApiError('VALIDATION_FAILED', check.errors[0].message, check.errors);

    // Never allow the last active SUPER_ADMIN to be removed or demoted.
    var losingSuperAdmin =
      String(target.Role) === 'SUPER_ADMIN' &&
      ((patch.Role && patch.Role !== 'SUPER_ADMIN') ||
       (patch.Status && patch.Status !== 'Active'));

    if (losingSuperAdmin && countActiveSuperAdmins() <= 1) {
      throw new ApiError('CONFLICT',
        'This is the last active Super Admin; promote another before changing it.');
    }

    var before = {
      Role: target.Role, Status: target.Status, Team: target.Team, Username: target.Username
    };

    var updated = updateRecordRaw('Users', userId, patch);

    var password = payload.Password || payload.password;
    if (password) setUserPassword(userId, password);

    var securityRelevant =
      (patch.Role && patch.Role !== before.Role) ||
      (patch.Status && patch.Status !== before.Status) ||
      !!password;

    var revoked = 0;
    if (securityRelevant) revoked = revokeAllSessionsForUser(userId);

    auditLog({
      entityId: userId, entityType: 'User',
      action: patch.Status === 'Inactive' ? 'USER_DEACTIVATED' : 'USER_UPDATED',
      userId: actor ? actor.ID : 'SYSTEM',
      details: 'User updated' + (revoked ? '; ' + revoked + ' session(s) revoked' : '') + '.',
      metadata: { before: before, after: patch }
    });

    return publicUser(getRecordByIdRaw('Users', userId));
  }, 'updateUserAccount');
}

/**
 * Deactivate rather than delete, preserving historical ownership.
 * This is what the frontend's api.users.delete() should call; the old
 * `deleteUser` action never existed on the backend at all.
 */
function deactivateUser(actor, payload) {
  payload = payload || {};
  var userId = String(payload.id || payload.userId || '');
  if (!userId) throw new ApiError('BAD_REQUEST', 'A user id is required.');
  if (actor && String(actor.ID) === userId) {
    throw new ApiError('CONFLICT', 'You cannot deactivate your own account.');
  }
  return updateUserAccount(actor, { id: userId, Status: 'Inactive' });
}

function countActiveSuperAdmins() {
  var users = getRecordsRaw('Users');
  var n = 0;
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].Role) === 'SUPER_ADMIN' && String(users[i].Status) === 'Active') n++;
  }
  return n;
}

/* ================================================================== *
 * Helpers
 * ================================================================== */

function findCommissionForDeal(dealId) {
  var rows = getRecordsRaw('Commissions');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].DealId) === String(dealId)) return rows[i];
  }
  return null;
}

function findDealForLead(leadId) {
  var rows = getRecordsRaw('Deals');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].LeadId) === String(leadId)) return rows[i];
  }
  return null;
}

function assertUserExists(userId, label) {
  if (!userId) throw new ApiError('VALIDATION_FAILED', label + ' is required.');
  var u = getRecordByIdRaw('Users', userId);
  if (!u) throw new ApiError('VALIDATION_FAILED', label + ' is not a known user.');
  return u;
}

/** Drop the internal row pointer before anything leaves the server. */
function stripInternal(record) {
  if (!record) return record;
  var out = {};
  for (var k in record) {
    if (!Object.prototype.hasOwnProperty.call(record, k)) continue;
    if (k === '__rowIndex') continue;
    out[k] = record[k];
  }
  return out;
}

/* ================================================================== *
 * ============      PART 3: REPORTING & ASSIGNMENT      ============= *
 *
 * Added in the feature batch after the security hardening. Everything here
 * READS existing data or writes new, additive fields. Nothing regenerates,
 * replaces or deletes a historical record.
 * ================================================================== */

/* ------------------------------------------------------------------ *
 * Follow-up completion
 * ------------------------------------------------------------------ */

/**
 * Mark a lead's follow-up complete.
 *
 * This is a state transition owned by the backend, not a UI checkbox:
 *  - the transition is validated against FOLLOWUP_TRANSITIONS
 *  - completion is idempotent, so a double click or a retried request
 *    produces exactly one completion and one audit event
 *  - 'Overdue' is derived from NextFollowUp at read time, never stored
 */
function completeFollowUp(actor, payload) {
  payload = payload || {};
  var leadId = String(payload.leadId || payload.id || '');
  if (!leadId) throw new ApiError('BAD_REQUEST', 'leadId is required.');

  return withLock(function () {
    var lead = getScopedRecordById('Leads', leadId, 'completeFollowUp', actor);

    var current = String(lead.FollowUpStatus || '') || 'Planned';

    // Idempotent replay: already completed and no new follow-up scheduled.
    if (current === 'Completed') {
      return {
        lead: stripInternal(lead),
        idempotent: true,
        message: 'This follow-up was already marked complete.'
      };
    }

    var verdict = canTransitionFollowUp(current, 'Completed');
    if (!verdict.allowed) throw new ApiError('ILLEGAL_TRANSITION', verdict.reason);

    var now = new Date().toISOString();
    var patch = {
      FollowUpStatus: 'Completed',
      FollowUpCompletedAt: now,
      FollowUpCompletedBy: actor ? actor.ID : 'SYSTEM'
    };

    // Scheduling the next one is part of the same transaction when supplied.
    if (payload.nextFollowUp !== undefined) {
      var next = String(payload.nextFollowUp || '');
      if (next) {
        if (isNaN(Date.parse(next))) {
          throw new ApiError('VALIDATION_FAILED', 'nextFollowUp is not a valid date.');
        }
        patch.NextFollowUp = next;
        patch.FollowUpStatus = 'Planned';   // a fresh follow-up is now pending
        patch.FollowUpCompletedAt = now;    // but this one did complete
      } else {
        patch.NextFollowUp = '';
      }
    }

    var updated = updateRecordRaw('Leads', leadId, patch);

    auditLog({
      entityId: leadId, entityType: 'Lead', action: 'FOLLOWUP_COMPLETED',
      userId: actor ? actor.ID : 'SYSTEM',
      contactMode: payload.contactMode,
      details: 'Follow-up completed' +
               (payload.outcome ? ': ' + String(payload.outcome).slice(0, 500) : '.') +
               (patch.NextFollowUp ? ' Next follow-up ' + patch.NextFollowUp + '.' : ''),
      metadata: { previousDue: lead.NextFollowUp || '', nextDue: patch.NextFollowUp || '' }
    });

    return { lead: stripInternal(updated), idempotent: false };
  }, 'completeFollowUp');
}

/** Cancel a follow-up without claiming it was done. */
function cancelFollowUp(actor, payload) {
  payload = payload || {};
  var leadId = String(payload.leadId || payload.id || '');
  if (!leadId) throw new ApiError('BAD_REQUEST', 'leadId is required.');

  return withLock(function () {
    var lead = getScopedRecordById('Leads', leadId, 'completeFollowUp', actor);
    var current = String(lead.FollowUpStatus || '') || 'Planned';

    if (current === 'Cancelled') {
      return { lead: stripInternal(lead), idempotent: true };
    }

    var verdict = canTransitionFollowUp(current, 'Cancelled');
    if (!verdict.allowed) throw new ApiError('ILLEGAL_TRANSITION', verdict.reason);

    var updated = updateRecordRaw('Leads', leadId, { FollowUpStatus: 'Cancelled' });

    auditLog({
      entityId: leadId, entityType: 'Lead', action: 'FOLLOWUP_CANCELLED',
      userId: actor ? actor.ID : 'SYSTEM',
      details: 'Follow-up cancelled' +
               (payload.reason ? ': ' + String(payload.reason).slice(0, 500) : '.')
    });

    return { lead: stripInternal(updated), idempotent: false };
  }, 'cancelFollowUp');
}

/* ------------------------------------------------------------------ *
 * Closer assignment
 * ------------------------------------------------------------------ */

/**
 * Roles that may act as a closer.
 *
 * A SETTER is deliberately NOT eligible: a setter performs setter work and
 * does not automatically become the closer. A SALES_REP can run the whole
 * cycle, so it is eligible for both.
 */
var CLOSER_ELIGIBLE_ROLES = ['SALES_REP', 'ADMIN', 'SUPER_ADMIN'];
var SETTER_ELIGIBLE_ROLES = ['SETTER', 'SALES_REP', 'ADMIN', 'SUPER_ADMIN'];

/**
 * Explicitly assign the closer for a lead.
 *
 * Assignment is MANUAL by design. There is no round-robin, no least-loaded
 * pick, no automatic same-team fallback â€” an ADMIN or SUPER_ADMIN chooses.
 * Every previous assignment is preserved in the audit log rather than being
 * silently overwritten.
 */
function assignCloser(actor, payload) {
  payload = payload || {};
  var leadId = String(payload.leadId || payload.id || '');
  var closerId = String(payload.closerId || '');

  if (!leadId) throw new ApiError('BAD_REQUEST', 'leadId is required.');
  if (!closerId) throw new ApiError('BAD_REQUEST', 'closerId is required.');

  return withLock(function () {
    var lead = getRecordByIdRaw('Leads', leadId);
    if (!lead) throw new ApiError('NOT_FOUND', 'Lead not found.');

    var closer = getRecordByIdRaw('Users', closerId);
    if (!closer) throw new ApiError('VALIDATION_FAILED', 'That user does not exist.');
    if (String(closer.Status) !== 'Active') {
      throw new ApiError('VALIDATION_FAILED', 'A closer must be an active user.');
    }
    if (CLOSER_ELIGIBLE_ROLES.indexOf(String(closer.Role)) === -1) {
      throw new ApiError('VALIDATION_FAILED',
        'Role ' + closer.Role + ' cannot act as a closer. Eligible roles: ' +
        CLOSER_ELIGIBLE_ROLES.join(', ') + '.');
    }

    // Lifecycle: closing work only makes sense once the lead is qualified.
    // A converted lead already has a deal, so its closer is settled there.
    var leadStatus = String(lead.Status || '');
    if (leadStatus === 'Converted') {
      throw new ApiError('ILLEGAL_TRANSITION',
        'This lead is already converted; change the closer on the deal instead.');
    }
    if (leadStatus === 'Closed') {
      throw new ApiError('ILLEGAL_TRANSITION', 'This lead is closed.');
    }

    var previous = String(lead.CloserId || '');
    if (previous === closerId) {
      return { lead: stripInternal(lead), idempotent: true };
    }

    var updated = updateRecordRaw('Leads', leadId, { CloserId: closerId });

    auditLog({
      entityId: leadId, entityType: 'Lead',
      action: previous ? 'CLOSER_REASSIGNED' : 'CLOSER_ASSIGNED',
      userId: actor ? actor.ID : 'SYSTEM',
      details: (previous ? 'Closer reassigned' : 'Closer assigned') +
               ' to ' + closer.Username + '.',
      // Keeping both sides means reassignment history is never lost.
      metadata: {
        previousCloserId: previous,
        newCloserId: closerId,
        leadStatusAtAssignment: leadStatus
      }
    });

    return { lead: stripInternal(updated), idempotent: false };
  }, 'assignCloser');
}

/** Assign the setter, with the same validation discipline. */
function assignSetter(actor, payload) {
  payload = payload || {};
  var leadId = String(payload.leadId || payload.id || '');
  var setterId = String(payload.setterId || '');

  if (!leadId) throw new ApiError('BAD_REQUEST', 'leadId is required.');
  if (!setterId) throw new ApiError('BAD_REQUEST', 'setterId is required.');

  return withLock(function () {
    var lead = getRecordByIdRaw('Leads', leadId);
    if (!lead) throw new ApiError('NOT_FOUND', 'Lead not found.');

    var setter = getRecordByIdRaw('Users', setterId);
    if (!setter) throw new ApiError('VALIDATION_FAILED', 'That user does not exist.');
    if (String(setter.Status) !== 'Active') {
      throw new ApiError('VALIDATION_FAILED', 'A setter must be an active user.');
    }
    if (SETTER_ELIGIBLE_ROLES.indexOf(String(setter.Role)) === -1) {
      throw new ApiError('VALIDATION_FAILED',
        'Role ' + setter.Role + ' cannot act as a setter.');
    }

    var previous = String(lead.SetterId || '');
    if (previous === setterId) {
      return { lead: stripInternal(lead), idempotent: true };
    }

    var updated = updateRecordRaw('Leads', leadId, { SetterId: setterId });

    auditLog({
      entityId: leadId, entityType: 'Lead',
      action: previous ? 'SETTER_REASSIGNED' : 'SETTER_ASSIGNED',
      userId: actor ? actor.ID : 'SYSTEM',
      details: (previous ? 'Setter reassigned' : 'Setter assigned') +
               ' to ' + setter.Username + '.',
      metadata: { previousSetterId: previous, newSetterId: setterId }
    });

    return { lead: stripInternal(updated), idempotent: false };
  }, 'assignSetter');
}

/* ------------------------------------------------------------------ *
 * Team structure
 * ------------------------------------------------------------------ */

/**
 * Who is on which team, and what each manager can actually see.
 *
 * This exists because team scoping fails silently: a manager whose team name
 * matches nobody simply sees an empty CRM, with nothing on screen explaining
 * why. The overview makes the structure — and its gaps — visible to a
 * SUPER_ADMIN before anyone is locked out of their own pipeline.
 */
function getTeamOverview(actor, params) {
  var users = getRecordsRaw('Users');
  var leads = getRecordsRaw('Leads');

  var norm = function (t) { return String(t == null ? '' : t).trim().toLowerCase(); };

  var teams = {};
  var unassigned = [];

  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    if (!String(u.ID || '')) continue;

    var key = norm(u.Team);
    var member = {
      id: u.ID, username: u.Username, role: u.Role,
      status: u.Status, team: String(u.Team || '')
    };

    if (!key) {
      unassigned.push(member);
      continue;
    }

    if (!teams[key]) {
      teams[key] = { key: key, displayName: String(u.Team || '').trim(),
                     spellings: {}, members: [], managers: [], leadCount: 0 };
    }
    teams[key].spellings[String(u.Team || '').trim()] = true;
    teams[key].members.push(member);
    if (u.Role === 'ADMIN' || u.Role === 'SUPER_ADMIN') teams[key].managers.push(member);
  }

  // How many live leads each team actually owns.
  var teamOfUser = {};
  for (var t = 0; t < users.length; t++) teamOfUser[String(users[t].ID)] = norm(users[t].Team);

  var unassignedLeadCount = 0;
  for (var l = 0; l < leads.length; l++) {
    if (isDeletedRow(leads[l])) continue;
    var owners = ['OwnerRepId', 'SetterId', 'CloserId'];
    var counted = {};
    var anyTeam = false;
    for (var o = 0; o < owners.length; o++) {
      var uid = String(leads[l][owners[o]] || '');
      if (!uid) continue;
      var tk = teamOfUser[uid];
      if (tk && teams[tk] && !counted[tk]) {
        teams[tk].leadCount++;
        counted[tk] = true;
        anyTeam = true;
      }
    }
    if (!anyTeam) unassignedLeadCount++;
  }

  var out = [];
  var warnings = [];

  for (var k in teams) {
    if (!Object.prototype.hasOwnProperty.call(teams, k)) continue;
    var team = teams[k];
    var spellings = [];
    for (var s in team.spellings) {
      if (Object.prototype.hasOwnProperty.call(team.spellings, s) && s) spellings.push(s);
    }

    if (spellings.length > 1) {
      warnings.push('Team "' + team.displayName + '" is spelled ' + spellings.length +
                    ' different ways (' + spellings.join(', ') + '). They are treated ' +
                    'as one team, but tidying them up avoids confusion.');
    }
    if (team.managers.length === 0) {
      warnings.push('Team "' + team.displayName + '" has no manager — no ADMIN can ' +
                    'see its ' + team.leadCount + ' lead(s).');
    }

    out.push({
      name: team.displayName, key: team.key, spellings: spellings,
      memberCount: team.members.length, managerCount: team.managers.length,
      leadCount: team.leadCount,
      managers: team.managers, members: team.members
    });
  }

  out.sort(function (a, b) { return b.memberCount - a.memberCount; });

  if (unassigned.length) {
    var activeUnassigned = [];
    for (var q = 0; q < unassigned.length; q++) {
      if (unassigned[q].status === 'Active') activeUnassigned.push(unassigned[q].username);
    }
    if (activeUnassigned.length) {
      warnings.push(activeUnassigned.length + ' active user(s) have no team: ' +
                    activeUnassigned.join(', ') + '. Records they own are invisible ' +
                    'to every ADMIN.');
    }
  }

  return {
    teams: out,
    unassigned: unassigned,
    unassignedLeadCount: unassignedLeadCount,
    totalLeads: leads.length,
    warnings: warnings
  };
}

/**
 * Move a user onto a team. SUPER_ADMIN and ADMIN only, audited.
 *
 * Blank clears the assignment. Team names are stored as typed but compared
 * case-insensitively, so "Sales Team" and "Sales team" are one team.
 */
function setUserTeam(actor, payload) {
  payload = payload || {};
  var userId = String(payload.userId || payload.id || '');
  var team = String(payload.team == null ? '' : payload.team).trim();

  if (!userId) throw new ApiError('BAD_REQUEST', 'A user id is required.');
  if (team.length > 60) throw new ApiError('VALIDATION_FAILED', 'Team name is too long.');

  return withLock(function () {
    var target = getRecordByIdRaw('Users', userId);
    if (!target) throw new ApiError('NOT_FOUND', 'User not found.');

    if (actor && actor.role === 'ADMIN' && String(target.Role) === 'SUPER_ADMIN') {
      throw new ApiError('FORBIDDEN', 'Administrators cannot reassign a Super Admin.');
    }

    var before = String(target.Team || '');
    if (before.trim() === team) {
      return { user: publicUser(target), idempotent: true };
    }

    updateRecordRaw('Users', userId, { Team: team });

    auditLog({
      entityId: userId, entityType: 'User', action: 'TEAM_CHANGED',
      userId: actor ? actor.ID : 'SYSTEM',
      details: '@' + target.Username + ' moved from "' + (before || 'no team') +
               '" to "' + (team || 'no team') + '".',
      metadata: { before: before, after: team }
    });

    return { user: publicUser(getRecordByIdRaw('Users', userId)), idempotent: false };
  }, 'setUserTeam');
}

/* ------------------------------------------------------------------ *
 * Lead deletion (soft, archived, reversible)
 * ------------------------------------------------------------------ */

/** A row is considered deleted when the flag is exactly 'TRUE'. */
function isDeletedRow(row) {
  return isTrueFlag(row && row.Deleted);
}

/**
 * Delete a lead.
 *
 * WHAT "DELETE" MEANS HERE
 * ------------------------
 * The Leads row is FLAGGED, never moved and never cleared. A separate
 * DeletedLeads row records who deleted it, when, why, and a full snapshot of
 * the values at that moment.
 *
 * Moving the row into an archive sheet would match the phrase "deleted
 * database" more literally, but a move is a delete plus an insert: if the
 * insert fails the record is gone. Flag-and-archive cannot lose data, and it
 * makes restore trivial.
 *
 * A lead that has become a deal is NOT deletable — the deal, its commission
 * and the audit trail all reference it.
 */
function deleteLead(actor, payload) {
  payload = payload || {};
  var leadId = String(payload.leadId || payload.id || '');
  var reason = String(payload.reason || '').slice(0, 500);

  if (!leadId) throw new ApiError('BAD_REQUEST', 'leadId is required.');

  return withLock(function () {
    var lead = getRecordByIdRaw('Leads', leadId);
    if (!lead) throw new ApiError('NOT_FOUND', 'Lead not found.');

    if (isDeletedRow(lead)) {
      return { lead: stripInternal(lead), idempotent: true,
               message: 'This lead was already deleted.' };
    }

    // Referential integrity: never orphan a deal.
    var deal = findDealForLead(leadId);
    if (deal) {
      throw new ApiError('CONFLICT',
        'This lead has been converted to a deal (' + deal.ID + ') and cannot be ' +
        'deleted. Deleting it would leave the deal, and any commission on it, ' +
        'pointing at a record that no longer exists.');
    }

    var now = new Date().toISOString();

    // Archive FIRST. If this write fails, nothing has been marked deleted.
    appendRecordRaw('DeletedLeads', {
      LeadId: leadId,
      LeadName: lead.Name || '',
      DeletedAt: now,
      DeletedBy: actor ? actor.ID : 'SYSTEM',
      DeletedByUsername: actor ? actor.Username : 'SYSTEM',
      Reason: reason,
      Snapshot: JSON.stringify(stripInternal(lead)),
      RestoredAt: '',
      RestoredBy: ''
    });

    var updated = updateRecordRaw('Leads', leadId, {
      Deleted: 'TRUE',
      DeletedAt: now,
      DeletedBy: actor ? actor.ID : 'SYSTEM',
      DeleteReason: reason
    });

    auditLog({
      entityId: leadId, entityType: 'Lead', action: 'LEAD_DELETED',
      userId: actor ? actor.ID : 'SYSTEM',
      details: 'Lead "' + (lead.Name || leadId) + '" deleted' +
               (reason ? ': ' + reason : '.'),
      metadata: { leadName: lead.Name || '', reason: reason }
    });

    return { lead: stripInternal(updated), idempotent: false };
  }, 'deleteLead');
}

/** Undo a deletion. The row was never removed, so this just clears the flag. */
function restoreLead(actor, payload) {
  payload = payload || {};
  var leadId = String(payload.leadId || payload.id || '');
  if (!leadId) throw new ApiError('BAD_REQUEST', 'leadId is required.');

  return withLock(function () {
    var lead = getRecordByIdRaw('Leads', leadId);
    if (!lead) throw new ApiError('NOT_FOUND', 'Lead not found.');

    if (!isDeletedRow(lead)) {
      return { lead: stripInternal(lead), idempotent: true,
               message: 'This lead is not deleted.' };
    }

    var updated = updateRecordRaw('Leads', leadId, {
      Deleted: '', DeletedAt: '', DeletedBy: '', DeleteReason: ''
    });

    // Close out the most recent archive entry rather than removing it: the
    // deletion still happened and remains part of the history.
    var archive = getRecordsRaw('DeletedLeads');
    for (var i = archive.length - 1; i >= 0; i--) {
      if (String(archive[i].LeadId) === leadId && !archive[i].RestoredAt) {
        updateRecordRaw('DeletedLeads', archive[i].ID, {
          RestoredAt: new Date().toISOString(),
          RestoredBy: actor ? actor.ID : 'SYSTEM'
        });
        break;
      }
    }

    auditLog({
      entityId: leadId, entityType: 'Lead', action: 'LEAD_RESTORED',
      userId: actor ? actor.ID : 'SYSTEM',
      details: 'Lead "' + (lead.Name || leadId) + '" restored.'
    });

    return { lead: stripInternal(updated), idempotent: false };
  }, 'restoreLead');
}

/** The deleted-leads archive, newest first. */
function getDeletedLeads(actor, params) {
  params = params || {};
  var rows = getRecordsRaw('DeletedLeads');
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    if (!params.includeRestored && rows[i].RestoredAt) continue;
    out.push(rows[i]);
  }

  out.sort(function (a, b) {
    return Date.parse(b.DeletedAt || 0) - Date.parse(a.DeletedAt || 0);
  });

  return stripAll(out);
}

/**
 * Set the caller's own timezone.
 *
 * Validated against the platform, so a typo cannot silently shift someone's
 * day boundary. Setting it blank reverts to the organisation default.
 */
function setUserTimeZone(actor, payload) {
  payload = payload || {};
  var tz = String(payload.timeZone || payload.tz || '').trim();

  if (tz && !isValidTimeZone(tz)) {
    throw new ApiError('VALIDATION_FAILED',
      '"' + tz + '" is not a recognised IANA timezone (for example Asia/Kolkata, Europe/London).');
  }

  var before = getRecordByIdRaw('Users', actor.ID);
  updateRecordRaw('Users', actor.ID, { TimeZone: tz });

  auditLog({
    entityId: actor.ID, entityType: 'User', action: 'TIMEZONE_CHANGED',
    userId: actor.ID,
    details: 'Timezone set to ' + (tz || 'the organisation default') + '.',
    metadata: { before: before ? String(before.TimeZone || '') : '', after: tz }
  });

  return {
    timeZone: tz || getCrmTimeZone(),
    usingOrganisationDefault: !tz
  };
}

/* ------------------------------------------------------------------ *
 * Activity feed
 * ------------------------------------------------------------------ */

/** The organisation's default timezone. */
function getCrmTimeZone() {
  return PropertiesService.getScriptProperties().getProperty('CRM_TIMEZONE') ||
         Session.getScriptTimeZone() || 'Etc/UTC';
}

/**
 * The timezone a given request should be reckoned in.
 *
 * The team is distributed, so a personal view ("my follow-ups today", "my
 * activity today") must use the VIEWER's calendar day. A rep in Manila
 * starting their Tuesday should not be shown Monday's work because the server
 * happens to run elsewhere.
 *
 * Precedence:
 *   1. an explicit timeZone on the request (the browser's detected zone)
 *   2. the zone stored on the user's account
 *   3. the organisation default (CRM_TIMEZONE)
 *
 * Organisation-wide reporting deliberately does NOT use this — see
 * getAnalytics, which pins one zone so totals are comparable.
 */
function resolveTimeZone(actor, params) {
  params = params || {};

  var requested = String(params.timeZone || params.tz || '').trim();
  if (requested && isValidTimeZone(requested)) return requested;

  if (actor) {
    var row = getRecordByIdRaw('Users', actor.ID);
    var personal = row ? String(row.TimeZone || '').trim() : '';
    if (personal && isValidTimeZone(personal)) return personal;
  }

  return getCrmTimeZone();
}

/**
 * Validate an IANA zone by asking Apps Script to format a date in it.
 * An unknown zone throws, so a bad value can never silently shift a boundary.
 */
function isValidTimeZone(tz) {
  if (!tz || String(tz).length > 64) return false;
  if (!/^[A-Za-z0-9_+\-\/]+$/.test(tz)) return false;
  try {
    Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Start of a calendar day in the CRM timezone, as an ISO instant.
 *
 * Deliberately a CALENDAR DAY, not "the last 24 hours" â€” the two are
 * different and mixing them makes a feed impossible to reason about.
 */
function startOfCrmDay(offsetDays, timeZone) {
  var tz = timeZone || getCrmTimeZone();
  var now = new Date();
  var target = new Date(now.getTime() - (offsetDays || 0) * 86400000);
  // Format the wall-clock date in the CRM zone, then take midnight of it.
  var stamp = Utilities.formatDate(target, tz, "yyyy-MM-dd'T'00:00:00XXX");
  var parsed = Date.parse(stamp);
  return isNaN(parsed) ? new Date(target.setHours(0, 0, 0, 0)).toISOString()
                       : new Date(parsed).toISOString();
}

/**
 * Activity for a single calendar day (today by default).
 *
 * Nothing is deleted: older activity stays in Logs and is still reachable via
 * getLogs with an explicit range. This only changes what the feed DISPLAYS.
 */
function getActivityFeed(actor, params) {
  params = params || {};

  // Reckon days in the VIEWER's calendar, not the server's.
  var tz = resolveTimeZone(actor, params);

  var limit = Number(params.limit);
  if (isNaN(limit) || limit < 1 || limit > 500) limit = 100;

  var from, until, scope;

  // An explicit date (YYYY-MM-DD) returns exactly that calendar day, which is
  // what the dashboard's day-by-day navigation asks for. Without one, the
  // window runs back `days` calendar days from today.
  var wanted = String(params.date || '').trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(wanted)) {
    from = startOfNamedDay(wanted, tz);
    until = new Date(Date.parse(from) + 86400000).toISOString();
    scope = wanted;
  } else {
    var days = Number(params.days);
    if (isNaN(days) || days < 0 || days > 365) days = 0;   // 0 = today only
    from = startOfCrmDay(days, tz);
    until = null;                                          // up to now
    scope = days === 0 ? 'today' : 'last ' + (days + 1) + ' calendar days';
  }

  var fromTime = Date.parse(from);
  var untilTime = until ? Date.parse(until) : null;

  // The window goes IN, so the sort and the per-row permission checks only
  // ever run over the day being asked for.
  var all = scopedLogs(null, actor, { fromTime: fromTime, untilTime: untilTime });

  var out = [];
  var total = all.length;
  for (var i = 0; i < all.length && out.length < limit; i++) {
    out.push(all[i]);                            // scopedLogs is newest-first
  }

  return {
    from: from,
    until: until,
    date: /^\d{4}-\d{2}-\d{2}$/.test(wanted) ? wanted : todayInZone(tz),
    timeZone: tz,
    timeZoneSource: tz === getCrmTimeZone() ? 'organisation default' : 'viewer',
    scope: scope,
    count: out.length,
    total: total,
    truncated: total > out.length,
    entries: out
  };
}

/** Midnight of a named calendar day (YYYY-MM-DD) in a zone, as an instant. */
function startOfNamedDay(dateStr, timeZone) {
  var tz = timeZone || getCrmTimeZone();
  // Probe midday on that date to sidestep DST edges, then take its midnight.
  var probe = new Date(dateStr + 'T12:00:00Z');
  var stamp = Utilities.formatDate(probe, tz, "yyyy-MM-dd'T'00:00:00XXX");
  // formatDate may land on the previous/next day for far-offset zones; rebuild
  // the boundary from the requested date rather than the probe's own date.
  var offset = stamp.slice(-6);
  var iso = dateStr + 'T00:00:00' + (offset === 'Z' || offset.indexOf(':') === -1 ? 'Z' : offset);
  var parsed = Date.parse(iso);
  return isNaN(parsed) ? new Date(dateStr + 'T00:00:00Z').toISOString()
                       : new Date(parsed).toISOString();
}

/** Today's calendar date (YYYY-MM-DD) in a zone. */
function todayInZone(timeZone) {
  return Utilities.formatDate(new Date(), timeZone || getCrmTimeZone(), 'yyyy-MM-dd');
}

/* ------------------------------------------------------------------ *
 * Productivity metrics
 * ------------------------------------------------------------------ */

/**
 * Per-user productivity, computed from structured CRM events only.
 *
 * METRIC DEFINITIONS â€” every one is counted from a durable record, never
 * inferred from UI activity:
 *
 *   leadsCreated        Logs where Action=CREATED and EntityType=Lead
 *   leadsOwned          Leads rows where OwnerRepId = user (current state)
 *   followUpsCompleted  Logs where Action=FOLLOWUP_COMPLETED
 *   dealsCreated        Logs where Action=CREATED and EntityType=Deal
 *   dealsWon            Logs where Action=DEAL_WON
 *   dealsLost           Logs where Action=DEAL_LOST
 *   conversions         Logs where Action=CONVERSION
 *   emailsSent          Logs where Action=EMAIL_SENT
 *   contactEvents       Logs carrying a non-empty ContactMode
 *   asSetter/asCloser   Commissions rows attributing the user
 *
 * DOUBLE COUNTING: idempotent replays of markDealWon, processCommission,
 * convertLead and completeFollowUp return early WITHOUT writing a second
 * audit row, so retries cannot inflate these counts. This is asserted by
 * the productivity tests.
 *
 * LIMITATIONS:
 *   - Counts start when the audit action was introduced. Actions added in
 *     this upgrade (FOLLOWUP_COMPLETED, EMAIL_SENT with ContactMode) have no
 *     history before the migration.
 *   - leadsOwned is CURRENT ownership, not ownership during the window;
 *     reassignment moves the credit.
 */
function getProductivity(actor, params) {
  params = params || {};
  var days = Number(params.days);
  if (isNaN(days) || days < 0 || days > 3650) days = 30;
  // A person's own numbers are counted against their own calendar day.
  var tz = resolveTimeZone(actor, params);
  var from = startOfCrmDay(days, tz);
  var fromTime = Date.parse(from);

  var users = getRecordsRaw('Users');
  var logs = getRecordsRaw('Logs');
  var leads = getRecordsRaw('Leads');
  var deals = getRecordsRaw('Deals');
  var commissions = getRecordsRaw('Commissions');

  // Only report on users the caller may see.
  var scope = effectiveScope(actor, 'getProductivity');
  var teamOf = makeTeamResolver();
  installRoleResolver();
  var visible = {};
  for (var u = 0; u < users.length; u++) {
    var row = users[u];
    // For 'own' scope this resolves to the caller's own row only, because
    // OWNERSHIP_FIELDS.Users is ['ID']; for 'team' it resolves to the
    // caller's team. Do NOT add a team fallback here — an earlier draft did,
    // and it leaked colleagues' figures to an individual rep.
    if (!actor || scope === 'all' ||
        canAccessRecord(scope, 'Users', row, actor, teamOf)) {
      visible[String(row.ID)] = {
        userId: row.ID, username: row.Username, role: row.Role, team: row.Team || '',
        status: row.Status,
        leadsCreated: 0, followUpsCompleted: 0, dealsCreated: 0,
        dealsWon: 0, dealsLost: 0, conversions: 0, emailsSent: 0,
        contactEvents: 0, contactByMode: {},
        leadsOwned: 0, openLeads: 0, asSetter: 0, asCloser: 0,
        commissionEarned: 0
      };
    }
  }

  var ACTION_FIELD = {
    'FOLLOWUP_COMPLETED': 'followUpsCompleted',
    'DEAL_WON': 'dealsWon',
    'DEAL_LOST': 'dealsLost',
    'CONVERSION': 'conversions',
    'EMAIL_SENT': 'emailsSent'
  };

  for (var i = 0; i < logs.length; i++) {
    var log = logs[i];
    var ts = Date.parse(String(log.Timestamp || ''));
    if (isNaN(ts) || ts < fromTime) continue;

    var bucket = visible[String(log.UserId)];
    if (!bucket) continue;

    var action = String(log.Action || '');
    if (action === 'CREATED') {
      if (String(log.EntityType) === 'Lead') bucket.leadsCreated++;
      else if (String(log.EntityType) === 'Deal') bucket.dealsCreated++;
    } else if (ACTION_FIELD[action]) {
      bucket[ACTION_FIELD[action]]++;
    }

    var mode = String(log.ContactMode || '').trim();
    if (mode) {
      bucket.contactEvents++;
      bucket.contactByMode[mode] = (bucket.contactByMode[mode] || 0) + 1;
    }
  }

  for (var l = 0; l < leads.length; l++) {
    var lb = visible[String(leads[l].OwnerRepId)];
    if (!lb) continue;
    lb.leadsOwned++;
    var st = String(leads[l].Status || '');
    if (st !== 'Converted' && st !== 'Closed') lb.openLeads++;
  }

  for (var c = 0; c < commissions.length; c++) {
    var comm = commissions[c];
    var sb = visible[String(comm.SetterId)];
    if (sb) { sb.asSetter++; sb.commissionEarned += Number(comm.SetterAmount || 0); }
    var cb = visible[String(comm.CloserId)];
    if (cb) { cb.asCloser++; cb.commissionEarned += Number(comm.CloserAmount || 0); }
  }

  var out = [];
  for (var key in visible) {
    if (Object.prototype.hasOwnProperty.call(visible, key)) out.push(visible[key]);
  }
  out.sort(function (a, b) {
    return (b.dealsWon - a.dealsWon) || (b.followUpsCompleted - a.followUpsCompleted);
  });

  return {
    from: from,
    days: days,
    timeZone: tz,
    timeZoneSource: tz === getCrmTimeZone() ? 'organisation default' : 'viewer',
    contactModeTrackingSince: getContactModeTrackingSince(),
    users: out,
    totals: {
      users: out.length,
      deals: deals.length,
      leads: leads.length
    }
  };
}

/* ------------------------------------------------------------------ *
 * Super-admin analytics
 * ------------------------------------------------------------------ */

/**
 * Organisation-wide analytics.
 *
 * Every figure is derived from stored records. Where the underlying field did
 * not exist before the migration, the response says so explicitly rather
 * than presenting a partial count as complete.
 */
function getAnalytics(actor, params) {
  params = params || {};
  var days = Number(params.days);
  if (isNaN(days) || days < 0 || days > 3650) days = 30;
  var from = startOfCrmDay(days);
  var fromTime = Date.parse(from);

  var logs = getRecordsRaw('Logs');
  var leads = getRecordsRaw('Leads');
  var deals = getRecordsRaw('Deals');
  var commissions = getRecordsRaw('Commissions');
  var projects = getRecordsRaw('Projects');
  var requests = getRecordsRaw('AdminRequests');

  var trackingSince = getContactModeTrackingSince();
  var trackingTime = trackingSince ? Date.parse(trackingSince) : null;

  var contactByMode = {};
  var contactTracked = 0;
  var activityUntracked = 0;
  var activityPredatingTracking = 0;
  var actionCounts = {};
  var emailsSent = 0;
  var perDay = {};

  for (var i = 0; i < logs.length; i++) {
    var log = logs[i];
    var ts = Date.parse(String(log.Timestamp || ''));
    if (isNaN(ts) || ts < fromTime) continue;

    var action = String(log.Action || '');
    actionCounts[action] = (actionCounts[action] || 0) + 1;
    if (action === 'EMAIL_SENT') emailsSent++;

    var day = String(log.Timestamp).slice(0, 10);
    perDay[day] = (perDay[day] || 0) + 1;

    var mode = String(log.ContactMode || '').trim();
    if (mode) {
      contactTracked++;
      contactByMode[mode] = (contactByMode[mode] || 0) + 1;
    } else {
      // Count EVERY event without a channel, whenever it happened.
      //
      // An earlier version only counted events dated before the tracking
      // start, which reported "complete: true" against a database full of
      // rows that predate the field in FORM rather than in date - imported
      // history, and anything the old backend wrote. Both are gaps.
      activityUntracked++;
      if (trackingTime === null || ts < trackingTime) activityPredatingTracking++;
    }
  }

  var leadsByStatus = {};
  var followUpByState = {};
  var nowIso = new Date().toISOString();
  for (var l = 0; l < leads.length; l++) {
    var s = String(leads[l].Status || 'Unknown');
    leadsByStatus[s] = (leadsByStatus[s] || 0) + 1;
    var fs = followUpState(leads[l], nowIso);
    followUpByState[fs] = (followUpByState[fs] || 0) + 1;
  }

  var dealsByStatus = {};
  var wonValue = 0, openValue = 0;
  for (var d = 0; d < deals.length; d++) {
    var ds = normaliseDealStatus(deals[d].Status) || 'Unknown';
    dealsByStatus[ds] = (dealsByStatus[ds] || 0) + 1;
    var v = Number(deals[d].Value || 0);
    if (ds === 'Won') wonValue += v;
    else if (ds === 'Open') openValue += v;
  }

  var payoutByStatus = {};
  var commissionTotal = 0;
  for (var c = 0; c < commissions.length; c++) {
    var ps = String(commissions[c].PayoutStatus || 'Pending');
    payoutByStatus[ps] = (payoutByStatus[ps] || 0) + 1;
    commissionTotal += Number(commissions[c].SetterAmount || 0) +
                       Number(commissions[c].CloserAmount || 0);
  }

  var projectsByStatus = {};
  for (var p = 0; p < projects.length; p++) {
    var prs = normaliseProjectStatus(projects[p].Status) || 'Unknown';
    projectsByStatus[prs] = (projectsByStatus[prs] || 0) + 1;
  }

  var requestsByStatus = {};
  for (var r = 0; r < requests.length; r++) {
    var rs = String(requests[r].Status || 'Pending');
    requestsByStatus[rs] = (requestsByStatus[rs] || 0) + 1;
  }

  var wonCount = dealsByStatus['Won'] || 0;
  var lostCount = dealsByStatus['Lost'] || 0;
  var decided = wonCount + lostCount;

  return {
    window: { from: from, days: days, timeZone: getCrmTimeZone() },

    contactMode: {
      // The honest header: analytics available FROM this date, not before.
      trackingSince: trackingSince,
      trackedEvents: contactTracked,
      byMode: contactByMode,
      // Everything with no channel recorded, and the subset of that which is
      // older than tracking itself. Reported separately so a reader can tell
      // "we had not started collecting this yet" apart from "this event type
      // does not carry a channel".
      eventsWithoutMode: activityUntracked,
      activityPredatingTracking: activityPredatingTracking,
      complete: trackingSince !== null && activityUntracked === 0,
      note: trackingSince
        ? 'Structured contact-mode data exists from ' + trackingSince +
          '. Earlier activity was recorded without a contact-mode field and is ' +
          'reported separately as activityPredatingTracking.'
        : 'Structured contact-mode tracking has not started. Run migrateDatabase().'
    },

    email: {
      sent: emailsSent,
      source: 'Logs rows with Action=EMAIL_SENT, written when the backend ' +
              'actually hands a message to Zoho â€” not inferred from UI clicks.',
      trackedFrom: trackingSince
    },

    pipeline: {
      leadsByStatus: leadsByStatus,
      followUpByState: followUpByState,
      dealsByStatus: dealsByStatus,
      wonValue: wonValue,
      openValue: openValue,
      winRate: decided > 0 ? Math.round((wonCount / decided) * 1000) / 10 : null,
      winRateNote: decided > 0 ? null : 'No decided deals in this window.'
    },

    finance: {
      commissionRecords: commissions.length,
      commissionTotal: commissionTotal,
      payoutByStatus: payoutByStatus
    },

    delivery: { projectsByStatus: projectsByStatus },
    requests: { byStatus: requestsByStatus },
    activity: { byAction: actionCounts, byDay: perDay }
  };
}

/* ------------------------------------------------------------------ *
 * Full export
 * ------------------------------------------------------------------ */

/**
 * Export the whole CRM.
 *
 * - reads every sheet in DATABASE_SCHEMA (the authoritative entity set)
 * - preserves IDs and relational references exactly
 * - NEVER mutates anything
 * - strips every secret: password hashes/salts, session token hashes,
 *   Zoho refresh tokens, and the Sessions sheet in its entirety
 */
var EXPORT_EXCLUDED_SHEETS = ['Sessions'];

var EXPORT_EXCLUDED_COLUMNS = [
  'PasswordHash', 'PasswordSalt', 'PasswordIterations',
  'ZohoRefreshToken', 'TokenHash', 'FailedLoginCount', 'LockedUntil'
];

function exportAllData(actor, params) {
  params = params || {};
  var includeLogs = params.includeLogs === false ? false : true;

  var entities = {};
  var counts = {};
  var redacted = {};

  for (var sheetName in DATABASE_SCHEMA) {
    if (!Object.prototype.hasOwnProperty.call(DATABASE_SCHEMA, sheetName)) continue;
    if (EXPORT_EXCLUDED_SHEETS.indexOf(sheetName) !== -1) continue;
    if (sheetName === 'Logs' && !includeLogs) continue;

    var rows = getRecordsRaw(sheetName);
    var sheet = getSheetByName(sheetName);
    var lastCol = sheet.getLastColumn();
    var headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];

    var keptHeaders = [];
    var dropped = [];
    for (var h = 0; h < headers.length; h++) {
      var name = String(headers[h] || '');
      if (!name) continue;
      if (EXPORT_EXCLUDED_COLUMNS.indexOf(name) !== -1) dropped.push(name);
      else keptHeaders.push(name);
    }
    if (dropped.length) redacted[sheetName] = dropped;

    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var rec = {};
      for (var k = 0; k < keptHeaders.length; k++) {
        var col = keptHeaders[k];
        var value = rows[i][col];
        rec[col] = value === undefined || value === null ? '' : desanitiseCell(value);
      }
      out.push(rec);
    }

    entities[sheetName] = { headers: keptHeaders, records: out };
    counts[sheetName] = out.length;
  }

  auditLog({
    entityId: 'SYSTEM', entityType: 'System', action: 'DATA_EXPORTED',
    userId: actor ? actor.ID : 'SYSTEM',
    details: 'Full CRM export generated.',
    metadata: counts
  });

  return {
    exportedAt: new Date().toISOString(),
    exportedBy: actor ? actor.Username : 'SYSTEM',
    timeZone: getCrmTimeZone(),
    schemaVersion: 2,
    counts: counts,
    redactedColumns: redacted,
    excludedSheets: EXPORT_EXCLUDED_SHEETS,
    contactModeTrackingSince: getContactModeTrackingSince(),
    entities: entities
  };
}

