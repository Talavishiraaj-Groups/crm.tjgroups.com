/**
 * Full local pre-production gate.
 *
 * Runs every check that can be executed without touching production Google
 * Apps Script, production Sheets or a live Zoho mailbox, and prints a single
 * readiness verdict.
 *
 * Run: npm run verify:local
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const node = process.execPath;

// Invoke the tools' JS entry points directly with node. Spawning the
// `.cmd` shims on Windows without a shell is unreliable, and enabling the
// shell would make argument quoting platform-dependent.
const bin = (...p) => path.join(ROOT, 'node_modules', ...p);

const STEPS = [
  { name: 'Typecheck',            cmd: node, args: [bin('typescript', 'bin', 'tsc'), '-b', '--force'], blocking: true },
  {
    name: 'Production build',
    cmd: node,
    args: [bin('vite', 'bin', 'vite.js'), 'build'],
    blocking: true,
    // Build the way the hosting platform does: a real API URL supplied by the
    // environment. Without this the build correctly REFUSES, because the local
    // .env.local points at localhost and baking that into a bundle would ship
    // a site that tries to reach the visitor's own machine.
    env: { VITE_API_URL: 'https://script.google.com/macros/s/VERIFY_LOCAL_PLACEHOLDER/exec' },
  },
  { name: 'Production safety',    cmd: node, args: ['local/scripts/production-safety-scan.mjs'], blocking: true },
  // These files are deployed by being pasted into an editor. A raw control
  // byte passes every test here and corrupts that paste.
  { name: 'Pasteable .gs',        cmd: node, args: ['local/scripts/strip-control-bytes.mjs'], blocking: true },
  { name: 'Harness smoke',        cmd: node, args: ['local/scripts/smoke.mjs'], blocking: true },
  // Catches the "Unknown action" class statically: an action renamed or added
  // on one side only fails here instead of in the user's browser.
  { name: 'Action contract',      cmd: node, args: ['--test', 'local/tests/action-contract.test.mjs'], blocking: true },
  // Boots the real server and issues exactly what each page issues.
  { name: 'Page smoke (HTTP)',    cmd: node, args: ['local/scripts/smoke-pages.mjs'], blocking: true },
  { name: 'Security & RBAC',      cmd: node, args: ['--test', 'local/tests/security-rbac.test.mjs'], blocking: true },
  { name: 'API contract',         cmd: node, args: ['--test', 'local/tests/api-contract.test.mjs'], blocking: true },
  { name: 'Migration safety',     cmd: node, args: ['--test', 'local/tests/migration.test.mjs'], blocking: true },
  { name: 'Feature batch',        cmd: node, args: ['--test', 'local/tests/features.test.mjs'], blocking: true },
  { name: 'Lead deletion',        cmd: node, args: ['--test', 'local/tests/lead-deletion.test.mjs'], blocking: true },
  { name: 'Live prod shape',      cmd: node, args: ['--test', 'local/tests/legacy-production-shape.test.mjs'], blocking: true },
  // The rollout deploys the backend days before the frontend. This proves the
  // deployed site keeps working against the new backend during that window.
  { name: 'Backward compat',      cmd: node, args: ['--test', 'local/tests/backward-compatibility.test.mjs'], blocking: true },
  { name: 'Production isolation', cmd: node, args: ['--test', 'local/tests/production-isolation.test.mjs'], blocking: true },
  { name: 'Data preservation',    cmd: node, args: ['local/scripts/data-preservation-report.mjs'], blocking: true },
  { name: 'Runbook consistency',  cmd: node, args: ['local/scripts/doc-consistency-check.mjs'], blocking: true },
  { name: 'Baseline evidence',    cmd: node, args: ['--test', 'local/tests/baseline-vulnerabilities.test.mjs'], blocking: false },
  // New work must be lint-clean. The repository's pre-existing backlog in
  // untouched files is reported but never blocks — see lint-report.mjs.
  { name: 'Lint (new work)',      cmd: node, args: ['local/scripts/lint-report.mjs'], blocking: true },
];

console.log('\n============================================');
console.log('  TJGROUPS CRM — LOCAL VALIDATION');
console.log('============================================\n');
console.log('Environment: LOCAL');
console.log('Backend:     backend_apps_script/*.gs executed in-process');
console.log('Database:    in-memory Google Sheets emulator');
console.log('Zoho:        deterministic mock');
console.log('Production:  NOT CONTACTED\n');

const results = [];
let blockingFailures = 0;

for (const step of STEPS) {
  process.stdout.write(`-> ${step.name.padEnd(22)}`);
  const started = Date.now();
  const res = spawnSync(step.cmd, step.args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
    env: { ...process.env, ...(step.env || {}) },
  });
  const ms = Date.now() - started;

  const output = `${res.stdout || ''}${res.stderr || ''}`;
  const ok = res.status === 0;

  // Pull the node:test summary line when present.
  const passMatch = output.match(/^# pass (\d+)$/m);
  const failMatch = output.match(/^# fail (\d+)$/m);
  const detail = passMatch ? `${passMatch[1]} passed${failMatch && failMatch[1] !== '0' ? `, ${failMatch[1]} FAILED` : ''}` : '';

  if (ok) {
    console.log(`PASS  ${detail} (${ms}ms)`);
  } else {
    console.log(`${step.blocking ? 'FAIL' : 'WARN'}  ${detail} (${ms}ms)`);
    if (step.blocking) blockingFailures++;
  }

  results.push({ name: step.name, ok, blocking: step.blocking, detail, output, ms });
}

// Show detail for anything that failed.
for (const r of results.filter((r) => !r.ok)) {
  console.log(`\n--- ${r.name} output ---`);
  const lines = r.output.split('\n');
  const interesting = lines.filter((l) => /^not ok|error|Error|FAIL|✖/.test(l)).slice(0, 25);
  console.log((interesting.length ? interesting : lines.slice(-25)).join('\n'));
}

console.log('\n============================================');
console.log('  VERDICT');
console.log('============================================\n');

for (const r of results) {
  const status = r.ok ? 'PASS' : r.blocking ? 'FAIL' : 'WARN';
  console.log(`  ${status.padEnd(5)} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
}

console.log('\nNOT LOCALLY VERIFIABLE (requires an isolated staging deployment):');
console.log('  - real Apps Script execution quotas, timeouts and LockService contention');
console.log('  - real Google Sheets concurrency and Drive permissions');
console.log('  - live Zoho OAuth consent, token lifetime and rate limits');
console.log('  - Vercel routing, custom domain and env-var wiring');
console.log('  - browser end-to-end behaviour against the deployed web app\n');

if (blockingFailures > 0) {
  console.log(`RESULT: NOT READY — ${blockingFailures} blocking check(s) failed.\n`);
  process.exit(1);
}

console.log('RESULT: READY FOR STAGING\n');
console.log('Local validation cannot certify production readiness on its own.');
console.log('Follow docs/DEPLOYMENT.md and verify against an isolated Apps Script');
console.log('project + copied Sheets before touching live data.\n');
process.exit(0);
