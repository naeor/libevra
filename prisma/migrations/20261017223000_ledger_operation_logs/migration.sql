-- S13-E 批次 3 · 删除与历史重关联 —— **一处纯加法的 schema 变更**。
--
-- ⚠️ **全部是加法**（一张新表），所以回滚应用不需要回滚这个迁移：旧代码不认识这张表，
-- 也不会因为它存在而出错。发布纪律见运维手册 §9：迁移只向前。
--
-- 所有者 2026-10-17 的决定（S13-E Q4）：
--   *"要记录一次批量操作及操作者；但不必为每一笔交易制造大量独立事件。"*
-- 所以：删除一个已经被用过的分类/支付方式/标签时，**只有一行**摘要，
-- 而不是给每一笔受影响的账目写一条 `transaction_events`。
--
-- ⚠️ **为什么是一张新表，而不是复用 `transaction_events`。**
--
-- `transaction_events` 的读者是**人**，渲染出来是「naeor 删除了 #000103 出租车记录」——
-- 一行一笔账。批量重关联要回答的是另一个问题：「谁在什么时候，把哪个分类下的 N 笔历史
-- 记到了哪里」。塞进同一个 `kind` 枚举，等于让历史页面为"批量"写一个例外，而且一条批量记录
-- 会混在几百条账目变更里。两者长得像，回答的问题不同（与 `value_history` / `transaction_events`
-- 分开的理由是同一个，见 `教训.md` §8.12）。
--
-- ⚠️ **`object_id` 没有外键**：它指向的对象刚刚被删除，那正是这次操作的内容。
-- 外键要么拦住删除，要么把列置空、丢掉"这条摘要是关于谁的"；`object_name` 是可读快照。
--
-- ⚠️ **`actor_id` 可空 + `ON DELETE SET NULL`**，与 `transaction_events.actor_id` 完全一致：
-- 账号注销不该抹掉"他做过这次批量操作"这个事实，`actor_name` 已经存下了当时的名字。

CREATE TABLE IF NOT EXISTS "ledger_operation_logs" (
    "id"             UUID           NOT NULL,
    "book_id"        UUID           NOT NULL,

    -- 谁做的。可空：账号注销后 `actor_id` 变 NULL，名字留在 `actor_name`。
    "actor_id"       UUID,
    "actor_name"     VARCHAR(64)    NOT NULL,

    -- ⚠️ 稳定的标识符，不是一句人话：`category.permanent_delete` 等。
    -- 界面负责把它翻译成中文；**数据库负责挡住拼错的动作名**（与 `transaction_events_kind_known`
    -- 同一个理由：一个拼错的动词会变成一条谁也念不出来的记录，而且是在几天后才被发现）。
    "action"         VARCHAR(48)    NOT NULL,
    "object_type"    VARCHAR(24)    NOT NULL,

    -- ⚠️ 没有外键 —— 对象已经被删掉了。
    "object_id"      UUID           NOT NULL,
    "object_name"    VARCHAR(64)    NOT NULL,

    -- **用户被告知的那个数**：只算未删除的账目（列表口径）。被重连的墓碑行数记在 `detail` 里。
    "affected_count" INTEGER        NOT NULL,

    -- 历史去了哪里、怎么去的。形状随动作变化，所以是 JSONB。
    "detail"         JSONB          NOT NULL,

    -- 只有一列排序字段；多一列就会有两个说不清的先后。
    "at"             TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_operation_logs_pkey" PRIMARY KEY ("id"),

    CONSTRAINT "ledger_operation_logs_action_known" CHECK (
        "action" IN (
            'category.permanent_delete',
            'payment_method.permanent_delete',
            'tag.permanent_delete'
        )
    ),
    CONSTRAINT "ledger_operation_logs_object_type_known" CHECK (
        "object_type" IN ('category', 'payment_method', 'tag')
    )
);

-- ⚠️ **外键走循环 + 存在性检查，与前面几次迁移同一份写法。**
-- `CREATE TABLE IF NOT EXISTS` 会跳过已存在的表，**而紧跟其后的 `ADD CONSTRAINT` 不会跳过**——
-- 那是"第一次成功、第二次失败"的典型写法，而第二次往往发生在别人的机器上。
DO $$
DECLARE
  item RECORD;
BEGIN
  FOR item IN
    SELECT * FROM (VALUES
      -- ⚠️ `CASCADE`：删除整本账就带走它的批量操作记录（记录属于账本）。
      ('ledger_operation_logs', 'ledger_operation_logs_book_id_fkey',
       'FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
      -- ⚠️ `SET NULL`，不是 CASCADE：账号注销后，他做过的事仍然是事实。
      ('ledger_operation_logs', 'ledger_operation_logs_actor_id_fkey',
       'FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE')
    ) AS t(tbl, name, definition)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = item.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', item.tbl, item.name, item.definition);
    END IF;
  END LOOP;
END $$;

-- ⚠️ **这张表目前只服务一个查询**：某本账最近的批量操作，从新到旧。
-- 索引名与 Prisma schema 的默认命名一致（`@@index([bookId, at(sort: Desc)])`），
-- 这样以后 `prisma migrate dev` 不会看到一份"多出来的索引"。
CREATE INDEX IF NOT EXISTS "ledger_operation_logs_book_id_at_idx"
    ON "ledger_operation_logs"("book_id", "at" DESC);
