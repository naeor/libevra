-- S13-I: user-visible P0 operation receipts.
--
-- The row has no FK to users: it must remain queryable after an account closure/revocation. Only
-- the receipt token hash is stored; the plaintext token is returned once to the caller.

CREATE TABLE "critical_operations" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(48) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'pending',
    "actor_user_id" UUID,
    "subject_user_id" UUID,
    "token_hash" VARCHAR(64) NOT NULL,
    "detail" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "critical_operations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "critical_operations_created_at_idx"
  ON "critical_operations"("created_at" DESC);
