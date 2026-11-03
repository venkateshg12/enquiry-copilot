# Phase 06 — Rate limiting (+ intake limiters)

## 1. Goal

Copy the full rate-limiting library (Lua sliding windows, punitive lockouts, dual bucket, circuit
breaker + memory fallback, trusted-proxy IPs, `visitorId`) and the global + auth + protected limiters.
Replace PaperTrail's document/upload/API-key limiters with limiters for the **public intake form**,
the one endpoint anyone on the internet can hit.

## 2. What I will understand after this phase

1. Why a public form needs three axes of limiting (visitor, IP, business).
2. Why the per-business cap protects the business owner's AI bill.
3. How the copied library fails over when Redis is down.

## 3. Prerequisites

Phase 05 done.

## 4. Files

The file list of `~/Code/prompt-lab/docs/phases/phase-06-rate-limiting.md` §4 (all from `@pt-api/src/`).
`config/rateLimiter.ts` and `constants/rateLimiter.constant.ts` are ADAPT with the limiters below
instead of Prompt Lab's demo limiters.

## 5. Concepts

**Spam is a cost attack.** Every accepted form submission triggers 3 model calls. A bot submitting
the form 10,000 times is 30,000 calls on the business's AI budget. Layers:
1. honeypot field + a minimum fill time (Phase 12/13): cheap, stops dumb bots;
2. **`intakeVisitorLimiter`**: per `visitorId` cookie, 5 / 10 min;
3. **`intakeIpLimiter`**: per IP, 20 / hour (an office or campus NAT still allows several people);
4. **`intakeBusinessLimiter`**: per form key (= business), 300 / day. A flood against one business
   can't run its bill up unbounded. Over the cap, messages are still **saved** with
   `status: "held"` (no AI); staff see them and can process them manually or lift the cap;
5. optional Cloudflare Turnstile (Phase 13) when spam gets heavy (spec §8).

All plain sliding windows, not punitive: a lockout would block a real customer behind a shared IP.

The classifier's `spam` category is the last layer, and it still costs one model call. That's why the
cheap layers come first.

## 6. Steps

Copy as in Prompt Lab Phase 06 §6. In `rateLimiter.constant.ts` add:

```ts
export const INTAKE_VISITOR_PREFIX = "rl:intake:visitor";
export const INTAKE_IP_PREFIX = "rl:intake:ip";
export const INTAKE_BUSINESS_PREFIX = "rl:intake:business";
```

In `config/rateLimiter.ts`, remove the upload/document/invite/API-key limiters (keep `inviteSourceLimiter`
and `inviteTargetLimiter`: staff invites are copied in Phase 10) and add:

```ts
export const intakeVisitorLimiter = createRateLimiter({
    prefix: INTAKE_VISITOR_PREFIX, windowMs: 10 * ONE_MINUTE_MS, max: 5,
    keyResolver: (req: Request) => `v:${visitorKeyResolver(req)}`,
});
export const intakeIpLimiter = createRateLimiter({
    prefix: INTAKE_IP_PREFIX, windowMs: ONE_HOUR_MS, max: 20, keyResolver: ipKeyResolver,
});
/*
  Per business: caps AI spend from a flood against one form. Not a rejection — over the cap the
  message is stored as `held` (Phase 12) — so this limiter is used with `skip` + a manual check
  rather than as a 429.
 */
export const INTAKE_BUSINESS_DAILY_CAP = 300;
```

The business cap is checked inside the intake service with the store directly
(`getDefaultStore().increment(\`${INTAKE_BUSINESS_PREFIX}:${formKey}\`, ONE_DAY_MS, cap)`) so it can
**hold** rather than reject.

## 7. Verify

Rate-limit headers present; the 6th form post from one browser in 10 minutes → 429; the API survives a
Redis stop; `diff -q` the COPY files.

## 8. Definition of done

- [ ] The library is copied; the intake limiters are declared (used in Phase 12).
- [ ] Commit: `feat(api): rate limiting with intake limiters`.

## 9. Interview angle

*"What stops a bot from running up the AI bill through the public form?"* A honeypot and a timing
check, then limits per visitor, per IP and per business (over the business cap, messages are held,
not processed), and the classifier's spam category last.
