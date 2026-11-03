# Phase 10 — Businesses, staff roles, audit log (PaperTrail orgs)

## 1. Goal

Make **a business = a PaperTrail org**, enforced at every layer:
- `Org`, `Membership` and `AuditLog` tables (migration `orgs`);
- `POST /orgs` (create a business, you become its **owner**), `GET /orgs`, `GET/PATCH /orgs/:orgId`,
  `DELETE /orgs/:orgId` (owner, with the name typed to confirm);
- members: list, change role, remove (last-owner guard), leave;
- `resolveOrg` (the caller's live membership, cached 60 s, **404** for non-members) and
  `requireOrgRole(permission)` (**403**);
- the Prisma **tenant extension** switched on for this project's tenant tables, so a query without a
  tenant scope throws instead of leaking;
- an **activity log** (`AuditLog`) that later phases write approvals, edits and overrides into;
- the web app: onboarding ("Create your business"), the **Business** switcher, `/settings/team`.

Invitations are Phase 11. Business profile fields (tone, timezone, …) are Phase 12.

## 2. What I will understand after this phase

1. The three gates on every business route: authentication (401), tenancy (404), permission (403),
   and why another business's id answers 404, not 403.
2. How the tenant extension makes a forgotten `orgId` filter impossible to ship, and where it can't
   help (raw SQL).
3. Why the role is read **live** from `memberships` (cached 60 s with explicit invalidation), not
   from the access token.
4. Why a business always has at least one owner, and how that's checked.
5. Why the copied code keeps PaperTrail's names (`Org`, `orgId`) while the UI says "business".

## 3. Prerequisites

- Phases 00–09 done: auth, cache (`cache.get/set/del`), the web foundation.
- Phase 04 did **not** create a personal org on register (PaperTrail's `createPersonalOrg` call was
  left as a `// Phase 10:` comment in `auth.service.ts` and `googleAuth.controller.ts`). This phase
  resolves those comments by **deleting** them: here a new account starts with no business and lands
  on onboarding, or joins one through an invite (Phase 11).

## 4. Files

```
packages/types/src/org.ts                         ADAPT  @pt-root/packages/types/src/org.ts
                                                         (no plan/custom fields/settings; new permission list; createOrgSchema)
apps/api/
├── prisma/schema.prisma                          ADAPT  @pt-api/prisma/schema.prisma   (OrgRole, ActorType, Org (core columns), Membership, AuditLog)
├── prisma/migrations/<ts>_orgs/migration.sql     NEW    (generated)
└── src/
    ├── db/prisma.ts                              ADAPT  @pt-api/src/db/prisma.ts      (TENANT_MODELS for this project; only AuditLog exists so far)
    ├── constants/permissions.ts                  ADAPT  @pt-api/src/constants/permissions.ts   (table in §5)
    ├── middleware/resolveOrg.ts                  ADAPT  @pt-api/src/middleware/resolveOrg.ts   (path param :orgId first)
    ├── middleware/requireOrgRole.ts              COPY   @pt-api/src/middleware/requireOrgRole.ts
    ├── services/org.service.ts                   ADAPT  @pt-api/src/services/org.service.ts    (createOrg instead of createPersonalOrg; core DTO)
    ├── services/member.service.ts                COPY   @pt-api/src/services/member.service.ts
    ├── services/audit.service.ts                 COPY   @pt-api/src/services/audit.service.ts
    ├── services/deletion.service.ts              NEW    (hardDeleteOrg: one transaction, cascades + audit rows)
    ├── utils/actor.ts                            ADAPT  @pt-api/src/utils/actor.ts             (no API keys: always the user)
    ├── controllers/{org,member}.controller.ts    ADAPT  @pt-api/src/controllers/{org,member}.controller.ts
    ├── routes/{org,member}.route.ts              ADAPT  @pt-api/src/routes/{org,member}.route.ts (/:orgId paths; no idempotency middleware)
    ├── types/express.d.ts                        ADAPT  (+ orgId, orgRole on Request)
    ├── scripts/check-tenancy.ts                  NEW    (the Verify smoke check)
    └── app.ts                                    ADAPT  (mount /orgs)
apps/api/test/tenancy.routes.ts                   NEW    (the list of id routes the Phase 31 cross-tenant suite walks)
apps/web/src/
├── api/org.ts                                    ADAPT  @pt-web/src/api/org.ts                 (/orgs/:orgId paths; invites come in Phase 11)
├── store/org.store.ts                            COPY   @pt-web/src/store/org.store.ts
├── hooks/org/useCurrentOrg.ts                    ADAPT  @pt-web/src/hooks/org/useCurrentOrg.ts (GET /orgs/:orgId)
├── components/layout/OrgSwitcher.tsx             ADAPT  @pt-web/src/components/layout/OrgSwitcher.tsx (label "Business", "+ New business")
├── app/(app)/layout.tsx                          ADAPT  @pt-web/src/app/(app)/layout.tsx       (no business → /onboarding)
├── app/(app)/onboarding/page.tsx                 NEW
└── app/(app)/settings/team/page.tsx              ADAPT  @pt-web/src/app/(app)/settings/members/page.tsx (members table only)
```

**Not copied:** `@pt-api/src/middleware/authorize.ts`. Its only job beyond `requireOrgRole` is API-key
scopes, and this project has no API keys (inherited-architecture.md, "not copied").

## 5. Concepts

**Names.** The code says `Org`, `orgId`, `OrgRole`, `Membership`, exactly as PaperTrail, so
`member.service.ts`, `audit.service.ts`, `requireOrgRole.ts` stay COPY and the Phase 31 cross-tenant
tests port unchanged. Every user-facing string says **business** and **team**. Don't rename the code
to match the UI.

**Permissions** (`constants/permissions.ts`), from architecture.md §3:

| Permission | owner | admin | reviewer | viewer |
| --- | :-: | :-: | :-: | :-: |
| `messages.read`, `bookings.read`, `stats.read` | ✓ | ✓ | ✓ | ✓ |
| `messages.reply` (edit draft, approve, reject, mark spam, reprocess), `bookings.update` | ✓ | ✓ | ✓ | |
| `info.manage` (info sheet, tone), `org.update`, `members.manage`, `forms.manage`, `usage.read`, `retention.manage` | ✓ | ✓ | | |
| `org.delete`, `gmail.manage`, `data.erase` | ✓ | | | |

```ts
// constants/permissions.ts — ADAPT: same shape and `can()` as PaperTrail, this project's vocabulary
import type { OrgRole, OrgPermission } from "@repo/types";

const READ = ["messages.read", "bookings.read", "stats.read"] as const;

export const PERMISSIONS = {
    owner: ["*"],
    admin: [...READ, "messages.reply", "bookings.update", "info.manage", "org.update",
            "members.manage", "forms.manage", "usage.read", "retention.manage"],
    reviewer: [...READ, "messages.reply", "bookings.update"],
    viewer: [...READ],
} as const satisfies Record<OrgRole, readonly string[]>;

export type Permission = OrgPermission;

export const can = (role: OrgRole | undefined, permission: Permission): boolean => {
    if (!role) return false;
    const allowed = PERMISSIONS[role] as readonly string[];
    return allowed.includes("*") || allowed.includes(permission);
};
```

`orgPermissionSchema` in `@repo/types/org.ts` lists the same strings (it's the source of the
`OrgPermission` type, and the web hides buttons with the same `can()`).

**Live roles.** A token is a snapshot. PaperTrail's `resolveMembership` reads the membership row,
caches the role for 60 s under `cache:membership:<orgId>:<userId>`, and `revokeMembership` deletes
that key on a role change or removal. A removed reviewer is locked out on their **next** request,
not after their token expires. With the cache down it reads Postgres every time: slower, never more
permissive.

**404 for strangers.** A non-member asking for `/orgs/<someone else's id>/messages` gets `404
Organisation not found`, the same as for an id that doesn't exist. A 403 would confirm the business
exists.

**The org id in the path.** Architecture.md §4 puts every business route under `/orgs/:orgId/…`.
PaperTrail's `resolveOrg` reads `X-Org-Id` (or `?orgId=`). The ADAPT reads the path first:

```ts
// middleware/resolveOrg.ts — ADAPT: path param first; a disagreeing header is a client bug (400)
const resolveOrg = catchError(async (req, _res, next) => {
    const fromPath = req.params.orgId;
    const fromHeader = req.get("x-org-id") || undefined;
    appAssert(!fromPath || !fromHeader || fromPath === fromHeader, BAD_REQUEST,
        "X-Org-Id does not match the business in the URL");
    const raw = fromPath ?? fromHeader;
    const requested = raw ? idSchema("business id").parse(raw) : undefined;

    const { orgId, role } = await resolveMembership(req.userId, requested);
    req.orgId = orgId;
    req.orgRole = role;
    setRequestContext({ orgId, userId: req.userId });   // the tenant extension reads this
    next();
});
```

Routers that use it are created with `Router({ mergeParams: true })`, so `:orgId` from the mount
path reaches the middleware.

**The tenant extension.** `src/db/prisma.ts` is PaperTrail's file. Only `TENANT_MODELS` changes:

```ts
export const TENANT_MODELS = new Set<string>([
    "AuditLog",
    // Phase 11: "Invite"   Phase 12: "InfoEntry"   Phase 13: "Message", "IntakeForm", "OutboxEvent"
    // Phase 21: "AiResult", "ModelCall"   Phase 22: "OrgUsage"   Phase 24: "Reply"
    // Phase 25: "GmailConnection"   Phase 26: "BookingRequest"
]);
```

Each later phase adds its model to the set **in the same commit** that adds the model. A model
missing from the set is the one real way to leak, so the Phase 31 suite asserts that every Prisma
model with an `orgId` field is in `TENANT_MODELS`.

Not tenant tables: `User`, `Session`, `VerificationLink`, `Org`, `Membership`. They're looked up to
*establish* the tenant. Service code reading them filters by `userId`/`orgId` by hand, as the copied
services already do.

**Audit log.** PaperTrail's `AuditLog` has `orgId` but **no foreign key** (it outlives what it
describes). That's why `hardDeleteOrg` deletes audit rows explicitly. Every other child table
cascades from `Org`. Contact details never go into `diff` (data-handling.md): log ids and field
names, not values.

## 6. Steps

1. **Schema.** Add to `schema.prisma`, from PaperTrail, `enum OrgRole`, `enum ActorType`, `model
   Membership` (COPY) and `model AuditLog` (COPY), and this `Org`:
   ```prisma
   model Org {
     id          String   @id @default(uuid(7)) @db.Uuid
     name        String
     createdById String   @map("created_by") @db.Uuid
     createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
     updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

     createdBy   User         @relation("OrgCreatedBy", fields: [createdById], references: [id])
     memberships Membership[]

     @@map("orgs")
   }
   ```
   Add `memberships Membership[]` and `orgsCreated Org[] @relation("OrgCreatedBy")` to `User`.
   Then run `pnpm --filter api db:migrate:dev --name orgs`.
2. **Types.** `@repo/types/org.ts`: keep `orgRoleSchema`, `memberSummarySchema`,
   `changeMemberRoleSchema`; replace the permission enum with §5's list; add
   ```ts
   export const createOrgSchema = z.object({ name: z.string().trim().min(2).max(120) });
   export const updateOrgSchema = z.object({ name: z.string().trim().min(2).max(120).optional() });
   export const deleteOrgSchema = z.object({ confirmName: z.string() });
   export const orgSummarySchema = z.object({ id: z.string(), name: z.string(), role: orgRoleSchema,
       createdAt: z.string(), updatedAt: z.string() });
   ```
   Phase 12 extends `updateOrgSchema` with the profile fields.
3. **Services.** In `org.service.ts`, replace `createPersonalOrg`/`ensurePersonalOrg` with:
   ```ts
   export const createOrg = (userId: string, { name }: CreateOrgSchema) =>
       withTransaction(async (tx) => {
           const org = await tx.org.create({ data: { name, createdById: userId } });
           await tx.membership.create({ data: { orgId: org.id, userId, role: "owner" } });
           await runAsSystem(() => recordAudit({ orgId: org.id, actor: { type: "user", id: userId },
               action: "org.created", target: { type: "org", id: org.id } }, tx));
           return toOrgDto(org);
       });
   ```
   `recordAudit` writes a tenant table inside a request that has no `orgId` yet, so wrap that one call
   in `runAsSystem(() => recordAudit(…, tx))`. The explicit `orgId` in the row scopes it (PaperTrail's
   `emit()` does the same). `toOrgDto` returns `{ id, name, createdBy, createdAt, updatedAt }`;
   Phase 12 adds the profile.
4. **`deletion.service.ts`**:
   ```ts
   export const hardDeleteOrg = async (orgId: string, actorId: string, confirmName: string) => {
       const org = await prisma.org.findUnique({ where: { id: orgId } });
       appAssert(org, NOT_FOUND, "Organisation not found");
       appAssert(confirmName.trim() === org.name, BAD_REQUEST, "Type the business name exactly to delete it");
       await withTransaction(async (tx) => {
           await tx.auditLog.deleteMany({ where: { orgId } });   // no FK, so not cascaded
           await tx.org.delete({ where: { id: orgId } });        // cascades memberships and, later, every tenant table
       });
       // Phase 25: revoke the Gmail grant at Google after the commit (best effort).
       logger.info({ orgId, actorId }, "business deleted");
       return { deleted: true };
   };
   ```
   Clear the members' membership cache keys after the commit (`cache.del` per member, read before
   deleting).
5. **Routes** (`org.route.ts`):
   ```ts
   export const orgRouter = Router();
   orgRouter.use(authenticate, protectedApiLimiter);
   orgRouter.get("/", listMyOrgsHandler);
   orgRouter.post("/", createOrgHandler);

   const one = Router({ mergeParams: true });
   one.use(resolveOrg);
   one.get("/", requireOrgRole("messages.read"), getOrgHandler);
   one.patch("/", requireOrgRole("org.update"), updateOrgHandler);
   one.delete("/", requireOrgRole("org.delete"), deleteOrgHandler);
   one.use("/members", memberRouter);
   // Phase 11: one.use("/invites", orgInviteRouter)   Phase 12: one.use("/info-entries", …)   …
   orgRouter.use("/:orgId", one);
   ```
   `member.route.ts` is PaperTrail's file without `idempotency`, and with `messages.read` (not
   `documents.read`) on the list.
6. **`test/tenancy.routes.ts`**: start the registry the Phase 31 suite walks. Each later phase appends
   its id routes:
   ```ts
   export const TENANT_ROUTES = [
       { method: "get", path: "/orgs/:orgId" },
       { method: "patch", path: "/orgs/:orgId", body: { name: "x" } },
       { method: "get", path: "/orgs/:orgId/members" },
   ] as const;
   ```
7. **`scripts/check-tenancy.ts`**: outside any context, run `prisma.auditLog.findMany({})`; it must
   throw `Tenant scope missing`. Inside `runWithRequestContext({ orgId: A })`, run
   `prisma.auditLog.findMany({ where: { orgId: B } })`; it must throw `Cross-tenant query refused`.
   Print `OK` when both throw.
8. **Web.**
   - `api/org.ts`: `listMyOrgs`, `createOrg`, `getOrg(orgId)`, `updateOrg(orgId, …)`, `deleteOrg`,
     `listMembers`, `changeMemberRole`, `removeMember`, all on `/orgs/${orgId}/…`.
   - `(app)/layout.tsx`: after `AuthLoader`, if `GET /orgs` is empty, `router.replace("/onboarding")`.
     If `selectedOrgId` isn't in the list (removed from that business), select the first one.
   - `onboarding/page.tsx`: one field, "Business name", then `POST /orgs` → select it → `/inbox`
     (an empty state until Phase 23).
   - `OrgSwitcher`: label "Business", plus a "+ New business" item. Switching calls PaperTrail's
     `clearUserQueries()` so one business's messages never flash under another's name.
   - `settings/team`: members table, role select (owner-only options hidden by `can()`), remove,
     leave. The last-owner guard comes from the API (409), shown as an inline error.

## 7. Verify

```bash
pnpm --filter api db:migrate:dev --name orgs           # "Your database is now in sync"
pnpm --filter api tsx src/scripts/check-tenancy.ts     # OK

# as user A (cookies in a.txt)
curl -s -b a.txt -XPOST localhost:5000/orgs -H 'content-type: application/json' -d '{"name":"CodeNest"}'
# {"status":"success","data":{"id":"0193…","name":"CodeNest",…}}
curl -s -b a.txt localhost:5000/orgs | jq '.data[0].role'          # "owner"

# as user B, A's business
curl -s -o /dev/null -w '%{http_code}\n' -b b.txt localhost:5000/orgs/$ORG_A    # 404
# a junk id
curl -s -o /dev/null -w '%{http_code}\n' -b a.txt localhost:5000/orgs/not-a-uuid # 400
# header disagrees with path
curl -s -b a.txt -H "x-org-id: $ORG_B" localhost:5000/orgs/$ORG_A | jq -r '.errors[0].message'
# X-Org-Id does not match the business in the URL
```

- Make B a **viewer** of A's business by hand (`INSERT INTO memberships …`, until Phase 11's invites).
  `PATCH /orgs/$ORG_A` as B → **403**. Promote B to admin in SQL and wait 60 s, or call the role-change
  endpoint, which clears the key → `PATCH` → 200.
- Remove B via `DELETE /orgs/$ORG_A/members/$B` → B's very next `GET /orgs/$ORG_A` → 404.
- A tries to demote themselves (the only owner) → **409** "An organisation needs at least one owner".
- `DELETE /orgs/$ORG_A` with the wrong name → 400. With the right one → 200; `memberships` and
  `audit_logs` for it are gone.
- Web: a fresh account lands on `/onboarding`; after creating two businesses, the switcher swaps
  between them and the network tab shows no request for the old id after the switch.

## 8. Definition of done

- [ ] `orgs`, `memberships`, `audit_logs` migrated; `Org` has only the core columns.
- [ ] Every business route goes `authenticate → protectedApiLimiter → resolveOrg → requireOrgRole`.
- [ ] Non-members get 404; wrong role gets 403; role changes and removals take effect on the next request.
- [ ] `check-tenancy.ts` prints `OK`; `test/tenancy.routes.ts` exists.
- [ ] No personal org on register; onboarding creates the first business.
- [ ] Web: onboarding, Business switcher, team settings.
- [ ] `docs/reference/copy-map.md` rows added for every COPY/ADAPT above.
- [ ] Commit: `feat: businesses, staff roles and audit log (from PaperTrail orgs)`.

## 9. Interview angle

*"How do you keep one business's customer messages away from another's?"* Three gates. The token
proves who you are. `resolveOrg` reads your live membership for the business in the URL, and a
stranger gets a 404 so we don't even confirm the business exists. `requireOrgRole` checks the
permission. Under all of that, a Prisma client extension adds the business id to every query on a
tenant table and throws if there's no tenant in scope, so a forgotten filter fails loudly in
development instead of leaking in production. The one hole is raw SQL, and every raw statement filters
on `org_id` by hand. I copied this from my document-extraction project, where a cross-tenant test suite
already covers it, and I kept the original names so those tests port without edits.
