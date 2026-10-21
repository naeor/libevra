-- S15-E3 · 不重复关系记忆（`TransactionNotDuplicateRelation` / `transaction_not_duplicate_relations`）
--
-- 用途：用户明确确认「A、B 这两笔不是同一笔」之后，把这一对关系记住，后续重复提示
-- 可以按这一对抑制。**不具备传递性**：每个都是两两之间的显式判断，不推 A–C。
--
-- 写入范围（本机隔离开发库 / 测试库；生产未应用）：
--   DATABASE_URL（ledger_dev）与 TEST_DATABASE_URL（ledger_test）各执行一次
--   `prisma migrate deploy`。生产迁移需所有者再次批准，本迁移不在生产执行。
--
-- 回滚：forward-only。应用回滚只需回退代码，旧代码不认识这张表也照常运行；
-- 数据库回滚需要人工执行文末的 DOWN 语句或从备份恢复（见设计决定文档 §回滚）。

-- ---------------------------------------------------------------------------
-- 表
-- ---------------------------------------------------------------------------
CREATE TABLE "transaction_not_duplicate_relations" (
    "id" UUID NOT NULL,
    "book_id" UUID NOT NULL,
    -- 规范化为 a < b（数据库 CHECK 兜底，应用层写入前断言）。
    "transaction_a_id" UUID NOT NULL,
    "transaction_b_id" UUID NOT NULL,
    -- 首版只有 not_duplicate；保留扩展位。
    "relationship" VARCHAR(24) NOT NULL DEFAULT 'not_duplicate',
    -- manual / review_group / import_review
    "decision_source" VARCHAR(24) NOT NULL,
    -- 确认人（不加 users 外键：账号注销后这条判断仍要可解释）。
    "decided_by" UUID,
    "decided_by_name" VARCHAR(64),
    "decided_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- 判定当时两笔交易关键字段的"值快照"，不是引用。
    "basis" JSONB NOT NULL DEFAULT '{}',
    -- 软撤销：撤销后该对重新进入候选，行不删除。
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by" UUID,
    "revoked_by_name" VARCHAR(64),
    "revocation_reason" VARCHAR(48),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "transaction_not_duplicate_relations_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- 约束与索引
-- ---------------------------------------------------------------------------
-- 无序的一对只存一行：配合 a < b 的规范化，等价于"无序唯一"。
CREATE UNIQUE INDEX "transaction_not_duplicate_relations_book_id_transaction_a_i_key"
  ON "transaction_not_duplicate_relations"("book_id", "transaction_a_id", "transaction_b_id");

-- 双向查"这一对是否已经判过"。
CREATE INDEX "transaction_not_duplicate_relations_book_id_transaction_a_i_idx"
  ON "transaction_not_duplicate_relations"("book_id", "transaction_a_id");
CREATE INDEX "transaction_not_duplicate_relations_book_id_transaction_b_i_idx"
  ON "transaction_not_duplicate_relations"("book_id", "transaction_b_id");

-- 列"当前生效的关系"（revoked_at IS NULL）。
CREATE INDEX "transaction_not_duplicate_relations_book_id_revoked_at_idx"
  ON "transaction_not_duplicate_relations"("book_id", "revoked_at");

-- 管理页按确认时间倒序分页。
CREATE INDEX "transaction_not_duplicate_relations_book_id_decided_at_idx"
  ON "transaction_not_duplicate_relations"("book_id", "decided_at");

-- 规范化是数据库层的硬保证，而不只是应用层的约定：
-- 同一对 (X,Y) 无论提交顺序如何，都只能落在 (min,max) 这一行上。
ALTER TABLE "transaction_not_duplicate_relations"
  ADD CONSTRAINT "transaction_not_duplicate_relations_ordered_pair_check"
  CHECK ("transaction_a_id" < "transaction_b_id");

-- 首版只有一种关系；新增取值必须先改这里（有意让静默写入不可能）。
ALTER TABLE "transaction_not_duplicate_relations"
  ADD CONSTRAINT "transaction_not_duplicate_relations_relationship_check"
  CHECK ("relationship" IN ('not_duplicate'));

-- ---------------------------------------------------------------------------
-- 外键
-- ---------------------------------------------------------------------------
-- ⚠️ 只加 `book_id` 外键（E1 §6.3 方案 A）。交易侧刻意不加：
--    * 软删除只写 `deleted_at`，本来就不触发级联；
--    * 账本永久清理时由本外键的 Cascade 把关系一并删除，不会留下孤儿行；
--    * 加交易外键会在交易行真正消失时抹掉"这两笔曾经被确认过"的事实。
ALTER TABLE "transaction_not_duplicate_relations"
  ADD CONSTRAINT "transaction_not_duplicate_relations_book_id_fkey"
  FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- S14-D5 导入锁：关系写入同样受账本业务锁保护
-- ---------------------------------------------------------------------------
-- 复用 `trg_guard_book_id()`（20261019150000_s14d_phase4_undo_locks 创建），
-- **不修改任何既有触发器**。锁生效时写入被数据库拒绝（`ledger_locked:%`），
-- 由 `apps/api/src/lib/errors.ts` 统一翻译成 409 的可读错误；应用层在写之前也会先
-- 查一次锁，给出更具体的提示。这两层是有意的：应用层负责说明，数据库负责兜底。
DROP TRIGGER IF EXISTS "trg_guard_transaction_not_duplicate_relations"
  ON "transaction_not_duplicate_relations";
CREATE TRIGGER "trg_guard_transaction_not_duplicate_relations"
  BEFORE INSERT OR UPDATE OR DELETE ON "transaction_not_duplicate_relations"
  FOR EACH ROW EXECUTE FUNCTION trg_guard_book_id();

-- ---------------------------------------------------------------------------
-- DOWN（回滚，forward-only 项目不自动执行；仅在需要撤销本迁移时人工执行）
-- ---------------------------------------------------------------------------
-- DROP TRIGGER IF EXISTS "trg_guard_transaction_not_duplicate_relations"
--   ON "transaction_not_duplicate_relations";
-- DROP TABLE IF EXISTS "transaction_not_duplicate_relations";
