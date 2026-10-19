-- S14-D5 phase 4 hardening: cover the remaining book-scoped write table.
--
-- `conflict_resolutions` carries a book_id and can be written while a device settles an
-- offline conflict. It is not a transaction row, so the earlier trigger set did not include
-- it. The same parent-book row lock + persistent lock check applies.

DROP TRIGGER IF EXISTS "trg_guard_conflict_resolutions" ON "conflict_resolutions";
CREATE TRIGGER "trg_guard_conflict_resolutions"
  BEFORE INSERT OR UPDATE OR DELETE ON "conflict_resolutions"
  FOR EACH ROW EXECUTE FUNCTION trg_guard_book_id();
