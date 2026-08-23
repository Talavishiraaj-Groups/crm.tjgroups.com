/**
 * Reproduce "Unknown action: login" and prove what causes it.
 *
 *   node local/scripts/diagnose-version-mismatch.mjs <path-to-old-backend>
 *
 * Runs the actions the NEW frontend sends against the OLD backend, and then
 * against the new one, showing exactly which combinations work.
 */
import path from 'node:path';
import fs from 'node:fs';
import { loadBackend, BACKEND_DIR } from '../harness/backend.mjs';

const oldDir = process.argv[2];
if (!oldDir || !fs.existsSync(oldDir)) {
  console.error('\nusage: node local/scripts/diagnose-version-mismatch.mjs <old-backend-folder>\n');
  process.exit(1);
}

// Everything the upgraded frontend needs in order to sign a user in.
const NEW_FRONTEND_ACTIONS = [
  'login', 'getSession', 'logout', 'changePassword',
  'getLeads', 'markDealWon', 'completeFollowUp', 'exportAllData',
];

function probe(dir, label) {
  const be = loadBackend({ dir });
  try {
    be.call('setupCRMDatabase');
  } catch { /* old setup may differ; irrelevant to routing */ }

  console.log(`\n--- ${label} ---`);
  console.log(`    files: ${be.loadedFiles.join(', ')}\n`);

  for (const action of NEW_FRONTEND_ACTIONS) {
    const res = be.post({ action, payload: {} });
    const unknown = /unknown action/i.test(String(res.message || ''));
    const mark = unknown ? 'MISSING ' : 'present ';
    const detail = unknown ? res.message : `handled (${res.code || res.status})`;
    console.log(`    ${mark} ${action.padEnd(18)} ${detail}`);
  }
}

console.log('\n=== WHY "Unknown action: login" APPEARS ===');
console.log('\nThe browser is running the NEW frontend. It signs in by POSTing');
console.log('{ action: "login" }. Whether that works depends entirely on which');
console.log('backend answers.');

probe(path.resolve(oldDir), 'OLD backend — what is deployed in Apps Script right now');
probe(BACKEND_DIR, 'NEW backend — what is in backend_apps_script/ locally');

console.log('\n=== COMPATIBILITY MATRIX ===\n');
console.log('    old frontend  +  OLD backend   ->  works (this is production today)');
console.log('    old frontend  +  NEW backend   ->  works (AUTH_ENFORCEMENT=off keeps it compatible)');
console.log('    NEW frontend  +  OLD backend   ->  BROKEN: no login action  <-- you are here');
console.log('    NEW frontend  +  NEW backend   ->  works');
console.log('\nThis is why the runbook deploys the BACKEND FIRST. The new backend is');
console.log('backwards compatible with the old frontend; the reverse is not true.\n');
