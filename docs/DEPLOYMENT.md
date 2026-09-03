# TJGROUPS CRM — Deployment & Migration Runbook

This is the ordered procedure for rolling out the hardened CRM **without
breaking the currently working production system**.

The rollout is deliberately staged. At no point is there a moment where the
deployed frontend and the deployed backend are incompatible, and every step
is reversible.

---

## 0. The one-line summary

Deploy the backend first with `AUTH_ENFORCEMENT = off` (it stays fully
backward compatible with your current site), migrate the sheets, set
passwords, deploy the new frontend, then flip enforcement to `on`.

**Rollback at any point = set `AUTH_ENFORCEMENT` back to `off`.**

---

## 1. File manifest — what to paste into the Apps Script editor

**6 files:** five of your originals replaced, one new, one deleted.

| # | File | Status | What it does |
|---|------|--------|--------------|
| 1 | `utils.gs` | **CHANGED** | Part 1: domain rules (roles, state machines, permission matrix, validation, sanitisation). Part 2: response envelope, error codes, audit writer |
| 2 | `controllers.gs` | **CHANGED** | Part 1: sheet access, per-request cache, batched writes, locking, scoped reads. Part 2: business transactions (mark won, convert lead, payouts, accounts) |
| 3 | `auth.gs` | **NEW** | Password hashing, sessions, login/logout, the authorisation gate |
| 4 | `ZohoMail.gs` | **CHANGED** | Zoho OAuth + mail, per-user account isolation |
| 5 | `setup.gs` | **CHANGED** | Schema, additive migration, password bootstrap, pre-flight check |
| 6 | `api.gs` | **CHANGED** | Router: authentication + authorisation enforcement |


Apps Script concatenates every file into one global scope and hoists function
declarations, so load order does not affect correctness. The order above is
simply dependency order, and matches the local test harness.

### Why `auth.gs` is the only new file

| Question | Answer |
|---|---|
| Why must it be separate? | It is the security boundary. Everything else may *call* it, but nothing else may implement identity. A reviewer auditing "how does this system decide who you are" reads exactly one file. |
| Why not fold it into `api.gs`? | `api.gs` is the router. Mixing password hashing, token minting and session revocation into the dispatch table is precisely the muddle that let identity be decided in three places before. |
| Why not `controllers.gs`? | `controllers.gs` is data access and business transactions. Authentication is neither, and it must be usable *before* any record-level scoping decision is made. |
| What dependency boundary does it create? | `auth.gs` depends on `utils.gs` + `controllers.gs`; nothing depends on it except `api.gs`. It is a leaf that sits directly under the router. |
| Does it materially improve security/testing? | Yes — the whole session/RBAC suite targets it directly, and it is the single place to audit or revoke access. |

**Files deliberately NOT created:** `domain.gs`, `services.gs`, `permissions.gs`,
`validation.gs`, `states.gs`, `session.gs`, `repository.gs`. Domain rules live
in `utils.gs` (they are dependency-free leaves consumed by everything);
business transactions live in `controllers.gs` (every one of them is written
directly against the storage functions in the same file). Splitting those
created file boundaries with no dependency boundary behind them.

> Delete the default `Code.gs` if present.
>
> The previous deployment guide listed only 4 files and omitted `ZohoMail.gs`.
> A deploy that follows the old list silently loses all mail functionality.

---

## 2. Script Properties

`Project Settings ⚙️ → Script Properties`.

| Property | Value | Required | Notes |
|---|---|---|---|
| `MAIN_FOLDER_ID` | your Drive folder id | yes | already set today |
| `DB_FOLDER_ID` | set automatically | yes | written by `setupCRMDatabase()` |
| `AUTH_ENFORCEMENT` | `off` → `warn` → `on` | yes | **start at `off`** |
| `ENVIRONMENT` | `production` | yes | marks this deployment as live |
| `ZOHO_CLIENT_ID` | your Zoho client id | for mail | **was hardcoded — rotate it** |
| `ZOHO_CLIENT_SECRET` | your Zoho secret | for mail | **was hardcoded — rotate it** |
| `ZOHO_REDIRECT_URI` | `https://crm.tjgroups.com/oauth/callback` | for mail | |
| `ZOHO_ACCOUNTS_HOST` | leave unset | no | defaults to `https://accounts.zoho.in` |
| `ZOHO_MAIL_HOST` | leave unset | no | defaults to `https://mail.zoho.in` |

| `PASSWORD_PEPPER` | leave unset | no | auto-generated on first use |
| `PASSWORD_ITERATIONS` | leave unset | no | defaults to 750 |
| `SESSION_TTL_HOURS` | leave unset | no | defaults to 12 |
| `CRM_TIMEZONE` | e.g. `Asia/Kolkata` | no | the ORGANISATION default day boundary. Used for org-wide analytics, and for anyone who has not set a personal zone. Individual users override it via `Users.TimeZone`, so a distributed team each sees their own "today" |
| `CONTACT_MODE_TRACKING_SINCE` | set automatically | no | stamped by `migrateDatabase()` the moment `Logs.ContactMode` is added; analytics reports coverage from this date and never claims earlier history |
| `EMAIL_SIGNATURE_ENABLED` | `false` | no | appends the approved signature to outbound mail. **Off means outbound mail is byte-identical to before** — see `SIG-9`. Turn on only after filling in `Users.SignatureTitle` |
| `SIGNATURE_ORG_NAME` | `TJGROUPS` | no | the organisation line under the sender's name |
| `EMAIL_OBSERVATION_ADAPTER` | `static` | no | `static` observes nothing. `css-import` embeds a remote stylesheet that resolves the sender's name at render time — **the mechanism under test**, HTML messages only |
| `EMAIL_OBSERVATION_ENABLED` | `false` | no | opens an observation record per outbound message. Off means no record is created and no token is embedded |
| `EMAIL_OBSERVATION_BASE_URL` | `https://crm.tjgroups.com` | no | origin serving `/api/email-observation/sig/<token>.css` |
| `EMAIL_OBSERVATION_EDGE_SECRET` | *(unset)* | **yes, if observation is on** | shared secret the edge presents to `recordObservationFetch`. **Unset means every ingestion request is refused** — it fails closed on purpose. Must match `EMAIL_OBSERVATION_EDGE_SECRET` in the Vercel environment |
| `ALLOW_DESTRUCTIVE_RESET` | **delete it** | no | obsolete. It belonged to the removed reset script. `selfCheck()` flags it if present so you can clear it out |

> ### Set up your teams before your first Admin logs in
> An ADMIN sees records owned by people who share their `Users.Team` value.
> In the live data that column holds job titles — `"Sales Lead / CRO"`,
> `"Global"`, `"Sales Team"` — and four users have no value at all. Team
> matching therefore finds nothing and the Admin sees an **empty CRM**.
>
> Fix it in the app, not in a config file: **Admin → Team Structure**. Put
> each manager on the same team as the people they manage. The panel flags
> teams with no manager, and users with no team, which is the failure that is
> otherwise completely invisible.
>
> There is deliberately no Script Property that widens a manager's reach: a
> permission boundary buried in a settings page is one nobody reviews. Team
> membership is data, edited by a Super Admin and written to the audit log.
>
> Matching is case-insensitive and trimmed, so `"Sales Team"` and
> `"Sales team"` count as one team. Verify with `npm run check:teams`.

> ### Rotate the Zoho credentials before you go live
> The client id and secret were committed in `ZohoMail.gs`, and the client id
> was additionally shipped to every browser in the Vercel bundle. Treat both
> as compromised: create a new client in the Zoho API console, put the new
> values in Script Properties, and revoke the old one. Every user will need to
> reconnect their mailbox once, via **Connect Zoho Mail** on the dashboard.

---

## 3. Google Sheets changes (append-only)

`migrateDatabase()` adds these for you. If you prefer to add them by hand,
**append each to the right of the existing headers, and never reorder or
insert in the middle.** An `ID` column must exist in every managed sheet; its
*position* does not matter, because the storage layer looks it up by name.

> Your live `AdminRequests` sheet has a stray empty first column literally
> named `AdminRequests`, with the real `ID` column last. That is tolerated and
> left exactly as it is. Worth knowing: the *previous* backend compared column
> A, so updates to that sheet were silently failing in production.

| Sheet | Columns to append |
|---|---|
| `Users` | `PasswordHash`, `PasswordSalt`, `PasswordIterations`, `PasswordUpdatedAt`, `FailedLoginCount`, `LockedUntil`, `MustChangePassword`, `ZohoAccountId`, `ZohoLinkedAt`, `TimeZone`, `DisplayName`, `SignatureTitle`, `SignatureEnabled` |
| `Projects` | `DealId`, `Notes` |
| `AdminRequests` | `Notes`, `PaymentLink`, `DocumentUrl` |
| `Commissions` | `PayoutDate` |
| `Leads` | `FollowUpStatus`, `FollowUpCompletedAt`, `FollowUpCompletedBy`, `FollowUpDelayReason`, `FollowUpDelayReasonAt`, `FollowUpDelayReasonBy`, `Deleted`, `DeletedAt`, `DeletedBy`, `DeleteReason`, `ResearchFindings`, `QualificationReason`, `ResearchSource`, `ResearchUpdatedAt`, `ResearchUpdatedBy` |
| `Logs` | `RequestId`, `ContactMode` |
| **`Sessions`** | **new sheet:** `ID`, `TokenHash`, `UserId`, `CreatedAt`, `ExpiresAt`, `RevokedAt`, `UserAgent` |
| **`DeletedLeads`** | **new sheet:** `ID`, `LeadId`, `LeadName`, `DeletedAt`, `DeletedBy`, `DeletedByUsername`, `Reason`, `Snapshot`, `RestoredAt`, `RestoredBy` |
| **`EmailLog`** | **new sheet:** `ID`, `MessageId`, `LeadId`, `LeadEmail`, `UserId`, `Direction`, `Subject`, `Summary`, `Sender`, `ToAddress`, `SentAt`, `SyncedAt`, `FolderId` |
| **`EmailBodies`** | **new sheet:** `ID`, `MessageId`, `Body`, `BodyComplete`, `StoredAt` — message text, kept apart from `EmailLog` so listing a conversation never reads it |
| **`EmailDrafts`** | **new sheet:** `ID`, `LeadId`, `UserId`, `ToAddress`, `Subject`, `Content`, `CreatedAt`, `UpdatedAt`, `SentAt` |
| **`EmailObservation`** | **new sheet, created empty and written by nothing.** `ID`, `EmailLogId`, `MessageId`, `LeadId`, `UserId`, `Token`, `State`, `FirstObservedAt`, `LastObservedAt`, `ObservationCount`, `HighestConfidence`, `NotificationState`, `CreatedAt`, `UpdatedAt` |
| **`EmailObservationEvent`** | **new sheet, created empty and written by nothing.** `ID`, `ObservationId`, `SequenceNumber`, `ObservedAt`, `SourceClass`, `Confidence`, `Evidence`, `CreatedAt` |

`Deals` is unchanged.

`Notes` / `PaymentLink` / `DocumentUrl` on `AdminRequests` and `Notes` on
`Projects` are not new features — the frontend has always written those
fields, and they were being silently discarded because no column existed.

### `Users.DisplayName` — what a recipient sees

Outbound mail used a bare mailbox address, so inboxes showed the local part —
`dhiraj.th` — instead of a person. Mail now goes out as
`"Display Name" <address>`.

Blank falls back to a tidied username (`carlos_llanos` → `Carlos Llanos`), so
this only needs filling in where that guess is wrong. No rule can turn
`dhiraj_th` into `Dhiraj T H`; **type the real names into this column by hand
after migrating.** It is worth doing: mail from a person rather than a handle
also reads less like automated bulk to a spam filter.

### The research fields on a lead

`ResearchFindings` and `QualificationReason` are deliberately two columns, not
one. The first is what was found out about the company; the second is the
judgement drawn from it — the trigger that made them worth approaching. When a
lead is handed from the person who sourced it to the person who closes it,
weeks later, the second question is the one nobody can reconstruct.

Both are writable by whoever works the lead, not just managers: the person
doing the research is usually the rep. `ResearchUpdatedAt` and
`ResearchUpdatedBy` are stamped server-side and cannot be set by the client.

### Stale follow-ups have to be explained

`FollowUpDelayReason`, `FollowUpDelayReasonAt` and `FollowUpDelayReasonBy`
record why a follow-up was left outstanding.

Moving the date is the one edit that makes a missed follow-up stop looking
missed: the lead drops off the overdue list and nothing records that it was
ever late. So once a follow-up has been overdue for **more than 24 hours**,
changing its date is refused (`FOLLOWUP_REASON_REQUIRED`) until the person
gives a one-line reason. The CRM prompts for it; they are not expected to know
the rule.

What this does **not** block: notes, status, research, completing the
follow-up, or rescheduling one that is merely late rather than a full day
stale. Normal day-to-day work is untouched.

The reason can also be given on its own, without moving the date, via
`explainFollowUpDelay`. Either way the author and the time are stamped
server-side — the three columns are **not** client-writable, so an explanation
cannot be attributed to somebody else or backdated onto a lapse it was not
about. Each one is filed under its own `FOLLOWUP_DELAYED` audit action, so a
manager can list every slip and its stated reason rather than reading them out
of generic `UPDATED` rows.

### The outbound signature

The CRM appends an approved sign-off composed server-side from the sender's own
record, so a salesperson writes only the subject and body:

```
Best regards,

Dhiraj T H          ← Users.DisplayName (falls back to a tidied Username)
Founder             ← Users.SignatureTitle
TJGROUPS            ← SIGNATURE_ORG_NAME
```

**`SignatureTitle` is a job title, not `Users.Role`.** `Role` is the RBAC role
— `SUPER_ADMIN`, `ADMIN`, `SALES_REP`, `SETTER` — and composing from it would
sign real mail to a prospect "SALES_REP". Blank omits the line rather than
printing an empty one, so it only needs filling in where you want a title.
**Fill it in by hand before turning the flag on.** `SignatureEnabled` is a
per-user opt-out; blank counts as enabled, so no existing row needs editing.

**The signature is composed in the same format as the body.** A plaintext
message gets plaintext lines and stays plaintext through `detectMailFormat()`;
an HTML message gets minimal inline markup. Appending a signature must never
convert a plain message to HTML — that defect was fixed once already and
`SIG-1` now guards it.

It is added at **send time only**, never stored on a draft, so reopening and
re-saving a draft cannot accumulate signatures. The composer previews it via
`getSignaturePreview`, which calls the same assembly function — `SIG-7` asserts
the preview and the sent message match byte for byte.

**No observation, tracking or remote content of any kind is included.** `SIG-8`
fails the build if `<img>`, `<link>`, `@import`, `@font-face`, `url(`,
`amp-list`, `<script>` or `<iframe>` ever appears in outbound mail. See
`docs/EMAIL_OBSERVATION_CLIENT_MATRIX.md` for why, and for the E-001 probe that
is testing the one remaining candidate mechanism.

### Email render observation — experimental, off by default

When `EMAIL_OBSERVATION_ENABLED` is on and the adapter is `css-import`, an
HTML message carries a remote stylesheet that resolves the sender's name:

```
<style>@import url("…/api/email-observation/sig/<token>.css");</style>
```

If the recipient's client fetches it, the edge reports the request, the CRM
classifies it, and the observation record's count and timestamps advance.

**Whether any client fetches it is unmeasured.** Gmail and Outlook are
documented not to honour `@import` in message HTML; Apple Mail is WebKit and
might. **The first real sends are the experiment** — record the outcome in
`docs/EMAIL_OBSERVATION_CLIENT_MATRIX.md`.

**A fetch is not an open.** It may be a security gateway, a content proxy, a
cache refresh, a second device or a forward. The classifier currently promotes
nothing to `LIKELY_RENDERED`: known proxies and scanners are excluded outright,
anything inside the 15-second scan window is treated as automated, and
everything else is `RENDER_UNCERTAIN`. That is deliberate — the thresholds that
would justify a stronger claim need E-001 data that does not exist yet.

**Constraints that hold regardless:**

- HTML only. A plaintext message is left untouched rather than upgraded.
- Every message also carries the signature as ordinary static text, so a client
  that strips the stylesheet still shows a correct sign-off.
- The token contains an opaque id and nothing else — no address, lead, company
  or sender name. URLs reach proxy logs and browser history.
- `EMAIL_OBSERVATION_EDGE_SECRET` must be set in **both** Script Properties and
  the Vercel environment, and must match. Unset fails closed.

To turn it off completely, set `EMAIL_OBSERVATION_ADAPTER` back to `static`.

### The scheduled mailbox sync

A request only ever reads the **caller's own** mailbox — that is what stops one
person reading a colleague's inbox. The consequence was that mail somebody sent
from their own Zoho account never reached the CRM unless they personally opened
that lead. A manager reviewing the lead saw a conversation with pieces missing
and no indication anything was missing.

`syncAllMailboxes()` closes that. Running as a **time-driven trigger** it is the
script acting as itself rather than on behalf of a user, so reading every linked
mailbox is legitimate. Install it once, from the editor:

```
installMailSyncTrigger()     // hourly; safe to re-run, replaces any existing one
listMailSyncTriggers()       // what is scheduled right now
mailSyncStatus()             // when each mailbox last synced, and what broke
removeMailSyncTrigger()      // stop it
```

**Nothing about who may READ mail changes.** `getStoredEmails` still scopes by
which leads you may see: a Super Admin sees every lead's correspondence, an
Admin their team's, a rep their own — including the mail they sent themselves.
The trigger only fills the shared archive.

A Super Admin can also run it on demand via the `syncAllMailboxes` action. It
returns counts only, never message contents, so it fills the archive rather than
exposing a colleague's mail.

**It is incremental.** Each mailbox keeps a bookmark in Script Properties
(`MAILSYNC_<userId>`) holding the newest message id it has seen. If nothing has
arrived, the run costs one Zoho listing and writes nothing at all; otherwise it
walks newest-first and stops at the first message already archived. Bookmarks
live in Script Properties rather than a `Users` column deliberately — this is
bookkeeping about the sync process, not CRM data, so it needs no migration.

One broken mailbox never stops the rest: a revoked token is recorded against
that user (visible in `mailSyncStatus()`) and the loop continues. The run also
stops itself before Apps Script's six-minute limit; whatever is left is picked
up on the next tick, and the bookmarks mean nothing is redone.

Hourly, not every few minutes: each run costs one Zoho listing per linked
mailbox against a free-tier budget.

### Why email is copied into the CRM

`EmailLog` holds the envelope of every message exchanged with a lead —
subject, direction, addresses, timestamp. Zoho remains the source of truth for
the message body, but it is reachable only while the user's token is valid and
the message is still in their mailbox. Copying the envelope means the
conversation survives a token expiring, a mailbox being cleaned out, or the
person leaving the company.

Messages are deduplicated on Zoho's own `MessageId`, so re-opening a lead
never doubles the thread, and only genuinely new messages cost a write.

`EmailDrafts` holds half-written replies. They live in the CRM rather than
Zoho's drafts folder so they sit next to the lead they belong to and survive a
browser refresh. A draft is private to its author, even from a Super Admin.

### Repairing wrongly-filed email

An earlier version trusted Zoho's search to filter by address. It does not:
an unrecognised search key returns the **whole mailbox**, so unrelated
messages were archived against leads they had nothing to do with — shown on
the lead page marked "SAVED IN CRM" as though verified.

Both the live read and the archive read now verify that the lead's own
address is actually on the message, so bad rows stop appearing immediately
after deploying. To clean them up:

```
auditEmailLogAttribution()   // reports only, changes nothing
repairEmailLog()             // detaches the rows it listed
```

`repairEmailLog()` clears `LeadId`. It **never deletes a message** — the mail
is real, it simply does not belong to that company. Detached rows appear under
"no matching lead" in Insights, where they can be looked at rather than
silently discarded.

### How lead deletion stores data

Deleting a lead does **not** remove its row. The row is flagged
(`Deleted = TRUE`) and hidden from the CRM, and a `DeletedLeads` entry records
who deleted it, when, why, and a JSON snapshot of every value at that moment.

Moving the row into an archive sheet would match the phrase "deleted database"
more literally, but a move is a delete followed by an insert: if the insert
fails, the record is gone. Flagging cannot lose data, and it makes restore a
single field change. Both the flagged row and the archive appear in a full
export, because an export is a backup.

A lead that has been converted to a deal cannot be deleted at all — the deal
and any commission on it reference it.

---

## 4. Rollout procedure

### Step 1 — Back up, then PROVE the backup

A backup you have not verified is not a backup.

1. Open the `Databases` folder in Drive.
2. For **every** sheet: `File → Make a copy`, name it `<Sheet>_backup_YYYYMMDD`.
3. Copy the current Apps Script source into a local folder.
4. Note the current deployment URL and the current Script Properties.

Now verify it. For each sheet record both numbers and confirm they match:

| Check | Production | Backup | Must match |
|---|---|---|---|
| Row count (`Users`) | | | yes |
| Row count (`Leads`) | | | yes |
| Row count (`Deals`) | | | yes |
| Row count (`Projects`) | | | yes |
| Row count (`Commissions`) | | | yes |
| Row count (`AdminRequests`) | | | yes |
| Row count (`Logs`) | | | yes |
| First and last `ID` in each sheet | | | yes |
| `SUM` of `Deals.Value` | | | yes |
| `SUM` of `Commissions.SetterAmount` | | | yes |
| `SUM` of `Commissions.CloserAmount` | | | yes |
| Count of `Commissions` where `PayoutStatus = Paid` | | | yes |

Do not continue to Step 2 until every row matches. If a count or total
differs, the copy was taken mid-write — take it again.

### Step 2 — Deploy the backend, enforcement off

1. Paste the 6 files from §1.
2. Set the Script Properties from §2, with `AUTH_ENFORCEMENT = off`.
3. **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy.**

> **Update the existing deployment. Never "New deployment".**
>
> "New deployment" mints a new deployment id and therefore a **new `/exec`
> URL**. The live site would keep calling the old URL — which still serves the
> OLD code — so nothing you deployed would take effect, and pointing Vercel at
> the new URL means editing `VITE_API_URL` and redeploying the frontend, which
> is precisely the coupling this rollout order exists to avoid.
>
> Editing the existing deployment keeps the deployment id, keeps the URL, and
> simply points it at the new code version.

**What does and does not survive a redeploy**

| Thing | Where it lives | Survives? |
|---|---|---|
| `PASSWORD_PEPPER` | Script Properties (project) | **Yes** — unchanged by deploying |
| `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` | Script Properties (project) | **Yes** |
| `DB_FOLDER_ID` | Script Properties (project) | **Yes** |
| `AUTH_ENFORCEMENT` | Script Properties (project) | **Yes** |
| Sheets, and every row in them | Google Drive | **Yes** — deploying never touches data |
| Sessions people are signed in with | `Sessions` sheet | **Yes** |
| The `/exec` URL | The *deployment* | Yes if you edit it; **NO** if you create a new one |

Script Properties belong to the **project**, not to a deployment, so none of the
credentials change however you deploy. The one thing tied to the deployment is
the URL.

`PASSWORD_PEPPER` is worth naming explicitly: every stored password hash is
computed with it. If it were ever lost or regenerated, **every** password in
the system would stop verifying at once and everyone would be locked out —
recoverable only by reissuing passwords. It is generated once on first use and
then read, never rewritten. Copy it somewhere safe before you start.

At this point the existing site keeps working exactly as before. Already
active without any frontend change: secret redaction, Zoho account isolation,
commission idempotency, server-side validation, locking, audit logging, and
the reset guard.

### Step 3 — Migrate the schema

Run from the editor, in order, checking the log after each:

```
selfCheck()             // confirms all 6 files pasted correctly; read-only
setupCRMDatabase()      // creates Sessions, appends new columns
selfCheck()             // now expect no missing-column problems
preflightCheck()        // expect readyToEnforce: false — passwords missing
```

`selfCheck()` is read-only and safe to run at any time. It verifies that every
expected function exists, Script Properties are set, each sheet is reachable
with `ID` in column A and no columns missing, and that the router returns a
structured error. Run it again after each of the remaining steps.

### Step 4 — Issue passwords

```
bootstrapPasswords()
```

#### How temporary passwords work

| Property | Answer |
|---|---|
| How are they generated? | 16 characters drawn from a 55-character alphabet (ambiguous glyphs `O 0 I l 1` removed). |
| Cryptographically random? | Yes. The source is `Utilities.getUuid()`, which Apps Script derives from `java.util.UUID.randomUUID()` (a CSPRNG). Bytes are drawn with **rejection sampling** so every character is equally likely. |
| How much entropy? | ~92 bits. An earlier draft of this function used one hex nibble per position and a fixed `q7` suffix, giving only ~52 bits with three constant characters; that is fixed and locked down by test `MIGRATE-11`. |
| Where are they stored? | Nowhere. Only the salted hash is written to the sheet. The clear-text value exists only in the Apps Script execution log. |
| Do they expire? | **No.** There is no time-based expiry. What exists instead is a mandatory-change flag — see below. |
| Is the first-login change mandatory? | The account is flagged `MustChangePassword = TRUE`, and `login` returns `mustChangePassword: true`. The flag clears only when the user sets their own password via `changePassword`. **Backend enforcement is in place; the frontend does not yet force the change screen** — see §8 Known gaps. |
| Can a user clear the flag themselves? | No. `MustChangePassword` is a server-owned field, stripped from any client write (test `MIGRATE-13`). |
| What if one leaks? | Run `setPasswordFor('username', '<new value>')`. It re-flags the account for mandatory change and revokes every live session for that user immediately. |
| Is the execution log sensitive? | **Yes.** Treat it as a credential store while it holds these values. It is visible to anyone with edit access to the Apps Script project. Copy the passwords out, distribute them through a trusted channel, then clear the log (`View → Executions`). Do not paste the log into chat or a ticket. |

No user is deleted or recreated by this process. Existing accounts keep their
`ID`, `Username`, `Role`, `Team` and all history; only password columns are
written.

To set one manually: `setPasswordFor('username', 'their-new-password')`.

```
preflightCheck()        // expect readyToEnforce: true
```

### Step 5 — Watch for stragglers

```
setAuthEnforcement('warn')
```

Leave it for a day. Every unauthenticated call is written to `Logs` as
`UNAUTHENTICATED_CALL`. When the only entries are from the old frontend you
are about to replace, continue.

### Step 6 — Deploy the frontend

**Order matters and is not negotiable: backend first, frontend second.**

The new frontend calls actions the old backend does not have — `batch`,
`getStoredEmails`, `saveEmailDraft`, `getEmailAnalytics`, `syncMailbox`. Deploy
it against an un-updated backend and every page fails with **"Unknown action"**.
The reverse order is safe: the new backend serves the old frontend unchanged,
because nothing was renamed or removed.

1. Confirm `VITE_API_URL` in the Vercel project settings still points at the
   same `/exec` URL.
2. Deploy the new frontend.
3. Sign in with a bootstrapped password and confirm the app works.

If you see "Unknown action" anywhere after deploying, the backend is older than
the frontend. Re-paste the `.gs` files, then
**Deploy → Manage deployments → Edit → Version: New version → Deploy** — saving
the editor is not enough, because `/exec` keeps serving the last *deployed*
version. Edit the existing deployment; do not create a new one, or the URL
changes and the site carries on calling the old code.

### Step 7 — Enforce

```
setAuthEnforcement('on')
selfCheck()             // must report RESULT: OK
```

`selfCheck()` refuses to pass if enforcement is `on` while any active user
still has no password — that is the one mistake that locks everybody out.

Then verify: sign in, load each page, and confirm a signed-out browser gets
an authentication error rather than data.

### Rollback

| Symptom | Action |
|---|---|
| Users cannot sign in | `setAuthEnforcement('off')` — instant, no data change |
| A user is locked out | `setPasswordFor('username', 'new-password')` |
| Backend behaving badly | Redeploy the previous Apps Script version |
| Data looks wrong | Restore from the Step 1 sheet copies |

There is no bulk-delete function in this backend. The old reset script was
removed outright rather than guarded: it cleared six sheets — including the
audit trail — from a single click in the editor dropdown, and clearing sheets
is not a supported operation. **If that file still exists in your Apps Script
project, delete it.** Rollback is a redeploy plus, if needed, the verified
sheet copies from Step 1.

Schema changes need no rollback: the added columns are ignored by the old
code, so the previous backend runs against the migrated sheets unchanged.

---

## 4b. Speed, and the free-tier budget

Work per request is tens of milliseconds. What makes the deployed CRM feel
slow is that **every Apps Script invocation costs a second or more before it
does anything** — cold start, session lookup, opening the spreadsheet. So the
number of requests a page makes is what the user actually waits on, not the
amount of data.

| Screen | Requests before | Requests now |
|---|---|---|
| **Notification bar** (on every screen) | **1 per lead + 2**, every 60s | **1**, every 5 min |
| Dashboard | 6 | **1** |
| Lead detail | 6 | **1**, plus the live Zoho sync out of band |
| Admin | 5 | **1** |
| Daily logs | 2 | **1** |
| Meetings | 2 | **1** |

### The notification bar was the worst of it

`TopBar` looped over every visible lead and issued one `getLogs` request per
lead, then repeated the whole thing on a 60-second timer. It sits in the app
shell, so this ran on **every** screen, for every signed-in user.

At 183 leads that is 185 requests a minute — roughly 89,000 a day per person
over an eight-hour day. A consumer Apps Script project gets about **90 minutes
of total runtime a day**, shared by everyone. One user idling on any page would
exhaust it, which is why the CRM felt slow in ways no single page explained.

It now answers the same question — *which leads did we email today* — with one
filtered read, and it does not poll a tab nobody is looking at.

The other changes:

- **`batch`** runs up to 10 reads in one execution, sharing the per-request
  sheet cache instead of each read re-opening the same sheets. It is
  read-only by construction — see `BATCHABLE_ACTIONS` — so it cannot be used
  to smuggle a write past anything, and each sub-request is still checked
  against the same role table.
- **The daily feed narrows before it sorts.** It asked for one calendar day
  but sorted and permission-resolved every log row in the database first.
  That cost grew forever while the answer stayed the same size.
- **Screens ask for the logs they want.** The dashboard, Daily Logs, Meetings
  and Admin all used to fetch every log row ever written and discard 95%+ of
  it in the browser, over the slowest link in the system. `getLogs` now takes
  `logAction` (comma-separated) and `since`.

Things that stay deliberately bounded, because the quota is not ours to spend:

| Limit | Value | Why |
|---|---|---|
| `MAX_BATCH_SIZE` | 10 | One execution must stay well inside the 6-minute ceiling |
| `MAX_BODY_FETCH` | 15 | Full message bodies are one UrlFetch call each |
| `MAX_MAILBOX_SYNC` | 200 | A first mailbox sync is the most write-heavy thing here |
| `MAX_ATTACHMENT_BYTES` | 8 MB | Base64 inflates by ~⅓ and is held in memory |
| Draft autosave | 5 s idle | Every save is a Sheets write; per-keystroke would be absurd |
| Notification poll | 5 min, visible tabs only | Runtime allowance is shared by everyone signed in |

Syncing again is always safe — everything deduplicates on Zoho's message id,
so a capped sync simply picks up the next batch.

---

## 5. Verifying locally before you deploy

```bash
npm install
npm run verify:local
```

This runs typecheck, production build, a secret/backdoor scan, a data-integrity
report, and 93 tests covering authentication, RBAC, record scoping, financial
integrity, concurrency, migration safety and the frontend↔backend contract —
all against the **real** `.gs` sources, executed in Node with Google services
mocked. It never contacts production.

Individual suites:

```bash
npm run test:security
npm run test:migration
npm run test:contract
npm run check:production-safety
```

### Verify against YOUR data before deploying

The data-preservation report can be pointed at a copy of your real database.
Export each sheet to one JSON file keyed by sheet name — the same headers you
already have:

```json
{ "Users": [ { "ID": "...", "Username": "..." } ], "Leads": [ ... ] }
```

Then:

```bash
node local/scripts/data-preservation-report.mjs ./my-export.json
```

It loads the export into a **local in-memory copy**, runs the full migration,
and compares every record before and after. The export is read-only and
production is never contacted. Do not deploy if it reports anything other
than PASS.

---

## 5b. Staging first — production is not the test environment

**Do not run §4 against the live CRM yet.** Prove it against an isolated copy.

```
LOCAL  →  npm run verify:local
   ↓
STAGING  (separate Apps Script + copied Sheets + test Zoho)
   ↓
PRODUCTION
```

### Build the staging environment

1. **Copy the database.** In Drive, duplicate the `Databases` folder to
   `Databases_STAGING`. This is a copy of real data, so treat it with the same
   confidentiality as production.
2. **Create a separate Apps Script project.** Do not reuse the production one
   — a deployment there affects the live site immediately.
3. Paste the same 6 files from §1.
4. Set Script Properties pointing at the **staging** folder:

   | Property | Staging value |
   |---|---|
   | `MAIN_FOLDER_ID` | the staging folder id |
   | `ENVIRONMENT` | `test` |
   | `AUTH_ENFORCEMENT` | `off` (then step it up, as in §4) |
   | `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` | a **separate** Zoho client, or leave unset to skip mail |
   | `ZOHO_REDIRECT_URI` | your staging callback URL |

5. Deploy as a **new** web app. You now have a second `/exec` URL.
6. Point a preview Vercel deployment at it via `VITE_API_URL`. Do not change
   the production environment variable.

### What to verify in staging that local cannot show

| Area | How to check |
|---|---|
| Execution quota / 6-min limit | Run `getLeads` and `markDealWon` against the full copied dataset; check `View → Executions` for duration. |
| `LockService` contention | Fire two `markDealWon` requests for the same deal within a second (two browser tabs, or two `curl` calls). Exactly one commission row must exist; the other must return `LOCK_TIMEOUT`. |
| Sheets concurrency | Have two people edit different leads simultaneously; confirm neither write is lost. |
| Drive permissions | Confirm the script can read and write every sheet under the staging folder. |
| Real OAuth callback | Complete a full **Connect Zoho Mail** round trip and confirm the mailbox links. |
| Token refresh | Wait for the access token to expire (or revoke it in Zoho) and confirm the backend refreshes cleanly. |
| Account isolation | Link two staging users to two different mailboxes. Confirm neither can read or send as the other. |
| Deployed frontend | Log in, load every page, and confirm no CORS error appears in the browser console. |

Re-run the same gate against staging data before promoting:

```bash
node local/scripts/data-preservation-report.mjs ./staging-export.json
```

Only when every row above passes should you run §4 against production.

---

## 6. What local testing cannot prove

These require an isolated staging deployment (separate Apps Script project +
copied sheets + a test Zoho account) and must be checked there:

- real Apps Script execution quotas, the 6-minute limit, and genuine
  `LockService` contention between concurrent executions
- real Google Sheets concurrency and Drive permission behaviour
- live Zoho OAuth consent, real token expiry, and API rate limits
- Vercel routing, custom-domain behaviour, and environment-variable wiring
- true end-to-end browser behaviour against the deployed web app

Password hashing is `HMAC-SHA256` with a per-user salt and a server-side
pepper, iterated 750 times. This is chosen for the free-tier CPU budget, not
because it is ideal: it is weaker than bcrypt/scrypt against an attacker who
obtains **both** the sheet and the pepper. The pepper lives in Script
Properties rather than the spreadsheet specifically so that the realistic
breach — someone gaining read access to the Users sheet — yields nothing
crackable offline.

---

## 7. Web app access setting

The deployment must remain **Execute as: Me** / **Who has access: Anyone**,
because the browser calls it without a Google sign-in.

Previously that meant the entire database was readable and writable by anyone
who had the URL, since the backend performed no authentication at all. With
`AUTH_ENFORCEMENT = on`, "anyone can reach the endpoint" no longer implies
"anyone can read the data": every action except `login` now requires a valid
session token, and record scoping is applied server-side.
