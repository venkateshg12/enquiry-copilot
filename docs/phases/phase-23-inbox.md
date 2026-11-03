# Phase 23 — The approval inbox

## 1. Goal

Build the screen staff live in, `/inbox`:

- **API**:
  - `GET /orgs/:orgId/messages` with status tabs, category filter, search and cursor pagination;
  - `GET /orgs/:orgId/messages/counts` for the tab badges, cached under domain `inbox`;
  - `GET /orgs/:orgId/messages/:id` returning the message, the latest attempt's AI result, the info
    entries the draft was shown, and the attempt history;
  - `POST /orgs/:orgId/messages/:id/checks/preview`, which re-runs the pure checks on edited text so
    highlights follow the edit.
- **List**:
  - status tabs: Ready · Needs attention · Spam · Sent · Rejected;
  - category chips, red/amber flag dots, channel icon, relative age;
  - **virtualised** infinite scroll;
  - **live updates** over SSE, with a polling fallback.
- **Detail** (split view):
  - the customer message;
  - the extracted details with their issues;
  - the info entries the AI was allowed to use;
  - the **draft editor**, with flagged spans highlighted and a banner per severity;
  - the category with confidence;
  - the reason a message needs attention;
  - the attempt history.
- **Keyboard**: `j`/`k` next/previous, `e` edit, `a` approve, `r` reject, `s` spam, `?` help.
  Ignored while typing.
- **States**: loading skeletons, an empty "inbox zero", error banners, and "Write your own reply" when
  there's no draft.

**Approve, reject, mark spam and sending are Phase 24.** This phase renders the action bar and wires
**Reprocess** (Phase 21's endpoint). The other buttons are placed and disabled behind a
`// Phase 24:` comment.

## 2. What I will understand after this phase

1. How to present AI output so a person can verify it in seconds: the evidence beside the answer.
2. How to highlight character ranges inside an editable `<textarea>` (the mirror-overlay technique).
3. How SSE events and TanStack Query's cache combine: patch rows optimistically, refetch the
   authoritative data on terminal states, poll only when the stream is down.
4. Why the list reads denormalised columns, and how the counts cache stays correct with versioned
   keys.
5. Why the browser never re-implements the checks.

## 3. Prerequisites

- Phase 21 done: messages reach `ready`, `AiResult` rows exist, `GET /orgs/:orgId/events/stream`
  emits `message` events.
- Phase 22 done: `statusReason = "budget_reached"` exists.
- Phase 09's web foundation (`api.ts`, `providers.tsx`, `RequireAuth`) and Phase 10's `org.store`,
  org switcher and `X-Org-Id` header.

## 4. Files

```
packages/types/src/message.ts                         ADAPT  (+ listMessagesQuerySchema, messageListItem, messageDetail, checksPreviewSchema)
apps/api/src/
├── services/message.service.ts                       ADAPT  (+ listMessages, countByStatus, getMessageDetail; cache bump in transitionStatus)
├── services/infoSheet.service.ts                     ADAPT  (+ renderEntries(orgId, ids), mapping Phase 18's renderEntry over the stored ids)
├── controllers/message.controller.ts                 ADAPT  (+ list, counts, detail, checksPreview)
├── routes/message.route.ts                           ADAPT
├── scripts/seed-messages.ts                          NEW    (--org <id> --n <count>: fictional messages through the real intake service; reused by Phases 29 and 33)
└── utils/cache/cache.ts                              (domain "inbox" already declared in Phase 07)
apps/web/src/
├── api/message.ts                                    NEW    (shape of @pt-web/src/api/document.ts)
├── hooks/messages/useMessages.ts                     ADAPT  @pt-web/src/hooks/documents/useDocuments.ts
├── hooks/messages/useMessage.ts                      ADAPT  @pt-web/src/hooks/documents/useDocument.ts
├── hooks/messages/useInboxEvents.ts                  ADAPT  @pt-web/src/hooks/documents/useOrgEvents.ts
├── hooks/messages/{useMessageCounts,useChecksPreview,useReprocess}.ts   NEW
├── hooks/common/useShortcuts.ts                      NEW    (the typing guard from @pt-web/src/app/(app)/documents/[id]/page.tsx)
├── lib/messageStatus.ts                              ADAPT  @pt-web/src/lib/documentStatus.ts
├── app/(app)/inbox/page.tsx                          ADAPT  @pt-web/src/app/(app)/inbox/page.tsx   (?status=&category=&id=)
└── components/inbox/
    ├── StatusTabs.tsx · CategoryChip.tsx · FlagDot.tsx                  NEW
    ├── MessageList.tsx · MessageRow.tsx                                 NEW    (@tanstack/react-virtual)
    ├── MessageDetail.tsx · CustomerMessage.tsx · AttentionBanner.tsx    NEW
    ├── ExtractedDetails.tsx                                             ADAPT  @pt-web/src/components/review/FieldRow.tsx
    ├── UsedFacts.tsx · AttemptHistory.tsx                               NEW
    ├── CheckBanners.tsx                                                 ADAPT  @pt-web/src/components/review/IssueBanners.tsx (severity strong|warning|info)
    ├── DraftEditor.tsx                                                  NEW    (textarea + mirror overlay)
    └── ActionBar.tsx · ShortcutHelp.tsx                                 NEW
```

`@tanstack/react-virtual` is already a dependency of PaperTrail's web app. Add it to this app with
`pnpm --filter web add @tanstack/react-virtual`.

## 5. Concepts

### 5.1 Show the evidence, not just the answer

A reviewer verifies a draft fast when three things sit next to it:

1. **what the customer asked**: the message, with the extracted service, date and time highlighted in
   it;
2. **what the AI was allowed to use**: the info entries rendered exactly as the draft prompt received
   them (`AiResult.infoEntryIds`), not the whole sheet;
3. **what code is worried about**: each flag as a sentence ("₹3,500 isn't in the info entries shown to
   the AI") with its span highlighted in the draft.

That's PaperTrail's review screen (the PDF beside the fields) applied to text. Confidence is shown
small and grey. It's the model's opinion, not evidence.

### 5.2 Highlighting inside a textarea

A `<textarea>` can't style ranges. The standard trick is a `div` **behind** the textarea that renders
the same text with `<mark>` around each flagged span. It uses the identical font, size, padding,
border and wrapping (`white-space: pre-wrap; overflow-wrap: break-word`), the textarea's own text is
transparent with a visible caret (`color: transparent; caret-color: currentColor`), and the two scroll
together (`onScroll` copies `scrollTop`). Overlapping spans are merged before rendering. Strong spans
use red, warnings amber.

When the reviewer edits, the highlights must follow. Offsets from the original draft are wrong after
the first keystroke, so the editor calls `POST …/checks/preview { text }`, debounced 300 ms. The API
runs Phase 20's `runChecks` with the **same allowed set** as the attempt (its `infoEntryIds`, message
and extracted fields) and returns fresh flags and `maskedText`. Fix the invented price and its
highlight disappears.

The browser never re-implements the checks. One implementation means the flags staff see are exactly
the flags Phase 24's approval transaction will enforce.

### 5.3 Live updates without stale drafts

`useInboxEvents` (adapted from PaperTrail's `useOrgEvents`):

- opens `EventSource(`${API_URL}/orgs/${orgId}/events/stream`, { withCredentials: true })`;
- on a `message` event, **patches** the matching row in every cached `["messages", …]` page (status,
  category, flags) and invalidates `["messageCounts", orgId]`;
- on terminal statuses for the open message (`ready`, `needs_attention`, `spam`, `sent`, `rejected`),
  invalidates `["message", id]`, so the draft is always refetched through the authenticated API,
  never taken from the event (events carry no text, Phase 21 §5.4);
- a new `ready` message that isn't in the cache invalidates the first page of the Ready tab. It
  appears at the top with a two-second highlight;
- on `open`, invalidates everything once to catch up on anything missed;
- if the stream stays down for 10 s, `useMessages` switches to 5 s polling until it reconnects.

If the open message moves away from `ready` because someone else handled it, the detail shows a
banner ("Handled by Priya, 12:04") and the editor becomes read-only. Phase 24 adds the 409 path.

### 5.4 The list is cheap

The list reads only `messages` columns, including the denormalised `category`, `possibleSpam` and
`strongFlags` from Phase 21. It uses the index `(org_id, status, received_at desc, id desc)` and
PaperTrail's cursor helpers (`afterCursor`, `cursorOrder`, `pageOf`) on `(receivedAt, id)`: newest
first by arrival, not by row creation. Rows show the sender name, the first 120 characters of the
body, the category chip, a flag dot (red when `strongFlags > 0`, amber for possible spam) and
relative age.

`GET …/messages/counts` is one `groupBy` on `status`, cached under
`cache.versionedKey(["inbox"], orgId + ":counts")` for 30 s. `transitionStatus` bumps the `inbox`
domain after its update commits, so badges never lag a status change by more than one request.

Search (`q`) matches `from_name`, `from_contact` and `subject` with `ILIKE`, not bodies. A
small business has hundreds of messages a month, so a sequential scan within one org is fine.
Body search would need a trigram index over personal data, so it's left out on purpose.

### 5.5 Keyboard, safely

`useShortcuts(map)` ignores keystrokes when the target is an `INPUT`, `TEXTAREA`, `SELECT` or
`contenteditable`, or when a modifier key is held. That's the same guard PaperTrail's review page uses.
`j`/`k` move the selection and the URL (`?id=`), so the browser's back button works. `e` focuses the
editor. `a`, `r` and `s` are Phase 24's actions. `?` opens the shortcut sheet. Escape leaves the
editor and returns to list navigation.

### 5.6 Every state designed

| State | Shows |
| --- | --- |
| loading | skeleton rows (copied `skeleton.tsx`); detail skeleton |
| empty Ready tab | "Inbox zero. New messages appear here as they arrive." |
| `needs_attention` / `draft_failed` | amber banner "The AI couldn't write a draft. Write your own reply." and an empty editor |
| `needs_attention` / `budget_reached` | banner with a link to `/settings/usage` |
| `needs_attention` / `pipeline_failed` | banner + **Reprocess** |
| `possibleSpam` | grey chip "Possible spam" and a one-click "Not spam" (Phase 24) |
| category null | "Couldn't classify" chip |
| API error | `alert-popup` with the normalised `error.message`; the list keeps its last data |
| stream down | small "Live updates paused, refreshing every 5 s" note |

## 6. Steps

### 6.1 API

```ts
// packages/types/src/message.ts
export const listMessagesQuerySchema = z.object({
  status: z.enum(["ready", "needs_attention", "spam", "sent", "rejected", "processing"]).default("ready"),
  category: categorySchema.optional(),
  q: z.string().trim().min(2).max(80).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});
export const checksPreviewSchema = z.object({ text: z.string().min(1).max(3000) });
```

- `listMessages(orgId, query)`: `findMany` with `afterCursor(decodeCursor(cursor))` on
  `receivedAt`/`id`, `take: limit + 1`, `pageOf`. Select only list columns.
- `getMessageDetail(orgId, id)`: the message, the latest `AiResult` by `attempt`, `renderEntries(orgId,
  aiResult.infoEntryIds)` (entries deleted since are shown as "removed from the info sheet"), the
  attempts (`attempt`, `stage`, `createdAt`, `promptVersions`), and the reply (`// Phase 24:`).
  `appAssert(message, NOT_FOUND, …)`.
- `checksPreview(orgId, id, text)`: load the latest attempt, build the same `CheckInput`, return
  `runChecks(...)`.
- Routes, all behind `authenticate`, `resolveOrg`, `requireOrgRole("viewer")`:
  `GET /orgs/:orgId/messages`, `GET /orgs/:orgId/messages/counts`, `GET /orgs/:orgId/messages/:id`.
  `POST …/checks/preview` needs `reviewer` and its own limiter (60/min per user).

### 6.2 Hooks

`useMessages(filters)` is PaperTrail's `useDocuments` with the `["messages", orgId, filters]` key and
the fallback-polling option. `useMessage(id)`, `useMessageCounts()` and `useReprocess()` (a mutation
that invalidates `["message", id]` and the counts) follow the one-hook-per-operation convention.
`useChecksPreview(id)` is a debounced mutation that keeps the last result in state.

### 6.3 Components

- `MessageList`: `useVirtualizer({ count, getScrollElement, estimateSize: () => 72, overscan: 8 })`,
  with a sentinel row that calls `fetchNextPage` when it becomes visible.
- `MessageDetail`: two columns on `lg` (message and evidence left; draft, banners and actions right),
  stacked on mobile, with collapsible sections for extracted details, used facts and history.
- `DraftEditor`: the textarea, the mirror `div`, a word count against 90, and the flag list under it.
  Clicking a flag selects its span in the textarea (`setSelectionRange`).
- `CheckBanners`: adapted from `IssueBanners`. Red for strong, amber for warning, a small note for info,
  and the green "All checks passed" state when there are no flags.
- `ActionBar`: Approve & send · Edit · Reject · Spam · Reprocess. Only Reprocess is live in this phase.

All class strings stay inline in JSX.

### 6.x Seed script

`src/scripts/seed-messages.ts --org <id> --n <count> [--file samples/messages.txt]` builds fictional
messages (random CodeNest-style questions, Hinglish mixed in, fake `555` phones, `example.com`
emails), with no real customer text. It calls Phase 13's `acceptFormSubmission(formKey, raw)` with
the org's first form key **inside the process** (not HTTP), so messages get the same outbox event and
pipeline as real ones. Each `raw` carries a `renderedAt` older than the minimum fill time and a fresh
`clientSubmissionId`. Run it with `INTAKE_DAILY_CAP` raised above `--n`, or the cap holds the rest
as `intake_cap`. It
waits until each reaches a terminal status (with `--wait`), then closes Prisma, the queue connection
and the cache in a `finally`. Phase 29 reuses it to load the labelled set into a dev org, and Phase 33
uses it for the demo.

## 7. Verify

```bash
pnpm dev     # api :5000 (fake provider, in-process worker), web :3000
```

1. Sign in, open `/inbox`, and submit three messages through the widget test page (Phase 14). They
   appear in **Ready** without a reload, and the Ready badge goes from 0 to 3.
2. Script an invented price (`FAKE_LLM_SCRIPT=draft:"The fee is ₹3,500. See you Saturday!"`) → open
   it: `₹3,500` highlighted red, and two strong banners (`invented_number`, `booking_promise`). Change
   it to the sheet's price and remove the second sentence → within about half a second both highlights
   and banners are gone.
3. `FAKE_LLM_SCRIPT=draft:down` → the message shows under **Needs attention** with the "Write your own
   reply" banner and an empty editor.
4. `j`/`k` move between messages and update `?id=`. Typing `j` inside the editor types a "j".
5. Stop Redis pub/sub (`docker compose stop redis` briefly) → the "Live updates paused" note appears,
   and the list keeps refreshing every 5 s. Restart it → the note disappears.
6. Seed 500 messages (`pnpm --filter api tsx src/scripts/seed-messages.ts --org <id> --n 500`) → scrolling stays
   smooth, the DOM holds about 30 rows, and pages load as you scroll.
7. `curl` the list as a user of another business with this business's id → 403 (Phase 10's
   `resolveOrg`). Check with `EXPLAIN` that `status = 'ready'` uses the composite index.

## 8. Definition of done

- [ ] List, counts and detail endpoints with Zod-validated queries and cursor pagination.
- [ ] Counts cached under `inbox`, bumped by every status transition.
- [ ] Virtualised list with infinite scroll; SSE patches, terminal refetch, polling fallback.
- [ ] Detail shows the message, extracted details with issues, used facts, flags and the reason for
      `needs_attention`.
- [ ] Draft editor with highlights that follow edits through the checks preview endpoint.
- [ ] Shortcuts with the typing guard; every state in §5.6 rendered.
- [ ] Reprocess wired; approve/reject/spam placed for Phase 24.
- [ ] Commit: `feat(web): approval inbox`.

## 9. Interview angle

*"Why keep a human in the loop, and how do you stop that being slow?"* Trust, and because a wrong
price sent to a customer costs more than a few seconds of review. So the inbox is built to make
review fast. Next to each draft it shows what the customer asked, the exact facts the AI was allowed
to use, and the specific spans code couldn't verify. A clean draft is one keystroke. While you edit,
the same server-side checks re-run, so the highlights you see are the rules the approval enforces.
Updates arrive over SSE, the stream carries no customer text, and the inbox falls back to polling if
it drops.
