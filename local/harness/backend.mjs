/**
 * Loads the REAL Apps Script sources from ../../backend_apps_script into a
 * Node vm context populated with local Google service adapters.
 *
 * This is deliberately NOT a reimplementation. The bytes executed here are the
 * same bytes deployed to Apps Script, so a test failure is a real defect in
 * the shipped backend rather than in a parallel mock.
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { SheetsStore } from '../mocks/sheets-store.mjs';
import { createAppsScriptEnv } from '../mocks/google-apps-script.mjs';
import { createZohoMock } from '../mocks/zoho-mock.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_DIR = path.resolve(HERE, '..', '..', 'backend_apps_script');

/**
 * Apps Script concatenates all .gs files into one global scope. Load order
 * only matters for top-level statements (not hoisted function declarations),
 * so we load config/utils first to mirror a sane editor ordering.
 */
const PREFERRED_ORDER = [
  'utils.gs',        // domain rules + API infrastructure (no dependencies)
  'controllers.gs',  // storage + business operations
  'auth.gs',         // sessions, hashing, authorisation gate
  'ZohoMail.gs',     // external integration
  'setup.gs',        // schema, migration, bootstrap
  'api.gs',          // router
];

export function listBackendFiles(dir = BACKEND_DIR) {
  const present = fs.readdirSync(dir).filter((f) => f.endsWith('.gs'));
  const ordered = PREFERRED_ORDER.filter((f) => present.includes(f));
  const rest = present.filter((f) => !PREFERRED_ORDER.includes(f)).sort();
  return [...ordered, ...rest];
}

/**
 * @param {object} [opts]
 * @param {string}  [opts.dir]              backend source directory
 * @param {object}  [opts.scriptProperties] seed script properties
 * @param {object}  [opts.zoho]             zoho mock options (false to disable)
 * @param {SheetsStore} [opts.store]
 */
export function loadBackend(opts = {}) {
  const dir = opts.dir || BACKEND_DIR;
  const store = opts.store || new SheetsStore();

  const zoho = opts.zoho === false ? null : createZohoMock(opts.zoho || {});

  const env = createAppsScriptEnv({
    store,
    scriptProperties: opts.scriptProperties,
    startTime: opts.startTime,
    uuidSeed: opts.uuidSeed,
    urlFetch: zoho ? zoho.handleFetch : undefined,
  });

  const context = vm.createContext(env);
  // Apps Script exposes globals via `this` at top level.
  context.globalThis = context;

  // Apps Script concatenates every .gs file into ONE shared global scope, so
  // top-level `const`/`let` in one file is visible to all the others. Running
  // each file as its own vm script would give each one a private script scope
  // and break those references, so we concatenate to match production.
  const files = listBackendFiles(dir);
  const parts = [];
  const lineMap = []; // [{ file, startLine }]
  let line = 1;
  for (const file of files) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    const banner = `/* ==== ${file} ==== */\n`;
    lineMap.push({ file, startLine: line + 1 });
    parts.push(banner + src + '\n');
    line += banner.split('\n').length - 1 + src.split('\n').length - 1 + 1;
  }

  const combined = parts.join('');
  try {
    vm.runInContext(combined, context, { filename: 'backend_apps_script/<combined>' });
  } catch (err) {
    err.message = `${err.message}\n  (loaded files: ${files.join(', ')})`;
    throw err;
  }

  return new BackendHandle({ context, env, store, zoho, loaded: files, dir, lineMap });
}

/**
 * Thin ergonomic wrapper around the loaded Apps Script global scope.
 */
export class BackendHandle {
  constructor({ context, env, store, zoho, loaded, dir, lineMap }) {
    this.context = context;
    this.env = env;
    this.store = store;
    this.zoho = zoho;
    this.loadedFiles = loaded;
    this.dir = dir;
    this.lineMap = lineMap || [];
  }

  /** Does the deployed backend define this global function? */
  has(fnName) {
    return typeof this.context[fnName] === 'function';
  }

  /** Call any backend global directly. */
  call(fnName, ...args) {
    const fn = this.context[fnName];
    if (typeof fn !== 'function') {
      throw new Error(`Backend does not define function '${fnName}'`);
    }
    return fn(...args);
  }

  /**
   * Make a sheet genuinely not exist — removed from storage AND from Drive.
   *
   * Test-only. It reproduces the state of a live spreadsheet in the window
   * between pasting new backend code and running migrateDatabase(), when the
   * newly-added sheets have not been created yet. Dropping it from the store
   * alone would be a misleading half-measure: the Drive folder would still
   * list the file, so the backend would take the "sheet exists" branch and the
   * test would prove nothing about the real situation.
   *
   * Nothing in the backend ever deletes a sheet.
   */
  dropSheet(name) {
    const removed = this.store.dropSheet(name);
    if (this.env.dropSpreadsheetFile) this.env.dropSpreadsheetFile(name);
    return removed;
  }

  /** Read any backend global (a table, a constant) by name. */
  evaluate(name) {
    if (!(name in this.context)) {
      throw new Error(`Backend does not define '${name}'`);
    }
    return this.context[name];
  }

  /** Script properties, as the deployed script sees them. */
  props() {
    return this.context.PropertiesService.getScriptProperties();
  }

  setProp(k, v) {
    this.props().setProperty(k, v);
    return this;
  }

  /* ---------------- HTTP surface ---------------- */

  /**
   * Invoke doGet exactly as the Apps Script web app would.
   * @param {object} parameter query-string parameters
   */
  get(parameter = {}, extra = {}) {
    const e = { parameter: { ...parameter }, parameters: {}, ...extra };
    for (const [k, v] of Object.entries(e.parameter)) e.parameters[k] = [v];
    return parseOutput(this.call('doGet', e));
  }

  /**
   * Invoke doPost exactly as the Apps Script web app would.
   * @param {object|string} body request body (object is JSON-stringified)
   */
  post(body, extra = {}) {
    const contents = typeof body === 'string' ? body : JSON.stringify(body);
    const e = {
      parameter: extra.parameter || {},
      parameters: {},
      postData: { contents, type: 'text/plain', length: contents.length },
      ...extra,
    };
    for (const [k, v] of Object.entries(e.parameter)) e.parameters[k] = [v];
    return parseOutput(this.call('doPost', e));
  }

  /** Raw doPost with a deliberately malformed body. */
  postRaw(raw) {
    return parseOutput(
      this.call('doPost', {
        parameter: {},
        parameters: {},
        postData: { contents: raw, type: 'text/plain', length: String(raw).length },
      })
    );
  }

  /* ---------------- convenience ---------------- */

  rows(sheet) {
    return this.store.toObjects(sheet);
  }

  sheets() {
    return this.store.listSheets();
  }

  advanceTime(ms) {
    return this.env._clock.advance(ms);
  }

  get lockState() {
    return this.context.LockService._state;
  }
}

/**
 * Apps Script returns a TextOutput. Decode it into { status, data, ... }
 * plus the raw text so tests can assert on malformed output too.
 */
function parseOutput(output) {
  if (output === undefined || output === null) {
    return { _raw: null, _parsed: false, status: undefined };
  }
  const text = typeof output.getContent === 'function' ? output.getContent() : String(output);
  const mime = typeof output.getMimeType === 'function' ? output.getMimeType() : null;
  try {
    const json = JSON.parse(text);
    return { ...json, _raw: text, _mime: mime, _parsed: true };
  } catch {
    return { _raw: text, _mime: mime, _parsed: false };
  }
}
