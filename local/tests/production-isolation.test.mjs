/**
 * Proves that test data cannot reach production.
 *
 * The concern: fixtures, demo users and seed helpers existing anywhere that
 * gets deployed. What actually ships to Google Apps Script is
 * backend_apps_script/*.gs; what ships to Vercel is the Vite build of src/.
 * Nothing in local/ is deployed to either.
 *
 * Run: node --test local/tests/production-isolation.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listBackendFiles, BACKEND_DIR } from '../harness/backend.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git'].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

test('ISOLATE-1: the deployed backend contains no fixture or demo data', () => {
  const files = listBackendFiles(BACKEND_DIR);
  const src = files
    .map((f) => `/* ${f} */\n` + fs.readFileSync(path.join(BACKEND_DIR, f), 'utf8'))
    .join('\n');

  // Fixture identifiers that must never appear in shipped backend code.
  const forbidden = [
    'Northwind', 'Contoso', 'Fabrikam', 'Tailspin', 'Wingtip', 'Litware',
    'LocalDev12345', 'sales_rep_beta', 'setter_alpha', 'admin_alpha',
    '@local.test', '@tjgroups.test', 'seedFixtures', 'seedVolume',
    'LOCAL_TEST_CLIENT_ID',
  ];

  for (const needle of forbidden) {
    assert.ok(
      !src.includes(needle),
      `backend_apps_script contains fixture value "${needle}"`
    );
  }
});

test('ISOLATE-2: the deployed backend never fabricates business records', () => {
  const files = listBackendFiles(BACKEND_DIR);
  for (const f of files) {
    const src = fs.readFileSync(path.join(BACKEND_DIR, f), 'utf8');
    // No hardcoded email addresses (the Zoho redirect URI is a URL, not a mail).
    const emails = src.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || [];
    const realish = emails.filter((e) => !e.includes('example') && !e.includes('tjgroups.com'));
    assert.deepEqual(realish, [], `${f} contains hardcoded address(es): ${realish}`);
  }
});

test('ISOLATE-3: the frontend bundle sources contain no demo credentials', () => {
  const files = walk(path.join(ROOT, 'src'));
  for (const file of files) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);

    assert.ok(!src.includes('MOCK_USERS'), `${rel} references MOCK_USERS`);
    assert.ok(!src.includes('LocalDev12345'), `${rel} contains a local dev password`);
    assert.ok(
      !/mockData/.test(src),
      `${rel} imports mock data — it must not ship to production`
    );
  }
});

test('ISOLATE-4: no repository script writes records to a configured API URL', () => {
  // seed.mjs / seedUsers.mjs used to POST createUser/createLead at whatever
  // VITE_API_URL pointed to, which in production is the live CRM.
  const files = walk(ROOT).filter(
    (f) => /\.mjs$/.test(f) && !path.relative(ROOT, f).startsWith('local')
  );

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    const writesRecords = /action:\s*['"]create(User|Lead|Deal|Project)['"]/.test(src);
    const readsApiUrl = /VITE_API_URL/.test(src);
    assert.ok(
      !(writesRecords && readsApiUrl),
      `${rel} would write dummy records to the configured API (production)`
    );
  }
});

test('ISOLATE-5: fixtures live only under local/ and are not importable from src/', () => {
  const fixture = path.join(ROOT, 'local', 'fixtures', 'dataset.mjs');
  assert.ok(fs.existsSync(fixture), 'fixtures exist where expected');

  for (const file of walk(path.join(ROOT, 'src'))) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    assert.ok(
      !/from\s+['"].*local\//.test(src),
      `${path.relative(ROOT, file)} imports from local/ — test code must not ship`
    );
  }
});

test('ISOLATE-6: the local dev server never targets a remote host', () => {
  const src = fs.readFileSync(
    path.join(ROOT, 'local', 'scripts', 'dev-server.mjs'), 'utf8'
  );
  // It must bind a local port and mock Zoho, never call out to Google.
  assert.ok(!/script\.google\.com/.test(src), 'dev server must not reference Apps Script');
  assert.ok(/localhost/.test(src), 'dev server is local-only');
  assert.ok(/ENVIRONMENT:\s*'test'/.test(src), 'dev server runs with ENVIRONMENT=test');
});
