# Phase 11 — Staff invitations

## 1. Goal

Let an owner or admin add the people who answer customers:
- `POST /orgs/:orgId/invites { email, role }` creates a **single-use, email-bound, 7-day** invitation
  and emails a link (system email, Phase 08);
- `GET /orgs/:orgId/invites` (pending), `DELETE /orgs/:orgId/invites/:id` (revoke);
- the invitee opens the link, sees "*CodeNest* invited you as a **reviewer**", signs in or registers
  **with the invited address**, and accepts;
- **role caps**: owners are never invited (they're promoted); an admin can invite only reviewers and
  viewers; only an owner can invite an admin;
- web: the invitations panel on `/settings/team` and the accept page.

## 2. What I will understand after this phase

1. Why the invite token is stored only as a SHA-256 hash, and why acceptance checks the email.
2. How "single use" holds under two concurrent accepts (a conditional delete, not a read-then-write).
3. Why the token travels in the URL **fragment**, never the path or query.
4. Why an invitation can add a membership but never change an existing one.
5. Why invite endpoints have their own source and target limiters.

## 3. Prerequisites

- Phase 10 done (orgs, memberships, `resolveOrg`, `requireOrgRole`, audit).
- Phase 08's email queue and `EmailProducer`; Phase 04's `createVerificationToken` /
  `hashVerificationToken` (`utils/auth/verificationToken.ts`).

## 4. Files

```
packages/types/src/org.ts                          ADAPT  @pt-root/packages/types/src/org.ts   (+ invite schemas, token in body)
apps/api/
├── prisma/schema.prisma                           ADAPT  (+ enum InviteRole, model Invite — COPY of @pt-api's)
├── prisma/migrations/<ts>_invites/                NEW    (generated)
└── src/
    ├── db/prisma.ts                               ADAPT  (TENANT_MODELS += "Invite")
    ├── services/invite.service.ts                 ADAPT  @pt-api/src/services/invite.service.ts  (role caps; token preview by body)
    ├── controllers/invite.controller.ts           ADAPT  @pt-api/src/controllers/invite.controller.ts (token from body only)
    ├── routes/invite.route.ts                     ADAPT  @pt-api/src/routes/invite.route.ts       (/orgs/:orgId/invites; POST /invites/{preview,accept})
    ├── routes/org.route.ts                        ADAPT  (resolve the "// Phase 11:" mount)
    ├── config/rateLimiter.ts                      ADAPT  (+ inviteSourceLimiter, inviteTargetLimiter, invitePreviewLimiter — from @pt-api/src/config/rateLimiter.ts)
    ├── jobs/producers/email.producer.ts           ADAPT  (+ sendOrgInvite — @pt-api/src/jobs/producers/email.producer.ts)
    ├── jobs/processors/email.processor.ts         ADAPT  (+ ORG_INVITE case)
    ├── constants/queue.ts                         ADAPT  (+ JOB_NAMES.EMAIL.ORG_INVITE)
    └── utils/email/{emailTemplates,html_templates}.ts  ADAPT  @pt-api/src/utils/email/   (getOrgInviteEmail: fragment link, product name)
apps/api/test/tenancy.routes.ts                    ADAPT  (+ invite routes)
apps/web/src/
├── api/org.ts                                     ADAPT  @pt-web/src/api/org.ts   (invite functions; token in body)
├── app/invites/page.tsx                           ADAPT  @pt-web/src/app/invites/[token]/page.tsx (reads #token)
└── app/(app)/settings/team/InvitesPanel.tsx       ADAPT  (the invites half of @pt-web/src/app/(app)/settings/members/page.tsx)
```

## 5. Concepts

**The token.** `createVerificationToken()` returns 32 random bytes (base64url) and its SHA-256. Only
the hash is stored (`Invite.tokenHash`, unique). A database leak hands out no live invitations.

**The fragment.** PaperTrail's link is `/invites/<token>`, and the API route is
`GET /invites/:token`. Paths end up in access logs, proxy logs and the `Referer` header. The link here
is `${CLIENT_URL}/invites#token=<token>`. Browsers never send a fragment to any server, so the token
leaves the browser only in a POST body (which the logger redacts: `token` is on Phase 02's list):

```
GET  /invites#token=…            (web page, the token stays in the browser)
POST /invites/preview { token }  → { orgName, emailMasked, role }       (public, limited)
POST /invites/accept  { token }  → { orgId, role }                      (signed in)
```

**Email-bound.** Accepting compares the signed-in user's email to the invite's, after normalising both
(lower case, trimmed). A forwarded link is useless to anyone else. The preview shows the address
masked (`ra**@example.com`) so the person can tell which account to use without the link revealing it.

**Single use under concurrency.** `acceptInvite` does
`prisma.invite.deleteMany({ where: { id } })` and requires `count === 1`. Two concurrent accepts both
read the invite, but only one delete removes a row. The other gets "expired or already used". Then
`membership.upsert(… update: {})`: an invitation **adds** a membership and never changes one. Someone
who's already an admin and accepts a stale "viewer" invite stays admin. Role changes go through the
role endpoint, which has the last-owner guard.

**Role caps** (ADAPT, in `createInvite`):

| Inviter | May invite as |
| --- | --- |
| owner | admin, reviewer, viewer |
| admin | reviewer, viewer |
| reviewer, viewer | — (`members.manage` missing → 403 at the route) |

```ts
const INVITABLE: Record<OrgRole, readonly InviteRole[]> = {
    owner: ["admin", "reviewer", "viewer"],
    admin: ["reviewer", "viewer"],
    reviewer: [],
    viewer: [],
};
appAssert(INVITABLE[ctx.role].includes(role), FORBIDDEN,
    ctx.role === "admin" ? "Only an owner can invite another admin" : "You can't invite people");
```

Owners can't be invited at all (`InviteRole` has no `owner`). An owner is a promotion, a deliberate
act inside the team page, with the "only an owner can grant owner" check from `member.service.ts`.

**Newest invite wins.** Creating an invite first deletes any pending invite for the same email in this
business, so a corrected role replaces the old link.

**Limiters** (from PaperTrail's config): `inviteSourceLimiter` (per inviting user: 20/hour, so a
compromised admin can't spam), `inviteTargetLimiter` (per target email: 3/day, so nobody's inbox gets
flooded from your system sender), and `invitePreviewLimiter` (per IP: 30/10 min on the public preview,
since tokens are unguessable but the endpoint is unauthenticated).

**The new-account path.** The accept page, when signed out, offers "Sign in" and "Create account" with
`?next=/invites` and the email prefilled (from the preview, unmasked only after sign-in). The fragment
survives the round trip because the page stores it in `sessionStorage` (try/catch) before redirecting.
After registration and email verification (Phase 04), it returns to `/invites` and accepts.

## 6. Steps

1. **Schema.** Copy `enum InviteRole` and `model Invite` from `@pt-api/prisma/schema.prisma`. Add
   `invites Invite[]` to `Org` and `invitesSent Invite[] @relation("InviteInvitedBy")` to `User`.
   Migrate: `pnpm --filter api db:migrate:dev --name invites`. Add `"Invite"` to `TENANT_MODELS`.
2. **Types** (`org.ts`): keep PaperTrail's `inviteRoleSchema`, `inviteSchema`, `pendingInviteSchema`,
   `invitePreviewSchema`; add `inviteTokenSchema = z.object({ token: z.string().min(20).max(200) })`.
3. **Service.** Start from `@pt-api/src/services/invite.service.ts`:
   - `createInvite(ctx: { orgId, userId, role }, input)`: add the role-cap assert at the top. The
     rest is as is: already-a-member → 409, delete older invites, create, email, audit (`diff` has
     the role, **not** the email: the target id already carries it, and data-handling.md keeps
     contact values out of diffs).
   - `getInvitePreview(token)` and `acceptInvite(userId, token)`: unchanged logic, both still in
     `runAsSystem` (the caller isn't a member yet; the token is the scope).
   - Fallback org name: `"a business"` (not "PaperTrail Organisation").
4. **Controller.** Token from `req.body` only (`inviteTokenSchema.parse(req.body).token`), and pass
   `role: req.orgRole` into `createInvite`.
5. **Routes:**
   ```ts
   export const orgInviteRouter = Router({ mergeParams: true });   // mounted at /orgs/:orgId/invites
   orgInviteRouter.post("/", requireOrgRole("members.manage"), inviteSourceLimiter, inviteTargetLimiter, createInviteHandler);
   orgInviteRouter.get("/", requireOrgRole("members.manage"), listPendingInvitesHandler);
   orgInviteRouter.delete("/:id", requireOrgRole("members.manage"), revokeInviteHandler);

   export const publicInviteRouter = Router();                     // mounted at /invites
   publicInviteRouter.post("/preview", invitePreviewLimiter, getInvitePreviewHandler);
   publicInviteRouter.post("/accept", authenticate, protectedApiLimiter, acceptInviteHandler);
   ```
   `orgInviteRouter` sits behind Phase 10's `one` router, which already ran `authenticate`,
   `protectedApiLimiter` and `resolveOrg`. Don't repeat them (PaperTrail's file does because it's
   mounted twice there).
6. **Email.** `getOrgInviteEmail(token, orgName, role)`: link `${CLIENT_URL}/invites#token=${token}`,
   subject `"You're invited to answer messages for ${orgName}"`, plain text + HTML. The processor case
   `ORG_INVITE` calls `sendEmail` with it. The producer's `jobId: invite-<inviteId>` dedupes double
   clicks. The job payload carries the token because the email must contain it. That's why Phase 08
   keeps Bull Board off in production, behind Basic auth.
7. **`test/tenancy.routes.ts`**: append `GET/POST /orgs/:orgId/invites` and
   `DELETE /orgs/:orgId/invites/:id`.
8. **Purge.** Add `invites` with `expires_at < now()` to Phase 08's `purge-expired` (resolving its
   `// Phase 11:` comment). Reads already treat an expired invite as gone; the purge keeps the table
   small.
9. **Web.**
   - `api/org.ts`: `createInvite(orgId, email, role)`, `listPendingInvites(orgId)`,
     `revokeInvite(orgId, id)`, `previewInvite(token)` (POST), `acceptInvite(token)` (POST).
   - `app/invites/page.tsx`: on mount, read `location.hash` (`new URLSearchParams(hash.slice(1)).get("token")`),
     save it to `sessionStorage` under `pending-invite`, then call
     `history.replaceState(null, "", "/invites")` to remove the token from the address bar. Then show
     the preview. Signed in with the right address → **Accept** → select the new business
     (`setSelectedOrgId`) → `clearUserQueries()` → `/inbox`. Signed in with the wrong one → "This
     invitation is for ra**@example.com" + Sign out. Signed out → Sign in / Create account with
     `next=/invites`.
   - `InvitesPanel`: email + role (options from `INVITABLE[myRole]`), pending list with expiry and
     Revoke.

## 7. Verify

```bash
# as owner A
curl -s -b a.txt -XPOST localhost:5000/orgs/$ORG/invites -H 'content-type: application/json' \
  -d '{"email":"riya@example.com","role":"reviewer"}' | jq '.data.invite.role'      # "reviewer"
# the email worker logs a send (dev mailbox / Gmail); copy the token from the link
psql $DATABASE_URL -c "select token_hash from invites" | head -3                    # a hash, not the token

curl -s -XPOST localhost:5000/invites/preview -H 'content-type: application/json' -d "{\"token\":\"$T\"}" | jq .data
# {"orgName":"CodeNest","emailMasked":"ri**@example.com","role":"reviewer"}

# as riya (registered + verified)
curl -s -b r.txt -XPOST localhost:5000/invites/accept -H 'content-type: application/json' -d "{\"token\":\"$T\"}" | jq .data.role
# "reviewer"
# again
curl -s -b r.txt -XPOST localhost:5000/invites/accept -H 'content-type: application/json' -d "{\"token\":\"$T\"}" | jq -r '.errors[0].message'
# This invitation has expired or was already used
```

- Accept as a **different** signed-in user → 403 "This invitation is for riya@example.com".
- Riya (reviewer) tries `POST /orgs/$ORG/invites` → 403.
- Promote someone to admin; as that admin invite `{"role":"admin"}` → 403 "Only an owner can invite
  another admin"; `{"role":"viewer"}` → 201.
- Two concurrent accepts (`curl … & curl … & wait`) → exactly one 200; one membership row.
- A 4th invite to the same email within a day → 429 from `inviteTargetLimiter`.
- Set `expires_at` to the past in SQL → preview says expired.
- Access log lines for the accept page and API contain no token (`grep -c "$T" api.log` → 0).
- Web: open the emailed link signed out → register with the invited address → verify → land back on
  `/invites` → Accept → the Business switcher shows CodeNest.

## 8. Definition of done

- [ ] `invites` migrated; `Invite` is in `TENANT_MODELS`.
- [ ] Hash-only storage, 7-day expiry, newest-invite-wins, email-bound, single-use under concurrency.
- [ ] Role caps enforced in the service; owners can't be invited.
- [ ] The token is only ever in a fragment or a POST body, never a logged path.
- [ ] Invite limiters on create and preview.
- [ ] Web: invitations panel and the accept page, including the new-account path.
- [ ] Commit: `feat: staff invitations`.

## 9. Interview angle

*"How do staff get access?"* An owner or admin invites them by email with a role. The token is 256
random bits, stored only as a hash, valid for seven days, bound to that email address and good for one
use. Single use holds under a double click because acceptance is a conditional delete: only the
request that actually removes the row gets the membership. Admins can't mint other admins, and owners
are never invited, only promoted. And the token rides in the URL fragment, so it never shows up in a
server or proxy log.
