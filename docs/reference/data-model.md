# Data model (PostgreSQL 17 + Prisma 7.10.1)

The `apps/api/prisma/schema.prisma` the phases build up to. Each phase adds **only its own models**
and one migration (`pnpm --filter api db:migrate:dev --name <slug>`). The table at the end says who
adds what.

Conventions (from `@pt-api/prisma/schema.prisma` and its ADR 0010):
- UUIDv7 ids (`@default(uuid(7)) @db.Uuid`), time-ordered, so `(created_at, id)` cursors are cheap;
- snake_case tables/columns via `@@map`/`@map`; Prisma fields camelCase; `Timestamptz(3)`;
- every tenant table has `orgId`, and its name is in `TENANT_MODELS` (`src/db/prisma.ts`);
- `onDelete: Cascade` where a row belongs to its parent, so deleting a business or a message is one
  statement;
- no TTL indexes: expiring rows carry `expiresAt`, reads check it, `purge-expired` deletes;
- money is **integer micro-dollars** for model cost; running totals are `BigInt`;
- document-shaped data (extracted fields, check flags, prompt versions) is `jsonb`, validated by the
  `@repo/types` schemas on write and on read;
- **copied models keep PaperTrail's names** (`Org`, `Membership`, `Invite`, `AuditLog`,
  `OutboxEvent`, `password`, `verified`, …).
- Prisma **7.10.1** (stable). npm `latest` is an 8.0 RC; don't use it.

```prisma
generator client {
  provider     = "prisma-client"
  output       = "../src/generated/prisma"
  moduleFormat = "cjs"
}

datasource db {
  provider = "postgresql"
}

// ── Copied enums (PaperTrail) ──────────────────────────────────────────────────────────────────────
enum AuthProvider { local google }
enum PlatformRole { user admin }
enum OrgRole      { owner admin reviewer viewer }
enum InviteRole   { admin reviewer viewer }
enum ActorType    { user system api_key }
enum OutboxStatus { pending dispatched failed }

// ── New enums ─────────────────────────────────────────────────────────────────────────────────────
enum InfoEntryType  { service price timing policy faq address }
enum Channel        { form email }
enum MessageStatus {
  received        // saved, outbox event written
  processing      // pipeline running
  ready           // draft ready for review
  needs_attention // pipeline failed after retries, or a strong flag with no draft
  spam            // classify said spam with confidence ≥ 0.8, or a person marked it
  approved        // approved; sending
  sent
  rejected
}
enum Category       { booking price_or_info complaint follow_up spam other }
enum PipelineStage  { classified extracted drafted checked }
enum ModelPurpose   { classify extract draft judge }
enum SendStatus     { queued sent failed }
enum BookingStatus  { new confirmed declined rescheduled }
enum GmailStatus    { connected needs_reauth disconnected }

// ── Accounts (Phases 04–05) — COPY of @pt-api User / Session / VerificationLink ────────────────────
model User { /* exactly as @pt-api/prisma/schema.prisma, minus back-relations to tables not copied */ }
model Session { /* COPY */ }
model VerificationLink { /* COPY */ }

// ── Businesses and staff (Phases 10–11) — ADAPT of @pt-api Org, COPY of Membership / Invite ────────
model Org {
  id                 String   @id @default(uuid(7)) @db.Uuid
  name               String
  createdById        String   @map("created_by") @db.Uuid
  // Business profile (Phase 12). Kept on Org: 1:1, always read together, no reason for a join.
  toneGuide          String   @default("Warm, short and professional.") @map("tone_guide")
  signature          String?                                           // e.g. "Team CodeNest"
  timezone           String   @default("Asia/Kolkata")                 // IANA; resolves "this Saturday"
  defaultCountry     String   @default("IN") @map("default_country")   // phone normalisation
  supportedLanguages String[] @default(["en"]) @map("supported_languages")
  // The CodeNest demo business (Phase 12 seed). A demo org never sends real email: replies are
  // recorded by the dev transport instead (Phase 25).
  isDemo             Boolean  @default(false) @map("is_demo")
  // Privacy (Phase 28) and cost (Phase 22)
  retentionDays          Int    @default(180) @map("retention_days")
  monthlyBudgetUsdMicros BigInt @default(5000000) @map("monthly_budget_usd_micros")  // $5
  createdAt          DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt          DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  createdBy   User         @relation("OrgCreatedBy", fields: [createdById], references: [id])
  memberships Membership[]
  invites     Invite[]
  // back-relations are added by the phases that add the child models
  @@map("orgs")
}
model Membership { /* COPY of @pt-api */ }
model Invite     { /* COPY of @pt-api */ }

// ── Info sheet (Phase 12) ─────────────────────────────────────────────────────────────────────────
model InfoEntry {
  id        String        @id @default(uuid(7)) @db.Uuid
  orgId     String        @map("org_id") @db.Uuid
  type      InfoEntryType
  title     String                                   // "Python crash course", "Weekend timings"
  content   String                                   // the facts, in plain text, ≤ 1,000 chars
  synonyms  String[]      @default([])               // services only: "python course", "py batch"
  position  Int           @default(0)
  active    Boolean       @default(true)
  createdAt DateTime      @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt DateTime      @updatedAt @map("updated_at") @db.Timestamptz(3)

  org Org @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@index([orgId, type, position])
  @@map("info_entries")
}

// ── Intake (Phases 13–14) ─────────────────────────────────────────────────────────────────────────
model IntakeForm {
  id             String   @id @default(uuid(7)) @db.Uuid
  orgId          String   @map("org_id") @db.Uuid
  formKey        String   @unique @map("form_key")        // public, random, 22 chars base62
  name           String   @default("Website form")
  allowedOrigins String[] @default([]) @map("allowed_origins")   // exact origins; CORS per form
  enabled        Boolean  @default(true)
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  org Org @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@index([orgId])
  @@map("intake_forms")
}

model Message {
  id               String        @id @default(uuid(7)) @db.Uuid
  orgId            String        @map("org_id") @db.Uuid
  channel          Channel
  formId           String?       @map("form_id") @db.Uuid
  fromName         String?       @map("from_name")
  fromContact      String        @map("from_contact")      // email or phone as given
  subject          String?
  body             String                                  // ≤ 5,000 chars
  receivedAt       DateTime      @map("received_at") @db.Timestamptz(3)
  status           MessageStatus @default(received)
  // why a message is needs_attention: draft_failed | pipeline_failed | budget_reached (Phase 21–22)
  // | intake_cap (Phase 13: held by the daily intake cap, no outbox event; released by
  // POST /orgs/:orgId/messages/reprocess-waiting, Phase 22)
  statusReason     String?       @map("status_reason")
  // denormalised from the latest AiResult, so the inbox list never joins
  category         Category?
  possibleSpam     Boolean       @default(false) @map("possible_spam")
  strongFlags      Int           @default(0) @map("strong_flags")
  // email channel (Phase 25)
  gmailMessageId   String?       @map("gmail_message_id")
  gmailThreadId    String?       @map("gmail_thread_id")
  rfcMessageId     String?       @map("rfc_message_id")   // for In-Reply-To / References
  clientSubmissionId String?     @map("client_submission_id")   // widget retry dedupe
  createdAt        DateTime      @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt        DateTime      @updatedAt @map("updated_at") @db.Timestamptz(3)

  org       Org        @relation(fields: [orgId], references: [id], onDelete: Cascade)
  aiResults AiResult[]
  modelCalls ModelCall[]
  reply     Reply?
  booking   BookingRequest?

  @@unique([orgId, gmailMessageId])                       // a re-polled email is not a new message
  @@unique([orgId, clientSubmissionId])                   // a retried form post is not a new message
  @@index([orgId, status, receivedAt(sort: Desc), id(sort: Desc)])
  @@index([orgId, category, receivedAt(sort: Desc)])
  @@index([orgId, receivedAt])                            // retention sweep
  @@map("messages")
}

// ── Pipeline (Phases 16–22) ───────────────────────────────────────────────────────────────────────
model AiResult {
  id             String        @id @default(uuid(7)) @db.Uuid
  orgId          String        @map("org_id") @db.Uuid
  messageId      String        @map("message_id") @db.Uuid
  attempt        Int           @default(1)               // 2+ = "reprocess" by a person
  stage          PipelineStage                           // last finished step (the checkpoint)
  category       Category?
  confidence     Float?
  language       String?
  extracted      Json?                                   // extractOutput + issues[]
  infoEntryIds   String[]      @default([]) @map("info_entry_ids") @db.Uuid   // what the draft was allowed to use
  draft          String?
  checks         Json?                                   // { flags: [{ code, severity, span, note }] }
  promptVersions Json          @default("{}") @map("prompt_versions")        // { classify: "classify@2", … }
  models         Json          @default("{}")                                 // { classify: "nvidia:…", … }
  costUsdMicros  Int           @default(0) @map("cost_usd_micros")
  latencyMs      Int?          @map("latency_ms")          // received → checked
  createdAt      DateTime      @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt      DateTime      @updatedAt @map("updated_at") @db.Timestamptz(3)

  message Message @relation(fields: [messageId], references: [id], onDelete: Cascade)

  @@unique([messageId, attempt])
  @@index([orgId, createdAt(sort: Desc)])
  @@map("ai_results")
}

model ModelCall {                                        // ADAPT of @pt-api ExtractionRun
  id            String       @id @default(uuid(7)) @db.Uuid
  orgId         String       @map("org_id") @db.Uuid
  messageId     String?      @map("message_id") @db.Uuid    // null for eval runs
  purpose       ModelPurpose
  provider      String
  model         String
  promptVersion String       @map("prompt_version")
  tokensIn      Int          @default(0) @map("tokens_in")
  tokensOut     Int          @default(0) @map("tokens_out")
  costUsdMicros Int          @default(0) @map("cost_usd_micros")
  latencyMs     Int?         @map("latency_ms")
  outcome       String                                      // ok | invalid_json | repaired | provider_error | breaker_open | timeout
  fellBack      Boolean      @default(false) @map("fell_back")
  createdAt     DateTime     @default(now()) @map("created_at") @db.Timestamptz(3)

  message Message? @relation(fields: [messageId], references: [id], onDelete: Cascade)

  @@index([orgId, createdAt(sort: Desc)])
  @@index([messageId])
  @@map("model_calls")
}

model OrgUsage {                                         // ADAPT of @pt-api OrgUsage
  id                String    @id @default(uuid(7)) @db.Uuid
  orgId             String    @map("org_id") @db.Uuid
  month             String                                  // "2026-11", UTC
  messagesProcessed Int       @default(0) @map("messages_processed")
  costUsdMicros     BigInt    @default(0) @map("cost_usd_micros")
  warnedAt          DateTime? @map("warned_at") @db.Timestamptz(3)
  reachedAt         DateTime? @map("reached_at") @db.Timestamptz(3)
  createdAt         DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt         DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)

  org Org @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@unique([orgId, month])
  @@map("org_usage")
}

// ── Human in the loop (Phases 24–26) ──────────────────────────────────────────────────────────────
model Reply {
  id             String     @id @default(uuid(7)) @db.Uuid
  orgId          String     @map("org_id") @db.Uuid
  messageId      String     @unique @map("message_id") @db.Uuid    // one reply per message
  aiResultId     String?    @map("ai_result_id") @db.Uuid
  draftText      String     @map("draft_text")                     // what the AI proposed
  finalText      String     @map("final_text")                     // what was sent
  wasEdited      Boolean    @map("was_edited")
  editDistance   Int        @default(0) @map("edit_distance")      // Levenshtein on words
  overriddenFlags String[]  @default([]) @map("overridden_flags")  // strong flags approved anyway
  overrideReason String?    @map("override_reason")
  approvedById   String     @map("approved_by") @db.Uuid
  approvedAt     DateTime   @default(now()) @map("approved_at") @db.Timestamptz(3)
  sendStatus     SendStatus @default(queued) @map("send_status")
  sentAt         DateTime?  @map("sent_at") @db.Timestamptz(3)
  sentGmailId    String?    @map("sent_gmail_id")
  lastError      String?    @map("last_error")

  message Message @relation(fields: [messageId], references: [id], onDelete: Cascade)

  @@index([orgId, approvedAt(sort: Desc)])
  @@map("replies")
}

model BookingRequest {
  id            String        @id @default(uuid(7)) @db.Uuid
  orgId         String        @map("org_id") @db.Uuid
  messageId     String        @unique @map("message_id") @db.Uuid
  service       String?
  preferredDate DateTime?     @map("preferred_date") @db.Date
  preferredTime String?       @map("preferred_time")              // "17:00"
  status        BookingStatus @default(new)
  confirmedAt   DateTime?     @map("confirmed_at") @db.Timestamptz(3)   // the slot staff agreed, in the business tz
  notes         String?
  updatedById   String?       @map("updated_by") @db.Uuid
  createdAt     DateTime      @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt     DateTime      @updatedAt @map("updated_at") @db.Timestamptz(3)

  message Message @relation(fields: [messageId], references: [id], onDelete: Cascade)

  @@index([orgId, status, preferredDate])
  @@map("booking_requests")
}

model AuditLog    { /* COPY of @pt-api — the activity log (Phase 24) */ }
model OutboxEvent { /* COPY of @pt-api (Phase 13) */ }

// ── Gmail channel (Phase 25) ──────────────────────────────────────────────────────────────────────
model GmailConnection {
  id                 String      @id @default(uuid(7)) @db.Uuid
  orgId              String      @unique @map("org_id") @db.Uuid
  emailAddress       String      @map("email_address")
  sealedRefreshToken String      @map("sealed_refresh_token")      // secretBox (AES-256-GCM), never plaintext
  scopes             String[]
  historyId          String?     @map("history_id")                // Gmail history cursor
  status             GmailStatus @default(connected)
  lastPolledAt       DateTime?   @map("last_polled_at") @db.Timestamptz(3)
  lastError          String?     @map("last_error")
  connectedById      String      @map("connected_by") @db.Uuid
  createdAt          DateTime    @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt          DateTime    @updatedAt @map("updated_at") @db.Timestamptz(3)

  org Org @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@map("gmail_connections")
}

// ── Evaluation (Phases 29–30) — ADAPT of @pt-api EvalRun / EvalResult ─────────────────────────────
model EvalRun {
  id             String   @id @default(uuid(7)) @db.Uuid
  datasetVersion String   @map("dataset_version")     // sha256 of messages.jsonl
  split          String                               // dev | test | injection | bias-pairs
  promptVersions Json     @map("prompt_versions")
  models         Json
  metrics        Json                                 // see pipeline-contracts.md §5
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  results EvalResult[]

  @@index([createdAt(sort: Desc)])
  @@map("eval_runs")
}

model EvalResult {
  id            String   @id @default(uuid(7)) @db.Uuid
  evalRunId     String   @map("eval_run_id") @db.Uuid
  messageRef    String   @map("message_ref")         // "msg_017" from messages.jsonl
  classify      Json                                 // { expected, got, correct }
  extract       Json                                 // per-field { expected, got, correct }
  draft         String?
  checks        Json?
  reviewLabel   String?  @map("review_label")        // approve | needs_edit | bad (Phase 29 review.ts)
  costUsdMicros Int      @default(0) @map("cost_usd_micros")
  latencyMs     Int      @map("latency_ms")
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  evalRun EvalRun @relation(fields: [evalRunId], references: [id], onDelete: Cascade)

  @@unique([evalRunId, messageRef])
  @@map("eval_results")
}
```

`TENANT_MODELS`: `Invite`, `InfoEntry`, `IntakeForm`, `Message`, `AiResult`, `ModelCall`,
`OrgUsage`, `Reply`, `BookingRequest`, `AuditLog`, `OutboxEvent`, `GmailConnection`. Not tenant:
`User`, `Session`, `VerificationLink`, `Org`, `Membership`, `EvalRun`, `EvalResult` (eval runs use a
fixed demo org through `runAsSystem()`).

## Which phase adds what

| Phase | Models / enums | Migration |
| --- | --- | --- |
| 03 | Prisma wiring + empty migration | `init` |
| 04 | `AuthProvider`, `PlatformRole`, `User`, `Session`, `VerificationLink` | `accounts` |
| 10 | `OrgRole`, `ActorType`, `Org` (without the Phase 12/22/28 columns), `Membership`, `AuditLog` | `orgs` |
| 11 | `InviteRole`, `Invite` | `invites` |
| 12 | `InfoEntryType`, `InfoEntry`, Org profile columns, `Org.isDemo` | `info_sheet` |
| 13 | `Channel`, `MessageStatus`, `Category`, `OutboxStatus`, `Message` (incl. `statusReason`), `IntakeForm`, `OutboxEvent` | `intake` |
| 21 | `PipelineStage`, `ModelPurpose`, `AiResult`, `ModelCall` | `pipeline` |
| 22 | `OrgUsage`, `Org.monthlyBudgetUsdMicros` | `usage` |
| 24 | `SendStatus`, `Reply` | `replies` |
| 25 | `GmailStatus`, `GmailConnection`, the Message gmail columns' unique index | `gmail` |
| 26 | `BookingStatus`, `BookingRequest` | `bookings` |
| 28 | `Org.retentionDays` | `retention` |
| 29 | `EvalRun`, `EvalResult` | `evals` |

The pipeline steps in Phases 16–20 are pure functions with unit tests and a CLI (`try-pipeline.ts`).
They write nothing until Phase 21 adds `AiResult`.
