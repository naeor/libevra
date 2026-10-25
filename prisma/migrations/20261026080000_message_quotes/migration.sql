-- 留言可选引用（第 58 号）：给一条留言附上一笔账目、或一次账目修改事件。
--
-- 设计说明见 `docs/specs/features/S16-留言引用-设计决定.md`。
-- 三列都可空：旧留言全部保持“无引用”，旧客户端读写不受影响。
-- ref_snapshot 是发送时服务端生成的展示快照：目标被删除/清理后，留言仍能安全显示引用内容。
BEGIN;

ALTER TABLE "book_messages" ADD COLUMN "ref_kind" VARCHAR(16);
ALTER TABLE "book_messages" ADD COLUMN "ref_id" UUID;
ALTER TABLE "book_messages" ADD COLUMN "ref_snapshot" JSONB;

-- 类型只允许两种；空表示无引用。
ALTER TABLE "book_messages" ADD CONSTRAINT "book_messages_ref_kind_check"
  CHECK ("ref_kind" IS NULL OR "ref_kind" IN ('transaction', 'event'));

-- 引用类型与目标 id 必须同时存在或同时为空，避免出现“有类型没目标”的半引用。
ALTER TABLE "book_messages" ADD CONSTRAINT "book_messages_ref_pair_check"
  CHECK (("ref_kind" IS NULL) = ("ref_id" IS NULL));

COMMIT;
