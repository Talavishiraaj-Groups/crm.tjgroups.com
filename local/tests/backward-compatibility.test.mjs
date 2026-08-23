/**
 * The new backend must serve the OLD frontend.
 *
 * The rollout deploys the backend first and the frontend later — possibly days
 * later. In between, the live site is the un-upgraded bundle talking to the new
 * Apps Script. Every request shape below is one the CURRENTLY DEPLOYED frontend
 * sends; if any of them stops working, the site breaks for real users during
 * that window.
 *
 * These are deliberately written as the old client wrote them: no leadId on a
 * mail fetch, no attachments on a send, no logAction filter, GET where the old
 * code used GET. Nothing here may be "fixed" by updating the request — the
 * point is that the old request still works.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScenario, loginAs, authGet, authPost, ID } from '../harness/scenario.mjs';

/* ------------------------------------------------------------------ *
 * Reads — the old client used GET with bare query strings
 * ------------------------------------------------------------------ */

test('COMPAT-1: the old read calls still work unchanged', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  for (const action of [
    'getLeads', 'getUsers', 'getDeals', 'getProjects',
    'getAdminRequests', 'getCommissions', 'getKPIs',
  ]) {
    const res = authGet(be, token, action, {});
    assert.equal(res.status, 'success', `${action} broke for the old client: ${res.message}`);
  }
});

test('COMPAT-2: getLogs with no filter still returns the full history', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  // The old client never sent logAction or since. Adding those parameters must
  // not have turned the unfiltered call into an empty one.
  const res = authGet(be, token, 'getLogs', {});
  assert.equal(res.status, 'success', res.message);
  assert.ok(res.data.length > 0,
    'an unfiltered getLogs returned nothing — the old activity tab would be blank');
});

test('COMPAT-3: getLogs for one entity still works by id alone', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  authPost(be, token, 'createLog', {
    EntityId: ID.leadAlphaNew, EntityType: 'Lead',
    Action: 'CALL', Details: 'spoke to them',
  });

  const res = authGet(be, token, 'getLogs', { id: ID.leadAlphaNew });
  assert.equal(res.status, 'success', res.message);
  assert.ok(res.data.some((l) => l.Details === 'spoke to them'));
});

/* ------------------------------------------------------------------ *
 * Writes — the old payload shapes
 * ------------------------------------------------------------------ */

test('COMPAT-4: the old updateLead payload still saves', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  const res = authPost(be, token, 'updateLead', {
    id: ID.leadAlphaNew,
    Status: 'Contacted',
    Notes: 'written by the old client',
    NextFollowUp: '2026-01-09',
  });
  assert.equal(res.status, 'success', res.message);

  const lead = be.call('getRecordByIdRaw', 'Leads', ID.leadAlphaNew);
  assert.equal(lead.Status, 'Contacted');
  assert.equal(lead.Notes, 'written by the old client');
});

test('COMPAT-5: the old createLog payload still records an entry', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  // No contactMode — that field did not exist in the old client.
  const res = authPost(be, token, 'createLog', {
    EntityId: ID.leadAlphaNew, EntityType: 'Lead',
    Action: 'MESSAGE', UserId: ID.superAdmin, Details: 'whatsapp sent',
  });
  assert.equal(res.status, 'success', res.message);

  const row = be.rows('Logs').find((l) => l.Details === 'whatsapp sent');
  assert.ok(row, 'the log was not written');
  assert.equal(row.ContactMode, '', 'a missing channel stays blank, not junk');
});

test('COMPAT-6: completeFollowUp still works without the newer fields', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  const res = authPost(be, token, 'completeFollowUp', { leadId: ID.leadAlphaNew });
  assert.equal(res.status, 'success', res.message);
});

/* ------------------------------------------------------------------ *
 * Zoho — the old client sent neither leadId nor attachments
 * ------------------------------------------------------------------ */

function linkMailbox(be, userId, email) {
  const acct = be.zoho.addAccount({ email });
  be.call('updateRecordRaw', 'Users', userId, {
    ZohoEmail: acct.email, ZohoRefreshToken: acct.refreshToken,
  });
  return acct;
}

test('COMPAT-7: getZohoEmails works with leadEmail alone', () => {
  const be = buildScenario();
  const acct = linkMailbox(be, ID.repAlpha1, 'rep@tjgroups.test');
  be.zoho.addMessage(acct.accountId, {
    subject: 'Old client fetch', sender: 'buyer@northwind.test',
    toAddress: 'rep@tjgroups.test',
  });

  const token = loginAs(be, ID.repAlpha1);
  // No leadId — the old client did not send one. Archiving must simply be
  // skipped rather than the request failing.
  const res = authGet(be, token, 'getZohoEmails', { leadEmail: 'buyer@northwind.test' });

  assert.equal(res.status, 'success', res.message);
  assert.equal(res.data.length, 1);
  assert.equal(res.data[0].subject, 'Old client fetch');
});

test('COMPAT-8: sendZohoEmail works with just to/subject/content', () => {
  const be = buildScenario();
  linkMailbox(be, ID.repAlpha1, 'rep@tjgroups.test');
  const token = loginAs(be, ID.repAlpha1);

  const res = authPost(be, token, 'sendZohoEmail', {
    to: 'buyer@northwind.test',
    subject: 'From the old client',
    content: 'No leadId, no draftId, no attachments.',
  });

  assert.equal(res.status, 'success', res.message);
  assert.equal(be.zoho.sentMail.length, 1, 'the message did not go out');
  assert.equal(be.zoho.uploadedAttachments.length, 0,
    'an absent attachments field must not be treated as an upload');
});

/* ------------------------------------------------------------------ *
 * The schema additions must be invisible to the old client
 * ------------------------------------------------------------------ */

test('COMPAT-9: new columns do not disturb the shape the old client reads', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  const lead = authGet(be, token, 'getLeadById', { id: ID.leadAlphaNew }).data;

  // Everything the old client rendered is still present and still named the
  // same. Added columns arrive alongside and are simply ignored by it.
  for (const field of ['ID', 'Name', 'Email', 'Phone', 'Status', 'Notes', 'NextFollowUp']) {
    assert.ok(field in lead, `${field} disappeared from the lead payload`);
  }
});

test('COMPAT-10: an old client never receives a secret', () => {
  const be = buildScenario();
  const acct = be.zoho.addAccount({ email: 'rep@tjgroups.test' });
  be.call('updateRecordRaw', 'Users', ID.repAlpha1, {
    ZohoEmail: acct.email, ZohoRefreshToken: acct.refreshToken,
  });
  const token = loginAs(be, ID.superAdmin);

  const users = authGet(be, token, 'getUsers', {}).data;

  // Exact keys, not substrings: HasPassword and MustChangePassword are
  // deliberate booleans the UI needs, and matching on "Password" would flag
  // them while telling you nothing about whether a secret leaked.
  const forbidden = [
    'PasswordHash', 'PasswordSalt', 'PasswordIterations',
    'ZohoRefreshToken', 'Password', 'FailedLoginCount', 'LockedUntil',
  ];
  for (const user of users) {
    for (const key of forbidden) {
      assert.ok(!(key in user), `${key} is being sent to the client`);
    }
  }

  // And the values themselves are absent, not merely renamed.
  const serialised = JSON.stringify(users);
  assert.ok(!serialised.includes(acct.refreshToken),
    'a Zoho refresh token reached the client under some other key');
});

/* ------------------------------------------------------------------ *
 * The reverse direction is NOT safe, and should stay proven
 * ------------------------------------------------------------------ */

test('COMPAT-11: the new frontend genuinely needs the new backend', () => {
  // This is why the runbook insists on backend-first. It is asserted here so
  // the ordering requirement cannot quietly stop being true.
  const be = buildScenario();
  const policy = be.evaluate('ACTION_POLICY');

  const newActions = [
    'batch', 'getStoredEmails', 'saveEmailDraft', 'getEmailDrafts',
    'deleteEmailDraft', 'syncMailbox', 'getEmailAnalytics', 'getUnmatchedEmails',
  ];

  for (const action of newActions) {
    assert.ok(action in policy,
      `${action} is missing — the new frontend would get "Unknown action"`);
  }
});

/* ================================================================== *
 * Deployed-but-not-yet-migrated
 *
 * Between pasting the .gs files and running migrateDatabase(), the new sheets
 * do not exist. Nothing may hard-fail in that window.
 * ================================================================== */

test('MIGRATE-GAP-1: a lead page still loads before the new sheets exist', () => {
  const be = buildScenario();
  // Simulate the freshly-pasted backend: EmailLog/EmailDrafts not created yet.
  be.dropSheet('EmailLog');
  be.dropSheet('EmailDrafts');

  const token = loginAs(be, ID.superAdmin);
  const res = authPost(be, token, 'batch', {
    requests: [
      { key: 'lead', action: 'getLeadById', payload: { id: ID.leadAlphaNew } },
      { key: 'logs', action: 'getLogs', payload: { id: ID.leadAlphaNew } },
      { key: 'users', action: 'getUsers' },
      { key: 'stored', action: 'getStoredEmails', payload: { leadId: ID.leadAlphaNew } },
    ],
  });

  assert.equal(res.status, 'success', 'the whole page request failed');
  const byKey = Object.fromEntries(res.data.results.map((r) => [r.key, r]));

  // The parts that do not need the new sheets must still render.
  assert.equal(byKey.lead.status, 'success', 'the lead itself must still load');
  assert.equal(byKey.logs.status, 'success');
  assert.equal(byKey.users.status, 'success');
});

test('MIGRATE-GAP-2: sending mail still works before the archive sheet exists', () => {
  const be = buildScenario();
  const acct = be.zoho.addAccount({ email: 'rep@tjgroups.test' });
  be.call('updateRecordRaw', 'Users', ID.repAlpha1, {
    ZohoEmail: acct.email, ZohoRefreshToken: acct.refreshToken,
  });
  be.dropSheet('EmailLog');

  const token = loginAs(be, ID.repAlpha1);
  const res = authPost(be, token, 'sendZohoEmail', {
    leadId: ID.leadAlphaNew, to: 'buyer@northwind.test',
    subject: 'Sent before migration', content: 'body',
  });

  // Archiving is a convenience; it must never stop a message going out.
  assert.equal(res.status, 'success', res.message);
  assert.equal(be.zoho.sentMail.length, 1, 'the message did not leave the mailbox');
});

test('MIGRATE-GAP-3: migrateDatabase creates the new sheets without touching data', () => {
  const be = buildScenario();
  be.dropSheet('EmailLog');
  be.dropSheet('EmailDrafts');

  const leadsBefore = be.rows('Leads').filter((r) => String(r.ID || '')).length;
  const logsBefore = be.rows('Logs').filter((r) => String(r.ID || '')).length;

  be.call('migrateDatabase');

  assert.ok(be.store.hasSheet('EmailLog'), 'EmailLog was not created');
  assert.ok(be.store.hasSheet('EmailDrafts'), 'EmailDrafts was not created');
  assert.equal(be.rows('Leads').filter((r) => String(r.ID || '')).length, leadsBefore,
    'migration changed the lead count');
  assert.equal(be.rows('Logs').filter((r) => String(r.ID || '')).length, logsBefore,
    'migration changed the log count');
});
