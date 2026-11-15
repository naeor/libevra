-- 1.19.104：电脑版总览的跨设备配置（账号级，一个账号一份）。
-- 只新建一张空表；不改动任何已有表与数据。应用回滚时保留此表（旧版本不读它），不影响旧版本运行。
CREATE TABLE "dashboard_configurations" (
  "user_id" UUID NOT NULL,
  "schema_version" INTEGER NOT NULL DEFAULT 1,
  "version" INTEGER NOT NULL DEFAULT 1,
  "configuration" JSONB NOT NULL,
  "previous_configuration" JSONB,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dashboard_configurations_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "dashboard_configurations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "dashboard_configurations_version_check" CHECK ("version" > 0 AND "schema_version" > 0),
  CONSTRAINT "dashboard_configurations_size_check" CHECK (octet_length("configuration"::text) <= 4194304)
);
