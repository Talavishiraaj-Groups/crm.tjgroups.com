/**
 * Lint problems grouped by file, newest-work first.
 *
 * The repository carries a backlog of pre-existing lint errors in files this
 * work never touched, which is why the gate treats Lint as non-blocking. That
 * backlog must not become cover for new problems, so this separates the two:
 * anything in a file listed in TOUCHED is work from this effort and should be
 * clean.
 *
 *   node local/scripts/lint-report.mjs          # only touched files
 *   node local/scripts/lint-report.mjs --all    # the whole backlog too
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOW_ALL = process.argv.includes('--all');

/** Files created or modified by the security/architecture overhaul. */
const TOUCHED = [
  'api/services.ts',
  'api/health.ts',
  'types/index.ts',
  'pages/LeadDetail.tsx',
  'pages/Dashboard.tsx',
  'pages/InsightsPage.tsx',
  'pages/DeletedLeadsPage.tsx',
  'components/zoho/EmailComposer.tsx',
  'components/zoho/RichTextEditor.tsx',
  'components/zoho/ZohoEmailViewer.tsx',
  'components/leads/InteractionComposer.tsx',
  'components/leads/ResearchPanel.tsx',
  'components/leads/FollowUpPanel.tsx',
  'components/leads/EditLeadModal.tsx',
  'components/leads/DeleteLeadModal.tsx',
  'components/insights/EmailAnalyticsPanel.tsx',
  'components/dashboard/GlobalActivityFeed.tsx',
  'components/admin/TeamManagementPanel.tsx',
];

const res = spawnSync(
  process.execPath,
  [path.join('node_modules', 'eslint', 'bin', 'eslint.js'), 'src', '-f', 'json'],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
);

let raw = res.stdout || '';
if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);

let report;
try {
  report = JSON.parse(raw);
} catch {
  console.error('eslint did not return JSON:\n', (res.stderr || raw).slice(0, 2000));
  process.exit(2);
}

const norm = (p) => String(p).replace(/\\/g, '/');
const isTouched = (file) => TOUCHED.some((t) => norm(file).endsWith(t));

let touchedCount = 0;
let backlogCount = 0;
const touchedLines = [];
const backlogLines = [];

for (const file of report) {
  if (!file.messages.length) continue;
  const rel = norm(file.filePath).split('/src/')[1] || norm(file.filePath);
  const target = isTouched(file.filePath) ? touchedLines : backlogLines;

  target.push(`  ${rel}`);
  for (const m of file.messages) {
    if (isTouched(file.filePath)) touchedCount++;
    else backlogCount++;
    const rule = m.ruleId || 'react-compiler';
    const text = String(m.message || '').split('\n')[0].slice(0, 90);
    target.push(`      ${String(m.line) + ':' + m.column}  ${rule}  ${text}`);
  }
}

console.log('');
console.log('='.repeat(70));
console.log('  LINT — new work');
console.log('='.repeat(70));
if (touchedLines.length) {
  console.log(touchedLines.join('\n'));
} else {
  console.log('  clean');
}

console.log('');
console.log(`  new work:        ${touchedCount} problem(s)`);
console.log(`  pre-existing:    ${backlogCount} problem(s) in untouched files`);
console.log('');

if (SHOW_ALL && backlogLines.length) {
  console.log('='.repeat(70));
  console.log('  LINT — pre-existing backlog (not from this work)');
  console.log('='.repeat(70));
  console.log(backlogLines.join('\n'));
  console.log('');
}

// Only new work is a failure. The backlog is reported, never enforced.
process.exit(touchedCount > 0 ? 1 : 0);
