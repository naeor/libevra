-- 特典头像奖励（S16）：解锁记录、通知事件、一次性补领、账户时区与变更历史。
--
-- 说明与设计决定见 `docs/specs/features/S16-头像奖励系统-设计决定.md`。
-- 活动规则本身不落库：它们由 `packages/shared/src/rewards.ts` 与
-- `apps/api/src/rewards/` 决定；这里只存“已经发了什么、什么时候、为什么”。
BEGIN;

-- 账户时区：用于把“世界哲学日”换算成每个账户的当地日期。
ALTER TABLE "users" ADD COLUMN "time_zone" VARCHAR(64);
ALTER TABLE "users" ADD COLUMN "time_zone_updated_at" TIMESTAMPTZ(6);

-- 解锁记录：每个账户每个特典头像最多一条。唯一索引是并发下的最后一道锁。
CREATE TABLE "avatar_unlocks" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "avatar_id" VARCHAR(24) NOT NULL,
  "activity_id" VARCHAR(64) NOT NULL,
  "source" VARCHAR(16) NOT NULL,
  "unlocked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "avatar_unlocks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "avatar_unlocks_user_id_avatar_id_key"
  ON "avatar_unlocks"("user_id", "avatar_id");
CREATE INDEX "avatar_unlocks_activity_id_idx" ON "avatar_unlocks"("activity_id");

ALTER TABLE "avatar_unlocks" ADD CONSTRAINT "avatar_unlocks_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 「特典」的边界由 shared 决定；这里加一层 CHECK，让手工改库也写不进经典头像。
ALTER TABLE "avatar_unlocks" ADD CONSTRAINT "avatar_unlocks_avatar_id_check"
  CHECK ("avatar_id" IN ('daoxuan-special', 'descent-special'));
ALTER TABLE "avatar_unlocks" ADD CONSTRAINT "avatar_unlocks_source_check"
  CHECK ("source" IN ('first_login', 'anniversary', 'make_up'));

-- 通知事件：发奖与通知分开。未确认的事件在每次 /auth/me 里重新下发。
CREATE TABLE "avatar_reward_events" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "avatar_id" VARCHAR(24) NOT NULL,
  "activity_id" VARCHAR(64) NOT NULL,
  "unlock_id" UUID,
  "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmed_at" TIMESTAMPTZ(6),

  CONSTRAINT "avatar_reward_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "avatar_reward_events_user_id_status_idx"
  ON "avatar_reward_events"("user_id", "status");

ALTER TABLE "avatar_reward_events" ADD CONSTRAINT "avatar_reward_events_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "avatar_reward_events" ADD CONSTRAINT "avatar_reward_events_unlock_id_fkey"
  FOREIGN KEY ("unlock_id") REFERENCES "avatar_unlocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "avatar_reward_events" ADD CONSTRAINT "avatar_reward_events_status_check"
  CHECK ("status" IN ('pending', 'confirmed'));
ALTER TABLE "avatar_reward_events" ADD CONSTRAINT "avatar_reward_events_avatar_id_check"
  CHECK ("avatar_id" IN ('daoxuan-special', 'descent-special'));

-- 一次性补领：以 user_id 作主键，“只有一次”由数据库保证。
CREATE TABLE "avatar_make_up_grants" (
  "user_id" UUID NOT NULL,
  "avatar_id" VARCHAR(24) NOT NULL,
  "activity_id" VARCHAR(64) NOT NULL,
  "used_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "avatar_make_up_grants_pkey" PRIMARY KEY ("user_id")
);

ALTER TABLE "avatar_make_up_grants" ADD CONSTRAINT "avatar_make_up_grants_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "avatar_make_up_grants" ADD CONSTRAINT "avatar_make_up_grants_avatar_id_check"
  CHECK ("avatar_id" IN ('daoxuan-special', 'descent-special'));

-- 账户时区变更历史：只记录变化，不参与发奖判定。
CREATE TABLE "user_time_zone_changes" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "from_zone" VARCHAR(64),
  "to_zone" VARCHAR(64) NOT NULL,
  "source" VARCHAR(16) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_time_zone_changes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "user_time_zone_changes_user_id_created_at_idx"
  ON "user_time_zone_changes"("user_id", "created_at" DESC);

ALTER TABLE "user_time_zone_changes" ADD CONSTRAINT "user_time_zone_changes_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_time_zone_changes" ADD CONSTRAINT "user_time_zone_changes_source_check"
  CHECK ("source" IN ('first_login', 'request', 'manual'));

COMMIT;
