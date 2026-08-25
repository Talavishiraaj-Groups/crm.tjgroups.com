/**
 * TJGROUPS CRM - Setup & Migrations
 *
 * SAFETY CONTRACT
 * ---------------
 * Everything in this file is additive and idempotent:
 *
 *   - existing spreadsheets are never recreated or overwritten
 *   - existing columns are never renamed, reordered or removed
 *   - new columns are only ever APPENDED to the right of existing ones
 *   - an ID column must exist; the storage layer finds it BY NAME, so it does
 *     not have to be column A (the live AdminRequests sheet has it last)
 *   - no business data is written or cleared
 *
 * Running setupCRMDatabase() twice is safe. Running it against a populated
 * production database is safe.
 */

/**
 * Read at CALL time, not at script-load time.
 *
 * This was a top-level `var` capturing the property when the file was
 * evaluated. That made the value a snapshot: setting the property and calling
 * again in the same execution saw the old one, and it could not be reasoned
 * about or tested. Nothing needs it before a call anyway.
 */
function getMainFolderId() {
  return PropertiesService.getScriptProperties().getProperty('MAIN_FOLDER_ID');
}

/**
 * Canonical schema.
 *
 * Columns marked [ADDED] did not exist in the original deployment. They are
 * appended by migrateDatabase() without disturbing existing data.
 */
var DATABASE_SCHEMA = {
  'Users': [
    'ID', 'Username', 'Role', 'Team', 'Status', 'Availability',
    'ZohoEmail', 'ZohoRefreshToken', 'CreatedAt', 'UpdatedAt',
    // [ADDED] authentication
    'PasswordHash', 'PasswordSalt', 'PasswordIterations', 'PasswordUpdatedAt',
    'FailedLoginCount', 'LockedUntil', 'MustChangePassword',
    // [ADDED] zoho bookkeeping
    'ZohoAccountId', 'ZohoLinkedAt',
    // [ADDED] the team is distributed across timezones. "Today" for a rep in
    // Manila is not "today" for one in London, so each account carries its own
    // IANA zone. Blank falls back to CRM_TIMEZONE.
    'TimeZone',
    // [ADDED] the human name that appears in a recipient's inbox. Usernames
    // are login handles — "dhiraj_th" is not how anyone signs a letter, and
    // outbound mail was showing exactly that. Blank falls back to a tidied
    // username, so this needs filling in only where that is not good enough.
    'DisplayName'
  ],

  'Leads': [
    'ID', 'Name', 'Email', 'Phone', 'Status', 'OwnerRepId', 'SetterId', 'CloserId',
    'Notes', 'Linkedin', 'NextFollowUp', 'CreatedAt', 'UpdatedAt',
    // [ADDED] follow-up completion tracking. Existing rows are treated as
    // 'Planned' by default, so no historical row needs to be written.
    'FollowUpStatus', 'FollowUpCompletedAt', 'FollowUpCompletedBy',
    // [ADDED] why a follow-up was allowed to go stale. Written server-side
    // only, so it cannot be forged or back-dated by a client.
    'FollowUpDelayReason', 'FollowUpDelayReasonAt', 'FollowUpDelayReasonBy',
    // [ADDED] soft delete. The row NEVER moves and is never cleared — it is
    // flagged and hidden from normal reads. See DeletedLeads for the archive.
    'Deleted', 'DeletedAt', 'DeletedBy', 'DeleteReason',
    // [ADDED] qualification record: what was found out about this company and
    // why it was worth approaching. Kept as two fields rather than folded into
    // Notes, because Notes is a running conversation log and this is a
    // standing judgement that should not scroll away.
    'ResearchFindings', 'QualificationReason', 'ResearchSource',
    'ResearchUpdatedAt', 'ResearchUpdatedBy'
  ],

  'Deals': [
    'ID', 'LeadId', 'Value', 'Status', 'OwnerRepId', 'SetterId', 'CloserId',
    'CreatedAt', 'UpdatedAt'
  ],

  'Projects': [
    'ID', 'ClientName', 'Status', 'OwnerRepId', 'AccountManagerId', 'LiaisonId',
    'StartDate', 'DueDate', 'CreatedAt', 'UpdatedAt',
    // [ADDED] the frontend already sends Notes and models dealId
    'DealId', 'Notes'
  ],

  'AdminRequests': [
    'ID', 'Type', 'RelatedDealId', 'RequestedBy', 'Status', 'CreatedAt', 'UpdatedAt',
    // [ADDED] the frontend reads and writes all three of these today
    'Notes', 'PaymentLink', 'DocumentUrl'
  ],

  'Commissions': [
    'ID', 'DealId', 'SetterId', 'SetterAmount', 'CloserId', 'CloserAmount',
    'PayoutStatus', 'CreatedAt', 'UpdatedAt',
    // [ADDED] when the payout actually settled
    'PayoutDate'
  ],

  'Logs': [
    'ID', 'EntityId', 'EntityType', 'Action', 'UserId', 'Details', 'Metadata', 'Timestamp',
    // [ADDED] correlates every write made by one request
    'RequestId',
    // [ADDED] structured contact channel. Blank on every historical row, and
    // deliberately left blank — see CONTACT_MODE_TRACKING_SINCE.
    'ContactMode'
  ],

  // [ADDED] entirely new sheet — server-side sessions
  'Sessions': [
    'ID', 'TokenHash', 'UserId', 'CreatedAt', 'ExpiresAt', 'RevokedAt', 'UserAgent'
  ],

  // [ADDED] a durable record of email exchanged with a lead.
  //
  // Zoho is the source of truth for mail, but it is reachable only while the
  // user's token is valid and their mailbox still holds the message. Copying
  // the envelope here means the conversation survives a token expiring, a
  // mailbox being cleaned out, or the person leaving — and it lets the CRM
  // show correspondence without a Zoho round trip on every page load.
  //
  // MessageId is the dedupe key: re-syncing the same message never doubles it.
  'EmailLog': [
    'ID', 'MessageId', 'LeadId', 'LeadEmail', 'UserId', 'Direction',
    'Subject', 'Summary', 'Sender', 'ToAddress', 'SentAt', 'SyncedAt',
    // [ADDED] Zoho addresses a message body as folder + message, so without
    // the folder the body cannot be fetched at all. The archive wrote this
    // field and getEmailContent read it, but it was missing HERE — so the
    // column never existed, appendRecordRaw dropped the value silently, and
    // every attempt to open a full message came back empty. That is why
    // EmailBodies stayed at zero rows.
    'FolderId'
  ],

  // [ADDED] message bodies, deliberately in their OWN sheet.
  //
  // A body can be 45,000 characters. EmailLog is read in full on every lead
  // page load to list the conversation, and Apps Script has no way to read
  // part of a sheet — so keeping bodies alongside the envelopes would mean
  // hauling megabytes across to render a list of subject lines, and would
  // eventually fail outright with "Service Spreadsheets failed".
  //
  // Split, the list read stays small forever and a body is fetched only when
  // somebody actually opens that message.
  'EmailBodies': [
    'ID', 'MessageId', 'Body', 'BodyComplete', 'StoredAt'
  ],

  // [ADDED] saved email drafts, per user per lead.
  'EmailDrafts': [
    'ID', 'LeadId', 'UserId', 'ToAddress', 'Subject', 'Content',
    'CreatedAt', 'UpdatedAt', 'SentAt'
  ],

  // [ADDED] the "deleted database".
  //
  // A deletion writes a row here AND flags the original in Leads. The original
  // row is never moved or cleared, because a move that fails half-way loses the
  // record entirely. Snapshot holds the full values at the moment of deletion,
  // so the archive is readable even if the source row is later edited.
  'DeletedLeads': [
    'ID', 'LeadId', 'LeadName', 'DeletedAt', 'DeletedBy', 'DeletedByUsername',
    'Reason', 'Snapshot', 'RestoredAt', 'RestoredBy'
  ]
};

/* ================================================================== *
 * Setup
 * ================================================================== */

/**
 * Does this Drive folder already hold a database with records in it?
 *
 * Used to decide whether repointing DB_FOLDER_ID would orphan live data. Any
 * sheet with more than a header row counts.
 */
function databaseFolderHasRecords(folderId) {
  try {
    var folder = DriveApp.getFolderById(folderId);
    for (var sheetName in DATABASE_SCHEMA) {
      if (!Object.prototype.hasOwnProperty.call(DATABASE_SCHEMA, sheetName)) continue;
      var files = folder.getFilesByName(sheetName);
      if (!files.hasNext()) continue;
      var sheet = SpreadsheetApp.openById(files.next().getId()).getActiveSheet();
      if (sheet && sheet.getLastRow() > 1) return true;
    }
  } catch (e) {
    // A folder we cannot read is not one we may declare empty.
    return true;
  }
  return false;
}

function setupCRMDatabase() {
  var mainFolderId = getMainFolderId();
  if (!mainFolderId) {
    throw new Error(
      'MAIN_FOLDER_ID is not set. Add it in Project Settings > Script Properties.\n\n' +
      'NOTE: if DB_FOLDER_ID is already set, this database is already installed ' +
      'and you do not need setupCRMDatabase() at all. To upgrade an existing ' +
      'installation run preflightCheck() then migrateDatabase().'
    );
  }

  var props = PropertiesService.getScriptProperties();
  var existingDbId = props.getProperty('DB_FOLDER_ID');

  var mainFolder = DriveApp.getFolderById(mainFolderId);
  var dbFolder = getOrCreateSubFolder(mainFolder, 'Databases');

  // REFUSE to repoint a live installation.
  //
  // This used to overwrite DB_FOLDER_ID unconditionally. If MAIN_FOLDER_ID
  // named any folder other than the real database's parent, that silently
  // aimed the entire CRM at a brand-new empty Databases folder: nothing is
  // deleted, but every record becomes invisible, which is indistinguishable
  // from data loss to everyone using it.
  //
  // Nothing about an existing installation needs this function. It exists to
  // create a database, not to re-adopt one.
  if (existingDbId && existingDbId !== dbFolder.getId() &&
      databaseFolderHasRecords(existingDbId)) {
    throw new Error(
      'REFUSING TO RUN.\n\n' +
      'DB_FOLDER_ID already points at a database that contains records:\n' +
      '  ' + existingDbId + '\n\n' +
      'MAIN_FOLDER_ID (' + mainFolderId + ') resolves to a DIFFERENT ' +
      'Databases folder:\n  ' + dbFolder.getId() + '\n\n' +
      'Continuing would repoint the CRM at the empty folder and every existing ' +
      'record would vanish from the app.\n\n' +
      'If you are UPGRADING an existing installation, you do not need this ' +
      'function. Run preflightCheck() then migrateDatabase() instead.\n\n' +
      'If you genuinely intend to move to a different database, clear ' +
      'DB_FOLDER_ID in Script Properties first — deliberately, and with a backup.'
    );
  }

  getOrCreateSubFolder(mainFolder, 'Uploads_Paperwork');
  getOrCreateSubFolder(mainFolder, 'Exports_Reports');

  props.setProperty('DB_FOLDER_ID', dbFolder.getId());

  for (var sheetName in DATABASE_SCHEMA) {
    if (!Object.prototype.hasOwnProperty.call(DATABASE_SCHEMA, sheetName)) continue;
    getOrCreateSpreadsheet(dbFolder, sheetName, DATABASE_SCHEMA[sheetName]);
  }

  var report = migrateDatabase();

  // A brand-new database gets its Logs sheet created (not migrated), so the
  // migration path above never stamps the tracking date. Set it here too, so
  // a fresh install still reports an honest coverage start instead of null.
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('CONTACT_MODE_TRACKING_SINCE')) {
    var since = new Date().toISOString();
    props.setProperty('CONTACT_MODE_TRACKING_SINCE', since);
    report.contactModeTrackingSince = since;
  }

  Logger.log('CRM setup complete.');
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

/* ================================================================== *
 * Migration
 * ================================================================== */

/**
 * Bring existing sheets up to the canonical schema.
 *
 * Only ever appends columns. Returns a report describing exactly what it
 * did, so you can confirm the change before and after running it.
 */
function migrateDatabase() {
  var dbFolderId = PropertiesService.getScriptProperties().getProperty('DB_FOLDER_ID');
  if (!dbFolderId) throw new Error('DB_FOLDER_ID missing. Run setupCRMDatabase() first.');

  var folder = DriveApp.getFolderById(dbFolderId);
  var report = { added: {}, created: [], unchanged: [], warnings: [] };

  for (var sheetName in DATABASE_SCHEMA) {
    if (!Object.prototype.hasOwnProperty.call(DATABASE_SCHEMA, sheetName)) continue;

    var expected = DATABASE_SCHEMA[sheetName];
    var files = folder.getFilesByName(sheetName);

    if (!files.hasNext()) {
      getOrCreateSpreadsheet(folder, sheetName, expected);
      report.created.push(sheetName);
      continue;
    }

    var sheet = SpreadsheetApp.openById(files.next().getId()).getActiveSheet();
    var lastCol = sheet.getLastColumn();
    var current = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];

    // The storage layer resolves ID with indexOf, so its POSITION does not
    // matter — only its presence. Absence is fatal; a non-first position is
    // merely worth knowing, because the ORIGINAL backend compared column A
    // and therefore failed silently on such a sheet.
    if (current.length && current.indexOf('ID') === -1) {
      report.warnings.push(
        sheetName + ': no ID column found. Records in this sheet cannot be ' +
        'addressed for update or deletion.'
      );
    } else if (current.length && String(current[0]).trim() !== 'ID') {
      report.warnings.push(
        sheetName + ': ID is column ' + (current.indexOf('ID') + 1) +
        ', not column A. Supported, but note that the previous backend could ' +
        'not update this sheet at all.'
      );
    }

    var missing = [];
    for (var i = 0; i < expected.length; i++) {
      if (current.indexOf(expected[i]) === -1) missing.push(expected[i]);
    }

    if (!missing.length) {
      report.unchanged.push(sheetName);
      continue;
    }

    var startCol = current.length + 1;
    sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
    sheet.getRange(1, startCol, 1, missing.length).setFontWeight('bold');
    report.added[sheetName] = missing;
    Logger.log('Added columns to ' + sheetName + ': ' + missing.join(', '));

    // Stamp the REAL moment structured contact-mode tracking begins, so
    // analytics can state its own coverage honestly instead of implying it
    // covers the whole history. Historical rows keep an empty ContactMode.
    if (sheetName === 'Logs' && missing.indexOf('ContactMode') !== -1) {
      var props = PropertiesService.getScriptProperties();
      if (!props.getProperty('CONTACT_MODE_TRACKING_SINCE')) {
        var since = new Date().toISOString();
        props.setProperty('CONTACT_MODE_TRACKING_SINCE', since);
        report.contactModeTrackingSince = since;
        Logger.log('Contact-mode tracking starts: ' + since);
      }
    }
  }

  // Warnings were collected and then thrown away: the report was returned but
  // only the "Added columns" lines were ever logged, so a structural problem
  // with a live sheet — an ID column that is not where the old backend looked
  // for it, or missing entirely — passed silently. A warning nobody sees is
  // not a warning.
  Logger.log('');
  Logger.log('---------------------------------------------');
  Logger.log(' MIGRATION SUMMARY');
  Logger.log('---------------------------------------------');
  Logger.log(' sheets created:   ' + (report.created.length ? report.created.join(', ') : 'none'));
  Logger.log(' columns added to: ' +
    (Object.keys(report.added).length ? Object.keys(report.added).join(', ') : 'none'));
  Logger.log(' already correct:  ' +
    (report.unchanged.length ? report.unchanged.join(', ') : 'none'));

  if (report.warnings.length) {
    Logger.log('');
    Logger.log(' WARNINGS (' + report.warnings.length + ') — read these:');
    for (var w = 0; w < report.warnings.length; w++) {
      Logger.log('   - ' + report.warnings[w]);
    }
  } else {
    Logger.log(' warnings:         none');
  }

  Logger.log('');
  Logger.log(' No existing row was read, rewritten or removed by this function.');
  Logger.log('---------------------------------------------');

  return report;
}

/**
 * When structured contact-mode tracking actually began.
 * Null means it has not started yet (migration not run).
 */
function getContactModeTrackingSince() {
  return PropertiesService.getScriptProperties()
    .getProperty('CONTACT_MODE_TRACKING_SINCE') || null;
}

/** Retained for backwards compatibility with the original function name. */
function refreshDatabaseHeaders() {
  return migrateDatabase();
}

/* ================================================================== *
 * Password bootstrap
 * ================================================================== */

/**
 * Give every account without a password a strong temporary one.
 *
 * Run this ONCE, from the Apps Script editor, after migrateDatabase() and
 * BEFORE switching AUTH_ENFORCEMENT to 'on'. Without it, enabling
 * enforcement would lock every existing user out, because the original
 * Users sheet had no password column at all.
 *
 * The generated passwords are written to the execution log only — never to
 * the sheet, never to an API response. Copy them, distribute them through a
 * trusted channel, and require a change at first login.
 */
function bootstrapPasswords() {
  var users = getRecordsRaw('Users');
  var issued = [];

  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    if (u.PasswordHash) continue;
    if (String(u.Status) !== 'Active') continue;

    var temp = generateTemporaryPassword();
    setUserPassword(u.ID, temp, { mustChange: true });
    issued.push({ username: u.Username, role: u.Role, temporaryPassword: temp });

    auditLog({
      entityId: u.ID, entityType: 'User', action: 'PASSWORD_BOOTSTRAPPED',
      userId: 'SYSTEM', details: 'Temporary password issued during migration.'
    });
  }

  Logger.log('=================================================');
  Logger.log(' TEMPORARY PASSWORDS — copy now, they are not stored');
  Logger.log('=================================================');
  for (var j = 0; j < issued.length; j++) {
    Logger.log(issued[j].username + '  (' + issued[j].role + ')  ->  ' +
               issued[j].temporaryPassword);
  }
  if (!issued.length) Logger.log('(every active account already has a password)');
  Logger.log('=================================================');

  return { count: issued.length };
}

/**
 * Generate a temporary password.
 *
 * Randomness source: Utilities.getUuid() returns a RFC-4122 v4 UUID, which
 * Apps Script derives from java.util.UUID.randomUUID() — a cryptographically
 * secure generator. Each UUID contributes 122 random bits.
 *
 * Selection is UNBIASED. We read one byte at a time and reject any value in
 * the final partial bucket (>= 256 - 256 % alphabet.length) before taking the
 * modulus, so every character in the alphabet is equally likely.
 *
 * An earlier version of this function mapped a single hex nibble per position
 * and appended a fixed "q7" suffix. That yielded only 16 possible characters
 * per position and three constant positions — roughly 52 bits rather than the
 * ~80 the length suggested. This version produces 16 uniform characters from a
 * 55-character alphabet: about 92 bits.
 */
function generateTemporaryPassword() {
  // Ambiguous characters removed: no O/0, I/l/1.
  var alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  var limit = 256 - (256 % alphabet.length); // rejection threshold
  var length = 16;

  var out = '';
  var pool = [];
  var guard = 0;

  while (out.length < length) {
    if (!pool.length) {
      if (++guard > 100) throw new Error('Could not gather entropy for a temporary password.');
      var hex = Utilities.getUuid().replace(/-/g, '');
      for (var i = 0; i < hex.length; i += 2) {
        pool.push(parseInt(hex.substr(i, 2), 16));
      }
    }
    var b = pool.pop();
    if (b >= limit) continue; // reject, keeps the distribution uniform
    out += alphabet.charAt(b % alphabet.length);
  }

  // validatePassword() requires at least one letter and one digit. Rather
  // than appending a fixed suffix, replace two RANDOM positions with a random
  // letter and a random digit if the draw happens to lack either.
  var letters = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  var digits = '23456789';
  var chars = out.split('');

  if (!/[a-zA-Z]/.test(out)) {
    chars[randomIndexBelow(length)] = letters.charAt(randomIndexBelow(letters.length));
  }
  if (!/[0-9]/.test(out)) {
    var slot = randomIndexBelow(length);
    // Do not overwrite the letter we may have just guaranteed.
    if (!/[a-zA-Z]/.test(chars.join('').replace(chars[slot], ''))) slot = (slot + 1) % length;
    chars[slot] = digits.charAt(randomIndexBelow(digits.length));
  }

  return chars.join('');
}

/** Uniform random integer in [0, n) drawn from the same secure source. */
function randomIndexBelow(n) {
  var limit = 256 - (256 % n);
  var hex = Utilities.getUuid().replace(/-/g, '');
  for (var i = 0; i < hex.length; i += 2) {
    var b = parseInt(hex.substr(i, 2), 16);
    if (b < limit) return b % n;
  }
  return parseInt(hex.substr(0, 2), 16) % n;
}

/**
 * Set one user's password from the editor. Use for resets.
 * Call as: setPasswordFor('sales_rep_1', 'their-new-password')
 */
function setPasswordFor(username, newPassword) {
  var users = getRecordsRaw('Users');
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].Username).toLowerCase() === String(username).toLowerCase()) {
      setUserPassword(users[i].ID, newPassword);
      revokeAllSessionsForUser(users[i].ID);
      Logger.log('Password updated for ' + username + '; sessions revoked.');
      return true;
    }
  }
  Logger.log('No such user: ' + username);
  return false;
}

/* ================================================================== *
 * Rollout controls
 * ================================================================== */

/** Step through the enforcement modes from the editor. */
function setAuthEnforcement(mode) {
  if (['off', 'warn', 'on'].indexOf(mode) === -1) {
    throw new Error("mode must be 'off', 'warn' or 'on'");
  }
  PropertiesService.getScriptProperties().setProperty('AUTH_ENFORCEMENT', mode);
  Logger.log('AUTH_ENFORCEMENT is now: ' + mode);
  return mode;
}

/**
 * Pre-flight check. Run before switching enforcement on; it reports anything
 * that would lock a user out or leave the deployment misconfigured.
 */
function preflightCheck() {
  var issues = [];
  var notes = [];
  var props = PropertiesService.getScriptProperties();

  if (!props.getProperty('DB_FOLDER_ID')) issues.push('DB_FOLDER_ID is not set.');
  if (!props.getProperty('ZOHO_CLIENT_ID') || !props.getProperty('ZOHO_CLIENT_SECRET')) {
    notes.push('Zoho credentials are not configured; mail features will be unavailable.');
  }
  if (!props.getProperty('PASSWORD_PEPPER')) {
    notes.push('PASSWORD_PEPPER will be generated on first use.');
  }

  var users, sessionsOk = true;
  try {
    users = getRecordsRaw('Users');
  } catch (e) {
    issues.push('Cannot read Users: ' + e.message);
    users = [];
  }

  // Missing sheets are created by migrateDatabase(), NOT setupCRMDatabase().
  // This used to name the latter, which on an installed database is the one
  // function that can repoint DB_FOLDER_ID and hide every existing record.
  // Advice that sends someone to a destructive function is worse than none.
  var missingSheets = [];
  var missingColumns = [];

  for (var sheetName in DATABASE_SCHEMA) {
    if (!Object.prototype.hasOwnProperty.call(DATABASE_SCHEMA, sheetName)) continue;
    try {
      getRecordsRaw(sheetName);
    } catch (e) {
      missingSheets.push(sheetName);
      if (sheetName === 'Sessions') sessionsOk = false;
      continue;
    }

    // Columns matter as much as sheets, and this checked only sheets.
    // Re-pasting backend code that introduces a column leaves the sheet
    // present but incomplete: writes to the new field are silently dropped,
    // and preflight said everything was fine.
    try {
      var sh = getSheetByName(sheetName);
      var lastCol = sh.getLastColumn();
      var have = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
      var want = DATABASE_SCHEMA[sheetName];
      for (var c = 0; c < want.length; c++) {
        if (have.indexOf(want[c]) === -1) {
          missingColumns.push(sheetName + '.' + want[c]);
        }
      }
    } catch (e2) {
      notes.push('Could not read the header row of ' + sheetName + ': ' + e2.message);
    }
  }

  if (missingSheets.length) {
    issues.push('Missing sheet(s): ' + missingSheets.join(', ') +
                '. Run migrateDatabase() — it creates them without touching ' +
                'existing data. Do NOT run setupCRMDatabase() on an installed ' +
                'database.');
  }
  if (missingColumns.length) {
    issues.push('Missing column(s): ' + missingColumns.join(', ') +
                '. Run migrateDatabase() — it appends them to the right of the ' +
                'existing columns and rewrites no rows.');
  }

  var active = 0, withPassword = 0, superAdmins = 0, legacyPlaintext = 0;
  for (var i = 0; i < users.length; i++) {
    var legacy = users[i].Password === undefined || users[i].Password === null
      ? '' : String(users[i].Password);
    if (legacy.trim() && !/^[0-9a-f]{64}$/i.test(legacy) && !users[i].PasswordHash) {
      legacyPlaintext++;
    }
    if (String(users[i].Status) === 'Active') {
      active++;
      if (users[i].PasswordHash) withPassword++;
      if (String(users[i].Role) === 'SUPER_ADMIN') superAdmins++;
    }
  }

  if (active && withPassword < active) {
    // Which function to run depends on whether readable passwords already
    // exist. Hashing what people ALREADY KNOW keeps everyone signed in and
    // needs no distribution of temporary credentials; issuing new ones is
    // only right when there is nothing to preserve.
    if (legacyPlaintext > 0) {
      issues.push((active - withPassword) + ' active user(s) have no password hash, ' +
                  'but ' + legacyPlaintext + ' account(s) still hold a readable ' +
                  'password in the sheet. Run migrateLegacyPasswords() to hash ' +
                  'those in place — everyone keeps the password they already use. ' +
                  'Run bootstrapPasswords() afterwards for anyone still left over.');
    } else {
      issues.push((active - withPassword) + ' active user(s) have no password. ' +
                  'Run bootstrapPasswords() before enabling enforcement.');
    }
  }

  if (legacyPlaintext > 0) {
    notes.push(legacyPlaintext + ' account(s) hold a readable password in the ' +
               'Users sheet. Anyone with access to that spreadsheet can read them. ' +
               'migrateLegacyPasswords() hashes and removes them.');
  }

  if (!superAdmins) issues.push('No active SUPER_ADMIN exists.');

  var report = {
    enforcement: getAuthEnforcement(),
    activeUsers: active,
    usersWithPassword: withPassword,
    usersWithReadablePassword: legacyPlaintext,
    activeSuperAdmins: superAdmins,
    sessionsSheet: sessionsOk ? 'ok' : 'missing',
    missingSheets: missingSheets,
    missingColumns: missingColumns,
    blockingIssues: issues,
    notes: notes,
    readyToEnforce: issues.length === 0,
    // Ordered, so there is never a question of what to do next.
    nextSteps: buildNextSteps(missingSheets, missingColumns, legacyPlaintext,
                              active - withPassword)
  };

  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

/**
 * The remaining rollout steps, in the order they must be run.
 *
 * preflightCheck() reports state; this turns that state into instructions, so
 * nobody has to work out the ordering from a list of complaints.
 */
function buildNextSteps(missingSheets, missingColumns, legacyPlaintext, usersNeedingPasswords) {
  var steps = [];

  if (missingSheets.length || missingColumns.length) {
    var what = [];
    if (missingSheets.length) what.push('creates ' + missingSheets.join(', '));
    if (missingColumns.length) what.push('adds ' + missingColumns.join(', '));
    steps.push('1. migrateDatabase()  — ' + what.join(', and ') +
               '. Additive; existing rows untouched.');
  }
  if (legacyPlaintext > 0) {
    steps.push((steps.length + 1) + '. auditLegacyPasswordExposure()  — see how ' +
               'many readable passwords are in the sheet.');
    steps.push((steps.length + 1) + '. migrateLegacyPasswords()  — hash them in ' +
               'place and clear the readable copies. Nobody is locked out; ' +
               'everyone keeps the password they already use.');
  }
  if (usersNeedingPasswords > 0) {
    steps.push((steps.length + 1) + '. bootstrapPasswords()  — issues a temporary ' +
               'password for anyone still without one. COPY THE OUTPUT: it is ' +
               'printed once and never stored.');
  }

  steps.push((steps.length + 1) + '. preflightCheck()  — run again; readyToEnforce ' +
             'must be true.');
  steps.push((steps.length + 1) + '. selfCheck()  — must report RESULT: OK.');
  steps.push((steps.length + 1) + '. Deploy > Manage deployments > Edit > New ' +
             'version > Deploy. Do NOT create a new deployment: that changes the ' +
             '/exec URL and the live site keeps calling the old one.');

  // The frontend step was missing here, and its absence was dangerous.
  // AUTH_ENFORCEMENT exists so the backend can go live BEFORE the new
  // frontend. Switching it on while the old bundle is still being served
  // rejects every request that bundle makes, because it does not hold a
  // session token — the live site would stop working for everyone at once.
  steps.push((steps.length + 1) + '. DEPLOY THE FRONTEND (Vercel). Until this ' +
             'is done the live site is the OLD bundle, which does not sign in ' +
             'and holds no session token.');
  steps.push((steps.length + 1) + '. Sign in on the live site and confirm it ' +
             'works while enforcement is still off.');
  steps.push((steps.length + 1) + ". setAuthEnforcement('warn')  — requests " +
             'without a session are still served, but each one is logged. Watch ' +
             'the Apps Script executions for a day. Anything still arriving ' +
             'unauthenticated would break in the next step.');
  steps.push((steps.length + 1) + ". setAuthEnforcement('on')  — ONLY after the " +
             'new frontend is live and warn mode is quiet. To undo instantly: ' +
             "setAuthEnforcement('off').");

  return steps;
}

/* ================================================================== *
 * Helpers
 * ================================================================== */

function getOrCreateSubFolder(parentFolder, folderName) {
  var folders = parentFolder.getFoldersByName(folderName);
  if (folders.hasNext()) return folders.next();
  return parentFolder.createFolder(folderName);
}

function getOrCreateSpreadsheet(parentFolder, fileName, headers) {
  var files = parentFolder.getFilesByName(fileName);
  if (files.hasNext()) {
    return files.next(); // never overwrite an existing database
  }

  var ss = SpreadsheetApp.create(fileName);
  var sheet = ss.getActiveSheet();
  sheet.setName(fileName);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);

  DriveApp.getFileById(ss.getId()).moveTo(parentFolder);
  Logger.log('Created spreadsheet: ' + fileName);
  return ss;
}

/* ================================================================== *
 * Deployment self-check
 * ================================================================== */

/**
 * Run this in the Apps Script editor after pasting the files.
 *
 * It verifies that every required function is defined, Script Properties are
 * set, and every sheet is reachable with the expected columns.
 * READ ONLY - it writes nothing and changes nothing.
 *
 * Select `selfCheck` in the function dropdown, click Run, then open
 * View -> Logs (or the Execution log panel).
 */
function selfCheck() {
  var problems = [];
  var notes = [];
  var okCount = 0;

  // ---- 1. every function the runbook depends on ----
  var required = [
    'doGet', 'doPost', 'handleRequest', 'dispatch',
    'ApiError', 'createJsonResponse', 'auditLog', 'sanitiseCell', 'publicUser',
    'roleMayCallAction', 'canAccessRecord', 'canTransitionDeal', 'computeCommission',
    'validateLead', 'validateDeal', 'validateUser',
    'getSheetByName', 'getRecordsRaw', 'appendRecordRaw', 'updateRecordRaw', 'withLock',
    'getScopedRecords', 'markDealWon', 'convertLead', 'processCommission',
    'reviseCommission', 'createUserAccount', 'updateUserAccount', 'deactivateUser',
    'login', 'logout', 'resolveActor', 'authoriseAction', 'setUserPassword',
    'hashPassword', 'createSession', 'revokeAllSessionsForUser',
    'linkZoho', 'unlinkZoho', 'getZohoEmails', 'sendZohoEmail', 'buildZohoAuthUrl',
    'setupCRMDatabase', 'migrateDatabase', 'bootstrapPasswords', 'preflightCheck',
    'setAuthEnforcement', 'generateTemporaryPassword',
    'migrateLegacyPasswords', 'auditLegacyPasswordExposure',

    // ---- functions added by the overhaul, one or more per FILE ----
    //
    // The list above predates most of this work, so it passed whether or not
    // the newer code had been pasted — "all expected functions are defined"
    // read as proof of a good paste while saying nothing about six files
    // worth of changes. These are the newest function in each file, which is
    // what actually detects a file that was missed or pasted stale.
    //
    // api.gs
    'runBatch',
    // controllers.gs
    'rowsToRecords', 'getActivityFeed', 'explainFollowUpDelay',
    'guardStaleReschedule', 'followUpOverdueHours', 'getTeamOverview',
    'deleteLead', 'restoreLead', 'installRoleResolver', 'cachedSheetFileId',
    // utils.gs
    'isTrueFlag', 'toIsoTimestamp', 'getActionPolicy', 'filterWritableFields',
    // auth.gs
    'changePassword', 'getAuthEnforcement',
    // ZohoMail.gs
    'getStoredEmails', 'getEmailContent', 'findEmailLogRow', 'messageInvolves',
    'storeMessageBody', 'readMessageBody', 'syncMailbox', 'getEmailAnalytics',
    'getUnmatchedEmails', 'auditEmailLogAttribution', 'repairEmailLog',
    // setup.gs
    'getMainFolderId', 'buildNextSteps',
    // scheduled mailbox sync
    'syncMailboxForUser', 'syncAllMailboxes', 'syncAllMailboxesAction',
    'installMailSyncTrigger', 'removeMailSyncTrigger', 'mailSyncStatus',
    'readMailSyncState', 'writeMailSyncState', 'newSyncContext'
  ];

  var missingFns = [];
  for (var i = 0; i < required.length; i++) {
    if (typeof this[required[i]] !== 'function') missingFns.push(required[i]);
  }
  if (missingFns.length) {
    problems.push('Missing functions - a file was not pasted, or was pasted ' +
                  'incompletely: ' + missingFns.join(', '));
  } else {
    okCount++;
    notes.push('All ' + required.length + ' expected functions are defined.');
  }

  // ---- 1b. table entries the newest work added ----
  //
  // The check above proves a function NAME exists. It says nothing about a
  // file whose functions were EDITED rather than added — a stale ZohoMail.gs
  // or utils.gs passes it unchanged, which is exactly how a partial paste
  // slips through while the report reads "no problems found".
  //
  // These are entries in the lookup tables, one per file that carries them,
  // so re-pasting is verified by content and not merely by name.
  var tableChecks = [
    ['ERROR_CODES.ZOHO_REAUTH_REQUIRED',
     typeof ERROR_CODES !== 'undefined' && !!ERROR_CODES.ZOHO_REAUTH_REQUIRED, 'utils.gs'],
    ['ERROR_CODES.FOLLOWUP_REASON_REQUIRED',
     typeof ERROR_CODES !== 'undefined' && !!ERROR_CODES.FOLLOWUP_REASON_REQUIRED, 'utils.gs'],
    ['ACTION_POLICY.explainFollowUpDelay',
     typeof ACTION_POLICY !== 'undefined' && !!ACTION_POLICY.explainFollowUpDelay, 'utils.gs'],
    ['ACTION_POLICY.getEmailContent',
     typeof ACTION_POLICY !== 'undefined' && !!ACTION_POLICY.getEmailContent, 'utils.gs'],
    ['BATCHABLE_ACTIONS',
     typeof BATCHABLE_ACTIONS !== 'undefined' && BATCHABLE_ACTIONS.length > 0, 'api.gs'],
    ['Leads.FollowUpDelayReason in schema',
     typeof DATABASE_SCHEMA !== 'undefined' &&
       DATABASE_SCHEMA.Leads.indexOf('FollowUpDelayReason') !== -1, 'setup.gs'],
    ['EmailLog.FolderId in schema',
     typeof DATABASE_SCHEMA !== 'undefined' &&
       DATABASE_SCHEMA.EmailLog.indexOf('FolderId') !== -1, 'setup.gs'],
    ['ACTION_POLICY.syncAllMailboxes',
     typeof ACTION_POLICY !== 'undefined' && !!ACTION_POLICY.syncAllMailboxes, 'utils.gs']
  ];

  var staleFiles = [];
  for (var t = 0; t < tableChecks.length; t++) {
    if (!tableChecks[t][1]) {
      staleFiles.push(tableChecks[t][0] + ' (missing — re-paste ' + tableChecks[t][2] + ')');
    }
  }
  if (staleFiles.length) {
    problems.push('A file was pasted from an older copy: ' + staleFiles.join('; '));
  } else {
    okCount++;
    notes.push('All ' + tableChecks.length + ' expected table entries are present ' +
               '— every file is current, not just named correctly.');
  }

  // ---- 2. script properties ----
  var props = PropertiesService.getScriptProperties();

  if (props.getProperty('DB_FOLDER_ID')) okCount++;
  else problems.push('DB_FOLDER_ID is not set - run setupCRMDatabase() first.');

  // MAIN_FOLDER_ID is only read by setupCRMDatabase(), which an already
  // installed database never needs to run again. Reporting its absence as a
  // PROBLEM on a working installation sends people to run exactly the one
  // function that could repoint the CRM at an empty database.
  if (props.getProperty('MAIN_FOLDER_ID')) {
    okCount++;
  } else if (props.getProperty('DB_FOLDER_ID')) {
    notes.push('MAIN_FOLDER_ID is not set. Not needed: it is only used by ' +
               'setupCRMDatabase() for a first-time install, and this database ' +
               'is already installed.');
  } else {
    problems.push('MAIN_FOLDER_ID is not set, and no database exists yet.');
  }

  var enforcement = props.getProperty('AUTH_ENFORCEMENT') || '(unset - defaults to off)';
  notes.push('AUTH_ENFORCEMENT = ' + enforcement);

  var environment = props.getProperty('ENVIRONMENT') || '(unset - treated as production)';
  notes.push('ENVIRONMENT = ' + environment);

  if (!props.getProperty('ZOHO_CLIENT_ID') || !props.getProperty('ZOHO_CLIENT_SECRET')) {
    notes.push('Zoho is NOT configured - mail features will return a clear error.');
  } else {
    notes.push('Zoho credentials are present.');
  }

  // Left over from the deleted resetdatabase.gs. Nothing reads it any more,
  // but its presence signals a stale configuration worth cleaning up.
  if (props.getProperty('ALLOW_DESTRUCTIVE_RESET')) {
    notes.push('ALLOW_DESTRUCTIVE_RESET is set but obsolete — the bulk reset ' +
               'function was removed. Delete this property.');
  }

  // ---- 3. sheets and columns ----
  var counts = {};
  for (var sheetName in DATABASE_SCHEMA) {
    if (!Object.prototype.hasOwnProperty.call(DATABASE_SCHEMA, sheetName)) continue;
    try {
      var sheet = getSheetByName(sheetName);
      var lastCol = sheet.getLastColumn();
      var headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];

      // Row lookup finds ID BY NAME (headers.indexOf('ID')), so its position
      // is irrelevant. This previously demanded column A and reported
      // NOT READY for a database that works perfectly — contradicting
      // migrateDatabase(), which correctly calls the same sheet "supported".
      // Only ABSENCE is fatal.
      var idAt = -1;
      for (var h = 0; h < headers.length; h++) {
        if (String(headers[h]).trim() === 'ID') { idAt = h; break; }
      }

      if (idAt === -1) {
        problems.push(sheetName + ': no ID column. Rows in this sheet cannot ' +
                      'be addressed for update or deletion.');
      } else if (idAt !== 0) {
        notes.push(sheetName + ': ID is column ' + (idAt + 1) + ', not column A. ' +
                   'Supported — rows are located by column name. Worth knowing ' +
                   'only because the ORIGINAL backend compared column A and so ' +
                   'could never update this sheet at all.');
      }

      var expected = DATABASE_SCHEMA[sheetName];
      var missingCols = [];
      for (var c = 0; c < expected.length; c++) {
        if (headers.indexOf(expected[c]) === -1) missingCols.push(expected[c]);
      }
      if (missingCols.length) {
        problems.push(sheetName + ' is missing columns: ' + missingCols.join(', ') +
                      ' - run migrateDatabase()');
      }

      counts[sheetName] = Math.max(0, sheet.getLastRow() - 1);
      okCount++;
    } catch (e) {
      problems.push(sheetName + ' is unreachable: ' + e.message);
    }
  }

  // ---- 4. password readiness ----
  try {
    var users = getRecordsRaw('Users');
    var active = 0, withPw = 0, supers = 0, mustChange = 0;
    for (var u = 0; u < users.length; u++) {
      if (String(users[u].Status) !== 'Active') continue;
      active++;
      if (users[u].PasswordHash) withPw++;
      if (String(users[u].Role) === 'SUPER_ADMIN') supers++;
      if (isTrueFlag(users[u].MustChangePassword)) mustChange++;
    }
    notes.push('Active users: ' + active + ' | with a password: ' + withPw +
               ' | must change at next login: ' + mustChange);
    notes.push('Active SUPER_ADMINs: ' + supers);

    if (!supers) problems.push('No active SUPER_ADMIN exists.');
    if (enforcement === 'on' && withPw < active) {
      problems.push('AUTH_ENFORCEMENT is on but ' + (active - withPw) +
                    ' active user(s) have no password and are locked out. ' +
                    'Run bootstrapPasswords(), or set AUTH_ENFORCEMENT back to off.');
    }
  } catch (e) {
    problems.push('Could not inspect Users: ' + e.message);
  }

  // ---- 5. round-trip the router without touching data ----
  try {
    var probe = doPost({
      postData: { contents: JSON.stringify({ action: 'login', payload: {} }) },
      parameter: {}
    });
    var body = JSON.parse(probe.getContent());
    if (body.status === 'error' && body.code) {
      notes.push('Router returned a structured error for an empty login (code ' +
                 body.code + ') - routing and the error model are wired.');
      okCount++;
    } else {
      problems.push('Router did not return a structured error for an empty login.');
    }
  } catch (e) {
    problems.push('doPost threw instead of returning an error: ' + e.message);
  }

  // ---- report ----
  Logger.log('==================================================');
  Logger.log(' TJGROUPS CRM - DEPLOYMENT SELF-CHECK');
  Logger.log('==================================================');
  Logger.log('');
  Logger.log('RECORD COUNTS');
  for (var k in counts) {
    if (Object.prototype.hasOwnProperty.call(counts, k)) {
      Logger.log('  ' + k + ': ' + counts[k]);
    }
  }
  Logger.log('');
  Logger.log('CONFIGURATION');
  for (var n = 0; n < notes.length; n++) Logger.log('  ' + notes[n]);
  Logger.log('');

  if (problems.length) {
    Logger.log('PROBLEMS (' + problems.length + ')');
    for (var p = 0; p < problems.length; p++) Logger.log('  [X] ' + problems[p]);
    Logger.log('');
    Logger.log('RESULT: NOT READY - fix the items above, then run selfCheck() again.');
  } else {
    Logger.log('RESULT: OK - ' + okCount + ' checks passed, no problems found.');
  }
  Logger.log('==================================================');

  return { ok: problems.length === 0, problems: problems, notes: notes, counts: counts };
}

/* ================================================================== *
 * Legacy plaintext password migration
 * ================================================================== */

/**
 * Convert existing CLEAR-TEXT passwords in the legacy `Password` column into
 * salted hashes, then blank the clear-text cell.
 *
 * WHY THIS EXISTS
 * ---------------
 * The live Users sheet carries a `Password` column that setup.gs never
 * declared — it was added by hand. It holds readable passwords. Because the
 * original getUsers returned every column of every row, and the web app is
 * deployed with "Anyone" access, those passwords were retrievable by anyone
 * holding the deployment URL.
 *
 * Running this is strictly better than bootstrapPasswords() for these
 * accounts: everyone keeps the password they already know, the clear text
 * stops existing, and each account is flagged for a mandatory change because
 * the old value must be treated as exposed.
 *
 * SAFETY
 *  - only touches rows whose PasswordHash is still empty
 *  - never changes ID, Username, Role, Team, Status or any other column
 *  - blanks only the legacy clear-text cell, and only after the hash is
 *    written and verified
 *  - never prints a password to the log
 *  - safe to re-run: already-migrated rows are skipped
 *
 * LENGTH POLICY
 * Some existing passwords are shorter than the new 10-character minimum.
 * Rejecting them would lock those people out, so the hash is written directly
 * (bypassing the new-password policy) and MustChangePassword is set, which
 * forces a compliant password at first change.
 */
function migrateLegacyPasswords() {
  var users = getRecordsRaw('Users');

  var migrated = 0, skipped = 0, alreadyHashed = 0, noPassword = 0, failed = 0;
  var shortOnes = 0;
  var report = [];

  for (var i = 0; i < users.length; i++) {
    var u = users[i];

    if (u.PasswordHash) { alreadyHashed++; continue; }

    var legacy = u.Password === undefined || u.Password === null ? '' : String(u.Password);
    if (!legacy.trim()) { noPassword++; continue; }

    // Already a hash sitting in the wrong column? Do not re-hash it.
    if (/^[0-9a-f]{64}$/i.test(legacy)) {
      report.push({ username: u.Username, outcome: 'looks already hashed - left for manual review' });
      skipped++;
      continue;
    }

    try {
      var salt = newSalt();
      var iterations = getPasswordIterations();
      var hash = hashPassword(legacy, salt, iterations);

      updateRecordRaw('Users', u.ID, {
        PasswordHash: hash,
        PasswordSalt: salt,
        PasswordIterations: iterations,
        PasswordUpdatedAt: new Date().toISOString(),
        FailedLoginCount: 0,
        LockedUntil: '',
        // The old value was readable by anyone with the deployment URL.
        MustChangePassword: 'TRUE'
      });

      // Confirm the hash verifies BEFORE destroying the clear text.
      var check = getRecordByIdRaw('Users', u.ID);
      if (!verifyPassword(check, legacy)) {
        failed++;
        report.push({ username: u.Username, outcome: 'HASH DID NOT VERIFY - clear text left in place' });
        continue;
      }

      // Now it is safe to remove the clear text.
      updateRecordRaw('Users', u.ID, { Password: '' });

      if (legacy.length < PASSWORD_MIN) shortOnes++;
      migrated++;
      report.push({
        username: u.Username,
        outcome: 'migrated' + (legacy.length < PASSWORD_MIN ? ' (below new minimum - change required)' : '')
      });

      auditLog({
        entityId: u.ID, entityType: 'User', action: 'PASSWORD_MIGRATED',
        userId: 'SYSTEM',
        details: 'Legacy clear-text password hashed and removed; change required at next login.'
      });
    } catch (e) {
      failed++;
      report.push({ username: u.Username, outcome: 'ERROR: ' + e.message });
    }
  }

  Logger.log('==================================================');
  Logger.log(' LEGACY PASSWORD MIGRATION');
  Logger.log('==================================================');
  Logger.log(' migrated            : ' + migrated);
  Logger.log(' already hashed      : ' + alreadyHashed);
  Logger.log(' no password set     : ' + noPassword);
  Logger.log(' skipped for review  : ' + skipped);
  Logger.log(' failed              : ' + failed);
  Logger.log(' below new minimum   : ' + shortOnes + ' (must change at next login)');
  Logger.log('');
  Logger.log(' No password value is printed by this function.');
  Logger.log('');
  for (var r = 0; r < report.length; r++) {
    Logger.log('   ' + report[r].username + ' -> ' + report[r].outcome);
  }
  Logger.log('');
  if (failed > 0) {
    Logger.log(' ACTION REQUIRED: ' + failed + ' row(s) failed. Their clear text was');
    Logger.log(' deliberately left in place. Investigate before continuing.');
  } else if (migrated > 0) {
    Logger.log(' Everyone keeps their existing password. All migrated accounts are');
    Logger.log(' flagged MustChangePassword because the old value was exposed.');
    Logger.log(' Consider deleting the now-empty legacy Password column by hand.');
  }
  Logger.log('==================================================');

  return {
    migrated: migrated, alreadyHashed: alreadyHashed, noPassword: noPassword,
    skipped: skipped, failed: failed, belowMinimum: shortOnes
  };
}

/**
 * Report whether readable passwords still exist, without printing any.
 * Safe to run at any time.
 */
function auditLegacyPasswordExposure() {
  var users = getRecordsRaw('Users');
  var plain = 0, hashed = 0, none = 0;

  for (var i = 0; i < users.length; i++) {
    var legacy = users[i].Password === undefined ? '' : String(users[i].Password);
    if (legacy.trim() && !/^[0-9a-f]{64}$/i.test(legacy)) plain++;
    if (users[i].PasswordHash) hashed++;
    if (!legacy.trim() && !users[i].PasswordHash) none++;
  }

  var result = {
    usersWithReadablePassword: plain,
    usersWithHashedPassword: hashed,
    usersWithNoPassword: none,
    clean: plain === 0
  };

  Logger.log(JSON.stringify(result, null, 2));
  if (plain > 0) {
    Logger.log('');
    Logger.log(plain + ' account(s) still hold a readable password in the sheet.');
    Logger.log('Run migrateLegacyPasswords() to hash and remove them.');
  }
  return result;
}

/* ================================================================== *
 * Scheduled mailbox sync
 * ================================================================== */

/** One trigger, identified by the function it runs. */
var MAIL_SYNC_HANDLER = 'syncAllMailboxes';

/**
 * Install the hourly mailbox sync.
 *
 * Run this ONCE from the editor. Safe to run again — it removes any existing
 * copy first, so repeated runs never stack up duplicate triggers quietly
 * multiplying the quota spend.
 *
 * Hourly rather than every few minutes on purpose. Each run costs one Zoho
 * listing per linked mailbox against a free-tier budget, and the bookmarks
 * mean a run with no new mail is nearly free — but "nearly free" times 288
 * runs a day is not.
 */
function installMailSyncTrigger() {
  removeMailSyncTrigger();
  ScriptApp.newTrigger(MAIL_SYNC_HANDLER).timeBased().everyHours(1).create();
  Logger.log('Installed: ' + MAIL_SYNC_HANDLER + ' runs every hour.');
  Logger.log('Remove it with removeMailSyncTrigger().');
  return listMailSyncTriggers();
}

/** Remove the sync trigger. Mail still syncs when someone opens a lead. */
function removeMailSyncTrigger() {
  var all = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < all.length; i++) {
    if (all[i].getHandlerFunction() === MAIL_SYNC_HANDLER) {
      ScriptApp.deleteTrigger(all[i]);
      removed++;
    }
  }
  if (removed) Logger.log('Removed ' + removed + ' existing sync trigger(s).');
  return removed;
}

/** What is currently scheduled — read-only. */
function listMailSyncTriggers() {
  var all = ScriptApp.getProjectTriggers();
  var mine = [];
  for (var i = 0; i < all.length; i++) {
    if (all[i].getHandlerFunction() === MAIL_SYNC_HANDLER) {
      mine.push({ id: all[i].getUniqueId(), handler: all[i].getHandlerFunction() });
    }
  }
  Logger.log(mine.length
    ? mine.length + ' mailbox-sync trigger(s) installed.'
    : 'No mailbox-sync trigger installed. Run installMailSyncTrigger().');
  return mine;
}

/**
 * What the last sync did for each person, without running anything.
 *
 * Reads the bookmarks the sync leaves behind, so a mailbox that has quietly
 * stopped working — a revoked Zoho token, most often — is visible here rather
 * than only showing up as mail nobody notices is missing.
 */
function mailSyncStatus() {
  var users = getRecordsRaw('Users');
  var rows = [];

  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    if (String(u.Status || '') !== 'Active') continue;
    if (!String(u.ZohoRefreshToken || '')) {
      rows.push({ username: String(u.Username || ''), state: 'no mailbox linked' });
      continue;
    }
    var s = readMailSyncState(String(u.ID));
    rows.push({
      username: String(u.Username || ''),
      lastSyncAt: s.lastSyncAt || 'never',
      problem: s.lastError || ''
    });
  }

  Logger.log('MAILBOX SYNC STATUS');
  for (var r = 0; r < rows.length; r++) {
    Logger.log('  ' + JSON.stringify(rows[r]));
  }
  return rows;
}
