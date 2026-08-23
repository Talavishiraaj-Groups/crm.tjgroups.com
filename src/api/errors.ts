/**
 * Structured API errors.
 *
 * The original client caught every failure and returned `[]`, which made a
 * backend outage look exactly like an empty CRM. Callers now receive a typed
 * error they can render honestly.
 */

export type ApiErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_INACTIVE'
  | 'ACCOUNT_LOCKED'
  | 'PASSWORD_NOT_SET'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'ILLEGAL_TRANSITION'
  | 'CONFLICT'
  | 'DUPLICATE'
  | 'LOCK_TIMEOUT'
  | 'STORAGE_ERROR'
  | 'EXTERNAL_ERROR'
  | 'RATE_LIMITED'
  | 'BAD_REQUEST'
  | 'UNKNOWN_ACTION'
  | 'INTERNAL'
  | 'NETWORK'
  | 'MALFORMED_RESPONSE'
  | 'NOT_CONFIGURED';

export interface FieldError {
  field: string;
  message: string;
}

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly fieldErrors: FieldError[];
  readonly retryable: boolean;
  readonly action: string;

  constructor(
    code: ApiErrorCode,
    message: string,
    opts: { fieldErrors?: FieldError[]; retryable?: boolean; action?: string } = {}
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.fieldErrors = opts.fieldErrors ?? [];
    this.retryable = opts.retryable ?? RETRYABLE.has(code);
    this.action = opts.action ?? '';
  }

  /** True when the user must sign in again. */
  get isAuthFailure(): boolean {
    return this.code === 'UNAUTHENTICATED' || this.code === 'ACCOUNT_INACTIVE';
  }

  /** Message suitable for display in the UI. */
  get displayMessage(): string {
    switch (this.code) {
      case 'NETWORK':
        return 'Cannot reach the server. Check your connection and try again.';
      case 'STORAGE_ERROR':
        return 'The CRM database is temporarily unavailable. This is not an empty list — please retry.';
      case 'NOT_CONFIGURED':
        return 'The app is not configured with a backend URL (VITE_API_URL).';
      case 'MALFORMED_RESPONSE':
        return 'The server returned an unreadable response.';
      case 'FORBIDDEN':
        return this.message || 'You do not have permission to do that.';
      case 'UNAUTHENTICATED':
        return 'Your session has ended. Please sign in again.';
      default:
        return this.message || 'Something went wrong.';
    }
  }
}

const RETRYABLE = new Set<ApiErrorCode>([
  'LOCK_TIMEOUT', 'STORAGE_ERROR', 'EXTERNAL_ERROR', 'RATE_LIMITED', 'NETWORK',
]);

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/** Normalise anything thrown during a request into an ApiError. */
export function toApiError(e: unknown, action = ''): ApiError {
  if (isApiError(e)) return e;
  const message = e instanceof Error ? e.message : String(e);
  return new ApiError('INTERNAL', message, { action });
}
