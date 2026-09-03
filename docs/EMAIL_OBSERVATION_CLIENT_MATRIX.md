# Email observation — mechanism compatibility audit

**Question:** can a signature component be resolved from the server *at the moment
the recipient renders the message*, delivering server-originated **text**, without
using an image, SVG, tracking pixel, wrapped link, JavaScript, iframe, or AMP?

**Answer: no validated universal mechanism exists** under these constraints and
the documented target matrix.

This document records why, mechanism by mechanism, so the question does not have
to be re-opened from scratch.

> **One row is under active measurement.** An earlier revision of this document
> recorded `@import` (row 5) as stripped and marked the whole matrix "N/A —
> nothing to send". That was an assertion, not a measurement, and the matrix
> then recorded the assumption as a result. Experiment **E-001** exists to
> settle it. Until it reports, row 5 is **untested**, not closed — see §6.

---

## 1. The complete set of render-time fetch mechanisms

An email client can only issue a network request while rendering a message
through one of the following. There is no other surface — this list is
exhaustive for HTML email as the format is actually implemented.

| # | Mechanism | Fetches? | Can carry **text**? | Verdict here |
|---|---|---|---|---|
| 1 | `<img src>` | Yes | Only as pixels | **Excluded by requirement** |
| 2 | CSS `background-image: url()` | Yes | Only as pixels | Excluded (§15) — still an image |
| 3 | `@font-face { src: url() }` | Yes | **No** — carries glyph outlines, not content | Excluded (§15), and cannot express a name |
| 4 | `<link rel="stylesheet">` | — | CSS `content:` could in principle | **Stripped by Gmail, Outlook, Apple Mail.** No request is ever made |
| 5 | CSS `@import url()` | ? | **Yes**, via `content:` on a pseudo-element | **UNDER TEST — E-001.** The only candidate matching the requirement exactly |
| 6 | `<iframe>` / `<object>` / `<embed>` | Yes | Yes | Excluded (§15) and stripped by every major client |
| 7 | JavaScript `fetch` / `XMLHttpRequest` | Yes | Yes | `<script>` is removed before render, everywhere |
| 8 | WebSocket | Yes | Yes | Requires JavaScript. Same removal |
| 9 | AMP for Email `<amp-list>` | Yes | **Yes** | Excluded by requirement. Also needs Google/Yahoo sender registration; unsupported in Outlook and Apple Mail |
| 10 | `<video>` / `<audio>` remote `src` | Sometimes | No | Not text; unsupported or stripped in most clients |
| 11 | `<link rel="preload" / "prefetch">` | Sometimes | No | Stripped |
| 12 | `message/external-body` (RFC 2017) | By design | **Yes** | The one *standards-defined* candidate. **No modern client implements it.** Dates from the anonymous-FTP era |
| 13 | Server-side includes / template merge | No client fetch | Yes | Resolves at **send** time, not render time — see §3 |

### The two rows that matter

**Row 4** is the mechanism most people reach for, and it is the reason this
question keeps resurfacing. A remote stylesheet *could* inject text through
`content:` on a pseudo-element. But Gmail, Outlook and Apple Mail all remove
`<link>` from message HTML before rendering. The request is never issued, so
there is nothing to observe and nothing to inject.

**Row 12** is the honest curiosity: MIME genuinely defines a body part whose
content is fetched from elsewhere. It is a real standard. It is also
effectively dead — no mainstream client has implemented it in decades, and a
message relying on it renders as an unresolved stub.

---

## 2. Why the intersection is empty

The requirement asks for three properties at once:

1. resolved from the server **at render time**
2. delivering **text**
3. **not** an image, link, script, iframe, or AMP

Every mechanism that satisfies (1) either fails (2) — it is an image or a font —
or is removed by the client before it can run. Removing images and AMP from the
candidate set leaves nothing.

This is not a Zoho limitation, and not a limitation of this CRM. Zoho's API
transports whatever HTML it is given. The constraint lives entirely in the
**recipient's client**, which deliberately refuses to let a delivered message
reach back to its sender. That refusal is the security model working as
designed.

**Classification for the adapter registry: `NO_REMOTE_EXECUTION`.**

---

## 3. What *is* achievable, and is not a consolation prize

The requirement conflates two separable problems.

### Problem A — a server-controlled dynamic signature

**Fully solvable, no image, available now.**

The CRM knows the authenticated sender. The signature can be composed
server-side at send time from the authoritative `Users` record:

```
Best regards,

Dhiraj T H          ← Users.DisplayName
Founder             ← Users.SignatureTitle
TJGROUPS            ← SIGNATURE_ORG_NAME
```

> **Not `Users.Role`.** An earlier revision of this document said `Founder ←
> Users.Role`. `Role` is the RBAC role — `SUPER_ADMIN`, `ADMIN`, `SALES_REP`,
> `SETTER` — so following that literally signs real mail to a prospect
> "SALES_REP". `Users.SignatureTitle` was added for this and nothing else.

Another user sending the same email gets their own approved signature. Nothing
is hardcoded, nothing is derived from an email address when a `DisplayName`
exists, and the same record already drives `formatFromAddress()` for the From
header. There is no second identity system.

This is genuinely dynamic and genuinely server-controlled. What it is **not** is
*render-time* — the text is fixed once the message leaves. For a signature, that
distinction has no practical cost: a person's name does not change between
sending and opening.

### Problem B — observing that the message was rendered

**Not solvable within the stated constraints.**

With images and AMP excluded, no event leaves the recipient's environment. The
CRM has nothing to record. No classifier, ledger or notification pipeline can
manufacture a signal that was never emitted.

---

## 4. Consequence for the architecture

The observation subsystem is still worth building as *structure*, because the
structure is what survives:

- `SignatureObservationAdapter` — the interface
- `StaticFallbackAdapter` — the only adapter that qualifies today, and the
  correct default
- token service, raw event ledger, classifier, CRM adapter — inert until an
  adapter exists that can feed them

If a client ever ships a compliant mechanism, it plugs in behind the interface
without the CRM core changing. If none ever does, the CRM still sends correct,
personalised, server-controlled signatures and nothing was wasted.

What must **not** happen is an image adapter being enabled and reported as
satisfying the requirement. Per §32, the recorded outcome is the one above.

---

## 5. Test matrix status

No mechanism reached the point of being worth testing against live clients. The
matrix below is therefore recorded as **not applicable**, rather than untested —
there is nothing to send.

| Client | Mechanism under test | REQUEST? | Fetched before manual open? | UA / country | Notes |
|---|---|---|---|---|---|
| Gmail Web | `@import` + `content:` | — | — | — | not yet run |
| Gmail mobile | `@import` + `content:` | — | — | — | not yet run |
| Outlook Web | `@import` + `content:` | — | — | — | not yet run |
| Outlook Desktop / M365 | `@import` + `content:` | — | — | — | not yet run |
| Apple Mail macOS | `@import` + `content:` | — | — | — | not yet run |
| Apple Mail iOS | `@import` + `content:` | — | — | — | not yet run |
| Zoho Mail | `@import` + `content:` | — | — | — | not yet run |
| **V0 control (plain text)** | none | **must be NO** | — | — | if this fetches, the experiment is broken |

---

## 6. E-001 — how to run it

```
node local/probe/build-probe-emails.mjs
```

Writes one message per client to `local/probe/out/`, each carrying a different
opaque label so a log line identifies its own client. Send each by hand from
any mail client — **not** through the CRM, so production sending cannot be
contaminated. Then read the Vercel function logs and fill in the table above.

The endpoint is `api/email-observation/sig/[token].js`, served from the
existing CRM origin at `/api/email-observation/sig/<label>.css`. It needs no
DNS change and no `vercel.json` change: Vercel resolves `/api/*` before the
SPA catch-all rewrite.

**Each probe message carries a complete static signature as well.** If the
stylesheet is stripped — the expected outcome for most clients — the recipient
still sees a correct sign-off. A probe that renders as a blank gap in
someone's inbox would be a defect, not an experiment.

### What this experiment does and does not answer

It answers exactly one question: **does any target client issue the request?**

It does **not** establish that a request means a human opened the message. Do
not record a fetch as `human`, `precheck`, or `opened`. If requests do appear,
a second experiment is needed to test whether timing, network class and
sequence can separate prefetch from human rendering — and Apple Mail's Privacy
Protection fetches remote content in the background regardless of engagement,
so a request from that client would carry very little information about a
person.

### Outcomes

- **No client requests it** → record `NO_REMOTE_EXECUTION`, and Phase 2 closes
  on evidence rather than assumption.
- **One or more clients request it** → preserve the raw log, stop, and do not
  build production observation logic until the follow-up experiment reports.
