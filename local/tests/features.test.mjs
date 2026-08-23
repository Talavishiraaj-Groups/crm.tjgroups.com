/**
 * Feature batch: export, follow-up completion, daily feed, productivity,
 * contact-mode tracking, analytics, and manual closer assignment.
 *
 * Run: node --test local/tests/features.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScenario, loginAs, authPost, authGet, ID } from '../harness/scenario.mjs';

/* ================================================================== *
 * 1. Export all CRM data
 * ================================================================== */

test('EXPORT-1: SUPER_ADMIN exports every entity with counts intact', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  const res = authPost(be, token, 'exportAllData', {});
  assert.equal(res.status, 'success');
  const dump = res.data;

  for (const sheet of ['Users', 'Leads', 'Deals', 'Projects', 'Commissions', 'AdminRequests']) {
    const actual = be.rows(sheet).filter((r) => String(r.ID || '')).length;
    assert.equal(dump.counts[sheet], actual, `${sheet} count matches the sheet`);
    assert.equal(dump.entities[sheet].records.length, actual);
    assert.ok(dump.entities[sheet].headers.length > 0, `${sheet} headers present`);
  }
});

test('EXPORT-2: every exported ID matches the source exactly', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);
  const dump = authPost(be, token, 'exportAllData', {}).data;

  for (const sheet of ['Users', 'Leads', 'Deals', 'Commissions']) {
    const sourceIds = be.rows(sheet).filter((r) => String(r.ID || '')).map((r) => String(r.ID)).sort();
    const exportIds = dump.entities[sheet].records.map((r) => String(r.ID)).sort();
    assert.deepEqual(exportIds, sourceIds, `${sheet} IDs preserved`);
  }
});

test('EXPORT-3: no secret ever appears in an export', () => {
  const be = buildScenario();
  be.call('updateRecordRaw', 'Users', ID.repAlpha1, {
    ZohoRefreshToken: 'CANARY-REFRESH-TOKEN',
  });

  const token = loginAs(be, ID.superAdmin);
  const dump = authPost(be, token, 'exportAllData', {}).data;

  // Check the DATA, not the whole envelope: `redactedColumns` legitimately
  // names the removed columns, which is a disclosure of what was stripped
  // rather than a leak of any value.
  const serialised = JSON.stringify(dump.entities);

  for (const secret of ['CANARY-REFRESH-TOKEN', 'PasswordHash', 'PasswordSalt', 'TokenHash']) {
    assert.ok(!serialised.includes(secret), `export leaked ${secret}`);
  }
  for (const rec of dump.entities.Users.records) {
    for (const banned of ['PasswordHash', 'PasswordSalt', 'ZohoRefreshToken']) {
      assert.equal(rec[banned], undefined, `Users record still carries ${banned}`);
    }
  }
  assert.equal(dump.entities.Sessions, undefined, 'the Sessions sheet is excluded entirely');
  assert.ok(dump.redactedColumns.Users.includes('PasswordHash'), 'redaction is declared');
});

test('EXPORT-4: exporting mutates nothing except the audit trail', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  const before = {
    Users: be.store.snapshot().Users.map((r) => r.join('|')),
    Leads: be.store.snapshot().Leads.map((r) => r.join('|')),
    Deals: be.store.snapshot().Deals.map((r) => r.join('|')),
  };

  authPost(be, token, 'exportAllData', {});

  const after = be.store.snapshot();
  for (const sheet of Object.keys(before)) {
    assert.deepEqual(after[sheet].map((r) => r.join('|')), before[sheet],
      `${sheet} unchanged by export`);
  }
  assert.ok(
    be.rows('Logs').some((l) => l.Action === 'DATA_EXPORTED'),
    'the export itself is audited'
  );
});

test('EXPORT-5: non-SUPER_ADMIN cannot export', () => {
  const be = buildScenario();
  for (const userId of [ID.adminAlpha, ID.repAlpha1, ID.setterAlpha]) {
    const token = loginAs(be, userId);
    const res = authPost(be, token, 'exportAllData', {});
    assert.equal(res.status, 'error', `${userId} must not export`);
    assert.equal(res.code, 'FORBIDDEN');
  }
});

/* ================================================================== *
 * 2. Edit lead (same rules as any other mutation)
 * ================================================================== */

// NOTE: editing a lead's IDENTITY (name, email, phone, LinkedIn) is
// restricted to SUPER_ADMIN and ADMIN. A rep still owns the day-to-day work
// on their leads — status, notes, follow-up — which EDITPERM-2 covers.
test('EDIT-1: a manager may edit a lead in their scope', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.adminAlpha);

  const res = authPost(be, token, 'updateLead', {
    id: ID.leadAlphaNew,
    Name: 'Northwind Traders Ltd',
    Email: 'newbuyer@northwind.test',
    Phone: '+15550999',
    Linkedin: 'https://linkedin.com/company/northwind-ltd',
    Notes: 'Renamed after acquisition.',
  });
  assert.equal(res.status, 'success');

  const row = be.rows('Leads').find((l) => l.ID === ID.leadAlphaNew);
  assert.equal(row.Name, 'Northwind Traders Ltd');
  assert.equal(row.Email, 'newbuyer@northwind.test');
});

test('EDIT-2: invalid field values are rejected', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.adminAlpha);

  const cases = [
    { Email: 'not-an-email' },
    { Linkedin: 'javascript:alert(1)' },
    { Name: '' },
    { Status: 'NOPE' },
  ];
  for (const patch of cases) {
    const res = authPost(be, token, 'updateLead', { id: ID.leadAlphaNew, ...patch });
    assert.equal(res.status, 'error', `${JSON.stringify(patch)} must be rejected`);
    assert.equal(res.code, 'VALIDATION_FAILED');
  }
});

test('EDIT-3: a client cannot write server-owned follow-up fields directly', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);

  const res = authPost(be, token, 'updateLead', {
    id: ID.leadAlphaNew,
    FollowUpStatus: 'Completed',
    FollowUpCompletedBy: ID.superAdmin,
    Notes: 'legit change',
  });
  assert.equal(res.status, 'success', 'the legitimate field still saves');

  const row = be.rows('Leads').find((l) => l.ID === ID.leadAlphaNew);
  assert.equal(row.Notes, 'legit change');
  assert.notEqual(row.FollowUpStatus, 'Completed', 'completion cannot be forged');
});

test('EDIT-4: editing a nonexistent or out-of-scope lead fails safely', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);

  const ghost = authPost(be, token, 'updateLead', { id: ID.ghost, Notes: 'x' });
  assert.equal(ghost.code, 'NOT_FOUND');

  const other = authPost(be, token, 'updateLead', { id: ID.leadBetaNew, Notes: 'x' });
  assert.equal(other.status, 'error');
});

test('EDIT-5: repeated identical saves are harmless', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);

  for (let i = 0; i < 3; i++) {
    const res = authPost(be, token, 'updateLead', { id: ID.leadAlphaNew, Notes: 'same value' });
    assert.equal(res.status, 'success');
  }
  const rows = be.rows('Leads').filter((l) => l.ID === ID.leadAlphaNew);
  assert.equal(rows.length, 1, 'still exactly one lead row');
});

/* ================================================================== *
 * 3. Daily-only activity feed
 * ================================================================== */

test('FEED-1: the feed returns only today, in the CRM timezone', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  // Fixture logs are dated 2026-01-03; the harness clock is 2026-01-05.
  const res = authGet(be, token, 'getActivityFeed');
  assert.equal(res.status, 'success');
  assert.equal(res.data.scope, 'today');
  assert.ok(res.data.timeZone, 'the boundary timezone is stated');

  const from = Date.parse(res.data.from);
  for (const entry of res.data.entries) {
    assert.ok(Date.parse(entry.Timestamp) >= from, 'no entry predates today');
  }
  // The historic fixture entry must NOT appear.
  assert.ok(
    !res.data.entries.some((e) => e.Action === 'CONVERSION' && e.Timestamp.startsWith('2026-01-03')),
    'yesterday\'s activity is excluded from the feed'
  );
});

test('FEED-2: older activity is still in the database, just not in the feed', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  const feed = authGet(be, token, 'getActivityFeed').data;
  const allLogs = authGet(be, token, 'getLogs').data;

  assert.ok(allLogs.length >= feed.entries.length);
  assert.ok(
    allLogs.some((l) => String(l.Timestamp).startsWith('2026-01-03')),
    'the historical row is preserved and still readable'
  );
});

test('FEED-3: a wider window can be requested explicitly', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  const wide = authGet(be, token, 'getActivityFeed', { days: '7' });
  assert.equal(wide.status, 'success');
  assert.match(wide.data.scope, /calendar days/);
  assert.ok(
    Date.parse(wide.data.from) < Date.parse(authGet(be, token, 'getActivityFeed').data.from),
    'a 7-day window starts earlier than today'
  );
});

test('FEED-4: the feed respects record scoping', () => {
  const be = buildScenario();
  const su = loginAs(be, ID.superAdmin);
  authPost(be, su, 'markDealWon', { dealId: ID.dealAlphaOpen });

  const betaToken = loginAs(be, ID.repBeta1);
  const feed = authGet(be, betaToken, 'getActivityFeed').data;

  assert.ok(
    !feed.entries.some((e) => e.Action === 'DEAL_WON'),
    'a Beta rep does not see an Alpha deal being won'
  );
});

/* ================================================================== *
 * 4. Follow-up completion
 * ================================================================== */

test('FOLLOWUP-1: completing a follow-up is a recorded transition', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);

  const res = authPost(be, token, 'completeFollowUp', {
    leadId: ID.leadAlphaNew,
    contactMode: 'CALL',
    outcome: 'Spoke to the buyer, sending a quote.',
  });
  assert.equal(res.status, 'success');
  assert.equal(res.data.idempotent, false);

  const row = be.rows('Leads').find((l) => l.ID === ID.leadAlphaNew);
  assert.equal(row.FollowUpStatus, 'Completed');
  assert.ok(String(row.FollowUpCompletedAt).length > 0, 'completion timestamp stored');
  assert.equal(row.FollowUpCompletedBy, ID.repAlpha1, 'actor recorded');

  const audit = be.rows('Logs').filter((l) => l.Action === 'FOLLOWUP_COMPLETED');
  assert.equal(audit.length, 1);
  assert.equal(audit[0].UserId, ID.repAlpha1);
  assert.equal(audit[0].ContactMode, 'CALL');
});

test('FOLLOWUP-2: repeated completion is idempotent — no duplicate history', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);

  const results = [];
  for (let i = 0; i < 4; i++) {
    results.push(authPost(be, token, 'completeFollowUp', { leadId: ID.leadAlphaNew }));
  }
  for (const r of results) assert.equal(r.status, 'success');
  assert.equal(results[0].data.idempotent, false);
  for (let i = 1; i < 4; i++) assert.equal(results[i].data.idempotent, true);

  const audit = be.rows('Logs').filter((l) => l.Action === 'FOLLOWUP_COMPLETED');
  assert.equal(audit.length, 1, 'four clicks produced one completion event');
});

test('FOLLOWUP-3: completing and rescheduling in one transaction', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);

  const res = authPost(be, token, 'completeFollowUp', {
    leadId: ID.leadAlphaNew,
    contactMode: 'WHATSAPP',
    nextFollowUp: '2026-02-01',
  });
  assert.equal(res.status, 'success');

  const row = be.rows('Leads').find((l) => l.ID === ID.leadAlphaNew);
  assert.equal(row.NextFollowUp, '2026-02-01');
  assert.equal(row.FollowUpStatus, 'Planned', 'a new follow-up is pending again');
  assert.ok(String(row.FollowUpCompletedAt).length > 0, 'the completed one is still recorded');
});

test('FOLLOWUP-4: overdue is derived, never stored', () => {
  const be = buildScenario();

  // leadAlphaNew is due 2026-01-10; the clock is 2026-01-05.
  const lead = be.rows('Leads').find((l) => l.ID === ID.leadAlphaNew);
  assert.equal(be.call('followUpState', lead, '2026-01-05T00:00:00.000Z'), 'Planned');
  assert.equal(be.call('followUpState', lead, '2026-01-20T00:00:00.000Z'), 'Overdue');

  // Nothing was written to the sheet by asking.
  const after = be.rows('Leads').find((l) => l.ID === ID.leadAlphaNew);
  assert.equal(String(after.FollowUpStatus || ''), '', 'no status persisted for a historical row');
});

test('FOLLOWUP-5: a rep cannot complete another team\'s follow-up', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);
  const res = authPost(be, token, 'completeFollowUp', { leadId: ID.leadBetaContacted });
  assert.equal(res.status, 'error');
  assert.equal(res.code, 'NOT_FOUND');
});

test('FOLLOWUP-6: cancelling is distinct from completing', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);

  const res = authPost(be, token, 'cancelFollowUp', {
    leadId: ID.leadAlphaNew, reason: 'Client asked us to stop calling.',
  });
  assert.equal(res.status, 'success');

  const row = be.rows('Leads').find((l) => l.ID === ID.leadAlphaNew);
  assert.equal(row.FollowUpStatus, 'Cancelled');
  assert.equal(String(row.FollowUpCompletedAt || ''), '', 'cancelling is not completing');
  assert.equal(be.rows('Logs').filter((l) => l.Action === 'FOLLOWUP_COMPLETED').length, 0);
});

/* ================================================================== *
 * 5. Contact mode
 * ================================================================== */

test('CONTACT-1: contact mode is validated, not free text', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);

  const cases = [
    ['call', 'CALL'],
    ['WhatsApp', 'WHATSAPP'],
    ['EMAIL', 'EMAIL'],
    ['carrier pigeon', 'OTHER'],   // unrecognised collapses to OTHER
    ['', ''],                      // absent stays absent
  ];

  for (const [input, expected] of cases) {
    const res = authPost(be, token, 'createLog', {
      EntityId: ID.leadAlphaNew, EntityType: 'Lead', Action: 'NOTE',
      Details: `probe ${input}`, ContactMode: input,
    });
    assert.equal(res.status, 'success');
    const row = be.rows('Logs').find((l) => l.Details === `probe ${input}`);
    assert.equal(String(row.ContactMode || ''), expected, `"${input}" -> "${expected}"`);
  }
});

test('CONTACT-2: historical rows keep an empty contact mode', () => {
  const be = buildScenario();
  const historic = be.rows('Logs').find((l) => l.Action === 'CONVERSION');
  assert.ok(historic, 'the fixture historical log exists');
  assert.equal(String(historic.ContactMode || ''), '', 'not back-filled');
});

/* ================================================================== *
 * 6. Productivity metrics
 * ================================================================== */

test('PROD-1: metrics come from structured events', () => {
  const be = buildScenario();
  const rep = loginAs(be, ID.repAlpha1);

  authPost(be, rep, 'completeFollowUp', { leadId: ID.leadAlphaNew, contactMode: 'CALL' });
  authPost(be, rep, 'createLead', { Name: 'Fresh Lead', Status: 'New' });

  const su = loginAs(be, ID.superAdmin);
  const res = authGet(be, su, 'getProductivity', { days: '30' });
  assert.equal(res.status, 'success');

  const me = res.data.users.find((u) => u.userId === ID.repAlpha1);
  assert.ok(me, 'the rep appears in the report');
  assert.equal(me.followUpsCompleted, 1);
  assert.equal(me.leadsCreated, 1);
  assert.equal(me.contactEvents, 1);
  assert.equal(me.contactByMode.CALL, 1);
});

test('PROD-2: retried operations do not inflate metrics', () => {
  const be = buildScenario();
  const su = loginAs(be, ID.superAdmin);

  // Five identical win requests, then five identical follow-up completions.
  for (let i = 0; i < 5; i++) authPost(be, su, 'markDealWon', { dealId: ID.dealAlphaOpen });
  const rep = loginAs(be, ID.repAlpha1);
  for (let i = 0; i < 5; i++) authPost(be, rep, 'completeFollowUp', { leadId: ID.leadAlphaNew });

  const res = authGet(be, su, 'getProductivity', { days: '30' });
  const admin = res.data.users.find((u) => u.userId === ID.superAdmin);
  const me = res.data.users.find((u) => u.userId === ID.repAlpha1);

  assert.equal(admin.dealsWon, 1, 'five win requests counted once');
  assert.equal(me.followUpsCompleted, 1, 'five completions counted once');
});

test('PROD-3: the report declares its own contact-mode coverage', () => {
  const be = buildScenario();
  const su = loginAs(be, ID.superAdmin);
  const res = authGet(be, su, 'getProductivity');
  // buildScenario runs the migration, so tracking has a real start date.
  assert.ok(res.data.contactModeTrackingSince, 'tracking start is reported');
  assert.ok(res.data.timeZone, 'timezone is reported');
});

test('PROD-4: a rep sees only their own numbers', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);
  const res = authGet(be, token, 'getProductivity');
  assert.equal(res.status, 'success');
  const ids = res.data.users.map((u) => u.userId);
  assert.deepEqual(ids, [ID.repAlpha1], 'own row only');
});

/* ================================================================== *
 * 7. Super-admin analytics
 * ================================================================== */

test('ANALYTICS-1: analytics is SUPER_ADMIN only', () => {
  const be = buildScenario();
  for (const userId of [ID.adminAlpha, ID.repAlpha1, ID.setterAlpha]) {
    const token = loginAs(be, userId);
    assert.equal(authGet(be, token, 'getAnalytics').code, 'FORBIDDEN');
  }
  const su = loginAs(be, ID.superAdmin);
  assert.equal(authGet(be, su, 'getAnalytics').status, 'success');
});

test('ANALYTICS-2: contact-mode coverage is reported honestly', () => {
  const be = buildScenario();
  const su = loginAs(be, ID.superAdmin);

  const rep = loginAs(be, ID.repAlpha1);
  authPost(be, rep, 'completeFollowUp', { leadId: ID.leadAlphaNew, contactMode: 'WHATSAPP' });

  const res = authGet(be, su, 'getAnalytics', { days: '3650' });
  const cm = res.data.contactMode;

  assert.ok(cm.trackingSince, 'a real tracking start date is present');
  assert.equal(cm.byMode.WHATSAPP, 1);
  assert.ok(cm.activityPredatingTracking > 0, 'pre-tracking activity is counted separately');
  assert.equal(cm.complete, false, 'never claims completeness over the whole history');
  assert.match(cm.note, /from/, 'the note states the coverage boundary');
});

test('ANALYTICS-3: emails sent counts real send events only', () => {
  const be = buildScenario();

  const acct = be.zoho.addAccount({ email: 'rep@tjgroups.test' });
  be.call('updateRecordRaw', 'Users', ID.repAlpha1, {
    ZohoEmail: acct.email, ZohoRefreshToken: acct.refreshToken,
  });

  const rep = loginAs(be, ID.repAlpha1);
  const su = loginAs(be, ID.superAdmin);

  assert.equal(authGet(be, su, 'getAnalytics').data.email.sent, 0, 'starts at zero');

  const sent = authPost(be, rep, 'sendZohoEmail', {
    to: 'buyer@northwind.test', subject: 'Quote', content: '<p>hi</p>',
  });
  assert.equal(sent.status, 'success');

  const after = authGet(be, su, 'getAnalytics').data.email;
  assert.equal(after.sent, 1, 'counted after the backend actually sent it');
  assert.match(after.source, /not inferred from UI clicks/);
});

test('ANALYTICS-4: pipeline figures match the underlying rows', () => {
  const be = buildScenario();
  const su = loginAs(be, ID.superAdmin);
  const a = authGet(be, su, 'getAnalytics', { days: '3650' }).data;

  const deals = be.rows('Deals').filter((d) => String(d.ID || ''));
  const won = deals.filter((d) => be.call('normaliseDealStatus', d.Status) === 'Won');
  const wonValue = won.reduce((s, d) => s + Number(d.Value || 0), 0);

  assert.equal(a.pipeline.dealsByStatus.Won, won.length);
  assert.equal(a.pipeline.wonValue, wonValue);
  assert.equal(a.finance.commissionRecords, be.rows('Commissions').filter((c) => String(c.ID || '')).length);
});

test('ANALYTICS-5: win rate is null rather than fake when nothing is decided', () => {
  // Empty database: no deals at all, so a win rate is genuinely undefined.
  // Reporting 0% here would be a fabricated statistic.
  const be = buildScenario({ seed: false, passwords: false });
  const a = be.call('getAnalytics', null, { days: 30 });
  assert.equal(a.pipeline.winRate, null, 'no invented percentage');
  assert.match(a.pipeline.winRateNote, /No decided deals/);
});

/* ================================================================== *
 * 8. Manual closer assignment
 * ================================================================== */

test('ASSIGN-1: an ADMIN assigns a closer manually', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.adminAlpha);

  const res = authPost(be, token, 'assignCloser', {
    leadId: ID.leadAlphaNew, closerId: ID.repAlpha2,
  });
  assert.equal(res.status, 'success');

  const row = be.rows('Leads').find((l) => l.ID === ID.leadAlphaNew);
  assert.equal(row.CloserId, ID.repAlpha2);

  const audit = be.rows('Logs').find((l) => l.Action === 'CLOSER_ASSIGNED');
  assert.ok(audit, 'assignment is audited');
  assert.equal(audit.UserId, ID.adminAlpha, 'the assigning manager is recorded');
});

test('ASSIGN-2: a SETTER is not eligible to be a closer', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.adminAlpha);

  const res = authPost(be, token, 'assignCloser', {
    leadId: ID.leadAlphaNew, closerId: ID.setterAlpha,
  });
  assert.equal(res.status, 'error');
  assert.equal(res.code, 'VALIDATION_FAILED');
  assert.match(res.message, /cannot act as a closer/);
});

test('ASSIGN-3: a SALES_REP may act as both setter and closer', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.adminAlpha);

  assert.equal(
    authPost(be, token, 'assignSetter', { leadId: ID.leadAlphaNew, setterId: ID.repAlpha1 }).status,
    'success'
  );
  assert.equal(
    authPost(be, token, 'assignCloser', { leadId: ID.leadAlphaNew, closerId: ID.repAlpha1 }).status,
    'success'
  );

  const row = be.rows('Leads').find((l) => l.ID === ID.leadAlphaNew);
  assert.equal(row.SetterId, ID.repAlpha1);
  assert.equal(row.CloserId, ID.repAlpha1);
});

test('ASSIGN-4: inactive and nonexistent users are refused', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.adminAlpha);

  const inactive = authPost(be, token, 'assignCloser', {
    leadId: ID.leadAlphaNew, closerId: ID.repInactive,
  });
  assert.equal(inactive.code, 'VALIDATION_FAILED');
  assert.match(inactive.message, /active/);

  const ghost = authPost(be, token, 'assignCloser', {
    leadId: ID.leadAlphaNew, closerId: ID.ghost,
  });
  assert.equal(ghost.code, 'VALIDATION_FAILED');
});

test('ASSIGN-5: reassignment preserves the previous closer in history', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.adminAlpha);

  authPost(be, token, 'assignCloser', { leadId: ID.leadAlphaNew, closerId: ID.repAlpha2 });
  authPost(be, token, 'assignCloser', { leadId: ID.leadAlphaNew, closerId: ID.repAlpha1 });

  const reassign = be.rows('Logs').find((l) => l.Action === 'CLOSER_REASSIGNED');
  assert.ok(reassign, 'reassignment recorded distinctly from first assignment');

  const meta = JSON.parse(reassign.Metadata);
  assert.equal(meta.previousCloserId, ID.repAlpha2, 'the prior closer is retained');
  assert.equal(meta.newCloserId, ID.repAlpha1);

  // The original assignment event still exists.
  assert.ok(be.rows('Logs').some((l) => l.Action === 'CLOSER_ASSIGNED'));
});

test('ASSIGN-6: a rep or setter cannot assign closers', () => {
  const be = buildScenario();
  for (const userId of [ID.repAlpha1, ID.setterAlpha]) {
    const token = loginAs(be, userId);
    const res = authPost(be, token, 'assignCloser', {
      leadId: ID.leadAlphaNew, closerId: ID.repAlpha2,
    });
    assert.equal(res.code, 'FORBIDDEN', `${userId} must not assign closers`);
  }
});

test('ASSIGN-7: a converted lead sends you to the deal instead', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.adminAlpha);
  const res = authPost(be, token, 'assignCloser', {
    leadId: ID.leadAlphaConverted, closerId: ID.repAlpha1,
  });
  assert.equal(res.code, 'ILLEGAL_TRANSITION');
  assert.match(res.message, /already converted/);
});

test('ASSIGN-8: assigning the same closer twice is idempotent', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.adminAlpha);

  const first = authPost(be, token, 'assignCloser', {
    leadId: ID.leadAlphaNew, closerId: ID.repAlpha2,
  });
  const second = authPost(be, token, 'assignCloser', {
    leadId: ID.leadAlphaNew, closerId: ID.repAlpha2,
  });

  assert.equal(first.data.idempotent, false);
  assert.equal(second.data.idempotent, true);
  assert.equal(
    be.rows('Logs').filter((l) => String(l.Action).indexOf('CLOSER_') === 0).length, 1,
    'one assignment event, not two'
  );
});

/* ================================================================== *
 * 9. Distributed team — per-viewer timezones
 * ================================================================== */

test('TZ-1: a user can set their own timezone, and it is validated', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);

  const ok = authPost(be, token, 'setTimeZone', { timeZone: 'Asia/Manila' });
  assert.equal(ok.status, 'success');
  assert.equal(ok.data.timeZone, 'Asia/Manila');
  assert.equal(ok.data.usingOrganisationDefault, false);

  const bad = authPost(be, token, 'setTimeZone', { timeZone: 'Mars/Olympus_Mons' });
  assert.equal(bad.status, 'error');
  assert.equal(bad.code, 'VALIDATION_FAILED');

  // The bad value must not have overwritten the good one.
  const row = be.rows('Users').find((u) => u.ID === ID.repAlpha1);
  assert.equal(row.TimeZone, 'Asia/Manila');
});

test('TZ-2: clearing the timezone reverts to the organisation default', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);

  authPost(be, token, 'setTimeZone', { timeZone: 'Europe/London' });
  const cleared = authPost(be, token, 'setTimeZone', { timeZone: '' });

  assert.equal(cleared.status, 'success');
  assert.equal(cleared.data.usingOrganisationDefault, true);
});

test('TZ-3: "today" is reckoned in the viewer\'s zone, not the server\'s', () => {
  const be = buildScenario();

  // NOTE on zone choice: Pacific/Kiritimati (UTC+14) and Pacific/Honolulu
  // (UTC-10) are exactly 24h apart, so their midnights land on the SAME
  // instant. That coincidence would make this test pass for the wrong reason.
  // Kolkata (+05:30) and New York (-05:00) do not align.
  const kolkata = loginAs(be, ID.repAlpha1);
  authPost(be, kolkata, 'setTimeZone', { timeZone: 'Asia/Kolkata' });
  const east = authGet(be, kolkata, 'getActivityFeed');

  const newYork = loginAs(be, ID.repAlpha2);
  authPost(be, newYork, 'setTimeZone', { timeZone: 'America/New_York' });
  const west = authGet(be, newYork, 'getActivityFeed');

  assert.equal(east.status, 'success');
  assert.equal(west.status, 'success');
  assert.equal(east.data.timeZone, 'Asia/Kolkata');
  assert.equal(west.data.timeZone, 'America/New_York');
  assert.equal(east.data.timeZoneSource, 'viewer');

  assert.notEqual(east.data.from, west.data.from,
    'two people in different zones must not share a "today" boundary');
});

test('TZ-4: an explicit request timezone overrides the stored one', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);
  authPost(be, token, 'setTimeZone', { timeZone: 'Asia/Kolkata' });

  const stored = authGet(be, token, 'getActivityFeed');
  const override = authGet(be, token, 'getActivityFeed', { timeZone: 'America/New_York' });

  assert.equal(stored.data.timeZone, 'Asia/Kolkata');
  assert.equal(override.data.timeZone, 'America/New_York',
    'the browser-detected zone wins for this request');
});

test('TZ-5: an invalid request timezone falls back instead of corrupting the boundary', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);

  const res = authGet(be, token, 'getActivityFeed', { timeZone: 'Not/AZone' });
  assert.equal(res.status, 'success');
  assert.equal(res.data.timeZone, be.call('getCrmTimeZone'),
    'a junk zone falls back to the organisation default');
});

test('TZ-6: productivity is counted against the viewer\'s day', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);
  authPost(be, token, 'setTimeZone', { timeZone: 'Asia/Manila' });

  const res = authGet(be, token, 'getProductivity', { days: '0' });
  assert.equal(res.status, 'success');
  assert.equal(res.data.timeZone, 'Asia/Manila');
  assert.equal(res.data.timeZoneSource, 'viewer');
});

test('TZ-7: organisation analytics stays pinned to one zone', () => {
  const be = buildScenario();
  const su = loginAs(be, ID.superAdmin);
  authPost(be, su, 'setTimeZone', { timeZone: 'Pacific/Honolulu' });

  const res = authGet(be, su, 'getAnalytics');
  assert.equal(res.status, 'success');
  // Org-wide totals must be comparable between viewers, so they do NOT
  // follow whoever happens to be looking.
  assert.equal(res.data.window.timeZone, be.call('getCrmTimeZone'),
    'analytics uses the organisation timezone regardless of viewer');
});

test('TZ-8: a stored timezone survives migration and is never guessed', () => {
  const be = buildScenario();
  const rows = be.rows('Users');
  for (const r of rows) {
    assert.equal(String(r.TimeZone || ''), '',
      'existing users start with no timezone — the system never invents one');
  }
  // And with none set, everyone sees the organisation default.
  const token = loginAs(be, ID.repBeta1);
  const feed = authGet(be, token, 'getActivityFeed');
  assert.equal(feed.data.timeZoneSource, 'organisation default');
});

/* ================================================================== *
 * Day-scoped activity feed and single-entry audit
 * ================================================================== */

test('FEED-DAY-1: a status change writes exactly ONE audit entry', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  authPost(be, token, 'updateLead', { id: ID.leadAlphaNew, Status: 'Contacted' });

  // The client used to write its own STATUS_CHANGE on top of the backend
  // audit, so one edit produced two rows in the history.
  const entries = be.rows('Logs').filter(
    (l) => l.EntityId === ID.leadAlphaNew && l.Action === 'STATUS_CHANGE'
  );
  assert.equal(entries.length, 1, `expected one entry, found ${entries.length}`);
  assert.match(entries[0].Details, /from New to Contacted/,
    'the entry should say what actually changed');
});

test('FEED-DAY-2: a non-status edit is not logged as a status change', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  authPost(be, token, 'updateLead', { id: ID.leadAlphaNew, Notes: 'Just a note.' });

  const statusEntries = be.rows('Logs').filter(
    (l) => l.EntityId === ID.leadAlphaNew && l.Action === 'STATUS_CHANGE'
  );
  assert.equal(statusEntries.length, 0, 'a note edit is not a status change');
  assert.ok(
    be.rows('Logs').some((l) => l.EntityId === ID.leadAlphaNew && l.Action === 'UPDATED'),
    'but it is still audited'
  );
});

test('FEED-DAY-3: setting the same status again logs nothing new', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  authPost(be, token, 'updateLead', { id: ID.leadAlphaNew, Status: 'Contacted' });
  authPost(be, token, 'updateLead', { id: ID.leadAlphaNew, Status: 'Contacted' });
  authPost(be, token, 'updateLead', { id: ID.leadAlphaNew, Status: 'Contacted' });

  const entries = be.rows('Logs').filter(
    (l) => l.EntityId === ID.leadAlphaNew && l.Action === 'STATUS_CHANGE'
  );
  assert.equal(entries.length, 1, 're-selecting the current status should not re-log');
});

test('FEED-DAY-4: the feed can be asked for one specific calendar day', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  // The harness clock is 2026-01-05; the fixture history is 2026-01-03.
  const today = authPost(be, token, 'getActivityFeed', { date: '2026-01-05' });
  const earlier = authPost(be, token, 'getActivityFeed', { date: '2026-01-03' });

  assert.equal(today.status, 'success');
  assert.equal(earlier.status, 'success');
  assert.equal(today.data.date, '2026-01-05');
  assert.equal(earlier.data.date, '2026-01-03');

  // Each day contains only its own events.
  for (const e of earlier.data.entries) {
    assert.ok(String(e.Timestamp).startsWith('2026-01-03'),
      `an entry from ${e.Timestamp} leaked into the 2026-01-03 feed`);
  }
  assert.ok(
    earlier.data.entries.some((e) => e.Action === 'CONVERSION'),
    'the historical entry is reachable by stepping back a day'
  );
  assert.ok(
    !today.data.entries.some((e) => String(e.Timestamp).startsWith('2026-01-03')),
    'and it does not appear in today'
  );
});

test('FEED-DAY-5: a day with no activity returns empty, not an error', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  const quiet = authPost(be, token, 'getActivityFeed', { date: '2025-12-25' });
  assert.equal(quiet.status, 'success');
  assert.equal(quiet.data.entries.length, 0);
  assert.equal(quiet.data.total, 0);
});

test('FEED-DAY-6: the feed reports how many events the day really had', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  // Generate more than one page of activity.
  for (let i = 0; i < 12; i++) {
    authPost(be, token, 'createLog', {
      EntityId: ID.leadAlphaNew, EntityType: 'Lead',
      Action: 'NOTE', Details: `bulk note ${i}`,
    });
  }

  const feed = authPost(be, token, 'getActivityFeed', { date: '2026-01-05', limit: 5 });
  assert.equal(feed.data.entries.length, 5, 'the page is capped');
  assert.ok(feed.data.total >= 12, 'but the true count is reported');
  assert.equal(feed.data.truncated, true, 'and the caller is told it was truncated');
});

test('FEED-DAY-7: older activity is never deleted, only out of view', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  const todayFeed = authPost(be, token, 'getActivityFeed', {});
  const allLogs = authGet(be, token, 'getLogs').data;

  assert.ok(allLogs.length > todayFeed.data.entries.length,
    'the database still holds more than the day in view');
  assert.ok(
    allLogs.some((l) => String(l.Timestamp).startsWith('2026-01-03')),
    'the historical row is still present'
  );
});

/* ================================================================== *
 * Email persistence and drafts
 * ================================================================== */

function withMailbox(be, userId, leadEmail, messages) {
  const acct = be.zoho.addAccount({ email: 'rep@tjgroups.test' });
  for (const m of messages) be.zoho.addMessage(acct.accountId, m);
  be.call('updateRecordRaw', 'Users', userId, {
    ZohoEmail: acct.email, ZohoRefreshToken: acct.refreshToken,
  });
  return acct;
}

test('MAIL-1: fetched messages are stored so the thread survives the mailbox', () => {
  const be = buildScenario();
  const acct = withMailbox(be, ID.repAlpha1, 'buyer@northwind.test', [
    { subject: 'Quote request', sender: 'buyer@northwind.test', toAddress: 'rep@tjgroups.test', content: 'Please send pricing.' },
  ]);

  const token = loginAs(be, ID.repAlpha1);
  const res = authGet(be, token, 'getZohoEmails', {
    leadEmail: 'buyer@northwind.test', leadId: ID.leadAlphaNew,
  });
  assert.equal(res.status, 'success', res.message);

  const stored = be.rows('EmailLog').filter((r) => String(r.ID || ''));
  assert.equal(stored.length, 1, 'the message was archived');
  assert.equal(stored[0].Direction, 'in', 'inbound was detected from the sender');
  assert.equal(stored[0].LeadId, ID.leadAlphaNew, 'and matched to the lead');
  assert.equal(stored[0].Subject, 'Quote request');

  // Now the mailbox goes away entirely.
  be.zoho.invalidateToken(acct.refreshToken);
  const fromCrm = authPost(be, token, 'getStoredEmails', { leadId: ID.leadAlphaNew });
  assert.equal(fromCrm.status, 'success', 'stored mail is readable without Zoho');
  assert.equal(fromCrm.data.length, 1);
});

test('MAIL-2: re-syncing the same thread does not duplicate it', () => {
  const be = buildScenario();
  withMailbox(be, ID.repAlpha1, 'buyer@northwind.test', [
    { subject: 'One', sender: 'buyer@northwind.test', toAddress: 'rep@tjgroups.test' },
    { subject: 'Two', sender: 'buyer@northwind.test', toAddress: 'rep@tjgroups.test' },
  ]);
  const token = loginAs(be, ID.repAlpha1);

  for (let i = 0; i < 4; i++) {
    authGet(be, token, 'getZohoEmails', {
      leadEmail: 'buyer@northwind.test', leadId: ID.leadAlphaNew,
    });
  }

  const stored = be.rows('EmailLog').filter((r) => String(r.ID || ''));
  assert.equal(stored.length, 2, `four syncs stored ${stored.length} rows, expected 2`);

  // Each inbound message earns its own feed entry, once, however many times
  // the thread is re-synced.
  const received = be.rows('Logs').filter((l) => l.Action === 'EMAIL_RECEIVED');
  assert.equal(received.length, 2, 'one entry per message, not per sync');
});

test('MAIL-3: a sent message is recorded immediately', () => {
  const be = buildScenario();
  withMailbox(be, ID.repAlpha1, 'buyer@northwind.test', []);
  const token = loginAs(be, ID.repAlpha1);

  const sent = authPost(be, token, 'sendZohoEmail', {
    leadId: ID.leadAlphaNew, to: 'buyer@northwind.test',
    subject: 'Our proposal', content: '<p>Attached.</p>',
  });
  assert.equal(sent.status, 'success', sent.message);

  const stored = be.rows('EmailLog').filter((r) => String(r.ID || ''));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].Direction, 'out');
  assert.equal(stored[0].Subject, 'Our proposal');
  assert.ok(!/[<>]/.test(stored[0].Summary), 'the summary is plain text, not markup');

  const audit = be.rows('Logs').find((l) => l.Action === 'EMAIL_SENT');
  assert.equal(audit.ContactMode, 'EMAIL', 'sending counts as an EMAIL contact');
});

test('MAIL-4: stored mail follows the same visibility rules as the lead', () => {
  const be = buildScenario();
  withMailbox(be, ID.repAlpha1, 'buyer@northwind.test', [
    { subject: 'Private', sender: 'buyer@northwind.test', toAddress: 'rep@tjgroups.test' },
  ]);
  const owner = loginAs(be, ID.repAlpha1);
  authGet(be, owner, 'getZohoEmails', {
    leadEmail: 'buyer@northwind.test', leadId: ID.leadAlphaNew,
  });

  // A rep on another team cannot read the lead, so cannot read its mail.
  const outsider = loginAs(be, ID.repBeta1);
  const res = authPost(be, outsider, 'getStoredEmails', { leadId: ID.leadAlphaNew });
  assert.equal(res.status, 'error');
  assert.equal(res.code, 'NOT_FOUND');
});

test('MAIL-5: a draft can be saved, reopened and updated', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);

  const first = authPost(be, token, 'saveEmailDraft', {
    leadId: ID.leadAlphaNew, to: 'buyer@northwind.test',
    subject: 'Half written', content: '<p>Hi there,</p>',
  });
  assert.equal(first.status, 'success', first.message);
  assert.equal(first.data.created, true);
  const draftId = first.data.draft.ID;

  const again = authPost(be, token, 'saveEmailDraft', {
    draftId, leadId: ID.leadAlphaNew, to: 'buyer@northwind.test',
    subject: 'Half written', content: '<p>Hi there, here is the quote.</p>',
  });
  assert.equal(again.data.created, false, 'saving again updates rather than duplicates');

  const list = authPost(be, token, 'getEmailDrafts', { leadId: ID.leadAlphaNew }).data;
  assert.equal(list.length, 1, 'one draft, not two');
  assert.match(list[0].Content, /here is the quote/);
});

test('MAIL-6: drafts are private to their author', () => {
  const be = buildScenario();
  const mine = loginAs(be, ID.repAlpha1);
  authPost(be, mine, 'saveEmailDraft', {
    leadId: ID.leadAlphaNew, subject: 'Personal notes', content: 'draft body',
  });

  // Another user on the same lead cannot see or touch it.
  const other = loginAs(be, ID.superAdmin);
  const theirs = authPost(be, other, 'getEmailDrafts', { leadId: ID.leadAlphaNew }).data;
  assert.equal(theirs.length, 0, 'a half-written message is not team-readable');

  const draftId = authPost(be, mine, 'getEmailDrafts', { leadId: ID.leadAlphaNew }).data[0].ID;
  const hijack = authPost(be, other, 'saveEmailDraft', {
    draftId, leadId: ID.leadAlphaNew, content: 'edited by someone else',
  });
  assert.equal(hijack.code, 'FORBIDDEN');
});

test('MAIL-7: sending a draft closes it out', () => {
  const be = buildScenario();
  withMailbox(be, ID.repAlpha1, 'buyer@northwind.test', []);
  const token = loginAs(be, ID.repAlpha1);

  const draftId = authPost(be, token, 'saveEmailDraft', {
    leadId: ID.leadAlphaNew, to: 'buyer@northwind.test',
    subject: 'Ready to go', content: '<p>Sending now.</p>',
  }).data.draft.ID;

  authPost(be, token, 'sendZohoEmail', {
    draftId, leadId: ID.leadAlphaNew, to: 'buyer@northwind.test',
    subject: 'Ready to go', content: '<p>Sending now.</p>',
  });

  const open = authPost(be, token, 'getEmailDrafts', { leadId: ID.leadAlphaNew }).data;
  assert.equal(open.length, 0, 'a sent draft no longer sits in the drafts list');

  const all = authPost(be, token, 'getEmailDrafts', {
    leadId: ID.leadAlphaNew, includeSent: true,
  }).data;
  assert.equal(all.length, 1);
  assert.ok(String(all[0].SentAt).length > 0, 'it is marked sent rather than deleted');
});

test('MAIL-8: a failed archive never blocks reading or sending mail', () => {
  const be = buildScenario();
  withMailbox(be, ID.repAlpha1, 'buyer@northwind.test', [
    { subject: 'Still readable', sender: 'buyer@northwind.test', toAddress: 'rep@tjgroups.test' },
  ]);
  const token = loginAs(be, ID.repAlpha1);

  // Archiving is a convenience. If the sheet write fails, the user must still
  // see their mail rather than get an error about bookkeeping.
  be.store.faults.arm({ on: 'write', sheet: 'EmailLog', times: 1 });
  const res = authGet(be, token, 'getZohoEmails', {
    leadEmail: 'buyer@northwind.test', leadId: ID.leadAlphaNew,
  });
  be.store.faults.clear();

  assert.equal(res.status, 'success', 'the conversation is still returned');
  assert.equal(res.data.length, 1);
});

test('MAIL-9: a plain-text body is not declared as HTML', () => {
  const be = buildScenario();
  withMailbox(be, ID.repAlpha1, 'buyer@northwind.test', []);
  const token = loginAs(be, ID.repAlpha1);

  // Line breaks typed into the composer must survive. Declaring plain text as
  // HTML collapses them, which is what used to happen to every message.
  authPost(be, token, 'sendZohoEmail', {
    leadId: ID.leadAlphaNew, to: 'buyer@northwind.test',
    subject: 'Quote', content: 'Hello,\n\nHere are the numbers.\n\nRegards',
  });

  const sent = be.zoho.sentMail;
  assert.equal(sent.length, 1);
  assert.equal(sent[0].mailFormat, 'plaintext');
  assert.match(sent[0].content, /\n\nRegards/, 'the body went out unaltered');
});

test('MAIL-10: a body containing markup is still sent as HTML', () => {
  const be = buildScenario();
  withMailbox(be, ID.repAlpha1, 'buyer@northwind.test', []);
  const token = loginAs(be, ID.repAlpha1);

  authPost(be, token, 'sendZohoEmail', {
    leadId: ID.leadAlphaNew, to: 'buyer@northwind.test',
    subject: 'Proposal', content: '<p>Please see the <strong>attached</strong> quote.</p>',
  });

  assert.equal(be.zoho.sentMail[0].mailFormat, 'html');
});

/* ================================================================== *
 * Incoming mail — hostile shapes from a real mailbox
 *
 * Reproduces the live crash: an inbound message whose timestamp Zoho does
 * not return as epoch milliseconds.
 * ================================================================== */

test('INBOX-1: a message with a non-numeric timestamp does not take the API down', () => {
  const be = buildScenario();
  const acct = be.zoho.addAccount({ email: 'rep@tjgroups.test' });
  // Zoho does not always hand back epoch millis. Some folders and some
  // message types return a formatted date, and one of those arriving in the
  // inbox is what brought the lead page down in production.
  be.zoho.addMessage(acct.accountId, {
    subject: 'Re: your proposal',
    sender: 'buyer@northwind.test',
    toAddress: 'rep@tjgroups.test',
    receivedTime: 'Aug 19, 2026 10:30 PM',
  });
  be.call('updateRecordRaw', 'Users', ID.repAlpha1, {
    ZohoEmail: acct.email, ZohoRefreshToken: acct.refreshToken,
  });

  const token = loginAs(be, ID.repAlpha1);
  const res = authGet(be, token, 'getZohoEmails', {
    leadEmail: 'buyer@northwind.test', leadId: ID.leadAlphaNew,
  });

  assert.equal(res.status, 'success', `inbound mail broke the request: ${res.message}`);
  assert.equal(res.data.length, 1);
  assert.ok(!Number.isNaN(Date.parse(res.data[0].timestamp)),
    `timestamp is unusable: ${res.data[0].timestamp}`);
});

test('INBOX-2: a message with no timestamp at all is still readable', () => {
  const be = buildScenario();
  const acct = be.zoho.addAccount({ email: 'rep@tjgroups.test' });
  be.zoho.addMessage(acct.accountId, {
    subject: 'No date header',
    sender: 'buyer@northwind.test',
    toAddress: 'rep@tjgroups.test',
    receivedTime: '',
  });
  be.call('updateRecordRaw', 'Users', ID.repAlpha1, {
    ZohoEmail: acct.email, ZohoRefreshToken: acct.refreshToken,
  });

  const token = loginAs(be, ID.repAlpha1);
  const res = authGet(be, token, 'getZohoEmails', {
    leadEmail: 'buyer@northwind.test', leadId: ID.leadAlphaNew,
  });

  assert.equal(res.status, 'success', res.message);
  assert.ok(!Number.isNaN(Date.parse(res.data[0].timestamp)));

  // And the archive copy must be just as usable.
  const stored = be.rows('EmailLog').filter((r) => String(r.ID || ''));
  assert.equal(stored.length, 1);
  assert.ok(!Number.isNaN(Date.parse(stored[0].SentAt)),
    `archived SentAt is unusable: ${stored[0].SentAt}`);
});

test('INBOX-3: sender display names and reply markup survive the round trip', () => {
  const be = buildScenario();
  const acct = be.zoho.addAccount({ email: 'rep@tjgroups.test' });
  be.zoho.addMessage(acct.accountId, {
    subject: 'Re: Pricing — 15% off?',
    sender: '"Ana Ruiz" <buyer@northwind.test>',
    toAddress: 'rep@tjgroups.test',
    summary: '-- Sent from my iPhone',
  });
  be.call('updateRecordRaw', 'Users', ID.repAlpha1, {
    ZohoEmail: acct.email, ZohoRefreshToken: acct.refreshToken,
  });

  const token = loginAs(be, ID.repAlpha1);
  const res = authGet(be, token, 'getZohoEmails', {
    leadEmail: 'buyer@northwind.test', leadId: ID.leadAlphaNew,
  });
  assert.equal(res.status, 'success', res.message);
  assert.equal(res.data[0].direction, 'in', 'a wrapped display name still reads as inbound');

  // A signature starting with "--" trips the formula guard on write; it must
  // come back the way the client actually wrote it.
  const back = authPost(be, token, 'getStoredEmails', { leadId: ID.leadAlphaNew }).data;
  assert.equal(back[0].Summary, '-- Sent from my iPhone');
  assert.match(back[0].Sender, /buyer@northwind\.test/);
});

/* ================================================================== *
 * Mailbox-wide sync, unmatched mail, and email analytics
 * ================================================================== */

function linkMailbox(be, userId, email) {
  const acct = be.zoho.addAccount({ email });
  be.call('updateRecordRaw', 'Users', userId, {
    ZohoEmail: acct.email, ZohoRefreshToken: acct.refreshToken,
  });
  return acct;
}

test('MAILBOX-1: a whole-mailbox sync files mail against leads where it can', () => {
  const be = buildScenario();
  const acct = linkMailbox(be, ID.repAlpha1, 'rep@tjgroups.test');
  const lead = be.call('getRecordByIdRaw', 'Leads', ID.leadAlphaNew);

  be.zoho.addMessage(acct.accountId, {
    subject: 'About the quote', sender: lead.Email, toAddress: 'rep@tjgroups.test',
  });
  be.zoho.addMessage(acct.accountId, {
    subject: 'Office lunch', sender: 'someone@nowhere.test', toAddress: 'rep@tjgroups.test',
  });

  const token = loginAs(be, ID.repAlpha1);
  const res = authPost(be, token, 'syncMailbox', {});
  assert.equal(res.status, 'success', res.message);
  assert.equal(res.data.matchedToLead, 1);
  assert.equal(res.data.withoutLead, 1, 'mail from a stranger is kept, not discarded');
});

test('MAILBOX-2: re-syncing does not duplicate anything', () => {
  const be = buildScenario();
  const acct = linkMailbox(be, ID.repAlpha1, 'rep@tjgroups.test');
  be.zoho.addMessage(acct.accountId, {
    subject: 'Hello', sender: 'stranger@nowhere.test', toAddress: 'rep@tjgroups.test',
  });

  const token = loginAs(be, ID.repAlpha1);
  authPost(be, token, 'syncMailbox', {});
  const second = authPost(be, token, 'syncMailbox', {});

  assert.equal(second.data.stored, 0, 'the second pass had nothing new');
  assert.equal(be.rows('EmailLog').filter((r) => String(r.ID || '')).length, 1);
});

test('MAILBOX-3: unmatched mail reaches a Super Admin but not another rep', () => {
  const be = buildScenario();
  const acct = linkMailbox(be, ID.repAlpha1, 'rep@tjgroups.test');
  be.zoho.addMessage(acct.accountId, {
    subject: 'Nobody in the CRM', sender: 'stranger@nowhere.test',
    toAddress: 'rep@tjgroups.test',
  });
  authPost(be, loginAs(be, ID.repAlpha1), 'syncMailbox', {});

  const boss = authPost(be, loginAs(be, ID.superAdmin), 'getUnmatchedEmails', {}).data;
  assert.equal(boss.total, 1, 'a Super Admin sees correspondence with no lead behind it');
  assert.equal(boss.messages[0].Subject, 'Nobody in the CRM');

  const outsider = authPost(be, loginAs(be, ID.repBeta1), 'getUnmatchedEmails', {}).data;
  assert.equal(outsider.total, 0, 'a rep on another team sees none of it');

  const owner = authPost(be, loginAs(be, ID.repAlpha1), 'getUnmatchedEmails', {}).data;
  assert.equal(owner.total, 1, 'the person whose mailbox it is still sees their own');
});

test('MAILBOX-4: analytics scope follows the role', () => {
  const be = buildScenario();
  const acct = linkMailbox(be, ID.repAlpha1, 'rep@tjgroups.test');
  const lead = be.call('getRecordByIdRaw', 'Leads', ID.leadAlphaNew);
  be.zoho.addMessage(acct.accountId, {
    subject: 'Reply', sender: lead.Email, toAddress: 'rep@tjgroups.test',
  });
  authPost(be, loginAs(be, ID.repAlpha1), 'syncMailbox', {});

  const own = authPost(be, loginAs(be, ID.repAlpha1), 'getEmailAnalytics', {}).data;
  assert.equal(own.scope, 'self');
  assert.equal(own.totals.received, 1);

  const org = authPost(be, loginAs(be, ID.superAdmin), 'getEmailAnalytics', {}).data;
  assert.equal(org.scope, 'organisation');
  assert.equal(org.totals.received, 1);
  assert.equal(org.byUser.length, 1, 'the breakdown names who is doing the emailing');
  assert.equal(org.byUser[0].userId, ID.repAlpha1);

  const other = authPost(be, loginAs(be, ID.repBeta1), 'getEmailAnalytics', {}).data;
  assert.equal(other.totals.received, 0, 'a rep never sees a colleague figures');
});

test('MAILBOX-5: reply rate only counts leads emailed inside the window', () => {
  const be = buildScenario();
  const acct = linkMailbox(be, ID.repAlpha1, 'rep@tjgroups.test');
  const token = loginAs(be, ID.repAlpha1);
  const lead = be.call('getRecordByIdRaw', 'Leads', ID.leadAlphaNew);

  authPost(be, token, 'sendZohoEmail', {
    leadId: ID.leadAlphaNew, to: lead.Email, subject: 'Intro', content: 'Hello there.',
  });

  let stats = authPost(be, token, 'getEmailAnalytics', {}).data;
  assert.equal(stats.engagement.leadsEmailed, 1);
  assert.equal(stats.engagement.replyRatePercent, 0, 'nobody has replied yet');

  be.zoho.addMessage(acct.accountId, {
    subject: 'Re: Intro', sender: lead.Email, toAddress: 'rep@tjgroups.test',
  });
  authPost(be, token, 'syncMailbox', {});

  stats = authPost(be, token, 'getEmailAnalytics', {}).data;
  assert.equal(stats.engagement.replyRatePercent, 100);
});

/* ================================================================== *
 * Attachments
 * ================================================================== */

test('ATTACH-1: a file is uploaded before the message goes out', () => {
  const be = buildScenario();
  linkMailbox(be, ID.repAlpha1, 'rep@tjgroups.test');
  const token = loginAs(be, ID.repAlpha1);

  const res = authPost(be, token, 'sendZohoEmail', {
    leadId: ID.leadAlphaNew, to: 'buyer@northwind.test',
    subject: 'Proposal attached', content: 'See attached.',
    attachments: [{
      name: 'proposal.pdf', mimeType: 'application/pdf',
      data: Buffer.from('%PDF-1.4 pretend document').toString('base64'),
    }],
  });

  assert.equal(res.status, 'success', res.message);
  assert.equal(be.zoho.uploadedAttachments.length, 1);
  assert.equal(be.zoho.uploadedAttachments[0].fileName, 'proposal.pdf');

  const sent = be.zoho.sentMail[0];
  assert.equal(sent.attachments.length, 1, 'the message references the upload');
  assert.equal(sent.attachments[0].attachmentName, 'proposal.pdf');
});

test('ATTACH-2: a rejected upload stops the send rather than mailing a broken promise', () => {
  const be = buildScenario();
  linkMailbox(be, ID.repAlpha1, 'rep@tjgroups.test');
  const token = loginAs(be, ID.repAlpha1);

  be.zoho.setFault('attachment', {
    getResponseCode: () => 500,
    getContentText: () => JSON.stringify({ status: { code: 500, description: 'upload failed' } }),
    getHeaders: () => ({}), getAllHeaders: () => ({}),
  });

  const res = authPost(be, token, 'sendZohoEmail', {
    leadId: ID.leadAlphaNew, to: 'buyer@northwind.test',
    subject: 'Proposal', content: 'See attached.',
    attachments: [{ name: 'x.pdf', data: Buffer.from('data').toString('base64') }],
  });
  be.zoho.clearFaults();

  assert.equal(res.status, 'error');
  assert.equal(be.zoho.sentMail.length, 0, 'no email was sent claiming an attachment');
});

test('ATTACH-3: a filename cannot escape into a path', () => {
  const be = buildScenario();
  linkMailbox(be, ID.repAlpha1, 'rep@tjgroups.test');
  const token = loginAs(be, ID.repAlpha1);

  authPost(be, token, 'sendZohoEmail', {
    leadId: ID.leadAlphaNew, to: 'buyer@northwind.test',
    subject: 'Odd name', content: 'body',
    attachments: [{
      name: '../../../etc/passwd', data: Buffer.from('x').toString('base64'),
    }],
  });

  const name = be.zoho.uploadedAttachments[0].fileName;
  assert.ok(!name.includes('/') && !name.includes('\\'), `unsafe name kept: ${name}`);
  assert.ok(!name.includes('..'), `traversal kept: ${name}`);
});

test('ATTACH-4: oversized attachments are refused with a usable message', () => {
  const be = buildScenario();
  linkMailbox(be, ID.repAlpha1, 'rep@tjgroups.test');
  const token = loginAs(be, ID.repAlpha1);

  const res = authPost(be, token, 'sendZohoEmail', {
    leadId: ID.leadAlphaNew, to: 'buyer@northwind.test',
    subject: 'Huge', content: 'body',
    attachments: [{ name: 'big.bin', data: 'A'.repeat(9 * 1024 * 1024) }],
  });

  assert.equal(res.code, 'VALIDATION_FAILED');
  assert.match(res.message, /too large/i);
  assert.equal(be.zoho.sentMail.length, 0);
});

/* ================================================================== *
 * Research and qualification
 * ================================================================== */

test('RESEARCH-1: findings are stored and stamped with who wrote them', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);

  const res = authPost(be, token, 'updateLead', {
    id: ID.leadAlphaNew,
    ResearchFindings: 'Series B, 40 staff, opened a Dubai office in March.',
    QualificationReason: 'Expanding into our region and already using a competitor.',
    ResearchSource: 'https://example.com/press-release',
  });
  assert.equal(res.status, 'success', res.message);

  const lead = be.call('getRecordByIdRaw', 'Leads', ID.leadAlphaNew);
  assert.match(lead.ResearchFindings, /Series B/);
  assert.equal(lead.ResearchUpdatedBy, ID.repAlpha1, 'stamped server-side');
  assert.ok(!Number.isNaN(Date.parse(lead.ResearchUpdatedAt)));

  const entry = be.rows('Logs').find((l) => l.Action === 'RESEARCH_UPDATED');
  assert.ok(entry, 'the history distinguishes a research edit from any other edit');
});

test('RESEARCH-2: a rep may write research on their own lead but not rename the company', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);

  const res = authPost(be, token, 'updateLead', {
    id: ID.leadAlphaNew,
    ResearchFindings: 'Hiring aggressively.',
    Name: 'Renamed By A Rep',
  });
  assert.equal(res.status, 'success', res.message);

  const lead = be.call('getRecordByIdRaw', 'Leads', ID.leadAlphaNew);
  assert.equal(lead.ResearchFindings, 'Hiring aggressively.');
  assert.notEqual(lead.Name, 'Renamed By A Rep', 'identity is still manager-only');
});

test('RESEARCH-3: the client cannot forge who last revised the research', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);

  authPost(be, token, 'updateLead', {
    id: ID.leadAlphaNew,
    ResearchFindings: 'Notes.',
    ResearchUpdatedBy: ID.superAdmin,
    ResearchUpdatedAt: '1999-01-01T00:00:00.000Z',
  });

  const lead = be.call('getRecordByIdRaw', 'Leads', ID.leadAlphaNew);
  assert.equal(lead.ResearchUpdatedBy, ID.repAlpha1);
  assert.notEqual(lead.ResearchUpdatedAt, '1999-01-01T00:00:00.000Z');
});

/* ================================================================== *
 * Batched reads
 *
 * A transport optimisation: one Apps Script execution instead of six. It must
 * not become a way around the permission table.
 * ================================================================== */

test('BATCH-1: several reads come back in one request, keyed', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  const res = authPost(be, token, 'batch', {
    requests: [
      { key: 'lead', action: 'getLeadById', payload: { id: ID.leadAlphaNew } },
      { key: 'users', action: 'getUsers' },
      { key: 'logs', action: 'getLogs', payload: { id: ID.leadAlphaNew } },
    ],
  });

  assert.equal(res.status, 'success', res.message);
  assert.equal(res.data.results.length, 3);

  const byKey = Object.fromEntries(res.data.results.map((r) => [r.key, r]));
  assert.equal(byKey.lead.status, 'success');
  assert.equal(byKey.lead.data.ID, ID.leadAlphaNew);
  assert.ok(byKey.users.data.length > 0);
  assert.ok(Array.isArray(byKey.logs.data));
});

test('BATCH-2: a batch cannot be used to write', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);
  const before = be.call('getRecordByIdRaw', 'Leads', ID.leadAlphaNew);

  const res = authPost(be, token, 'batch', {
    requests: [
      { key: 'sneak', action: 'deleteLead', payload: { leadId: ID.leadAlphaNew, reason: 'x' } },
      { key: 'sneak2', action: 'updateLead', payload: { id: ID.leadAlphaNew, Status: 'Qualified' } },
    ],
  });

  assert.equal(res.data.results[0].status, 'error');
  assert.equal(res.data.results[1].status, 'error');

  const after = be.call('getRecordByIdRaw', 'Leads', ID.leadAlphaNew);
  assert.equal(after.Status, before.Status, 'nothing was written');
  assert.ok(!after.Deleted, 'the lead is still there');
});

test('BATCH-3: role limits still apply inside a batch', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);

  const res = authPost(be, token, 'batch', {
    requests: [
      { key: 'mine', action: 'getLeads' },
      { key: 'notmine', action: 'getAnalytics', payload: { days: 30 } },
    ],
  });

  const byKey = Object.fromEntries(res.data.results.map((r) => [r.key, r]));
  assert.equal(byKey.mine.status, 'success', 'a rep can still read their own leads');
  assert.equal(byKey.notmine.status, 'error', 'but not organisation analytics');
  assert.equal(byKey.notmine.code, 'FORBIDDEN');
});

test('BATCH-4: record scoping is unchanged when batched', () => {
  const be = buildScenario();

  const direct = authGet(be, loginAs(be, ID.repAlpha1), 'getLeads', {}).data;
  const batched = authPost(be, loginAs(be, ID.repAlpha1), 'batch', {
    requests: [{ key: 'leads', action: 'getLeads' }],
  }).data.results[0].data;

  assert.equal(batched.length, direct.length,
    'batching returned a different number of leads than calling directly');
  assert.deepEqual(batched.map((l) => l.ID).sort(), direct.map((l) => l.ID).sort());
});

test('BATCH-5: one failing read does not sink the others', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  const res = authPost(be, token, 'batch', {
    requests: [
      { key: 'good', action: 'getUsers' },
      { key: 'missing', action: 'getLeadById', payload: { id: 'no-such-lead' } },
      { key: 'alsogood', action: 'getDeals' },
    ],
  });

  assert.equal(res.status, 'success', 'the batch itself succeeded');
  const byKey = Object.fromEntries(res.data.results.map((r) => [r.key, r]));
  assert.equal(byKey.good.status, 'success');
  assert.equal(byKey.missing.status, 'error');
  assert.equal(byKey.missing.code, 'NOT_FOUND');
  assert.equal(byKey.alsogood.status, 'success', 'a later read still ran');
});

test('BATCH-6: an unauthenticated batch is refused whole', () => {
  const be = buildScenario();
  const res = JSON.parse(be.postRaw(JSON.stringify({
    action: 'batch',
    payload: { requests: [{ key: 'u', action: 'getUsers' }] },
  }))._raw);

  assert.equal(res.status, 'error');
  assert.equal(res.code, 'UNAUTHENTICATED');
});

test('BATCH-7: an oversized batch is refused rather than run', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);
  const requests = [];
  for (let i = 0; i < 25; i++) requests.push({ key: `r${i}`, action: 'getUsers' });

  const res = authPost(be, token, 'batch', { requests });
  assert.equal(res.status, 'error');
  assert.equal(res.code, 'BAD_REQUEST');
  assert.match(res.message, /at most/i);
});

test('PERF-1: the daily feed narrows to the day before sorting or scoping', () => {
  const be = buildScenario();

  // A year of history, one entry per day, all on the same lead.
  const day = 86400000;
  const base = Date.parse('2026-01-05T09:00:00.000Z');
  for (let i = 0; i < 400; i++) {
    be.call('appendRecordRaw', 'Logs', {
      EntityId: ID.leadAlphaNew, EntityType: 'Lead', Action: 'CALL',
      UserId: ID.superAdmin, Details: `day ${i}`, ContactMode: 'CALL',
      Timestamp: new Date(base - i * day).toISOString(),
    });
  }

  const token = loginAs(be, ID.superAdmin);
  const res = authPost(be, token, 'getActivityFeed', { date: '2026-01-05', timeZone: 'UTC' });

  assert.equal(res.status, 'success', res.message);
  // Exactly the one seeded on that date, plus whatever the scenario logged.
  const mine = res.data.entries.filter((e) => String(e.Details).startsWith('day '));
  assert.equal(mine.length, 1, `expected one seeded entry for the day, got ${mine.length}`);
  assert.equal(mine[0].Details, 'day 0');
  assert.equal(res.data.total, res.data.entries.length,
    'total must count the day, not the whole history');
});

test('PERF-2: the dashboard can ask for one kind of log instead of all of them', () => {
  const be = buildScenario();
  for (let i = 0; i < 60; i++) {
    be.call('appendRecordRaw', 'Logs', {
      EntityId: ID.leadAlphaNew, EntityType: 'Lead',
      Action: i % 10 === 0 ? 'DAILY_LOG' : 'CALL',
      UserId: ID.superAdmin, Details: `entry ${i}`,
      Timestamp: new Date(Date.parse('2026-01-05T09:00:00Z') - i * 3600e3).toISOString(),
    });
  }

  const token = loginAs(be, ID.superAdmin);
  const all = authGet(be, token, 'getLogs', {}).data;
  const daily = authGet(be, token, 'getLogs', { logAction: 'DAILY_LOG' }).data;

  assert.equal(daily.length, 6, 'exactly the daily summaries came back');
  assert.ok(daily.every((l) => l.Action === 'DAILY_LOG'));
  assert.ok(all.length > daily.length * 5,
    'the filter must actually be saving payload, not returning everything');
});

test('PERF-3: an unknown action filter returns nothing rather than everything', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);
  const res = authGet(be, token, 'getLogs', { logAction: 'NO_SUCH_ACTION' }).data;
  assert.equal(res.length, 0, 'a filter that matches nothing must not fall back to all rows');
});

/* ================================================================== *
 * Activity feed scope — who sees whose work
 * ================================================================== */

test('FEED-SCOPE-1: a rep sees only their own activity in the feed', () => {
  const be = buildScenario();

  // Two people on DIFFERENT teams both work on the same day.
  be.call('appendRecordRaw', 'Logs', {
    EntityId: ID.leadAlphaNew, EntityType: 'Lead', Action: 'CALL',
    UserId: ID.repAlpha1, Details: 'alpha rep made a call',
    ContactMode: 'CALL', Timestamp: '2026-01-05T09:30:00.000Z',
  });
  be.call('appendRecordRaw', 'Logs', {
    EntityId: ID.leadBetaNew, EntityType: 'Lead', Action: 'CALL',
    UserId: ID.repBeta1, Details: 'beta rep made a call',
    ContactMode: 'CALL', Timestamp: '2026-01-05T09:40:00.000Z',
  });

  const feed = authPost(be, loginAs(be, ID.repAlpha1), 'getActivityFeed',
    { date: '2026-01-05', timeZone: 'UTC' }).data;

  const details = feed.entries.map((e) => e.Details);
  assert.ok(details.includes('alpha rep made a call'), 'a rep must see their own work');
  assert.ok(!details.includes('beta rep made a call'),
    'a rep must NOT see another team’s activity in the global feed');
});

test('FEED-SCOPE-2: a Super Admin sees everyone', () => {
  const be = buildScenario();

  be.call('appendRecordRaw', 'Logs', {
    EntityId: ID.leadAlphaNew, EntityType: 'Lead', Action: 'CALL',
    UserId: ID.repAlpha1, Details: 'alpha rep made a call',
    ContactMode: 'CALL', Timestamp: '2026-01-05T09:30:00.000Z',
  });
  be.call('appendRecordRaw', 'Logs', {
    EntityId: ID.leadBetaNew, EntityType: 'Lead', Action: 'CALL',
    UserId: ID.repBeta1, Details: 'beta rep made a call',
    ContactMode: 'CALL', Timestamp: '2026-01-05T09:40:00.000Z',
  });

  const feed = authPost(be, loginAs(be, ID.superAdmin), 'getActivityFeed',
    { date: '2026-01-05', timeZone: 'UTC' }).data;

  const details = feed.entries.map((e) => e.Details);
  assert.ok(details.includes('alpha rep made a call'));
  assert.ok(details.includes('beta rep made a call'),
    'a Super Admin oversees everyone, so both teams appear');
});

test('FEED-SCOPE-3: an Admin sees their own team and not another', () => {
  const be = buildScenario();

  be.call('appendRecordRaw', 'Logs', {
    EntityId: ID.leadAlphaNew, EntityType: 'Lead', Action: 'CALL',
    UserId: ID.repAlpha1, Details: 'alpha rep made a call',
    ContactMode: 'CALL', Timestamp: '2026-01-05T09:30:00.000Z',
  });
  be.call('appendRecordRaw', 'Logs', {
    EntityId: ID.leadBetaNew, EntityType: 'Lead', Action: 'CALL',
    UserId: ID.repBeta1, Details: 'beta rep made a call',
    ContactMode: 'CALL', Timestamp: '2026-01-05T09:40:00.000Z',
  });

  const feed = authPost(be, loginAs(be, ID.adminAlpha), 'getActivityFeed',
    { date: '2026-01-05', timeZone: 'UTC' }).data;

  const details = feed.entries.map((e) => e.Details);
  assert.ok(details.includes('alpha rep made a call'),
    'an Admin sees the team they lead');
  assert.ok(!details.includes('beta rep made a call'),
    'an Admin does not see a team they do not lead');
});

/* ================================================================== *
 * Notification and page reads must stay bounded
 * ================================================================== */

test('PERF-4: today-only email logs come back in one filtered read', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  // Noise across many days and many kinds.
  for (let i = 0; i < 80; i++) {
    be.call('appendRecordRaw', 'Logs', {
      EntityId: ID.leadAlphaNew, EntityType: 'Lead',
      Action: i % 4 === 0 ? 'EMAIL_SENT' : 'CALL',
      UserId: ID.superAdmin, Details: `entry ${i}`,
      Timestamp: new Date(Date.parse('2026-01-05T09:00:00Z') - i * 3600e3).toISOString(),
    });
  }

  const since = '2026-01-05T00:00:00.000Z';
  const res = authGet(be, token, 'getLogs', { logAction: 'EMAIL,EMAIL_SENT', since });

  assert.equal(res.status, 'success', res.message);
  assert.ok(res.data.length > 0, 'the filter returned nothing at all');
  assert.ok(res.data.every((l) => l.Action === 'EMAIL' || l.Action === 'EMAIL_SENT'),
    'the action filter let something else through');
  assert.ok(res.data.every((l) => Date.parse(l.Timestamp) >= Date.parse(since)),
    'the since filter let an older row through');
});

test('PERF-5: a comma-separated action filter returns both kinds', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  for (const action of ['MEETING', 'SCHEDULED_CALL', 'CALL', 'DAILY_LOG']) {
    be.call('appendRecordRaw', 'Logs', {
      EntityId: ID.leadAlphaNew, EntityType: 'Lead', Action: action,
      UserId: ID.superAdmin, Details: `a ${action}`,
      Timestamp: '2026-01-05T09:00:00.000Z',
    });
  }

  const res = authGet(be, token, 'getLogs', { logAction: 'MEETING,SCHEDULED_CALL' }).data;
  const actions = res.map((l) => l.Action);

  assert.ok(actions.includes('MEETING'));
  assert.ok(actions.includes('SCHEDULED_CALL'));
  assert.ok(!actions.includes('CALL'), 'an unrequested action came back');
  assert.ok(!actions.includes('DAILY_LOG'), 'an unrequested action came back');
});

/* ================================================================== *
 * Outbound sender identity
 * ================================================================== */

test('MAIL-11: outbound mail carries a human name, not a login handle', () => {
  const be = buildScenario();
  const acct = be.zoho.addAccount({ email: 'dhiraj.th@tjgroups.test' });
  be.call('updateRecordRaw', 'Users', ID.superAdmin, {
    ZohoEmail: acct.email, ZohoRefreshToken: acct.refreshToken,
    Username: 'dhiraj_th', DisplayName: 'Dhiraj T H',
  });

  const token = loginAs(be, ID.superAdmin);
  authPost(be, token, 'sendZohoEmail', {
    leadId: ID.leadAlphaNew, to: 'buyer@northwind.test',
    subject: 'Hello', content: 'A message.',
  });

  const from = be.zoho.sentMail[0].fromAddress;
  assert.equal(from, '"Dhiraj T H" <dhiraj.th@tjgroups.test>',
    `the recipient would see "${from}" instead of a person`);
});

test('MAIL-12: with no DisplayName the username is tidied rather than shown raw', () => {
  const be = buildScenario();
  const acct = be.zoho.addAccount({ email: 'carlos.llanos@tjgroups.test' });
  be.call('updateRecordRaw', 'Users', ID.repAlpha1, {
    ZohoEmail: acct.email, ZohoRefreshToken: acct.refreshToken,
    Username: 'carlos_llanos', DisplayName: '',
  });

  const token = loginAs(be, ID.repAlpha1);
  authPost(be, token, 'sendZohoEmail', {
    leadId: ID.leadAlphaNew, to: 'buyer@northwind.test',
    subject: 'Hello', content: 'A message.',
  });

  assert.equal(be.zoho.sentMail[0].fromAddress,
    '"Carlos Llanos" <carlos.llanos@tjgroups.test>');
});

test('MAIL-13: a name containing quotes cannot break the From header', () => {
  const be = buildScenario();
  const acct = be.zoho.addAccount({ email: 'odd@tjgroups.test' });
  be.call('updateRecordRaw', 'Users', ID.repAlpha1, {
    ZohoEmail: acct.email, ZohoRefreshToken: acct.refreshToken,
    DisplayName: 'Bob "The Closer" \\ Smith',
  });

  const token = loginAs(be, ID.repAlpha1);
  authPost(be, token, 'sendZohoEmail', {
    leadId: ID.leadAlphaNew, to: 'buyer@northwind.test',
    subject: 'Hello', content: 'A message.',
  });

  const from = be.zoho.sentMail[0].fromAddress;
  // Every quote inside the display name must be escaped, or the header ends
  // early and the address is mangled.
  const inner = from.slice(1, from.lastIndexOf('"'));
  assert.ok(!/(^|[^\\])"/.test(inner), `unescaped quote in From: ${from}`);
  assert.ok(from.endsWith('<odd@tjgroups.test>'), `address lost: ${from}`);
});

test('MAIL-14: a brand new lead is not marked contacted by older correspondence', () => {
  const be = buildScenario();
  const acct = be.zoho.addAccount({ email: 'rep@tjgroups.test' });
  be.call('updateRecordRaw', 'Users', ID.repAlpha1, {
    ZohoEmail: acct.email, ZohoRefreshToken: acct.refreshToken,
  });

  // Mail exchanged with this address LONG before the lead existed.
  be.zoho.addMessage(acct.accountId, {
    subject: 'Old thread', sender: 'rep@tjgroups.test',
    toAddress: 'buyer@northwind.test',
    receivedTime: Date.parse('2020-01-01T10:00:00Z'),
  });

  const token = loginAs(be, ID.repAlpha1);
  const created = authPost(be, token, 'createLead', {
    Name: 'Brand New Co', Email: 'buyer@northwind.test', Status: 'New',
  });
  assert.equal(created.status, 'success', created.message);
  assert.equal(created.data.Status, 'New', 'a lead must be created as New');

  // Reading the conversation must not change the lead's status.
  authGet(be, token, 'getZohoEmails', {
    leadEmail: 'buyer@northwind.test', leadId: created.data.ID,
  });

  const after = be.call('getRecordByIdRaw', 'Leads', created.data.ID);
  assert.equal(after.Status, 'New',
    'the lead was moved off New by correspondence that predates it');
});

test('MAIL-15: a reply from the lead appears in the conversation', () => {
  const be = buildScenario();
  const acct = be.zoho.addAccount({ email: 'rep@tjgroups.test' });
  be.call('updateRecordRaw', 'Users', ID.repAlpha1, {
    ZohoEmail: acct.email, ZohoRefreshToken: acct.refreshToken,
  });

  // We wrote to them; they replied.
  be.zoho.addMessage(acct.accountId, {
    subject: 'Our proposal', sender: 'rep@tjgroups.test',
    toAddress: 'buyer@northwind.test',
    receivedTime: Date.parse('2026-01-05T09:00:00Z'),
  });
  be.zoho.addMessage(acct.accountId, {
    subject: 'Re: Our proposal', sender: 'buyer@northwind.test',
    toAddress: 'rep@tjgroups.test',
    receivedTime: Date.parse('2026-01-05T11:00:00Z'),
  });

  const token = loginAs(be, ID.repAlpha1);
  const res = authGet(be, token, 'getZohoEmails', {
    leadEmail: 'buyer@northwind.test', leadId: ID.leadAlphaNew,
  });
  assert.equal(res.status, 'success', res.message);

  const inbound = res.data.filter((m) => m.direction === 'in');
  assert.equal(inbound.length, 1,
    'the reply is missing — only messages WE sent came back, which is what an ' +
    'unrecognised sender search key produces');
  assert.equal(inbound[0].subject, 'Re: Our proposal');

  assert.equal(res.data.length, 2, 'both halves of the conversation must be present');
});

test('MAIL-16: a reply is archived and readable without Zoho', () => {
  const be = buildScenario();
  const acct = be.zoho.addAccount({ email: 'rep@tjgroups.test' });
  be.call('updateRecordRaw', 'Users', ID.repAlpha1, {
    ZohoEmail: acct.email, ZohoRefreshToken: acct.refreshToken,
  });
  be.zoho.addMessage(acct.accountId, {
    subject: 'Re: Our proposal', sender: 'buyer@northwind.test',
    toAddress: 'rep@tjgroups.test',
  });

  const token = loginAs(be, ID.repAlpha1);
  authGet(be, token, 'getZohoEmails', {
    leadEmail: 'buyer@northwind.test', leadId: ID.leadAlphaNew,
  });

  const stored = be.rows('EmailLog').filter((r) => String(r.ID || ''));
  assert.equal(stored.length, 1, 'the reply was not archived');
  assert.equal(stored[0].Direction, 'in');

  // And it reaches the global feed, so the team sees the client got in touch.
  const feed = be.rows('Logs').filter((l) => l.Action === 'EMAIL_RECEIVED');
  assert.equal(feed.length, 1, 'the reply did not reach the activity feed');
});

test('MAIL-17: the search does not depend on one spelling of the sender key', () => {
  const be = buildScenario();
  const acct = be.zoho.addAccount({ email: 'rep@tjgroups.test' });
  be.call('updateRecordRaw', 'Users', ID.repAlpha1, {
    ZohoEmail: acct.email, ZohoRefreshToken: acct.refreshToken,
  });
  be.zoho.addMessage(acct.accountId, {
    subject: 'Re: hello', sender: 'buyer@northwind.test',
    toAddress: 'rep@tjgroups.test',
  });

  const token = loginAs(be, ID.repAlpha1);
  authGet(be, token, 'getZohoEmails', {
    leadEmail: 'buyer@northwind.test', leadId: ID.leadAlphaNew,
  });

  // The mock answers `from:` and returns nothing for `sender:`. Inbound mail
  // still arrived, which is the whole point of asking both ways.
  const keys = be.zoho.state.calls
    .map((c) => decodeURIComponent(String(c.url)))
    .filter((u) => u.indexOf('/messages/search') !== -1);

  assert.ok(keys.some((u) => u.indexOf('from:') !== -1),
    'the documented sender key was never tried');
  assert.ok(keys.some((u) => u.indexOf('to:') !== -1),
    'the recipient key was never tried');
});
