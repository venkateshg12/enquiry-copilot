# Phase 10 — Businesses, staff, roles (from PaperTrail orgs)

## 1. Goal

Make **business = PaperTrail organisation**, enforced:
- memberships with roles (**owner**, **admin**, **staff**, **viewer**);
- `resolveOrg` (from the `X-Org-Id` header, a live membership cached 60 s, 404 for non-members) and
  `requireOrgRole(permission)`;
- the **tenant plugin**, which injects `orgId` into every query on business-owned models and throws
  when the tenant context is missing;
- staff **invites** by email (PaperTrail's hashed, single-use, email-bound tokens);
- a business switcher in the UI.

The spec lists multiple staff and multiple businesses as "later". With PaperTrail's code they come
nearly free, and the inbox's "who approved what" needs real users anyway.

## 2. What I will understand after this phase

1. The three checks: authentication (401), tenancy (404), permission (403), and why cross-business
   access is a 404.
2. How the tenant plugin makes a forgotten `orgId` filter impossible to ship.
3. Why role checks read the live membership.

## 3. Prerequisites

Phase 09 done.

## 4. Files

```
apps/api/src/
├── utils/db/tenantPlugin.ts              COPY   @pt-api/src/utils/db/tenantPlugin.ts
├── middleware/{resolveOrg,requireOrgRole,authorize}.ts   COPY / ADAPT  @pt-api/src/middleware/   (authorize: no API-key branch)
├── constants/permissions.ts              ADAPT  @pt-api/src/constants/permissions.ts   (permissions below)
├── models/invite.model.ts                COPY   @pt-api/src/models/invite.model.ts
├── services/{member,invite}.service.ts   COPY   @pt-api/src/services/
├── controllers/{org,member,invite}.controller.ts · routes/{org,member,invite}.route.ts   COPY / ADAPT  @pt-api/src/
packages/types/src/org.ts                 ADAPT  @pt-root/packages/types/src/org.ts       (role enum: owner, admin, staff, viewer)
apps/web/src/
├── components/layout/BusinessSwitcher.tsx   (from Phase 09)
└── app/(app)/settings/staff/page.tsx        ADAPT  @pt-web/src/app/(app)/settings/members/page.tsx
```

## 5. Concepts

**Permissions** (`constants/permissions.ts`):

| Permission | owner | admin | staff | viewer |
| --- | :-: | :-: | :-: | :-: |
| `messages.read`, `bookings.read`, `stats.read` | ✓ | ✓ | ✓ | ✓ |
| `messages.reply` (approve / edit / reject / spam), `bookings.update` | ✓ | ✓ | ✓ | |
| `business.update` (tone, info sheet), `channels.manage` (Gmail, form), `members.manage` | ✓ | ✓ | | |
| `business.delete`, change an owner's role, `data.export` / `data.delete` (Phase 26) | ✓ | | | |

**The tenant plugin** (PaperTrail Phase 24) goes on every business-owned model: info entries, messages,
AI results, replies, bookings, activity, channels, outbox events. **Not** on users, sessions, orgs,
memberships or invites, which are looked up to *establish* the tenant. System work (the Gmail poller,
retention, the relay) runs in `runAsSystem()`, so every cross-business code path is greppable.

**The public intake endpoint has no session.** The form posts with a **form key** (Phase 12), which
resolves to an `orgId`, and the intake service sets the tenant context from it before touching any
model.

## 6. Steps

1. Copy the files above. Adjust the role enum (`staff` replaces PaperTrail's `reviewer`) in
   `packages/types/src/org.ts`, `membership.model.ts` and the permission table. Update the copy map.
2. Mount `/orgs` (labelled "business" in the UI). From now on every business router is
   `authenticate, protectedApiLimiter, resolveOrg, requireOrgRole(...)`.
3. Invites: as in PaperTrail Phase 25, with the email template rebranded ("Raj invited you to *Sunrise
   Coding Academy* on AI Enquiry Assistant as staff").
4. Port the cross-tenant test file pattern (`@pt-api/test/tenancy.cross-org.int.test.ts`). It runs in
   Phase 29; add a row for every new id route as you build it.
5. Web: `/settings/staff` (list, invite, role change, remove, last-owner guard). The business switcher
   clears business-scoped queries on change.

## 7. Verify

- Invite a second account as **staff** → it can read messages but `PATCH /orgs/current` (info sheet)
  → 403.
- A non-member's `X-Org-Id` → 404.
- A tsx script querying `MessageModel.find({})` without context → "Tenant scope missing".
- Remove the staff member → their next request is 404 immediately.

## 8. Definition of done

- [ ] Roles and permissions enforced live; the tenant plugin on all business-owned models; invites work.
- [ ] Commit: `feat: businesses, staff and roles (from PaperTrail tenancy)`.

## 9. Interview angle

*"How is one business's customer data kept from another's?"* A tenant plugin injects and enforces the
business id on every query, live memberships are cached with explicit invalidation, other businesses'
ids return 404, and a cross-tenant test suite calls every route with another business's ids. It's all
copied from my document-extraction project, where it's already tested.
