-- AlterTable
ALTER TABLE "users" ADD COLUMN     "storage_bytes" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "storage_limit_bytes" BIGINT;

-- AlterTable
ALTER TABLE "transaction_events" ADD COLUMN     "device_recorded_at" TIMESTAMPTZ(6),
ADD COLUMN     "entry_version" INTEGER,
ADD COLUMN     "operation_id" VARCHAR(128),
ADD COLUMN     "snapshot" JSONB,
ADD COLUMN     "source_ip" VARCHAR(64);

-- AlterTable
ALTER TABLE "books" ADD COLUMN     "storage_bytes" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "storage_limit_bytes" BIGINT;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "storage_bytes" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "storage_policy" (
    "id" VARCHAR(16) NOT NULL DEFAULT 'global',
    "account_bytes" BIGINT NOT NULL DEFAULT 1000000000,
    "book_bytes" BIGINT NOT NULL DEFAULT 500000000,
    "file_bytes" BIGINT NOT NULL DEFAULT 100000000,
    "entry_bytes" BIGINT NOT NULL DEFAULT 200000000,
    "entry_files" INTEGER NOT NULL DEFAULT 10,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "storage_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entry_attachments" (
    "id" UUID NOT NULL,
    "book_id" UUID NOT NULL,
    "uploader_id" UUID NOT NULL,
    "uploader_name" VARCHAR(64) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "media_type" VARCHAR(100) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "received_bytes" BIGINT NOT NULL DEFAULT 0,
    "sha256" VARCHAR(64),
    "state" VARCHAR(16) NOT NULL DEFAULT 'uploading',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "entry_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entry_attachment_chunks" (
    "attachment_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "entry_attachment_chunks_pkey" PRIMARY KEY ("attachment_id","position")
);

-- CreateTable
CREATE TABLE "entry_attachment_links" (
    "attachment_id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "entry_attachment_links_pkey" PRIMARY KEY ("attachment_id","transaction_id")
);

-- CreateTable
CREATE TABLE "entry_change_notices" (
    "id" UUID NOT NULL,
    "book_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entry_change_notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "entry_attachments_book_id_created_at_idx" ON "entry_attachments"("book_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "entry_attachments_state_expires_at_idx" ON "entry_attachments"("state", "expires_at");

-- CreateIndex
CREATE INDEX "entry_attachment_links_transaction_id_idx" ON "entry_attachment_links"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "entry_change_notices_event_id_key" ON "entry_change_notices"("event_id");

-- CreateIndex
CREATE INDEX "entry_change_notices_recipient_id_book_id_created_at_idx" ON "entry_change_notices"("recipient_id", "book_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "entry_attachments" ADD CONSTRAINT "entry_attachments_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_attachment_chunks" ADD CONSTRAINT "entry_attachment_chunks_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "entry_attachments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_attachment_links" ADD CONSTRAINT "entry_attachment_links_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "entry_attachments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_attachment_links" ADD CONSTRAINT "entry_attachment_links_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_change_notices" ADD CONSTRAINT "entry_change_notices_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_change_notices" ADD CONSTRAINT "entry_change_notices_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_change_notices" ADD CONSTRAINT "entry_change_notices_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "transaction_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 只计业务编码字节，排除派生计数与容量配置；文件按原件实际字节，分块不重复计额。
CREATE FUNCTION libevra_row_bytes(doc jsonb) RETURNS bigint LANGUAGE sql IMMUTABLE AS $$
 SELECT COALESCE(octet_length((doc - ARRAY['storage_bytes','storage_limit_bytes'])::text), 0)::bigint
$$;
CREATE FUNCTION libevra_meter_delta(old_doc jsonb, new_doc jsonb, scope_kind text, scope_key text, entry_key text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
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
 IF scope_kind='entrylink' THEN
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

CREATE FUNCTION libevra_meter_row() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_doc jsonb; after_doc jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN before_doc:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN after_doc:=to_jsonb(NEW); END IF;
 PERFORM libevra_meter_delta(before_doc,after_doc,TG_ARGV[0],TG_ARGV[1],COALESCE(TG_ARGV[2],''));
 RETURN COALESCE(NEW,OLD);
END $$;

-- 一份附件关联多笔时，原件只在账本计一次，每笔关联均完整计入文件限额。
CREATE FUNCTION libevra_attachment_link_meter() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE file_row entry_attachments; entry_book uuid; row_doc jsonb := COALESCE(to_jsonb(NEW),to_jsonb(OLD));
BEGIN
 SELECT * INTO file_row FROM entry_attachments WHERE id=(row_doc->>'attachment_id')::uuid;
 SELECT book_id INTO entry_book FROM transactions WHERE id=(row_doc->>'transaction_id')::uuid;
 IF TG_OP='INSERT' AND (file_row.book_id IS NULL OR entry_book IS DISTINCT FROM file_row.book_id) THEN
   RAISE EXCEPTION 'attachment_book_mismatch' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' THEN
   UPDATE transactions SET storage_bytes=storage_bytes+file_row.size_bytes WHERE id=NEW.transaction_id;
 ELSIF TG_OP='DELETE' THEN
   UPDATE transactions SET storage_bytes=storage_bytes-COALESCE(file_row.size_bytes,0) WHERE id=OLD.transaction_id;
 END IF;
 RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER attachment_link_files AFTER INSERT OR DELETE ON entry_attachment_links
FOR EACH ROW EXECUTE FUNCTION libevra_attachment_link_meter();
-- 删除对象之前先去掉关联，以便关联计数仍可读到原件大小。
CREATE FUNCTION libevra_attachment_before_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM entry_attachment_links WHERE attachment_id=OLD.id;
 RETURN OLD;
END $$;
CREATE TRIGGER attachment_delete_links BEFORE DELETE ON entry_attachments
FOR EACH ROW EXECUTE FUNCTION libevra_attachment_before_delete();

ALTER TABLE entry_attachments ADD CONSTRAINT attachment_size_valid CHECK(size_bytes>0 AND received_bytes>=0 AND received_bytes<=size_bytes);
ALTER TABLE entry_attachments ADD CONSTRAINT attachment_state_valid CHECK(state IN ('uploading','ready'));
ALTER TABLE entry_attachment_chunks ADD CONSTRAINT attachment_chunk_valid CHECK(position>=0 AND octet_length(data)>0 AND octet_length(data)<=1048576);
ALTER TABLE storage_policy ADD CONSTRAINT storage_policy_valid CHECK(account_bytes>0 AND book_bytes>0 AND file_bytes>0 AND file_bytes<=1000000000 AND entry_bytes>0 AND entry_files BETWEEN 1 AND 100);
ALTER TABLE books ADD CONSTRAINT book_storage_limit_valid CHECK(storage_limit_bytes IS NULL OR storage_limit_bytes>0);
ALTER TABLE users ADD CONSTRAINT account_storage_limit_valid CHECK(storage_limit_bytes IS NULL OR storage_limit_bytes>0);

CREATE TRIGGER users_storage_meter AFTER INSERT OR UPDATE OR DELETE ON "users"
FOR EACH ROW EXECUTE FUNCTION libevra_meter_row('account','id','');

CREATE TRIGGER workbench_configurations_storage_meter AFTER INSERT OR UPDATE OR DELETE ON "workbench_configurations"
FOR EACH ROW EXECUTE FUNCTION libevra_meter_row('account','user_id','');

CREATE TRIGGER books_storage_meter AFTER INSERT OR UPDATE OR DELETE ON "books"
FOR EACH ROW EXECUTE FUNCTION libevra_meter_row('book','id','');

CREATE TRIGGER book_members_storage_meter AFTER INSERT OR UPDATE OR DELETE ON "book_members"
FOR EACH ROW EXECUTE FUNCTION libevra_meter_row('book','book_id','');

CREATE TRIGGER categories_storage_meter AFTER INSERT OR UPDATE OR DELETE ON "categories"
FOR EACH ROW EXECUTE FUNCTION libevra_meter_row('book','book_id','');

CREATE TRIGGER payment_methods_storage_meter AFTER INSERT OR UPDATE OR DELETE ON "payment_methods"
FOR EACH ROW EXECUTE FUNCTION libevra_meter_row('book','book_id','');

CREATE TRIGGER tags_storage_meter AFTER INSERT OR UPDATE OR DELETE ON "tags"
FOR EACH ROW EXECUTE FUNCTION libevra_meter_row('book','book_id','');

CREATE TRIGGER transactions_storage_meter AFTER INSERT OR UPDATE OR DELETE ON "transactions"
FOR EACH ROW EXECUTE FUNCTION libevra_meter_row('book','book_id','id');

CREATE TRIGGER transaction_events_storage_meter AFTER INSERT OR UPDATE OR DELETE ON "transaction_events"
FOR EACH ROW EXECUTE FUNCTION libevra_meter_row('book','book_id','transaction_id');

CREATE TRIGGER transaction_tags_storage_meter AFTER INSERT OR UPDATE OR DELETE ON "transaction_tags"
FOR EACH ROW EXECUTE FUNCTION libevra_meter_row('entrylink','','transaction_id');

CREATE TRIGGER transaction_conflicts_storage_meter AFTER INSERT OR UPDATE OR DELETE ON "transaction_conflicts"
FOR EACH ROW EXECUTE FUNCTION libevra_meter_row('entrylink','','transaction_id');

CREATE TRIGGER book_messages_storage_meter AFTER INSERT OR UPDATE OR DELETE ON "book_messages"
FOR EACH ROW EXECUTE FUNCTION libevra_meter_row('book','book_id','');

CREATE TRIGGER ledger_operation_logs_storage_meter AFTER INSERT OR UPDATE OR DELETE ON "ledger_operation_logs"
FOR EACH ROW EXECUTE FUNCTION libevra_meter_row('book','book_id','');

CREATE TRIGGER book_share_links_storage_meter AFTER INSERT OR UPDATE OR DELETE ON "book_share_links"
FOR EACH ROW EXECUTE FUNCTION libevra_meter_row('book','book_id','');

CREATE TRIGGER transaction_not_duplicate_relations_storage_meter AFTER INSERT OR UPDATE OR DELETE ON "transaction_not_duplicate_relations"
FOR EACH ROW EXECUTE FUNCTION libevra_meter_row('book','book_id','');

CREATE TRIGGER entry_attachments_storage_meter AFTER INSERT OR UPDATE OR DELETE ON "entry_attachments"
FOR EACH ROW EXECUTE FUNCTION libevra_meter_row('attachment','book_id','');

CREATE TRIGGER entry_attachment_links_storage_meter AFTER INSERT OR UPDATE OR DELETE ON "entry_attachment_links"
FOR EACH ROW EXECUTE FUNCTION libevra_meter_row('entrylink','','transaction_id');

CREATE TRIGGER entry_change_notices_storage_meter AFTER INSERT OR UPDATE OR DELETE ON "entry_change_notices"
FOR EACH ROW EXECUTE FUNCTION libevra_meter_row('book','book_id','');

CREATE TRIGGER notifications_storage_meter AFTER INSERT OR UPDATE OR DELETE ON "notifications"
FOR EACH ROW EXECUTE FUNCTION libevra_meter_row('account','recipient_id','');

CREATE TRIGGER export_logs_storage_meter AFTER INSERT OR UPDATE OR DELETE ON "export_logs"
FOR EACH ROW EXECUTE FUNCTION libevra_meter_row('book','book_id','');

CREATE TRIGGER import_logs_storage_meter AFTER INSERT OR UPDATE OR DELETE ON "import_logs"
FOR EACH ROW EXECUTE FUNCTION libevra_meter_row('book','book_id','');

-- 迁移只为已有业务内容建计量基线，不修改业务字段。
SELECT libevra_meter_delta(NULL,to_jsonb(r),'account','id','') FROM "users" r;
SELECT libevra_meter_delta(NULL,to_jsonb(r),'account','user_id','') FROM "workbench_configurations" r;
SELECT libevra_meter_delta(NULL,to_jsonb(r),'book','id','') FROM "books" r;
SELECT libevra_meter_delta(NULL,to_jsonb(r),'book','book_id','') FROM "book_members" r;
SELECT libevra_meter_delta(NULL,to_jsonb(r),'book','book_id','') FROM "categories" r;
SELECT libevra_meter_delta(NULL,to_jsonb(r),'book','book_id','') FROM "payment_methods" r;
SELECT libevra_meter_delta(NULL,to_jsonb(r),'book','book_id','') FROM "tags" r;
SELECT libevra_meter_delta(NULL,to_jsonb(r),'book','book_id','id') FROM "transactions" r;
SELECT libevra_meter_delta(NULL,to_jsonb(r),'book','book_id','transaction_id') FROM "transaction_events" r;
SELECT libevra_meter_delta(NULL,to_jsonb(r),'entrylink','','transaction_id') FROM "transaction_tags" r;
SELECT libevra_meter_delta(NULL,to_jsonb(r),'entrylink','','transaction_id') FROM "transaction_conflicts" r;
SELECT libevra_meter_delta(NULL,to_jsonb(r),'book','book_id','') FROM "book_messages" r;
SELECT libevra_meter_delta(NULL,to_jsonb(r),'book','book_id','') FROM "ledger_operation_logs" r;
SELECT libevra_meter_delta(NULL,to_jsonb(r),'book','book_id','') FROM "book_share_links" r;
SELECT libevra_meter_delta(NULL,to_jsonb(r),'book','book_id','') FROM "transaction_not_duplicate_relations" r;
SELECT libevra_meter_delta(NULL,to_jsonb(r),'attachment','book_id','') FROM "entry_attachments" r;
SELECT libevra_meter_delta(NULL,to_jsonb(r),'entrylink','','transaction_id') FROM "entry_attachment_links" r;
SELECT libevra_meter_delta(NULL,to_jsonb(r),'book','book_id','') FROM "entry_change_notices" r;
SELECT libevra_meter_delta(NULL,to_jsonb(r),'account','recipient_id','') FROM "notifications" r;
SELECT libevra_meter_delta(NULL,to_jsonb(r),'book','book_id','') FROM "export_logs" r;
SELECT libevra_meter_delta(NULL,to_jsonb(r),'book','book_id','') FROM "import_logs" r;
