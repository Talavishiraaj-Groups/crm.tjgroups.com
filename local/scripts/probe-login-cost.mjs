/**
 * Measure where login time actually goes on the deployed backend.
 *
 * Sends ONE deliberately-wrong password for a real username. That cannot
 * authenticate anything, but it does exercise the full hash — which is the
 * expensive part — so the timing is the real cost of a sign-in.
 *
 * NOTE: this counts as one failed attempt. The account locks after 8, so do
 * not run it repeatedly.
 *
 *   node local/scripts/probe-login-cost.mjs <exec-url> <username>
 */
const [url, username] = process.argv.slice(2);

if (!url || !username) {
  console.error('\n  Usage: node local/scripts/probe-login-cost.mjs <exec-url> <username>\n');
  process.exit(1);
}

async function timed(label, action, payload) {
  const started = Date.now();
  try {
    const res = await fetch(`${url}?action=${encodeURIComponent(action)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, payload }),
    });
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { code: 'NON_JSON', message: text.slice(0, 80) }; }
    console.log(
      `  ${label.padEnd(34)} ${String(Date.now() - started).padStart(6)} ms   ` +
      `${parsed.code || parsed.status}  ${(parsed.message || '').slice(0, 60)}`
    );
    return Date.now() - started;
  } catch (err) {
    console.log(`  ${label.padEnd(34)} FAILED  ${err.message}`);
    return -1;
  }
}

console.log('\n  Timing the deployed backend\n');

// A username that does not exist: rejected before any hashing. This is the
// pure request overhead — cold start, session lookup, opening the sheet.
const noHash = await timed('unknown user (no hashing)', 'login',
  { username: '__no_such_user__', password: 'irrelevant' });

// A real username with a wrong password: the hash IS computed, so the
// difference between the two is the cost of hashing.
const withHash = await timed(`real user, wrong password`, 'login',
  { username, password: '__deliberately_wrong__' });

console.log('');
if (noHash > 0 && withHash > 0) {
  console.log(`  request overhead      ~${noHash} ms`);
  console.log(`  password hashing      ~${Math.max(0, withHash - noHash)} ms`);
  console.log('');
  console.log('  A successful sign-in costs both, plus a session write.');
}
console.log('');
