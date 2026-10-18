-- S13-I: exact backup checkpoint marker.
--
-- This table is intentionally in the same database snapshot as the business rows. The backup
-- wrapper inserts a row under an exclusive advisory lock, then pg_dump dumps an exported snapshot
-- containing that row. Restore therefore reads the checkpoint from the dump instead of guessing
-- from the dump's finish time.

CREATE TABLE "critical_backup_checkpoints" (
    "id" UUID NOT NULL,
    "backup_label" VARCHAR(200),
    "chain_seq" INTEGER NOT NULL,
    "chain_hash" VARCHAR(64),
    "database_name" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "critical_backup_checkpoints_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "critical_backup_checkpoints_created_at_idx"
  ON "critical_backup_checkpoints"("created_at" DESC);
