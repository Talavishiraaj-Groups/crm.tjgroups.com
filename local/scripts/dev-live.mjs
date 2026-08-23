/**
 * Run the local frontend against the LIVE production backend.
 *
 *   npm run dev:live
 *
 * Reads VITE_API_URL from .env.env (the copy of your Vercel environment),
 * sets ALLOW_REMOTE_API so the safety guard in vite.config.ts stands aside,
 * and starts Vite.
 *
 * WHAT THIS IS
 * ------------
 * This is NOT a read-only window onto production. The local UI becomes a full
 * client of the live CRM: creating a lead creates a real lead, marking a deal
 * won writes a real commission row, deactivating a user really locks them out.
 *
 * A red banner stays on screen for the whole session so the tab can never be
 * mistaken for a sandbox.
 *
 * For a safe sandbox with a copy of the same data instead:
 *   npm run convert:drive -- "<drive-download.zip>"
 *   npm run dev:api -- --data local/.data/crm-export.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Vite only reads .env, .env.local and .env.[mode]. `.env.env` is invisible to it. */
const CANDIDATES = ['.env.env', '.env.production', '.env'];

function readApiUrl() {
  for (const name of CANDIDATES) {
    const file = path.join(ROOT, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*VITE_API_URL\s*=\s*(.+?)\s*$/);
      if (m) return { url: m[1].replace(/^["']|["']$/g, ''), source: name };
    }
  }
  return null;
}

const found = readApiUrl();

if (!found) {
  console.error('\nNo VITE_API_URL found in any of: ' + CANDIDATES.join(', ') + '\n');
  console.error('Put your production URL in one of those files, or run the local');
  console.error('sandbox instead:  npm run dev:api\n');
  process.exit(1);
}

if (/localhost|127\.0\.0\.1/.test(found.url)) {
  console.error(`\n${found.source} points at localhost, not a live backend.`);
  console.error('Use `npm run dev` for the local sandbox.\n');
  process.exit(1);
}

let host = found.url;
try {
  host = new URL(found.url).host;
} catch {
  /* keep raw */
}

console.log('');
console.log('==================================================');
console.log('  DEV SERVER -> LIVE PRODUCTION BACKEND');
console.log('==================================================');
console.log(`  source     ${found.source}`);
console.log(`  backend    ${host}`);
console.log('');
console.log('  Every write from this browser tab changes REAL data:');
console.log('    - new leads are real leads');
console.log('    - marking a deal won writes a real commission');
console.log('    - deactivating a user really locks them out');
console.log('');
console.log('  A red banner will stay on screen while this is running.');
console.log('');
console.log('  Safe alternative:  npm run dev:api -- --data local/.data/crm-export.json');
console.log('==================================================');
console.log('');

const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

const child = spawn(process.execPath, [vite], {
  cwd: ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_API_URL: found.url,
    // Explicit, deliberate opt-in past the guard in vite.config.ts.
    ALLOW_REMOTE_API: '1',
  },
});

child.on('exit', (code) => process.exit(code ?? 0));
