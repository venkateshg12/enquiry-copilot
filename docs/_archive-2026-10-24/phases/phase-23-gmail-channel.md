# Phase 23 — Gmail intake and replies from the business address

## 1. Goal

Connect a business's own Gmail so that:
- new inbox emails become messages (polled with the Gmail **history API**, deduplicated by Gmail
  message id, the customer's text cleaned of quoted history and signatures, auto-replies and the
  business's own mail skipped);
- approved replies are sent **from the business address**, **in the same thread** (`threadId`,
  `In-Reply-To`, `References`, `Re:` subject);
- the OAuth refresh token is **sealed** (AES-256-GCM) and requested with the narrowest scopes;
- disconnect, reconnect and "auth revoked" are handled visibly.

It generalises the e-commerce/PaperTrail Gmail sender (one app address, a token in env) into a
per-business connection.

## 2. What I will understand after this phase

1. Per-tenant OAuth: state handling, scopes, token storage, revocation.
2. Incremental sync with `historyId`, and what to do when it expires.
3. Email threading headers, and why a reply without them looks like spam to the customer.
4. Google's rules for restricted scopes, and what they mean for a pilot.

## 3. Prerequisites

Phase 22 done. A Google Cloud OAuth client (reuse the project; add the redirect URI
`…/channels/gmail/callback`). Enable the Gmail API.

## 4. Files

```
apps/api/src/
├── utils/crypto/secretBox.ts               COPY   @pt-api/src/utils/crypto/secretBox.ts   (env key renamed TOKEN_SECRET_KEY → ADAPT if you rename)
├── utils/email/mime.ts                     ADAPT  (MIME builder extracted from @pt-api/src/services/gmail.service.ts; + extra headers)
├── services/gmail.service.ts               ADAPT  @pt-api/src/services/gmail.service.ts   (uses utils/email/mime.ts; re-tag in the copy map)
├── models/channel.model.ts                 NEW    ({ orgId, type: "gmail", emailAddress, tokenSealed, historyId, status, lastSyncAt, error })
├── services/businessGmail.service.ts       NEW    (connect, poll, parse, sendReply, disconnect)
├── controllers/channel.controller.ts · routes/channel.route.ts   NEW   (/channels/gmail/connect, /callback, DELETE, GET status)
├── jobs/processors/gmailPoll.processor.ts · workers/… · queues/…  NEW   (one repeatable poll per connected channel)
├── utils/email/parseInbound.ts             NEW    (pure: pick text part, strip quotes/signatures, detect auto-replies)
└── constants/env.ts                        ADAPT  (+ TOKEN_SECRET_KEY, BUSINESS_GMAIL_REDIRECT_URI, GMAIL_POLL_INTERVAL_MS)
apps/web/src/app/(app)/settings/channels/page.tsx   NEW
```

## 5. Concepts

**Scopes.** `gmail.readonly` (read new mail) + `gmail.send` (send replies). No `gmail.modify`: the app
tracks what it processed in its own database instead of labelling mail, so it never changes the
business's mailbox. Google classes `gmail.readonly` as a **restricted** scope:
- while the OAuth consent screen is in **Testing**, only listed test users can connect, and refresh
  tokens expire after **7 days**. That's fine for development and a single pilot (add the owner as a test
  user; reconnect weekly, or publish for longer-lived tokens);
- a public launch needs Google's verification, including a security assessment for restricted scopes.

Write this into `LIMITATIONS.md`. For a pilot, an **IMAP + app password** connection (the spec's
"IMAP polling") is the pragmatic alternative. It needs no verification, but app passwords require
2-step verification and are less granular. Design `channel.type` so `imap` can be added behind the same
interface.

**Per-business OAuth.** The same browser flow as PaperTrail's `gmailAuth.controller.ts` (random
`state` in an httpOnly cookie, compared in constant time), but:
- started by an authenticated **owner/admin** (`channels.manage`), with the `orgId` bound into the
  server-side state record, not trusted from the callback;
- `login_hint` is left out (it's the business's account, not ours);
- on callback: verify the state, exchange the code, check that **both scopes** were granted
  (`tokens.scope`), read the profile (`users.getProfile` → `emailAddress`, `historyId`), and
  `seal(refresh_token)` into the channel;
- the refresh token is never logged or returned (PaperTrail's rule).

**Incremental sync.**
1. On connect, store the profile's `historyId` as the cursor (start from now; don't import years of mail).
2. Every `GMAIL_POLL_INTERVAL_MS` (60 s), call `users.history.list({ startHistoryId, historyTypes: ["messageAdded"], labelId: "INBOX" })`.
3. For each new message id, `users.messages.get({ format: "full" })`.
4. Advance the cursor to the response's `historyId` **after** the messages are stored.

If Google answers 404 (the `historyId` is too old, e.g. after a long outage), fall back to
`messages.list({ q: "in:inbox newer_than:2d" })`, rely on the unique `{ orgId, externalId }` index for
dedupe, and store the new profile `historyId`.

**Which emails become messages.** Skip:
- mail **from** the connected address (our own replies);
- `Auto-Submitted` other than `no`, `X-Autoreply`, `Precedence: bulk|list|auto_reply`, and
  `List-Unsubscribe` from senders not in any prior thread (newsletters);
- messages not in INBOX.

Everything else is intake: `body` = the cleaned text part, `subject`, `fromName`/`fromEmail` from
`From`, `threadKey` = Gmail `threadId`, `externalId` = Gmail message id, `inReplyTo` and `messageIdHeader`
kept for threading. Stored with the outbox event, exactly like form intake (Phase 12).

**Cleaning inbound text** (`parseInbound.ts`, pure, tested):
1. prefer `text/plain`; else convert `text/html` to text (strip tags, decode entities);
2. cut quoted history at the first line matching `^On .+ wrote:$`, `^-----Original Message-----`, or a
   run of `>` lines;
3. cut a signature after `^-- $`, or common mobile footers ("Sent from my iPhone");
4. cap at 20,000 characters.

The classifier sees only what the customer just wrote.

**Threaded replies.** `sendReply(channel, message, reply)`:
- builds MIME with the shared builder:
  - `From: "<Business name>" <connected address>`;
  - `To: customer`;
  - `Subject: Re: <original>` (no double "Re: Re:");
  - `In-Reply-To: <original Message-ID>`;
  - `References: <original References> <original Message-ID>`;
  - `Message-ID: <reply-<replyId>@<domain>>`;
- sends it with `users.messages.send({ requestBody: { raw, threadId } })`.

The deterministic Message-ID lets a retried send job check the Sent folder
(`messages.list({ q: "rfc822msgid:<id>" })`) before sending again. That's exactly-once from the
customer's point of view.

**Revocation.** `invalid_grant` from Google (the owner removed access, or the 7-day Testing expiry) →
channel `status: "needs_reconnect"`, polling paused, an owner email via the system sender (Phase 08),
an inbox banner. Sends wait in `approved` with "Resend after reconnecting".

## 6. Steps

1. Extract the MIME builder from `gmail.service.ts` into `utils/email/mime.ts`, with optional
   `extraHeaders` (`In-Reply-To`, `References`, `Message-ID`, `Reply-To`) validated with the existing
   single-line/CRLF guard. `gmail.service.ts` keeps working (a test sends the same bytes as before for
   the same input).
2. `channel.model.ts` (+ tenant plugin; unique `{ orgId, type }` for the MVP).
3. Connect/callback routes and controller (above). `TOKEN_SECRET_KEY` is required at boot when any
   channel exists in production (PaperTrail's `WEBHOOK_SECRET_KEY` boot check pattern).
4. Polling: on connect, `upsertJobScheduler(\`gmail-poll:${orgId}\`, { every: GMAIL_POLL_INTERVAL_MS }, …)`.
   On disconnect, remove it. The processor runs `runWithRequestContext({ orgId })`, takes a short Redis
   lock per channel (`SET NX PX 55000`) so overlapping polls can't double-process, then syncs.
5. `parseInbound.ts` with fixtures: Gmail web, Outlook, iPhone, a Hinglish reply with quoted English,
   an auto-reply, a newsletter.
6. `sendReply` wired into `send.service` (Phase 22) for `channel === "email"`, and for form messages
   too once Gmail is connected (a new thread to the customer's email).
7. Settings → Channels: "Connect Gmail" → Google → back with "Connected as hello@sunrise…", last sync,
   errors, Disconnect (revokes the token at Google: `https://oauth2.googleapis.com/revoke`, deletes the
   sealed token, removes the scheduler).

## 7. Verify

1. Connect a test Gmail → the channel stores `emailAddress`, `historyId` and `tokenSealed` (no plaintext
   in the DB).
2. Send it an email from another account → within ~60 s it's a message with a cleaned body; the
   pipeline drafts; the inbox shows it.
3. Approve → the reply arrives **in the same thread** in the customer's mailbox, from the business
   address.
4. Send an auto-reply ("Out of office") → skipped. Our own sent reply → not ingested.
5. Duplicate delivery (re-poll the same range) → no duplicate messages (unique index).
6. Revoke access in the Google account → the next poll → `needs_reconnect`, banner, owner email.
7. Logs contain no tokens and no bodies (grep).

## 8. Definition of done

- [ ] Per-business Gmail connect with sealed tokens and minimal scopes.
- [ ] Incremental, deduplicated intake with cleaned text; auto-replies skipped.
- [ ] Threaded replies from the business address with exactly-once sending.
- [ ] Revocation handled; restricted-scope limits documented.
- [ ] Commit: `feat: Gmail channel — intake and threaded replies`.

## 9. Interview angle

*"How does it read and reply to email?"* Per-business OAuth with read and send scopes only (it never
modifies the mailbox), the refresh token sealed with AES-GCM, incremental sync via Gmail's history API
with deduplication, and replies threaded with proper headers and a deterministic Message-ID, so a retry
can't send twice. I'm also upfront that the read scope is restricted and what that means for launching.
