-- 1.19.97: staged guest-source uploads for ledger import.
-- A guest ledger that is too large for one request is uploaded in parts first; previews, import
-- jobs and clean-up previews then reference the staged source by id. Rows expire after 24 hours.
CREATE TABLE "ledger_import_source_uploads" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "guest_book_id" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "source_fingerprint" VARCHAR(64) NOT NULL,
    "transaction_count" INTEGER NOT NULL,
    "part_count" INTEGER NOT NULL,
    "header" JSONB NOT NULL,
    "source" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ledger_import_source_uploads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ledger_import_source_uploads_user_id_guest_book_id_idx"
    ON "ledger_import_source_uploads"("user_id", "guest_book_id");

CREATE INDEX "ledger_import_source_uploads_expires_at_idx"
    ON "ledger_import_source_uploads"("expires_at");

CREATE TABLE "ledger_import_source_upload_parts" (
    "upload_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "transactions" JSONB NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_import_source_upload_parts_pkey" PRIMARY KEY ("upload_id", "position")
);

ALTER TABLE "ledger_import_source_upload_parts"
    ADD CONSTRAINT "ledger_import_source_upload_parts_upload_id_fkey"
    FOREIGN KEY ("upload_id") REFERENCES "ledger_import_source_uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
