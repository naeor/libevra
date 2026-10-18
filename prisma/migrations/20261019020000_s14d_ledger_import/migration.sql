-- S14-D D2: idempotent guest-ledger import receipts.
--
-- This table is intentionally independent of the book/user foreign-key graph:
-- it is the recovery record that answers "did this import already commit?"
-- after a browser crash or a lost response. Deleting a book must not erase the
-- receipt needed to recover the operation, and access is checked in the route.

CREATE TABLE "ledger_imports" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "target_book_id" UUID NOT NULL,
    "target_created" BOOLEAN NOT NULL DEFAULT false,
    "source_fingerprint" VARCHAR(64) NOT NULL,
    "target_fingerprint" VARCHAR(64),
    "imported_count" INTEGER NOT NULL,
    "skipped_count" INTEGER NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_imports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ledger_imports_user_id_created_at_idx" ON "ledger_imports"("user_id", "created_at");
CREATE INDEX "ledger_imports_target_book_id_idx" ON "ledger_imports"("target_book_id");
