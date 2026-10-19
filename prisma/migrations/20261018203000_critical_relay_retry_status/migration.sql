-- S13-I: asynchronous relay retry and heartbeat state.
--
-- Business responses never wait for these fields. They let the relay back off persistently and
-- let admins see whether the protection layer is healthy without holding COS credentials.

ALTER TABLE "critical_events"
  ADD COLUMN "last_attempt_at" TIMESTAMPTZ(6),
  ADD COLUMN "next_attempt_at" TIMESTAMPTZ(6);

CREATE INDEX "critical_events_delivery_state_next_attempt_at_seq_idx"
  ON "critical_events"("delivery_state", "next_attempt_at", "seq");

CREATE TABLE "critical_relay_status" (
    "id" VARCHAR(16) NOT NULL DEFAULT 'global',
    "last_seen_at" TIMESTAMPTZ(6),
    "last_upload_at" TIMESTAMPTZ(6),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(500),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "critical_relay_status_pkey" PRIMARY KEY ("id")
);
