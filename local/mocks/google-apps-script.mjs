/**
 * Local implementations of the Google Apps Script global services.
 *
 * These are adapters, not reimplementations of business logic: the real
 * `.gs` sources run unmodified on top of them. Anything that behaves
 * differently from production is called out in local/README.md.
 */

import crypto from 'node:crypto';
import { SheetsStore } from './sheets-store.mjs';

/* ------------------------------------------------------------------ *
 * Utilities
 * ------------------------------------------------------------------ */

/** Apps Script returns SIGNED bytes (-128..127). Model that faithfully. */
function toSignedBytes(buf) {
  const out = new Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    out[i] = buf[i] > 127 ? buf[i] - 256 : buf[i];
  }
  return out;
}

function fromSignedBytes(bytes) {
  return Buffer.from(bytes.map((b) => (b < 0 ? b + 256 : b)));
}

function coerceToBuffer(value) {
  if (Array.isArray(value)) return fromSignedBytes(value);
  if (Buffer.isBuffer(value)) return value;
  return Buffer.from(String(value), 'utf8');
}

export function createUtilities({ uuid }) {
  const DigestAlgorithm = { SHA_256: 'sha256', SHA_1: 'sha1', MD5: 'md5' };
  const Charset = { UTF_8: 'utf8', US_ASCII: 'ascii' };

  return {
    DigestAlgorithm,
    Charset,

    getUuid: () => uuid(),

    computeDigest(algorithm, value) {
      const h = crypto.createHash(algorithm || 'sha256');
      h.update(coerceToBuffer(value));
      return toSignedBytes(h.digest());
    },

    /**
     * Apps Script accepts (String, String) or (Byte[], Byte[]) — NEVER a
     * mixture. Coercing both, as this mock originally did, made the harness
     * more permissive than the platform: a hash loop that fed a Byte[] digest
     * back in with a String key passed every local test and then failed on
     * every account in production with
     *
     *   The parameters (number[],String) don't match the method signature
     *
     * A mock that accepts what the real API rejects is worse than no mock, so
     * this enforces the overloads exactly.
     */
    computeHmacSha256Signature(value, key, charset) {
      const kind = (v) =>
        typeof v === 'string' ? 'String'
        : Array.isArray(v) || Buffer.isBuffer(v) ? 'number[]'
        : typeof v;

      const vKind = kind(value);
      const kKind = kind(key);
      const mixed = vKind !== kKind;
      const known = (vKind === 'String' || vKind === 'number[]');

      if (mixed || !known) {
        // Same shape of message Apps Script produces, so the local failure
        // reads like the real one.
        throw new Error(
          `The parameters (${vKind},${kKind}) don't match the method signature ` +
          `for Utilities.computeHmacSha256Signature.`
        );
      }
      if (charset !== undefined && vKind !== 'String') {
        throw new Error(
          "The parameters (number[],number[],String) don't match the method " +
          'signature for Utilities.computeHmacSha256Signature.'
        );
      }

      const h = crypto.createHmac('sha256', coerceToBuffer(key));
      h.update(coerceToBuffer(value));
      return toSignedBytes(h.digest());
    },

    base64Encode(value) {
      return coerceToBuffer(value).toString('base64');
    },

    base64EncodeWebSafe(value) {
      return coerceToBuffer(value)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    },

    base64Decode(value) {
      return toSignedBytes(Buffer.from(String(value), 'base64'));
    },

    base64DecodeWebSafe(value) {
      const norm = String(value).replace(/-/g, '+').replace(/_/g, '/');
      return toSignedBytes(Buffer.from(norm, 'base64'));
    },

    newBlob(data, contentType, name) {
      const buf = coerceToBuffer(data);
      return {
        getDataAsString: () => buf.toString('utf8'),
        getBytes: () => toSignedBytes(buf),
        getContentType: () => contentType || 'application/octet-stream',
        getName: () => name || '',
      };
    },

    // Apps Script sleep is blocking; tests should not rely on wall-clock.
    sleep() {},

    formatString(template, ...args) {
      let i = 0;
      return String(template).replace(/%s|%d/g, () => String(args[i++]));
    },

    /**
     * Apps Script's Utilities.formatDate(date, timeZone, pattern).
     *
     * Implements the SimpleDateFormat subset the backend actually uses:
     * yyyy MM dd HH mm ss, the XXX ISO offset, and single-quoted literals.
     * Timezone conversion goes through Intl, which Node has full ICU for.
     */
    formatDate(date, timeZone, pattern) {
      const d = date instanceof Date ? date : new Date(date);
      const tz = timeZone || 'Etc/UTC';

      let parts;
      try {
        parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: tz,
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
          hour12: false,
        }).formatToParts(d).reduce((acc, p) => {
          acc[p.type] = p.value;
          return acc;
        }, {});
      } catch {
        throw new Error(`Unsupported time zone: ${tz}`);
      }

      // Offset for XXX, derived by comparing the zone's wall clock to UTC.
      const asUtc = Date.UTC(
        Number(parts.year), Number(parts.month) - 1, Number(parts.day),
        Number(parts.hour === '24' ? '00' : parts.hour), Number(parts.minute), Number(parts.second)
      );
      const offsetMin = Math.round((asUtc - d.getTime()) / 60000);
      const sign = offsetMin >= 0 ? '+' : '-';
      const abs = Math.abs(offsetMin);
      const offset = offsetMin === 0
        ? 'Z'
        : `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;

      const tokens = {
        yyyy: parts.year,
        MM: parts.month,
        dd: parts.day,
        HH: parts.hour === '24' ? '00' : parts.hour,
        mm: parts.minute,
        ss: parts.second,
        XXX: offset,
      };

      // Split on quoted literals so 'T' is emitted verbatim.
      return String(pattern)
        .split(/('[^']*')/)
        .map((chunk) => {
          if (chunk.startsWith("'") && chunk.endsWith("'") && chunk.length >= 2) {
            return chunk.slice(1, -1);
          }
          return chunk.replace(/yyyy|MM|dd|HH|mm|ss|XXX/g, (t) => tokens[t]);
        })
        .join('');
    },
  };
}

/* ------------------------------------------------------------------ *
 * PropertiesService
 * ------------------------------------------------------------------ */

export function createPropertiesService(initial = {}) {
  const makeStore = (seed) => {
    const map = new Map(Object.entries(seed));
    return {
      getProperty: (k) => (map.has(k) ? map.get(k) : null),
      setProperty(k, v) {
        map.set(k, String(v));
        return this;
      },
      setProperties(obj) {
        for (const [k, v] of Object.entries(obj)) map.set(k, String(v));
        return this;
      },
      deleteProperty(k) {
        map.delete(k);
        return this;
      },
      getProperties: () => Object.fromEntries(map),
      getKeys: () => [...map.keys()],
      _map: map,
    };
  };

  const script = makeStore(initial);
  const user = makeStore({});
  const document = makeStore({});

  return {
    getScriptProperties: () => script,
    getUserProperties: () => user,
    getDocumentProperties: () => document,
  };
}

/* ------------------------------------------------------------------ *
 * CacheService
 * ------------------------------------------------------------------ */

export function createCacheService({ now }) {
  const makeCache = () => {
    const map = new Map();
    const alive = (entry) => entry && entry.expiresAt > now();
    return {
      get(key) {
        const e = map.get(key);
        if (!alive(e)) {
          map.delete(key);
          return null;
        }
        return e.value;
      },
      put(key, value, seconds = 600) {
        map.set(key, { value: String(value), expiresAt: now() + seconds * 1000 });
      },
      remove(key) {
        map.delete(key);
      },
      removeAll(keys) {
        (keys || []).forEach((k) => map.delete(k));
      },
      _map: map,
    };
  };
  const script = makeCache();
  return {
    getScriptCache: () => script,
    getUserCache: () => makeCache(),
    getDocumentCache: () => makeCache(),
  };
}

/* ------------------------------------------------------------------ *
 * LockService
 *
 * Node is single-threaded, so a lock can never actually block here.
 * We still model acquisition state faithfully so that re-entrant calls
 * (our concurrency simulation) observe a held lock and fail exactly the
 * way a second Apps Script execution would.
 * ------------------------------------------------------------------ */

export class LockTimeout extends Error {
  constructor() {
    super('Could not acquire lock');
    this.name = 'LockTimeout';
  }
}

export function createLockService() {
  const state = { held: false, depth: 0, acquisitions: 0, contentions: 0 };

  const makeLock = () => ({
    tryLock(_timeoutMs) {
      if (state.held) {
        state.contentions++;
        return false;
      }
      state.held = true;
      state.acquisitions++;
      return true;
    },
    waitLock(_timeoutMs) {
      if (state.held) {
        state.contentions++;
        throw new LockTimeout();
      }
      state.held = true;
      state.acquisitions++;
    },
    hasLock() {
      return state.held;
    },
    releaseLock() {
      state.held = false;
    },
  });

  return {
    getScriptLock: makeLock,
    getUserLock: makeLock,
    getDocumentLock: makeLock,
    _state: state,
  };
}

/* ------------------------------------------------------------------ *
 * ContentService
 * ------------------------------------------------------------------ */

export function createContentService() {
  const MimeType = { JSON: 'application/json', TEXT: 'text/plain' };
  return {
    MimeType,
    createTextOutput(content) {
      return {
        _content: content,
        _mime: MimeType.TEXT,
        setMimeType(m) {
          this._mime = m;
          return this;
        },
        getContent() {
          return this._content;
        },
        getMimeType() {
          return this._mime;
        },
      };
    },
  };
}

/* ------------------------------------------------------------------ *
 * Drive + Spreadsheet
 * ------------------------------------------------------------------ */

export function createDriveAndSheets(store, { uuid }) {
  /** folderId -> { id, name, files:Set<string>, folders:Map<name,id> } */
  const folders = new Map();
  /** fileId -> sheetName */
  const filesById = new Map();
  /** sheetName -> fileId */
  const fileIdByName = new Map();

  const ROOT_ID = 'root-folder-id';
  folders.set(ROOT_ID, { id: ROOT_ID, name: 'CRM Root', files: new Set(), folders: new Map() });

  function makeFileHandle(fileId) {
    return {
      getId: () => fileId,
      getName: () => filesById.get(fileId),
      moveTo(folder) {
        for (const f of folders.values()) f.files.delete(fileId);
        folder._raw.files.add(fileId);
        return this;
      },
      setTrashed() {
        return this;
      },
    };
  }

  function makeFolderHandle(raw) {
    return {
      _raw: raw,
      getId: () => raw.id,
      getName: () => raw.name,
      getFoldersByName(name) {
        const id = raw.folders.get(name);
        const list = id ? [makeFolderHandle(folders.get(id))] : [];
        let i = 0;
        return { hasNext: () => i < list.length, next: () => list[i++] };
      },
      createFolder(name) {
        const id = `folder-${uuid()}`;
        folders.set(id, { id, name, files: new Set(), folders: new Map() });
        raw.folders.set(name, id);
        return makeFolderHandle(folders.get(id));
      },
      getFilesByName(name) {
        const list = [...raw.files]
          .filter((fid) => filesById.get(fid) === name)
          .map(makeFileHandle);
        let i = 0;
        return { hasNext: () => i < list.length, next: () => list[i++] };
      },
      getFiles() {
        const list = [...raw.files].map(makeFileHandle);
        let i = 0;
        return { hasNext: () => i < list.length, next: () => list[i++] };
      },
    };
  }

  const DriveApp = {
    getFolderById(id) {
      const raw = folders.get(id);
      if (!raw) throw new Error(`No item with the given ID could be found: ${id}`);
      return makeFolderHandle(raw);
    },
    getFileById(id) {
      if (!filesById.has(id)) throw new Error(`No item with the given ID could be found: ${id}`);
      return makeFileHandle(id);
    },
    getRootFolder: () => makeFolderHandle(folders.get(ROOT_ID)),
  };

  function makeSpreadsheetHandle(sheetName) {
    return {
      getId: () => fileIdByName.get(sheetName),
      getName: () => sheetName,
      getActiveSheet: () => store.getSheet(sheetName),
      getSheets: () => [store.getSheet(sheetName)],
      getSheetByName: (n) => (n === sheetName ? store.getSheet(sheetName) : null),
      insertSheet: (n) => store.createSheet(n, []),
    };
  }

  const SpreadsheetApp = {
    create(name) {
      const fileId = `file-${uuid()}`;
      if (!store.hasSheet(name)) store.createSheet(name, []);
      filesById.set(fileId, name);
      fileIdByName.set(name, fileId);
      folders.get(ROOT_ID).files.add(fileId);
      return makeSpreadsheetHandle(name);
    },
    openById(id) {
      const name = filesById.get(id);
      if (!name) throw new Error(`No item with the given ID could be found: ${id}`);
      return makeSpreadsheetHandle(name);
    },
    openByUrl(url) {
      const m = String(url).match(/\/d\/([^/]+)/);
      return SpreadsheetApp.openById(m ? m[1] : url);
    },
    flush() {},
  };

  /**
   * Forget a spreadsheet file entirely — test-only.
   *
   * Removing the sheet from storage is not enough to model "this sheet does
   * not exist": the folder would still list the file, so code that checks
   * `getFilesByName(...).hasNext()` would take the wrong branch. This drops
   * both, which is what migrateDatabase() has to cope with on a live
   * spreadsheet that predates the new sheets.
   */
  function dropSpreadsheetFile(name) {
    const fileId = fileIdByName.get(name);
    if (fileId === undefined) return false;
    fileIdByName.delete(name);
    filesById.delete(fileId);
    for (const folder of folders.values()) folder.files.delete(fileId);
    return true;
  }

  return {
    DriveApp,
    SpreadsheetApp,
    ROOT_FOLDER_ID: ROOT_ID,
    dropSpreadsheetFile,
    _folders: folders,
    _filesById: filesById,
  };
}

/* ------------------------------------------------------------------ *
 * Environment assembly
 * ------------------------------------------------------------------ */

/**
 * Build a complete Apps Script global environment backed by local adapters.
 *
 * @param {object} [opts]
 * @param {SheetsStore} [opts.store]
 * @param {object} [opts.scriptProperties]
 * @param {Function} [opts.urlFetch]  handler(url, params) -> response object
 * @param {Function} [opts.now]       () => epoch ms (deterministic clock)
 */
export function createAppsScriptEnv(opts = {}) {
  const store = opts.store || new SheetsStore();

  // Deterministic UUIDs keep fixtures reproducible across runs.
  let uuidCounter = 0;
  const uuidSeed = opts.uuidSeed || 'tjcrm';
  const uuid = opts.uuid || (() => {
    uuidCounter++;
    const h = crypto
      .createHash('sha1')
      .update(`${uuidSeed}:${uuidCounter}`)
      .digest('hex');
    return [
      h.slice(0, 8),
      h.slice(8, 12),
      `4${h.slice(13, 16)}`,
      `a${h.slice(17, 20)}`,
      h.slice(20, 32),
    ].join('-');
  });

  let clock = opts.startTime || Date.parse('2026-01-05T09:00:00.000Z');
  const now = opts.now || (() => clock);
  const advance = (ms) => {
    clock += ms;
    return clock;
  };

  const { DriveApp, SpreadsheetApp, ROOT_FOLDER_ID, dropSpreadsheetFile } =
    createDriveAndSheets(store, { uuid });

  const logs = [];
  const Logger = {
    log: (...args) => {
      logs.push(args.map(String).join(' '));
    },
    getLog: () => logs.join('\n'),
    clear: () => {
      logs.length = 0;
    },
  };

  const fetchCalls = [];
  const UrlFetchApp = {
    fetch(url, params = {}) {
      fetchCalls.push({ url, params });
      if (!opts.urlFetch) {
        throw new Error(`Unexpected external fetch in local mode: ${url}`);
      }
      return opts.urlFetch(url, params);
    },
    fetchAll(requests) {
      return requests.map((r) => UrlFetchApp.fetch(r.url, r));
    },
    _calls: fetchCalls,
  };

  const Session = {
    getActiveUser: () => ({ getEmail: () => opts.activeUserEmail || '' }),
    getEffectiveUser: () => ({ getEmail: () => opts.effectiveUserEmail || 'owner@tjgroups.test' }),
    getScriptTimeZone: () => 'Etc/UTC',
  };

  const ScriptApp = {
    getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/LOCAL_TEST/exec' }),
  };

  const env = {
    store,
    logs,
    DriveApp,
    SpreadsheetApp,
    /** Test-only: forget a spreadsheet file as well as its rows. */
    dropSpreadsheetFile,
    PropertiesService: createPropertiesService({
      MAIN_FOLDER_ID: ROOT_FOLDER_ID,
      ...(opts.scriptProperties || {}),
    }),
    CacheService: createCacheService({ now }),
    LockService: createLockService(),
    ContentService: createContentService(),
    Utilities: createUtilities({ uuid }),
    UrlFetchApp,
    Logger,
    Session,
    ScriptApp,
    console,
    // Deterministic Date: the backend stamps timestamps via `new Date()`.
    Date: makeDeterministicDate(now),
    JSON,
    Math,
    Number,
    String,
    Boolean,
    Object,
    Array,
    Error,
    TypeError,
    RangeError,
    isNaN,
    isFinite,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent,
    // test-only handles
    _clock: { now, advance, set: (t) => (clock = t) },
    _uuid: uuid,
    ROOT_FOLDER_ID,
  };

  return env;
}

/** A Date subclass whose no-arg constructor follows the deterministic clock. */
function makeDeterministicDate(now) {
  const RealDate = Date;
  class DeterministicDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(now());
      else super(...args);
    }
    static now() {
      return now();
    }
    static parse(...a) {
      return RealDate.parse(...a);
    }
    static UTC(...a) {
      return RealDate.UTC(...a);
    }
  }
  return DeterministicDate;
}
