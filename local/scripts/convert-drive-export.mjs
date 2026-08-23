/**
 * Convert a Google Drive export of the CRM (.xlsx per sheet) into the single
 * JSON file the local dev server and the data-preservation report consume.
 *
 *   node local/scripts/convert-drive-export.mjs <folder-with-xlsx> [out.json]
 *
 * Default output: local/.data/crm-export.json  (git-ignored)
 *
 * READ-ONLY on the source. Values are preserved exactly:
 *   - IDs stay strings, never coerced to numbers
 *   - dates become ISO strings (Excel serial numbers are converted, not lost)
 *   - blank cells become '' rather than disappearing
 *   - sheets not in DATABASE_SCHEMA are reported and skipped, so unmanaged
 *     data such as "Team_s information" is never fed into the CRM
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadBackend } from '../harness/backend.mjs';

const XLSX = createRequire(import.meta.url)('xlsx');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

const srcDir = process.argv[2];
const outArg = process.argv[3];

if (!srcDir) {
  console.error('\nusage: node local/scripts/convert-drive-export.mjs <folder-with-xlsx> [out.json]\n');
  console.error('  <folder-with-xlsx>  the unzipped Google Drive download');
  console.error('  [out.json]          defaults to local/.data/crm-export.json\n');
  process.exit(1);
}

if (!fs.existsSync(srcDir)) {
  console.error(`\nNo such file or folder: ${srcDir}\n`);
  console.error('Point this at the Google Drive download — either the .zip itself');
  console.error('or a folder containing the .xlsx files. For example:\n');
  console.error('  node local/scripts/convert-drive-export.mjs "C:\\Users\\admin\\Downloads\\drive-download-....zip"\n');
  process.exit(1);
}

/**
 * Accept the .zip straight from Drive so there is no separate unzip step.
 * Extraction goes to a temp folder; the original archive is never modified.
 */
function resolveSourceFolder(input) {
  const stat = fs.statSync(input);
  if (stat.isDirectory()) return input;

  if (!/\.zip$/i.test(input)) {
    console.error(`\n${input} is neither a folder nor a .zip file.\n`);
    process.exit(1);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-drive-'));
  try {
    if (process.platform === 'win32') {
      execFileSync('powershell', [
        '-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -LiteralPath '${input.replace(/'/g, "''")}' -DestinationPath '${tmp.replace(/'/g, "''")}' -Force`,
      ], { stdio: 'pipe' });
    } else {
      execFileSync('unzip', ['-qo', input, '-d', tmp], { stdio: 'pipe' });
    }
  } catch (err) {
    console.error(`\nCould not extract ${input}: ${err.message}\n`);
    console.error('Unzip it manually and pass the folder instead.\n');
    process.exit(1);
  }

  // Drive archives sometimes wrap everything in a single folder.
  const entries = fs.readdirSync(tmp, { withFileTypes: true });
  const hasXlsxHere = entries.some((e) => e.isFile() && /\.xlsx$/i.test(e.name));
  if (!hasXlsxHere) {
    const nested = entries.find((e) => e.isDirectory());
    if (nested) return path.join(tmp, nested.name);
  }
  console.log(`  (extracted "${path.basename(input)}" to a temporary folder)`);
  return tmp;
}

const resolvedDir = resolveSourceFolder(srcDir);

const outPath = path.resolve(
  process.cwd(),
  outArg || path.join('local', '.data', 'crm-export.json')
);

const be = loadBackend();
const schema = be.context.DATABASE_SCHEMA;

/** Excel serial date -> ISO string. Excel's epoch is 1899-12-30. */
function serialToIso(n) {
  const ms = Math.round((Number(n) - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return isNaN(d.getTime()) ? String(n) : d.toISOString();
}

function normaliseCell(value) {
  if (value === undefined || value === null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value;
  return String(value);
}

/**
 * Columns whose values are timestamps. If Excel handed us a bare number for
 * one of these, it is a serial date and must be converted rather than stored
 * as a meaningless integer.
 */
const DATE_COLUMNS = new Set([
  'CreatedAt', 'UpdatedAt', 'Timestamp', 'PayoutDate', 'StartDate', 'DueDate',
  'NextFollowUp', 'PasswordUpdatedAt', 'ZohoLinkedAt', 'LockedUntil',
  'FollowUpCompletedAt', 'ExpiresAt', 'RevokedAt',
]);

const files = fs.readdirSync(resolvedDir).filter((f) => /\.xlsx$/i.test(f));
if (!files.length) {
  console.error(`\nNo .xlsx files found in ${resolvedDir}\n`);
  process.exit(1);
}

const out = {};
const skipped = [];
const summary = [];

for (const file of files.sort()) {
  const entity = path.basename(file, path.extname(file));

  if (!schema[entity]) {
    skipped.push(entity);
    continue;
  }

  const wb = XLSX.readFile(path.join(resolvedDir, file), { cellDates: true });
  const tab = wb.SheetNames.includes(entity) ? entity : wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[tab], { header: 1, blankrows: false });

  const headers = (rows[0] || []).map((h) => String(h).trim());
  const records = [];

  for (const row of rows.slice(1)) {
    const rec = {};
    let hasAnyValue = false;

    headers.forEach((header, i) => {
      if (!header) return;
      let v = normaliseCell(row[i]);
      if (typeof v === 'number' && DATE_COLUMNS.has(header)) v = serialToIso(v);
      // IDs must never be numeric — a numeric ID breaks string comparison.
      if (header === 'ID' || /Id$/.test(header)) v = v === '' ? '' : String(v);
      rec[header] = v;
      if (String(v).trim() !== '') hasAnyValue = true;
    });

    if (hasAnyValue) records.push(rec);
  }

  out[entity] = records;
  summary.push({ entity, tab, rows: records.length, columns: headers.filter(Boolean).length });
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');

console.log('\n=== DRIVE EXPORT -> JSON ===\n');
console.log(`source : ${path.resolve(srcDir)}`);
console.log(`output : ${outPath}\n`);

for (const s of summary) {
  console.log(`  ${s.entity.padEnd(16)} ${String(s.rows).padStart(5)} rows   ${s.columns} columns`);
}

if (skipped.length) {
  console.log(`\n  skipped (not part of the CRM schema): ${skipped.join(', ')}`);
  console.log('  Those sheets are left untouched and are never loaded into the CRM.');
}

const total = summary.reduce((n, s) => n + s.rows, 0);
console.log(`\n  total records: ${total}\n`);
console.log('Next:\n');
console.log(`  npm run dev:api -- --data "${path.relative(ROOT, outPath).replace(/\\/g, '/')}"`);
console.log(`  node local/scripts/data-preservation-report.mjs "${path.relative(ROOT, outPath).replace(/\\/g, '/')}"\n`);
console.log('This file contains real business data. It is written under local/.data/');
console.log('which is git-ignored — do not commit it or paste it anywhere.\n');
