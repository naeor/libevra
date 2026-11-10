-- 1.19.56 账本权限分级（所有者 2026-11-10 决定）。
-- 只读 viewer → 记账 recorder → 编辑全部 editor；管理员仍是 books.managed_by_user_id（默认创建者）。
-- 不改任何既有行：现有“可编辑”成员就是“编辑全部”，现有“仅查看”成员就是“只读”。

-- 1. 新角色“记账”。只加枚举值，本迁移里不使用它（PostgreSQL 要求新枚举值提交后才能使用）。
ALTER TYPE "BookRole" ADD VALUE IF NOT EXISTS 'recorder';

-- 2. 分享链接可以给出“记账”权限。
ALTER TABLE "book_share_links" DROP CONSTRAINT IF EXISTS "book_share_links_role_known";
ALTER TABLE "book_share_links"
  ADD CONSTRAINT "book_share_links_role_known" CHECK ("role" IN ('editor', 'recorder', 'viewer'));

-- 3. 管理员可以设置“只有管理员能邀请”；默认关闭（所有成员都能邀请，权限不高于自己）。
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "invite_admin_only" BOOLEAN NOT NULL DEFAULT false;
