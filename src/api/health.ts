/**
 * Global API health signal.
 *
 * The core failure of the original client was that every page turned a
 * backend error into an empty list, so an outage was visually identical to
 * "you have no leads". Individual pages still own their own loading state,
 * but this module gives the whole app one honest, always-visible answer to
 * "did the last request actually work?" — surfaced by the banner in AppShell.
 */

import type { ApiError } from './errors';

export interface ApiHealthState {
  ok: boolean;
  lastError: ApiError | null;
  failingAction: string | null;
  since: number | null;
  consecutiveFailures: number;
}

let state: ApiHealthState = {
  ok: true,
  lastError: null,
  failingAction: null,
  since: null,
  consecutiveFailures: 0,
};

type Listener = (s: ApiHealthState) => void;
const listeners = new Set<Listener>();

function emit() {
  const snapshot = { ...state };
  listeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch {
      /* a bad subscriber must not break request handling */
    }
  });
}

export function subscribeApiHealth(fn: Listener): () => void {
  listeners.add(fn);
  fn({ ...state });
  return () => listeners.delete(fn);
}

export function getApiHealth(): ApiHealthState {
  return { ...state };
}

/**
 * Authentication failures are deliberately not treated as an outage — the
 * app redirects to the login screen for those, and a red "database down"
 * banner would be misleading.
 */
export function reportApiFailure(action: string, error: ApiError): void {
  if (error.isAuthFailure) return;

  state = {
    ok: false,
    lastError: error,
    failingAction: action,
    since: state.since ?? Date.now(),
    consecutiveFailures: state.consecutiveFailures + 1,
  };
  emit();
}

export function reportApiSuccess(_action: string): void {
  if (state.ok && state.consecutiveFailures === 0) return;
  state = { ok: true, lastError: null, failingAction: null, since: null, consecutiveFailures: 0 };
  emit();
}

export function resetApiHealth(): void {
  state = { ok: true, lastError: null, failingAction: null, since: null, consecutiveFailures: 0 };
  emit();
}
