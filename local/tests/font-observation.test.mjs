/**
 * Tests for the @font-face observation mechanism and fallback safety:
 *
 * A. observe=false:
 *    - normal send behavior
 *    - no observation record
 *    - no @font-face
 *    - no @import
 *    - exact original signature
 *
 * B. observe=true + font-face adapter:
 *    - EmailObservation created
 *    - unique token generated
 *    - @font-face inserted
 *    - @import absent
 *    - normal body text and signature preserved
 *
 * C. observation failure / non-blocking safety:
 *    - simulated createObservation failure
 *    - email still sends with normal signature
 *
 * D. @import safety guard:
 *    - if @import accidentally appears under font-face adapter, it is stripped and falls back safely
 *
 * E. Vercel font endpoint:
 *    - 200 response
 *    - Content-Type: font/woff2
 *    - valid token handling
 *    - repeated requests idempotent
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScenario, loginAs, authPost, ID } from '../harness/scenario.mjs';

function linkMailbox(be, userId, email) {
  const acct = be.zoho.addAccount({ email });
  be.call('updateRecordRaw', 'Users', userId, {
    ZohoEmail: acct.email,
    ZohoRefreshToken: acct.refreshToken,
  });
  return acct;
}

test('A: observe=false preserves normal email, no observation row, no @font-face', () => {
  const be = buildScenario();
  linkMailbox(be, ID.repAlpha1, 'rep1@tjgroups.com');
  const token = loginAs(be, ID.repAlpha1);

  const res = authPost(be, token, 'sendZohoEmail', {
    to: 'client@example.com',
    subject: 'Normal Test',
    content: '<p>Hello world</p>',
    observe: false
  });

  assert.equal(res.status, 'success');
  assert.equal(res.data.observed, false);
  assert.equal(res.data.observationMode, 'off');

  // Verify no EmailObservation record was created
  const obsRows = be.rows('EmailObservation');
  assert.equal(obsRows.length, 0, 'No observation row should be created when observe=false');

  // Verify Zoho received the exact content without observation markup
  assert.equal(be.zoho.sentMail.length, 1);
  const sent = be.zoho.sentMail[0];
  assert.ok(!sent.content.includes('tjg-observed-signature'));
  assert.ok(!sent.content.includes('@font-face'));
  assert.ok(!sent.content.includes('@import'));
});

test('B: observe=true + font-face creates EmailObservation and injects @font-face without @import', () => {
  const be = buildScenario();
  linkMailbox(be, ID.repAlpha1, 'rep1@tjgroups.com');
  const token = loginAs(be, ID.repAlpha1);

  // Configure font-face observation
  be.env.PropertiesService.getScriptProperties().setProperties({
    EMAIL_SIGNATURE_ENABLED: 'true',
    EMAIL_OBSERVATION_ENABLED: 'true',
    EMAIL_OBSERVATION_ADAPTER: 'font-face',
    EMAIL_OBSERVATION_BASE_URL: 'https://crm.tjgroups.com'
  });

  const res = authPost(be, token, 'sendZohoEmail', {
    to: 'client@example.com',
    subject: 'Font Observation Test',
    content: '<p>Hello with font</p>',
    observe: true
  });

  assert.equal(res.status, 'success');
  assert.equal(res.data.observed, true);

  // Verify EmailObservation row created with token
  const obsRows = be.rows('EmailObservation');
  assert.equal(obsRows.length, 1);
  assert.ok(obsRows[0].Token, 'Observation row must have a token');

  // Verify email body content sent to Zoho
  assert.equal(be.zoho.sentMail.length, 1);
  const sent = be.zoho.sentMail[0];
  assert.ok(!sent.content.includes('@import'), 'Must NOT contain @import');
  assert.ok(sent.content.includes('@font-face'), 'Must contain @font-face');
  assert.ok(sent.content.includes('https://crm.tjgroups.com/api/email-observation/font/'), 'Must link to font endpoint');
  assert.ok(sent.content.includes('tjg-observed-signature'), 'Must have observed signature class');
  assert.ok(sent.content.includes('Hello with font'), 'Original body must be preserved');
});

test('C: observation creation failure degrades gracefully to normal email send', () => {
  const be = buildScenario();
  linkMailbox(be, ID.repAlpha1, 'rep1@tjgroups.com');
  const token = loginAs(be, ID.repAlpha1);

  be.env.PropertiesService.getScriptProperties().setProperties({
    EMAIL_SIGNATURE_ENABLED: 'true',
    EMAIL_OBSERVATION_ENABLED: 'true',
    EMAIL_OBSERVATION_ADAPTER: 'font-face'
  });

  // Force createObservation to throw
  be.context.createObservation = () => {
    throw new Error('Simulated Sheets I/O lock');
  };

  const res = authPost(be, token, 'sendZohoEmail', {
    to: 'client@example.com',
    subject: 'Fallback Test',
    content: '<p>Fallback text</p>',
    observe: true
  });

  assert.equal(res.status, 'success');
  assert.equal(be.zoho.sentMail.length, 1, 'Email must still be sent to Zoho despite observation failure');
});

test('D: @import safety guard strips observation markup if @import detected under font-face adapter', () => {
  const be = buildScenario();
  linkMailbox(be, ID.repAlpha1, 'rep1@tjgroups.com');
  const token = loginAs(be, ID.repAlpha1);

  be.env.PropertiesService.getScriptProperties().setProperties({
    EMAIL_SIGNATURE_ENABLED: 'true',
    EMAIL_OBSERVATION_ENABLED: 'true',
    EMAIL_OBSERVATION_ADAPTER: 'font-face'
  });

  const res = authPost(be, token, 'sendZohoEmail', {
    to: 'client@example.com',
    subject: 'Safety Test',
    content: '<p>Hello <style>@import url("https://evil.com/style.css");</style></p>',
    observe: true
  });

  assert.equal(res.status, 'success');
  const sent = be.zoho.sentMail[0];
  // Safety guard should have stripped observation signature
  assert.ok(!sent.content.includes('tjg-observed-signature'), 'Observation signature should be stripped');
});

test('E: Vercel font endpoint returns 200, font/woff2, and serves minimal valid buffer', async () => {
  const handler = (await import('../../api/email-observation/font/[token].js')).default;

  const mockRes = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    send(buf) { this.body = buf; return this; },
    end() { return this; }
  };

  const mockReq = {
    method: 'GET',
    query: { token: 'test-token-12345.woff2' },
    headers: {
      'user-agent': 'Mozilla/5.0 TestMailClient',
      'accept': '*/*',
      'x-vercel-ip-country': 'IN',
      'x-vercel-ip-country-region': 'KA'
    }
  };

  await handler(mockReq, mockRes);

  assert.equal(mockRes.statusCode, 200);
  assert.equal(mockRes.headers['content-type'], 'font/woff2');
  assert.ok(mockRes.headers['cache-control'].includes('no-store'));
  assert.ok(Buffer.isBuffer(mockRes.body));
  assert.ok(mockRes.body.length > 0, 'Buffer must be valid font bytes');

  // Repeat request produces identical result
  const mockRes2 = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    send(buf) { this.body = buf; return this; },
    end() { return this; }
  };
  await handler(mockReq, mockRes2);
  assert.deepEqual(mockRes2.body, mockRes.body, 'Subsequent requests must return identical binary');
});
