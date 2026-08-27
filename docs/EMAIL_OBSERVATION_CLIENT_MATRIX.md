# Email observation — mechanism compatibility audit

**Question:** can a signature component be resolved from the server *at the moment
the recipient renders the message*, delivering server-originated **text**, without
using an image, SVG, tracking pixel, wrapped link, JavaScript, iframe, or AMP?

**Answer: no. There is no such mechanism in any major email client.**

This document records why, mechanism by mechanism, so the question does not have
to be re-opened from scratch.

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
| 5 | CSS `@import url()` | — | As above | Stripped with the rest of remote CSS |
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
Founder             ← Users.Role
TJGROUPS
```

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

| Client | Mechanism under test | Result |
|---|---|---|
| Gmail Web / mobile | none qualifying | N/A — no candidate |
| Outlook Web / Desktop / M365 | none qualifying | N/A — no candidate |
| Apple Mail macOS / iOS | none qualifying | N/A — no candidate |
| Zoho Mail | none qualifying | N/A — no candidate |
| Defender / Proofpoint / Mimecast / Barracuda | none qualifying | N/A — no candidate |

This table becomes live the moment a qualifying adapter is proposed.
