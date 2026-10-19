-- S14-D D5 phase 4: persistent business locks, undo journal, confirmation timeout.

ALTER TABLE "ledger_import_jobs"
  ADD COLUMN "phase" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "timeout_seconds" INTEGER NOT NULL DEFAULT 600,
  ADD COLUMN "activity_at" TIMESTAMPTZ(6),
  ADD COLUMN "confirmation_deadline" TIMESTAMPTZ(6),
  ADD COLUMN "undo_attempts" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ledger_write_locks" (
    "id" UUID NOT NULL,
    "book_id" UUID NOT NULL,
    "owner_kind" VARCHAR(16) NOT NULL,
    "owner_id" VARCHAR(64) NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMPTZ(6),
    CONSTRAINT "ledger_write_locks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ledger_write_locks_book_id_released_at_idx"
  ON "ledger_write_locks"("book_id", "released_at");
CREATE INDEX "ledger_write_locks_owner_id_idx"
  ON "ledger_write_locks"("owner_id");
-- At most one active lock per ledger. Partial indexes are intentional: released rows stay as history.
CREATE UNIQUE INDEX "ledger_write_locks_active_book_key"
  ON "ledger_write_locks"("book_id") WHERE "released_at" IS NULL;

CREATE TABLE "ledger_import_undo_batches" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "batch_index" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "applied_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undone_at" TIMESTAMPTZ(6),
    CONSTRAINT "ledger_import_undo_batches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ledger_import_undo_batches_job_id_batch_index_key"
  ON "ledger_import_undo_batches"("job_id", "batch_index");
CREATE INDEX "ledger_import_undo_batches_job_id_undone_at_idx"
  ON "ledger_import_undo_batches"("job_id", "undone_at");

CREATE TABLE "ledger_import_job_events" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "actor_user_id" UUID,
    "detail" JSONB,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ledger_import_job_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ledger_import_job_events_job_id_at_idx"
  ON "ledger_import_job_events"("job_id", "at");

-- --------------------------------------------------------------------------
-- Business write guard. Every relevant write row locks its parent book row
-- FOR SHARE first; lock acquisition takes that same book row FOR UPDATE. This
-- serializes acquisition with in-flight writes and removes the check/write
-- TOCTOU window without any long table lock.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assert_ledger_write(p_book UUID) RETURNS void AS $$
DECLARE
  v_owner TEXT;
  v_claim TEXT;
BEGIN
  IF p_book IS NULL THEN
    RETURN;
  END IF;

  -- The row lock is the serialization point against ledger_write_locks acquisition.
  PERFORM 1 FROM "books" WHERE "id" = p_book FOR SHARE;

  SELECT "owner_id" INTO v_owner
  FROM "ledger_write_locks"
  WHERE "book_id" = p_book AND "released_at" IS NULL
  LIMIT 1;

  IF v_owner IS NULL THEN
    RETURN;
  END IF;

  v_claim := current_setting('libevra.ledger_lock_owner', true);
  IF v_claim IS NULL OR v_claim = '' OR v_claim <> v_owner THEN
    RAISE EXCEPTION 'ledger_locked:%', v_owner USING ERRCODE = 'P0001';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_guard_book_id() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM assert_ledger_write(OLD."book_id");
    RETURN OLD;
  END IF;
  PERFORM assert_ledger_write(NEW."book_id");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_guard_target_book_id() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM assert_ledger_write(OLD."target_book_id");
    RETURN OLD;
  END IF;
  PERFORM assert_ledger_write(NEW."target_book_id");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_guard_books_id() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM assert_ledger_write(OLD."id");
    RETURN OLD;
  END IF;
  PERFORM assert_ledger_write(NEW."id");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_guard_nullable_book_id() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM assert_ledger_write(OLD."book_id");
    RETURN OLD;
  END IF;
  PERFORM assert_ledger_write(NEW."book_id");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_guard_transaction_tag() RETURNS trigger AS $$
DECLARE
  v_book UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT "book_id" INTO v_book FROM "transactions" WHERE "id" = OLD."transaction_id";
    PERFORM assert_ledger_write(v_book);
    RETURN OLD;
  END IF;
  SELECT "book_id" INTO v_book FROM "transactions" WHERE "id" = NEW."transaction_id";
  PERFORM assert_ledger_write(v_book);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'transactions', 'transaction_events', 'transaction_conflicts',
    'categories', 'payment_methods', 'tags', 'book_members', 'book_share_links',
    'book_messages', 'export_logs', 'import_logs', 'book_lifecycle_events',
    'book_recovery_requests', 'book_tombstones'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'trg_guard_' || t, t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION trg_guard_book_id()',
      'trg_guard_' || t, t
    );
  END LOOP;
END;
$$;

DROP TRIGGER IF EXISTS "trg_guard_books" ON "books";
CREATE TRIGGER "trg_guard_books" BEFORE UPDATE OR DELETE ON "books"
  FOR EACH ROW EXECUTE FUNCTION trg_guard_books_id();

DROP TRIGGER IF EXISTS "trg_guard_notifications" ON "notifications";
CREATE TRIGGER "trg_guard_notifications" BEFORE INSERT OR UPDATE OR DELETE ON "notifications"
  FOR EACH ROW EXECUTE FUNCTION trg_guard_nullable_book_id();

DROP TRIGGER IF EXISTS "trg_guard_ledger_imports" ON "ledger_imports";
CREATE TRIGGER "trg_guard_ledger_imports" BEFORE INSERT OR UPDATE OR DELETE ON "ledger_imports"
  FOR EACH ROW EXECUTE FUNCTION trg_guard_target_book_id();

DROP TRIGGER IF EXISTS "trg_guard_ledger_import_source_states" ON "ledger_import_source_states";
CREATE TRIGGER "trg_guard_ledger_import_source_states" BEFORE INSERT OR UPDATE OR DELETE ON "ledger_import_source_states"
  FOR EACH ROW EXECUTE FUNCTION trg_guard_target_book_id();

DROP TRIGGER IF EXISTS "trg_guard_transaction_tags" ON "transaction_tags";
CREATE TRIGGER "trg_guard_transaction_tags" BEFORE INSERT OR UPDATE OR DELETE ON "transaction_tags"
  FOR EACH ROW EXECUTE FUNCTION trg_guard_transaction_tag();
