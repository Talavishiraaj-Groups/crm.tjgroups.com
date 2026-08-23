/**
 * Team configuration check.
 *
 *   node local/scripts/check-team-config.mjs [export.json]
 *
 * An ADMIN sees records belonging to THEIR TEAM. That only works if the Team
 * column is filled in consistently. This reports what each manager would
 * actually be able to see, so an empty CRM is discovered here rather than by
 * the manager on their first login.
 *
 * Read-only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadBackend } from '../harness/backend.mjs';
import { seedFixtures } from '../fixtures/dataset.mjs';

const dataFile = process.argv[2] || path.join('local', '.data', 'crm-export.json');

const be = loadBackend();
be.call('setupCRMDatabase');

if (fs.existsSync(dataFile)) {
  const raw = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  for (const [sheet, rows] of Object.entries(raw)) {
    if (!be.store.hasSheet(sheet)) continue;
    const s = be.store.getSheet(sheet);
    s.rows = [s.headers];
    for (const row of rows) be.store.insert(sheet, row);
  }
  console.log(`\nsource: ${dataFile}`);
} else {
  seedFixtures(be);
  console.log('\nsource: built-in fixtures (no export found)');
}

const users = be.rows('Users').filter((u) => String(u.ID || ''));
const leads = be.rows('Leads').filter((l) => String(l.ID || ''));

const norm = (t) => String(t || '').trim().toLowerCase();

console.log('\n=== TEAM CONFIGURATION ===\n');

const blank = users.filter((u) => norm(u.Team) === '');
const byTeam = new Map();
for (const u of users) {
  const key = norm(u.Team) || '(blank)';
  if (!byTeam.has(key)) byTeam.set(key, []);
  byTeam.get(key).push(u);
}

console.log('Teams found:');
for (const [team, members] of [...byTeam].sort()) {
  const spellings = [...new Set(members.map((m) => String(m.Team || '').trim()))].filter(Boolean);
  const note = spellings.length > 1 ? `   spelled: ${spellings.map((s) => `"${s}"`).join(', ')}` : '';
  console.log(`  ${team.padEnd(22)} ${String(members.length).padStart(2)} user(s)${note}`);
}

const problems = [];

if (blank.length) {
  problems.push(
    `${blank.length} user(s) have no Team: ${blank.map((u) => u.Username).join(', ')}. ` +
    'Leads they own are invisible to every ADMIN.'
  );
}

// What would each manager actually see?
console.log('\nWhat each manager would see:\n');
const teamOf = new Map(users.map((u) => [String(u.ID), norm(u.Team)]));

for (const m of users.filter((u) => u.Role === 'ADMIN' && u.Status === 'Active')) {
  const myTeam = norm(m.Team);
  const visible = leads.filter((l) =>
    ['OwnerRepId', 'SetterId', 'CloserId'].some((f) => {
      const uid = String(l[f] || '');
      if (!uid) return false;
      return uid === String(m.ID) || (myTeam && teamOf.get(uid) === myTeam);
    })
  );

  const pct = leads.length ? Math.round((visible.length / leads.length) * 100) : 0;
  console.log(`  ${m.Username.padEnd(24)} team "${m.Team}"  ->  ${visible.length}/${leads.length} leads (${pct}%)`);

  if (visible.length === 0) {
    problems.push(
      `ADMIN "${m.Username}" (team "${m.Team}") would see ZERO leads. ` +
      'No lead is owned by anyone on that team.'
    );
  }
}

const superAdmins = users.filter((u) => u.Role === 'SUPER_ADMIN' && u.Status === 'Active');
for (const s of superAdmins) {
  console.log(`  ${s.Username.padEnd(24)} SUPER_ADMIN            ->  ${leads.length}/${leads.length} leads (100%)`);
}

console.log('');
if (problems.length) {
  console.log('=== PROBLEMS ===\n');
  for (const p of problems) console.log(`  - ${p}`);
  console.log('\nFix by setting the Team column on the Users sheet so that managers');
  console.log('and the people they manage share the same team name. Team matching is');
  console.log('case-insensitive, so "Sales Team" and "Sales team" are treated as one.\n');
  process.exit(1);
}

console.log('RESULT: every active manager can see records.\n');
process.exit(0);
