-- S13-I: optional caller idempotency key for P0 operation receipts.
ALTER TABLE "critical_operations"
  ADD COLUMN "idempotency_key_hash" VARCHAR(64);

CREATE UNIQUE INDEX "critical_operations_idempotency_key_hash_key"
  ON "critical_operations"("idempotency_key_hash");
