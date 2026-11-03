# Phase 04 — Accounts and sessions

## 1. Goal

Staff accounts with PaperTrail's (originally e-commerce's) auth:
- register, verify, login, logout;
- refresh with rotation and reuse detection;
- forgot/reset/change password.

Unlike Prompt Lab, **keep PaperTrail's org creation at sign-up**: a new account creates its first
**business** (org) with the user as owner, exactly as PaperTrail does. So copy `auth.service.ts`
**unchanged**.

## 2. What I will understand after this phase

1. Rotation with reuse detection, sessions as documents, timing-safe login, hashed single-use links.
2. Why sign-up + first business is one transaction.

## 3. Prerequisites

Phase 03 done.

## 4. Files

The same file list as `~/Code/prompt-lab/docs/phases/phase-04-accounts-sessions.md` §4, but:
- `services/auth.service.ts`: **COPY** (keeps `createPersonalOrg`). Phase 10 copies `org.service.ts`
  before this compiles. Do Phases 04 and 10's model/service copy together, or copy `org.service.ts`,
  `org.model.ts`, `membership.model.ts` and `org.types.ts` now (they're COPY in Phase 10 too);
- `types/express.d.ts`: **COPY** from PaperTrail (it has `orgId`, `orgRole`, `actor`; `apiKeyId` and
  `scopes` stay unused but harmless; delete them if you prefer and re-tag ADAPT).

## 5. Concepts

See PaperTrail's Phase 04 and 10 docs. The personal "workspace" org name becomes the business name later
(Phase 11 onboarding renames it).

## 6. Steps

Follow Prompt Lab Phase 04 §6, but copy `auth.service.ts` unchanged, and copy
`services/org.service.ts`, `models/{org,membership}.model.ts`, `types/org.types.ts` and
`packages/types/src/org.ts` from PaperTrail now. The temporary email-producer and cache stubs are the
same as in Prompt Lab.

## 7. Verify

The cookie-jar walkthrough (register → verify → refresh → replay revokes). After registering:
`db.orgs.findOne()` exists and `db.memberships.findOne().role === "owner"`.

## 8. Definition of done

- [ ] The auth flow works; sign-up creates a business with an owner membership.
- [ ] Commit: `feat(api): accounts and sessions`.

## 9. Interview angle

The rotation story, and *"signing up creates your business and your owner role in one transaction, so
there is never an account that can't do anything."*
