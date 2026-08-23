/**
 * Migration safety.
 *
 * These tests build a database with the ORIGINAL production schema, fill it
 * with realistic records, then run the new migration over it. They exist to
 * answer one question: does deploying this change destroy or corrupt live
 * CRM data?
 *
 * Run: node --test local/tests/migration.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBackend } from '../harness/backend.mjs';
import { ID } from '../fixtures/dataset.mjs';
import { buildScenario } from '../harness/scenario.mjs';

/** The exact schema the CRM shipped with, before this work. */
const LEGACY_SCHEMA = {
  Users: ['ID', 'Username', 'Role', 'Team', 'Status', 'Availability', 'ZohoEmail', 'ZohoRefreshToken', 'CreatedAt', 'UpdatedAt'],
  Leads: ['ID', 'Name', 'Email', 'Phone', 'Status', 'OwnerRepId', 'SetterId', 'CloserId', 'Notes', 'Linkedin', 'NextFollowUp', 'CreatedAt', 'UpdatedAt'],
  Deals: ['ID', 'LeadId', 'Value', 'Status', 'OwnerRepId', 'SetterId', 'CloserId', 'CreatedAt', 'UpdatedAt'],
  Projects: ['ID', 'ClientName', 'Status', 'OwnerRepId', 'AccountManagerId', 'LiaisonId', 'StartDate', 'DueDate', 'CreatedAt', 'UpdatedAt'],
  AdminRequests: ['ID', 'Type', 'RelatedDealId', 'RequestedBy', 'Status', 'CreatedAt', 'UpdatedAt'],
  Commissions: ['ID', 'DealId', 'SetterId', 'SetterAmount', 'CloserId', 'CloserAmount', 'PayoutStatus', 'CreatedAt', 'UpdatedAt'],
  Logs: ['ID', 'EntityId', 'EntityType', 'Action', 'UserId', 'Details', 'Metadata', 'Timestamp'],
};

/**
 * Stand up a backend whose sheets look exactly like the live system:
 * legacy headers, legacy rows, no Sessions sheet, no password columns.
 */
function legacyDatabase() {
  const be = loadBackend({ scriptProperties: { PASSWORD_ITERATIONS: '100' } });

  // Create the Drive folder + files the way setup does, but with old headers.
  const root = be.context.DriveApp.getFolderById(be.env.ROOT_FOLDER_ID);
  const dbFolder = root.createFolder('Databases');
  be.setProp('DB_FOLDER_ID', dbFolder.getId());

  for (const [name, headers] of Object.entries(LEGACY_SCHEMA)) {
    const ss = be.context.SpreadsheetApp.create(name);
    const sheet = be.store.getSheet(name);
    sheet.rows = [headers.slice()];
    be.context.DriveApp.getFileById(ss.getId()).moveTo(dbFolder);
  }

  // Realistic legacy content, including the odd values seed.mjs produced.
  be.store.insert('Users', {
    ID: ID.superAdmin, Username: 'super_admin', Role: 'SUPER_ADMIN', Team: 'Management',
    Status: 'Active', Availability: 'Available', ZohoEmail: 'super@tjgroups.test',
    ZohoRefreshToken: 'legacy-refresh-token', CreatedAt: '2025-06-01T10:00:00.000Z',
    UpdatedAt: '2025-06-01T10:00:00.000Z',
  });
  be.store.insert('Users', {
    ID: ID.repAlpha1, Username: 'sales_rep_1', Role: 'SALES_REP', Team: 'Alpha',
    Status: 'Active', Availability: 'Busy', ZohoEmail: '', ZohoRefreshToken: '',
    CreatedAt: '2025-06-02T10:00:00.000Z', UpdatedAt: '2025-06-02T10:00:00.000Z',
  });
  be.store.insert('Leads', {
    ID: ID.leadAlphaNew, Name: 'Legacy Client', Email: 'legacy@client.test',
    Phone: '+15550199', Status: 'Contacted', OwnerRepId: ID.repAlpha1,
    SetterId: '', CloserId: '', Notes: 'Existing production note.',
    Linkedin: '', NextFollowUp: '', CreatedAt: '2025-06-03T10:00:00.000Z',
    UpdatedAt: '2025-06-04T10:00:00.000Z',
  });
  be.store.insert('Deals', {
    // 'Closed Won' is a real legacy value written by seed.mjs.
    ID: ID.dealAlphaWon, LeadId: ID.leadAlphaNew, Value: 45000, Status: 'Closed Won',
    OwnerRepId: ID.repAlpha1, SetterId: '', CloserId: '',
    CreatedAt: '2025-06-05T10:00:00.000Z', UpdatedAt: '2025-06-06T10:00:00.000Z',
  });
  be.store.insert('Commissions', {
    ID: ID.commAlphaPaid, DealId: ID.dealAlphaWon, SetterId: ID.repAlpha1,
    SetterAmount: 2250, CloserId: ID.repAlpha1, CloserAmount: 4500,
    PayoutStatus: 'Paid', CreatedAt: '2025-06-06T10:00:00.000Z',
    UpdatedAt: '2025-06-06T10:00:00.000Z',
  });
  be.store.insert('Logs', {
    ID: '77777777-7777-4777-a777-777777777799', EntityId: ID.leadAlphaNew,
    EntityType: 'Lead', Action: 'CREATED', UserId: ID.repAlpha1,
    Details: 'Historic audit entry', Metadata: '', Timestamp: '2025-06-03T10:00:00.000Z',
  });

  return be;
}

const realRows = (be, sheet) =>
  be.store.toObjects(sheet).filter((r) => String(r.ID || '').length > 0);

test('MIGRATE-1: migration preserves every existing record and ID', () => {
  const be = legacyDatabase();

  const before = {
    Users: realRows(be, 'Users'),
    Leads: realRows(be, 'Leads'),
    Deals: realRows(be, 'Deals'),
    Commissions: realRows(be, 'Commissions'),
    Logs: realRows(be, 'Logs'),
  };

  be.call('migrateDatabase');

  for (const [sheet, rows] of Object.entries(before)) {
    const after = realRows(be, sheet);
    assert.equal(after.length, rows.length, `${sheet}: row count unchanged`);
    for (const original of rows) {
      const match = after.find((r) => r.ID === original.ID);
      assert.ok(match, `${sheet}: record ${original.ID} still present`);
      // Every original field keeps its original value.
      for (const [k, v] of Object.entries(original)) {
        assert.equal(match[k], v, `${sheet}.${k} preserved for ${original.ID}`);
      }
    }
  }
});

test('MIGRATE-2: existing columns keep their position; new ones are appended', () => {
  const be = legacyDatabase();
  const beforeHeaders = Object.fromEntries(
    Object.keys(LEGACY_SCHEMA).map((n) => [n, be.store.getSheet(n).headers])
  );

  be.call('migrateDatabase');

  for (const [name, original] of Object.entries(beforeHeaders)) {
    const after = be.store.getSheet(name).headers;
    assert.deepEqual(
      after.slice(0, original.length), original,
      `${name}: original columns unmoved (updateRecordRaw locates rows by column A)`
    );
    assert.equal(after[0], 'ID', `${name}: ID is still column A`);
  }
});

test('MIGRATE-3: the required new columns actually arrive', () => {
  const be = legacyDatabase();
  be.call('migrateDatabase');

  const expect = {
    Users: ['PasswordHash', 'PasswordSalt', 'PasswordIterations', 'LockedUntil'],
    Projects: ['DealId', 'Notes'],
    AdminRequests: ['Notes', 'PaymentLink', 'DocumentUrl'],
    Commissions: ['PayoutDate'],
    Logs: ['RequestId'],
  };

  for (const [sheet, cols] of Object.entries(expect)) {
    const headers = be.store.getSheet(sheet).headers;
    for (const col of cols) {
      assert.ok(headers.includes(col), `${sheet} gained ${col}`);
    }
  }
});

test('MIGRATE-4: running the migration twice changes nothing', () => {
  const be = legacyDatabase();

  const first = be.call('migrateDatabase');
  const headersAfterFirst = Object.fromEntries(
    be.store.listSheets().map((n) => [n, be.store.getSheet(n).headers])
  );
  const rowsAfterFirst = realRows(be, 'Leads').length;

  const second = be.call('migrateDatabase');

  // NOTE: values returned from the backend are constructed inside the vm
  // realm, so their prototypes differ from Node's. assert.deepStrictEqual
  // compares prototypes and would fail on two empty objects. Compare
  // structurally instead.
  assert.equal(Object.keys(second.added).length, 0, 'second run adds no columns');
  assert.equal(second.created.length, 0, 'second run creates no sheets');
  assert.ok(second.unchanged.length > 0, 'second run reports sheets as unchanged');
  assert.ok(Object.keys(first.added).length > 0, 'first run did do work');

  for (const [name, headers] of Object.entries(headersAfterFirst)) {
    assert.deepEqual(be.store.getSheet(name).headers, headers, `${name} headers stable`);
  }
  assert.equal(realRows(be, 'Leads').length, rowsAfterFirst, 'no duplicated rows');
});

test('MIGRATE-5: setupCRMDatabase never recreates existing sheets', () => {
  const be = legacyDatabase();
  const leadsBefore = realRows(be, 'Leads');

  be.call('setupCRMDatabase');

  const leadsAfter = realRows(be, 'Leads');
  assert.equal(leadsAfter.length, leadsBefore.length, 'lead data intact');
  assert.equal(leadsAfter[0].Notes, 'Existing production note.', 'content intact');
  assert.ok(be.store.hasSheet('Sessions'), 'the new Sessions sheet was created');
});

test('MIGRATE-6: legacy status values remain readable and are normalised', () => {
  const be = legacyDatabase();
  be.call('setupCRMDatabase');

  // 'Closed Won' must still be understood as Won by the finance aggregate.
  const kpis = be.call('getFinancialKPIs');
  assert.equal(kpis.totalValue, 45000, 'legacy "Closed Won" counts as won revenue');

  assert.equal(be.call('normaliseDealStatus', 'Closed Won'), 'Won');
  assert.equal(be.call('normaliseDealStatus', 'Proposal Sent'), 'Open');
  assert.equal(be.call('normaliseProjectStatus', 'In Progress'), 'InProgress');
});

test('MIGRATE-7: the pre-flight check blocks enforcement until passwords exist', () => {
  const be = legacyDatabase();
  be.call('setupCRMDatabase');

  const before = be.call('preflightCheck');
  assert.equal(before.readyToEnforce, false, 'not ready while accounts lack passwords');
  assert.ok(
    before.blockingIssues.some((i) => /no password/i.test(i)),
    'the reason is stated explicitly'
  );

  be.call('bootstrapPasswords');

  const after = be.call('preflightCheck');
  assert.equal(after.readyToEnforce, true, 'ready once passwords are bootstrapped');
  assert.equal(after.usersWithPassword, after.activeUsers);
});

test('MIGRATE-8: bootstrapped passwords work and are never persisted in clear text', () => {
  const be = legacyDatabase();
  be.call('setupCRMDatabase');
  be.call('bootstrapPasswords');

  // The temporary passwords are printed to the execution log only.
  const logLine = be.env.logs.find((l) => l.includes('super_admin'));
  assert.ok(logLine, 'the temporary password was reported to the operator');
  const temp = logLine.split('->')[1].trim();

  // It is usable...
  be.call('setAuthEnforcement', 'on');
  const ok = be.post({ action: 'login', payload: { username: 'super_admin', password: temp } });
  assert.equal(ok.status, 'success', 'the temporary password authenticates');

  // ...but nowhere in the sheet.
  const row = realRows(be, 'Users').find((u) => u.Username === 'super_admin');
  assert.ok(!Object.values(row).some((v) => String(v) === temp), 'clear text never stored');
  assert.ok(String(row.PasswordHash).length > 0, 'a hash is stored instead');
});

test('MIGRATE-9: the legacy frontend keeps working immediately after migration', () => {
  const be = legacyDatabase();
  be.call('setupCRMDatabase');
  // AUTH_ENFORCEMENT defaults to 'off' — the deploy-safe state.

  const leads = be.get({ action: 'getLeads' });
  assert.equal(leads.status, 'success', 'unauthenticated read still works');
  assert.equal(leads.data.length, 1);

  const created = be.post({
    action: 'createLead',
    payload: { Name: 'Post-migration lead', Status: 'New' },
  });
  assert.equal(created.status, 'success', 'unauthenticated write still works');
});

test('MIGRATE-10: the stored refresh token survives migration but stops being served', () => {
  const be = legacyDatabase();
  be.call('setupCRMDatabase');

  // Still in the sheet, so mail integration keeps working.
  const row = realRows(be, 'Users').find((u) => u.ID === ID.superAdmin);
  assert.equal(row.ZohoRefreshToken, 'legacy-refresh-token');

  // But no longer handed to the browser.
  const res = be.get({ action: 'getUsers' });
  assert.equal(res.status, 'success');
  assert.ok(!JSON.stringify(res.data).includes('legacy-refresh-token'));
});

/* ================================================================== *
 * Temporary-password properties (see docs/DEPLOYMENT.md §4)
 * ================================================================== */

test('MIGRATE-11: temporary passwords are uniform over the full alphabet', () => {
  const be = legacyDatabase();
  be.call('setupCRMDatabase');

  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const LENGTH = 16;
  const perPosition = Array.from({ length: LENGTH }, () => new Set());
  const all = new Set();

  for (let i = 0; i < 1500; i++) {
    const pw = be.call('generateTemporaryPassword');
    assert.equal(pw.length, LENGTH, 'fixed length');
    all.add(pw);
    for (let j = 0; j < pw.length; j++) {
      assert.ok(ALPHABET.includes(pw[j]), `character ${pw[j]} is in the alphabet`);
      perPosition[j].add(pw[j]);
    }
  }

  assert.equal(all.size, 1500, 'no collisions across 1500 draws');

  // The previous generator produced only 16 distinct characters at most
  // positions and three CONSTANT positions (a fixed "q7" suffix). Every
  // position must now vary widely.
  perPosition.forEach((set, i) => {
    assert.ok(set.size > 40, `position ${i} used ${set.size} distinct characters (expected > 40)`);
  });
});

test('MIGRATE-12: bootstrapped passwords are flagged for mandatory change', () => {
  const be = legacyDatabase();
  be.call('setupCRMDatabase');
  be.call('bootstrapPasswords');
  be.call('setAuthEnforcement', 'on');

  const row = realRows(be, 'Users').find((u) => u.Username === 'super_admin');
  assert.ok(be.call('isTrueFlag', row.MustChangePassword), 'flagged at bootstrap');

  const temp = be.env.logs.find((l) => l.includes('super_admin')).split('->')[1].trim();
  const login = be.post({ action: 'login', payload: { username: 'super_admin', password: temp } });

  assert.equal(login.status, 'success');
  assert.equal(login.data.mustChangePassword, true, 'login tells the client a change is required');

  // Choosing your own password clears the flag.
  const changed = be.post({
    action: 'changePassword',
    token: login.data.token,
    payload: { currentPassword: temp, newPassword: 'MyOwnPassword99' },
  });
  assert.equal(changed.status, 'success');

  const after = realRows(be, 'Users').find((u) => u.Username === 'super_admin');
  assert.equal(String(after.MustChangePassword || ''), '', 'flag cleared');

  const relogin = be.post({
    action: 'login', payload: { username: 'super_admin', password: 'MyOwnPassword99' },
  });
  assert.equal(relogin.data.mustChangePassword, false);
});

test('MIGRATE-13: a client cannot clear the must-change flag itself', () => {
  const be = legacyDatabase();
  be.call('setupCRMDatabase');
  be.call('bootstrapPasswords');
  be.call('setAuthEnforcement', 'on');

  const temp = be.env.logs.find((l) => l.includes('super_admin')).split('->')[1].trim();
  const token = be.post({
    action: 'login', payload: { username: 'super_admin', password: temp },
  }).data.token;

  const su = realRows(be, 'Users').find((u) => u.Username === 'super_admin');
  be.post({
    action: 'updateUser', token,
    payload: { id: su.ID, MustChangePassword: '', PasswordHash: 'forged' },
  });

  const after = realRows(be, 'Users').find((u) => u.Username === 'super_admin');
  assert.ok(be.call('isTrueFlag', after.MustChangePassword), 'still flagged — field is server-owned');
  assert.notEqual(after.PasswordHash, 'forged', 'hash cannot be written by a client');
});

/* ================================================================== *
 * setupCRMDatabase must never orphan a live database
 * ================================================================== */

test('SETUP-GUARD-1: it refuses to repoint DB_FOLDER_ID at an empty folder', () => {
  const be = buildScenario();
  const props = be.props();
  const liveDbId = props.getProperty('DB_FOLDER_ID');

  assert.ok(liveDbId, 'the scenario should already have a database');
  assert.ok(be.rows('Leads').filter((r) => String(r.ID || '')).length > 0,
    'the scenario database should contain records');

  // Point MAIN_FOLDER_ID at a DIFFERENT parent, as someone would if they
  // pasted the wrong id or reused a note from first-time setup.
  const other = be.env.DriveApp.getRootFolder().createFolder('Some Other Home');
  props.setProperty('MAIN_FOLDER_ID', other.getId());

  assert.throws(
    () => be.call('setupCRMDatabase'),
    /REFUSING TO RUN/,
    'setupCRMDatabase repointed a populated database instead of refusing'
  );

  // The live database is still the one in use, and still intact.
  assert.equal(props.getProperty('DB_FOLDER_ID'), liveDbId,
    'DB_FOLDER_ID was changed despite the refusal');
  assert.ok(be.rows('Leads').filter((r) => String(r.ID || '')).length > 0,
    'records became unreachable');
});

test('SETUP-GUARD-2: re-running against the SAME folder is still safe', () => {
  const be = buildScenario();
  const props = be.props();
  const liveDbId = props.getProperty('DB_FOLDER_ID');
  const leadsBefore = be.rows('Leads').filter((r) => String(r.ID || '')).length;

  // MAIN_FOLDER_ID correctly names the parent of the real Databases folder,
  // which is the ordinary idempotent case the runbook has always claimed.
  props.setProperty('MAIN_FOLDER_ID', be.env.ROOT_FOLDER_ID);

  be.call('setupCRMDatabase');

  assert.equal(props.getProperty('DB_FOLDER_ID'), liveDbId, 'the database moved');
  assert.equal(be.rows('Leads').filter((r) => String(r.ID || '')).length, leadsBefore,
    'records were lost by a repeat run');
});

test('SETUP-GUARD-3: migrateDatabase needs only DB_FOLDER_ID', () => {
  const be = buildScenario();
  const props = be.props();

  // Exactly the state of the live project: a database is installed, and
  // MAIN_FOLDER_ID was never set.
  props.deleteProperty('MAIN_FOLDER_ID');
  assert.ok(props.getProperty('DB_FOLDER_ID'), 'DB_FOLDER_ID should be set');

  const leadsBefore = be.rows('Leads').filter((r) => String(r.ID || '')).length;

  const report = be.call('migrateDatabase');
  assert.ok(report, 'migrateDatabase returned nothing');
  assert.equal(be.rows('Leads').filter((r) => String(r.ID || '')).length, leadsBefore,
    'migration changed the record count');
});

test('SETUP-GUARD-4: selfCheck does not call a missing MAIN_FOLDER_ID a problem', () => {
  const be = buildScenario();
  be.props().deleteProperty('MAIN_FOLDER_ID');

  const report = be.call('selfCheck');
  const text = JSON.stringify(report);

  // It should be mentioned as a note, never as something to go and fix — the
  // fix would be to run the one function that can orphan the database.
  assert.ok(!/problem[^"]*MAIN_FOLDER_ID/i.test(text) ||
            /only used by setupCRMDatabase/i.test(text),
    'selfCheck still reports MAIN_FOLDER_ID as a problem on a working install');
});

/* ================================================================== *
 * preflightCheck must give advice that is safe to follow
 * ================================================================== */

test('PREFLIGHT-1: a missing sheet points at migrateDatabase, never setupCRMDatabase', () => {
  // The real situation: an installed database that predates Sessions/EmailLog.
  const be = legacyDatabase();

  const report = be.call('preflightCheck');
  const text = JSON.stringify(report);

  assert.ok(/migrateDatabase/.test(text), 'it must name the function that fixes this');
  assert.ok(!/Run setupCRMDatabase\(\)\./.test(text),
    'preflightCheck told the operator to run setupCRMDatabase() on an installed ' +
    'database — the one call that can repoint DB_FOLDER_ID and hide every record');

  // Compared by value: arrays built inside the vm are not reference-equal to
  // arrays out here, so deepEqual on them is misleading.
  const missing = [...report.missingSheets].sort();
  assert.ok(missing.includes('Sessions'), `Sessions not reported: ${missing.join(', ')}`);
  assert.ok(missing.includes('EmailLog'), `EmailLog not reported: ${missing.join(', ')}`);
  assert.equal(report.sessionsSheet, 'missing');
});

test('PREFLIGHT-2: readable passwords are surfaced and hashing is recommended first', () => {
  const be = legacyDatabase();

  // The live Users sheet shape: a plaintext Password column, no hash columns.
  const users = be.store.getSheet('Users');
  users.rows[0].push('Password');
  for (let r = 1; r < users.rows.length; r++) users.rows[r].push('Sunshine2024');

  const report = be.call('preflightCheck');
  const text = JSON.stringify(report);

  assert.ok(report.usersWithReadablePassword > 0,
    'readable passwords in the sheet were not reported at all');
  assert.ok(/migrateLegacyPasswords/.test(text),
    'it must recommend hashing what people already know');

  // Ordering matters: hash the existing ones BEFORE issuing new ones, or
  // everybody gets a temporary password they did not need.
  const steps = report.nextSteps.join('\n');
  const hashAt = steps.indexOf('migrateLegacyPasswords');
  const issueAt = steps.indexOf('bootstrapPasswords');
  assert.ok(hashAt !== -1, 'migrateLegacyPasswords missing from the steps');
  assert.ok(issueAt === -1 || hashAt < issueAt,
    'bootstrapPasswords was recommended before migrateLegacyPasswords');
});

test('PREFLIGHT-3: with nothing to preserve it recommends issuing passwords', () => {
  const be = buildScenario();
  for (const u of be.rows('Users')) {
    if (!String(u.ID || '')) continue;
    be.call('updateRecordRaw', 'Users', u.ID, { PasswordHash: '', Password: '' });
  }

  const report = be.call('preflightCheck');
  assert.equal(report.usersWithReadablePassword, 0);
  assert.ok(/bootstrapPasswords/.test(JSON.stringify(report)));
  assert.equal(report.readyToEnforce, false);
});

test('PREFLIGHT-4: the steps always end at deploy and enforcement', () => {
  const be = buildScenario();
  const steps = be.call('preflightCheck').nextSteps.join('\n');

  assert.ok(/selfCheck/.test(steps), 'selfCheck is missing from the steps');
  assert.ok(/Manage deployments/.test(steps),
    'the deploy step must say to EDIT the existing deployment');
  assert.ok(/Do NOT create a new deployment/.test(steps),
    'the steps must warn against a new deployment changing the /exec URL');
  assert.ok(/setAuthEnforcement\('on'\)/.test(steps));
});

test('PREFLIGHT-5: preflightCheck changes nothing at all', () => {
  const be = legacyDatabase();

  const snapshot = () => JSON.stringify({
    sheets: be.store.listSheets().sort(),
    users: be.rows('Users'),
    leads: be.rows('Leads'),
    deals: be.rows('Deals'),
    props: ['DB_FOLDER_ID', 'PASSWORD_PEPPER', 'AUTH_ENFORCEMENT',
            'CONTACT_MODE_TRACKING_SINCE', 'MAIN_FOLDER_ID']
      .map((k) => `${k}=${be.props().getProperty(k)}`),
  });

  const before = snapshot();
  be.call('preflightCheck');
  be.call('preflightCheck');
  const after = snapshot();

  assert.equal(after, before,
    'preflightCheck wrote something. It is a report: it must be safe to run ' +
    'against production as many times as you like, before deciding anything.');
});

test('PREFLIGHT-6: migrateDatabase creates every missing sheet in one run', () => {
  const be = legacyDatabase();

  const missingBefore = [...be.call('preflightCheck').missingSheets];
  assert.ok(missingBefore.length > 0, 'the legacy database should be missing sheets');

  const usersBefore = be.rows('Users').length;
  const leadsBefore = be.rows('Leads').length;

  be.call('migrateDatabase');

  const missingAfter = [...be.call('preflightCheck').missingSheets];
  assert.equal(missingAfter.length, 0,
    `still missing after migrateDatabase(): ${missingAfter.join(', ')}`);

  // And nothing that already existed was disturbed.
  assert.equal(be.rows('Users').length, usersBefore, 'user rows changed');
  assert.equal(be.rows('Leads').length, leadsBefore, 'lead rows changed');
});

test('PREFLIGHT-7: migrateDatabase is safe to run twice', () => {
  const be = legacyDatabase();
  be.call('migrateDatabase');

  const sheetsAfterFirst = be.store.listSheets().sort().join(',');
  const usersAfterFirst = JSON.stringify(be.rows('Users'));

  const second = be.call('migrateDatabase');

  assert.equal(be.store.listSheets().sort().join(','), sheetsAfterFirst,
    'a second run created or removed a sheet');
  assert.equal(JSON.stringify(be.rows('Users')), usersAfterFirst,
    'a second run altered user rows');
  assert.equal([...(second.created || [])].length, 0,
    'a second run claimed to create something');
});

test('MIGRATE-WARN-1: a sheet whose ID is not column A produces a VISIBLE warning', () => {
  const be = legacyDatabase();

  // The live AdminRequests sheet has this shape: ID is not the first column,
  // which is why the original backend could never update that sheet at all.
  const ar = be.store.getSheet('AdminRequests');
  const idAt = ar.headers.indexOf('ID');
  const reordered = ar.rows.map((row) => {
    const copy = row.slice();
    const [idCell] = copy.splice(idAt, 1);
    copy.push(idCell);
    return copy;
  });
  ar.rows = reordered;

  be.env.logs.length = 0;
  const report = be.call('migrateDatabase');

  assert.ok(report.warnings.length > 0, 'the anomaly was not detected at all');
  assert.ok(report.warnings.some((w) => /AdminRequests/.test(w)),
    `AdminRequests not named in warnings: ${report.warnings.join(' | ')}`);

  // And crucially it must be PRINTED, not merely returned.
  const printed = be.env.logs.join('\n');
  assert.ok(/WARNINGS/.test(printed),
    'warnings were collected but never logged — nobody running this would see them');
  assert.ok(/AdminRequests/.test(printed), 'the warning text was not printed');
});

test('MIGRATE-WARN-2: a clean migration says so instead of staying silent', () => {
  const be = legacyDatabase();
  be.env.logs.length = 0;

  be.call('migrateDatabase');
  const printed = be.env.logs.join('\n');

  assert.ok(/MIGRATION SUMMARY/.test(printed), 'no summary was printed');
  assert.ok(/warnings:\s+none/.test(printed),
    'a clean run must state there were no warnings, not leave it ambiguous');
  assert.ok(/sheets created/.test(printed) && /columns added to/.test(printed),
    'the summary must say what actually changed');
});

test('PREFLIGHT-8: enforcement is never recommended before the frontend is deployed', () => {
  const be = buildScenario();
  const steps = be.call('preflightCheck').nextSteps.join('\n');

  const frontendAt = steps.search(/DEPLOY THE FRONTEND/i);
  const warnAt = steps.indexOf("setAuthEnforcement('warn')");
  const onAt = steps.indexOf("setAuthEnforcement('on')");

  assert.ok(frontendAt !== -1,
    'the frontend deploy is missing from the steps. Turning enforcement on ' +
    'while the OLD bundle is live rejects every request it makes.');
  assert.ok(frontendAt < onAt,
    'enforcement is recommended before the frontend is deployed');
  assert.ok(warnAt !== -1 && warnAt < onAt,
    "warn mode must be offered before 'on', so anything still unauthenticated " +
    'is discovered by a log line rather than by an outage');
  assert.ok(/setAuthEnforcement\('off'\)/.test(steps),
    'the steps must say how to undo enforcement instantly');
});

test('SELFCHECK-1: ID outside column A is a note, not a blocker', () => {
  const be = buildScenario();

  // Reproduce the live AdminRequests sheet: a stray column A, ID further along.
  const ar = be.store.getSheet('AdminRequests');
  const idAt = ar.headers.indexOf('ID');
  ar.rows = ar.rows.map((row) => {
    const copy = row.slice();
    const [idCell] = copy.splice(idAt, 1);
    copy.push(idCell);
    return copy;
  });
  ar.rows[0].unshift('AdminRequests');
  for (let r = 1; r < ar.rows.length; r++) ar.rows[r].unshift('');

  const report = be.call('selfCheck');
  const problems = [...report.problems].join(' | ');

  assert.ok(!/must be ID/.test(problems),
    'selfCheck still demands ID in column A. Rows are located by column NAME, ' +
    'so this reports a working database as NOT READY: ' + problems);

  const notes = [...report.notes].join(' | ');
  assert.ok(/AdminRequests: ID is column/.test(notes),
    'the layout should still be mentioned as a note, not silently ignored');
});

test('SELFCHECK-2: a sheet with NO ID column is still a hard problem', () => {
  const be = buildScenario();
  const ar = be.store.getSheet('AdminRequests');
  const idAt = ar.headers.indexOf('ID');
  ar.rows[0][idAt] = 'NotAnId';

  const report = be.call('selfCheck');
  assert.ok([...report.problems].some((p) => /no ID column/.test(p)),
    'a sheet with no ID column must block: its rows cannot be updated at all');
});

test('SELFCHECK-3: the live layout reports RESULT OK once migrated', () => {
  const be = buildScenario();
  const ar = be.store.getSheet('AdminRequests');
  ar.rows[0].unshift('AdminRequests');
  for (let r = 1; r < ar.rows.length; r++) ar.rows[r].unshift('');

  const report = be.call('selfCheck');
  assert.equal([...report.problems].length, 0,
    'a database matching production still reports problems: ' +
    [...report.problems].join(' | '));
  assert.equal(report.ok, true, 'selfCheck should report ok');
});

test('PREFLIGHT-9: a missing COLUMN is reported, not just a missing sheet', () => {
  const be = buildScenario();

  // The exact situation after re-pasting backend code that introduces a
  // column: the sheet exists and reads fine, but the field is not there.
  const users = be.store.getSheet('Users');
  const at = users.headers.indexOf('DisplayName');
  assert.ok(at !== -1, 'the scenario should already have DisplayName');
  for (const row of users.rows) row.splice(at, 1);

  const report = be.call('preflightCheck');
  const text = JSON.stringify(report);

  assert.ok([...report.missingColumns].includes('Users.DisplayName'),
    'a missing column was not detected. Writes to it are silently dropped ' +
    'while preflight reports the deployment as ready.');
  assert.equal(report.readyToEnforce, false,
    'preflight said ready while the schema was incomplete');
  assert.ok(/migrateDatabase/.test(text), 'it must name the fix');
  assert.ok(/Users\.DisplayName/.test([...report.nextSteps].join('\n')),
    'the steps should say which column is missing');
});

test('PREFLIGHT-10: a complete schema reports no missing columns', () => {
  const be = buildScenario();
  const report = be.call('preflightCheck');

  assert.equal([...report.missingColumns].length, 0,
    'a freshly migrated database should have every column: ' +
    [...report.missingColumns].join(', '));
});
