-- 补齐导入正文、长期冲突历史与个人资料的差值计量；系统审计、墓碑、备份不计入个人额度。
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
 UPDATE books SET storage_bytes=storage_bytes+delta WHERE id=b;
 IF e IS NOT NULL THEN
   UPDATE transactions SET storage_bytes=storage_bytes+delta WHERE id=e;
 END IF;
END $$;

CREATE TRIGGER conflict_resolutions_storage_meter AFTER INSERT OR UPDATE OR DELETE ON "conflict_resolutions" FOR EACH ROW EXECUTE FUNCTION libevra_meter_row('book','book_id','transaction_id');
SELECT libevra_meter_delta(NULL,to_jsonb(r),'book','book_id','transaction_id') FROM "conflict_resolutions" r;
CREATE TRIGGER ledger_imports_storage_meter AFTER INSERT OR UPDATE OR DELETE ON "ledger_imports" FOR EACH ROW EXECUTE FUNCTION libevra_meter_row('book','target_book_id','');
SELECT libevra_meter_delta(NULL,to_jsonb(r),'book','target_book_id','') FROM "ledger_imports" r;
CREATE TRIGGER ledger_import_jobs_storage_meter AFTER INSERT OR UPDATE OR DELETE ON "ledger_import_jobs" FOR EACH ROW EXECUTE FUNCTION libevra_meter_row('book','target_book_id','');
SELECT libevra_meter_delta(NULL,to_jsonb(r),'book','target_book_id','') FROM "ledger_import_jobs" r;
CREATE TRIGGER ledger_import_source_states_storage_meter AFTER INSERT OR UPDATE OR DELETE ON "ledger_import_source_states" FOR EACH ROW EXECUTE FUNCTION libevra_meter_row('book','target_book_id','');
SELECT libevra_meter_delta(NULL,to_jsonb(r),'book','target_book_id','') FROM "ledger_import_source_states" r;
CREATE TRIGGER ledger_import_undo_batches_storage_meter AFTER INSERT OR UPDATE OR DELETE ON "ledger_import_undo_batches" FOR EACH ROW EXECUTE FUNCTION libevra_meter_row('joblink','job_id','');
SELECT libevra_meter_delta(NULL,to_jsonb(r),'joblink','job_id','') FROM "ledger_import_undo_batches" r;
CREATE TRIGGER ledger_import_job_events_storage_meter AFTER INSERT OR UPDATE OR DELETE ON "ledger_import_job_events" FOR EACH ROW EXECUTE FUNCTION libevra_meter_row('joblink','job_id','');
SELECT libevra_meter_delta(NULL,to_jsonb(r),'joblink','job_id','') FROM "ledger_import_job_events" r;
CREATE TRIGGER user_time_zone_changes_storage_meter AFTER INSERT OR UPDATE OR DELETE ON "user_time_zone_changes" FOR EACH ROW EXECUTE FUNCTION libevra_meter_row('account','user_id','');
SELECT libevra_meter_delta(NULL,to_jsonb(r),'account','user_id','') FROM "user_time_zone_changes" r;
CREATE TRIGGER avatar_unlocks_storage_meter AFTER INSERT OR UPDATE OR DELETE ON "avatar_unlocks" FOR EACH ROW EXECUTE FUNCTION libevra_meter_row('account','user_id','');
SELECT libevra_meter_delta(NULL,to_jsonb(r),'account','user_id','') FROM "avatar_unlocks" r;
CREATE TRIGGER avatar_reward_events_storage_meter AFTER INSERT OR UPDATE OR DELETE ON "avatar_reward_events" FOR EACH ROW EXECUTE FUNCTION libevra_meter_row('account','user_id','');
SELECT libevra_meter_delta(NULL,to_jsonb(r),'account','user_id','') FROM "avatar_reward_events" r;
CREATE TRIGGER avatar_make_up_grants_storage_meter AFTER INSERT OR UPDATE OR DELETE ON "avatar_make_up_grants" FOR EACH ROW EXECUTE FUNCTION libevra_meter_row('account','user_id','');
SELECT libevra_meter_delta(NULL,to_jsonb(r),'account','user_id','') FROM "avatar_make_up_grants" r;
