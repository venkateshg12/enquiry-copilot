# Phase 24 — Approve, edit, reject, send, activity log

## 1. Goal

Make **approval the only door to sending**:

- `POST /orgs/:orgId/messages/:id/approve { text, overrideReason? }` runs **one transaction**:
  1. a conditional status move `ready | needs_attention → approved` (a second approve loses and gets 409);
  2. the server re-runs the safety checks on the **final** text;
  3. strong flags require a reason;
  4. the `Reply` row (`draftText`, `finalText`, `wasEdited`, word-level `editDistance`, `overriddenFlags`);
  5. an `AuditLog` row;
  6. the `reply.approved` outbox event.
- The outbox relay turns `reply.approved` into a `send-reply` job (`jobId = reply-<replyId>`). The job
  sends, then marks the reply `sent` and the message `sent`.
- Reject and spam paths are transactions too, and are logged.
- The activity log is visible in the web app (who approved what, what they changed, how long it took).
- Edits are kept as **future prompt examples**: an admin export of draft → final pairs, with contacts
  masked (Phase 30 reads it).

Until Phase 25 connects a business's Gmail, every reply goes through the **system sender** with
`Reply-To` set to the business (decided in §5).

## 2. What I will understand after this phase

1. Why "transaction + outbox" means no reply is sent without approval, and none is approved without being sent.
2. Why the server re-checks the final text instead of trusting the client's flags.
3. How a double click, two staff members, or a crashed worker still produce one email.
4. What the activity log must answer, and what it must *not* contain (customer text).
5. Why the AI draft is immutable and edits live only on the `Reply`.

## 3. Prerequisites

- Phase 23 done: the inbox and message detail with a draft editor and flag highlights.
- Phase 20's `runChecks()` and Phase 21's `AiResult` rows (stage `checked`) exist.
- Phase 13's outbox relay runs (maintenance queue `outbox-relay`).
- Phase 08's system email queue sends through Gmail.

## 4. Files

```
packages/types/src/reply.ts                        NEW    approveSchema, rejectSchema, draftCheckSchema, ReplyDto, event payload reply.approved
packages/types/src/events.ts                       ADAPT  (+ "reply.approved", "reply.sent", "reply.failed" in eventSchemas)
apps/api/prisma/schema.prisma                      ADAPT  (+ SendStatus, Reply; Message.reply back-relation)
apps/api/prisma/migrations/<ts>_replies/           NEW    (generated)
apps/api/src/
├── db/prisma.ts                                   ADAPT  (+ "Reply" in TENANT_MODELS)
├── services/audit.service.ts                      COPY   @pt-api/src/services/audit.service.ts   (from Phase 10)
├── services/outbox.service.ts                     COPY   @pt-api/src/services/outbox.service.ts  (from Phase 13)
├── services/approval.service.ts                   NEW    approve, reject, markSpam, checkDraft
├── services/send.service.ts                       NEW    channel choice + system-sender fallback
├── services/editExport.service.ts                 NEW    draft → final pairs, masked (JSONL stream)
├── utils/text/wordDiff.ts (+ .test.ts)            NEW    word-level Levenshtein + added/removed counts
├── jobs/queues/sendReply.queue.ts                 NEW    (shape of @pt-api/src/jobs/queues/maintenance.queue.ts)
├── jobs/processors/sendReply.processor.ts         NEW
├── jobs/workers/sendReply.worker.ts               NEW    (shape of @pt-api/src/jobs/workers/email.worker.ts)
├── jobs/outbox/dispatchers.ts                     ADAPT  @pt-api/src/jobs/outbox/dispatchers.ts (+ reply.approved → send-reply)
├── constants/queue.ts                             ADAPT  (+ SEND_REPLY)
├── constants/appErrorCode.ts                      ADAPT  (+ DraftFlagged, AlreadyHandled, NoEmailContact)
├── controllers/reply.controller.ts                NEW
└── routes/message.route.ts                        ADAPT  (+ approve, reject, spam, PATCH draft, GET activity)
apps/web/src/
├── api/reply.ts · hooks/reply/{useApprove,useReject,useMarkSpam,useCheckDraft}.ts   NEW
├── components/inbox/ApproveDialog.tsx             ADAPT  @pt-web/src/components/review/ApproveDialog.tsx
├── components/inbox/ActivityTab.tsx               ADAPT  @pt-web/src/components/review/AuditTab.tsx
└── app/(app)/settings/page.tsx                    ADAPT  (+ "Download edits for prompt work" for admins)
```

No new dependency: `wordDiff.ts` is 40 lines and has no reason to pull in a diff library.

## 5. Concepts

**Approve = transaction + outbox.** It's PaperTrail's `approveDocument` (`@pt-api/src/services/review.service.ts`)
with a message instead of a document:

```
withTransaction(tx =>
  message  = tx.message.findFirst({ id, orgId })                               → 404
  result   = tx.aiResult.findFirst({ messageId, stage: "checked" }, latest attempt)
  entries  = tx.infoEntry.findMany({ id in result.infoEntryIds })              ← what the draft was allowed to use
  checks   = runChecks(finalText, { entries, message, extracted, receivedAt, org })   ← on the FINAL text
  strong   = checks.flags.filter(severity === "strong")
  strong.length && !overrideReason                                             → 422 DraftFlagged
  moved    = tx.message.updateMany({ id, orgId, status in [ready, needs_attention] } → approved)
  moved.count === 0                                                            → 409 AlreadyHandled
  reply    = tx.reply.create({ … finalText: checks.maskedText, overriddenFlags: strong codes … })
  recordAudit({ action: "reply.approved", diff: { wasEdited, editDistance, wordsAdded, wordsRemoved, overriddenFlags, overrideReason, msToApprove } }, tx)
  emit(tx, orgId, "reply.approved", { replyId, messageId })
)
```

If anything throws, there's no reply, no audit row and no event, so nothing is sent. If the process
dies after the commit, the relay still dispatches the event. **No code path calls the sender
directly.** The only producer of `send-reply` jobs is `dispatchers.ts`, and Phase 31 has a test that
greps for any other `sendReplyQueue.add` call.

**Why re-check on the server.** The client's highlights are a convenience. A modified client, or a
staff member who types a new price into the editor, would otherwise get past the checks. Humans
invent numbers too. The server runs the same pure `runChecks` on the final text against the entries
the draft was given. If the edit added `₹2,000` and the info sheet says `₹2,500`, it's a strong flag,
and the reviewer must fix it or give a reason. `maskedText` (a repeated customer phone or email,
masked by the sensitive-data check) is what's stored and sent.

**The AI draft is immutable.** `AiResult.draft` is what the model wrote, forever. That's the evaluation
record. The edited text lives only in `Reply.finalText`. `PATCH …/messages/:id/draft { text }` saves
nothing: it re-runs the checks on the edited text and returns the flags, so the editor can highlight
as the reviewer types (debounced 400 ms). Unsaved edits survive a reload through `localStorage`
(try/catch, keyed by message id).

**Edit size.** `wasEdited = normalise(final) !== normalise(draft)`, where `normalise` collapses
whitespace and trims. `editDistance` is a **word-level** Levenshtein distance. "Changed one word" is 1,
"rewrote it" is close to the word count. Character distance would make a typo fix look like a rewrite.

```ts
// utils/text/wordDiff.ts
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

/** Word-level Levenshtein distance, plus how many words were added and removed. O(n·m), capped. */
export const wordDiff = (before: string, after: string) => {
  const a = words(before).slice(0, 2000);
  const b = words(after).slice(0, 2000);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  const setA = new Set(a), setB = new Set(b);
  return {
    distance: prev[b.length],
    wordsAdded: b.filter((w) => !setA.has(w)).length,
    wordsRemoved: a.filter((w) => !setB.has(w)).length,
  };
};
```

**One email per approval.**

| Failure | Handled by |
| --- | --- |
| Double click / two reviewers | the conditional `updateMany` on status; the loser gets 409 |
| Relay dispatches the same event twice | `jobId: reply-<replyId>`; BullMQ ignores a duplicate id |
| Job retried after a successful send | the processor returns early if `sendStatus === "sent"` |
| Worker dies between "Gmail accepted" and "row updated" | the narrow window. On a retry (`job.attemptsMade > 0`) the processor looks for the reply's `Message-ID` in the sender's Sent folder before sending again (Phase 25 for business Gmail; the system sender does the same with `rfc822msgid:`) |

The `Message-ID` is deterministic: `<reply-<replyId>@<MESSAGE_ID_DOMAIN>>`. Verify (§7, step 6)
checks that Gmail kept the header you set. If it rewrote it, the fallback is
`in:sent to:<customer> newer_than:2d` plus a SHA-256 of the body.

**Who sends a form message's reply (decided).**

| Business Gmail (Phase 25) | Contact | Sent by |
| --- | --- | --- |
| connected | email | the business's Gmail, from the business address (a new thread) |
| not connected | email | the **system sender** (Phase 08), display name `"<Business> via Enquiry Assistant"`, `Reply-To:` the first owner's email |
| any | phone only | not sendable: approve returns 422 `NoEmailContact`. The reviewer replies by phone and uses **Reject → "handled offline"** |

Why the fallback exists: the spec wants replies from the business's address, but a pilot needs to
work on day one, before the owner has been through Google's consent screen. The settings page shows
a banner ("Replies currently come from our address. Connect Gmail to send from yours.") and the audit
row records `sender: "system"`, so nobody is misled about where a reply came from. The data model has
no separate reply-to field; the first owner's account email is the honest default (they own the
business account). Phase 14's widget makes email required, so phone-only contacts come only from
Gmail-less edge cases.

**Reject and spam.** `reject { reason }` (`ready | needs_attention → rejected`) and `spam`
(`received | processing | ready | needs_attention → spam`) are conditional transitions plus audit
rows, in one transaction. "Not spam" is Phase 23's reprocess action (a new pipeline attempt).

**Activity log = `AuditLog`, with no customer text.**

| `action` | `diff` |
| --- | --- |
| `reply.approved` | `wasEdited`, `editDistance`, `wordsAdded`, `wordsRemoved`, `overriddenFlags`, `overrideReason`, `msToApprove` (received → approved) |
| `reply.sent` / `reply.failed` | `sender` (`business_gmail` / `system`), `errorCode` |
| `message.rejected` | `reason` |
| `message.spam` | `previousStatus` |

The texts themselves are in `replies` (behind auth, deleted by retention). They're never in the audit
diff, so the activity log can be kept longer than the messages (Phase 28).

**Edits become prompt examples.** `GET /orgs/:orgId/replies/edits.jsonl?from&to` (admin) streams
`{ category, language, draft, final, editDistance }` for edited replies, with contacts masked and the
customer's name replaced by `{name}`. Phase 30 reads it to find the most common corrections. It's
the business's own data used for its own prompts. The pilot agreement says so (Phase 33).

## 6. Steps

1. **Schema.** Add `SendStatus` and `Reply` exactly as in `data-model.md`, the `reply Reply?` back-relation
   on `Message`, and `"Reply"` in `TENANT_MODELS`. `pnpm --filter api db:migrate:dev --name replies`.
   Read replies with `findFirst({ where: { messageId } })`, not `findUnique`: Phase 26 relaxes the
   one-reply-per-message unique for booking updates, and `findFirst` keeps working.
2. **Types.** In `reply.ts`:
   - `approveSchema = { text: 1..2000 chars, overrideReason?: 3..300 chars }`;
   - `rejectSchema = { reason: enum["handled_offline","not_relevant","duplicate","other"], note? }`;
   - `draftCheckSchema = { text }`.
   Add the three event payloads to `eventSchemas` so `emit()` validates them.
3. **`approval.service.ts`.**
   - `approve(orgId, messageId, userId, input)`: the transaction in §5. Compute `wordDiff(draft, text)`.
     A message with no AI draft (`needs_attention`, the pipeline failed) can still be answered by
     hand: `draftText = ""`, `wasEdited = true`, `aiResultId = null`.
   - `reject`, `markSpam`: conditional transitions plus audit, one transaction each.
   - `checkDraft(orgId, messageId, text)`: `runChecks` only, no write.
   - After commit: `publishProgress(orgId, { messageId, status: "approved" })` (Phase 21's pub/sub), and
     `// Phase 27: cache.bump("stats")`.
4. **`send.service.ts`.** `chooseSender(org, message)` returns `"business_gmail" | "system"` per the
   table. `// Phase 25: business Gmail` is the branch Phase 25 fills; until then it always returns
   `"system"`. `sendViaSystem(reply, message, org)` reuses Phase 08's `sendEmail` with `replyTo`,
   `fromName` and `messageId` options. ADAPT Phase 08's `sendEmailSchema` to accept these three
   optional headers, each through the existing `singleLine` guard.
5. **Queue + processor.** `send-reply` queue with `attempts: 5`, `backoff: { type: "exponential", delay: 30_000 }`.
   ```ts
   export const processSendReply = async (job: Job<{ replyId: string; orgId: string }>) =>
     runWithRequestContext({ orgId: job.data.orgId, jobId: job.id }, async () => {
       const reply = await prisma.reply.findFirst({ where: { id: job.data.replyId }, include: { message: true } });
       if (!reply || reply.sendStatus === "sent") return { skipped: true };
       if (job.attemptsMade > 0 && (await alreadySent(reply))) return markSent(reply, { recovered: true });
       const { gmailId, sender } = await sendReplyNow(reply);          // throws on failure → BullMQ retry
       await markSent(reply, { gmailId, sender });                    // reply.sent + message approved→sent + audit + SSE
     });
   ```
   On the final failed attempt (worker `failed` event with `attemptsMade === attempts`) set
   `sendStatus = "failed"`, store `lastError` (an error code, never a provider body), write
   `reply.failed`, and move the job to the DLQ (Phase 21). The message stays `approved`, and the UI
   shows **Resend**: `POST …/messages/:id/resend` re-emits `reply.approved` with the same reply id, so
   the job id is unchanged (BullMQ allows a re-add once the failed job is removed).
6. **Dispatcher.** In `dispatchers.ts`, `reply.approved` → `sendReplyQueue.add("send-reply", { replyId, orgId }, { jobId: \`reply-${replyId}\` })`.
7. **Routes** (all behind `authenticate`, `resolveOrg`):

   | Route | Permission |
   | --- | --- |
   | `POST /orgs/:orgId/messages/:id/approve` | `messages.reply` |
   | `POST …/reject`, `POST …/spam`, `POST …/resend` | `messages.reply` |
   | `PATCH …/draft` | `messages.reply` |
   | `GET …/activity` | `messages.read` |
   | `GET /orgs/:orgId/replies/edits.jsonl` | `org.update` (admin) |

8. **Web.**
   - `ApproveDialog`: the final text, its flags, and for strong flags a required reason field and an
     **Approve anyway** button. ADAPTED from PaperTrail's dialog, which already requires an override
     reason for blocking issues.
   - The message header follows SSE: Approved → Sending… → Sent ✓, or Failed with Resend.
   - `ActivityTab`: ADAPT `AuditTab` to render the actions above in plain words ("Asha approved after
     editing 4 words · 3 min after it arrived").

## 7. Verify

```bash
pnpm --filter api db:migrate:dev --name replies
pnpm --filter api test -- wordDiff            # unit: identical → 0; one word swapped → 1; empty → word count
pnpm dev
```

1. Submit a form message (fake provider) and wait for `ready`. Approve without editing →
   `{ status: "success", data: { replyId, status: "approved" } }`. Within seconds the message is `sent`,
   the dev mailbox shows one email `From: "CodeNest via Enquiry Assistant"` with `Reply-To` set to the
   owner, and `GET …/activity` lists `reply.approved` (`wasEdited: false`) and `reply.sent`.
2. Edit the draft to quote a price that isn't in the info sheet, then call the API **directly**
   (skipping the UI's highlights):
   ```bash
   curl -s -b cookies.txt -X POST $API/orgs/$ORG/messages/$MSG/approve \
     -H 'content-type: application/json' -d '{"text":"Hi Ravi, the fee is ₹1,999. — Team CodeNest"}'
   # → 422 {"status":"error","errors":[{"code":"DraftFlagged", … "invented_number" …}]}
   ```
   With `"overrideReason":"Owner agreed a discount by phone"` → 200, `overriddenFlags: ["invented_number"]`,
   and the reason is in the audit row.
3. Two approves at once:
   `for i in 1 2; do curl … /approve & done; wait` → one 200, one 409 `AlreadyHandled`; one email.
4. Stop the worker after the relay has claimed `reply.approved`, then start it again → exactly one
   email; `send_status = sent`.
5. Throw inside the approval transaction (a temporary `throw` after `reply.create`) → no reply row,
   no outbox row, no email: `SELECT count(*) FROM replies WHERE message_id = '…'` → 0.
6. Inspect the sent email's raw source → the `Message-ID` is the one you set. If it isn't, switch
   `alreadySent()` to the body-hash fallback and record it in `tasks/lessons.md`.
7. Reject with `handled_offline` → status `rejected`, audit row, no email.
8. `grep -E "Ravi|₹|@example.com" api.log` → nothing (Phase 02's redaction covers reply and draft text).

## 8. Definition of done

- [ ] Approve is one transaction (status, reply, audit, outbox); the server re-checks the final text; strong flags need a reason.
- [ ] `send-reply` runs only from the outbox dispatcher, with a deterministic job id, an early return when already sent, and a recovery check on retries.
- [ ] Reject, spam and resend paths; the activity log shows who did what, with no customer text.
- [ ] Form-channel replies use the system sender with `Reply-To` until Gmail is connected, and say so in settings.
- [ ] Edits export works, with contacts masked.
- [ ] Verify steps 1–8 pass.
- [ ] Commit: `feat(api,web): approval transaction, reply sending, activity log`.

## 9. Interview angle

*"How do you guarantee the AI never sends on its own?"* There's no code path that sends without an
approval row. Approving writes the reply, flips the status and writes an outbox event in one
transaction, and the only thing that creates a send job is that event's dispatcher. The server
re-checks the final text, so even a price a person typed is caught. Exactly-once is layered: a
conditional status update for double clicks, a deterministic job id for duplicate dispatches, and a
`sent` check plus a Sent-folder lookup for the crash between "Gmail accepted it" and "we recorded it".
