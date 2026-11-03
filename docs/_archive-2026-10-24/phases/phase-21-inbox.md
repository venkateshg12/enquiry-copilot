# Phase 21 — The approval inbox

## 1. Goal

The screen staff live in (`/inbox`):
- a **list** with status tabs (Needs approval · Sent · Rejected · Spam · Held · Failed), category
  chips, flag badges, age, channel icon, an assignee, cursor "load more", and live updates (SSE);
- a **detail view**:
  - the customer message (channel, sender, received time in the business timezone);
  - the **extracted details** with issues ("outside opening hours");
  - the **draft** in an editor, with **flagged spans highlighted** and a flag list ("₹3,500 isn't in
    your info sheet");
  - the info entries the draft used;
  - category with confidence (editable);
  - the run history;
- actions: **Approve & send**, **Edit then approve**, **Reject**, **Mark spam / Not spam**, **Re-run
  AI**, **Write my own reply** (no draft);
- keyboard shortcuts and a "next message" flow.

Sending itself is Phase 22. Here the buttons call the API that Phase 22 completes.

## 2. What I will understand after this phase

1. How to present AI output so a human can verify it fast (what the model saw, what code flagged).
2. Why flagged drafts need friction proportional to the risk.
3. How live updates and optimistic UI combine without showing stale drafts.

## 3. Prerequisites

Phase 20 done.

## 4. Files

```
apps/web/src/
├── api/message.ts · hooks/messages/{useMessages,useMessage,useInboxEvents,useReclassify,useRerun}.ts   NEW
├── app/(app)/inbox/page.tsx                      NEW   (list + detail split; ?status=&id=)
├── components/inbox/
│   ├── MessageList.tsx · MessageRow.tsx          NEW
│   ├── MessageDetail.tsx · CustomerMessage.tsx   NEW
│   ├── ExtractedDetails.tsx                      NEW
│   ├── DraftEditor.tsx                           NEW   (textarea + highlight overlay of flagged spans)
│   ├── FlagList.tsx · UsedFacts.tsx              NEW
│   └── ActionBar.tsx · ApproveDialog.tsx · RejectDialog.tsx   NEW
apps/api/src/routes/message.route.ts              ADAPT (GET /messages/:id/detail — message + latest run results + used info entries; PATCH /messages/:id/category)
```

## 5. Concepts

**Show the evidence, not just the answer.** A reviewer verifies a draft in seconds when they see:
- what the customer asked (the message, with the extracted service/date highlighted in it);
- what the AI was allowed to use (the info entries it saw: **UsedFacts**);
- what code is worried about (flagged spans in the draft, each with a sentence: "₹3,500 — not found
  in the info entries shown to the AI").

That's PaperTrail's review-screen idea (evidence next to output), applied to text.

**Highlighting spans in an editable draft.** A `<textarea>` can't style ranges. The common trick: a
`div` behind the textarea renders the same text with `<mark>` around the flagged spans, using the same
font, padding and wrapping (`white-space: pre-wrap; word-wrap: break-word`) and synced scrolling. When
the user edits, re-run the checks **client-side** (the checks package is pure; import it in the web
app, or call `POST /checks/preview` debounced 300 ms) so the highlights follow the edit. A fixed number
stops being flagged.

**Friction proportional to risk.**
- No flags → **Approve & send** is one click (`a` key).
- Warning flags → approve, with the warnings visible.
- Strong flags (an invented price, a booking promise, sensitive data) → **Approve anyway** opens a
  dialog requiring a short reason, which goes to the activity log (Phase 22). Editing the draft until the
  flags clear is the easy path.
- A draft with `sensitive_data` can't be approved without an edit.

**Optimistic but safe.** Approving moves the row out of "Needs approval" optimistically. If the server
answers 409 (someone else handled it), roll back and show "Already handled by Priya". The SSE stream
updates other staff members' lists live, so two people rarely collide.

**Keyboard.**
- `j` / `k`: next / previous message;
- `e`: focus the editor;
- `a`: approve (or open the dialog if flagged);
- `r`: reject;
- `s`: spam;
- `?`: help.

Shortcuts are ignored while typing (PaperTrail's review screen rule).

## 6. Steps

1. API `GET /messages/:id/detail` → `{ message, run: { classify, extract, draft, checks }, usedEntries, history: runs[] }`,
   plus `PATCH /messages/:id/category` (staff correct a category; stored as a label for later
   evaluation; it doesn't re-run the draft unless asked).
2. The list: TanStack Table-free (a simple virtualised list is enough), with filters in the URL. Rows
   show the sender, the first line, the category chip, a red/amber flag dot, and age ("12 min"). SSE
   inserts new rows at the top of "Needs approval" with a subtle highlight.
3. The detail panel layout (desktop): the message on the left, the draft and actions on the right;
   extracted details and used facts in collapsible sections. Mobile: stacked.
4. `DraftEditor` with the overlay and client-side checks (`@repo/checks` if you move the pure checks
   into a package, or the preview endpoint). Show the word count against the limit.
5. Empty states:
   - "Inbox zero 🎉" for "Needs approval" (the one emoji the UI is allowed);
   - "No draft — write your own reply" when the draft step failed.

## 7. Verify

1. Submit 3 messages via the widget → they appear live in "Needs approval" without a reload.
2. Open the one with an invented number (use the fake provider to script one) → the span is highlighted
   with an explanation; edit the number to the sheet's price → the highlight disappears.
3. A strong flag → Approve anyway asks for a reason.
4. Two browsers: approve in A → B's row disappears; B approving the same message → "Already handled".
5. Keyboard: `j k e a` works and is ignored while typing.
6. A message whose draft failed shows "Write your own reply" with an empty editor.

## 8. Definition of done

- [ ] List with live updates; detail with evidence; highlighted flags that follow edits.
- [ ] Friction proportional to risk; collision handling; shortcuts.
- [ ] Commit: `feat(web): approval inbox`.

## 9. Interview angle

*"Why keep a human in the loop?"* Trust and cost of mistakes. The inbox makes the human fast: it shows
what the customer asked, what facts the AI was allowed, and exactly which numbers code couldn't verify.
A clean draft is one keystroke; a risky one needs an edit or a stated reason.
