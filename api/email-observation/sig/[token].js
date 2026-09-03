/**
 * Email render observation — the public edge.
 *
 * A recipient's mail client fetches this while rendering a message. It:
 *
 *   1. reports the request to the CRM, which classifies and records it;
 *   2. serves a stylesheet resolving the sender's name through `content:`.
 *
 * That second step is the point, not a cover story. The requirement was
 * server-resolved TEXT at render time — no image, no pixel, no SVG, no web
 * font, no wrapped link, no script, no iframe, no AMP. This is the only
 * mechanism that matches it.
 *
 * WHETHER ANY MAIL CLIENT ACTUALLY FETCHES THIS IS UNMEASURED. Gmail and
 * Outlook are documented not to honour `@import` in message HTML; Apple Mail
 * is WebKit and might. Every message also carries the same signature as
 * ordinary static text, so a client that strips the stylesheet shows a
 * correct sign-off and the recipient sees nothing amiss.
 *
 * A REQUEST HERE IS NOT AN OPEN. It may be a security gateway, a content
 * proxy, a cache refresh, a second device or a forward. Classification is the
 * CRM's job; this endpoint records what it saw and nothing more.
 *
 * PRIVACY
 * No raw IP is forwarded or stored — country and region are enough to tell a
 * datacentre from an access network, and precise location would add risk for
 * no classification value. No cookies. No fingerprinting. No persistence here.
 */

const CRM_URL = process.env.CRM_API_URL || '';
const EDGE_SECRET = process.env.EMAIL_OBSERVATION_EDGE_SECRET || '';

/** Never let a name break out of the CSS string it is being placed into. */
function cssString(value) {
  return String(value == null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 120);
}

function stylesheet(lines) {
  const [name, title, org] = [lines[0] || '', lines[1] || '', lines[2] || ''];
  return [
    name && `.tjg-sig-name::before{content:"${cssString(name)}"}`,
    title && `.tjg-sig-title::before{content:"${cssString(title)}"}`,
    org && `.tjg-sig-org::before{content:"${cssString(org)}"}`,
  ].filter(Boolean).join('\n') + '\n';
}

export default async function handler(req, res) {
  const token = String(req.query.token || '').replace(/\.css$/i, '').slice(0, 128);

  // Never cached. A cached response would hide repeat fetches, and how often a
  // message is re-fetched is part of the evidence.
  res.setHeader('Content-Type', 'text/css; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex');

  let lines = [];

  if (CRM_URL && EDGE_SECRET && token) {
    try {
      const r = await fetch(CRM_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'recordObservationFetch',
          payload: {
            token,
            secret: EDGE_SECRET,
            ua: req.headers['user-agent'] || '',
            accept: req.headers['accept'] || '',
            referer: req.headers['referer'] || '',
            // Coarse by design.
            country: req.headers['x-vercel-ip-country'] || '',
            region: req.headers['x-vercel-ip-country-region'] || '',
          },
        }),
      });
      const body = await r.json();
      if (body && body.status === 'success' && Array.isArray(body.data?.lines)) {
        lines = body.data.lines;
      }
    } catch {
      // The CRM being slow or unreachable must never make a recipient's email
      // look broken. Fall through and serve an empty stylesheet: the static
      // signature in the message body is already correct on its own.
    }
  }

  res.status(200).send(lines.length ? stylesheet(lines) : '/* */\n');
}
