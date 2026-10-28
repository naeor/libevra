-- 仅新增个人配置；无交易、分类或成员表写入。应用回滚时保留此表以免丢失配置。
CREATE TABLE "workbench_configurations" (
  "user_id" UUID NOT NULL,
  "schema_version" INTEGER NOT NULL DEFAULT 1,
  "version" INTEGER NOT NULL DEFAULT 1,
  "configuration" JSONB NOT NULL,
  "previous_configuration" JSONB,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workbench_configurations_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "workbench_configurations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workbench_configurations_version_check" CHECK ("version" > 0 AND "schema_version" > 0),
  CONSTRAINT "workbench_configurations_size_check" CHECK (octet_length("configuration"::text) <= 4194304)
);
