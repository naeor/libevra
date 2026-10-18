-- S13-H: safe account closure, book archive/purge lifecycle, tombstones and recovery requests.
--
-- Additive only. Existing rows keep their meaning; `books.managed_by_user_id` is backfilled from
-- the historical creator so old ledgers have a lifecycle manager without rewriting `created_by`.

ALTER TABLE "users" ADD COLUMN "closed_at" TIMESTAMPTZ(6);

ALTER TABLE "books" ADD COLUMN "managed_by_user_id" UUID;
ALTER TABLE "books" ADD COLUMN "archived_at" TIMESTAMPTZ(6);
ALTER TABLE "books" ADD COLUMN "archived_by_user_id" UUID;
ALTER TABLE "books" ADD COLUMN "archive_reason" VARCHAR(32);
ALTER TABLE "books" ADD COLUMN "self_restore_until" TIMESTAMPTZ(6);
ALTER TABLE "books" ADD COLUMN "scheduled_purge_at" TIMESTAMPTZ(6);
ALTER TABLE "books" ADD COLUMN "purge_started_at" TIMESTAMPTZ(6);
ALTER TABLE "books" ADD COLUMN "purge_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "books" ADD COLUMN "purge_last_error" VARCHAR(500);

-- The historical creator remains untouched; the movable management role starts with them.
UPDATE "books" SET "managed_by_user_id" = "created_by" WHERE "managed_by_user_id" IS NULL;

ALTER TABLE "books"
  ADD CONSTRAINT "books_managed_by_user_id_fkey"
  FOREIGN KEY ("managed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "books_archived_at_scheduled_purge_at_idx"
  ON "books"("archived_at", "scheduled_purge_at");
CREATE INDEX "books_managed_by_user_id_idx" ON "books"("managed_by_user_id");

CREATE TABLE "book_tombstones" (
  "book_id" UUID NOT NULL,
  "book_number" VARCHAR(8),
  "original_created_at" TIMESTAMPTZ(6) NOT NULL,
  "created_by_user_id" UUID,
  "created_by_account_number" VARCHAR(8),
  "archived_at" TIMESTAMPTZ(6),
  "self_restore_until" TIMESTAMPTZ(6),
  "scheduled_purge_at" TIMESTAMPTZ(6),
  "purged_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletion_method" VARCHAR(32) NOT NULL,
  "deletion_reason" VARCHAR(300),
  "deleted_by_user_id" UUID,
  "deleted_by_account_number" VARCHAR(8),
  "member_count" INTEGER NOT NULL,
  "transaction_count" INTEGER NOT NULL,
  "detail" JSONB,
  "request_id" VARCHAR(64),
  CONSTRAINT "book_tombstones_pkey" PRIMARY KEY ("book_id")
);
CREATE INDEX "book_tombstones_purged_at_idx" ON "book_tombstones"("purged_at" DESC);

CREATE TABLE "account_tombstones" (
  "user_id" UUID NOT NULL,
  "account_number" VARCHAR(8) NOT NULL,
  "original_created_at" TIMESTAMPTZ(6) NOT NULL,
  "closed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closure_method" VARCHAR(32) NOT NULL,
  "summary" JSONB,
  "recovery_credential_hash" VARCHAR(64),
  "recovery_credential_created_at" TIMESTAMPTZ(6),
  "recovery_credential_used_at" TIMESTAMPTZ(6),
  "request_id" VARCHAR(64),
  CONSTRAINT "account_tombstones_pkey" PRIMARY KEY ("user_id")
);
CREATE INDEX "account_tombstones_closed_at_idx" ON "account_tombstones"("closed_at" DESC);

CREATE TABLE "book_recovery_requests" (
  "id" UUID NOT NULL,
  "book_id" UUID NOT NULL,
  "book_number" VARCHAR(8),
  "requester_user_id" UUID,
  "requester_account_number" VARCHAR(8) NOT NULL,
  "kind" VARCHAR(24) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
  "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deadline_at" TIMESTAMPTZ(6) NOT NULL,
  "decided_at" TIMESTAMPTZ(6),
  "decided_by_user_id" UUID,
  "decided_by_name" VARCHAR(64),
  "decision_note" VARCHAR(500),
  "target_user_id" UUID,
  "target_account_number" VARCHAR(8),
  "credential_verified_at" TIMESTAMPTZ(6),
  CONSTRAINT "book_recovery_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "book_recovery_requests_status_deadline_at_idx"
  ON "book_recovery_requests"("status", "deadline_at");
CREATE INDEX "book_recovery_requests_book_id_status_idx"
  ON "book_recovery_requests"("book_id", "status");

CREATE TABLE "book_lifecycle_events" (
  "id" UUID NOT NULL,
  "book_id" UUID NOT NULL,
  "kind" VARCHAR(32) NOT NULL,
  "actor_user_id" UUID,
  "actor_account_number" VARCHAR(8),
  "detail" JSONB,
  "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "book_lifecycle_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "book_lifecycle_events_book_id_at_idx"
  ON "book_lifecycle_events"("book_id", "at");
