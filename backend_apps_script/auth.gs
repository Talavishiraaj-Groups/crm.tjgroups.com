/**
 * TJGROUPS CRM - Authentication & Session Management  [NEW FILE]
 *
 * Design constraints that shaped this file:
 *
 *  1. CORS. Apps Script web apps cannot answer a CORS preflight. The client
 *     therefore posts as text/plain and MUST NOT send custom headers. The
 *     session token travels in the JSON body (POST) or the query string
 *     (GET). Do not "improve" this into an Authorization header — it will
 *     break the deployed site.
 *
 *  2. Free-tier CPU. Apps Script allows ~90 min of execution per day, so
 *     password hashing is deliberately cheap: a per-user salt plus a
 *     server-side pepper held in Script Properties, run through a small
 *     HMAC-SHA256 loop. See HASH NOTES below for the honest trade-off.
 *
 *  3. Backwards compatibility. AUTH_ENFORCEMENT lets the backend be deployed
 *     before the new frontend without breaking the running CRM.
 */

/* ================================================================== *
 * Enforcement mode
 * ================================================================== */

/**
 * 'off'  - identity resolved if a token is supplied, but never required.
 *          Legacy unauthenticated calls still work. USE DURING ROLLOUT.
 * 'warn' - same as 'off', but every unauthenticated call is written to the
 *          audit log so you can watch for stragglers before switching on.
 * 'on'   - full enforcement. Unauthenticated calls to protected actions are
 *          rejected. THIS IS THE TARGET STATE.
 */
function getAuthEnforcement() {
  var raw = PropertiesService.getScriptProperties().getProperty('AUTH_ENFORCEMENT');

  // Tolerant of how a human types it into Script Properties: "ON", "On",
  // " on " all mean on. This value is edited by hand, and an exact-match
  // check meant a stray capital or trailing space fell through to 'off' —
  // silently leaving the API open while the person who typed it believed
  // enforcement was active. A typo must not be the difference between
  // enforced and not.
  var v = String(raw == null ? '' : raw).trim().toLowerCase();
  if (v === 'on' || v === 'warn' || v === 'off') return v;

  if (v !== '') {
    // Unrecognised is NOT silently ignored: say so, because the operator
    // clearly meant something.
    Logger.log('AUTH_ENFORCEMENT is set to "' + raw + '", which is not one of ' +
               'off/warn/on. Treating it as off.');
  }
  return 'off'; // safe default: never locks anyone out on first deploy
}

function authEnforced() {
  return getAuthEnforcement() === 'on';
}

/* ================================================================== *
 * Password hashing
 *
 * HASH NOTES
 * ----------
 * Apps Script exposes no bcrypt/scrypt/argon2, and a high-iteration PBKDF2
 * written in JS would burn the free-tier CPU budget on every login. What we
 * do instead:
 *
 *   hash = HMAC-SHA256 chain, PASSWORD_ITERATIONS rounds,
 *          key   = pepper (Script Property, NOT in the spreadsheet)
 *          input = salt + password
 *
 * The pepper is the important part for this threat model: the realistic
 * breach here is "someone gains read access to the Users spreadsheet".
 * Because the pepper lives in Script Properties rather than the sheet, a
 * leaked sheet alone yields no offline cracking target.
 *
 * This is weaker than bcrypt against an attacker who also extracts the
 * pepper. That limitation is documented in docs/SECURITY.md rather than
 * hidden here.
 * ================================================================== */

var PASSWORD_ITERATIONS_DEFAULT = 750;

function getPasswordPepper() {
  var props = PropertiesService.getScriptProperties();
  var pepper = props.getProperty('PASSWORD_PEPPER');
  if (!pepper) {
    // Generate once, on first use, so a fresh deployment is never unpeppered.
    pepper = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('PASSWORD_PEPPER', pepper);
  }
  return pepper;
}

function getPasswordIterations() {
  var v = Number(PropertiesService.getScriptProperties().getProperty('PASSWORD_ITERATIONS'));
  if (!isNaN(v) && v >= 100 && v <= 20000) return v;
  return PASSWORD_ITERATIONS_DEFAULT;
}

function bytesToHex(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
    var h = b.toString(16);
    out += h.length === 1 ? '0' + h : h;
  }
  return out;
}

/**
 * Iterated HMAC-SHA256 with a per-user salt and a server-side pepper.
 *
 * Utilities.computeHmacSha256Signature takes EITHER (String, String) OR
 * (Byte[], Byte[]). It does not take a mixture. The first round is naturally
 * string-and-string, so every subsequent round — which feeds the previous
 * digest back in — must supply the pepper as bytes too, or Apps Script
 * rejects the call outright:
 *
 *   The parameters (number[],String) don't match the method signature
 *
 * The pepper is converted once, outside the loop: doing it per round would
 * multiply the cost by the iteration count on a free-tier budget.
 */
function hashPassword(password, salt, iterations) {
  var pepper = getPasswordPepper();
  var rounds = iterations || getPasswordIterations();
  var acc = String(salt) + ':' + String(password);

  var bytes = Utilities.computeHmacSha256Signature(acc, pepper);
  if (rounds > 1) {
    var pepperBytes = Utilities.newBlob(pepper).getBytes();
    for (var i = 1; i < rounds; i++) {
      bytes = Utilities.computeHmacSha256Signature(bytes, pepperBytes);
    }
  }
  return bytesToHex(bytes);
}

function newSalt_() { return newSalt(); }

function newSalt() {
  return Utilities.getUuid().replace(/-/g, '');
}

/** Constant-time-ish comparison. JS strings leak a little, but this avoids
 *  the trivially early-exiting `===` on secret material. */
function safeEquals(a, b) {
  var x = String(a || '');
  var y = String(b || '');
  if (x.length !== y.length) return false;
  var diff = 0;
  for (var i = 0; i < x.length; i++) {
    diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  }
  return diff === 0;
}

function setUserPassword(userId, plainPassword, opts) {
  opts = opts || {};
  var check = validatePassword(plainPassword);
  if (!check.ok) {
    throw new ApiError('VALIDATION_FAILED', check.errors[0].message, check.errors);
  }
  var salt = newSalt();
  var iterations = getPasswordIterations();
  var hash = hashPassword(plainPassword, salt, iterations);
  updateRecordRaw('Users', userId, {
    PasswordHash: hash,
    PasswordSalt: salt,
    PasswordIterations: iterations,
    PasswordUpdatedAt: new Date().toISOString(),
    FailedLoginCount: 0,
    LockedUntil: '',
    // Passwords issued BY someone else (migration bootstrap, admin reset) are
    // provisional. Only a password the user chose themselves clears the flag.
    MustChangePassword: opts.mustChange ? 'TRUE' : ''
  });
  return true;
}

function verifyPassword(userRow, plainPassword) {
  if (!userRow) return false;
  var stored = String(userRow.PasswordHash || '');
  var salt = String(userRow.PasswordSalt || '');
  if (!stored || !salt) return false;
  var iterations = Number(userRow.PasswordIterations) || getPasswordIterations();
  var candidate = hashPassword(plainPassword, salt, iterations);
  return safeEquals(candidate, stored);
}

/* ================================================================== *
 * Sessions
 *
 * Source of truth: the Sessions sheet (durable, survives cache eviction).
 * Fast path: CacheService, so a normal request costs zero sheet reads.
 * ================================================================== */

var SESSION_TTL_MS_DEFAULT = 12 * 60 * 60 * 1000;   // 12 hours
var SESSION_CACHE_SECONDS = 21600;                  // 6h — CacheService max

function getSessionTtlMs() {
  var v = Number(PropertiesService.getScriptProperties().getProperty('SESSION_TTL_HOURS'));
  if (!isNaN(v) && v > 0 && v <= 720) return v * 60 * 60 * 1000;
  return SESSION_TTL_MS_DEFAULT;
}

/** Tokens are stored hashed, so a leaked Sessions sheet cannot be replayed. */
function hashToken(token) {
  return bytesToHex(
    Utilities.computeHmacSha256Signature(String(token), getPasswordPepper())
  );
}

function sessionCacheKey(tokenHash) {
  return 'sess:' + tokenHash;
}

function createSession(userRow, meta) {
  meta = meta || {};
  var token = Utilities.getUuid() + '.' + Utilities.getUuid().replace(/-/g, '');
  var tokenHash = hashToken(token);
  var now = new Date();
  var expiresAt = new Date(now.getTime() + getSessionTtlMs());

  appendRecordRaw('Sessions', {
    ID: Utilities.getUuid(),
    TokenHash: tokenHash,
    UserId: userRow.ID,
    CreatedAt: now.toISOString(),
    ExpiresAt: expiresAt.toISOString(),
    RevokedAt: '',
    UserAgent: String(meta.userAgent || '').slice(0, 200)
  });

  cacheSession(tokenHash, {
    userId: userRow.ID,
    expiresAt: expiresAt.toISOString()
  });

  return { token: token, expiresAt: expiresAt.toISOString() };
}

function cacheSession(tokenHash, obj) {
  try {
    CacheService.getScriptCache().put(
      sessionCacheKey(tokenHash), JSON.stringify(obj), SESSION_CACHE_SECONDS
    );
  } catch (e) { /* cache is an optimisation; never fatal */ }
}

function readCachedSession(tokenHash) {
  try {
    var raw = CacheService.getScriptCache().get(sessionCacheKey(tokenHash));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function dropCachedSession(tokenHash) {
  try {
    CacheService.getScriptCache().remove(sessionCacheKey(tokenHash));
  } catch (e) { /* ignore */ }
}

/**
 * Resolve a bearer token to a live user.
 * @return {object|null} the Users row, or null if the token is unusable.
 */
function resolveSession(token) {
  if (!token) return null;
  var tokenHash = hashToken(token);
  var now = new Date().getTime();

  var cached = readCachedSession(tokenHash);
  if (cached) {
    if (Date.parse(cached.expiresAt) <= now) {
      dropCachedSession(tokenHash);
      return null;
    }
    var cachedUser = getRecordByIdRaw('Users', cached.userId);
    return liveUserOrNull(cachedUser, tokenHash);
  }

  var rows = getRecordsRaw('Sessions');
  var match = null;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].TokenHash) === tokenHash) { match = rows[i]; break; }
  }
  if (!match) return null;
  if (match.RevokedAt) return null;
  if (Date.parse(match.ExpiresAt) <= now) return null;

  cacheSession(tokenHash, { userId: match.UserId, expiresAt: match.ExpiresAt });
  return liveUserOrNull(getRecordByIdRaw('Users', match.UserId), tokenHash);
}

/**
 * A session is only as valid as the account behind it. Deactivating a user
 * must take effect immediately, not at token expiry.
 */
function liveUserOrNull(userRow, tokenHash) {
  if (!userRow) return null;
  if (String(userRow.Status) !== 'Active') {
    if (tokenHash) dropCachedSession(tokenHash);
    return null;
  }
  return userRow;
}

function revokeSession(token) {
  if (!token) return false;
  var tokenHash = hashToken(token);
  dropCachedSession(tokenHash);
  var rows = getRecordsRaw('Sessions');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].TokenHash) === tokenHash && !rows[i].RevokedAt) {
      updateRecordRaw('Sessions', rows[i].ID, { RevokedAt: new Date().toISOString() });
      return true;
    }
  }
  return false;
}

/** Revoke every session for a user — used on deactivation and role change. */
/**
 * End this user's sessions.
 *
 * @param {string} userId
 * @param {string} [keepTokenHash] leave this one session alive
 *
 * Changing a password should sign out everyone ELSE holding the old
 * credentials — that is the point of doing it. Signing out the person who
 * just made the change is not security, it is a papercut: they proved they
 * knew the current password one line earlier. Doing it anyway dumped them at
 * a login screen with no explanation, which reads as "the change failed".
 */
function revokeAllSessionsForUser(userId, keepTokenHash) {
  var rows = getRecordsRaw('Sessions');
  var count = 0;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].UserId) !== String(userId)) continue;
    if (rows[i].RevokedAt) continue;
    if (keepTokenHash && String(rows[i].TokenHash) === String(keepTokenHash)) continue;

    updateRecordRaw('Sessions', rows[i].ID, { RevokedAt: new Date().toISOString() });
    dropCachedSession(String(rows[i].TokenHash));
    count++;
  }
  return count;
}

/** Housekeeping: drop expired rows so the sheet does not grow without bound. */
function pruneExpiredSessions() {
  var sheet = getSheetByName('Sessions');
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return 0;
  var headers = data[0];
  var expIdx = headers.indexOf('ExpiresAt');
  var now = new Date().getTime();
  var removed = 0;
  for (var i = data.length - 1; i >= 1; i--) {
    var exp = Date.parse(data[i][expIdx]);
    if (!isNaN(exp) && exp < now - 7 * 24 * 60 * 60 * 1000) {
      sheet.deleteRow(i + 1);
      removed++;
    }
  }
  return removed;
}

/* ================================================================== *
 * Login / logout
 * ================================================================== */

var MAX_FAILED_LOGINS = 8;
var LOCKOUT_MS = 15 * 60 * 1000;

/**
 * Verify credentials and mint a session.
 *
 * Deliberately uniform failure messaging: the same message for "no such
 * user" and "wrong password", so the endpoint cannot be used to enumerate
 * usernames.
 */
function login(payload, meta) {
  payload = payload || {};
  var username = String(payload.username || '').trim();
  var password = String(payload.password || '');

  if (!username || !password) {
    throw new ApiError('INVALID_CREDENTIALS', 'Username and password are required.');
  }

  var lock = LockService.getScriptLock();
  var haveLock = lock.tryLock(10000);

  try {
    var users = getRecordsRaw('Users');
    var user = null;
    for (var i = 0; i < users.length; i++) {
      if (String(users[i].Username).toLowerCase() === username.toLowerCase()) {
        user = users[i];
        break;
      }
    }

    if (!user) {
      throw new ApiError('INVALID_CREDENTIALS', 'Invalid username or password.');
    }

    if (String(user.Status) !== 'Active') {
      auditLog({
        entityId: user.ID, entityType: 'User', action: 'LOGIN_DENIED_INACTIVE',
        userId: user.ID, details: 'Login attempt on a non-active account.'
      });
      throw new ApiError('ACCOUNT_INACTIVE', 'This account is not active.');
    }

    var lockedUntil = user.LockedUntil ? Date.parse(user.LockedUntil) : 0;
    if (lockedUntil && lockedUntil > new Date().getTime()) {
      throw new ApiError('ACCOUNT_LOCKED',
        'Too many failed attempts. Try again later.');
    }

    // No password set yet (legacy account mid-migration).
    if (!user.PasswordHash) {
      auditLog({
        entityId: user.ID, entityType: 'User', action: 'LOGIN_DENIED_NO_PASSWORD',
        userId: user.ID, details: 'Account has no password set.'
      });
      throw new ApiError('PASSWORD_NOT_SET',
        'No password is set for this account. Ask an administrator to set one.');
    }

    if (!verifyPassword(user, password)) {
      var failed = Number(user.FailedLoginCount || 0) + 1;
      var patch = { FailedLoginCount: failed };
      if (failed >= MAX_FAILED_LOGINS) {
        patch.LockedUntil = new Date(new Date().getTime() + LOCKOUT_MS).toISOString();
        patch.FailedLoginCount = 0;
      }
      updateRecordRaw('Users', user.ID, patch);
      auditLog({
        entityId: user.ID, entityType: 'User', action: 'LOGIN_FAILED',
        userId: user.ID, details: 'Failed attempt ' + failed + '.'
      });
      throw new ApiError('INVALID_CREDENTIALS', 'Invalid username or password.');
    }

    if (Number(user.FailedLoginCount || 0) > 0 || user.LockedUntil) {
      updateRecordRaw('Users', user.ID, { FailedLoginCount: 0, LockedUntil: '' });
    }

    // Re-hash at the CURRENT cost setting, now, while we still have the
    // plaintext.
    //
    // Each hash stores the iteration count it was made with, so lowering
    // PASSWORD_ITERATIONS does nothing for accounts hashed at the old cost —
    // they keep paying it on every sign-in, forever. And the plaintext only
    // exists for this instant, so this is the one moment it can be fixed
    // without asking anyone to change their password.
    //
    // The user pays the old cost once more, then every later sign-in is fast.
    var storedRounds = Number(user.PasswordIterations || 0);
    var wantRounds = getPasswordIterations();
    if (storedRounds && storedRounds !== wantRounds) {
      try {
        var newSalt = newSalt_();
        updateRecordRaw('Users', user.ID, {
          PasswordHash: hashPassword(password, newSalt, wantRounds),
          PasswordSalt: newSalt,
          PasswordIterations: wantRounds,
          PasswordUpdatedAt: new Date().toISOString()
        });
      } catch (e) {
        // Never fail a valid sign-in over an optimisation.
        Logger.log('Could not re-hash password at the new cost: ' + e.message);
      }
    }

    var session = createSession(user, meta);

    auditLog({
      entityId: user.ID, entityType: 'User', action: 'LOGIN',
      userId: user.ID, details: 'Successful login.'
    });

    var fresh = getRecordByIdRaw('Users', user.ID);
    return {
      token: session.token,
      expiresAt: session.expiresAt,
      mustChangePassword: isTrueFlag(fresh.MustChangePassword),
      user: publicUser(fresh)
    };
  } finally {
    if (haveLock) lock.releaseLock();
  }
}

function logout(token, actor) {
  var revoked = revokeSession(token);
  if (actor) {
    auditLog({
      entityId: actor.ID, entityType: 'User', action: 'LOGOUT',
      userId: actor.ID, details: 'Session ended.'
    });
  }
  return { revoked: revoked };
}

/** Self-service password change. Requires the current password. */
function changePassword(actor, payload) {
  payload = payload || {};
  var current = String(payload.currentPassword || '');
  var next = String(payload.newPassword || '');

  var row = getRecordByIdRaw('Users', actor.ID);
  if (!row) throw new ApiError('NOT_FOUND', 'User not found.');

  if (row.PasswordHash && !verifyPassword(row, current)) {
    throw new ApiError('INVALID_CREDENTIALS', 'Current password is incorrect.');
  }

  setUserPassword(actor.ID, next, { mustChange: false });

  // Every OTHER session goes — anyone still signed in with the old password
  // loses access, which is the reason to change it. The caller's own session
  // survives, so they carry on working instead of being bounced to a login
  // screen that makes a successful change look like a failure.
  var revoked = revokeAllSessionsForUser(actor.ID, actor.sessionTokenHash || null);

  auditLog({
    entityId: actor.ID, entityType: 'User', action: 'PASSWORD_CHANGED',
    userId: actor.ID,
    details: 'Password changed; ' + revoked + ' other session(s) revoked.'
  });

  return { ok: true, sessionsRevoked: revoked, sessionKept: true };
}

/* ================================================================== *
 * Request identity
 * ================================================================== */

/**
 * Establish who is calling.
 *
 * The token is read from the request body or query string only. A client
 * supplied userId/role is NEVER trusted — that was the original defect.
 *
 * @return {{actor:object|null, token:string|null, authenticated:boolean}}
 */
function resolveActor(request) {
  var token = request.token || null;
  if (!token) return { actor: null, token: null, authenticated: false };

  var userRow = resolveSession(token);
  if (!userRow) return { actor: null, token: token, authenticated: false };

  return {
    actor: {
      ID: userRow.ID,
      id: userRow.ID,
      Username: userRow.Username,
      role: userRow.Role,
      Role: userRow.Role,
      team: userRow.Team,
      Team: userRow.Team,
      Status: userRow.Status,
      // Identifies THIS session, so an operation that ends the user's other
      // sessions can spare the one making the request. Derived server-side
      // from the presented token; never accepted from a payload.
      sessionTokenHash: hashToken(token)
    },
    token: token,
    authenticated: true
  };
}

/**
 * Gate an action. Throws ApiError on refusal.
 *
 * In 'off'/'warn' mode an unauthenticated caller is allowed through with a
 * null actor so the existing frontend keeps working during rollout; in
 * 'warn' mode the event is recorded so you can confirm nothing legitimate
 * is still calling anonymously before flipping to 'on'.
 */
function authoriseAction(action, identity) {
  if (isPublicAction(action)) return { actor: identity.actor, enforced: false };

  var mode = getAuthEnforcement();

  if (!identity.authenticated) {
    if (mode === 'on') {
      throw new ApiError('UNAUTHENTICATED',
        identity.token ? 'Session expired or invalid. Please sign in again.'
                       : 'Authentication required.');
    }
    if (mode === 'warn') {
      try {
        auditLog({
          entityId: 'SYSTEM', entityType: 'System', action: 'UNAUTHENTICATED_CALL',
          userId: 'ANONYMOUS', details: 'Action ' + action + ' called without a session.'
        });
      } catch (e) { /* never block on audit */ }
    }
    return { actor: null, enforced: false };
  }

  var verdict = roleMayCallAction(identity.actor.role, action);
  if (!verdict.allowed) {
    auditLog({
      entityId: identity.actor.ID, entityType: 'User', action: 'AUTHZ_DENIED',
      userId: identity.actor.ID, details: action + ': ' + verdict.reason
    });
    throw new ApiError('FORBIDDEN', verdict.reason);
  }

  return { actor: identity.actor, enforced: true };
}
