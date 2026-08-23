/**
 * Focused structural probe of two anomalies found in the live export.
 * Prints header names and OCCUPANCY COUNTS only — never cell values.
 */
import path from 'node:path';
import { createRequire } from 'node:module';
const XLSX = createRequire(import.meta.url)('xlsx');

const dir = process.argv[2];

function headersAndOccupancy(file, tab) {
  const wb = XLSX.readFile(path.join(dir, file));
  const sheet = wb.Sheets[tab || wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
  const headers = (rows[0] || []).map((h) => String(h).trim());
  const data = rows.slice(1);

  const occupancy = headers.map((h, i) => {
    const filled = data.filter((r) => r[i] !== undefined && String(r[i]).trim() !== '').length;
    return { column: h || `(blank col ${i + 1})`, index: i + 1, filled, of: data.length };
  });
  return { headers, rowCount: data.length, occupancy };
}

console.log('\n=== AdminRequests ===');
const ar = headersAndOccupancy('AdminRequests.xlsx', 'AdminRequests');
console.log('headers:', JSON.stringify(ar.headers));
console.log('has an "ID" column anywhere:', ar.headers.includes('ID'));
console.log('rows:', ar.rowCount);
for (const o of ar.occupancy) {
  console.log(`  col ${String(o.index).padStart(2)}  ${o.column.padEnd(22)} filled ${o.filled}/${o.of}`);
}

console.log('\n=== Users ===');
const us = headersAndOccupancy('Users.xlsx', 'Users');
console.log('headers:', JSON.stringify(us.headers));
console.log('rows:', us.rowCount);
for (const o of us.occupancy) {
  console.log(`  col ${String(o.index).padStart(2)}  ${o.column.padEnd(22)} filled ${o.filled}/${o.of}`);
}

// Is the live Password column plaintext or already hashed?
const wb = XLSX.readFile(path.join(dir, 'Users.xlsx'));
const rows = XLSX.utils.sheet_to_json(wb.Sheets['Users'], { header: 1, blankrows: false });
const hdr = rows[0].map((h) => String(h).trim());
const pwIdx = hdr.indexOf('Password');
if (pwIdx !== -1) {
  const vals = rows.slice(1).map((r) => String(r[pwIdx] ?? '')).filter((v) => v.trim() !== '');
  const lens = vals.map((v) => v.length);
  const allHex64 = vals.every((v) => /^[0-9a-f]{64}$/i.test(v));
  console.log('\n=== Password column shape (no values printed) ===');
  console.log('populated       :', vals.length, 'of', rows.length - 1);
  console.log('length range    :', lens.length ? `${Math.min(...lens)}-${Math.max(...lens)}` : 'n/a');
  console.log('looks hashed    :', allHex64 ? 'yes (64-char hex)' : 'NO — short/plain values');
  console.log('distinct values :', new Set(vals).size);
}
