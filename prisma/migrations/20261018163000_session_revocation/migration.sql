-- S13-H: keep a short-lived revoked-session marker so an old device can be told that the
-- account was closed, rather than being shown a generic "session expired" message.
ALTER TABLE "sessions" ADD COLUMN "revoked_at" TIMESTAMPTZ(6);
