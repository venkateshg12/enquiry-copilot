# Phase 05 — authenticate, sessions, Google sign-in

## 1. Goal

Copy `authenticate` (signature + live session, cached, fails closed), `requireAdmin`, the device-session
endpoints and Google sign-in. **Keep** PaperTrail's `ensurePersonalOrg` call in
`googleAuth.controller.ts` (unlike Prompt Lab), so Google sign-ups also get their first business.

## 2. What I will understand after this phase

Why a valid JWT isn't enough; the cached, fail-closed session check; the Google takeover rule.

## 3. Prerequisites

Phase 04 done; a Google sign-in Web client.

## 4. Files

`~/Code/prompt-lab/docs/phases/phase-05-authenticate-google.md` §4, except
`controllers/googleAuth.controller.ts` is **COPY** (unchanged from PaperTrail).

## 5. Concepts

PaperTrail Phase 05.

## 6. Steps

Prompt Lab Phase 05 §6, without the `ensurePersonalOrg` removal. Make yourself platform admin (used for
the cross-business admin views in Phase 25).

## 7. Verify

`/auth/me` 200 / 401; revoking a device is immediate; a Google first sign-in creates a business.

## 8. Definition of done

- [ ] Commit: `feat(api): authenticate, sessions, Google`.

## 9. Interview angle

Live sessions, cached 60 s, fail-closed; one door for revocation.
