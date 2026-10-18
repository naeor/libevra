-- S13-I: independent critical-event ledger + local outbox.
--
-- Additive only. The existing S12-C backup files and restore path must not depend on this
-- migration: an old backup can be restored without these tables, and a missing remote ledger must
-- never prevent raw restore.

CREATE TABLE "critical_chain" (
    "id" VARCHAR(16) NOT NULL DEFAULT 'global',
    "last_seq" INTEGER NOT NULL DEFAULT 0,
    "last_hash" VARCHAR(64),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "critical_chain_pkey" PRIMARY KEY ("id")
);

INSERT INTO "critical_chain" ("id", "last_seq", "last_hash")
VALUES ('global', 0, NULL)
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE "critical_events" (
    "event_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "prev_hash" VARCHAR(64),
    "event_hash" VARCHAR(64) NOT NULL,
    "event_type" VARCHAR(64) NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "severity" VARCHAR(4) NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_user_id" UUID,
    "actor_account_number" VARCHAR(8),
    "subject_type" VARCHAR(32) NOT NULL,
    "subject_id" VARCHAR(64),
    "book_id" UUID,
    "batch_id" UUID,
    "before_state" JSONB,
    "after_state" JSONB,
    "result" VARCHAR(16) NOT NULL DEFAULT 'success',
    "resource_version" INTEGER,
    "request_id" VARCHAR(64),
    "delivery_state" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "remote_key" VARCHAR(300),
    "remote_etag" VARCHAR(128),
    "uploaded_at" TIMESTAMPTZ(6),
    "acked_at" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(500),
    CONSTRAINT "critical_events_pkey" PRIMARY KEY ("event_id")
);

CREATE UNIQUE INDEX "critical_events_seq_key" ON "critical_events"("seq");
CREATE INDEX "critical_events_delivery_state_seq_idx" ON "critical_events"("delivery_state", "seq");
CREATE INDEX "critical_events_subject_type_subject_id_idx" ON "critical_events"("subject_type", "subject_id");
CREATE INDEX "critical_events_book_id_seq_idx" ON "critical_events"("book_id", "seq");
CREATE INDEX "critical_events_occurred_at_idx" ON "critical_events"("occurred_at");

CREATE TABLE "critical_event_applied" (
    "event_id" UUID NOT NULL,
    "applied_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" VARCHAR(500),
    CONSTRAINT "critical_event_applied_pkey" PRIMARY KEY ("event_id")
);
