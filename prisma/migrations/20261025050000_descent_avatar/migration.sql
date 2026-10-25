-- 扩充一个本地审核通过的特典身份；不更新已有用户选择。
BEGIN;
ALTER TABLE "users" DROP CONSTRAINT "users_avatar_id_check";
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_id_check" CHECK ("avatar_id" IN (
  'flower', 'moon', 'sun', 'star', 'house', 'car', 'bird', 'cloud', 'tree',
  'cat', 'dog', 'mushroom', 'coffee', 'boat', 'lighthouse', 'fish', 'leaf', 'mountain',
  'sprout', 'wave', 'daoxuan-special', 'descent-special'
));
COMMIT;
