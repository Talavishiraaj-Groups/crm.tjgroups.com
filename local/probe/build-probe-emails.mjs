/**
 * E-001 — build the probe messages.
 *
 *     node local/probe/build-probe-emails.mjs [--base https://crm.tjgroups.com]
 *
 * Writes one .html file per target client into local/probe/out/. Each carries
 * a DIFFERENT opaque label in its stylesheet URL, so the log line tells you
 * which client fetched — you are not left guessing from timing.
 *
 * WHAT THIS IS TESTING
 * Whether a remote stylesheet, referenced with @import and supplying text
 * through `content:` on a pseudo-element, is fetched by any mail client at
 * render time. No image, no pixel, no SVG, no web font, no wrapped link, no
 * script, no iframe, no AMP.
 *
 * WHAT IT IS NOT
 * Not a tracker. Not wired to the CRM. Not sent by the CRM. You paste these
 * into a mail client and send them by hand, so the experiment cannot
 * contaminate production sending.
 *
 * The visible fallback text matters: if the stylesheet is stripped — which is
 * the expected outcome for most clients — the recipient still sees a correct,
 * complete signature. A probe that renders as a blank space in someone's
 * inbox would be a bug, not an experiment.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');

const argBase = process.argv.indexOf('--base');
const BASE = argBase !== -1 && process.argv[argBase + 1]
  ? process.argv[argBase + 1].replace(/\/+$/, '')
  : 'https://crm.tjgroups.com';

/** One label per environment, so a fetch identifies its own client. */
const TARGETS = [
  'gmail-web',
  'gmail-mobile',
  'outlook-web',
  'outlook-desktop',
  'apple-mail-macos',
  'apple-mail-ios',
  'zoho-mail',
];

/**
 * V0 — control. Plain text, no remote reference of any kind.
 * If this ever produces a request, the experiment is broken, not the client.
 */
function control() {
  return [
    'Hi there,',
    '',
    'This is a rendering test with no remote content.',
    '',
    'Best regards,',
    '',
    'Dhiraj T H',
    'Founder',
    'TJGROUPS',
    '',
  ].join('\n');
}

/**
 * V-CSS — the candidate under test.
 *
 * The name appears TWICE by design: once as ordinary text that every client
 * will render, and once through the stylesheet. If the stylesheet is fetched
 * and applied, the pseudo-element content appears as well, which is a visible
 * second confirmation independent of the server log.
 */
function cssImportVariant(label) {
  const href = `${BASE}/api/email-observation/sig/${label}.css`;
  return `<!-- E-001 probe: ${label} -->
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#161616">
  <p>Hi there,</p>
  <p>This is a rendering test. Nothing needs answering.</p>

  <style>@import url("${href}");</style>

  <div style="margin-top:16px">
    <p style="margin:0 0 8px 0">Best regards,</p>
    <!-- Static fallback: correct and complete if the stylesheet never loads. -->
    <p style="margin:0">Dhiraj T H<br>Founder<br>TJGROUPS</p>
    <!-- Populated only if the remote stylesheet is fetched AND applied. -->
    <p style="margin:8px 0 0 0;color:#888">
      resolved: <span class="tjg-sig-name"></span> / <span class="tjg-sig-title"></span>
    </p>
  </div>
</div>
`;
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'V0-control.txt'), control(), 'utf8');

for (const label of TARGETS) {
  fs.writeFileSync(path.join(OUT, `VCSS-${label}.html`), cssImportVariant(label), 'utf8');
}

console.log('');
console.log('  E-001 probe messages written to local/probe/out/');
console.log(`  Stylesheet base: ${BASE}/api/email-observation/sig/<label>.css`);
console.log('');
console.log('  V0-control.txt        send as PLAIN TEXT — must produce no request');
for (const label of TARGETS) {
  console.log(`  VCSS-${label}.html`.padEnd(34) + `send as HTML to your ${label} test account`);
}
console.log('');
console.log('  Then read the Vercel function logs and fill in');
console.log('  docs/EMAIL_OBSERVATION_CLIENT_MATRIX.md.');
console.log('');
console.log('  Record REQUEST? YES/NO per client. Do not classify a request as');
console.log('  human, precheck or opened — this experiment only establishes');
console.log('  whether the mechanism executes remotely at all.');
console.log('');
