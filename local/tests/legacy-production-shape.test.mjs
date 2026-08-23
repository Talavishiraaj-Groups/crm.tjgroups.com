/**
 * Tests against the ACTUAL shape of the live production database, as observed
 * in the Drive export on 2026-08-17:
 *
 *   Users          ID first, plus an undeclared `Password` column holding
 *                  readable passwords (13/13 populated, 9-15 chars)
 *   AdminRequests  a stray empty first column literally named
 *                  "AdminRequests"; the real ID column is LAST
 *   Team_s information   an extra sheet the backend does not manage
 *
 * Run: node --test local/tests/legacy-production-shape.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBackend } from '../harness/backend.mjs';

/** Column layouts exactly as they exist in production today. */
const LIVE_SHAPE = {
  Users: ['ID', 'Username', 'Role', 'Team', 'Status', 'Availability',
          'CreatedAt', 'UpdatedAt', 'Password', 'ZohoEmail', 'ZohoRefreshToken'],
  // NOTE the stray first column and the trailing ID.
  AdminRequests: ['AdminRequests', 'Type', 'RelatedDealId', 'RequestedBy', 'Status',
                  'CreatedAt', 'UpdatedAt', 'PaymentLink', 'DocumentUrl', 'ID'],
  Leads: ['ID', 'Name', 'Email', 'Phone', 'Status', 'OwnerRepId', 'SetterId', 'CloserId',
          'Notes', 'Linkedin', 'NextFollowUp', 'CreatedAt', 'UpdatedAt'],
  Deals: ['ID', 'LeadId', 'Value', 'Status', 'OwnerRepId', 'SetterId', 'CloserId',
          'CreatedAt', 'UpdatedAt'],
  Projects: ['ID', 'ClientName', 'Status', 'OwnerRepId', 'AccountManagerId', 'LiaisonId',
             'StartDate', 'DueDate', 'CreatedAt', 'UpdatedAt', 'Notes'],
  Commissions: ['ID', 'DealId', 'SetterId', 'SetterAmount', 'CloserId', 'CloserAmount',
                'PayoutStatus', 'CreatedAt', 'UpdatedAt'],
  Logs: ['ID', 'EntityId', 'EntityType', 'Action', 'UserId', 'Details', 'Metadata', 'Timestamp'],
};

const U1 = 'aaaaaaaa-0000-4000-a000-000000000001';
const U2 = 'aaaaaaaa-0000-4000-a000-000000000002';
const U3 = 'aaaaaaaa-0000-4000-a000-000000000003';
const REQ = 'bbbbbbbb-0000-4000-a000-000000000001';

function liveShapedBackend() {
  const be = loadBackend({ scriptProperties: { PASSWORD_ITERATIONS: '100' } });
  const root = be.context.DriveApp.getFolderById(be.env.ROOT_FOLDER_ID);
  const dbFolder = root.createFolder('Databases');
  be.setProp('DB_FOLDER_ID', dbFolder.getId());

  for (const [name, headers] of Object.entries(LIVE_SHAPE)) {
    const ss = be.context.SpreadsheetApp.create(name);
    be.store.getSheet(name).rows = [headers.slice()];
    be.context.DriveApp.getFileById(ss.getId()).moveTo(dbFolder);
  }
  // An unmanaged extra sheet, as in Drive.
  be.store.createSheet('Team_s information', ['name', 'email', 'phone number']);
  be.store.insert('Team_s information', {
    name: 'Someone', email: 'someone@example.test', 'phone number': '+100',
  });

  // Readable passwords of varying length, including one below the new minimum.
  be.store.insert('Users', {
    ID: U1, Username: 'super_admin', Role: 'SUPER_ADMIN', Team: 'Management',
    Status: 'Active', Availability: 'Available', CreatedAt: '2025-06-01T00:00:00.000Z',
    UpdatedAt: '', Password: 'AdminPass2026', ZohoEmail: '', ZohoRefreshToken: '',
  });
  be.store.insert('Users', {
    ID: U2, Username: 'sales_rep_1', Role: 'SALES_REP', Team: 'Alpha',
    Status: 'Active', Availability: 'Busy', CreatedAt: '', UpdatedAt: '',
    Password: 'shortpw12', ZohoEmail: '', ZohoRefreshToken: '',   // 9 chars
  });
  be.store.insert('Users', {
    ID: U3, Username: 'ex_employee', Role: 'SALES_REP', Team: 'Alpha',
    Status: 'Inactive', Availability: 'Offline', CreatedAt: '', UpdatedAt: '',
    Password: 'OldPass12345', ZohoEmail: '', ZohoRefreshToken: '',
  });

  be.store.insert('AdminRequests', {
    AdminRequests: '', Type: 'payment', RelatedDealId: 'deal-x', RequestedBy: U2,
    Status: 'Pending', CreatedAt: '2026-01-02T00:00:00.000Z', UpdatedAt: '',
    PaymentLink: '', DocumentUrl: '', ID: REQ,
  });

  return be;
}

const realRows = (be, sheet) =>
  be.store.toObjects(sheet).filter((r) => String(r.ID || '').length > 0);

test('LIVE-1: migration succeeds against the real production layout', () => {
  const be = liveShapedBackend();
  const report = be.call('setupCRMDatabase');

  assert.ok(report, 'setup completed');
  // The stray column and trailing ID are tolerated, and flagged, not "fixed".
  const warning = report.warnings.find((w) => w.indexOf('AdminRequests') === 0);
  assert.ok(warning, 'the odd AdminRequests layout is reported');
  assert.match(warning, /not column A/);

  const headers = be.store.getSheet('AdminRequests').headers;
  assert.equal(headers[0], 'AdminRequests', 'the stray column is left exactly as-is');
  assert.ok(headers.includes('ID'), 'ID still present');
});

test('LIVE-2: records in a sheet whose ID is not column A can still be updated', () => {
  const be = liveShapedBackend();
  be.call('setupCRMDatabase');

  // The ORIGINAL backend compared data[i][0] and so could never match here.
  const updated = be.call('updateRecordRaw', 'AdminRequests', REQ, { Status: 'Approved' });
  assert.equal(updated.Status, 'Approved');

  const row = be.store.toObjects('AdminRequests').find((r) => r.ID === REQ);
  assert.equal(row.Status, 'Approved', 'the write landed on the right row');
  assert.equal(row.Type, 'payment', 'other columns untouched');
});

test('LIVE-3: the unmanaged extra sheet is never touched', () => {
  const be = liveShapedBackend();
  const before = be.store.toObjects('Team_s information');
  be.call('setupCRMDatabase');
  const after = be.store.toObjects('Team_s information');

  assert.deepEqual(after, before, '"Team_s information" is left completely alone');
  assert.deepEqual(
    be.store.getSheet('Team_s information').headers,
    ['name', 'email', 'phone number'],
    'its headers are not rewritten'
  );
});

test('LIVE-4: readable passwords are detected before migration', () => {
  const be = liveShapedBackend();
  be.call('setupCRMDatabase');

  const audit = be.call('auditLegacyPasswordExposure');
  assert.equal(audit.usersWithReadablePassword, 3, 'all three are flagged');
  assert.equal(audit.usersWithHashedPassword, 0);
  assert.equal(audit.clean, false);
});

test('LIVE-5: legacy passwords are hashed, verified, and the clear text removed', () => {
  const be = liveShapedBackend();
  be.call('setupCRMDatabase');

  const result = be.call('migrateLegacyPasswords');
  assert.equal(result.migrated, 3, 'every account migrated');
  assert.equal(result.failed, 0);
  assert.equal(result.belowMinimum, 1, 'the 9-character password is flagged');

  for (const row of realRows(be, 'Users')) {
    assert.equal(String(row.Password || ''), '', 'clear text removed');
    assert.ok(String(row.PasswordHash).length === 64, 'a hash is stored');
    // Sheets stores the string 'TRUE' as a BOOLEAN, so the raw cell reads as
    // 	rue, not 'TRUE'. Assert through the backend's own flag reader, which
    // is what every caller uses.
    assert.ok(be.call('isTrueFlag', row.MustChangePassword),
      'exposed password forces a change');
  }

  const audit = be.call('auditLegacyPasswordExposure');
  assert.equal(audit.usersWithReadablePassword, 0);
  assert.equal(audit.clean, true);
});

test('LIVE-6: everyone keeps the password they already knew', () => {
  const be = liveShapedBackend();
  be.call('setupCRMDatabase');
  be.call('migrateLegacyPasswords');
  be.call('setAuthEnforcement', 'on');

  // The original password still authenticates — nobody is locked out.
  const ok = be.post({
    action: 'login', payload: { username: 'super_admin', password: 'AdminPass2026' },
  });
  assert.equal(ok.status, 'success', 'existing password still works');
  assert.equal(ok.data.mustChangePassword, true, 'but a change is demanded');

  // Even the sub-minimum one works, so that user is not locked out.
  const short = be.post({
    action: 'login', payload: { username: 'sales_rep_1', password: 'shortpw12' },
  });
  assert.equal(short.status, 'success', '9-char legacy password still authenticates');

  const wrong = be.post({
    action: 'login', payload: { username: 'super_admin', password: 'AdminPass2027' },
  });
  assert.equal(wrong.status, 'error', 'a wrong password is still rejected');
});

test('LIVE-7: an inactive account cannot log in even with a valid legacy password', () => {
  const be = liveShapedBackend();
  be.call('setupCRMDatabase');
  be.call('migrateLegacyPasswords');
  be.call('setAuthEnforcement', 'on');

  const res = be.post({
    action: 'login', payload: { username: 'ex_employee', password: 'OldPass12345' },
  });
  assert.equal(res.status, 'error');
  assert.equal(res.code, 'ACCOUNT_INACTIVE');
});

test('LIVE-8: the migration is idempotent and never re-hashes', () => {
  const be = liveShapedBackend();
  be.call('setupCRMDatabase');

  const first = be.call('migrateLegacyPasswords');
  const hashes = realRows(be, 'Users').map((r) => r.PasswordHash);

  const second = be.call('migrateLegacyPasswords');
  assert.equal(second.migrated, 0, 'nothing left to migrate');
  assert.equal(second.alreadyHashed, 3);

  assert.deepEqual(realRows(be, 'Users').map((r) => r.PasswordHash), hashes,
    'hashes unchanged by a second run');
  assert.equal(first.migrated, 3);
});

test('LIVE-9: no password value ever reaches the log or an API response', () => {
  const be = liveShapedBackend();
  be.call('setupCRMDatabase');
  be.env.logs.length = 0;
  be.call('migrateLegacyPasswords');

  const logText = be.env.logs.join('\n');
  for (const secret of ['AdminPass2026', 'shortpw12', 'OldPass12345']) {
    assert.ok(!logText.includes(secret), `the execution log leaked ${secret}`);
  }

  be.call('setAuthEnforcement', 'off');
  const users = be.get({ action: 'getUsers' });
  const body = JSON.stringify(users.data);
  for (const secret of ['AdminPass2026', 'shortpw12', 'OldPass12345']) {
    assert.ok(!body.includes(secret), `getUsers leaked ${secret}`);
  }

  // No credential-bearing field is returned. `HasPassword` and
  // `MustChangePassword` ARE returned deliberately — they are booleans the UI
  // needs, and carry no secret — so check the actual keys rather than the
  // substring "Password".
  for (const row of users.data) {
    for (const banned of ['Password', 'PasswordHash', 'PasswordSalt', 'ZohoRefreshToken']) {
      assert.equal(row[banned], undefined, `getUsers returned ${banned}`);
    }
    assert.equal(typeof row.HasPassword, 'boolean', 'link state is a boolean, not a value');
  }
});

test('LIVE-10: existing business data survives the whole migration untouched', () => {
  const be = liveShapedBackend();

  be.store.insert('Leads', {
    ID: 'cccccccc-0000-4000-a000-000000000001', Name: 'Real Client',
    Email: 'client@real.test', Phone: '+15551234', Status: 'Contacted',
    OwnerRepId: U2, SetterId: '', CloserId: '', Notes: 'Existing production note.',
    Linkedin: '', NextFollowUp: '2026-09-01',
    CreatedAt: '2026-02-01T00:00:00.000Z', UpdatedAt: '2026-02-02T00:00:00.000Z',
  });

  const before = realRows(be, 'Leads')[0];

  be.call('setupCRMDatabase');
  be.call('migrateLegacyPasswords');

  const after = realRows(be, 'Leads')[0];
  for (const key of Object.keys(before)) {
    if (key === '__rowIndex') continue;
    assert.equal(after[key], before[key], `Leads.${key} preserved`);
  }
  assert.equal(String(after.FollowUpStatus || ''), '',
    'the new follow-up column exists but stays empty on a historical row');
});

test('LIVE-11: migrateLegacyPasswords actually persists the MustChangePassword flag', () => {
  const be = liveShapedBackend();
  be.call('migrateDatabase');

  // Give the users readable passwords, as production had.
  const users = be.store.getSheet('Users');
  const pwCol = users.headers.indexOf('Password');
  const col = pwCol === -1 ? (users.rows[0].push('Password') - 1) : pwCol;
  for (let r = 1; r < users.rows.length; r++) users.rows[r][col] = 'OldPassword12';

  const report = be.call('migrateLegacyPasswords');
  assert.ok(report.migrated > 0, 'nothing migrated, so this proves nothing');

  const after = be.rows('Users').filter((u) => String(u.ID || ''));
  const flagged = after.filter((u) => be.call('isTrueFlag', u.MustChangePassword));

  assert.equal(flagged.length, after.length,
    'the migration log says every migrated account is flagged MustChangePassword, ' +
    `but only ${flagged.length} of ${after.length} carry the flag. The prompt to ` +
    'replace an exposed password would never appear.');
});
