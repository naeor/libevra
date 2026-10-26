-- 仅追加四个经典头像 ID；既有 ID、用户选择与特典解锁记录均不改写。
-- 与共享 AVATAR_IDS 保持相同顺序。事务失败时保留原约束。
BEGIN;
ALTER TABLE "users" DROP CONSTRAINT "users_avatar_id_check";
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_id_check" CHECK ("avatar_id" IN (
  'flower', 'moon', 'sun', 'star', 'house', 'car', 'bird', 'cloud', 'tree',
  'cat', 'dog', 'mushroom', 'coffee', 'boat', 'lighthouse', 'fish', 'leaf', 'mountain',
  'sprout', 'wave', 'daoxuan-special', 'descent-special',
  'jade', 'ghost', 'ingot', 'breakfast-sun'
));
COMMIT;
