/**
 * Local CRM backend.
 *
 * Serves the REAL backend_apps_script/*.gs files over HTTP so the React app
 * can run end-to-end on your machine, with no Google account, no Apps Script
 * deployment, and no possibility of touching production.
 *
 *   npm run dev:api                       # seeded with built-in fixtures
 *   npm run dev:api -- --data ./my.json   # seeded with a copy of YOUR data
 *   npm run dev:api -- --enforcement off  # emulate the rollout compat mode
 *
 * Then in another terminal:
 *
 *   npm run dev
 *
 * State lives in memory: restarting the server resets the database. That is
 * deliberate — it keeps local runs reproducible.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { loadBackend } from '../harness/backend.mjs';
import { seedFixtures, FIXTURES } from '../fixtures/dataset.mjs';

/* ---------------- args ---------------- */

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const PORT = Number(argOf('port', 8787));
const ENFORCEMENT = argOf('enforcement', 'on');
const DATA_FILE = argOf('data', null);
const ITERATIONS = argOf('iterations', '200'); // keep local logins fast

/* ---------------- boot the backend ---------------- */

let be;
let seededFrom;
let accounts = [];

/** Every local account shares this, so you can actually sign in. */
const LOCAL_PASSWORD = 'LocalDev12345';

/**
 * Boot a fresh backend from the .gs files on disk.
 *
 * Called once at startup and again whenever a .gs file changes. Node loads
 * those files exactly once, so without this a backend edit silently did
 * nothing until the server was restarted by hand — which showed up in the
 * browser as "Unknown action", pointing at the frontend for a backend that
 * had simply not been reloaded.
 */
function boot() {
be = loadBackend({
  scriptProperties: {
    ZOHO_CLIENT_ID: 'LOCAL_TEST_CLIENT_ID',
    ZOHO_CLIENT_SECRET: 'LOCAL_TEST_CLIENT_SECRET',
    PASSWORD_ITERATIONS: ITERATIONS,
    ENVIRONMENT: 'test',
  },
  zoho: { clientId: 'LOCAL_TEST_CLIENT_ID', clientSecret: 'LOCAL_TEST_CLIENT_SECRET' },
});

be.call('setupCRMDatabase');

if (DATA_FILE) {
  const abs = path.resolve(process.cwd(), DATA_FILE);

  if (!fs.existsSync(abs)) {
    console.error('');
    console.error('==================================================');
    console.error('  DATA FILE NOT FOUND');
    console.error('==================================================');
    console.error('');
    console.error(`  looked for: ${abs}`);
    console.error('');
    console.error('  If you have the Google Drive download (one .xlsx per');
    console.error('  sheet), convert it first:');
    console.error('');
    console.error('    node local/scripts/convert-drive-export.mjs "<unzipped-folder>"');
    console.error('');
    console.error('  That writes local/.data/crm-export.json, then:');
    console.error('');
    console.error('    npm run dev:api -- --data local/.data/crm-export.json');
    console.error('');
    console.error('  Or omit --data entirely to run on the built-in fixtures:');
    console.error('');
    console.error('    npm run dev:api');
    console.error('');
    process.exit(1);
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (err) {
    console.error(`\n  ${abs} is not valid JSON: ${err.message}\n`);
    process.exit(1);
  }
  for (const [sheet, rows] of Object.entries(raw)) {
    if (!be.store.hasSheet(sheet)) continue;
    const s = be.store.getSheet(sheet);
    s.rows = [s.headers];
    for (const row of rows) be.store.insert(sheet, row);
  }
  seededFrom = `your export (${DATA_FILE})`;
} else {
  seedFixtures(be);
  seededFrom = 'built-in fixtures';
}

/* ---------------- passwords ---------------- */

// Every active account gets a known local password so you can actually log in.
accounts = [];
for (const u of be.rows('Users')) {
  if (String(u.Status) !== 'Active') continue;
  try {
    be.call('setUserPassword', u.ID, LOCAL_PASSWORD, { mustChange: false });
    accounts.push({ username: u.Username, role: u.Role, team: u.Team });
  } catch {
    /* skip anything malformed in an export */
  }
}

be.call('setAuthEnforcement', ENFORCEMENT);

/* ---------------- a couple of Zoho mailboxes ---------------- */

// EVERY active account gets a mailbox, not just the first couple. Which two
// users happened to come first is not something anyone testing can predict, so
// signing in as anyone else showed "Zoho Mail Not Linked" and no email
// features at all — a local-setup gap that looked like a broken feature.
const leadsWithEmail = be.rows('Leads')
  .filter((l) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(l.Email || '')))
  .slice(0, 3);

for (const u of be.rows('Users').filter((x) => String(x.Status) === 'Active')) {
  const acct = be.zoho.addAccount({ email: `${u.Username}@local.test` });

  be.zoho.addMessage(acct.accountId, {
    subject: 'Welcome to the local CRM',
    content: '<p>This message is served by the local Zoho mock.</p>',
    sender: 'buyer@northwind.test',
    toAddress: acct.email,
  });

  // A thread against real seeded leads, so the Zoho tab, the stored-email
  // archive and the reply-rate figures all have something to show.
  for (const lead of leadsWithEmail) {
    be.zoho.addMessage(acct.accountId, {
      subject: `Re: introduction — ${lead.Name}`,
      content: '<p>Thanks for reaching out. Can you send pricing?</p>',
      summary: 'Thanks for reaching out. Can you send pricing?',
      sender: String(lead.Email),
      toAddress: acct.email,
    });
    be.zoho.addMessage(acct.accountId, {
      subject: `Introduction — ${lead.Name}`,
      content: '<p>Hello, following up on our conversation.</p>',
      summary: 'Hello, following up on our conversation.',
      sender: acct.email,
      toAddress: String(lead.Email),
    });
  }

  be.call('updateRecordRaw', 'Users', u.ID, {
    ZohoEmail: acct.email,
    ZohoRefreshToken: acct.refreshToken,
  });
}
}

boot();

/* ---------------- reload when the backend changes ---------------- */

const GS_DIR = path.resolve(process.cwd(), 'backend_apps_script');
let reloadTimer = null;

if (fs.existsSync(GS_DIR)) {
  fs.watch(GS_DIR, (_event, filename) => {
    if (!filename || !String(filename).endsWith('.gs')) return;
    // Editors write a file in several bursts; wait for it to settle.
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      try {
        boot();
        console.log('');
        console.log(`  >> reloaded backend (${filename}) - database reseeded`);
        console.log('');
      } catch (err) {
        // A syntax error must not kill the server: fix the file and save
        // again, and the next write reloads.
        console.error('');
        console.error(`  !! backend reload FAILED: ${err && err.message}`);
        console.error('     The previous version is still serving requests.');
        console.error('');
      }
    }, 250);
  });
}

/* ---------------- http ---------------- */

// Apps Script cannot send these headers, but a local server can — and must,
// because the Vite dev server runs on a different port.
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

const server = http.createServer((req, res) => {
  cors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  const send = (envelope) => {
    const body = envelope._raw ?? JSON.stringify(envelope);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
  };

  const log = (action, envelope) => {
    const status = envelope.status === 'success' ? 'ok  ' : `ERR ${envelope.code || ''}`;
    console.log(`  ${req.method.padEnd(4)} ${String(action).padEnd(22)} ${status}`);
  };

  if (req.method === 'GET') {
    const params = Object.fromEntries(url.searchParams);
    let out;
    try {
      out = be.get(params);
    } catch (err) {
      out = { status: 'error', code: 'INTERNAL', message: String(err && err.message) };
    }
    log(params.action, out);
    send(out);
    return;
  }

  if (req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let out;
      let action = '?';
      try {
        try {
          action = JSON.parse(raw).action;
        } catch { /* keep '?' */ }
        out = be.postRaw(raw);
      } catch (err) {
        out = { status: 'error', code: 'INTERNAL', message: String(err && err.message) };
      }
      log(action, out);
      send(out);
    });
    return;
  }

  res.writeHead(405).end();
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('');
    console.error('==================================================');
    console.error(`  PORT ${PORT} IS ALREADY IN USE`);
    console.error('==================================================');
    console.error('');
    console.error('  Another copy of this server is already running.');
    console.error('  If the CRM currently works in your browser, that older');
    console.error('  copy is what is serving it.');
    console.error('');
    console.error('  Either just use the one already running, or stop it:');
    console.error('');
    console.error('    Windows PowerShell:');
    console.error(`      Stop-Process -Id (Get-NetTCPConnection -LocalPort ${PORT} -State Listen).OwningProcess -Force`);
    console.error('');
    console.error('  Or start this one on a different port:');
    console.error(`      npm run dev:api -- --port ${PORT + 1}`);
    console.error(`      (then set VITE_API_URL=http://localhost:${PORT + 1} in .env.local)`);
    console.error('');
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  const counts = ['Users', 'Leads', 'Deals', 'Projects', 'Commissions', 'AdminRequests', 'Logs']
    .map((s) => `${s} ${be.rows(s).filter((r) => String(r.ID || '')).length}`)
    .join(' · ');

  console.log('');
  console.log('==================================================');
  console.log('  LOCAL CRM BACKEND');
  console.log('==================================================');
  console.log(`  URL              http://localhost:${PORT}`);
  console.log(`  Backend          backend_apps_script/*.gs (the real files)`);
  console.log(`  Database         in-memory · seeded from ${seededFrom}`);
  console.log(`  Zoho             deterministic mock`);
  console.log(`  AUTH_ENFORCEMENT ${ENFORCEMENT}`);
  console.log(`  Production       NOT CONTACTED`);
  console.log('');
  console.log(`  Records          ${counts}`);
  console.log('');
  console.log('  Point the frontend at this server:');
  console.log(`     echo "VITE_API_URL=http://localhost:${PORT}" > .env.local`);
  console.log('     npm run dev');
  console.log('');
  console.log(`  Every account below uses the password:  ${LOCAL_PASSWORD}`);
  console.log('');
  for (const a of accounts) {
    console.log(`     ${a.username.padEnd(18)} ${String(a.role).padEnd(12)} ${a.team || ''}`);
  }
  console.log('');
  console.log('  Requests:');
});
