-- 容量差值独立暂存，既有 assert_ledger_write 与所有权限判断原样保留。
CREATE TABLE book_storage_pending (book_id uuid PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE, bytes bigint NOT NULL DEFAULT 0);
CREATE OR REPLACE FUNCTION libevra_meter_delta(old_doc jsonb, new_doc jsonb, scope_kind text, scope_key text, entry_key text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
DECLARE doc jsonb := COALESCE(new_doc, old_doc);
 b uuid; u uuid; e uuid; delta bigint; old_file bigint := 0; new_file bigint := 0;
BEGIN
 delta := libevra_row_bytes(new_doc) - libevra_row_bytes(old_doc);
 IF scope_kind='attachment' THEN
   old_file := COALESCE((old_doc->>'size_bytes')::bigint,0);
   new_file := COALESCE((new_doc->>'size_bytes')::bigint,0);
   delta := delta + new_file-old_file;
 END IF;
 IF delta=0 THEN RETURN; END IF;
 IF scope_kind='account' THEN
   u := (doc->>scope_key)::uuid;
   UPDATE users SET storage_bytes=storage_bytes+delta WHERE id=u;
   RETURN;
 END IF;
 IF scope_kind='joblink' THEN
   SELECT target_book_id INTO b FROM ledger_import_jobs WHERE id=(doc->>scope_key)::uuid;
 ELSIF scope_kind='entrylink' THEN
   e := (doc->>'transaction_id')::uuid;
   SELECT book_id INTO b FROM transactions WHERE id=e;
 ELSE
   b := (doc->>scope_key)::uuid;
   IF entry_key<>'' THEN e := (doc->>entry_key)::uuid; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM ledger_write_locks WHERE book_id=b AND released_at IS NULL AND owner_id IS DISTINCT FROM NULLIF(current_setting('libevra.ledger_lock_owner',true),'')) THEN
   INSERT INTO book_storage_pending(book_id,bytes) VALUES(b,delta) ON CONFLICT(book_id) DO UPDATE SET bytes=book_storage_pending.bytes+EXCLUDED.bytes;
 ELSE
   UPDATE books SET storage_bytes=storage_bytes+delta WHERE id=b;
 END IF;
 IF e IS NOT NULL THEN
   UPDATE transactions SET storage_bytes=storage_bytes+delta WHERE id=e;
 END IF;
END $$;


CREATE FUNCTION libevra_flush_storage_pending() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b uuid := COALESCE(NEW.book_id,OLD.book_id); amount bigint;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ledger_write_locks WHERE book_id=b AND released_at IS NULL) THEN
   DELETE FROM book_storage_pending WHERE book_id=b RETURNING bytes INTO amount;
   IF amount IS NOT NULL THEN UPDATE books SET storage_bytes=storage_bytes+amount WHERE id=b; END IF;
 END IF;
 RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER storage_unlock_flush AFTER UPDATE OR DELETE ON ledger_write_locks FOR EACH ROW EXECUTE FUNCTION libevra_flush_storage_pending();
