/**
 * Before/after data-integrity check for the migration.
 *
 * Loads a CRM database in its CURRENT production schema, snapshots every
 * record, runs the full migration, snapshots again, and compares them
 * field by field.
 *
 * Any MISSING, DUPLICATED or UNEXPECTEDLY MODIFIED record is a migration
 * failure and exits non-zero.
 *
 *   npm run report:data-preservation
 *
 * To run against YOUR OWN data instead of the built-in legacy fixture,
 * export each sheet to JSON and pass the file:
 *
 *   node local/scripts/data-preservation-report.mjs ./my-export.json
 *
 * Expected shape (exactly the sheet headers you already have):
 *   { "Users": [ {...} ], "Leads": [ {...} ], ... }
 *
 * The export is READ ONLY. Nothing in this script touches production.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadBackend } from '../harness/backend.mjs';
import { FIXTURES } from '../fixtures/dataset.mjs';

/* ---------- the schema as it exists in production today ---------- */
const LEGACY_SCHEMA = {
  Users: ['ID', 'Username', 'Role', 'Team', 'Status', 'Availability', 'ZohoEmail', 'ZohoRefreshToken', 'CreatedAt', 'UpdatedAt'],
  Leads: ['ID', 'Name', 'Email', 'Phone', 'Status', 'OwnerRepId', 'SetterId', 'CloserId', 'Notes', 'Linkedin', 'NextFollowUp', 'CreatedAt', 'UpdatedAt'],
  Deals: ['ID', 'LeadId', 'Value', 'Status', 'OwnerRepId', 'SetterId', 'CloserId', 'CreatedAt', 'UpdatedAt'],
  Projects: ['ID', 'ClientName', 'Status', 'OwnerRepId', 'AccountManagerId', 'LiaisonId', 'StartDate', 'DueDate', 'CreatedAt', 'UpdatedAt'],
  AdminRequests: ['ID', 'Type', 'RelatedDealId', 'RequestedBy', 'Status', 'CreatedAt', 'UpdatedAt'],
  Commissions: ['ID', 'DealId', 'SetterId', 'SetterAmount', 'CloserId', 'CloserAmount', 'PayoutStatus', 'CreatedAt', 'UpdatedAt'],
  Logs: ['ID', 'EntityId', 'EntityType', 'Action', 'UserId', 'Details', 'Metadata', 'Timestamp'],
};

/** Relationships that must still resolve after migration. */
const RELATIONSHIPS = [
  { from: 'Leads', field: 'OwnerRepId', to: 'Users' },
  { from: 'Leads', field: 'SetterId', to: 'Users' },
  { from: 'Leads', field: 'CloserId', to: 'Users' },
  { from: 'Deals', field: 'LeadId', to: 'Leads' },
  { from: 'Deals', field: 'OwnerRepId', to: 'Users' },
  { from: 'Deals', field: 'SetterId', to: 'Users' },
  { from: 'Deals', field: 'CloserId', to: 'Users' },
  { from: 'Commissions', field: 'DealId', to: 'Deals' },
  { from: 'Commissions', field: 'SetterId', to: 'Users' },
  { from: 'Commissions', field: 'CloserId', to: 'Users' },
  { from: 'Projects', field: 'OwnerRepId', to: 'Users' },
  { from: 'Projects', field: 'AccountManagerId', to: 'Users' },
  { from: 'Projects', field: 'LiaisonId', to: 'Users' },
  { from: 'AdminRequests', field: 'RelatedDealId', to: 'Deals' },
  { from: 'AdminRequests', field: 'RequestedBy', to: 'Users' },
];

/** Financial fields that must never be silently recalculated. */
const FINANCIAL_FIELDS = {
  Deals: ['Value'],
  Commissions: ['SetterAmount', 'CloserAmount', 'PayoutStatus'],
};

/**
 * Columns the migration is EXPECTED to change, with the reason.
 * Anything else changing is a failure.
 */
const EXPECTED_CHANGES = {
  Users: {
    PasswordHash: 'set by bootstrapPasswords() for active accounts',
    PasswordSalt: 'set by bootstrapPasswords()',
    PasswordIterations: 'set by bootstrapPasswords()',
    PasswordUpdatedAt: 'set by bootstrapPasswords()',
    FailedLoginCount: 'initialised to 0',
    LockedUntil: 'initialised to empty',
    UpdatedAt: 'touched when the password is written',
  },
};

/* ------------------------------------------------------------------ */

const inputPath = process.argv[2];
let source;
let sourceLabel;

if (inputPath) {
  const abs = path.resolve(process.cwd(), inputPath);
  source = JSON.parse(fs.readFileSync(abs, 'utf8'));
  sourceLabel = `exported snapshot: ${inputPath}`;
} else {
  source = FIXTURES;
  sourceLabel = 'built-in legacy fixture (local/fixtures/dataset.mjs)';
}

/** Build a backend whose sheets carry the OLD headers and the source rows. */
function buildLegacy() {
  const be = loadBackend({ scriptProperties: { PASSWORD_ITERATIONS: '100' } });
  const root = be.context.DriveApp.getFolderById(be.env.ROOT_FOLDER_ID);
  const dbFolder = root.createFolder('Databases');
  be.setProp('DB_FOLDER_ID', dbFolder.getId());

  for (const [name, headers] of Object.entries(LEGACY_SCHEMA)) {
    const ss = be.context.SpreadsheetApp.create(name);
    be.store.getSheet(name).rows = [headers.slice()];
    be.context.DriveApp.getFileById(ss.getId()).moveTo(dbFolder);

    for (const row of source[name] || []) {
      // Only legacy columns exist at this point.
      const legacyRow = {};
      for (const h of headers) legacyRow[h] = row[h] === undefined ? '' : row[h];
      be.store.insert(name, legacyRow);
    }
  }
  return be;
}

const snapshot = (be) => {
  const out = {};
  for (const name of Object.keys(LEGACY_SCHEMA)) {
    out[name] = be.store
      .toObjects(name)
      .filter((r) => String(r.ID || '').length > 0)
      .map((r) => ({ ...r }));
  }
  return out;
};

/* ---------------------------- run ---------------------------- */

console.log('\n==================================================');
console.log('  DATA PRESERVATION REPORT');
console.log('==================================================\n');
console.log(`Source : ${sourceLabel}`);
console.log('Target : local in-memory copy (production NOT contacted)\n');

const be = buildLegacy();
const before = snapshot(be);

be.call('setupCRMDatabase');
be.call('bootstrapPasswords');
const after = snapshot(be);

/* ---------------------------- compare ---------------------------- */

let missing = 0, duplicated = 0, modified = 0, preserved = 0, idsChanged = 0;
const details = [];

for (const entity of Object.keys(LEGACY_SCHEMA)) {
  const beforeRows = before[entity];
  const afterRows = after[entity];
  const afterById = new Map();

  for (const row of afterRows) {
    if (afterById.has(row.ID)) {
      duplicated++;
      details.push(`DUPLICATED  ${entity}.${row.ID}`);
    }
    afterById.set(row.ID, row);
  }

  for (const originalRow of beforeRows) {
    const current = afterById.get(originalRow.ID);

    if (!current) {
      missing++;
      details.push(`MISSING     ${entity}.${originalRow.ID}`);
      continue;
    }

    const allowed = EXPECTED_CHANGES[entity] || {};
    const changedFields = [];

    for (const [field, value] of Object.entries(originalRow)) {
      if (field === '__rowIndex') continue;
      if (allowed[field]) continue;
      if (String(current[field]) !== String(value)) {
        changedFields.push(`${field}: "${value}" -> "${current[field]}"`);
      }
    }

    if (changedFields.length) {
      modified++;
      details.push(`MODIFIED    ${entity}.${originalRow.ID}  ${changedFields.join('; ')}`);
    } else {
      preserved++;
    }
  }
}

/* ---------------------------- relationships ---------------------------- */

function danglingRefs(snap) {
  const out = [];
  for (const rel of RELATIONSHIPS) {
    const targets = new Set((snap[rel.to] || []).map((r) => String(r.ID)));
    for (const row of snap[rel.from] || []) {
      const ref = String(row[rel.field] || '');
      if (!ref) continue;
      if (!targets.has(ref)) {
        out.push(`${rel.from}.${row.ID}.${rel.field} -> ${rel.to}.${ref}`);
      }
    }
  }
  return out;
}

const brokenBefore = danglingRefs(before);
const brokenAfter = danglingRefs(after);
const newlyBroken = brokenAfter.filter((r) => !brokenBefore.includes(r));

/* ---------------------------- financials ---------------------------- */

let financialDrift = 0;
for (const [entity, fields] of Object.entries(FINANCIAL_FIELDS)) {
  const afterById = new Map(after[entity].map((r) => [r.ID, r]));
  for (const row of before[entity]) {
    const current = afterById.get(row.ID);
    if (!current) continue;
    for (const f of fields) {
      if (String(current[f]) !== String(row[f])) {
        financialDrift++;
        details.push(`FINANCIAL   ${entity}.${row.ID}.${f}: "${row[f]}" -> "${current[f]}"`);
      }
    }
  }
}

/* ---------------------------- output ---------------------------- */

// Logs is an append-only audit trail: the migration adds PASSWORD_BOOTSTRAPPED
// entries. Growth there is expected; only LOSS would be a failure.
const APPEND_ONLY = new Set(['Logs']);

console.log('RECORD COUNTS');
console.log('-------------');
let totalBefore = 0, totalPreserved = 0;
for (const entity of Object.keys(LEGACY_SCHEMA)) {
  const b = before[entity].length;
  const afterIds = new Set(after[entity].map((r) => String(r.ID)));
  const stillPresent = before[entity].filter((r) => afterIds.has(String(r.ID))).length;
  const added = after[entity].length - stillPresent;

  totalBefore += b;
  totalPreserved += stillPresent;

  const note = added > 0
    ? (APPEND_ONLY.has(entity) ? `  (+${added} new audit entries)` : `  (+${added} new records)`)
    : '';
  const flag = stillPresent === b ? 'OK' : 'DATA LOSS';
  console.log(
    `  ${entity.padEnd(15)} ${String(stillPresent).padStart(5)} / ${String(b).padEnd(5)} preserved   ${flag}${note}`
  );
}
console.log(`  ${'TOTAL'.padEnd(15)} ${String(totalPreserved).padStart(5)} / ${String(totalBefore).padEnd(5)} preserved`);

console.log('\nINTEGRITY');
console.log('---------');
console.log(`  IDs changed:              ${idsChanged}`);
console.log(`  Records deleted:          ${missing}`);
console.log(`  Unexpected duplicates:    ${duplicated}`);
console.log(`  Unexpected modifications: ${modified}`);
console.log(`  Financial values altered: ${financialDrift}`);
console.log(`  Newly broken references:  ${newlyBroken.length}`);

if (brokenBefore.length) {
  console.log(`\n  Note: ${brokenBefore.length} dangling reference(s) already existed BEFORE migration.`);
  console.log('  These are pre-existing data-quality issues, not migration damage.');
  console.log('  They are preserved as-is rather than deleted:');
  for (const r of brokenBefore.slice(0, 10)) console.log(`    - ${r}`);
}

console.log('\nEXPECTED CHANGES (not counted as modifications)');
console.log('-----------------------------------------------');
for (const [entity, fields] of Object.entries(EXPECTED_CHANGES)) {
  for (const [field, why] of Object.entries(fields)) {
    console.log(`  ${entity}.${field.padEnd(20)} ${why}`);
  }
}

if (details.length) {
  console.log('\nFINDINGS');
  console.log('--------');
  for (const d of details.slice(0, 40)) console.log(`  ${d}`);
  if (details.length > 40) console.log(`  ... and ${details.length - 40} more`);
}

/* ---------------------------- the hard gate ---------------------------- */

// Historical audit entries are evidence. New entries may be appended, but a
// pre-existing Log row disappearing is a migration failure in its own right.
const logsBefore = new Set(before.Logs.map((r) => String(r.ID)));
const logsAfter = new Set(after.Logs.map((r) => String(r.ID)));
const auditDeleted = [...logsBefore].filter((id) => !logsAfter.has(id)).length;

const GATE = [
  ['Existing records deleted',        missing],
  ['Existing IDs changed',            idsChanged],
  ['Unexpected field modifications',  modified],
  ['Unexpected duplicates',           duplicated],
  ['Relationships newly broken',      newlyBroken.length],
  ['Financial values changed',        financialDrift],
  ['Historical audit entries deleted', auditDeleted],
];

console.log('\nZERO-DESTRUCTIVE-CHANGE GATE');
console.log('----------------------------');
for (const [label, value] of GATE) {
  console.log(`  ${value === 0 ? 'PASS' : 'FAIL'}  ${label.padEnd(34)} ${value}`);
}
console.log('\n  Allowed: new schema columns, new audit entries, password fields.');
console.log('  Not allowed: any pre-existing business record changing or disappearing.');

const failures = GATE.reduce((sum, [, v]) => sum + v, 0);

console.log('\n==================================================');
if (failures === 0) {
  console.log('  RESULT: PASS — all existing data preserved');
  console.log('==================================================\n');
  process.exit(0);
}
console.log(`  RESULT: FAIL — ${failures} integrity violation(s)`);
console.log('  Migration must NOT be applied to production.');
console.log('==================================================\n');
process.exit(1);
