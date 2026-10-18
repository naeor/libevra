-- S14-D D5: durable batched import jobs.
--
-- Deliberately no foreign keys: like ledger_imports, a job receipt must remain
-- answerable even if the user/book lifecycle changes. Authorization is checked
-- by the route against the current session.

CREATE TABLE "ledger_import_jobs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "source_kind" VARCHAR(8) NOT NULL,
    "source_book_id" UUID,
    "target_book_id" UUID NOT NULL,
    "status" VARCHAR(24) NOT NULL,
    "batch_size" INTEGER NOT NULL,
    "next_batch" INTEGER NOT NULL DEFAULT 0,
    "total_batches" INTEGER NOT NULL,
    "source_count" INTEGER NOT NULL,
    "imported_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "removed_count" INTEGER NOT NULL DEFAULT 0,
    "target_baseline_count" INTEGER NOT NULL,
    "target_expected_count" INTEGER NOT NULL,
    "source_fingerprint" VARCHAR(64) NOT NULL,
    "target_fingerprint" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "last_error_code" VARCHAR(64),
    "last_error_message" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ledger_import_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ledger_import_jobs_user_id_created_at_idx" ON "ledger_import_jobs"("user_id", "created_at");
CREATE INDEX "ledger_import_jobs_status_updated_at_idx" ON "ledger_import_jobs"("status", "updated_at");
