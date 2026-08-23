/**
 * Session token storage.
 *
 * The token is the only thing that grants access; the user id and role that
 * used to live in localStorage were advisory at best and forgeable at worst,
 * so nothing here is trusted for authorisation. The server re-derives
 * identity from the token on every request.
 */

const TOKEN_KEY = 'tj_crm_session_token';
const LEGACY_USER_KEY = 'tj_crm_user_id';

let inMemoryToken: string | null = null;

export function getToken(): string | null {
  if (inMemoryToken) return inMemoryToken;
  try {
    inMemoryToken = localStorage.getItem(TOKEN_KEY);
  } catch {
    inMemoryToken = null;
  }
  return inMemoryToken;
}

export function setToken(token: string | null): void {
  inMemoryToken = token;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private browsing — the in-memory copy still works for this tab */
  }
}

export function clearSession(): void {
  setToken(null);
  try {
    // Remove the legacy identity key so an old session cannot linger.
    localStorage.removeItem(LEGACY_USER_KEY);
  } catch {
    /* ignore */
  }
}

/** Subscribers are notified when the server rejects our session. */
type Listener = () => void;
const listeners = new Set<Listener>();

export function onSessionExpired(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notifySessionExpired(): void {
  clearSession();
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* a bad listener must not break the rest */
    }
  });
}
