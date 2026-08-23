/**
 * Refuse to ship a .gs file containing raw control bytes.
 *
 * These files are deployed by being PASTED into the Apps Script editor. A raw
 * NUL or other control byte survives Node happily — every test passes — but
 * corrupts that paste, and the resulting failure looks like a syntax error in
 * code you can see is correct.
 *
 * It is easy to introduce: writing a regex character class such as a
 * control-character range through a shell here-string emits the actual bytes
 * instead of the escape sequences. Source must contain the escapes.
 *
 *   node local/scripts/strip-control-bytes.mjs         # report only
 *   node local/scripts/strip-control-bytes.mjs --fix   # rewrite offenders
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = path.join(ROOT, 'backend_apps_script');
const FIX = process.argv.includes('--fix');

// Tab, newline and carriage return are the only control bytes source may hold.
const ALLOWED = new Set([0x09, 0x0a, 0x0d]);

let offenders = 0;

for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.gs'))) {
  const full = path.join(DIR, file);
  const buf = fs.readFileSync(full);

  const bad = [];
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b < 0x20 && !ALLOWED.has(b)) bad.push({ offset: i, byte: b });
  }

  const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;

  if (!bad.length && !hasBom) continue;
  offenders++;

  const line = (offset) => buf.subarray(0, offset).toString('utf8').split('\n').length;

  console.log(`\n  ${file}`);
  if (hasBom) console.log('      BOM at start of file — Apps Script will treat it as code');
  for (const { offset, byte } of bad) {
    console.log(
      `      line ${line(offset)}: byte 0x${byte.toString(16).padStart(2, '0')} ` +
      `at offset ${offset}`
    );
  }

  if (FIX) {
    const cleaned = Buffer.from(
      [...buf].filter((b, i) => {
        if (hasBom && i < 3) return false;
        return !(b < 0x20 && !ALLOWED.has(b));
      })
    );
    fs.writeFileSync(full, cleaned);
    console.log('      -> stripped');
  }
}

console.log('');
if (!offenders) {
  console.log('  All .gs files are clean text — safe to paste into Apps Script.\n');
  process.exit(0);
}

if (FIX) {
  console.log('  Rewritten. Re-run the test suite: stripping a byte CHANGES BEHAVIOUR');
  console.log('  if it was load-bearing, as a control-character range in a regex is.\n');
  process.exit(0);
}

console.log('  Raw control bytes will corrupt the paste into the Apps Script editor.');
console.log('  Fix the source to use escape sequences, or run with --fix.\n');
process.exit(1);
