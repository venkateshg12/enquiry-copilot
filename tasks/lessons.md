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

- Logs outlive and out-travel the database (drains, laptops, tickets) → **log `messageId`, `orgId`, `category`, `stage`, counts and durations; never a body, a contact or a draft.** Logger redaction is only the backstop (paths, one level deep).
- `pkill -f <path>` from a shell whose own command line contains that path kills the shell → kill by saved PID.
- Playbook's dev API also listens on :5000 (`localhost` resolves to IPv6 first) → verify this API on `PORT=5050` against `127.0.0.1`.
- `_(add as you go)_

- Prisma 7.10.1 generates a client with zero models, but `$allModels` is typed `never`, so the copied tenant extension fails `tsc` → `@ts-expect-error` + explicit param types in `db/prisma.ts` until Phase 04 adds a model (TS flags the directive as unused then; delete it and the annotation).

- `pnpm run db:migrate:dev --name x` appends args to the END of `prisma migrate dev && prisma generate` (so `--name` hit `generate` and `migrate dev` hung on a prompt, holding the advisory lock → P1002 on retry) → script is `sh -c 'prisma migrate dev "$@" && prisma generate' --`. If a lock is stuck: `select pg_terminate_backend(pid) from pg_locks where locktype='advisory'`.
- First login after boot is slower (bcrypt warm-up); compare auth timing over several calls, not one.

## Carried over from the portfolio

- Mongoose silently drops unknown filter keys, so wrong queries "worked" → PostgreSQL + Prisma with
  foreign keys and generated types (PaperTrail ADR 0010).
- Later-phase code copied in early to make a phase compile → leave a `// Phase NN:` comment instead.
- Copied model/field names "improved" for style broke callers → keep the source's names exactly.
