-- S14-D D5 phase 2: durable per-source import decisions.
CREATE TABLE "ledger_import_source_states" (
    "id" UUID NOT NULL,
    "target_book_id" UUID NOT NULL,
    "source_kind" VARCHAR(8) NOT NULL,
    "source_book_id" UUID,
    "source_book_key" VARCHAR(64) NOT NULL,
    "source_transaction_id" UUID NOT NULL,
    "source_fingerprint" VARCHAR(64) NOT NULL,
    "decision" VARCHAR(16) NOT NULL,
    "target_transaction_id" UUID,
    "target_version" INTEGER,
    "last_import_job_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ledger_import_source_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ledger_import_source_states_target_book_id_source_book_key_source_transaction_id_key"
    ON "ledger_import_source_states"("target_book_id", "source_book_key", "source_transaction_id");

CREATE INDEX "ledger_import_source_states_target_book_id_source_kind_source_book_key_idx"
    ON "ledger_import_source_states"("target_book_id", "source_kind", "source_book_key");

ALTER TABLE "ledger_import_jobs" ADD COLUMN "updated_count" INTEGER NOT NULL DEFAULT 0;
