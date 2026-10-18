-- S13-I: a membership subject is `bookId:userId` (73 chars), so the generic subject column
-- needs room for the stable composite key. Additive and reversible by a later migration.
ALTER TABLE "critical_events"
  ALTER COLUMN "subject_id" TYPE VARCHAR(128);
