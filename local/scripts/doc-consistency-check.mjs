/**
 * Deployment-document consistency audit.
 *
 * The runbook is the thing a human follows at 11pm during a rollout. If it
 * disagrees with the code, the rollout goes wrong. This script cross-checks
 * docs/DEPLOYMENT.md against reality:
 *
 *   file count · file names · function names · Script Properties ·
 *   sheet names · schema columns · migration functions · test commands ·
 *   environment names · rollback commands · deployment sequence
 *
 * Run: npm run check:docs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBackend, listBackendFiles, BACKEND_DIR } from '../harness/backend.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOC = path.join(ROOT, 'docs', 'DEPLOYMENT.md');
const doc = fs.readFileSync(DOC, 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const be = loadBackend();
const problems = [];
const checks = [];

const ok = (label, detail = '') => checks.push({ ok: true, label, detail });
const bad = (label, detail) => {
  checks.push({ ok: false, label, detail });
  problems.push(`${label}: ${detail}`);
};

/* ---------------- 1. file count ---------------- */

const actualFiles = listBackendFiles(BACKEND_DIR);
const claimedCounts = [...doc.matchAll(/\b(?:paste|Paste)\s+the\s+(\w+)\s+files/g)].map((m) => m[1]);
const wordToNum = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const numeric = (w) => (wordToNum[w.toLowerCase()] ?? Number(w));

const headlineMatch = doc.match(/\*\*(\d+)\s+files:/);
if (!headlineMatch) {
  bad('file count headline', 'could not find the "**N files:" statement in §1');
} else if (Number(headlineMatch[1]) !== actualFiles.length) {
  bad('file count headline', `doc says ${headlineMatch[1]}, repository has ${actualFiles.length}`);
} else {
  ok('file count headline', `${actualFiles.length} files`);
}

for (const claim of claimedCounts) {
  const n = numeric(claim);
  if (n !== actualFiles.length) {
    bad('inline file count', `"paste the ${claim} files" contradicts the actual ${actualFiles.length}`);
  } else {
    ok('inline file count', `"${claim}" matches`);
  }
}

/* ---------------- 2. file names ---------------- */

for (const f of actualFiles) {
  if (doc.includes(f)) ok('file listed', f);
  else bad('file listed', `${f} exists but is not mentioned in the runbook`);
}

// Files the runbook legitimately names while NOT asking you to create them:
// the "deliberately NOT created" rationale list, and Google's default Code.gs
// which the operator is told to delete.
// NB: tolerate CRLF — this repository is edited on Windows.
const notCreatedBlock =
  (doc.match(/\*\*Files deliberately NOT created:\*\*[\s\S]*?(?:\r?\n){2}/) || [''])[0];
const allowedAbsent = new Set(
  [...notCreatedBlock.matchAll(/`([A-Za-z]+\.gs)`/g)].map((m) => m[1]).concat(['Code.gs'])
);

const mentioned = [...doc.matchAll(/`([A-Za-z]+\.gs)`/g)].map((m) => m[1]);
for (const f of new Set(mentioned)) {
  if (actualFiles.includes(f) || allowedAbsent.has(f)) continue;
  bad('phantom file', `runbook references \`${f}\`, which does not exist`);
}

/* ---------------- 3. function names ---------------- */

// Only a BARE `name()` is an operator instruction. A dotted reference such as
// `Utilities.getUuid()` or `java.util.UUID.randomUUID()` names an external API
// that the runbook merely cites in prose.
const referencedFns = [...doc.matchAll(/(^|[^.\w])([a-zA-Z][a-zA-Z0-9_]*)\(\)/g)]
  .map((m) => m[2])
  .filter((n) => !['e', 'g', 'i'].includes(n));

for (const fn of new Set(referencedFns)) {
  if (be.has(fn)) ok('function exists', `${fn}()`);
  else bad('function missing', `runbook tells the operator to run ${fn}(), which the backend does not define`);
}

// setPasswordFor / setAuthEnforcement take arguments, so they appear with args.
for (const fn of ['setPasswordFor', 'setAuthEnforcement', 'resetDatabase']) {
  if (doc.includes(fn) && !be.has(fn)) {
    bad('function missing', `${fn} referenced but not defined`);
  }
}

/* ---------------- 4. script properties ---------------- */

// Scan only the Script Properties table, so spreadsheet formulas quoted
// elsewhere (e.g. `SUM` in the backup-verification table) are not mistaken
// for configuration keys.
const propsSection = (doc.match(/## 2\. Script Properties[\s\S]*?(?:\r?\n)---/) || [''])[0];
const propsInDoc = [...propsSection.matchAll(/\| `([A-Z][A-Z0-9_]+)`/g)].map((m) => m[1]);
const backendSrc = actualFiles
  .map((f) => fs.readFileSync(path.join(BACKEND_DIR, f), 'utf8'))
  .join('\n');

for (const prop of new Set(propsInDoc)) {
  if (backendSrc.includes(`'${prop}'`) || backendSrc.includes(`"${prop}"`)) {
    ok('script property', prop);
  } else {
    bad('script property', `${prop} documented but never read by the backend`);
  }
}

const propsInCode = new Set(
  [...backendSrc.matchAll(/getProperty\(\s*'([A-Z][A-Z0-9_]+)'\s*\)/g)].map((m) => m[1])
);
for (const prop of propsInCode) {
  if (!doc.includes(prop)) {
    bad('undocumented property', `${prop} is read by the backend but absent from the runbook`);
  }
}

/* ---------------- 5. sheet names + schema columns ---------------- */

be.call('setupCRMDatabase');
const actualSheets = be.sheets();

for (const sheet of actualSheets) {
  if (doc.includes(sheet)) ok('sheet documented', sheet);
  else bad('sheet documented', `${sheet} exists but is not mentioned in the runbook`);
}

// Every column the doc tells you to append must really be in the schema.
const columnTableRows = [...doc.matchAll(/^\|\s*\*{0,2}`?(\w+)`?\*{0,2}\s*\|\s*(`[^|]+`)\s*\|$/gm)];
for (const [, sheetName, cols] of columnTableRows) {
  if (!actualSheets.includes(sheetName)) continue;
  const headers = be.store.getSheet(sheetName).headers;
  for (const col of [...cols.matchAll(/`([A-Za-z]+)`/g)].map((m) => m[1])) {
    if (headers.includes(col)) ok('column documented', `${sheetName}.${col}`);
    else bad('column mismatch', `runbook says append ${sheetName}.${col}, not present in DATABASE_SCHEMA`);
  }
}

// And every genuinely NEW column should be documented.
const LEGACY = {
  Users: ['ID','Username','Role','Team','Status','Availability','ZohoEmail','ZohoRefreshToken','CreatedAt','UpdatedAt'],
  Leads: ['ID','Name','Email','Phone','Status','OwnerRepId','SetterId','CloserId','Notes','Linkedin','NextFollowUp','CreatedAt','UpdatedAt'],
  Deals: ['ID','LeadId','Value','Status','OwnerRepId','SetterId','CloserId','CreatedAt','UpdatedAt'],
  Projects: ['ID','ClientName','Status','OwnerRepId','AccountManagerId','LiaisonId','StartDate','DueDate','CreatedAt','UpdatedAt'],
  AdminRequests: ['ID','Type','RelatedDealId','RequestedBy','Status','CreatedAt','UpdatedAt'],
  Commissions: ['ID','DealId','SetterId','SetterAmount','CloserId','CloserAmount','PayoutStatus','CreatedAt','UpdatedAt'],
  Logs: ['ID','EntityId','EntityType','Action','UserId','Details','Metadata','Timestamp'],
};
for (const [sheet, legacyCols] of Object.entries(LEGACY)) {
  const headers = be.store.getSheet(sheet)?.headers ?? [];
  for (const col of headers.filter((h) => h && !legacyCols.includes(h))) {
    if (doc.includes(`\`${col}\``)) ok('new column documented', `${sheet}.${col}`);
    else bad('undocumented column', `${sheet}.${col} is new but the runbook never tells you to add it`);
  }
}

/* ---------------- 6. npm commands ---------------- */

const cmds = [...doc.matchAll(/npm run ([a-z:-]+)/g)].map((m) => m[1]);
for (const c of new Set(cmds)) {
  if (pkg.scripts[c]) ok('npm script', `npm run ${c}`);
  else bad('npm script', `runbook uses "npm run ${c}", which package.json does not define`);
}

const nodeCmds = [...doc.matchAll(/node (local\/[\w/.-]+\.mjs)/g)].map((m) => m[1]);
for (const rel of new Set(nodeCmds)) {
  if (fs.existsSync(path.join(ROOT, rel))) ok('script path', rel);
  else bad('script path', `runbook references ${rel}, which does not exist`);
}

/* ---------------- 7. environment + enforcement values ---------------- */

for (const mode of ['off', 'warn', 'on']) {
  if (!doc.includes(`'${mode}'`) && !doc.includes(`\`${mode}\``)) {
    bad('enforcement mode', `AUTH_ENFORCEMENT value "${mode}" is not documented`);
  } else ok('enforcement mode', mode);
}

const envInCode = backendSrc.match(/ENVIRONMENT.*?'([a-z]+)'/);
if (envInCode && !doc.includes(envInCode[1])) {
  bad('environment name', `code compares ENVIRONMENT against "${envInCode[1]}", not documented`);
} else ok('environment name', 'consistent');

// resetdatabase.gs was removed from the product. If any bulk-clear function
// ever reappears in the backend, the runbook must not be the only thing
// standing between an operator and the data — fail loudly instead.
if (/function\s+resetDatabase\s*\(/.test(backendSrc)) {
  bad('destructive reset', 'a resetDatabase() function is back in the backend');
} else {
  ok('destructive reset', 'no bulk-clear function ships');
}

/* ---------------- 8. deployment sequence ---------------- */

// Anchor on the step headings themselves, so a word appearing earlier in
// prose cannot make an ordered step look misplaced.
const requiredOrder = [
  'Step 1 — Back up',
  'Step 2 — Deploy the backend, enforcement off',
  'Step 3 — Migrate the schema',
  'Step 4 — Issue passwords',
  'Step 6 — Deploy the frontend',
  'Step 7 — Enforce',
];
let cursor = -1;
for (const step of requiredOrder) {
  const idx = doc.indexOf(step);
  if (idx === -1) {
    bad('deployment sequence', `step "${step}" is missing`);
  } else if (idx < cursor) {
    bad('deployment sequence', `step "${step}" appears out of order`);
  } else {
    cursor = idx;
    ok('deployment sequence', step);
  }
}

if (!/Rollback/i.test(doc)) bad('rollback', 'no rollback section');
else ok('rollback', 'documented');

/* ---------------- report ---------------- */

console.log('\n=== DEPLOYMENT DOC CONSISTENCY AUDIT ===\n');
console.log(`checked ${checks.length} assertions against the live repository\n`);

if (!problems.length) {
  console.log(`PASS — docs/DEPLOYMENT.md matches the code (${actualFiles.length} backend files).\n`);
  process.exit(0);
}

console.log(`FAIL — ${problems.length} inconsistency/ies:\n`);
for (const p of problems) console.log(`  - ${p}`);
console.log('\nThe runbook is what a human follows during a rollout.');
console.log('It must not contradict the code.\n');
process.exit(1);
