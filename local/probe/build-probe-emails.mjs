/**
 * E-001 — build the probe messages for both CSS @import and @font-face.
 *
 *     node local/probe/build-probe-emails.mjs [--base https://crm.tjgroups.com]
 *
 * Writes into local/probe/out/:
 *   - V0-control.txt (plain text baseline)
 *   - VCSS-<target>.html (CSS @import probes)
 *   - VFONT-<target>.html (@font-face probes)
 *
 * WHAT VFONT IS TESTING
 * Whether a remote font referenced with @font-face { src: url(...) format("woff2") }
 * is fetched by target email clients at render time.
 * - No ligatures, no glyph hacks, no dynamic name generation.
 * - Normal text body.
 * - Normal text signature placeholder with fallback.
 * - Remote @font-face pointing to /api/email-observation/probe/font/<token>.woff2
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
 * V-CSS — the legacy @import candidate.
 */
function cssImportVariant(label) {
  const href = `${BASE}/api/email-observation/sig/${label}.css`;
  return `<!-- E-001 probe: ${label} (CSS @import) -->
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

/**
 * V-FONT — the @font-face candidate.
 *
 * Testing solely if the client issues an HTTP request for the font binary.
 * Normal text body, normal text signature, no ligatures, no canvas, no image.
 */
function fontFaceVariant(label) {
  const fontUrl = `${BASE}/api/email-observation/probe/font/${label}.woff2`;
  return `<!-- E-001 probe: ${label} (@font-face) -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style type="text/css">
    @font-face {
      font-family: 'TJGProbe';
      src: url('${fontUrl}') format('woff2');
      font-weight: normal;
      font-style: normal;
    }
    .tjg-probe-text {
      font-family: 'TJGProbe', Arial, Helvetica, sans-serif;
      font-size: 14px;
      color: #161616;
    }
  </style>
</head>
<body style="margin:0;padding:16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#161616;">
  <p>Hi there,</p>
  <p>This is a rendering test. Nothing needs answering.</p>

  <div style="margin-top:16px;">
    <p style="margin:0 0 8px 0;">Best regards,</p>
    <div class="tjg-probe-text">
      <strong>Dhiraj T H</strong><br>
      Founder<br>
      TJGROUPS
    </div>
  </div>
</body>
</html>
`;
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'V0-control.txt'), control(), 'utf8');

for (const label of TARGETS) {
  fs.writeFileSync(path.join(OUT, `VCSS-${label}.html`), cssImportVariant(label), 'utf8');
  fs.writeFileSync(path.join(OUT, `VFONT-${label}.html`), fontFaceVariant(label), 'utf8');
}

console.log('');
console.log('  E-001 probe messages written to local/probe/out/');
console.log(`  Probe base: ${BASE}`);
console.log('');
console.log('  V0-control.txt         send as PLAIN TEXT — must produce no request');
for (const label of TARGETS) {
  console.log(`  VFONT-${label}.html`.padEnd(34) + `send as HTML to your ${label} test account`);
}
console.log('');
