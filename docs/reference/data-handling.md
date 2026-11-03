# Data handling and privacy

Customer messages contain names, phone numbers, email addresses and sometimes things people would
rather not share. The business is responsible for them. The software is designed so that doing the
right thing is the default.

## What is stored, and for how long

| Data | Where | Kept | Removed by |
| --- | --- | --- | --- |
| Message (name, contact, body), AI result, reply, booking | PostgreSQL, tenant-scoped | `Org.retentionDays` (default 180, owner-set, 30–730) after `receivedAt` | nightly `retention` job: deletes the `Message` row; cascades remove AI results, model calls, reply, booking |
| Model call metadata (tokens, cost, latency, outcome) | `model_calls` | with its message; eval rows forever (fictional data) | cascade |
| Audit log | `audit_logs` | 2 years; **contact details masked** in diffs at write time | `purge-expired` |
| Gmail refresh token | `gmail_connections.sealed_refresh_token`, AES-256-GCM, key in `SECRET_BOX_KEY` (env, never the DB) | until disconnect | disconnect revokes at Google and deletes the row |
| Staff accounts, sessions | `users`, `sessions` | account lifetime; sessions 30 days | `purge-expired` |

## Erasure on request

`POST /orgs/:orgId/contacts/erase { contact }` (owner) deletes every message from that email or phone
(normalised), with its cascade, and writes one audit entry **without** the contact value (a hash
only). The UI asks for confirmation and shows the count first.

## Never

- No message body, name, phone, email, draft or final reply in **logs** (pino redaction, Phase 02),
  in **Sentry** (`beforeSend` scrub, Phase 32), or in **job payloads** (jobs carry ids only).
- No customer data in the **eval set**. `messages.jsonl` is fictional. Real pilot messages are added
  only with the owner's written permission, with personal details replaced (Phase 29).
- No model provider training on the data: NVIDIA's API terms are checked when you deploy, and the
  pilot agreement says which provider processes messages (Phase 33).
- No auto-send. A person approves every reply.

## Gmail scopes

Per business, only `gmail.readonly` (intake) and `gmail.send` (replies). Not `gmail.modify`, not full
mail access. If the owner only wants form intake, Gmail isn't connected at all. The consent screen and
the settings page say exactly what is read: new messages in the inbox since the connection, excluding
anything in Promotions/Social and anything older than the connection.

## Form spam

Honeypot field, a minimum fill time (a submit faster than 2 s after the form rendered is a bot), the
per-form and per-IP limiters, and a per-business daily intake cap. Captcha only if spam gets through
all of that (spec §8).
