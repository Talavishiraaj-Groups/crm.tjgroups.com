/**
 * End-to-end page smoke, over real HTTP.
 *
 * Boots the actual dev server (the real .gs files), signs in over the wire,
 * and issues exactly the requests each page issues — same actions, same
 * method, same shapes. Anything that would surface in the browser as
 * "Unknown action", an empty table, or a red banner fails here first.
 *
 *   node local/scripts/smoke-pages.mjs
 *
 * Runs against a throwaway in-memory database on a spare port. It never
 * contacts production.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.SMOKE_PORT || 8791);
const BASE = `http://localhost:${PORT}`;

let token = null;

async function call(action, method, payload = {}, params = {}) {
  if (method === 'POST') {
    const body = { action, payload };
    if (token) body.token = token;
    const res = await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
    });
    return res.json();
  }
  const url = new URL(BASE);
  url.searchParams.set('action', action);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  if (token) url.searchParams.set('token', token);
  const res = await fetch(url);
  return res.json();
}

const results = [];
const record = (page, label, envelope, extra = '') => {
  const ok = envelope && envelope.status === 'success';
  results.push({ page, label, ok, detail: ok ? extra : `${envelope?.code || '?'}: ${envelope?.message || 'no response'}` });
};

async function waitForServer(deadlineMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    try {
      const res = await fetch(`${BASE}/?action=__ping`);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/* ------------------------------------------------------------------ */

const server = spawn(
  process.execPath,
  [path.join('local', 'scripts', 'dev-server.mjs'), '--port', String(PORT), '--iterations', '50'],
  { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
);

let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

const shutdown = () => { try { server.kill(); } catch { /* already gone */ } };
process.on('exit', shutdown);

try {
  if (!await waitForServer()) {
    console.error('\nThe dev server did not start.\n');
    console.error(serverLog.slice(-2000));
    process.exit(1);
  }

  /* ---------------- sign in ---------------- */

  const login = await call('login', 'POST', {
    username: 'dhiraj_th', password: 'LocalDev12345',
  });
  if (login.status !== 'success') {
    // Fall back to whatever super admin the fixtures created.
    const m = serverLog.match(/^\s+(\S+)\s+SUPER_ADMIN/m);
    const retry = m ? await call('login', 'POST', { username: m[1], password: 'LocalDev12345' }) : login;
    if (retry.status !== 'success') {
      console.error('\nCould not sign in to the local server:', retry.message);
      console.error(serverLog.slice(-1500));
      process.exit(1);
    }
    token = retry.data.token;
  } else {
    token = login.data.token;
  }
  record('Login', 'login', { status: 'success' }, 'session established');

  /* ---------------- pick a lead to work with ---------------- */

  const leadsRes = await call('getLeads', 'GET');
  const leads = Array.isArray(leadsRes.data) ? leadsRes.data : [];
  const leadId = leads.length ? leads[0].ID : null;

  /* ---------------- Dashboard ---------------- */

  const dash = await call('batch', 'POST', {
    requests: [
      { key: 'leads', action: 'getLeads' },
      { key: 'deals', action: 'getDeals' },
      { key: 'projects', action: 'getProjects' },
      { key: 'requests', action: 'getAdminRequests' },
      { key: 'users', action: 'getUsers' },
      { key: 'dailyLogs', action: 'getLogs', payload: { logAction: 'DAILY_LOG' } },
    ],
  });
  record('Dashboard', 'batch (6 reads)', dash);
  if (dash.status === 'success') {
    for (const r of dash.data.results) {
      record('Dashboard', `  ${r.key}`, r,
        Array.isArray(r.data) ? `${r.data.length} rows` : 'ok');
    }
  }

  record('Dashboard', 'getActivityFeed', await call('getActivityFeed', 'POST', { timeZone: 'Asia/Calcutta' }));

  /* ---------------- Leads list ---------------- */

  record('Leads', 'getLeads', leadsRes, `${leads.length} leads`);
  record('Leads', 'getUsers', await call('getUsers', 'GET'));

  /* ---------------- Lead detail ---------------- */

  if (leadId) {
    const detail = await call('batch', 'POST', {
      requests: [
        { key: 'lead', action: 'getLeadById', payload: { id: leadId } },
        { key: 'logs', action: 'getLogs', payload: { id: leadId } },
        { key: 'requests', action: 'getAdminRequests' },
        { key: 'users', action: 'getUsers' },
        { key: 'stored', action: 'getStoredEmails', payload: { leadId } },
      ],
    });
    record('Lead detail', 'batch (5 reads)', detail);
    if (detail.status === 'success') {
      for (const r of detail.data.results) {
        record('Lead detail', `  ${r.key}`, r,
          Array.isArray(r.data) ? `${r.data.length} rows` : 'ok');
      }
    }

    record('Lead detail', 'getEmailDrafts', await call('getEmailDrafts', 'POST', { leadId }));
    record('Lead detail', 'saveEmailDraft', await call('saveEmailDraft', 'POST', {
      leadId, subject: 'smoke test', content: '<p>body</p>',
    }));
    record('Lead detail', 'updateLead (research)', await call('updateLead', 'POST', {
      id: leadId, ResearchFindings: 'smoke', QualificationReason: 'smoke',
    }));
    record('Lead detail', 'completeFollowUp', await call('completeFollowUp', 'POST', {
      leadId, contactMode: 'CALL', outcome: 'smoke test call',
    }));
  } else {
    record('Lead detail', 'no leads seeded', { status: 'error', message: 'no lead to open' });
  }

  /* ---------------- Insights ---------------- */

  record('Insights', 'getProductivity', await call('getProductivity', 'POST', { days: 30, timeZone: 'Asia/Calcutta' }));
  record('Insights', 'getAnalytics', await call('getAnalytics', 'POST', { days: 30 }));
  record('Insights', 'getEmailAnalytics', await call('getEmailAnalytics', 'POST', { days: 30 }));
  record('Insights', 'getUnmatchedEmails', await call('getUnmatchedEmails', 'POST', {}));
  record('Insights', 'syncMailbox', await call('syncMailbox', 'POST', {}));

  /* ---------------- Other pages ---------------- */

  /* ---------------- TopBar (on every screen) ---------------- */

  const todayStr = new Date().toISOString().split('T')[0];
  const notif = await call('batch', 'POST', {
    requests: [
      { key: 'leads', action: 'getLeads' },
      {
        key: 'emailLogs', action: 'getLogs',
        payload: { logAction: 'EMAIL,EMAIL_SENT', since: `${todayStr}T00:00:00.000Z` },
      },
      { key: 'requests', action: 'getAdminRequests' },
    ],
  });
  record('TopBar', 'batch (3 reads)', notif,
    'one request per poll, previously one PER LEAD');
  if (notif.status === 'success') {
    for (const r of notif.data.results) {
      record('TopBar', `  ${r.key}`, r, Array.isArray(r.data) ? `${r.data.length} rows` : 'ok');
    }
  }

  /* ---------------- Daily logs / Meetings / Admin ---------------- */

  const daily = await call('batch', 'POST', {
    requests: [
      { key: 'users', action: 'getUsers' },
      { key: 'logs', action: 'getLogs', payload: { logAction: 'DAILY_LOG' } },
    ],
  });
  record('Daily logs', 'batch (2 reads)', daily);

  const meetings = await call('batch', 'POST', {
    requests: [
      { key: 'leads', action: 'getLeads' },
      { key: 'logs', action: 'getLogs', payload: { logAction: 'MEETING,SCHEDULED_CALL' } },
    ],
  });
  record('Meetings', 'batch (2 reads)', meetings);

  const admin = await call('batch', 'POST', {
    requests: [
      { key: 'users', action: 'getUsers' },
      { key: 'leads', action: 'getLeads' },
      { key: 'deals', action: 'getDeals' },
      { key: 'requests', action: 'getAdminRequests' },
      { key: 'logs', action: 'getLogs', payload: { logAction: 'DAILY_LOG' } },
    ],
  });
  record('Admin', 'batch (5 reads)', admin);

  record('Deals', 'getDeals', await call('getDeals', 'GET'));
  record('Projects', 'getProjects', await call('getProjects', 'GET'));
  record('Finance', 'getCommissions', await call('getCommissions', 'GET'));
  record('Finance', 'getKPIs', await call('getKPIs', 'GET'));
  record('Payments', 'getAdminRequests', await call('getAdminRequests', 'GET'));
  record('Team', 'getTeamOverview', await call('getTeamOverview', 'POST', {}));
  record('Admin', 'getDeletedLeads', await call('getDeletedLeads', 'POST', {}));
  record('Admin', 'exportAllData', await call('exportAllData', 'POST', {}));
  record('Daily logs', 'getLogs (DAILY_LOG)', await call('getLogs', 'GET', {}, { logAction: 'DAILY_LOG' }));

  /* ---------------- report ---------------- */

  console.log('');
  console.log('='.repeat(72));
  console.log('  PAGE SMOKE — every request the frontend actually makes');
  console.log('='.repeat(72));
  console.log('');

  let currentPage = '';
  let failures = 0;
  for (const r of results) {
    if (r.page !== currentPage) {
      currentPage = r.page;
      console.log(`  ${currentPage}`);
    }
    if (!r.ok) failures++;
    const mark = r.ok ? ' ok ' : 'FAIL';
    console.log(`    ${mark}  ${r.label.padEnd(26)} ${r.detail}`);
  }

  console.log('');
  if (failures) {
    console.log(`  ${failures} request(s) failed. The browser would show these as errors.`);
    console.log('');
    process.exit(1);
  }
  console.log('  All page requests succeeded.');
  console.log('');
} finally {
  shutdown();
}
