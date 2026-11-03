# Lessons

One entry per correction or surprise: **pattern → rule that prevents it**.

## Carried over (read `~/Code/paper-trail/tasks/lessons.md` too)

- Status and enqueue are two writes → write the message and an outbox event in one transaction; let
  the relay enqueue.
- Schema violations get one targeted repair, never blind retries; transient errors back off with
  jitter.
- Document/customer text is data → delimit it, neutralise closing delimiters, never give the model tools.
- Asking an LLM "is this number right?" is probabilistic → check numbers in code against a source of
  truth.
- A random `jobId` deduplicates nothing → derive ids from the work (`pipeline:<messageId>:<runId>`).
- `process.env` outside `constants/env.ts` trips Turbo's env lint → route through `getEnv`.
- Mongoose `Document` has a `model()` method → no field named `model` on interfaces that extend
  `Document` (AI results store `modelKey`).

## AI Enquiry Assistant

_(add as you go)_

## Carried over from the portfolio

- Mongoose silently drops unknown filter keys, so wrong queries "worked" → PostgreSQL + Prisma with
  foreign keys and generated types (PaperTrail ADR 0010).
- Later-phase code copied in early to make a phase compile → leave a `// Phase NN:` comment instead.
- Copied model/field names "improved" for style broke callers → keep the source's names exactly.
