-- S13-I: operation receipt expiry (bearer tokens are not long-lived URL credentials).
ALTER TABLE "critical_operations"
  ADD COLUMN "receipt_expires_at" TIMESTAMPTZ(6) NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours');
