-- 1.19.105：1.19.104 新增 dashboard_configurations 时漏了存储计量触发器。
--
-- 路由（apps/api/src/routes/dashboardConfig.ts）沿用了工作台配置的写法：写入后在同一个
-- 事务里比较 beforeUsage/afterUsage，超出账号空间才返回 413。但少了这条触发器，写入
-- 永远不更新 users.storage_bytes，增长判断恒为假、413 分支不可达；24 小时对账
-- （apps/api/src/ledger/storageReconcile.ts）也只从 pg_trigger 反推计量表清单，因此
-- 也发现不了这笔已占用空间。
--
-- 这里补上与 workbench_configurations 完全一致的触发器（账号级、按 user_id 计量），
-- 并把已有行计入基线。不修改已应用的 20261116120000_dashboard_configurations。

CREATE TRIGGER dashboard_configurations_storage_meter AFTER INSERT OR UPDATE OR DELETE ON "dashboard_configurations"
FOR EACH ROW EXECUTE FUNCTION libevra_meter_row('account','user_id','');

-- 迁移只为已有业务内容建计量基线，不修改业务字段。
SELECT libevra_meter_delta(NULL,to_jsonb(r),'account','user_id','') FROM "dashboard_configurations" r;
