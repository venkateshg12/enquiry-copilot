# Phase 01 — API bootstrap

## 1. Goal

Copy PaperTrail's API foundation:
- env validated at boot;
- the error trio and the envelope (Zod errors inside it);
- `createApp()` separate from `index.ts`;
- `/health`, 404 handling and ordered graceful shutdown.

The steps are identical to `~/Code/prompt-lab/docs/phases/phase-01-api-bootstrap.md`. Follow it as
written.

## 2. What I will understand after this phase

1. Fail-at-boot env, `appAssert` narrowing, the four-argument error handler.
2. Why `createApp()` has no side effects (Supertest, Phase 29).
3. The shutdown order: server → relay → workers → cache → database.

## 3. Prerequisites

Phase 00 done.

## 4. Files

As in Prompt Lab Phase 01 (sources under `@pt-api/src/`):
- `app.ts`, `index.ts`, `constants/env.ts`, `constants/appErrorCode.ts`: ADAPT;
- `constants/https.ts`, `utils/errors/*`, `utils/api/*`, `middleware/{errorHandler,notFound}.ts`:
  COPY.

**Difference:** in `index.ts`, leave a shutdown placeholder for the **outbox relay** (Phase 12):
`// Phase 12: await stopRelay();`, before `closeWorkers()`. That's PaperTrail's final order.

## 5. Concepts

See Prompt Lab Phase 01 §5. The one addition is the shutdown order. The relay must stop claiming
events **before** the workers close, or an event can be claimed and then abandoned for its 30 s lock.

## 6. Steps

Follow Prompt Lab Phase 01 §6. `appErrorCode`: keep the auth and Gmail codes; Phases 12–23 append
`IntakeRejected`, `BusinessGmailNotConnected`, `DraftFlagged`, `AlreadyHandled`.

## 7. Verify

Prompt Lab Phase 01 §7 (health, 404, validation envelope, missing env stops boot, Ctrl-C shutdown,
`diff -q` of COPY files).

## 8. Definition of done

- [ ] All checks pass. Commit: `feat(api): bootstrap from PaperTrail`.

## 9. Interview angle

route → controller → service → model, one envelope, one error handler, an app factory with no side
effects: the same foundation as my other projects.
