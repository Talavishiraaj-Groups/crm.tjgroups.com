/**
 * Local Google-Sheets-compatible persistence emulator.
 *
 * Reproduces the behaviour the Apps Script backend actually depends on:
 *  - a workbook per entity ("file name" == sheet name), living in a folder
 *  - row 1 is the header row; data starts at row 2
 *  - getDataRange().getValues() returns a dense 2D array
 *  - appendRow() appends at the bottom
 *  - getRange(row, col).setValue() writes a single cell
 *  - values keep their JS type (Sheets coerces numbers/dates; we model that)
 *
 * It also supports deliberate fault injection so tests can exercise
 * partial-failure and concurrency paths that are impossible to trigger
 * against real Sheets on demand.
 */

export class SheetsFault extends Error {
  constructor(message) {
    super(message);
    this.name = 'SheetsFault';
  }
}

/**
 * A single sheet (tab) inside a workbook.
 */
class LocalSheet {
  constructor(store, name, headers = []) {
    this.store = store;
    this.name = name;
    /** @type {any[][]} row 0 is headers */
    this.rows = headers.length ? [headers.slice()] : [];
    this.frozenRows = 0;
  }

  /* ---------- internals used by the store / tests ---------- */

  get headers() {
    return this.rows.length ? this.rows[0].slice() : [];
  }

  get dataRows() {
    return this.rows.slice(1);
  }

  /** Total ops counter — lets perf tests detect full-sheet scans. */
  _tick(kind) {
    this.store._ops[kind] = (this.store._ops[kind] || 0) + 1;
    this.store._runHooks(kind, this.name);
    this.store._faults.maybeThrow(kind, this.name);
  }

  /* ---------- Apps Script Sheet API surface ---------- */

  getName() {
    return this.name;
  }

  setName(name) {
    this.name = name;
    return this;
  }

  getLastRow() {
    return this.rows.length;
  }

  getLastColumn() {
    return this.rows.reduce((max, r) => Math.max(max, r.length), 0);
  }

  getDataRange() {
    this._tick('read');
    const height = this.rows.length;
    const width = this.getLastColumn();
    return new LocalRange(this, 1, 1, height, width);
  }

  getRange(row, col, numRows = 1, numCols = 1) {
    return new LocalRange(this, row, col, numRows, numCols);
  }

  appendRow(values) {
    this._tick('write');
    this.rows.push(values.slice());
    return this;
  }

  deleteRow(rowPosition) {
    this._tick('write');
    this.rows.splice(rowPosition - 1, 1);
    return this;
  }

  setFrozenRows(n) {
    this.frozenRows = n;
    return this;
  }

  clear() {
    this._tick('write');
    this.rows = [];
    return this;
  }
}

/**
 * Reproduce Google Sheets' own type coercion on write.
 *
 * Sheets does NOT store the string "TRUE". It parses it and stores a BOOLEAN,
 * so reading it back gives `true` — and `String(true)` is 'true', lowercase.
 * Any backend comparing `=== 'TRUE'` therefore matched in this harness and
 * never matched in production.
 *
 * That is exactly how the MustChangePassword flag came to be written for every
 * migrated account and then counted as zero. A mock that stores back whatever
 * it was handed is not modelling a spreadsheet; it is modelling a hash map.
 */
function coerceLikeSheets(value) {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  if (/^true$/i.test(t)) return true;
  if (/^false$/i.test(t)) return false;
  return value;
}

class LocalRange {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet;
    this.row = row;
    this.col = col;
    this.numRows = numRows;
    this.numCols = numCols;
  }

  getValues() {
    this.sheet._tick('read');
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const sourceRow = this.sheet.rows[this.row - 1 + r] || [];
      const line = [];
      for (let c = 0; c < this.numCols; c++) {
        const v = sourceRow[this.col - 1 + c];
        // Real Sheets returns '' for blank cells, never undefined.
        line.push(v === undefined || v === null ? '' : v);
      }
      out.push(line);
    }
    return out;
  }

  getValue() {
    return this.getValues()[0][0];
  }



  setValues(values) {
    this.sheet._tick('write');
    for (let r = 0; r < values.length; r++) {
      const target = this.row - 1 + r;
      while (this.sheet.rows.length <= target) this.sheet.rows.push([]);
      for (let c = 0; c < values[r].length; c++) {
        this.sheet.rows[target][this.col - 1 + c] = coerceLikeSheets(values[r][c]);
      }
    }
    return this;
  }

  setValue(value) {
    this.sheet._tick('write');
    const target = this.row - 1;
    while (this.sheet.rows.length <= target) this.sheet.rows.push([]);
    this.sheet.rows[target][this.col - 1] = coerceLikeSheets(value);
    return this;
  }

  setFontWeight() {
    return this;
  }

  clearContent() {
    this.sheet._tick('write');
    for (let r = 0; r < this.numRows; r++) {
      const target = this.row - 1 + r;
      if (!this.sheet.rows[target]) continue;
      for (let c = 0; c < this.numCols; c++) {
        this.sheet.rows[target][this.col - 1 + c] = '';
      }
    }
    return this;
  }
}

/**
 * Controls deliberate failures. Tests arm a fault, run an operation,
 * and assert the system stays consistent.
 */
class FaultInjector {
  constructor() {
    this.rules = [];
  }

  /**
   * @param {object} opts
   * @param {'read'|'write'} opts.on       operation kind to fail
   * @param {string} [opts.sheet]          only fail for this sheet name
   * @param {number} [opts.afterCalls]     let N matching calls succeed first
   * @param {number} [opts.times]          fail this many times then stop
   * @param {string} [opts.message]
   */
  arm(opts) {
    this.rules.push({
      on: opts.on,
      sheet: opts.sheet || null,
      afterCalls: opts.afterCalls || 0,
      times: opts.times === undefined ? 1 : opts.times,
      message: opts.message || 'Simulated Google Sheets failure',
      seen: 0,
      fired: 0,
    });
    return this;
  }

  clear() {
    this.rules = [];
  }

  maybeThrow(kind, sheetName) {
    for (const rule of this.rules) {
      if (rule.on !== kind) continue;
      if (rule.sheet && rule.sheet !== sheetName) continue;
      rule.seen++;
      if (rule.seen <= rule.afterCalls) continue;
      if (rule.fired >= rule.times) continue;
      rule.fired++;
      throw new SheetsFault(rule.message);
    }
  }
}

/**
 * The workbook collection. One "file" per entity, mirroring the production
 * layout where each table is its own spreadsheet inside a Drive folder.
 */
export class SheetsStore {
  constructor() {
    /** @type {Map<string, LocalSheet>} */
    this.sheets = new Map();
    this._faults = new FaultInjector();
    this._ops = {};
    /** @type {Array<{kind:string, sheet:string|null, fn:Function, once:boolean, fired:boolean}>} */
    this._hooks = [];
  }

  get faults() {
    return this._faults;
  }

  /**
   * Run `fn` the moment a matching sheet operation happens.
   *
   * This is how we simulate true concurrency on a single-threaded runtime:
   * a test can re-enter the backend part-way through another operation,
   * which is exactly the read-modify-write window that Apps Script's
   * cooperative execution model exposes in production.
   */
  onOperation(kind, sheetName, fn, { once = true } = {}) {
    const hook = { kind, sheet: sheetName || null, fn, once, fired: false };
    this._hooks.push(hook);
    return () => {
      const i = this._hooks.indexOf(hook);
      if (i >= 0) this._hooks.splice(i, 1);
    };
  }

  clearHooks() {
    this._hooks = [];
  }

  _runHooks(kind, sheetName) {
    // Snapshot: a hook may add/remove hooks while running.
    for (const hook of [...this._hooks]) {
      if (hook.kind !== kind) continue;
      if (hook.sheet && hook.sheet !== sheetName) continue;
      if (hook.once && hook.fired) continue;
      hook.fired = true;
      hook.fn({ kind, sheet: sheetName });
    }
  }

  /** Operation counters, for performance/N+1 assertions. */
  get ops() {
    return { ...this._ops };
  }

  resetOps() {
    this._ops = {};
  }

  createSheet(name, headers = []) {
    const sheet = new LocalSheet(this, name, headers);
    this.sheets.set(name, sheet);
    return sheet;
  }

  getSheet(name) {
    return this.sheets.get(name) || null;
  }

  hasSheet(name) {
    return this.sheets.has(name);
  }

  /**
   * Remove a sheet entirely.
   *
   * Test-only, and used for exactly one thing: reproducing the state of a
   * live spreadsheet in the window between pasting new backend code and
   * running migrateDatabase(), when the new sheets do not exist yet. Nothing
   * in the backend ever deletes a sheet.
   */
  dropSheet(name) {
    return this.sheets.delete(name);
  }

  listSheets() {
    return [...this.sheets.keys()];
  }

  /** Convenience: rows as objects keyed by header. */
  toObjects(name) {
    const sheet = this.getSheet(name);
    if (!sheet) return [];
    const headers = sheet.headers;
    return sheet.dataRows.map((row) => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = row[i] === undefined ? '' : row[i];
      });
      return obj;
    });
  }

  /** Convenience: append an object using the sheet's header order. */
  insert(name, obj) {
    const sheet = this.getSheet(name);
    if (!sheet) throw new Error(`No such sheet: ${name}`);
    const row = sheet.headers.map((h) => (obj[h] === undefined ? '' : obj[h]));
    sheet.rows.push(row);
    return obj;
  }

  /** Deep snapshot for before/after comparisons in failure tests. */
  snapshot() {
    const out = {};
    for (const [name, sheet] of this.sheets) {
      out[name] = sheet.rows.map((r) => r.slice());
    }
    return out;
  }

  restore(snapshot) {
    for (const [name, rows] of Object.entries(snapshot)) {
      const sheet = this.getSheet(name);
      if (sheet) sheet.rows = rows.map((r) => r.slice());
    }
  }
}
