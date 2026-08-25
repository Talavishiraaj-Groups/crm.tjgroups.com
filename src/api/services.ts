import {
  Lead, Deal, Project, AdminRequest, Log, User, Commission,
  UserRole, DealStatus, ProjectStatus, ZohoEmailItem, EmailDraft,
  EmailAnalytics, UnmatchedEmails
} from '../types';
import { ApiError, toApiError, type ApiErrorCode, type FieldError } from './errors';
import { getToken, setToken, notifySessionExpired } from './session';
import { reportApiFailure, reportApiSuccess } from './health';

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

/**
 * Transport note
 * --------------
 * Apps Script web apps cannot answer a CORS preflight, so requests must stay
 * "simple": text/plain content type and NO custom headers. The session token
 * therefore travels inside the JSON body (POST) or the query string (GET).
 * Adding an Authorization header here would trigger a preflight and break
 * the deployed site.
 */

interface ApiEnvelope<T> {
  status: 'success' | 'error';
  data?: T;
  message?: string;
  code?: ApiErrorCode;
  errors?: FieldError[] | null;
  retryable?: boolean;
  requestId?: string;
}

/**
 * Reads that are safe to send again if a response is lost in transit.
 *
 * Deliberately not "anything that failed": a write whose response never
 * arrived may well have been applied, so retrying `createLead` risks a second
 * lead, a second commission, a second payout. Everything admitted here only
 * reads.
 */
function isSafeToRetry(action: string): boolean {
  return action === 'batch' || /^get/.test(action);
}

/**
 * Whether this user's Zoho mailbox needs reconnecting.
 *
 * Latched for the session once the backend reports it, and cleared the moment
 * they link the mailbox again. Deliberately in memory rather than storage: a
 * reload should re-test, because by then they may have fixed it elsewhere.
 */
let zohoNeedsReauth = false;
let zohoReauthMessage =
  'Your Zoho Mail connection has expired. Reconnect your mailbox from the dashboard.';

/** Call after a successful (re)link so mail is attempted again. */
export function clearZohoReauthFlag(): void {
  zohoNeedsReauth = false;
}

function fetchAPI<T = SheetRow>(
  action: string,
  method: 'GET' | 'POST' = 'GET',
  payload?: unknown,
  params: Record<string, string> = {},
  attempt = 0
): Promise<T> {
  return doFetch<T>(action, method, payload, params, attempt);
}

async function doFetch<T = SheetRow>(
  action: string,
  method: 'GET' | 'POST' = 'GET',
  payload?: unknown,
  params: Record<string, string> = {},
  attempt = 0
): Promise<T> {
  if (!API_URL) {
    throw new ApiError('NOT_CONFIGURED', 'VITE_API_URL is not set.', { action });
  }

  const token = getToken();

  let res: Response;
  try {
    if (method === 'POST') {
      const body: Record<string, unknown> = { action, payload: payload ?? {} };
      if (token) body.token = token;

      // The action goes in the BODY ONLY. Do not "helpfully" add it to the
      // query string as well.
      //
      // Apps Script answers a POST with a 302, and a client following that
      // redirect re-issues it as a GET with no body. With the action absent
      // from the URL, that lands on `doGet` and fails loudly with "Missing
      // action parameter" — annoying, but unmistakable, and the retry below
      // handles it.
      //
      // Put the action in the URL and the GET path RUNS instead: it rebuilds
      // the payload from the query string, which carries no credentials and
      // no parameters, so `login` executes with an empty payload and reports
      // "Username and password are required". A loud transport failure
      // becomes a silent wrong answer. That is strictly worse.
      res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
      });
    } else {
      const url = new URL(API_URL);
      url.searchParams.set('action', action);
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      });
      if (token) url.searchParams.set('token', token);
      res = await fetch(url.toString(), { method: 'GET' });
    }
  } catch {
    // The browser gives no useful detail for a failed fetch (CORS, DNS and
    // offline all look identical), so the cause is deliberately not surfaced.
    //
    // Retry reads for the same reason as an unreadable response: a dropped
    // connection to Apps Script is usually transient, and the alternative is
    // telling the user the backend is unreachable when the next attempt would
    // have worked.
    if (isSafeToRetry(action) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      return doFetch<T>(action, method, payload, params, attempt + 1);
    }
    const err = new ApiError('NETWORK', 'Network request failed.', { action });
    reportApiFailure(action, err);
    throw err;
  }

  const text = await res.text();

  let json: ApiEnvelope<T>;
  try {
    json = JSON.parse(text);
  } catch {
    // Apps Script returns an HTML error page when a deployment is broken or
    // the URL is wrong — surface that instead of pretending there is no data.
    //
    // The response text used to be discarded, which left "unreadable response"
    // as the entire evidence and made the cause guesswork. Apps Script's
    // failures are distinguishable from their body, so classify it and log the
    // start of what actually arrived.
    const head = text.slice(0, 400);
    let why = 'The response was not JSON.';
    if (res.status === 404) {
      // Apps Script answers with a 302 to a short-lived googleusercontent
      // "user_content_key" URL. The Executions log shows doPost/doGet
      // completing normally in a few seconds, so the script is fine — the key
      // has simply expired by the time the browser follows the redirect.
      // Retrying is the correct response, not investigating the backend.
      why = 'The reply was ready but expired before the browser could collect ' +
            'it. The server did the work; only the hand-off was lost.';
    } else if (!text.trim()) {
      why = 'The server sent an empty response — usually an execution that ' +
            'timed out or was cut off part-way.';
    } else if (/exceeded maximum execution time/i.test(text)) {
      why = 'The script exceeded its execution time limit.';
    } else if (/invoked too many times|quota|rate/i.test(text)) {
      why = 'An Apps Script quota or rate limit was hit.';
    } else if (/<html|<!doctype/i.test(text)) {
      why = 'The server returned an HTML page instead of data — usually a ' +
            'broken deployment, a wrong URL, or a sign-in redirect.';
    } else if (text.length > 1000) {
      why = 'The response looks truncated — it may have exceeded the ' +
            'maximum size Apps Script can return.';
    }

    console.error(
      `[api] ${action}: unreadable response (${text.length} bytes). ${why}\n` +
      `[api] first 400 bytes: ${head}`
    );

    // A lost response is usually transient — an execution cut short under
    // contention. Reading again costs one round trip and spares the user an
    // error banner for something that works on the next attempt, which is
    // exactly what navigating away and back was doing by hand.
    if (isSafeToRetry(action) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      return doFetch<T>(action, method, payload, params, attempt + 1);
    }

    const err = new ApiError(
      'MALFORMED_RESPONSE',
      `${action}: ${why}`,
      { action }
    );
    reportApiFailure(action, err);
    throw err;
  }

  if (json.status !== 'success') {
    // "Missing action parameter" is not something a caller can cause — this
    // function always sends one. It means the request reached the script
    // stripped of its action, which happens when Apps Script's redirect is
    // followed as a bare GET. Retry once rather than reporting a fault the
    // user cannot act on.
    const lostInTransit =
      json.code === 'BAD_REQUEST' &&
      /missing action parameter/i.test(json.message || '');

    if (lostInTransit && attempt === 0) {
      return fetchAPI<T>(action, method, payload, params, attempt + 1);
    }

    const err = new ApiError(
      (json.code as ApiErrorCode) || 'INTERNAL',
      json.message || `Request failed: ${action}`,
      { fieldErrors: json.errors ?? [], retryable: json.retryable, action }
    );
    if (err.isAuthFailure) notifySessionExpired();
    reportApiFailure(action, err);
    throw err;
  }

  reportApiSuccess(action);
  return json.data as T;
}

/* ------------------------------------------------------------------ *
 * Batched reads
 *
 * Each Apps Script invocation carries a fixed cost of a second or more on the
 * free tier, regardless of how little work it does. A page that made six
 * requests paid that six times over. `batch` runs them in one execution.
 *
 * Sub-requests fail independently: a page renders what it could load rather
 * than blanking because one read failed.
 * ------------------------------------------------------------------ */

interface BatchResult<T = unknown> {
  key: string;
  status: 'success' | 'error';
  data?: T;
  code?: ApiErrorCode;
  message?: string;
}

/**
 * Run several reads in one round trip.
 *
 * Returns a lookup keyed by request key. `get` returns the fallback when that
 * sub-request failed, so callers handle a partial page the same way they
 * handle an empty one.
 */
async function batchRead(
  requests: { key: string; action: string; payload?: unknown }[]
): Promise<{
  get<T>(key: string, fallback: T): T;
  failed(key: string): boolean;
  errorFor(key: string): string | null;
}> {
  let results: BatchResult[];

  try {
    const res = await fetchAPI<{ results: BatchResult[] }>('batch', 'POST', { requests });
    results = res.results;
  } catch (err) {
    // A backend that does not know `batch` is an OLDER backend — the frontend
    // was deployed ahead of it. Without this every page renders empty and the
    // banner blames the data rather than the mismatch.
    //
    // Fall back to issuing the reads individually. Slower, which is the whole
    // reason batch exists, but the app works while the backend catches up.
    const code = err instanceof ApiError ? err.code : undefined;
    const recoverable = code === 'UNKNOWN_ACTION' || code === 'BAD_REQUEST' ||
                        code === 'NOT_FOUND';
    if (!recoverable) throw err;

    console.warn(
      'The backend did not accept a batched read, so it is older than this ' +
      'frontend. Falling back to individual requests — deploy the Apps Script ' +
      'backend to restore normal speed.'
    );

    results = await Promise.all(requests.map(async (r): Promise<BatchResult> => {
      try {
        const data = await fetchAPI(r.action, 'POST', r.payload ?? {});
        return { key: r.key, status: 'success', data };
      } catch (subErr) {
        const e = subErr instanceof ApiError ? subErr : toApiError(subErr);
        return { key: r.key, status: 'error', code: e.code, message: e.message };
      }
    }));
  }

  const byKey = new Map(results.map((r) => [r.key, r]));

  // The batch itself succeeded, so fetchAPI already reported the transport as
  // healthy. A sub-request that failed is still a failure the user should see:
  // without this, a page that silently lost half its data would show a clean
  // banner, which is exactly the "empty list looks like no data" problem the
  // health signal exists to prevent.
  //
  // NOT_FOUND is excluded — asking for a record that does not exist is a
  // normal answer, not an outage.
  const broken = results.find(
    (r) => r.status === 'error' && r.code !== 'NOT_FOUND' && r.code !== 'FORBIDDEN'
  );
  if (broken) {
    reportApiFailure(
      `batch:${broken.key}`,
      toApiError(new ApiError(broken.code ?? 'INTERNAL', broken.message ?? 'Request failed.'))
    );
  }

  return {
    get<T>(key: string, fallback: T): T {
      const r = byKey.get(key);
      return r && r.status === 'success' && r.data !== undefined ? (r.data as T) : fallback;
    },
    failed(key: string): boolean {
      const r = byKey.get(key);
      return !r || r.status === 'error';
    },
    errorFor(key: string): string | null {
      const r = byKey.get(key);
      return r && r.status === 'error' ? (r.message ?? 'Request failed.') : null;
    },
  };
}

/* ------------------------------------------------------------------ *
 * Mappers
 *
 * Rows arrive as untyped JSON objects keyed by the Google Sheets header
 * name, so `SheetRow` is the honest input type. Each mapper narrows one of
 * those into a domain object, coercing through str()/num() rather than
 * trusting the wire shape.
 * ------------------------------------------------------------------ */

type SheetRow = Record<string, unknown>;

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function toLead(r: SheetRow): Lead {
  return {
    id: str(r.ID), name: str(r.Name) || 'Unknown', email: str(r.Email), phone: str(r.Phone),
    linkedin: str(r.Linkedin),
    setterId: str(r.SetterId), closerId: str(r.CloserId),
    status: (str(r.Status) || 'New') as Lead['status'],
    ownerRepId: str(r.OwnerRepId), notes: str(r.Notes),
    createdAt: str(r.CreatedAt), updatedAt: str(r.UpdatedAt),
    nextFollowUp: str(r.NextFollowUp),
    followUpStatus: str(r.FollowUpStatus),
    followUpCompletedAt: str(r.FollowUpCompletedAt),
    followUpDelayReason: str(r.FollowUpDelayReason),
    followUpDelayReasonAt: str(r.FollowUpDelayReasonAt),
    followUpDelayReasonBy: str(r.FollowUpDelayReasonBy),
    researchFindings: str(r.ResearchFindings),
    qualificationReason: str(r.QualificationReason),
    researchSource: str(r.ResearchSource),
    researchUpdatedAt: str(r.ResearchUpdatedAt),
    researchUpdatedBy: str(r.ResearchUpdatedBy),
  };
}

function toDeal(r: SheetRow): Deal {
  return {
    id: str(r.ID), leadId: str(r.LeadId), clientName: str(r.ClientName),
    value: num(r.Value), status: (str(r.Status) || 'Open') as DealStatus,
    ownerRepId: str(r.OwnerRepId), setterId: str(r.SetterId), closerId: str(r.CloserId),
    createdAt: str(r.CreatedAt), updatedAt: str(r.UpdatedAt),
  };
}

function toProject(r: SheetRow): Project {
  let status = str(r.Status) || 'Onboarding';
  if (status === 'In Progress') status = 'InProgress';
  return {
    id: str(r.ID), dealId: str(r.DealId), clientName: str(r.ClientName) || 'Unknown',
    status: status as ProjectStatus, ownerRepId: str(r.OwnerRepId),
    accountManagerId: str(r.AccountManagerId), liaisonId: str(r.LiaisonId),
    startDate: str(r.StartDate), dueDate: str(r.DueDate), notes: str(r.Notes),
  };
}

function toUser(r: SheetRow): User {
  return {
    id: str(r.ID), username: str(r.Username) || 'Unknown',
    role: (str(r.Role) || 'SALES_REP') as UserRole,
    team: str(r.Team),
    status: (str(r.Status) || 'Inactive') as User['status'],
    availability: (str(r.Availability) || 'Offline') as User['availability'],
    zohoEmail: str(r.ZohoEmail),
    // The backend no longer returns refresh tokens; it returns link state.
    zohoLinked: Boolean(r.ZohoLinked),
    hasPassword: Boolean(r.HasPassword),
    mustChangePassword: Boolean(r.MustChangePassword),
  };
}

function toDraft(r: SheetRow): EmailDraft {
  return {
    id: str(r.ID), leadId: str(r.LeadId), userId: str(r.UserId),
    toAddress: str(r.ToAddress), subject: str(r.Subject), content: str(r.Content),
    createdAt: str(r.CreatedAt), updatedAt: str(r.UpdatedAt), sentAt: str(r.SentAt),
  };
}

/**
 * An EmailLog row rendered in the same shape as a live Zoho message, so the
 * viewer does not need to know where a message came from. `stored` marks it
 * as an archive copy — envelope plus summary, not the full body.
 */
function toStoredEmail(r: SheetRow): ZohoEmailItem {
  const summary = str(r.Summary);
  return {
    id: str(r.ID) || str(r.MessageId),
    messageId: str(r.MessageId),
    subject: str(r.Subject) || '(No Subject)',
    summary,
    content: summary,
    sender: str(r.Sender),
    toAddress: str(r.ToAddress),
    direction: str(r.Direction) === 'in' ? 'in' : 'out',
    timestamp: str(r.SentAt) || str(r.SyncedAt),
    stored: true,
  };
}

function toCommission(r: SheetRow): Commission {
  return {
    id: str(r.ID), dealId: str(r.DealId),
    setterId: str(r.SetterId), setterCommissionAmount: num(r.SetterAmount),
    closerId: str(r.CloserId), closerCommissionAmount: num(r.CloserAmount),
    payoutStatus: (str(r.PayoutStatus) || 'Pending') as Commission['payoutStatus'],
    payoutDate: str(r.PayoutDate) || undefined,
  };
}

function toRequest(r: SheetRow): AdminRequest {
  return {
    id: str(r.ID), type: (str(r.Type) || 'payment') as AdminRequest['type'],
    relatedDealId: str(r.RelatedDealId), requestedBy: str(r.RequestedBy),
    status: (str(r.Status) || 'Pending') as AdminRequest['status'],
    createdAt: str(r.CreatedAt), updatedAt: str(r.UpdatedAt),
    notes: str(r.Notes), paymentLink: str(r.PaymentLink), documentUrl: str(r.DocumentUrl),
  };
}

function toLog(r: SheetRow): Log {
  return {
    id: str(r.ID), entityId: str(r.EntityId),
    entityType: (str(r.EntityType) || 'Lead') as Log['entityType'],
    action: str(r.Action) || 'LOG', userId: str(r.UserId),
    details: str(r.Details), timestamp: str(r.Timestamp),
  };
}

const asArray = (d: unknown): SheetRow[] => (Array.isArray(d) ? (d as SheetRow[]) : []);

/* ------------------------------------------------------------------ *
 * API
 *
 * Read helpers keep their original (role, userId) signatures so existing
 * call sites compile unchanged — but those arguments are no longer used for
 * filtering. Scoping is enforced server-side, from the session, because a
 * value supplied by the browser can be edited by the browser.
 * ------------------------------------------------------------------ */

export const api = {
  /**
   * One request carrying several reads. Use it wherever a screen needs more
   * than two things at once — on the deployed backend the per-request cost
   * dwarfs the work, so the request count is what the user actually feels.
   */
  batch: batchRead,

  /** Row mappers, so batched callers can narrow what comes back. */
  map: { lead: toLead, deal: toDeal, project: toProject, user: toUser, log: toLog,
         commission: toCommission, adminRequest: toRequest, storedEmail: toStoredEmail },

  auth: {
    login: async (username: string, password: string): Promise<{ user: User; expiresAt: string }> => {
      const data = await fetchAPI<{ token: string; expiresAt: string; user: SheetRow }>(
        'login', 'POST', { username, password }
      );
      setToken(data.token);
      return { user: toUser(data.user), expiresAt: data.expiresAt };
    },

    logout: async (): Promise<void> => {
      try {
        await fetchAPI('logout', 'POST', {});
      } finally {
        setToken(null);
      }
    },

    /** Restore a session on page load. Returns null when the token is dead. */
    getSession: async (): Promise<User | null> => {
      if (!getToken()) return null;
      try {
        const data = await fetchAPI<{ user: SheetRow }>('getSession', 'POST', {});
        return toUser(data.user);
      } catch (e) {
        if (e instanceof ApiError && e.isAuthFailure) {
          setToken(null);
          return null;
        }
        throw e;
      }
    },

    changePassword: async (currentPassword: string, newPassword: string): Promise<void> => {
      await fetchAPI('changePassword', 'POST', { currentPassword, newPassword });
    },
  },

  leads: {
    getAll: async (_role?: UserRole, _userId?: string): Promise<Lead[]> => {
      const data = await fetchAPI('getLeads');
      return asArray(data).map(toLead);
    },
    getById: async (id: string): Promise<Lead | undefined> => {
      const data = await fetchAPI('getLeadById', 'GET', null, { id });
      return data ? toLead(data) : undefined;
    },
    create: async (payload: Partial<Lead>): Promise<Lead> => {
      const res = await fetchAPI('createLead', 'POST', {
        Name: payload.name, Email: payload.email, Phone: payload.phone,
        Linkedin: payload.linkedin, Status: payload.status,
        OwnerRepId: payload.ownerRepId, Notes: payload.notes,
        SetterId: payload.setterId, CloserId: payload.closerId,
      });
      return toLead(res);
    },
    update: async (
      id: string,
      payload: Partial<Lead>,
      /**
       * Required by the server when moving a follow-up that has been overdue
       * for more than a day. Not part of Lead: it explains one edit, it is not
       * a property of the record, and the server writes the stored copy.
       */
      opts: { delayReason?: string } = {}
    ): Promise<void> => {
      const body: Record<string, unknown> = { id };
      if (opts.delayReason) body.delayReason = opts.delayReason;
      if (payload.status !== undefined) body.Status = payload.status;
      if (payload.notes !== undefined) body.Notes = payload.notes;
      if (payload.name !== undefined) body.Name = payload.name;
      // Email and Phone were absent from this mapper, so edits to either were
      // silently dropped on the way to the server — the form appeared to save
      // and the value never changed.
      if (payload.email !== undefined) body.Email = payload.email;
      if (payload.phone !== undefined) body.Phone = payload.phone;
      if (payload.linkedin !== undefined) body.Linkedin = payload.linkedin;
      if (payload.setterId !== undefined) body.SetterId = payload.setterId;
      if (payload.closerId !== undefined) body.CloserId = payload.closerId;
      if (payload.nextFollowUp !== undefined) body.NextFollowUp = payload.nextFollowUp;
      if (payload.researchFindings !== undefined) body.ResearchFindings = payload.researchFindings;
      if (payload.qualificationReason !== undefined) body.QualificationReason = payload.qualificationReason;
      if (payload.researchSource !== undefined) body.ResearchSource = payload.researchSource;
      await fetchAPI('updateLead', 'POST', body);
    },
    /** Server-side atomic conversion — replaces the old 3-call client flow. */
    convertToDeal: async (leadId: string, userId: string, value: number): Promise<Deal> => {
      const res = await fetchAPI<{ deal: SheetRow; idempotent: boolean }>(
        'convertLead', 'POST', { leadId, value, ownerRepId: userId }
      );
      return toDeal(res.deal);
    },
    assign: async (
      leadId: string,
      assignment: { ownerRepId?: string; setterId?: string; closerId?: string }
    ): Promise<void> => {
      await fetchAPI('assignLead', 'POST', { leadId, ...assignment });
    },

    /** Managers only. Soft delete: the row is flagged and archived, never removed. */
    remove: async (leadId: string, reason: string): Promise<void> => {
      await fetchAPI('deleteLead', 'POST', { leadId, reason });
    },

    restore: async (leadId: string): Promise<void> => {
      await fetchAPI('restoreLead', 'POST', { leadId });
    },

    getDeleted: async <T = SheetRow[]>(includeRestored = false): Promise<T> => {
      const data = await fetchAPI('getDeletedLeads', 'POST', { includeRestored });
      return (Array.isArray(data) ? data : []) as T;
    },

    /** Explicit closer assignment — manual by design, managers only. */
    assignCloser: async (leadId: string, closerId: string): Promise<void> => {
      await fetchAPI('assignCloser', 'POST', { leadId, closerId });
    },

    completeFollowUp: async (
      leadId: string,
      opts: { contactMode?: string; outcome?: string; nextFollowUp?: string } = {}
    ): Promise<{ idempotent: boolean }> => {
      const res = await fetchAPI<{ idempotent: boolean }>(
        'completeFollowUp', 'POST', { leadId, ...opts }
      );
      return { idempotent: Boolean(res?.idempotent) };
    },

    /**
     * Record why a follow-up has been left outstanding.
     *
     * Separate from updateLead because the backend refuses to take this as an
     * ordinary field — it stamps the author and the time itself, so an
     * explanation can never be attributed to the wrong person or backdated
     * onto a lapse it was not about.
     */
    explainDelay: async (
      leadId: string,
      reason: string
    ): Promise<{ overdueHours: number }> => {
      const res = await fetchAPI<{ overdueHours: number }>(
        'explainFollowUpDelay', 'POST', { leadId, reason }
      );
      return { overdueHours: Number(res?.overdueHours) || 0 };
    },
  },

  deals: {
    getAll: async (_role?: UserRole, _userId?: string): Promise<Deal[]> => {
      const data = await fetchAPI('getDeals');
      return asArray(data).map(toDeal);
    },
    create: async (payload: Partial<Deal>): Promise<Deal> => {
      const res = await fetchAPI('createDeal', 'POST', {
        LeadId: payload.leadId, Value: payload.value, Status: payload.status,
        OwnerRepId: payload.ownerRepId, SetterId: payload.setterId, CloserId: payload.closerId,
      });
      return toDeal(res);
    },

    /**
     * Status changes go through dedicated server transactions.
     *
     * Winning a deal used to be five separate client calls (update, re-read
     * deals, re-read leads, create commission, write log) with no atomicity
     * and no duplicate protection. It is now one idempotent server call.
     */
    updateStatus: async (
      dealId: string,
      status: DealStatus,
      commissionData?: { setterAmount: number; closerAmount: number; setterId?: string; closerId?: string }
    ): Promise<{ idempotent: boolean }> => {
      if (status === 'Won') {
        const res = await fetchAPI<{ idempotent: boolean }>('markDealWon', 'POST', {
          dealId,
          setterId: commissionData?.setterId,
          closerId: commissionData?.closerId,
          setterAmount: commissionData?.setterAmount,
          closerAmount: commissionData?.closerAmount,
        });
        return { idempotent: Boolean(res?.idempotent) };
      }
      if (status === 'Lost') {
        const res = await fetchAPI<{ idempotent: boolean }>('markDealLost', 'POST', { dealId });
        return { idempotent: Boolean(res?.idempotent) };
      }
      await fetchAPI('updateDeal', 'POST', { id: dealId, Status: status });
      return { idempotent: false };
    },

    /** Amend an existing commission instead of creating a second one. */
    reviseCommission: async (
      dealId: string,
      data: { setterAmount: number; closerAmount: number; setterId?: string; closerId?: string }
    ): Promise<void> => {
      await fetchAPI('reviseCommission', 'POST', { dealId, ...data });
    },
  },

  projects: {
    getAll: async (_role?: UserRole, _userId?: string): Promise<Project[]> => {
      const data = await fetchAPI('getProjects');
      return asArray(data).map(toProject);
    },
    create: async (payload: Partial<Project>): Promise<Project> => {
      const res = await fetchAPI('createProject', 'POST', {
        ClientName: payload.clientName, Status: payload.status, OwnerRepId: payload.ownerRepId,
        AccountManagerId: payload.accountManagerId, LiaisonId: payload.liaisonId,
        StartDate: payload.startDate, DueDate: payload.dueDate, DealId: payload.dealId,
        Notes: payload.notes,
      });
      return toProject(res);
    },
    update: async (id: string, payload: Partial<Project>): Promise<void> => {
      const body: Record<string, unknown> = { id };
      if (payload.status !== undefined) body.Status = payload.status;
      if (payload.accountManagerId !== undefined) body.AccountManagerId = payload.accountManagerId;
      if (payload.liaisonId !== undefined) body.LiaisonId = payload.liaisonId;
      if (payload.notes !== undefined) body.Notes = payload.notes;
      if (payload.clientName !== undefined) body.ClientName = payload.clientName;
      if (payload.startDate !== undefined) body.StartDate = payload.startDate;
      if (payload.dueDate !== undefined) body.DueDate = payload.dueDate;
      await fetchAPI('updateProject', 'POST', body);
    },
  },

  users: {
    getAll: async (): Promise<User[]> => {
      const data = await fetchAPI('getUsers');
      return asArray(data).map(toUser);
    },
    create: async (payload: Partial<User> & { password?: string }): Promise<User> => {
      const res = await fetchAPI('createUser', 'POST', {
        Username: payload.username, Password: payload.password, Role: payload.role,
        Team: payload.team, Status: payload.status, Availability: payload.availability,
      });
      return toUser(res);
    },
    update: async (id: string, payload: Partial<User> & { password?: string }): Promise<User> => {
      const body: Record<string, unknown> = { id };
      if (payload.status) body.Status = payload.status;
      if (payload.availability) body.Availability = payload.availability;
      if (payload.role) body.Role = payload.role;
      if (payload.username) body.Username = payload.username;
      if (payload.password) body.Password = payload.password;
      if (payload.team) body.Team = payload.team;
      const res = await fetchAPI('updateUser', 'POST', body);
      return toUser(res);
    },
    /**
     * Deactivate, never hard-delete: historical ownership on leads, deals and
     * commissions must keep resolving. The old api.users.delete() called a
     * `deleteUser` action that the backend never implemented.
     */
    deactivate: async (id: string): Promise<void> => {
      await fetchAPI('deactivateUser', 'POST', { id });
    },
    setAvailability: async (availability: User['availability']): Promise<void> => {
      await fetchAPI('setAvailability', 'POST', { availability });
    },
    getZohoAuthUrl: async (redirectUri: string): Promise<string> => {
      const res = await fetchAPI<{ url: string }>('getZohoAuthUrl', 'POST', { redirectUri });
      return res.url;
    },
    linkZoho: async (_id: string, redirectUri: string, code: string, state?: string): Promise<void> => {
      await fetchAPI('linkZoho', 'POST', { redirectUri, code, state });
      // The mailbox works again, so let mail be attempted without a reload.
      clearZohoReauthFlag();
    },
    unlinkZoho: async (id?: string): Promise<void> => {
      await fetchAPI('unlinkZoho', 'POST', id ? { id } : {});
    },
  },

  adminRequests: {
    getAll: async (): Promise<AdminRequest[]> => {
      const data = await fetchAPI('getAdminRequests');
      return asArray(data).map(toRequest);
    },
    create: async (payload: Partial<AdminRequest>): Promise<AdminRequest> => {
      const res = await fetchAPI('createAdminRequest', 'POST', {
        Type: payload.type, RelatedDealId: payload.relatedDealId,
        Status: payload.status, Notes: payload.notes,
      });
      return toRequest(res);
    },
    update: async (id: string, payload: Partial<AdminRequest>): Promise<void> => {
      const body: Record<string, unknown> = { id };
      if (payload.status) body.Status = payload.status;
      if (payload.paymentLink) body.PaymentLink = payload.paymentLink;
      if (payload.documentUrl) body.DocumentUrl = payload.documentUrl;
      if (payload.notes !== undefined) body.Notes = payload.notes;
      await fetchAPI('updateAdminRequest', 'POST', body);
    },
    approve: async (requestId: string, extra: { paymentLink?: string; documentUrl?: string } = {}) => {
      await fetchAPI('approveRequest', 'POST', { requestId, ...extra });
    },
    reject: async (requestId: string, notes?: string) => {
      await fetchAPI('rejectRequest', 'POST', { requestId, notes });
    },
  },

  finance: {
    getCommissions: async (): Promise<Commission[]> => {
      const data = await fetchAPI('getCommissions');
      return asArray(data).map(toCommission);
    },
    getKPIs: async (): Promise<{
      totalValue: number; totalCommissions: number; payoutsPending: number; payoutsPaid: number;
    }> => {
      const d = await fetchAPI<Record<string, unknown>>('getKPIs');
      return {
        totalValue: num(d?.totalValue), totalCommissions: num(d?.totalCommissions),
        payoutsPending: num(d?.payoutsPending), payoutsPaid: num(d?.payoutsPaid),
      };
    },
    /**
     * Full CRM export, SUPER_ADMIN only. Secrets are stripped server-side —
     * password hashes, salts, session tokens and Zoho refresh tokens never
     * appear, and the Sessions sheet is excluded entirely.
     */
    exportAll: async (): Promise<Record<string, unknown>> => {
      return await fetchAPI<Record<string, unknown>>('exportAllData', 'POST', {});
    },

    /** Idempotent server-side settlement; paying twice is a no-op. */
    processCommission: async (id: string): Promise<{ idempotent: boolean }> => {
      const res = await fetchAPI<{ idempotent: boolean }>(
        'processCommission', 'POST', { commissionId: id }
      );
      return { idempotent: Boolean(res?.idempotent) };
    },
  },

  teams: {
    /**
     * Team structure plus the gaps in it. Managers only.
     * The warnings matter: team scoping fails silently, so a manager whose
     * team matches nobody simply sees an empty CRM.
     */
    overview: async (): Promise<Record<string, unknown>> => {
      return await fetchAPI<Record<string, unknown>>('getTeamOverview', 'POST', {});
    },

    setUserTeam: async (userId: string, team: string): Promise<void> => {
      await fetchAPI('setUserTeam', 'POST', { userId, team });
    },
  },

  reports: {
    /**
     * Per-person activity counts.
     * `timeZone` is the viewer's browser zone, so "today" is their calendar
     * day rather than the server's — the team is distributed.
     */
    productivity: async <T = SheetRow>(days = 30, timeZone?: string): Promise<T> => {
      return await fetchAPI<T>('getProductivity', 'POST', { days, timeZone });
    },

    /** Organisation-wide analytics. SUPER_ADMIN only, pinned to the org timezone. */
    analytics: async <T = SheetRow>(days = 30): Promise<T> => {
      return await fetchAPI<T>('getAnalytics', 'POST', { days });
    },

    /**
     * Activity for one calendar day, in the viewer's timezone.
     * Pass `date` (YYYY-MM-DD) for a specific day, or `days` for a window
     * running back from today.
     */
    activityFeed: async <T = SheetRow>(
      opts: { date?: string; days?: number; timeZone?: string; limit?: number } = {}
    ): Promise<T> => {
      return await fetchAPI<T>('getActivityFeed', 'POST', opts);
    },
  },

  logs: {
    getByEntity: async (entityId: string): Promise<Log[]> => {
      const params: Record<string, string> = entityId === 'GLOBAL' ? {} : { id: entityId };
      const data = await fetchAPI('getLogs', 'GET', null, params);
      return asArray(data).map(toLog);
    },
    create: async (payload: {
      entityId: string; entityType: string; action: string;
      userId?: string; details: string; metadata?: string;
      /** CALL | WHATSAPP | EMAIL | OTHER. Anything else is stored blank. */
      contactMode?: string;
    }): Promise<void> => {
      await fetchAPI('createLog', 'POST', {
        EntityId: payload.entityId, EntityType: payload.entityType,
        Action: payload.action, Details: payload.details,
        Metadata: payload.metadata || '',
        // Validated server-side against the contact-mode vocabulary. Anything
        // unrecognised is stored blank rather than as junk, so the channel
        // analytics stay countable.
        contactMode: payload.contactMode,
      });
    },
  },

  zoho: {
    /**
     * Live fetch from the user's mailbox. Passing `leadId` lets the backend
     * archive what it finds against the lead, so the thread survives the
     * message later leaving the mailbox.
     */
    getEmails: async (leadEmail: string, leadId?: string): Promise<ZohoEmailItem[]> => {
      // A revoked or expired Zoho token cannot fix itself, so asking again is
      // a guaranteed-failing round trip — and this runs on every lead opened.
      // Once the backend says the connection needs reconnecting, stop asking
      // until it is reconnected. Leads then open at the speed of the archive.
      if (zohoNeedsReauth) {
        throw new ApiError('ZOHO_REAUTH_REQUIRED', zohoReauthMessage, { action: 'getZohoEmails' });
      }
      const params: Record<string, string> = { leadEmail };
      if (leadId) params.leadId = leadId;
      try {
        const data = await fetchAPI('getZohoEmails', 'GET', null, params);
        return asArray(data) as unknown as ZohoEmailItem[];
      } catch (err) {
        if (err instanceof ApiError && err.code === 'ZOHO_REAUTH_REQUIRED') {
          zohoNeedsReauth = true;
          zohoReauthMessage = err.displayMessage;
        }
        throw err;
      }
    },

    /**
     * The real body of one message.
     *
     * Both a search result and an archived row carry only Zoho's `summary`,
     * which is cut off mid-sentence. This is the only way to show what was
     * actually written, and it costs a Zoho round trip — so it is called when
     * someone opens a message, never for a whole list.
     */
    getEmailContent: async (
      messageId: string, opts: { leadId?: string; folderId?: string } = {}
    ): Promise<{ content: string; complete: boolean; note?: string }> => {
      return await fetchAPI('getEmailContent', 'POST', {
        messageId, leadId: opts.leadId || '', folderId: opts.folderId || '',
      });
    },

    /** The archived conversation, readable without a live Zoho connection. */
    getStoredEmails: async (leadId: string, leadEmail?: string): Promise<ZohoEmailItem[]> => {
      const data = await fetchAPI('getStoredEmails', 'POST', { leadId, leadEmail });
      return asArray(data).map(toStoredEmail);
    },

    sendEmail: async (
      to: string, subject: string, content: string,
      opts: {
        leadId?: string; draftId?: string; cc?: string;
        /** base64 payloads. The server uploads each one before sending. */
        attachments?: { name: string; mimeType: string; data: string }[];
      } = {}
    ): Promise<void> => {
      await fetchAPI('sendZohoEmail', 'POST', {
        to, subject, content,
        leadId: opts.leadId || '', draftId: opts.draftId || '',
        cc: opts.cc || '',
        attachments: opts.attachments || [],
      });
    },

    getDrafts: async (leadId: string): Promise<EmailDraft[]> => {
      const data = await fetchAPI('getEmailDrafts', 'POST', { leadId });
      return asArray(data).map(toDraft);
    },

    saveDraft: async (payload: {
      draftId?: string; leadId: string; to?: string; subject?: string; content?: string;
    }): Promise<EmailDraft> => {
      const res = await fetchAPI<{ draft: SheetRow; created: boolean }>(
        'saveEmailDraft', 'POST', payload
      );
      return toDraft(res.draft);
    },

    deleteDraft: async (draftId: string): Promise<void> => {
      await fetchAPI('deleteEmailDraft', 'POST', { draftId });
    },

    /**
     * Read recent mail from the CALLER's own mailbox and record it, matching
     * each message to a lead where one exists. This is what surfaces
     * correspondence with people who are not in the CRM at all.
     */
    syncMailbox: async (limit?: number): Promise<{
      scanned: number; stored: number; matchedToLead: number;
      withoutLead: number; mailbox: string;
    }> => {
      return await fetchAPI('syncMailbox', 'POST', limit ? { limit } : {});
    },

    getEmailAnalytics: async (days = 30): Promise<EmailAnalytics> => {
      return await fetchAPI<EmailAnalytics>('getEmailAnalytics', 'POST', { days });
    },

    getUnmatchedEmails: async (limit?: number): Promise<UnmatchedEmails> => {
      const res = await fetchAPI<{
        total: number; truncated: boolean; messages: SheetRow[];
      }>('getUnmatchedEmails', 'POST', limit ? { limit } : {});
      return {
        total: res.total,
        truncated: res.truncated,
        messages: asArray(res.messages).map((r) => ({
          id: str(r.ID) || str(r.MessageId),
          subject: str(r.Subject) || '(No Subject)',
          sender: str(r.Sender),
          toAddress: str(r.ToAddress),
          direction: str(r.Direction) === 'in' ? 'in' as const : 'out' as const,
          sentAt: str(r.SentAt),
          userId: str(r.UserId),
        })),
      };
    },
  },
};

export { ApiError, toApiError };
