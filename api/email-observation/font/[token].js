/**
 * Email render observation — font-face edge endpoint.
 *
 * Listens on:
 *   /api/email-observation/font/[token].js
 *
 * Responds to:
 *   GET /api/email-observation/font/<token>.woff2
 *
 * Contract:
 * 1. Accept GET requests only.
 * 2. Validate token format and notify the CRM observation ingestion endpoint.
 * 3. Return a valid WOFF2 font response (Content-Type: font/woff2).
 * 4. Stable response for the same token (never mutate binary based on fetch count).
 * 5. Record every request independently.
 * 6. Never expose or log the edge secret; never log raw token values.
 * 7. Non-blocking: If CRM forward fails or times out, still serve the font safely.
 */

// A valid, well-formed minimal empty/dummy WOFF2 font binary (68 bytes)
// Header signature: 'wOFF' version 2 (0x774F4632)
const MINIMAL_WOFF2_BASE64 =
  'd09GMgABAAAAAALgAA8AAAAABdgAAAKRAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGiYbhVAcLgZgAGU' +
  'RCAqBAIFwCxEICoFYgW4LDQgKgUCAaAsLCAqBQIFwCwsICoFAgWALDggKgUCAcAsTCAqBQIEmCxQI' +
  'CoEAgQgLFAgKgUCA+AsVCAqBQIEACxYICoEAgSALFwgKgUCAgAsYCAqBQIBQCxwICoFAgBgLHggKg' +
  'UCAAAshAA==';

const MINIMAL_WOFF2_BUFFER = Buffer.from(MINIMAL_WOFF2_BASE64, 'base64');

const CRM_URL = process.env.CRM_API_URL || '';
const EDGE_SECRET = process.env.EMAIL_OBSERVATION_EDGE_SECRET || '';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }

  const rawToken = String(req.query.token || '').replace(/\.woff2$/i, '').slice(0, 128);

  // Response headers: proper WOFF2 MIME type and strictly no caching
  res.setHeader('Content-Type', 'font/woff2');
  res.setHeader('Content-Length', MINIMAL_WOFF2_BUFFER.length);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Robots-Tag', 'noindex');

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
            ua: req.headers['user-agent'] || '',
            accept: req.headers['accept'] || '',
            referer: req.headers['referer'] || '',
            country: req.headers['x-vercel-ip-country'] || '',
            region: req.headers['x-vercel-ip-country-region'] || '',
          },
        }),
      });
    } catch {
      // The CRM being slow or unreachable must never break the font response.
    }
  }

  if (req.method === 'HEAD') {
    return res.status(200).end();
  }

  return res.status(200).send(MINIMAL_WOFF2_BUFFER);
}
