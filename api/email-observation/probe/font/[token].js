/**
 * Standalone E-001 Probe Endpoint for @font-face
 *
 * Listens on:
 *   /api/email-observation/probe/font/[token].js
 *
 * Responds to:
 *   GET /api/email-observation/probe/font/<token>.woff2
 *
 * Requirements:
 * 1. Accepts opaque test token (never logs PII/secrets)
 * 2. Records raw fetch metadata (timestamp, user-agent, coarse IP country/region, referer)
 * 3. Serves a valid minimal WOFF2 binary buffer
 * 4. Idempotent: returns identical response regardless of fetch count
 * 5. No cache headers (no-store, no-cache) so repeated fetches can be measured
 */

// A valid, well-formed minimal empty/dummy WOFF2 font binary (68 bytes)
// Header signature: 'wOFF' version 2 (0x774F4632)
const MINIMAL_WOFF2_BASE64 =
  'd09GMgABAAAAAALgAA8AAAAABdgAAAKRAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGiYbhVAcLgZgAGU' +
  'RCAqBAIFwCxEICoFYgW4LDQgKgUCAaAsLCAqBQIFwCwsICoFAgWALDggKgUCAcAsTCAqBQIEmCxQI' +
  'CoEAgQgLFAgKgUCA+AsVCAqBQIEACxYICoEAgSALFwgKgUCAgAsYCAqBQIBQCxwICoFAgBgLHggKg' +
  'UCAAAshAA==';

const MINIMAL_WOFF2_BUFFER = Buffer.from(MINIMAL_WOFF2_BASE64, 'base64');

export default async function handler(req, res) {
  const rawToken = String(req.query.token || '').replace(/\.woff2$/i, '').slice(0, 128);

  const fetchRecord = {
    timestamp: new Date().toISOString(),
    token: rawToken,
    ua: req.headers['user-agent'] || '',
    accept: req.headers['accept'] || '',
    referer: req.headers['referer'] || '',
    country: req.headers['x-vercel-ip-country'] || '',
    region: req.headers['x-vercel-ip-country-region'] || '',
    method: req.method,
  };

  // Structured diagnostic log in Vercel runtime logs
  console.log('PROBE_FONT_FETCH:', JSON.stringify(fetchRecord));

  // Forward to Apps Script observation ledger if configured, but never fail font delivery
  const CRM_URL = process.env.CRM_API_URL || '';
  const EDGE_SECRET = process.env.EMAIL_OBSERVATION_EDGE_SECRET || '';

  if (CRM_URL && EDGE_SECRET && rawToken) {
    try {
      await fetch(CRM_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'recordObservationFetch',
          payload: {
            token: rawToken,
            secret: EDGE_SECRET,
            ua: fetchRecord.ua,
            accept: fetchRecord.accept,
            referer: fetchRecord.referer,
            country: fetchRecord.country,
            region: fetchRecord.region,
          },
        }),
      });
    } catch (e) {
      // Non-blocking: edge must always return font cleanly
      console.warn('CRM forward failed:', e.message);
    }
  }

  // Response headers: proper WOFF2 MIME type and strictly no caching
  res.setHeader('Content-Type', 'font/woff2');
  res.setHeader('Content-Length', MINIMAL_WOFF2_BUFFER.length);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Robots-Tag', 'noindex');

  if (req.method === 'HEAD') {
    return res.status(200).end();
  }

  return res.status(200).send(MINIMAL_WOFF2_BUFFER);
}
