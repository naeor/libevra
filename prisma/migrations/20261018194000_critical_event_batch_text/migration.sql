-- S13-I: batch ids come from the server request id (for example `req-9`), not a client UUID.
-- Keeping it as text lets a batch be correlated across logs without inventing a second id.
ALTER TABLE "critical_events"
  ALTER COLUMN "batch_id" TYPE VARCHAR(64) USING "batch_id"::text;
