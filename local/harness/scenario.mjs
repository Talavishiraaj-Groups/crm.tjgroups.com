/**
 * Scenario builder: a fully migrated, seeded, password-enabled CRM with
 * authentication enforced — i.e. the intended production end state.
 */
import { loadBackend } from './backend.mjs';
import { seedFixtures, ID } from '../fixtures/dataset.mjs';

export const PASSWORDS = {
  [ID.superAdmin]: 'SuperAdminPass1',
  [ID.adminAlpha]: 'AdminAlphaPass1',
  [ID.adminBeta]: 'AdminBetaPass1',
  [ID.repAlpha1]: 'RepAlphaOnePass1',
  [ID.repAlpha2]: 'RepAlphaTwoPass1',
  [ID.repBeta1]: 'RepBetaOnePass1',
  [ID.setterAlpha]: 'SetterAlphaPass1',
  [ID.repInactive]: 'InactivePass1',
};

/**
 * @param {object} [opts]
 * @param {'off'|'warn'|'on'} [opts.enforcement='on']
 * @param {boolean} [opts.seed=true]
 * @param {boolean} [opts.passwords=true]
 */
export function buildScenario(opts = {}) {
  const enforcement = opts.enforcement || 'on';

  const be = loadBackend({
    scriptProperties: {
      ZOHO_CLIENT_ID: 'LOCAL_TEST_CLIENT_ID',
      ZOHO_CLIENT_SECRET: 'LOCAL_TEST_CLIENT_SECRET',
      // Keep hashing cheap so the suite runs fast; production uses the default.
      PASSWORD_ITERATIONS: '100',
      ENVIRONMENT: opts.environment || 'production',
      ...(opts.scriptProperties || {}),
    },
    zoho: { clientId: 'LOCAL_TEST_CLIENT_ID', clientSecret: 'LOCAL_TEST_CLIENT_SECRET' },
  });

  be.call('setupCRMDatabase');
  if (opts.seed !== false) seedFixtures(be);

  if (opts.passwords !== false) {
    for (const [userId, pw] of Object.entries(PASSWORDS)) {
      be.call('setUserPassword', userId, pw);
    }
  }

  be.call('setAuthEnforcement', enforcement);
  return be;
}

/** Log in and return the session token. Throws on failure. */
export function loginAs(be, userId) {
  const users = be.rows('Users');
  const user = users.find((u) => u.ID === userId);
  if (!user) throw new Error(`No fixture user ${userId}`);

  const res = be.post({
    action: 'login',
    payload: { username: user.Username, password: PASSWORDS[userId] },
  });
  if (res.status !== 'success') {
    throw new Error(`login failed for ${user.Username}: ${res.code} ${res.message}`);
  }
  return res.data.token;
}

/** Authenticated POST. */
export function authPost(be, token, action, payload = {}) {
  return be.post({ action, payload, token });
}

/** Authenticated GET. */
export function authGet(be, token, action, params = {}) {
  return be.get({ action, token, ...params });
}

export { ID };
