# Phase 28 — Privacy: retention, erasure, masking

## 1. Goal

Handle customers' personal data the way `data-handling.md` (and spec §8) promise:

- **Retention.** Each business chooses `retentionDays` (30–730, default 180). A nightly job
  **hard-deletes** older messages in bounded batches. Foreign keys cascade to AI results, model calls,
  replies and booking requests. Outbox rows that mention the message go too, and audit rows about it
  are scrubbed, not deleted.
- **Erasure on request.** "Delete everything about this customer", by email or phone, from the sender
  field *and* from contacts the customer typed into a message. There's a dry-run count first, and the
  audit entry stores a hash, not the contact.
- **Delete one message** (owner).
- **Masking.** Contact details are masked in lists, in audit diffs (at write time) and in logs; the
  full value appears only in the message detail for staff.
- **Audit rows older than 2 years** are purged.
- A Settings → Privacy screen for retention, erasure and the plain-language data statement.

## 2. What I will understand after this phase

1. What a hard delete must cover here: rows that cascade, rows that only *mention* the message by
   value, and queue jobs.
2. Why the audit trail survives deletion and the content doesn't.
3. Why the retention job is batched, idempotent and resumable, and runs in `runAsSystem`.
4. How to find "everything about a customer" when contacts are stored as typed.
5. Where personal data could still leak after the database is clean (logs, Sentry, job payloads,
   the business's own mailbox).

## 3. Prerequisites

- Phase 27 done.
- Phase 08's `maintenance` queue with `purge-expired`, and Phase 17's phone normaliser
  (`normalisePhone(raw, defaultCountry)`).

## 4. Files

```
packages/types/src/privacy.ts                        NEW    retentionSchema (30..730), eraseContactSchema { contact, dryRun? }
apps/api/prisma/schema.prisma                        ADAPT  (+ Org.retentionDays @default(180), per data-model.md)
apps/api/prisma/migrations/<ts>_retention/           NEW    (+ CHECK (retention_days BETWEEN 30 AND 730), appended by hand)
apps/api/src/
├── utils/pii.ts                                     ADAPT  (Phase 02's file: + maskContact, contactHash; SENSITIVE_KEYS + body, fromContact, fromName, draft, finalText, phone, email)
├── services/audit.service.ts                        ADAPT  (recordAudit runs diff through redactForTrace before writing)
├── services/deletion.service.ts                     ADAPT  @pt-api/src/services/deletion.service.ts  (hardDeleteDocument → hardDeleteMessage; no object storage; hardDeleteOrg keeps its shape)
├── services/privacy.service.ts                      NEW    setRetention, eraseContact (dry run + run)
├── jobs/processors/retention.processor.ts           ADAPT  @pt-api/src/jobs/processors/retention.processor.ts  (messages, receivedAt, 500 per org per run)
├── jobs/processors/purgeExpired.processor.ts        ADAPT  @pt-api/src/jobs/processors/purgeExpired.processor.ts  (+ audit_logs older than 2 years)
├── worker.ts                                        ADAPT  (+ upsertJobScheduler("retention", { pattern: "30 21 * * *" }) — 03:00 IST)
├── controllers/privacy.controller.ts · routes/privacy.route.ts   NEW
├── routes/message.route.ts                          ADAPT  (+ DELETE /orgs/:orgId/messages/:id)
└── test/deletion.int.test.ts                        NEW    (written now; runs on Phase 31's Testcontainers harness)
apps/web/src/
├── app/(app)/settings/privacy/page.tsx              NEW
├── components/privacy/{RetentionForm,EraseContactDialog,DataStatement}.tsx   NEW
└── lib/mask.ts                                      NEW    (the same masking rules as utils/pii.ts, for list views)
```

## 5. Concepts

**What a message touches.**

| Data | How it goes |
| --- | --- |
| `messages` row | `DELETE`, last |
| `ai_results`, `model_calls`, `replies`, `booking_requests` | **cascade** (`onDelete: Cascade` on `messageId`) |
| `outbox_events` mentioning it | raw `DELETE … WHERE org_id = $1 AND payload->>'messageId' = $2`. Raw SQL bypasses the tenant extension, so `org_id` is in the statement |
| `audit_logs` targeting it (or its reply/booking) | `diff` set to `{ "scrubbed": true }`; who did what and when stays |
| BullMQ jobs | ids only by design (`{ messageId, orgId }`), so nothing to scrub. Waiting/delayed `process-message` and `send-reply` jobs and DLQ entries for the message are removed best effort |
| The business's Gmail mailbox | **not ours to delete.** It's the business's own mail. The privacy screen says so |
| Logs, Sentry | never contain it (Phase 02 redaction; Phase 32's `beforeSend` scrub). That's why there's nothing to purge |

`hardDeleteMessage(orgId, messageId, actor, reason)` is PaperTrail's `hardDeleteDocument` without the
object-storage step:
```ts
export const hardDeleteMessage = async (orgId: string, messageId: string, actor: Actor, reason: string) => {
  const message = await prisma.message.findFirst({ where: { id: messageId, orgId }, select: { id: true, channel: true } });
  if (!message) return { deleted: false };                       // idempotent: already gone

  await withTransaction(async (tx) => {
    await tx.$executeRaw`
      DELETE FROM outbox_events WHERE org_id = ${orgId}::uuid AND payload->>'messageId' = ${messageId}`;
    const replyIds = (await tx.reply.findMany({ where: { orgId, messageId }, select: { id: true } })).map((r) => r.id);
    const bookingIds = (await tx.bookingRequest.findMany({ where: { orgId, messageId }, select: { id: true } })).map((b) => b.id);
    await tx.auditLog.updateMany({
      where: { orgId, targetId: { in: [messageId, ...replyIds, ...bookingIds] } },
      data: { diff: SCRUBBED },
    });
    await tx.message.delete({ where: { id: messageId, orgId } });   // cascades
    await recordAudit({ orgId, actor, action: "message.deleted", target: { type: "message", id: messageId },
                        diff: { reason, channel: message.channel } }, tx);
  });

  await removeQueueJobsFor(messageId);                             // best effort, logged on failure
  await cache.bump("inbox", "stats");
  return { deleted: true };
};
```
The whole database part is one transaction: a crash leaves either everything or nothing. Running it
twice is a no-op. Unlike the Mongo version of this plan, there's no ordering puzzle, because foreign
keys do the cascade.

**Retention.** The `retention` scheduler fires at 03:00 IST (`30 21 * * *` UTC). In `runAsSystem`
(it's cross-tenant by design), and for each org:
- `cutoff = now − retentionDays`;
- the 500 oldest messages with `receivedAt < cutoff` → `hardDeleteMessage` each, with actor
  `{ type: "system", id: "retention" }`.

It uses the `(org_id, received_at)` index. Five hundred per org per night bounds a run. A business
that just shortened retention from 730 to 30 days catches up over a few nights instead of locking the
table for minutes. Each deletion is its own transaction, so a job killed halfway resumes cleanly the
next night. A message that's `approved` but not yet `sent` is skipped once (`status != 'approved'`),
so retention never deletes a reply in flight.

**Stats after retention.** Stats (Phase 27) are computed from rows, so deleted months disappear from
the dashboard. That's acceptable: the default range is 30 days, and retention is at least 30. The
pilot's before/after numbers are **exported** before they age out (Phase 33's case-study step). A
monthly roll-up table would keep history forever. It isn't in the data model, so it's left as a
listed improvement.

**Erasure on request.** `POST /orgs/:orgId/contacts/erase { contact, dryRun }` (owner):
1. **Normalise** the contact:
   - an email: trimmed and lower-cased;
   - a phone: E.164 via `normalisePhone(contact, org.defaultCountry)`, and anything that doesn't parse
     as either → 400.
2. **Find** candidate messages with one tenant-scoped raw query (it has `org_id`):
   ```sql
   SELECT DISTINCT m.id FROM messages m
   LEFT JOIN ai_results a ON a.message_id = m.id
   WHERE m.org_id = ${orgId}::uuid AND (
         lower(m.from_contact) = ${email}                                                     -- sender (email)
      OR right(regexp_replace(m.from_contact, '\D', '', 'g'), 10) = ${last10}                 -- sender (phone)
      OR lower(a.extracted->>'email') = ${email}                                              -- typed into the message
      OR right(regexp_replace(coalesce(a.extracted->>'phone', ''), '\D', '', 'g'), 10) = ${last10})
   ```
   Then **confirm** each phone candidate in Node with `normalisePhone(...) === target`, so a matching
   last 10 digits in a different country doesn't over-delete.
3. **Dry run** returns `{ count }` and deletes nothing. The UI shows "This deletes 4 messages from
   ra***@gmail.com, with their drafts, replies and bookings" and asks the owner to type `DELETE`.
4. **Run** calls `hardDeleteMessage` for each, then writes **one** audit row,
   `contact.erased { count, contactHash }`, where `contactHash = sha256(orgId + ":" + normalised)`. The
   owner can later prove "we erased that person's data on 12 Nov" by hashing the address again,
   without the audit log holding it.

The search includes `ai_results.extracted` because a customer who wrote "call me on 98765 43210" from
a friend's email has given their number in the message. A sender-only search would miss it.

**Masking at write time.** `recordAudit` runs `diff` through `redactForTrace` (ADAPTED with the
message keys above) before the insert. Contact-shaped strings anywhere in a diff go through
`maskContact`: `ravi.k@gmail.com` → `ra***@gmail.com`, and `+919876543210` → `+91 98xxxx3210`.
Because the audit log outlives messages (2 years against the retention period), it must never be a
copy of them. Lists in the web app use the same rules (`lib/mask.ts`). The message detail page shows
contacts in full to `messages.read` users: they need them to do their job, and that page is the only
place.

**Who can.**

| Action | Role |
| --- | --- |
| Change retention, erase a contact, delete a message | `owner` only (`privacy.manage`) |
| Read the data statement | everyone in the business |

Erasure is irreversible, and a reviewer shouldn't be able to make a complaint disappear.

## 6. Steps

1. **Schema.** Add `retentionDays Int @default(180) @map("retention_days")` to `Org`.
   `db:migrate:dev --create-only --name retention`, append
   `ALTER TABLE orgs ADD CONSTRAINT retention_days_range CHECK (retention_days BETWEEN 30 AND 730);`,
   then apply. The Zod schema enforces the same range, so the API answers 400 before the database
   would.
2. **`pii.ts`.** `maskEmail` and `maskPhone` exist since Phase 02. Add `maskContact` (detects which one
   it is and calls them) and `contactHash` (per-business, unlike Phase 02's deployment-wide `contactRef`);
   extend `SENSITIVE_KEYS`. Unit tests: short local parts (`a@x.in` → `a***@x.in`), plus-addressing, a
   10-digit Indian number, a UK number, non-contact strings untouched.
3. **`audit.service.ts`.** Apply the masking redaction to `diff` inside `recordAudit`. This one change
   covers every caller, from Phase 10 on.
4. **`deletion.service.ts`.** ADAPT PaperTrail's file:
   - `hardDeleteMessage` as in §5;
   - `removeQueueJobsFor(messageId)` checks the `pipeline`, `send-reply` and `dead-letter` queues for
     jobs whose `data.messageId` matches (and `send-reply` jobs whose reply belongs to the message);
   - `hardDeleteOrg` stays as PaperTrail's, deleting messages in batches of 100 first. It also calls
     Phase 25's Gmail `disconnect`, so the token is revoked at Google, not just dropped.
5. **Retention processor and scheduler.** ADAPT `processRetentionSweep` to messages and `receivedAt`,
   skipping `approved`, and register it in `worker.ts` next to `purge-expired`. Log
   `{ orgId, deleted }` per org: counts only.
6. **`purge-expired`.** Add `DELETE FROM audit_logs WHERE at < now() - interval '2 years'`, in batches
   of 5,000 (`WHERE id IN (SELECT id … LIMIT 5000)` in a loop), so a first run on an old database
   doesn't hold one huge lock.
7. **Routes.**
   - `PATCH /orgs/:orgId/retention` → `{ retentionDays }`;
   - `POST /orgs/:orgId/contacts/erase`;
   - `DELETE /orgs/:orgId/messages/:id`.
   All three: `authenticate`, `resolveOrg`, `requireOrgRole("privacy.manage")`.
8. **Web.** Settings → Privacy:
   - retention: a select of 30, 90, 180, 365 or 730 days, with "messages older than this are deleted
     every night";
   - Erase a contact: input → dry-run count → type `DELETE` → done;
   - `DataStatement`: `data-handling.md`'s tables in plain words, plus "Your Gmail mailbox is yours:
     deleting here doesn't delete mail there."

   Message detail gets a Delete action (owner), and lists switch to `lib/mask.ts`.
9. **Tests** (`test/deletion.int.test.ts`, run in Phase 31): delete with every child row present (all
   gone, audit scrubbed, outbox row gone), twice (no-op), erase by email and by a phone typed in the
   body, a non-owner (403), retention skipping an in-flight approval.

## 7. Verify

```bash
pnpm --filter api test -- pii
pnpm --filter api db:migrate:dev
```

1. Seed a message with an AI result, a reply, a booking, an audit trail and a pending outbox row. Then
   `DELETE /orgs/$ORG/messages/$MSG` (owner) → 200. Afterwards:
   ```sql
   select (select count(*) from messages where id = :msg)          as messages,
          (select count(*) from ai_results where message_id = :msg) as ai,
          (select count(*) from replies where message_id = :msg)    as replies,
          (select count(*) from booking_requests where message_id = :msg) as bookings,
          (select count(*) from outbox_events where payload->>'messageId' = :msg) as outbox,
          (select count(*) from audit_logs where target_id = :msg and diff <> '{"scrubbed": true}') as unscrubbed;
   -- → 0 | 0 | 0 | 0 | 0 | 0
   ```
2. The same call again → 200, `{ deleted: false }`.
3. Set a test business's retention to 30 and back-date 600 messages to 40 days ago. Run
   `pnpm --filter api tsx -e "require('./src/jobs/processors/retention.processor').processRetentionSweep().then(console.log)"`
   → `{ orgsProcessed: 1, messagesDeleted: 500 }`. Run again → 100. Another business's messages are
   untouched.
4. `PATCH …/retention { "retentionDays": 7 }` → 400; `psql … "update orgs set retention_days = 7"` →
   rejected by the CHECK constraint.
5. Erase `ravi@example.com` with `dryRun: true` → `{ count: 3 }` (two sent from it, one with the address
   typed into the body), nothing deleted. Run it → 3 deleted. The audit row has `contactHash`, and
   `grep -c "ravi" <(psql … -c "select diff from audit_logs")` → 0.
6. Erase `+91 98765 43210` → matches a message whose body said "call me on 9876543210", and leaves a
   `+44` number with the same last 10 digits alone.
7. As an `admin` → 403 on all three routes.
8. Approve a message and keep the worker stopped so it stays `approved`, then run retention with a
   cutoff that includes it → it's skipped, and the reply sends when the worker starts.
9. `grep -E "@example.com|98765" api.log worker.log` → nothing.

## 8. Definition of done

- [ ] Nightly, bounded, idempotent retention per business, skipping replies in flight.
- [ ] `hardDeleteMessage`: one transaction, cascade + outbox + scrubbed audit, queue cleanup; `hardDeleteOrg` revokes Gmail.
- [ ] Contact erasure across senders and typed contacts, with a dry run and a hashed audit entry.
- [ ] Masking in audit diffs (at write time), lists and logs; audit rows purged after 2 years.
- [ ] Owner-only privacy routes and the Settings → Privacy screen with the data statement.
- [ ] `deletion.int.test.ts` written; Verify steps 1–9 pass.
- [ ] Commit: `feat(api,web): retention, contact erasure, masking`.

## 9. Interview angle

*"How do you handle customer data?"*
- **Retention:** per business, enforced nightly in bounded batches, so shortening it is safe.
- **Deletion:** one transaction where foreign keys cascade to everything that belongs to the message.
  Outbox rows that only mention it are deleted explicitly, and the audit trail keeps who did what with
  the content scrubbed.
- **Erasure on request:** searches the sender *and* contacts people typed into their messages, shows a
  dry-run count first, and leaves a hash rather than the address.
- **Never stored elsewhere:** no content in logs, job payloads or Sentry, so the database is the only
  place to clean.
- **Not ours to delete:** I tell the owner plainly that their Gmail mailbox is theirs.
