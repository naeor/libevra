-- 只扩充可保存头像、解锁及通知的 CHECK；不改写既有数据与补领范围。
BEGIN;
ALTER TABLE "users" DROP CONSTRAINT "users_avatar_id_check";
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_id_check" CHECK ("avatar_id" IN (
  'flower', 'moon', 'sun', 'star', 'house', 'car', 'bird', 'cloud', 'tree',
  'cat', 'dog', 'mushroom', 'coffee', 'boat', 'lighthouse', 'fish', 'leaf', 'mountain',
  'sprout', 'wave', 'daoxuan-special', 'descent-special',
  'jade', 'ghost', 'ingot', 'breakfast-sun', 'halloween-special'
));
ALTER TABLE "avatar_unlocks" DROP CONSTRAINT "avatar_unlocks_avatar_id_check";
ALTER TABLE "avatar_unlocks" ADD CONSTRAINT "avatar_unlocks_avatar_id_check"
  CHECK ("avatar_id" IN ('daoxuan-special', 'descent-special', 'halloween-special'));
ALTER TABLE "avatar_reward_events" DROP CONSTRAINT "avatar_reward_events_avatar_id_check";
ALTER TABLE "avatar_reward_events" ADD CONSTRAINT "avatar_reward_events_avatar_id_check"
  CHECK ("avatar_id" IN ('daoxuan-special', 'descent-special', 'halloween-special'));
COMMIT;
