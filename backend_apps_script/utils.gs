/**
 * TJGROUPS CRM - Shared Foundations
 *
 * This file has no dependencies on request handling or business
 * transactions, so it is loaded first and everything else may rely on it.
 *
 * It holds two things:
 *
 *   PART 1 - DOMAIN RULES
 *     The single source of truth for business vocabulary: roles, statuses,
 *     legal state transitions, the permission matrix, validation and
 *     sanitisation. Every function in this part is PURE - no SpreadsheetApp,
 *     no PropertiesService, no UrlFetchApp - which is what lets the local
 *     harness execute the real rules without Google services.
 *
 *   PART 2 - API INFRASTRUCTURE
 *     Response envelopes, the structured error model, and the audit writer.
 *
 * These live together because both are leaf concerns consumed by every other
 * file, and splitting them bought file count rather than clarity.
 * If a business rule is not defined in PART 1, it should not exist anywhere.
 */

/* ================================================================== *
 * ================        PART 1: DOMAIN RULES        =============== *
 * ================================================================== */
/* ================================================================== *
 * 1. VOCABULARY
 * ================================================================== */

var ROLES = ['SUPER_ADMIN', 'ADMIN', 'SALES_REP', 'SETTER'];

var USER_STATUSES = ['Active', 'Inactive'];
var AVAILABILITIES = ['Available', 'Busy', 'Offline'];

var LEAD_STATUSES = ['New', 'Contacted', 'Qualified', 'Converted', 'Closed'];
var DEAL_STATUSES = ['Open', 'Won', 'Lost'];
var PROJECT_STATUSES = ['Onboarding', 'InProgress', 'Completed'];
var PAYOUT_STATUSES = ['Pending', 'Processing', 'Paid'];
var REQUEST_TYPES = ['payment', 'paperwork'];
var REQUEST_STATUSES = [
  'Pending', 'Approved', 'Rejected',
  'Sent', 'Paid', 'Failed',            // payment lifecycle
  'Drafting', 'Signed', 'Archived'     // paperwork lifecycle
];

/**
 * Structured contact channel for an interaction.
 *
 * Previously the channel was only ever implied by free text in Logs.Details,
 * so it could not be counted. This is the validated vocabulary going forward;
 * historical rows legitimately have no value and must not be back-filled.
 */
var CONTACT_MODES = ['CALL', 'WHATSAPP', 'EMAIL', 'OTHER'];

/**
 * Follow-up lifecycle.
 *
 * 'Planned' is the implied state of every existing lead that has a
 * NextFollowUp date, which is why it is the default rather than a value we
 * have to write into historical rows. 'Overdue' is DERIVED from the date at
 * read time, never stored, so a row cannot become stale.
 */
var FOLLOWUP_STATUSES = ['Planned', 'Completed', 'Cancelled'];

var FOLLOWUP_TRANSITIONS = {
  'Planned':   ['Completed', 'Cancelled'],
  'Completed': ['Planned'],   // a new follow-up may be scheduled afterwards
  'Cancelled': ['Planned']
};

function canTransitionFollowUp(from, to) {
  var f = String(from == null || from === '' ? 'Planned' : from).trim();
  return checkTransition(FOLLOWUP_TRANSITIONS, f, to, 'follow-up');
}

/**
 * Derive the display state of a lead's follow-up.
 * Overdue is computed, never persisted.
 */
function followUpState(lead, nowIso) {
  var stored = String(lead.FollowUpStatus || '') || 'Planned';
  if (stored !== 'Planned') return stored;
  var due = String(lead.NextFollowUp || '').trim();
  if (!due) return 'None';
  var dueTime = Date.parse(due);
  if (isNaN(dueTime)) return 'Planned';
  var now = Date.parse(nowIso || new Date().toISOString());
  return dueTime < now ? 'Overdue' : 'Planned';
}

/**
 * Legacy status values that exist in production data (written by seed.mjs
 * and by earlier versions of the UI). We must READ them without corrupting
 * the record, but never allow them to be WRITTEN going forward.
 */
var LEGACY_DEAL_STATUS_MAP = {
  'Closed Won': 'Won',
  'Closed Lost': 'Lost',
  'Proposal Sent': 'Open',
  'Negotiation': 'Open',
  'In Progress': 'Open'
};

var LEGACY_PROJECT_STATUS_MAP = {
  'In Progress': 'InProgress',
  'Complete': 'Completed'
};

function normaliseDealStatus(value) {
  var v = String(value == null ? '' : value).trim();
  if (DEAL_STATUSES.indexOf(v) !== -1) return v;
  if (LEGACY_DEAL_STATUS_MAP[v]) return LEGACY_DEAL_STATUS_MAP[v];
  return v; // unknown; caller decides whether that is fatal
}

function normaliseProjectStatus(value) {
  var v = String(value == null ? '' : value).trim();
  if (PROJECT_STATUSES.indexOf(v) !== -1) return v;
  if (LEGACY_PROJECT_STATUS_MAP[v]) return LEGACY_PROJECT_STATUS_MAP[v];
  return v;
}

/* ================================================================== *
 * 2. STATE MACHINES
 * ================================================================== */

var LEAD_TRANSITIONS = {
  'New':       ['Contacted', 'Qualified', 'Closed'],
  'Contacted': ['Qualified', 'Closed', 'New'],
  'Qualified': ['Converted', 'Closed', 'Contacted'],
  'Converted': [],            // terminal: a converted lead owns a deal
  'Closed':    ['New']        // may be reopened
};

var DEAL_TRANSITIONS = {
  'Open': ['Won', 'Lost'],
  'Won':  [],                 // terminal: commissions depend on it
  'Lost': ['Open']            // may be reopened if the client returns
};

var PROJECT_TRANSITIONS = {
  'Onboarding': ['InProgress', 'Completed'],
  'InProgress': ['Completed', 'Onboarding'],
  'Completed':  []
};

var PAYOUT_TRANSITIONS = {
  'Pending':    ['Processing', 'Paid'],
  'Processing': ['Paid', 'Pending'],
  'Paid':       []            // terminal: money has moved
};

var REQUEST_TRANSITIONS = {
  'Pending':  ['Approved', 'Rejected'],
  'Approved': ['Sent', 'Drafting', 'Paid', 'Failed', 'Signed', 'Archived'],
  'Rejected': [],
  'Sent':     ['Paid', 'Failed', 'Signed'],
  'Drafting': ['Sent', 'Signed'],
  'Signed':   ['Archived'],
  'Paid':     ['Archived'],
  'Failed':   ['Sent', 'Rejected'],
  'Archived': []
};

/**
 * @return {{allowed:boolean, reason:string}}
 */
function checkTransition(machine, from, to, label) {
  var f = String(from == null ? '' : from).trim();
  var t = String(to == null ? '' : to).trim();

  if (!t) return { allowed: false, reason: label + ' status is required.' };
  if (f === t) return { allowed: true, reason: 'no-op' };

  var allowedNext = machine[f];
  if (!allowedNext) {
    // Unknown current status (legacy row). Permit a move to any *valid*
    // target so operators can repair historic data, but never invent states.
    var validTargets = Object.keys(machine);
    if (validTargets.indexOf(t) === -1) {
      return { allowed: false, reason: 'Invalid ' + label + ' status: ' + t };
    }
    return { allowed: true, reason: 'legacy-repair' };
  }

  if (allowedNext.indexOf(t) === -1) {
    return {
      allowed: false,
      reason: 'Illegal ' + label + ' transition: ' + f + ' -> ' + t +
              (allowedNext.length ? ' (allowed: ' + allowedNext.join(', ') + ')'
                                  : ' (' + f + ' is terminal)')
    };
  }
  return { allowed: true, reason: 'ok' };
}

function canTransitionLead(from, to)    { return checkTransition(LEAD_TRANSITIONS, from, to, 'lead'); }
function canTransitionDeal(from, to)    { return checkTransition(DEAL_TRANSITIONS, normaliseDealStatus(from), to, 'deal'); }
function canTransitionProject(from, to) { return checkTransition(PROJECT_TRANSITIONS, normaliseProjectStatus(from), to, 'project'); }
function canTransitionPayout(from, to)  { return checkTransition(PAYOUT_TRANSITIONS, from, to, 'payout'); }
function canTransitionRequest(from, to) { return checkTransition(REQUEST_TRANSITIONS, from, to, 'request'); }

/* ================================================================== *
 * 3. PERMISSIONS
 *
 * The canonical matrix. api.gs consults this and nothing else; the React
 * sidebar is presentation only and carries no authority.
 * ================================================================== */

var ALL_ROLES = ROLES.slice();
var STAFF = ['SUPER_ADMIN', 'ADMIN', 'SALES_REP', 'SETTER'];
var MANAGERS = ['SUPER_ADMIN', 'ADMIN'];
var OWNER_ONLY = ['SUPER_ADMIN'];

/**
 * scope:
 *   'all'   - every record
 *   'team'  - records belonging to the caller's team
 *   'own'   - records where the caller is owner / setter / closer
 *   'self'  - the caller's own user record only
 */
var ACTION_POLICY = {
  /* --- session --- */
  'login':            { public: true },
  'logout':           { roles: ALL_ROLES },
  'getSession':       { roles: ALL_ROLES },
  'changePassword':   { roles: ALL_ROLES },

  /* --- reads --- */
  'getUsers':         { roles: STAFF,    scope: { SUPER_ADMIN: 'all', ADMIN: 'team', SALES_REP: 'all', SETTER: 'all' } },
  'getLeads':         { roles: STAFF,    scope: { SUPER_ADMIN: 'all', ADMIN: 'team', SALES_REP: 'own', SETTER: 'own' } },
  'getLeadById':      { roles: STAFF,    scope: { SUPER_ADMIN: 'all', ADMIN: 'team', SALES_REP: 'own', SETTER: 'own' } },
  'getDeals':         { roles: STAFF,    scope: { SUPER_ADMIN: 'all', ADMIN: 'team', SALES_REP: 'own', SETTER: 'own' } },
  'getProjects':      { roles: ['SUPER_ADMIN', 'ADMIN', 'SALES_REP'],
                        scope: { SUPER_ADMIN: 'all', ADMIN: 'team', SALES_REP: 'own' } },
  'getAdminRequests': { roles: ['SUPER_ADMIN', 'ADMIN', 'SALES_REP'],
                        scope: { SUPER_ADMIN: 'all', ADMIN: 'team', SALES_REP: 'own' } },
  'getCommissions':   { roles: STAFF,    scope: { SUPER_ADMIN: 'all', ADMIN: 'none', SALES_REP: 'own', SETTER: 'own' } },
  'getKPIs':          { roles: OWNER_ONLY },
  'getLogs':          { roles: STAFF,    scope: { SUPER_ADMIN: 'all', ADMIN: 'team', SALES_REP: 'own', SETTER: 'own' } },
  'getActivityFeed':  { roles: STAFF,    scope: { SUPER_ADMIN: 'all', ADMIN: 'team', SALES_REP: 'own', SETTER: 'own' } },

  /* --- reporting --- */
  // A rep sees their own numbers; a manager sees their team; only a
  // SUPER_ADMIN sees the whole organisation.
  'getProductivity':  { roles: STAFF,    scope: { SUPER_ADMIN: 'all', ADMIN: 'team', SALES_REP: 'own', SETTER: 'own' } },
  'getAnalytics':     { roles: OWNER_ONLY },
  'exportAllData':    { roles: OWNER_ONLY },

  /* --- follow-ups --- */
  'completeFollowUp': { roles: STAFF,    scope: { SUPER_ADMIN: 'all', ADMIN: 'team', SALES_REP: 'own', SETTER: 'own' } },
  'cancelFollowUp':   { roles: STAFF,    scope: { SUPER_ADMIN: 'all', ADMIN: 'team', SALES_REP: 'own', SETTER: 'own' } },

  /* --- assignment (manual, managers only) --- */
  'assignCloser':     { roles: MANAGERS },
  'assignSetter':     { roles: MANAGERS },

  /* --- team structure --- */
  'getTeamOverview':  { roles: MANAGERS },
  'setUserTeam':      { roles: MANAGERS },

  /* --- deletion (managers only; soft + archived + reversible) --- */
  'deleteLead':       { roles: MANAGERS },
  'restoreLead':      { roles: MANAGERS },
  'getDeletedLeads':  { roles: MANAGERS },

  /* --- leads --- */
  'createLead':       { roles: STAFF },
  'updateLead':       { roles: STAFF,    scope: { SUPER_ADMIN: 'all', ADMIN: 'team', SALES_REP: 'own', SETTER: 'own' } },
  'assignLead':       { roles: MANAGERS },
  'convertLead':      { roles: ['SUPER_ADMIN', 'ADMIN', 'SALES_REP'],
                        scope: { SUPER_ADMIN: 'all', ADMIN: 'team', SALES_REP: 'own' } },

  /* --- deals --- */
  'createDeal':       { roles: ['SUPER_ADMIN', 'ADMIN', 'SALES_REP'] },
  'updateDeal':       { roles: ['SUPER_ADMIN', 'ADMIN', 'SALES_REP'],
                        scope: { SUPER_ADMIN: 'all', ADMIN: 'team', SALES_REP: 'own' } },
  'markDealWon':      { roles: OWNER_ONLY },   // matches DealsPage.tsx:136
  'markDealLost':     { roles: ['SUPER_ADMIN', 'ADMIN', 'SALES_REP'],
                        scope: { SUPER_ADMIN: 'all', ADMIN: 'team', SALES_REP: 'own' } },
  'reviseCommission': { roles: OWNER_ONLY },

  /* --- projects --- */
  'createProject':    { roles: MANAGERS },
  'updateProject':    { roles: ['SUPER_ADMIN', 'ADMIN', 'SALES_REP'],
                        scope: { SUPER_ADMIN: 'all', ADMIN: 'team', SALES_REP: 'own' } },

  /* --- admin requests --- */
  'createAdminRequest': { roles: ['SUPER_ADMIN', 'ADMIN', 'SALES_REP'] },
  'updateAdminRequest': { roles: MANAGERS },
  'approveRequest':     { roles: MANAGERS },
  'rejectRequest':      { roles: MANAGERS },

  /* --- finance --- */
  'processCommission':  { roles: OWNER_ONLY },

  /* --- users --- */
  'createUser':       { roles: MANAGERS },
  'updateUser':       { roles: MANAGERS },
  'deactivateUser':   { roles: MANAGERS },
  'setAvailability':  { roles: ALL_ROLES },
  // Anyone may set their OWN timezone — the team is distributed and each
  // person's "today" must match their own calendar.
  'setTimeZone':      { roles: ALL_ROLES },

  /* --- logs --- */
  'createLog':        { roles: STAFF },

  /* --- zoho --- */
  'linkZoho':         { roles: ALL_ROLES },
  'unlinkZoho':       { roles: ALL_ROLES },
  'getZohoEmails':    { roles: ALL_ROLES },
  'sendZohoEmail':    { roles: ALL_ROLES },
  // Stored correspondence, readable without a live Zoho connection. Scoped
  // by the lead, so it follows the same visibility rules as the lead itself.
  'getStoredEmails':  { roles: ALL_ROLES },
  'saveEmailDraft':   { roles: ALL_ROLES },
  'getEmailDrafts':   { roles: ALL_ROLES },
  'deleteEmailDraft': { roles: ALL_ROLES },
  // Everyone may sync and analyse THEIR OWN mailbox. What differs by role is
  // how far the results reach, which the handlers decide — a rep sees their
  // own figures, a manager their team's, a Super Admin the organisation's.
  'syncMailbox':        { roles: ALL_ROLES },
  'getEmailAnalytics':  { roles: ALL_ROLES },
  'getUnmatchedEmails': { roles: ALL_ROLES },
  'getZohoAuthUrl':   { roles: ALL_ROLES },
  // Transport only. Every sub-request inside a batch is re-checked against
  // this same table, so this entry grants nothing on its own.
  'batch':            { roles: ALL_ROLES }
};

function getActionPolicy(action) {
  return ACTION_POLICY[action] || null;
}

function isPublicAction(action) {
  var p = getActionPolicy(action);
  return !!(p && p.public);
}

/**
 * @return {{allowed:boolean, reason:string}}
 */
function roleMayCallAction(role, action) {
  var policy = getActionPolicy(action);
  if (!policy) return { allowed: false, reason: 'Unknown action: ' + action };
  if (policy.public) return { allowed: true, reason: 'public' };
  if (!role) return { allowed: false, reason: 'Authentication required.' };
  if (policy.roles.indexOf(role) === -1) {
    return { allowed: false, reason: 'Role ' + role + ' may not perform ' + action + '.' };
  }
  return { allowed: true, reason: 'ok' };
}

/** Which record scope applies to this caller for this action. */
function scopeForAction(role, action) {
  var policy = getActionPolicy(action);
  if (!policy) return 'none';
  if (!policy.scope) return role === 'SUPER_ADMIN' ? 'all' : 'all';
  var s = policy.scope[role];
  return s === undefined ? 'none' : s;
}

/* ================================================================== *
 * 4. RECORD-LEVEL ACCESS
 * ================================================================== */

/** Fields on each entity that denote individual ownership. */
var OWNERSHIP_FIELDS = {
  Leads:         ['OwnerRepId', 'SetterId', 'CloserId'],
  Deals:         ['OwnerRepId', 'SetterId', 'CloserId'],
  Projects:      ['OwnerRepId', 'AccountManagerId', 'LiaisonId'],
  Commissions:   ['SetterId', 'CloserId'],
  AdminRequests: ['RequestedBy'],
  Users:         ['ID'],
  Logs:          ['UserId']
};

function recordIsOwnedBy(entity, record, userId) {
  if (!record || !userId) return false;
  var fields = OWNERSHIP_FIELDS[entity] || [];
  for (var i = 0; i < fields.length; i++) {
    if (String(record[fields[i]] || '') === String(userId)) return true;
  }
  return false;
}

/**
 * Team membership is resolved through the owning user's Team, because only
 * Users carry a Team column. `teamOf` maps a userId -> team name.
 */
/**
 * Team names are compared case-insensitively and trimmed.
 *
 * Real data contains "Sales Team" and "Sales team" for what is obviously one
 * team. An exact string match would silently split them, and the failure mode
 * is invisible: a manager just sees fewer records with no indication why.
 */
function sameTeam(a, b) {
  var x = String(a == null ? '' : a).trim().toLowerCase();
  var y = String(b == null ? '' : b).trim().toLowerCase();
  return x !== '' && x === y;
}

function recordBelongsToTeam(entity, record, team, teamOf) {
  if (!record || !team) return false;
  var fields = OWNERSHIP_FIELDS[entity] || [];
  for (var i = 0; i < fields.length; i++) {
    var uid = String(record[fields[i]] || '');
    if (uid && sameTeam(teamOf(uid), team)) return true;
  }
  return false;
}

/**
 * The central record-visibility decision.
 *
 * @param {string} scope    'all' | 'team' | 'own' | 'self' | 'none'
 * @param {string} entity   sheet name
 * @param {object} record
 * @param {object} actor    { id, role, team }
 * @param {function} teamOf userId -> team
 */
function canAccessRecord(scope, entity, record, actor, teamOf) {
  if (scope === 'all') return true;
  if (scope === 'none' || !record || !actor) return false;
  if (scope === 'self') return String(record.ID || '') === String(actor.id);

  if (scope === 'own') return recordIsOwnedBy(entity, record, actor.id);

  if (scope === 'team') {
    if (recordIsOwnedBy(entity, record, actor.id)) return true;

    var resolveTeam = teamOf || function () { return null; };
    if (recordBelongsToTeam(entity, record, actor.team, resolveTeam)) return true;

    // A record owned by a SUPER_ADMIN is organisation-level work, not another
    // team's private business. Treating it as private made a lead created by
    // the owner invisible to the very managers expected to run it — the team
    // lead could not see it, assign it, or act on it.
    //
    // Only managers get this. A rep's scope is still strictly their own.
    if (isManagerRole(actor.role) && recordOwnedByRole(entity, record, 'SUPER_ADMIN')) {
      return true;
    }
    return false;
  }
  return false;
}

/**
 * Is any owner of this record held by someone with the given role?
 *
 * Needs a role lookup, which the pure domain layer does not have, so the
 * resolver is injected by the caller in the same way `teamOf` is.
 */
var ROLE_OF_USER = null;   // set by makeRoleResolver() before a scoped read

function recordOwnedByRole(entity, record, role) {
  if (!ROLE_OF_USER) return false;
  var fields = OWNERSHIP_FIELDS[entity] || [];
  for (var i = 0; i < fields.length; i++) {
    var uid = String(record[fields[i]] || '');
    if (uid && String(ROLE_OF_USER(uid)) === String(role)) return true;
  }
  return false;
}

/**
 * Field-level write control. Even an authorised caller may not set every
 * column: IDs and audit stamps are server-owned, and role/status changes
 * are restricted.
 */
var SERVER_OWNED_FIELDS = ['ID', 'CreatedAt', 'UpdatedAt', 'PasswordHash', 'PasswordSalt',
                           'PasswordUpdatedAt', 'ZohoRefreshToken', 'FailedLoginCount',
                           'LockedUntil', 'MustChangePassword', 'PasswordIterations',
                           // Follow-up completion is a transition owned by
                           // completeFollowUp(), never a direct field write.
                           'FollowUpStatus', 'FollowUpCompletedAt', 'FollowUpCompletedBy',
                           // Deletion is owned by deleteLead()/restoreLead().
                           // A client must not be able to hide a record by
                           // writing a field.
                           'Deleted', 'DeletedAt', 'DeletedBy', 'DeleteReason'];

var WRITABLE_FIELDS = {
  Leads:         ['Name', 'Email', 'Phone', 'Status', 'OwnerRepId', 'SetterId', 'CloserId',
                  'Notes', 'Linkedin', 'NextFollowUp',
                  // Qualification record. Writable by whoever works the lead —
                  // the person doing the research is usually the rep, not a
                  // manager, so this is deliberately not manager-only.
                  'ResearchFindings', 'QualificationReason', 'ResearchSource'],
  Deals:         ['LeadId', 'Value', 'Status', 'OwnerRepId', 'SetterId', 'CloserId'],
  Projects:      ['ClientName', 'DealId', 'Status', 'OwnerRepId', 'AccountManagerId',
                  'LiaisonId', 'StartDate', 'DueDate', 'Notes'],
  AdminRequests: ['Type', 'RelatedDealId', 'RequestedBy', 'Status', 'Notes',
                  'PaymentLink', 'DocumentUrl'],
  Commissions:   ['DealId', 'SetterId', 'SetterAmount', 'CloserId', 'CloserAmount', 'PayoutStatus'],
  Users:         ['Username', 'Role', 'Team', 'Status', 'Availability', 'ZohoEmail',
                  'TimeZone', 'DisplayName'],
  Logs:          ['EntityId', 'EntityType', 'Action', 'UserId', 'Details', 'Metadata']
};

/**
 * Fields only a manager may change.
 *
 * These are a lead's IDENTITY — who the company is and how to reach them.
 * Getting them wrong corrupts the record for everyone, and correcting a
 * mistyped company name after the fact is guesswork, so the edit form is
 * restricted to SUPER_ADMIN and ADMIN.
 *
 * Deliberately NOT included: Status, Notes, NextFollowUp, SetterId, CloserId.
 * Those are the day-to-day work of whoever owns the lead — locking them would
 * stop a rep from being able to work their own pipeline.
 */
var MANAGER_ONLY_FIELDS = {
  Leads: ['Name', 'Email', 'Phone', 'Linkedin']
};

function isManagerRole(role) {
  return MANAGERS.indexOf(String(role)) !== -1;
}

/**
 * Strip anything the caller is not permitted to write.
 *
 * @param {string} [mode] 'create' or 'update'. Identity restrictions apply to
 *        UPDATES only: anyone who may add a lead must obviously be able to
 *        type its name and contact details. What is restricted is *changing*
 *        them afterwards, because that rewrites a shared record.
 */
function filterWritableFields(entity, payload, actorRole, mode) {
  var allowed = WRITABLE_FIELDS[entity] || [];
  var out = {};
  for (var key in payload) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
    if (SERVER_OWNED_FIELDS.indexOf(key) !== -1) continue;
    if (allowed.indexOf(key) === -1) continue;

    // Identity fields on a lead are manager-only. An actorRole of null means
    // the rollout compatibility mode (no session yet), which keeps the old
    // behaviour rather than silently dropping writes from the live frontend.
    var restricted = MANAGER_ONLY_FIELDS[entity];
    if (mode === 'update' && restricted && actorRole &&
        restricted.indexOf(key) !== -1 && !isManagerRole(actorRole)) {
      continue;
    }

    // Only SUPER_ADMIN may hand out the SUPER_ADMIN role.
    if (entity === 'Users' && key === 'Role' &&
        payload[key] === 'SUPER_ADMIN' && actorRole !== 'SUPER_ADMIN') {
      continue;
    }
    out[key] = payload[key];
  }
  return out;
}

/* ================================================================== *
 * 5. VALIDATION
 * ================================================================== */

function ValidationResult() {
  return { ok: true, errors: [] };
}

function addError(result, field, message) {
  result.ok = false;
  result.errors.push({ field: field, message: message });
  return result;
}

function isBlank(v) {
  return v === undefined || v === null || String(v).trim() === '';
}

var MAX_TEXT = 5000;
var MAX_NAME = 200;

function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim());
}

function isHttpUrl(v) {
  return /^https?:\/\/[^\s]+$/i.test(String(v).trim());
}

function isUuidLike(v) {
  return /^[0-9a-fA-F-]{8,64}$/.test(String(v).trim());
}

function isFiniteNumber(v) {
  var n = Number(v);
  return !isNaN(n) && isFinite(n);
}

function validateLead(payload, opts) {
  opts = opts || {};
  var r = ValidationResult();
  var partial = !!opts.partial;

  if (!partial || payload.Name !== undefined) {
    if (isBlank(payload.Name)) addError(r, 'Name', 'Lead name is required.');
    else if (String(payload.Name).length > MAX_NAME) addError(r, 'Name', 'Lead name is too long.');
  }
  if (payload.Email !== undefined && !isBlank(payload.Email) && !isEmail(payload.Email)) {
    addError(r, 'Email', 'Email address is not valid.');
  }
  if (payload.Phone !== undefined && String(payload.Phone).length > 40) {
    addError(r, 'Phone', 'Phone number is too long.');
  }
  if (payload.Linkedin !== undefined && !isBlank(payload.Linkedin) && !isHttpUrl(payload.Linkedin)) {
    addError(r, 'Linkedin', 'LinkedIn must be an http(s) URL.');
  }
  if (payload.Status !== undefined && !isBlank(payload.Status) &&
      LEAD_STATUSES.indexOf(String(payload.Status)) === -1) {
    addError(r, 'Status', 'Unknown lead status: ' + payload.Status);
  }
  if (payload.Notes !== undefined && String(payload.Notes).length > MAX_TEXT) {
    addError(r, 'Notes', 'Notes exceed ' + MAX_TEXT + ' characters.');
  }
  if (payload.ResearchFindings !== undefined && String(payload.ResearchFindings).length > MAX_TEXT) {
    addError(r, 'ResearchFindings', 'Research findings exceed ' + MAX_TEXT + ' characters.');
  }
  if (payload.QualificationReason !== undefined && String(payload.QualificationReason).length > MAX_TEXT) {
    addError(r, 'QualificationReason', 'Qualification reason exceeds ' + MAX_TEXT + ' characters.');
  }
  if (payload.ResearchSource !== undefined && !isBlank(payload.ResearchSource) &&
      String(payload.ResearchSource).length > 500) {
    addError(r, 'ResearchSource', 'Research source is too long.');
  }
  return r;
}

function validateDeal(payload, opts) {
  opts = opts || {};
  var r = ValidationResult();
  var partial = !!opts.partial;

  if (!partial || payload.LeadId !== undefined) {
    if (isBlank(payload.LeadId)) addError(r, 'LeadId', 'A deal must reference a lead.');
    else if (!isUuidLike(payload.LeadId)) addError(r, 'LeadId', 'LeadId is malformed.');
  }
  if (!partial || payload.Value !== undefined) {
    if (!isFiniteNumber(payload.Value)) addError(r, 'Value', 'Deal value must be a number.');
    else if (Number(payload.Value) < 0) addError(r, 'Value', 'Deal value cannot be negative.');
    else if (Number(payload.Value) > 1e12) addError(r, 'Value', 'Deal value is implausibly large.');
  }
  if (payload.Status !== undefined && !isBlank(payload.Status) &&
      DEAL_STATUSES.indexOf(String(payload.Status)) === -1) {
    addError(r, 'Status', 'Unknown deal status: ' + payload.Status);
  }
  return r;
}

function validateCommission(payload) {
  var r = ValidationResult();
  if (isBlank(payload.DealId)) addError(r, 'DealId', 'Commission must reference a deal.');
  ['SetterAmount', 'CloserAmount'].forEach(function (f) {
    if (!isFiniteNumber(payload[f])) addError(r, f, f + ' must be a number.');
    else if (Number(payload[f]) < 0) addError(r, f, f + ' cannot be negative.');
  });
  if (isBlank(payload.SetterId)) addError(r, 'SetterId', 'A setter must be attributed.');
  if (isBlank(payload.CloserId)) addError(r, 'CloserId', 'A closer must be attributed.');
  if (payload.PayoutStatus !== undefined && !isBlank(payload.PayoutStatus) &&
      PAYOUT_STATUSES.indexOf(String(payload.PayoutStatus)) === -1) {
    addError(r, 'PayoutStatus', 'Unknown payout status.');
  }
  return r;
}

function validateUser(payload, opts) {
  opts = opts || {};
  var r = ValidationResult();
  var partial = !!opts.partial;

  if (!partial || payload.Username !== undefined) {
    if (isBlank(payload.Username)) addError(r, 'Username', 'Username is required.');
    else if (!/^[a-zA-Z0-9._-]{3,40}$/.test(String(payload.Username))) {
      addError(r, 'Username', 'Username must be 3-40 chars: letters, digits, dot, underscore, hyphen.');
    }
  }
  if (!partial || payload.Role !== undefined) {
    if (ROLES.indexOf(String(payload.Role)) === -1) addError(r, 'Role', 'Unknown role.');
  }
  if (payload.Status !== undefined && USER_STATUSES.indexOf(String(payload.Status)) === -1) {
    addError(r, 'Status', 'Unknown user status.');
  }
  if (payload.Availability !== undefined && !isBlank(payload.Availability) &&
      AVAILABILITIES.indexOf(String(payload.Availability)) === -1) {
    addError(r, 'Availability', 'Unknown availability.');
  }
  if (payload.ZohoEmail !== undefined && !isBlank(payload.ZohoEmail) && !isEmail(payload.ZohoEmail)) {
    addError(r, 'ZohoEmail', 'Zoho email is not valid.');
  }
  return r;
}

function validateProject(payload, opts) {
  opts = opts || {};
  var r = ValidationResult();
  var partial = !!opts.partial;

  if (!partial || payload.ClientName !== undefined) {
    if (isBlank(payload.ClientName)) addError(r, 'ClientName', 'Client name is required.');
  }
  if (payload.Status !== undefined && !isBlank(payload.Status) &&
      PROJECT_STATUSES.indexOf(normaliseProjectStatus(payload.Status)) === -1) {
    addError(r, 'Status', 'Unknown project status.');
  }
  if (!isBlank(payload.StartDate) && !isBlank(payload.DueDate)) {
    var s = Date.parse(payload.StartDate);
    var d = Date.parse(payload.DueDate);
    if (!isNaN(s) && !isNaN(d) && d < s) {
      addError(r, 'DueDate', 'Due date cannot precede the start date.');
    }
  }
  return r;
}

function validateAdminRequest(payload, opts) {
  opts = opts || {};
  var r = ValidationResult();
  var partial = !!opts.partial;

  if (!partial || payload.Type !== undefined) {
    if (REQUEST_TYPES.indexOf(String(payload.Type)) === -1) {
      addError(r, 'Type', 'Request type must be payment or paperwork.');
    }
  }
  if (!partial || payload.RelatedDealId !== undefined) {
    if (isBlank(payload.RelatedDealId)) addError(r, 'RelatedDealId', 'A related deal is required.');
  }
  if (payload.Status !== undefined && !isBlank(payload.Status) &&
      REQUEST_STATUSES.indexOf(String(payload.Status)) === -1) {
    addError(r, 'Status', 'Unknown request status.');
  }
  if (payload.PaymentLink !== undefined && !isBlank(payload.PaymentLink) &&
      !isHttpUrl(payload.PaymentLink)) {
    addError(r, 'PaymentLink', 'Payment link must be an http(s) URL.');
  }
  if (payload.DocumentUrl !== undefined && !isBlank(payload.DocumentUrl) &&
      !isHttpUrl(payload.DocumentUrl)) {
    addError(r, 'DocumentUrl', 'Document URL must be an http(s) URL.');
  }
  return r;
}

var PASSWORD_MIN = 10;

function validatePassword(pw) {
  var r = ValidationResult();
  var s = String(pw == null ? '' : pw);
  if (s.length < PASSWORD_MIN) {
    addError(r, 'password', 'Password must be at least ' + PASSWORD_MIN + ' characters.');
  }
  if (s.length > 200) addError(r, 'password', 'Password is too long.');
  if (!/[a-zA-Z]/.test(s) || !/[0-9]/.test(s)) {
    addError(r, 'password', 'Password must contain both letters and digits.');
  }
  return r;
}

/* ================================================================== *
 * 6. COMMISSION MATHS
 * ================================================================== */

var DEFAULT_SETTER_RATE = 0.05;
var DEFAULT_CLOSER_RATE = 0.10;

/**
 * Compute a commission split. Explicit amounts win; otherwise fall back to
 * the default percentages that DealsPage has always used.
 */
function computeCommission(dealValue, input) {
  input = input || {};
  var value = Number(dealValue || 0);
  if (!isFiniteNumber(value) || value < 0) value = 0;

  var setter = input.setterAmount;
  var closer = input.closerAmount;

  if (!isFiniteNumber(setter)) setter = Math.round(value * DEFAULT_SETTER_RATE);
  if (!isFiniteNumber(closer)) closer = Math.round(value * DEFAULT_CLOSER_RATE);

  setter = Math.max(0, Math.round(Number(setter)));
  closer = Math.max(0, Math.round(Number(closer)));

  return { setterAmount: setter, closerAmount: closer, total: setter + closer };
}

/**
 * Guardrail: commissions must not exceed the deal value. Returns a warning
 * rather than blocking, because negotiated overrides are a real business case.
 */
function commissionExceedsDeal(dealValue, split) {
  return split.total > Number(dealValue || 0);
}

/* ================================================================== *
 * 7. SANITISATION
 * ================================================================== */

/**
 * Neutralise spreadsheet formula injection. Google Sheets treats a leading
 * = + - @ (and tab/CR) as a formula, so we prefix with an apostrophe, which
 * Sheets renders as plain text.
 *
 * This runs on the SERVER so that callers bypassing the React client — which
 * is where the only escaping used to live — cannot inject formulas.
 */
function sanitiseCell(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Object.prototype.toString.call(value) === '[object Date]') return value;

  var s = String(value);
  if (s.length === 0) return s;
  if (/^[=+\-@\t\r]/.test(s) && s.charAt(0) !== "'") {
    return "'" + s;
  }
  return s;
}

function sanitiseRecord(obj) {
  var out = {};
  for (var k in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
    out[k] = sanitiseCell(obj[k]);
  }
  return out;
}

/** Reverse sanitisation for display/comparison. */
function desanitiseCell(value) {
  if (typeof value !== 'string') return value;
  if (value.charAt(0) === "'" && /^'[=+\-@\t\r]/.test(value)) return value.slice(1);
  return value;
}

/* ================================================================== *
 * 8. RESPONSE REDACTION
 * ================================================================== */

/** Never leaves the server, for any caller, ever. */
var SECRET_FIELDS = ['PasswordHash', 'PasswordSalt', 'ZohoRefreshToken',
                     'FailedLoginCount', 'LockedUntil', 'Password',
                     // Not a credential, but it is the cost parameter of the
                     // KDF: publishing it tells anyone exactly how expensive
                     // an offline guess is. The client has no use for it.
                     'PasswordIterations'];

/**
 * Shape a Users row for API responses: secrets removed, link status exposed
 * as a boolean so the UI can still show "Zoho connected".
 */
function publicUser(row) {
  if (!row) return null;
  var out = {};
  for (var k in row) {
    if (!Object.prototype.hasOwnProperty.call(row, k)) continue;
    if (SECRET_FIELDS.indexOf(k) !== -1) continue;
    out[k] = row[k];
  }
  out.ZohoLinked = !!(row.ZohoRefreshToken && String(row.ZohoRefreshToken).length > 0);
  out.HasPassword = !!(row.PasswordHash && String(row.PasswordHash).length > 0);
  out.MustChangePassword = isTrueFlag(row.MustChangePassword);
  return out;
}

function redactSecrets(rows) {
  if (!rows) return rows;
  if (Object.prototype.toString.call(rows) === '[object Array]') {
    return rows.map(publicUser);
  }
  return publicUser(rows);
}

/* ================================================================== *
 * Node interop — ignored by Apps Script, used by the local test harness.
 * ================================================================== */


/* ================================================================== *
 * ============      PART 2: API INFRASTRUCTURE      ================= *
 * ================================================================== */
/* ================================================================== *
 * Error model
 * ================================================================== */

/**
 * Error codes are stable identifiers the frontend can branch on. The whole
 * point is that a client can tell "you are not allowed" apart from "the
 * database is down" apart from "there are genuinely no records" — the
 * distinction the original system could not make.
 */
var ERROR_CODES = {
  UNAUTHENTICATED:   { http: 401, retryable: false },
  FORBIDDEN:         { http: 403, retryable: false },
  INVALID_CREDENTIALS:{ http: 401, retryable: false },
  ACCOUNT_INACTIVE:  { http: 403, retryable: false },
  ACCOUNT_LOCKED:    { http: 429, retryable: false },
  PASSWORD_NOT_SET:  { http: 403, retryable: false },
  NOT_FOUND:         { http: 404, retryable: false },
  VALIDATION_FAILED: { http: 400, retryable: false },
  ILLEGAL_TRANSITION:{ http: 409, retryable: false },
  CONFLICT:          { http: 409, retryable: false },
  DUPLICATE:         { http: 409, retryable: false },
  LOCK_TIMEOUT:      { http: 503, retryable: true  },
  STORAGE_ERROR:     { http: 503, retryable: true  },
  EXTERNAL_ERROR:    { http: 502, retryable: true  },
  RATE_LIMITED:      { http: 429, retryable: true  },
  BAD_REQUEST:       { http: 400, retryable: false },
  UNKNOWN_ACTION:    { http: 404, retryable: false },
  INTERNAL:          { http: 500, retryable: false }
};

/**
 * @param {string} code    a key of ERROR_CODES
 * @param {string} message human-readable, safe to display
 * @param {Array}  [errors] field-level validation details
 */
function ApiError(code, message, errors) {
  var e = new Error(message || code);
  e.name = 'ApiError';
  e.isApiError = true;
  e.code = ERROR_CODES[code] ? code : 'INTERNAL';
  e.errors = errors || null;
  return e;
}

function isApiError(err) {
  return !!(err && err.isApiError);
}

/* ================================================================== *
 * Responses
 * ================================================================== */

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function createSuccessResponse(data, extra) {
  var body = { status: 'success', data: data === undefined ? null : data };
  if (extra) {
    for (var k in extra) {
      if (Object.prototype.hasOwnProperty.call(extra, k)) body[k] = extra[k];
    }
  }
  return createJsonResponse(body);
}

/**
 * Apps Script web apps always answer HTTP 200; the meaningful status lives
 * in the body. `httpStatus` is advisory for clients and logs.
 */
function createErrorResponse(message, code, errors) {
  var resolved = ERROR_CODES[code] ? code : 'INTERNAL';
  return createJsonResponse({
    status: 'error',
    code: resolved,
    message: String(message || 'Unexpected error'),
    errors: errors || null,
    httpStatus: ERROR_CODES[resolved].http,
    retryable: ERROR_CODES[resolved].retryable
  });
}

function errorResponseFrom(err) {
  if (isApiError(err)) {
    return createErrorResponse(err.message, err.code, err.errors);
  }
  var msg = String(err && err.message ? err.message : err);
  // Storage-layer failures must not masquerade as ordinary errors, because
  // the client needs to distinguish an outage from an empty result set.
  if (/sheet|spreadsheet|drive|not found in|Database/i.test(msg)) {
    return createErrorResponse(msg, 'STORAGE_ERROR');
  }
  return createErrorResponse(msg, 'INTERNAL');
}

/* ================================================================== *
 * Audit log
 * ================================================================== */

/**
 * Append an immutable audit event.
 *
 * Never throws: a failure to log must not roll back or block the business
 * operation it describes. Failures are surfaced through Logger so they are
 * visible in the Apps Script execution log.
 */
/**
 * Turn whatever an external system put in a time field into an ISO string.
 *
 * The Zoho reader used `new Date(Number(m.receivedTime)).toISOString()`, which
 * assumed epoch milliseconds. Zoho does not always oblige: some folders and
 * message types return a formatted date instead, `Number()` gives NaN, and
 * `new Date(NaN).toISOString()` throws RangeError. That killed the whole
 * request, so a single inbound reply made the lead page fail to load — the
 * crash reported from production.
 *
 * Accepts epoch millis, epoch seconds, or anything Date can parse, and falls
 * back rather than throwing. A message with an odd timestamp is worth showing
 * with an approximate time; it is not worth losing the conversation.
 */
/**
 * Is this cell a truthy flag?
 *
 * Google Sheets does NOT store the string 'TRUE'. It parses it and stores a
 * BOOLEAN, so the value read back is `true` and `String(true)` is 'true' —
 * lowercase. Every `=== 'TRUE'` comparison in this codebase therefore
 * succeeded against the local harness and failed against the live sheet.
 *
 * That is how MustChangePassword came to be written for all 13 migrated
 * accounts and then reported as zero: the flag was set correctly and read
 * wrongly. Anything comparing a sheet flag must go through here.
 */
function isTrueFlag(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  return String(value).trim().toUpperCase() === 'TRUE';
}

function toIsoTimestamp(value, fallbackIso) {
  var fallback = fallbackIso || new Date().toISOString();
  if (value === null || value === undefined || value === '') return fallback;

  var n = Number(value);
  if (!isNaN(n) && n > 0) {
    // Ten digits is seconds, thirteen is milliseconds.
    var ms = n < 1e11 ? n * 1000 : n;
    var d = new Date(ms);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  var parsed = new Date(String(value));
  if (!isNaN(parsed.getTime())) return parsed.toISOString();

  return fallback;
}

function auditLog(entry) {
  try {
    entry = entry || {};
    appendRecordRaw('Logs', {
      ID: Utilities.getUuid(),
      EntityId: String(entry.entityId || ''),
      EntityType: String(entry.entityType || ''),
      Action: String(entry.action || 'LOG'),
      UserId: String(entry.userId || ''),
      Details: sanitiseCell(String(entry.details || '')),
      Metadata: entry.metadata ? sanitiseCell(
        typeof entry.metadata === 'string' ? entry.metadata : JSON.stringify(entry.metadata)
      ) : '',
      // Almost always now. An explicit timestamp is accepted only for events
      // that genuinely happened earlier and are being recorded late — a mail
      // sync backfilling messages that arrived while nobody was looking. It
      // must land on the day it happened, or the daily feed shows a week of
      // correspondence as if it all arrived the moment someone opened the tab.
      Timestamp: entry.occurredAt
        ? toIsoTimestamp(entry.occurredAt)
        : new Date().toISOString(),
      RequestId: String(entry.requestId || CURRENT_REQUEST_ID || ''),
      // Validated enum, or blank. Never guessed from Details, and never
      // back-filled onto historical rows.
      ContactMode: normaliseContactMode(entry.contactMode)
    });
    return true;
  } catch (e) {
    Logger.log('AUDIT WRITE FAILED: ' + e + ' :: ' + JSON.stringify(entry));
    return false;
  }
}

/**
 * Correlation id for one inbound request, stamped onto every audit row it
 * produces. Makes a multi-write business transaction traceable end to end.
 */
/**
 * Coerce a caller-supplied contact mode to the validated vocabulary.
 * Anything unrecognised becomes '' rather than being stored as junk — an
 * absent value is honest, a wrong value corrupts analytics.
 */
function normaliseContactMode(value) {
  var v = String(value == null ? '' : value).trim().toUpperCase();
  if (!v) return '';
  return CONTACT_MODES.indexOf(v) !== -1 ? v : 'OTHER';
}

var CURRENT_REQUEST_ID = '';

function beginRequest() {
  CURRENT_REQUEST_ID = Utilities.getUuid();
  return CURRENT_REQUEST_ID;
}

function endRequest() {
  CURRENT_REQUEST_ID = '';
}

/* ================================================================== *
 * Misc
 * ================================================================== */

function generateUUID() {
  return Utilities.getUuid();
}

/** Read a token from either a POST body or a GET query string. */
function extractToken(e, body) {
  if (body && body.token) return String(body.token);
  if (e && e.parameter && e.parameter.token) return String(e.parameter.token);
  return null;
}

function nowIso() {
  return new Date().toISOString();
}

/** Coerce Sheets' loose cell values into a trimmed string. */
function cellString(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return v.toISOString();
  return String(v).trim();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ROLES: ROLES, LEAD_STATUSES: LEAD_STATUSES, DEAL_STATUSES: DEAL_STATUSES,
    PROJECT_STATUSES: PROJECT_STATUSES, PAYOUT_STATUSES: PAYOUT_STATUSES,
    REQUEST_STATUSES: REQUEST_STATUSES, ACTION_POLICY: ACTION_POLICY,
    canTransitionLead: canTransitionLead, canTransitionDeal: canTransitionDeal,
    canTransitionProject: canTransitionProject, canTransitionPayout: canTransitionPayout,
    canTransitionRequest: canTransitionRequest, roleMayCallAction: roleMayCallAction,
    scopeForAction: scopeForAction, canAccessRecord: canAccessRecord,
    filterWritableFields: filterWritableFields, computeCommission: computeCommission,
    sanitiseCell: sanitiseCell, publicUser: publicUser,
    validateLead: validateLead, validateDeal: validateDeal, validateUser: validateUser,
    validateCommission: validateCommission, validateProject: validateProject,
    validateAdminRequest: validateAdminRequest, validatePassword: validatePassword,
    normaliseDealStatus: normaliseDealStatus
  };
}
