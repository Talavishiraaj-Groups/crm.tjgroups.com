/**
 * Lead deletion — soft, archived, reversible.
 *
 * "Delete" here flags the Leads row and writes a DeletedLeads archive entry.
 * The original row is never moved and never cleared, because a move is a
 * delete plus an insert: if the insert fails, the record is gone.
 *
 * Run: node --test local/tests/lead-deletion.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScenario, loginAs, authPost, authGet, ID } from '../harness/scenario.mjs';

test('DELETE-1: a manager deletes a lead; the row is flagged, never removed', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.adminAlpha);

  const rowsBefore = be.store.getSheet('Leads').dataRows.length;

  const res = authPost(be, token, 'deleteLead', {
    leadId: ID.leadAlphaNew, reason: 'Duplicate of an existing account.',
  });
  assert.equal(res.status, 'success');
  assert.equal(res.data.idempotent, false);

  // The physical row still exists — nothing was cleared or moved.
  assert.equal(be.store.getSheet('Leads').dataRows.length, rowsBefore,
    'the sheet still has the same number of rows');

  const row = be.rows('Leads').find((l) => l.ID === ID.leadAlphaNew);
  assert.ok(row, 'the record is still physically present');
  assert.ok(be.call('isTrueFlag', row.Deleted));
  assert.equal(row.DeletedBy, ID.adminAlpha);
  assert.equal(row.DeleteReason, 'Duplicate of an existing account.');
  assert.equal(row.Name, 'Northwind Traders', 'the original values are intact');
});

test('DELETE-2: the deleted lead disappears from normal reads', () => {
  const be = buildScenario();
  const admin = loginAs(be, ID.adminAlpha);
  authPost(be, admin, 'deleteLead', { leadId: ID.leadAlphaNew });

  const su = loginAs(be, ID.superAdmin);
  const list = authGet(be, su, 'getLeads');
  assert.ok(
    !list.data.some((l) => l.ID === ID.leadAlphaNew),
    'a deleted lead is not listed'
  );

  const byId = authGet(be, su, 'getLeadById', { id: ID.leadAlphaNew });
  assert.equal(byId.code, 'NOT_FOUND', 'and cannot be fetched directly');
});

test('DELETE-3: the archive records who, when, why, and a full snapshot', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.adminAlpha);

  authPost(be, token, 'deleteLead', { leadId: ID.leadAlphaNew, reason: 'Bad data.' });

  const archive = authGet(be, token, 'getDeletedLeads');
  assert.equal(archive.status, 'success');
  assert.equal(archive.data.length, 1);

  const entry = archive.data[0];
  assert.equal(entry.LeadId, ID.leadAlphaNew);
  assert.equal(entry.LeadName, 'Northwind Traders');
  assert.equal(entry.DeletedBy, ID.adminAlpha);
  assert.equal(entry.DeletedByUsername, 'admin_alpha');
  assert.equal(entry.Reason, 'Bad data.');
  assert.ok(String(entry.DeletedAt).length > 0);

  // The snapshot preserves the record independently of the source row.
  const snapshot = JSON.parse(entry.Snapshot);
  assert.equal(snapshot.Name, 'Northwind Traders');
  assert.equal(snapshot.Email, 'buyer@northwind.test');
});

test('DELETE-4: deleting is idempotent', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.adminAlpha);

  const first = authPost(be, token, 'deleteLead', { leadId: ID.leadAlphaNew });
  const second = authPost(be, token, 'deleteLead', { leadId: ID.leadAlphaNew });
  const third = authPost(be, token, 'deleteLead', { leadId: ID.leadAlphaNew });

  assert.equal(first.data.idempotent, false);
  assert.equal(second.data.idempotent, true);
  assert.equal(third.data.idempotent, true);

  assert.equal(authGet(be, token, 'getDeletedLeads').data.length, 1,
    'three clicks produce one archive entry');
  assert.equal(
    be.rows('Logs').filter((l) => l.Action === 'LEAD_DELETED').length, 1,
    'and one audit event'
  );
});

test('DELETE-5: a lead that became a deal cannot be deleted', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.adminAlpha);

  // leadAlphaQualified is referenced by dealAlphaOpen.
  const res = authPost(be, token, 'deleteLead', { leadId: ID.leadAlphaQualified });
  assert.equal(res.status, 'error');
  assert.equal(res.code, 'CONFLICT');
  assert.match(res.message, /converted to a deal/);

  const row = be.rows('Leads').find((l) => l.ID === ID.leadAlphaQualified);
  assert.notEqual(row.Deleted, 'TRUE', 'the lead is untouched');
});

test('DELETE-6: reps and setters cannot delete leads', () => {
  const be = buildScenario();
  for (const userId of [ID.repAlpha1, ID.setterAlpha]) {
    const token = loginAs(be, userId);
    const res = authPost(be, token, 'deleteLead', { leadId: ID.leadAlphaNew });
    assert.equal(res.code, 'FORBIDDEN', `${userId} must not delete leads`);
  }
  const row = be.rows('Leads').find((l) => l.ID === ID.leadAlphaNew);
  assert.notEqual(row.Deleted, 'TRUE');
});

test('DELETE-7: a client cannot hide a lead by writing the Deleted field', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);

  const res = authPost(be, token, 'updateLead', {
    id: ID.leadAlphaNew, Deleted: 'TRUE', DeletedBy: ID.superAdmin, Notes: 'ok',
  });
  assert.equal(res.status, 'success', 'the legitimate field still saves');

  const row = be.rows('Leads').find((l) => l.ID === ID.leadAlphaNew);
  assert.equal(row.Notes, 'ok');
  assert.notEqual(row.Deleted, 'TRUE', 'deletion cannot be forged through a field write');
  assert.equal(authGet(be, token, 'getDeletedLeads').status, 'error',
    'and a rep cannot read the archive either');
});

test('DELETE-8: restoring brings the lead back with its data intact', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.adminAlpha);

  authPost(be, token, 'deleteLead', { leadId: ID.leadAlphaNew, reason: 'Mistake.' });
  const restored = authPost(be, token, 'restoreLead', { leadId: ID.leadAlphaNew });
  assert.equal(restored.status, 'success');

  const su = loginAs(be, ID.superAdmin);
  const back = authGet(be, su, 'getLeads').data.find((l) => l.ID === ID.leadAlphaNew);
  assert.ok(back, 'the lead is listed again');
  assert.equal(back.Name, 'Northwind Traders');
  assert.equal(back.Email, 'buyer@northwind.test');
  assert.equal(String(back.Deleted || ''), '');

  // The deletion still happened, so it stays in the history.
  const archive = authGet(be, token, 'getDeletedLeads', { includeRestored: 'true' });
  assert.equal(archive.data.length, 1);
  assert.ok(String(archive.data[0].RestoredAt).length > 0,
    'the entry is closed out, not erased');

  const actions = be.rows('Logs').map((l) => l.Action);
  assert.ok(actions.includes('LEAD_DELETED'));
  assert.ok(actions.includes('LEAD_RESTORED'));
});

test('DELETE-9: a failed archive write leaves the lead undeleted', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.adminAlpha);

  // The archive is written FIRST, so a failure there must abort the deletion
  // rather than hiding a lead with no record of why.
  be.store.faults.arm({ on: 'write', sheet: 'DeletedLeads', times: 1 });
  const res = authPost(be, token, 'deleteLead', { leadId: ID.leadAlphaNew });
  be.store.faults.clear();

  assert.equal(res.status, 'error', 'the caller is told it failed');

  const row = be.rows('Leads').find((l) => l.ID === ID.leadAlphaNew);
  assert.notEqual(row.Deleted, 'TRUE', 'the lead was not hidden');

  const su = loginAs(be, ID.superAdmin);
  assert.ok(
    authGet(be, su, 'getLeads').data.some((l) => l.ID === ID.leadAlphaNew),
    'and it is still visible in the CRM'
  );
});

test('DELETE-10: the lead list shrinks by exactly one', () => {
  const be = buildScenario();
  const su = loginAs(be, ID.superAdmin);

  const before = authGet(be, su, 'getLeads').data.length;
  const admin = loginAs(be, ID.adminAlpha);
  authPost(be, admin, 'deleteLead', { leadId: ID.leadAlphaNew });

  const after = authGet(be, su, 'getLeads').data.length;
  assert.equal(after, before - 1);
});

test('DELETE-11: an export still contains the deleted row and the archive', () => {
  const be = buildScenario();
  const admin = loginAs(be, ID.adminAlpha);
  authPost(be, admin, 'deleteLead', { leadId: ID.leadAlphaNew, reason: 'Duplicate.' });

  const su = loginAs(be, ID.superAdmin);
  const dump = authPost(be, su, 'exportAllData', {}).data;

  // A full export is a backup: it must include everything the sheet holds,
  // including rows the CRM is hiding.
  const exported = dump.entities.Leads.records.find((r) => r.ID === ID.leadAlphaNew);
  assert.ok(exported, 'the deleted lead is still in the export');
  assert.ok(be.call('isTrueFlag', exported.Deleted));

  assert.ok(dump.entities.DeletedLeads, 'the archive sheet is exported too');
  assert.equal(dump.entities.DeletedLeads.records.length, 1);
  assert.equal(dump.entities.DeletedLeads.records[0].Reason, 'Duplicate.');
});

/* ================================================================== *
 * Editing a lead that carries legacy data
 * ================================================================== */

test('EDIT-LEGACY-1: an untouched invalid field does not block an edit', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  // Real production leads hold values that predate validation: an email
  // column containing "n.a. - no address published", a LinkedIn with no
  // scheme. Write one directly, the way the sheet already holds it.
  be.call('updateRecordRaw', 'Leads', ID.leadAlphaNew, {
    Email: 'n.a. - no address published on the contact page',
    Linkedin: 'linkedin.com/in/someone',
  });

  // Editing ONLY the notes must succeed — the form sends just what changed,
  // so the legacy values are never re-validated.
  const ok = authPost(be, token, 'updateLead', {
    id: ID.leadAlphaNew, Notes: 'Spoke to their ops lead.',
  });
  assert.equal(ok.status, 'success', 'a notes-only edit is not blocked by legacy data');

  const row = be.rows('Leads').find((l) => l.ID === ID.leadAlphaNew);
  assert.equal(row.Notes, 'Spoke to their ops lead.');
  assert.equal(row.Email, 'n.a. - no address published on the contact page',
    'and the legacy value is left exactly as it was');
});

test('EDIT-LEGACY-2: a newly typed invalid value is still rejected', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  // Relaxing validation for legacy rows must not relax it for new input.
  const bad = authPost(be, token, 'updateLead', {
    id: ID.leadAlphaNew, Email: 'still-not-an-email',
  });
  assert.equal(bad.status, 'error');
  assert.equal(bad.code, 'VALIDATION_FAILED');

  const row = be.rows('Leads').find((l) => l.ID === ID.leadAlphaNew);
  assert.equal(row.Email, 'buyer@northwind.test', 'the stored value is unchanged');
});

/* ================================================================== *
 * Lead identity is manager-only
 * ================================================================== */

test('EDITPERM-1: a rep cannot change a lead\'s identity fields', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);   // owns leadAlphaNew

  const res = authPost(be, token, 'updateLead', {
    id: ID.leadAlphaNew,
    Name: 'Renamed By A Rep',
    Email: 'rep-changed@example.test',
    Phone: '+10000000',
    Linkedin: 'https://linkedin.com/company/changed',
  });

  // The identity fields are stripped, so nothing writable remains.
  assert.equal(res.status, 'error');
  assert.equal(res.code, 'BAD_REQUEST');

  const row = be.rows('Leads').find((l) => l.ID === ID.leadAlphaNew);
  assert.equal(row.Name, 'Northwind Traders', 'name unchanged');
  assert.equal(row.Email, 'buyer@northwind.test', 'email unchanged');
});

test('EDITPERM-2: a rep can still do their actual job on their own lead', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);

  // Status, notes and follow-up are the day-to-day work of whoever owns the
  // lead. Restricting identity must not stop a rep working their pipeline.
  const res = authPost(be, token, 'updateLead', {
    id: ID.leadAlphaNew,
    Status: 'Qualified',
    Notes: 'Budget confirmed on the call.',
    NextFollowUp: '2026-02-10',
  });
  assert.equal(res.status, 'success');

  const row = be.rows('Leads').find((l) => l.ID === ID.leadAlphaNew);
  assert.equal(row.Status, 'Qualified');
  assert.equal(row.Notes, 'Budget confirmed on the call.');
  assert.equal(row.NextFollowUp, '2026-02-10');
});

test('EDITPERM-3: identity edits from a rep are dropped, not partially applied', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);

  // A mixed payload must not sneak an identity change through alongside a
  // legitimate one.
  const res = authPost(be, token, 'updateLead', {
    id: ID.leadAlphaNew,
    Notes: 'legitimate note',
    Name: 'Sneaky Rename',
  });
  assert.equal(res.status, 'success');

  const row = be.rows('Leads').find((l) => l.ID === ID.leadAlphaNew);
  assert.equal(row.Notes, 'legitimate note', 'the allowed field saved');
  assert.equal(row.Name, 'Northwind Traders', 'the restricted field did not');
});

test('EDITPERM-4: a SETTER is equally restricted', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.setterAlpha);   // setter on leadAlphaNew

  const res = authPost(be, token, 'updateLead', {
    id: ID.leadAlphaNew, Name: 'Setter Rename',
  });
  assert.equal(res.status, 'error');

  const row = be.rows('Leads').find((l) => l.ID === ID.leadAlphaNew);
  assert.equal(row.Name, 'Northwind Traders');
});

test('EDITPERM-5: managers can edit identity fields', () => {
  const be = buildScenario();

  for (const [userId, label] of [[ID.adminAlpha, 'ADMIN'], [ID.superAdmin, 'SUPER_ADMIN']]) {
    const token = loginAs(be, userId);
    const res = authPost(be, token, 'updateLead', {
      id: ID.leadAlphaNew,
      Name: `Renamed by ${label}`,
      Email: `${String(label).toLowerCase()}@northwind.test`,
    });
    assert.equal(res.status, 'success', `${label} may edit identity`);

    const row = be.rows('Leads').find((l) => l.ID === ID.leadAlphaNew);
    assert.equal(row.Name, `Renamed by ${label}`);
  }
});

test('EDITPERM-6: an ADMIN cannot edit a lead outside their team', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.adminAlpha);

  // Being a manager widens WHICH FIELDS you may write, not WHICH RECORDS.
  const res = authPost(be, token, 'updateLead', {
    id: ID.leadBetaNew, Name: 'Cross-team rename',
  });
  assert.equal(res.status, 'error');

  const row = be.rows('Leads').find((l) => l.ID === ID.leadBetaNew);
  assert.equal(row.Name, 'Tailspin Toys');
});

test('EDITPERM-7: a rep can still CREATE a lead with its contact details', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.repAlpha1);

  // The identity restriction applies to CHANGING an existing lead, not to
  // adding one. An earlier version applied it to both, which silently
  // stripped the name off every lead a rep tried to create — the single most
  // common action in the CRM.
  const res = authPost(be, token, 'createLead', {
    Name: 'Brand New Prospect Ltd',
    Email: 'hello@newprospect.test',
    Phone: '+15550123',
    Linkedin: 'https://linkedin.com/company/newprospect',
    Status: 'New',
  });
  assert.equal(res.status, 'success', 'a rep may add a lead');

  const row = be.rows('Leads').find((l) => l.ID === res.data.ID);
  assert.equal(row.Name, 'Brand New Prospect Ltd', 'the name was kept');
  assert.equal(row.Email, 'hello@newprospect.test', 'and the contact details');
  assert.equal(row.OwnerRepId, ID.repAlpha1, 'and it belongs to them');

  // But they still cannot rename it afterwards.
  const rename = authPost(be, token, 'updateLead', {
    id: res.data.ID, Name: 'Renamed After The Fact',
  });
  assert.equal(rename.status, 'error');
  assert.equal(
    be.rows('Leads').find((l) => l.ID === res.data.ID).Name,
    'Brand New Prospect Ltd'
  );
});

/* ================================================================== *
 * ADMIN_SCOPE — single-team organisations
 * ================================================================== */

test('TEAM-1: an ADMIN is limited to their own team', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.adminAlpha);

  const leads = authGet(be, token, 'getLeads').data.map((l) => l.ID);
  assert.ok(leads.includes(ID.leadAlphaNew), 'own team visible');
  assert.ok(!leads.includes(ID.leadBetaNew), 'other team hidden');
});

test('TEAM-2: team names are matched case-insensitively', () => {
  const be = buildScenario();

  // Real data contains "Sales Team" and "Sales team" for one team. An exact
  // match would split them and quietly shrink a manager's view.
  be.call('updateRecordRaw', 'Users', ID.adminAlpha, { Team: 'Sales Team' });
  be.call('updateRecordRaw', 'Users', ID.repAlpha1, { Team: 'sales team' });
  be.call('updateRecordRaw', 'Users', ID.repAlpha2, { Team: '  Sales team  ' });

  const token = loginAs(be, ID.adminAlpha);
  const leads = authGet(be, token, 'getLeads').data.map((l) => l.ID);

  assert.ok(leads.includes(ID.leadAlphaNew), 'lowercase spelling still matches');
  assert.ok(leads.includes(ID.leadAlphaConverted), 'padded spelling still matches');
});

test('TEAM-3: a blank team never matches another blank team', () => {
  const be = buildScenario();

  // Two users with no team set are not "on the same team" — treating blank as
  // a team would give every manager sight of every unassigned user's records.
  be.call('updateRecordRaw', 'Users', ID.adminAlpha, { Team: '' });
  be.call('updateRecordRaw', 'Users', ID.repBeta1, { Team: '' });

  const token = loginAs(be, ID.adminAlpha);
  const leads = authGet(be, token, 'getLeads').data.map((l) => l.ID);

  assert.ok(!leads.includes(ID.leadBetaNew), 'blank does not match blank');
});

test('TEAM-4: the overview surfaces the gaps that make scoping fail silently', () => {
  const be = buildScenario();

  // Recreate the real-world shape: a manager on a team of their own, and
  // people who own leads but have no team at all.
  be.call('updateRecordRaw', 'Users', ID.adminAlpha, { Team: 'Sales Lead / CRO' });
  be.call('updateRecordRaw', 'Users', ID.repAlpha1, { Team: '' });
  be.call('updateRecordRaw', 'Users', ID.repAlpha2, { Team: '' });

  const token = loginAs(be, ID.superAdmin);
  const res = authPost(be, token, 'getTeamOverview', {});
  assert.equal(res.status, 'success');

  const joined = res.data.warnings.join(' | ');
  assert.match(joined, /have no team/, 'unassigned users are called out');
  assert.match(joined, /sales_rep_1/, 'and named, so they can be fixed');

  // A team with nobody to manage it is flagged rather than silently empty.
  assert.ok(
    res.data.warnings.some((w) => /no manager/.test(w)),
    'a team with no manager is reported'
  );
});

test('TEAM-5: a SUPER_ADMIN can fix the structure from the API', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.superAdmin);

  be.call('updateRecordRaw', 'Users', ID.repBeta1, { Team: '' });
  assert.equal(
    authPost(be, token, 'setUserTeam', { userId: ID.repBeta1, team: 'Alpha' }).status,
    'success'
  );

  const row = be.rows('Users').find((u) => u.ID === ID.repBeta1);
  assert.equal(row.Team, 'Alpha');

  // The change is audited, with both sides recorded.
  const entry = be.rows('Logs').find((l) => l.Action === 'TEAM_CHANGED');
  assert.ok(entry, 'the move is audited');
  const meta = JSON.parse(entry.Metadata);
  assert.equal(meta.after, 'Alpha');

  // And it takes effect: the Alpha admin can now see that rep's lead.
  const admin = loginAs(be, ID.adminAlpha);
  assert.ok(
    authGet(be, admin, 'getLeads').data.some((l) => l.ID === ID.leadBetaNew),
    'the reassigned rep\'s lead is now visible to their new manager'
  );
});

test('TEAM-6: reps and setters cannot see or change team structure', () => {
  const be = buildScenario();
  for (const userId of [ID.repAlpha1, ID.setterAlpha]) {
    const token = loginAs(be, userId);
    assert.equal(authPost(be, token, 'getTeamOverview', {}).code, 'FORBIDDEN');
    assert.equal(
      authPost(be, token, 'setUserTeam', { userId: ID.repAlpha2, team: 'Anything' }).code,
      'FORBIDDEN'
    );
  }
});

test('TEAM-7: an ADMIN cannot reassign a SUPER_ADMIN', () => {
  const be = buildScenario();
  const token = loginAs(be, ID.adminAlpha);

  const res = authPost(be, token, 'setUserTeam', { userId: ID.superAdmin, team: 'Alpha' });
  assert.equal(res.code, 'FORBIDDEN');

  const row = be.rows('Users').find((u) => u.ID === ID.superAdmin);
  assert.equal(row.Team, 'Management', 'unchanged');
});
