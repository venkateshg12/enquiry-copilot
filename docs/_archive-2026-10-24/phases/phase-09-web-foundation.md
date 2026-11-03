# Phase 09 — Next.js web foundation

## 1. Goal

Copy PaperTrail's web foundation:
- the axios refresh queue and server-wake notice;
- the query client split, the stores, shadcn, `AuthLoader`, the guards, the auth screens;
- **the org store and switcher**, renamed in the UI to **business** (an owner can run several
  businesses).

Remove PaperTrail's document pages; add TanStack Table.

## 2. What I will understand after this phase

The refresh queue, client guards (the cookies belong to the API's domain), literal `NEXT_PUBLIC_*`, and
`clearUserQueries` on session end, plus the business switcher clearing business-scoped queries.

## 3. Prerequisites

Phases 04–08 done.

## 4. Files

As in `~/Code/prompt-lab/docs/phases/phase-09-web-foundation.md` §4, **except**:
- `lib/api.ts`: **COPY**. Keep the `X-Org-Id` header; the API calls it business internally;
- `store/org.store.ts`: **COPY** `@pt-web/src/store/org.store.ts`;
- `components/layout/OrgSwitcher.tsx` → `BusinessSwitcher.tsx`: **ADAPT** (labels only);
- `(app)/layout.tsx` nav: **Inbox**, **Bookings**, **Stats**, **Settings** (info sheet, tone, channels,
  staff), **Account**.

## 5. Concepts

PaperTrail Phase 09 §5. `USER_SCOPED_KEYS`:
`["sessions","org","messages","message","bookings","stats","infoSheet","business","members","activity","channels"]`.

## 6. Steps

Prompt Lab Phase 09 §6, adjusted:
- keep the org store, switcher and `X-Org-Id` (rename labels to "Business");
- the post-login default route is `/inbox`;
- `app/page.tsx` is a public landing page ("Faster, consistent replies — you approve everything"), with
  Sign in and a link to the demo business (Phase 29).

## 7. Verify

PaperTrail/Prompt Lab Phase 09 checks (guards, silent refresh, wake notice, open-redirect guard,
build/lint/typecheck), plus: switching business clears the business-scoped queries.

## 8. Definition of done

- [ ] Commit: `feat(web): Next.js foundation`.

## 9. Interview angle

The single-flight refresh queue, and clearing every business-scoped cache entry on logout or business
switch so one business's customer data never flashes in another's inbox.
