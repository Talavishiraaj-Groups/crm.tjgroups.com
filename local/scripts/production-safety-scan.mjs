/**
 * Pre-deployment safety scan.
 *
 * Fails the build if anything that must never ship is present: hardcoded
 * credentials, a mock-authentication fallback, or a destructive script that
 * can run without a guard.
 *
 * Run: npm run check:production-safety
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SCAN_DIRS = ['src', 'backend_apps_script', 'local', 'docs'];
const SCAN_FILES = ['package.json', 'vite.config.ts', 'vercel.json', 'seed.mjs', 'seedUsers.mjs', 'README.md'];

/** Files allowed to contain obvious test credentials. */
const TEST_ALLOWLIST = [/^local[\\/]/];

/** The scanner necessarily contains the patterns it looks for. */
const SELF = path.join('local', 'scripts', 'production-safety-scan.mjs');

const RULES = [
  {
    id: 'zoho-client-secret',
    severity: 'critical',
    // A real Zoho secret is a long lowercase hex run assigned to a secret-ish name.
    re: /(client_?secret|CLIENT_SECRET)\s*[:=]\s*["'][0-9a-f]{24,}["']/i,
    message: 'A hardcoded OAuth client secret is present. Move it to Script Properties.',
  },
  {
    id: 'zoho-client-id',
    severity: 'critical',
    re: /["']1000\.[A-Z0-9]{20,}["']/,
    message: 'A hardcoded Zoho client id is present. Move it to Script Properties.',
  },
  {
    id: 'mock-auth-fallback',
    severity: 'critical',
    re: /MOCK_USERS/,
    message: 'A mock-user fallback is reachable. This grants sessions when the backend fails.',
  },
  {
    id: 'destructive-reset-reintroduced',
    severity: 'critical',
    // resetdatabase.gs was deleted outright: a bulk-clear function has no
    // legitimate place in a production deployment, and guarding one is weaker
    // than not shipping it.
    re: /function\s+resetDatabase\s*\(/,
    message:
      'A bulk database reset function has been reintroduced. It was removed ' +
      'deliberately — clearing sheets is not a supported operation.',
  },
  {
    id: 'client-password-compare',
    severity: 'critical',
    re: /user\.password\s*!==\s*password/,
    message: 'Password comparison is happening in the browser.',
  },
  {
    id: 'refresh-token-to-client',
    severity: 'high',
    re: /zohoRefreshToken:\s*(row|r|data)\./,
    message: 'A Zoho refresh token is being mapped into a client-side model.',
  },
  {
    id: 'seed-writes-to-configured-api',
    severity: 'critical',
    // A script that POSTs create* actions at whatever VITE_API_URL points to
    // will inject dummy records straight into production.
    re: /action:\s*['"]create(User|Lead|Deal|Project)['"]/,
    message:
      'A script writes dummy records to whatever VITE_API_URL points at — ' +
      'that is production. Seed local data with `npm run dev:api` instead.',
  },
  {
    id: 'google-script-url',
    severity: 'medium',
    re: /https:\/\/script\.google\.com\/macros\/s\/(?!YOUR_DEPLOYMENT_ID|LOCAL_TEST)[A-Za-z0-9_-]{30,}/,
    message: 'A concrete Apps Script deployment URL is committed. Keep it in env config.',
  },
  {
    id: 'drive-folder-id',
    severity: 'medium',
    re: /\b1[A-Za-z0-9_-]{32,}\b/,
    message: 'What looks like a real Google Drive/Sheet ID is committed.',
  },
];

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const targets = [];
for (const d of SCAN_DIRS) targets.push(...walk(path.join(ROOT, d)));
for (const f of SCAN_FILES) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p)) targets.push(p);
}

const findings = [];

for (const file of targets) {
  if (!/\.(ts|tsx|js|mjs|cjs|gs|json|md)$/.test(file)) continue;
  const rel = path.relative(ROOT, file);
  if (rel === SELF) continue;
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');

  for (const rule of RULES) {
    // local/ is never deployed — proven by local/tests/production-isolation.test.mjs
    // (ISOLATE-5/6). Scanning it for deployment backdoors produces false
    // positives on tests that assert those patterns are ABSENT elsewhere.
    if (TEST_ALLOWLIST.some((p) => p.test(rel))) continue;

    lines.forEach((line, i) => {
      // Skip lines that are clearly prose or a deliberate warning about the rule.
      if (/^\s*\*|^\s*\/\//.test(line) && !/mock-auth|MOCK_USERS/.test(line)) return;
      if (rule.re.test(line)) {
        findings.push({
          rule: rule.id, severity: rule.severity, file: rel,
          line: i + 1, message: rule.message,
          excerpt: line.trim().slice(0, 110),
        });
      }
    });
  }
}

const bySeverity = (s) => findings.filter((f) => f.severity === s);

console.log('\n=== PRODUCTION SAFETY SCAN ===\n');
console.log(`scanned ${targets.length} files\n`);

if (!findings.length) {
  console.log('PASS — no unsafe patterns found.\n');
  process.exit(0);
}

for (const sev of ['critical', 'high', 'medium']) {
  const list = bySeverity(sev);
  if (!list.length) continue;
  console.log(`${sev.toUpperCase()} (${list.length})`);
  for (const f of list) {
    console.log(`  ${f.file}:${f.line}  [${f.rule}]`);
    console.log(`    ${f.message}`);
    console.log(`    > ${f.excerpt}`);
  }
  console.log('');
}

const blocking = bySeverity('critical').length + bySeverity('high').length;
if (blocking > 0) {
  console.log(`FAIL — ${blocking} blocking finding(s).\n`);
  process.exit(1);
}
console.log('PASS with advisories.\n');
process.exit(0);
