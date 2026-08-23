/**
 * Frontend/backend action contract.
 *
 * Every action name the browser can send must exist in the backend's policy
 * table AND be handled by the router. When they drift, the failure reaches the
 * user as "Unknown action: X" on a page that used to work — which reads like a
 * frontend bug and is not one.
 *
 * This is a static check on purpose: it fails the moment an action is renamed
 * or added on one side only, without needing anyone to click through the app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBackend } from '../harness/backend.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/* ------------------------------------------------------------------ *
 * What the frontend can send
 * ------------------------------------------------------------------ */

function readFrontendSource() {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
    }
  };
  walk(path.join(ROOT, 'src'));
  return files.map((f) => ({ file: f, text: fs.readFileSync(f, 'utf8') }));
}

/** `fetchAPI('someAction', ...)` and `action: 'someAction'` inside a batch. */
function extractActions(sources) {
  const found = new Map(); // action -> Set of files

  const add = (action, file) => {
    if (!found.has(action)) found.set(action, new Set());
    found.get(action).add(path.relative(ROOT, file));
  };

  for (const { file, text } of sources) {
    for (const m of text.matchAll(/fetchAPI\s*<?[^>]*>?\s*\(\s*'([A-Za-z0-9_]+)'/g)) {
      add(m[1], file);
    }
    // api.batch([{ key: 'x', action: 'getLeads' }, ...])
    for (const m of text.matchAll(/\baction:\s*'([A-Za-z0-9_]+)'\s*[,}]/g)) {
      // Skip log-action payloads and UI-level action strings: only names that
      // look like API calls (verbNoun) are routed.
      if (/^(get|set|create|update|delete|assign|convert|mark|link|unlink|send|save|restore|complete|cancel|process|export|sync|login|logout|change|batch)/.test(m[1])) {
        add(m[1], file);
      }
    }
  }
  return found;
}

/* ------------------------------------------------------------------ *
 * What the backend accepts
 * ------------------------------------------------------------------ */

const be = loadBackend({
  scriptProperties: {
    ZOHO_CLIENT_ID: 'x', ZOHO_CLIENT_SECRET: 'y',
    PASSWORD_ITERATIONS: '50', ENVIRONMENT: 'test',
  },
  zoho: { clientId: 'x', clientSecret: 'y' },
});

const policyActions = new Set(Object.keys(be.evaluate('ACTION_POLICY')));

/** Action names the router has a `case` for. */
function routedActions() {
  const api = fs.readFileSync(path.join(ROOT, 'backend_apps_script', 'api.gs'), 'utf8');
  const names = new Set();
  for (const m of api.matchAll(/case\s+'([A-Za-z0-9_]+)'\s*:/g)) names.add(m[1]);
  return names;
}

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

const frontend = extractActions(readFrontendSource());
const routed = routedActions();

test('CONTRACT-A: every action the frontend sends exists in the policy table', () => {
  const missing = [];
  for (const [action, files] of frontend) {
    if (!policyActions.has(action)) {
      missing.push(`${action}  (sent from ${[...files].join(', ')})`);
    }
  }
  assert.equal(missing.length, 0,
    'The browser can send actions the backend has no policy for. These reach ' +
    'the user as "Unknown action":\n  - ' + missing.join('\n  - '));
});

test('CONTRACT-B: every action the frontend sends is handled by the router', () => {
  const missing = [];
  for (const [action, files] of frontend) {
    if (!routed.has(action)) {
      missing.push(`${action}  (sent from ${[...files].join(', ')})`);
    }
  }
  assert.equal(missing.length, 0,
    'Actions with a policy but no router case fall through to UNKNOWN_ACTION:\n  - ' +
    missing.join('\n  - '));
});

test('CONTRACT-C: every routed action has a policy entry', () => {
  // The reverse direction. An action the router handles but the policy does
  // not know is unreachable — roleMayCallAction rejects it before dispatch.
  const orphans = [...routed].filter((a) => !policyActions.has(a));
  assert.deepEqual(orphans, [],
    'These have a router case but no ACTION_POLICY entry, so they are dead code: ' +
    orphans.join(', '));
});

test('CONTRACT-D: every batchable action is real and read-only by name', () => {
  const batchable = be.evaluate('BATCHABLE_ACTIONS');

  for (const action of batchable) {
    assert.ok(policyActions.has(action),
      `${action} is listed as batchable but has no policy entry`);
    assert.ok(routed.has(action),
      `${action} is listed as batchable but the router does not handle it`);
    assert.match(action, /^get/,
      `${action} is batchable but is not a getter — batching must stay read-only`);
  }
});

test('CONTRACT-E: routing keys never leak into a GET payload', () => {
  // `action` and `token` route and authenticate the request. On a GET they
  // travel in the same flat query string as everything else, so a handler
  // field of either name would silently receive the router's value. The
  // request layer strips them; this proves it, rather than asking every
  // handler to remember.
  const local = loadBackend({
    scriptProperties: {
      ZOHO_CLIENT_ID: 'x', ZOHO_CLIENT_SECRET: 'y',
      PASSWORD_ITERATIONS: '50', ENVIRONMENT: 'test',
    },
    zoho: { clientId: 'x', clientSecret: 'y' },
  });
  local.call('setupCRMDatabase');
  local.call('setAuthEnforcement', 'off');

  let seen = null;
  local.context.__probePayload = null;
  // Swap in a recorder for one read action and observe what it is handed.
  const original = local.context.getFinancialKPIs;
  local.context.getFinancialKPIs = function () {
    seen = local.context.__lastPayload;
    return {};
  };
  const origDispatch = local.context.dispatch;
  local.context.dispatch = function (action, payload, actor, e, body) {
    local.context.__lastPayload = payload;
    return origDispatch(action, payload, actor, e, body);
  };

  local.get({ action: 'getKPIs', token: 'some-token', id: 'keep-me' });
  local.context.getFinancialKPIs = original;

  assert.ok(seen, 'the handler was not reached');
  assert.equal(seen.action, undefined, 'the routing key leaked into the payload');
  assert.equal(seen.token, undefined, 'the session token leaked into the payload');
  assert.equal(seen.id, 'keep-me', 'ordinary parameters must still come through');
});
