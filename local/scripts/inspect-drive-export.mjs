/**
 * Inspect a Google Drive export of the live CRM.
 *
 *   node local/scripts/inspect-drive-export.mjs <folder-with-xlsx>
 *
 * Reports STRUCTURE ONLY — sheet names, headers, row counts, and how those
 * compare to DATABASE_SCHEMA. It deliberately does not print cell values, so
 * real customer and staff data never lands in a log or a transcript.
 *
 * Read-only. Nothing is written back to the export.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadBackend } from '../harness/backend.mjs';

// `xlsx` is CommonJS and does not expose named ESM bindings.
const XLSX = createRequire(import.meta.url)('xlsx');

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node local/scripts/inspect-drive-export.mjs <folder>');
  process.exit(1);
}

const be = loadBackend();
const schema = be.context.DATABASE_SCHEMA;

const files = fs.readdirSync(dir).filter((f) => /\.xlsx$/i.test(f));

console.log('\n=== LIVE CRM EXPORT — STRUCTURE ===\n');
console.log(`source: ${dir}`);
console.log(`workbooks: ${files.length}\n`);

const seen = new Set();
const findings = [];

for (const file of files.sort()) {
  const wb = XLSX.readFile(path.join(dir, file), { sheetRows: 2 });
  const entity = path.basename(file, path.extname(file));

  for (const tab of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[tab], { header: 1, blankrows: false });
    const headers = (rows[0] || []).map((h) => String(h).trim()).filter(Boolean);

    // Row count needs a full read; do it separately without sheetRows.
    const full = XLSX.readFile(path.join(dir, file));
    const allRows = XLSX.utils.sheet_to_json(full.Sheets[tab], { header: 1, blankrows: false });
    const dataRows = Math.max(0, allRows.length - 1);

    const expected = schema[entity];
    seen.add(entity);

    console.log(`${entity}  (tab "${tab}")`);
    console.log(`  rows      : ${dataRows}`);
    console.log(`  columns   : ${headers.length}`);
    console.log(`  first col : ${headers[0] || '(none)'}`);

    if (!expected) {
      console.log('  STATUS    : NOT IN DATABASE_SCHEMA — unmanaged sheet');
      console.log(`  headers   : ${headers.join(' | ')}`);
      findings.push({
        level: 'attention',
        text: `"${entity}" exists in Drive but is not in DATABASE_SCHEMA. ` +
              'The backend never reads or writes it.',
      });
    } else {
      const missing = expected.filter((c) => !headers.includes(c));
      const extra = headers.filter((c) => !expected.includes(c));

      // The hardened storage layer resolves ID with headers.indexOf('ID'),
      // so the column may sit anywhere. Only its ABSENCE is fatal.
      // (The original backend compared data[i][0], which is why a sheet whose
      // first column is not ID silently failed to update in production.)
      if (!headers.includes('ID')) {
        findings.push({
          level: 'blocking',
          text: `${entity}: no "ID" column at all. Records cannot be addressed.`,
        });
        console.log('  STATUS    : BLOCKING — no ID column');
      } else if (headers[0] !== 'ID') {
        findings.push({
          level: 'attention',
          text: `${entity}: "ID" is column ${headers.indexOf('ID') + 1}, not column A. ` +
                'The upgraded backend handles this (it looks ID up by name), but the ' +
                'ORIGINAL backend compared column A, so updates to this sheet have ' +
                'been silently failing in production.',
        });
        console.log(`  STATUS    : ID is column ${headers.indexOf('ID') + 1} — tolerated, see findings`);
      } else if (missing.length === 0) {
        console.log('  STATUS    : up to date');
      } else {
        console.log(`  MIGRATION : will append ${missing.length} column(s)`);
        console.log(`              ${missing.join(', ')}`);
      }

      if (extra.length) {
        console.log(`  EXTRA     : ${extra.join(', ')}  (kept, never touched)`);
        findings.push({
          level: 'note',
          text: `${entity} has column(s) not in the schema: ${extra.join(', ')}. ` +
                'These are preserved as-is.',
        });
      }
    }
    console.log('');
  }
}

const absent = Object.keys(schema).filter((s) => !seen.has(s));
if (absent.length) {
  console.log(`SHEETS THE MIGRATION WILL CREATE: ${absent.join(', ')}\n`);
}

if (findings.length) {
  console.log('=== FINDINGS ===\n');
  for (const level of ['blocking', 'attention', 'note']) {
    for (const f of findings.filter((x) => x.level === level)) {
      console.log(`  [${level.toUpperCase()}] ${f.text}`);
    }
  }
  console.log('');
}

const blocking = findings.filter((f) => f.level === 'blocking').length;
console.log(blocking === 0
  ? 'RESULT: structure is compatible with the migration.\n'
  : `RESULT: ${blocking} blocking issue(s) — do not migrate yet.\n`);
process.exit(blocking === 0 ? 0 : 1);
