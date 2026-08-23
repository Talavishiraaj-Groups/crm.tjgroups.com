/**
 * Harness smoke check: loads the real backend, runs setup, and exercises
 * one read and one write. Confirms the local adapters are faithful enough
 * for the real .gs code to run unmodified.
 */
import { loadBackend } from '../harness/backend.mjs';

const be = loadBackend();
console.log('loaded files :', be.loadedFiles.join(', '));

be.call('setupCRMDatabase');
console.log('sheets       :', be.sheets().join(', '));

const usersHeaders = be.store.getSheet('Users')?.headers || [];
console.log('Users headers:', usersHeaders.join(' | '));

const created = be.post({
  action: 'createLead',
  payload: { Name: 'Smoke Test Lead', Email: 'smoke@example.com', Status: 'New' },
});
console.log('createLead   :', created.status, created.data && created.data.ID);

const read = be.get({ action: 'getLeads' });
console.log('getLeads     :', read.status, 'count =', (read.data || []).length);

console.log('sheet ops    :', JSON.stringify(be.store.ops));
console.log('\nSMOKE OK');
