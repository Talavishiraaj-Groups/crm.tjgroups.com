# Email deliverability — why CRM mail lands in spam

Investigated 2026-08-19 against the live `tjgroups.com` DNS. This is mostly a
DNS and sending-practice matter, not a code defect. One genuine code defect was
found and fixed; everything else below needs a decision from you, not a deploy.

## What is already correct

Queried against `8.8.8.8`:

| Record | Value | Verdict |
| --- | --- | --- |
| SPF | `v=spf1 include:zoho.in include:spf.protection.outlook.com -all` | Valid, hard-fail. Zoho is authorised. |
| DKIM | `zmail._domainkey` → `v=DKIM1; k=rsa; p=MIGf…` | Present and published. |
| DMARC | `v=DMARC1; p=none; rua=…; ruf=…; sp=none; adkim=r; aspf=r; pct=100` | Present. Policy is `none`. |
| MX | `10 mx.zoho.in`, `20 mx2.zoho.in`, `50 mx3.zoho.in` | Zoho India, consistent with the SPF include. |

**Mail sent through Zoho from `@tjgroups.com` authenticates.** SPF passes, DKIM
signs with `d=tjgroups.com`, both align, so DMARC passes too. Spam placement is
therefore *not* caused by an authentication failure — anyone telling you to "fix
SPF" is looking at the wrong thing.

## The code defect (fixed)

`sendZohoEmail` hard-coded `mailFormat: 'html'`, but the composer is a plain
`<textarea>`. Every message was declared HTML while containing no markup:

- **Line breaks were destroyed.** HTML collapses whitespace, so a message typed
  as three paragraphs arrived as one run-on block. This was visible to every
  recipient of every email the CRM has ever sent.
- **All outbound mail was HTML-only with no plain-text part.** Filters score
  against this — SpamAssassin's `MIME_HTML_ONLY` rule is the well-known one.

`detectMailFormat()` now sends `plaintext` unless the body actually contains
tags. Covered by `MAIL-9` and `MAIL-10`.

## What is left, in order of expected impact

### 1. Cold outreach to people who never opted in

This is almost certainly the dominant factor and no DNS record fixes it. A new
sending domain making unsolicited 1:1 sales approaches will be filtered until it
builds reputation. Recipients marking mail as spam is the single strongest
signal any filter has, and it outweighs every technical control below.

Mitigations are behavioural: lower volume per mailbox per day, real
personalisation, stop mailing addresses that never reply, and make sure the
first message is one a human would answer.

### 2. DMARC is `p=none`

`p=none` does not cause failures — mail still authenticates and passes DMARC.
But it publishes "I do not care what you do with mail that fails", which
receivers weigh as a weaker reputation signal than an enforcing policy.

The `rua` reports are already going to `info@tjgroups.com`. **Read them for a
few weeks first.** They will tell you whether anything legitimate still sends as
`@tjgroups.com` outside Zoho. Only once those are clean, move to
`p=quarantine; pct=25`, then raise `pct`, then `p=reject`.

Do not jump straight to `p=reject`. If anything else is still sending as the
domain, it will start bouncing silently.

### 3. The SPF record still authorises Microsoft 365

`include:spf.protection.outlook.com` authorises every Microsoft 365 tenant to
send as `tjgroups.com`. If nothing is sending through M365 any more, remove it —
it widens the authorised set for no benefit, and each include costs one of the
ten DNS lookups SPF allows.

Confirm from the DMARC `rua` reports before removing, not from memory.

### 4. The DKIM key is 1024-bit

The published `p=` is a 1024-bit RSA modulus. It is accepted everywhere, but
2048-bit is the current recommendation and some receivers treat 1024 as a weak
signal. Zoho's admin console can rotate to a 2048-bit key; that is a DNS change
plus a re-publish in Zoho, done by hand.

### 5. No `List-Unsubscribe` header

Not required for genuine 1:1 conversation, and adding one to personal sales mail
looks like bulk marketing. Mentioned only so it is a conscious decision rather
than an oversight. **Do not add it** unless the CRM starts sending anything
resembling a campaign — at which point it becomes mandatory under Google's and
Yahoo's bulk-sender rules.

## What cannot be determined from here

Domain and IP reputation with each receiver, whether any particular message was
filtered on content, and whether recipients have been marking mail as spam.
Google Postmaster Tools (add `tjgroups.com`, verify by DNS TXT) is the only way
to see Gmail's own view of the domain, and Gmail is where this will be decided.
