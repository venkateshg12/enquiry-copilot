# Phase 25 — Gmail channel: intake and replies from the business address

## 1. Goal

Connect a business's **own** Gmail so that:

- new inbox emails become messages. They're polled with the Gmail **history API** every 60 s,
  deduplicated by Gmail message id, filtered (INBOX only, not Promotions/Social, nothing older than
  the connection, no auto-replies, not our own sent mail), and cleaned of quoted history and
  signatures;
- approved replies go out **from the business address**:
  - for an email message, **in the same thread** (`threadId` + `In-Reply-To` + `References` + matching
    `Subject`);
  - for a form message, as a new thread to the customer;
- the refresh token is **sealed** with AES-256-GCM (`secretBox.ts`), and only `gmail.readonly` +
  `gmail.send` are requested;
- `invalid_grant` moves the connection to `needs_reauth`, pauses polling and emails the owner;
  disconnecting **revokes** the token at Google.

It turns e-commerce's single-sender Gmail setup (one app address, a token in env) into one
connection per business, stored in the database.

## 2. What I will understand after this phase

1. Per-tenant OAuth: binding the callback to the user and business that started it, checking granted
   scopes, and storing a refresh token safely.
2. Incremental sync with `historyId`, and the full resync when Google returns 404.
3. Email threading, and why a reply without the right headers lands as a new conversation.
4. What Google's restricted-scope rules mean for a pilot (Testing mode, 7-day tokens, verification).
5. Why the app never modifies the business's mailbox.

## 3. Prerequisites

- Phase 24 done: `send.service.ts` has the `// Phase 25:` branch.
- Phase 13's intake service (`ingestMessage`) writes a `Message` and its `message.received` outbox
  event in one transaction.
- In Google Cloud (the project from Phase 08): enable the Gmail API. Add the scopes
  `gmail.readonly` and `gmail.send` to the consent screen, add the owner's account as a **test user**,
  and add the redirect URI `${API_URL}/orgs/gmail/callback`.

## 4. Files

```
apps/api/prisma/schema.prisma                      ADAPT  (+ GmailStatus, GmailConnection; Org back-relation)
apps/api/prisma/migrations/<ts>_gmail/             NEW
apps/api/src/
├── utils/crypto/secretBox.ts                      ADAPT  @pt-api/src/utils/crypto/secretBox.ts   (one line: the key is SECRET_BOX_KEY, not WEBHOOK_SECRET_KEY)
├── constants/env.ts                               ADAPT  (+ SECRET_BOX_KEY, GMAIL_CHANNEL_REDIRECT_URI, GMAIL_POLL_INTERVAL_MS=60000, OAUTH_STATE_SECRET)
├── config/gmail.ts                                ADAPT  @pt-api/src/config/gmail.ts  (+ CHANNEL_SCOPES, getChannelOAuthClient())
├── utils/email/mime.ts                            NEW    (the MIME builder extracted from @pt-api/src/services/gmail.service.ts, + extra headers)
├── services/gmail.service.ts                      ADAPT  (system sender now imports utils/email/mime.ts; behaviour unchanged)
├── utils/email/parseInbound.ts (+ .test.ts)       NEW    (pure: pick the text part, decode, strip quotes/signature, detect auto-replies)
├── utils/oauthState.ts                            NEW    (HMAC-signed state: orgId, userId, nonce, exp)
├── services/gmailChannel.service.ts               NEW    (connect, callback, poll, sendReply, disconnect, alreadySent)
├── controllers/gmailChannel.controller.ts         NEW
├── routes/gmailChannel.route.ts                   NEW    /orgs/:orgId/gmail/{connect,status,disconnect}, /orgs/gmail/callback
├── jobs/queues/gmailPoll.queue.ts · processors/gmailPoll.processor.ts · workers/gmailPoll.worker.ts   NEW
├── services/send.service.ts                       ADAPT  (fill the Phase 25 branch)
├── utils/email/gmailTransport.ts                  NEW    (the one seam to Gmail: real | recording; setGmailTransport() for tests)
└── db/prisma.ts                                   ADAPT  (+ "GmailConnection" in TENANT_MODELS)
apps/web/src/app/(app)/settings/channels/page.tsx  NEW    (connect, status, last poll, errors, disconnect)
apps/web/src/components/layout/ReauthBanner.tsx    NEW
```

Fixtures for `parseInbound.test.ts` live in `apps/api/src/utils/email/__fixtures__/`: Gmail web,
Outlook, iPhone, a Hinglish reply quoting English, an out-of-office reply, a newsletter.

## 5. Concepts

**Scopes, and why not more.** `gmail.readonly` reads new mail. `gmail.send` sends replies. There's
no `gmail.modify`: the app records what it processed in its own table (`Message.gmailMessageId`)
instead of labelling mail, so it never changes the owner's mailbox. That's an easy promise to make to
a business owner, and it's true.

Google rates `gmail.readonly` as **restricted** and `gmail.send` as **sensitive**:
- while the consent screen is in **Testing**, only listed test users can connect, and their refresh
  tokens **expire after 7 days**. That's fine for development and a single pilot (reconnect weekly,
  or publish the app);
- a public launch needs Google's verification, and restricted scopes add a security assessment.

Write both points into `LIMITATIONS.md` (Phase 33). `needs_reauth` (below) is what makes a weekly
expiry a nuisance rather than an outage.

**Binding the callback to who started it.** PaperTrail's `gmailAuth.controller.ts` (copied in Phase 08)
protects a one-off admin setup with a random `state` in an httpOnly cookie. Here, many owners connect
many businesses, so the state must also say **which business, and who asked**, and it must not be
forgeable:

```ts
// utils/oauthState.ts
import crypto from "node:crypto";
import { OAUTH_STATE_SECRET } from "../constants/env";

type State = { orgId: string; userId: string; nonce: string; exp: number };
const sign = (body: string) => crypto.createHmac("sha256", OAUTH_STATE_SECRET).update(body).digest("base64url");

export const createState = (orgId: string, userId: string) => {
  const state: State = { orgId, userId, nonce: crypto.randomBytes(16).toString("base64url"), exp: Date.now() + 10 * 60_000 };
  const body = Buffer.from(JSON.stringify(state)).toString("base64url");
  return { value: `${body}.${sign(body)}`, nonce: state.nonce };
};

export const readState = (value: string): State | null => {
  const [body, mac] = value.split(".");
  if (!body || !mac) return null;
  const expected = sign(body);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  const state = JSON.parse(Buffer.from(body, "base64url").toString()) as State;
  return state.exp > Date.now() ? state : null;
};
```

The nonce also goes into an httpOnly cookie scoped to the callback path. The callback runs behind
`authenticate` (Google returns the browser with a top-level GET, so `SameSite=Lax` auth cookies
arrive), and it requires **all** of:
- the signature is valid and the state hasn't expired;
- the cookie nonce equals `state.nonce`;
- `state.userId === req.userId`;
- the user is still the business's owner (role read live, Phase 10).

A link that starts someone else's consent flow can't attach their mailbox to your business.

**Callback.**
1. Exchange the code.
2. Require `tokens.refresh_token` (`access_type: "offline"`, `prompt: "consent"`, as in Phase 08).
3. Require both scopes in `tokens.scope`. If the owner unticked one, answer 400 "Gmail needs read and
   send access" and store nothing.
4. Call `users.getProfile` → `emailAddress` and `historyId`.
5. Upsert the `GmailConnection` with `sealedRefreshToken: seal(refresh_token)`, `historyId`,
   `status: connected`.
6. `upsertJobScheduler(\`gmail-poll:${orgId}\`, { every: GMAIL_POLL_INTERVAL_MS }, …)` and an audit row.
7. Redirect to `${CLIENT_URL}/settings/channels?connected=1`.

The token is never logged, returned or put in a job payload (jobs carry `orgId` only). Starting from
the profile's `historyId` means the connection **imports nothing from the past**. A business
connecting its five-year-old inbox gets new mail from now on, not a flood of drafts for 2021.

**Incremental sync** (Google's partial sync):
```
history.list({ userId: "me", startHistoryId, historyTypes: ["messageAdded"], labelId: "INBOX", pageToken })
  → every page's messagesAdded[].message.id
  → for each: messages.get({ format: "full" }) → filter → parseInbound → ingestMessage (unique (orgId, gmailMessageId): P2002 = already have it, skip)
  → after ALL are stored: historyId = the response's historyId; lastPolledAt = now
```
The cursor advances only after the messages are stored. A crash mid-poll re-reads the same range next
minute, and the unique index makes that harmless.

**Full resync on 404.** Google keeps history "typically for at least one week", sometimes much less.
If `startHistoryId` is out of range, `history.list` returns **HTTP 404**, and the client must do a full
sync. Here that means:
```
messages.list({ q: "in:inbox -category:promotions -category:social after:<unix(max(connectedAt, lastPolledAt − 2 d))>" }), every page
  → the same filter → ingest (dedupe by the unique index)
  → historyId = users.getProfile().historyId
```
It's bounded by the connection time, so a resync never imports mail from before the business
connected.

**Which emails become messages.** Skip any message where:
- `labelIds` lacks `INBOX`, or contains `SENT`, `DRAFT`, `SPAM`, `CATEGORY_PROMOTIONS` or `CATEGORY_SOCIAL`;
- `internalDate` is before `connection.createdAt`;
- `From` is the connected address (our own replies, and the owner writing to themselves);
- `Auto-Submitted` is present and not `no`, or `X-Autoreply` / `X-Autorespond` is present, or
  `Precedence` is `bulk`, `list`, `junk` or `auto_reply`;
- there's a `List-Unsubscribe` header and the thread has no earlier message from us (a newsletter, not
  a customer replying).

Everything else is intake, through **the same `ingestMessage`** as the form (Phase 13):

| Field | From |
| --- | --- |
| `channel` | `"email"` |
| `fromName`, `fromContact` | the parsed `From` header (display name, lower-cased address) |
| `subject` | `Subject` |
| `body` | `parseInbound(payload).text` |
| `receivedAt` | `internalDate` |
| `gmailMessageId`, `gmailThreadId` | `id`, `threadId` |
| `rfcMessageId` | the `Message-ID` header |

One intake path means the pipeline, limits, outbox and tenant scoping are identical for both channels.

**Cleaning inbound text** (`parseInbound.ts`, pure, fixture-tested):
1. Walk `payload.parts` recursively. Prefer `text/plain`; else take `text/html` and strip tags, drop
   `<style>`/`<script>`, decode entities, and turn `<br>`/`</p>` into newlines.
2. Decode the base64url body using the part's `charset` (`TextDecoder` for `utf-8`, `iso-8859-1`,
   `windows-1252`; anything else is treated as UTF-8).
3. Cut quoted history at the first line matching `^On .+wrote:$` (also across a wrapped line),
   `^-----Original Message-----`, `^From: .+` after a blank line (Outlook), or the first run of lines
   starting with `>`.
4. Cut a signature after `^-- $`, or common mobile footers (`Sent from my iPhone`, `Sent from my Android`,
   `Get Outlook for …`).
5. Trim, collapse three or more blank lines into one, and cap at 5,000 characters (`Message.body`'s limit).

The classifier then sees only what the customer just wrote, not the business's previous reply quoted
underneath. Without this step every follow-up "looks" like it mentions prices.

**Threaded replies.** `sendReply(connection, message, reply)` builds MIME with the shared builder:
```
From:        "<Org.name>" <connection.emailAddress>
To:          message.fromContact
Subject:     Re: <original subject>          (no "Re: Re:"; for a form message: "Re: Your enquiry to <Org.name>")
In-Reply-To: <message.rfcMessageId>          (email messages only)
References:  <original References> <message.rfcMessageId>   (read with messages.get(format: "metadata", metadataHeaders: ["References"]))
Message-ID:  <reply-<replyId>@<MESSAGE_ID_DOMAIN>>
```
It then sends with `users.messages.send({ userId: "me", requestBody: { raw, threadId: message.gmailThreadId } })`.
Gmail threads a message only when the `threadId` is set, `References`/`In-Reply-To` follow RFC 2822,
**and** the subjects match. All three are needed.

`alreadySent(reply)` (used by Phase 24's retry path) is
`messages.list({ q: \`rfc822msgid:<reply-${id}@…>\` })` on the same mailbox.

**Revocation and expiry.** A refresh that answers `invalid_grant` means the owner removed access in
their Google account, or the 7-day Testing expiry hit. The connection moves to `needs_reauth` with a
`lastError` code, the poll processor skips it (the scheduler stays, so reconnecting resumes it), the
owner gets one system email (Phase 08, deduped by `jobId: gmail-reauth-<orgId>-<yyyy-mm-dd>`), and the
web app shows `ReauthBanner`. Replies approved meanwhile fail with `GmailAuthInvalid` and wait as
`failed` with **Resend** (Phase 24). Nothing is lost, nothing is sent from the wrong address.

**Disconnect.** `POST …/gmail/disconnect` (owner) calls `oauth2Client.revokeToken(open(sealedRefreshToken))`
(best effort: a token that's already revoked is fine), deletes the row, removes the job scheduler and
writes an audit row. From then on, replies fall back to the system sender (Phase 24's table).

## 6. Steps

1. **Schema.** Add `GmailStatus` and `GmailConnection` (data-model.md) and the
   `gmailConnection GmailConnection?` back-relation on `Org`. The Message unique
   `@@unique([orgId, gmailMessageId])` is already there from Phase 13; this migration only adds the new
   table. `"GmailConnection"` goes in `TENANT_MODELS`.
   `pnpm --filter api db:migrate:dev --name gmail`.
2. **secretBox.** Copy `@pt-api/src/utils/crypto/secretBox.ts` and change only the import to
   `SECRET_BOX_KEY` (32 bytes base64, checked at boot by the existing length guard). Generate it with
   `openssl rand -base64 32`. **Losing it means every business reconnects.** Store it in the
   deployment's secret store, never in the database.
3. **MIME builder.** Move `encodeHeaderValue`, `encodeBody`, `bodyPart` and `buildMimeMessage` out of
   `gmail.service.ts` into `utils/email/mime.ts`. Export `buildMime({ from, to, subject, text, html?, headers? })`,
   where `headers` is a validated map of `In-Reply-To | References | Message-ID | Reply-To`, each
   passed through the existing `singleLine` refinement. Add a test that the system sender still
   produces byte-identical MIME for the same input.
4. **`config/gmail.ts`.** Add `CHANNEL_SCOPES = [gmail.readonly, gmail.send]` and
   `getChannelOAuthClient(refreshToken?)`: a **new** `OAuth2Client` per business (same client id and
   secret as Phase 08, redirect `GMAIL_CHANNEL_REDIRECT_URI`). Never reuse the system client: it holds
   the system sender's credentials.
5. **`gmailChannel.service.ts`.** Implement `startConnect`, `completeConnect`, `poll` (incremental +
   404 resync + filters), `sendReply`, `alreadySent` and `disconnect`. Map Google errors with Phase 08's
   `toAppError` pattern. **Never log a Gaxios error object**: it carries the request config, including
   the `Authorization` header.
6. **Poll processor.** It runs `runWithRequestContext({ orgId, jobId }, …)` and takes a Redis lock
   (`SET lock:gmail-poll:<orgId> 1 NX PX 55000`) so a slow poll and the next tick can't overlap. It
   returns early unless `status === "connected"`, then calls `poll()`. Worker concurrency is 5 (I/O
   bound; Gmail's per-user quota is far above one poll a minute).
7. **`send.service.ts`.** Fill the Phase 25 branch: a connected business with an email contact →
   `sendReply` (threaded for `channel === "email"`, a new thread for form messages).
   **One transport seam.** `gmailChannel.service.ts` never calls `googleapis` directly for sends and
   polls. It calls `getGmailTransport()` from `utils/email/gmailTransport.ts`, which returns:
   - `real`: `users.messages.send`, `users.history.list` and `users.messages.get` through googleapis;
   - `recording`: appends `{ orgId, raw, threadId, at }` to the dev mailbox (Phase 08's `devMailbox`)
     and returns a fake id. Used when `NODE_ENV !== "production"` **and** no connection exists, and
     **always for an org with `isDemo = true`**, so the public demo can never email a real address.
   Tests call `setGmailTransport(fakeGmail)` (Phase 31's `test/helpers/fakeGmail.ts`, which also
   scripts `history.list`/`messages.get` for polls).
8. **Routes.**
   - `GET /orgs/:orgId/gmail/connect` (owner): redirect to Google.
   - `GET /orgs/gmail/callback`: `authenticate` only, because the org comes from the signed state, not
     the URL.
   - `GET /orgs/:orgId/gmail/status` (admin): returns `{ emailAddress, status, lastPolledAt, lastError }`,
     never the token.
   - `POST /orgs/:orgId/gmail/disconnect` (owner).
9. **Business deletion.** Resolve Phase 10's `// Phase 25:` comment in `deleteOrg`: before the
   delete transaction, read and unseal the connection's refresh token; after the commit (the cascade
   removes the row), call `revokeToken` best effort, and log a failure without the token. A failed
   revoke never blocks the deletion.
10. **Web.** Settings → Channels:
   - "Connect Gmail" → Google → back to "Connected as hello@codenest.in · last checked 20 s ago".
   - Disconnect, with a confirmation.
   - A plain-language list of what's read and sent (from `data-handling.md`).
   - `ReauthBanner` across the app for `needs_reauth`.

## 7. Verify

```bash
pnpm --filter api test -- parseInbound mime     # fixtures: quotes cut, signature cut, auto-reply flagged, MIME unchanged
```

1. Connect a test Gmail. Then:
   `psql $DATABASE_URL -c "select email_address, status, left(sealed_refresh_token, 12) from gmail_connections"`
   → the address, `connected`, and an `iv.tag.ciphertext` value (no `1//` prefix of a raw Google
   refresh token anywhere).
2. Email the connected address from another account → within ~60 s a message with `channel = email`
   appears, with the cleaned body. It's drafted and shows in the inbox.
3. Approve → the reply arrives **in the same thread** in the sender's mailbox, from the business
   address. In the business's Sent folder it sits in that thread too.
4. Send an out-of-office auto-reply and a newsletter (with `List-Unsubscribe`) → both skipped (debug
   log `gmail.skip` with a reason code, no content).
5. Re-run a poll over the same range (set `history_id` back) → no duplicate messages.
6. Set `history_id` to `1` → `history.list` 404 → a full resync, bounded by the connection time, and no
   duplicates.
7. Revoke the app at myaccount.google.com/permissions → the next poll moves the connection to
   `needs_reauth`, the owner gets one email, the banner shows, and an approval made now ends as
   `failed` with Resend. Reconnect → Resend → delivered in-thread.
8. Disconnect → the Google permissions page no longer lists the app; the row and scheduler are gone.
9. `grep -iE "refresh_token|ya29\.|1//|Authorization" api.log worker.log` → nothing.

## 8. Definition of done

- [ ] Per-business connect with signed, user-bound state, a scope check and a sealed refresh token.
- [ ] Incremental history polling with a bounded full resync on 404, filters, and dedupe by the unique index.
- [ ] Inbound text cleaned by a pure, fixture-tested parser.
- [ ] Threaded replies from the business address; form replies from the business address once connected.
- [ ] `needs_reauth` handling, owner email, banner; disconnect revokes at Google.
- [ ] Restricted-scope limits noted for `LIMITATIONS.md`; Verify steps 1–9 pass.
- [ ] Commit: `feat(api,web): Gmail channel — intake and threaded replies`.

## 9. Interview angle

*"How does it read and reply to email?"*
- **Access:** per-business OAuth with read and send scopes only, so it never modifies the mailbox. The
  consent flow's state is HMAC-signed and bound to the business and the owner who started it, and the
  refresh token is sealed with AES-GCM using a key that isn't in the database.
- **Intake:** Gmail's history API, with a bounded full resync when the history id expires, and
  deduplication by a unique index, so re-polling is harmless.
- **Replies:** threaded with the three things Gmail requires: the thread id, RFC 2822 reply headers
  and a matching subject.
- **Limits:** I'm upfront that the read scope is restricted, so a public launch needs Google's
  verification. For a pilot, Testing mode with weekly reconnects is fine, and a revoked token turns
  into a banner, not lost mail.
