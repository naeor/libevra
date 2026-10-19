-- S14-D D5 phase 3: scope sourceRef identity to the source ledger namespace.
ALTER TABLE "transactions" ADD COLUMN "source_namespace" VARCHAR(80) NOT NULL DEFAULT '';

DROP INDEX "transactions_book_id_source_ref_key";

CREATE UNIQUE INDEX "transactions_book_id_source_namespace_source_ref_key"
    ON "transactions"("book_id", "source_namespace", "source_ref");
