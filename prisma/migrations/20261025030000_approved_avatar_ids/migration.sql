-- 仅扩充允许值；已有头像选择不变，不重新解释 leaf/boat 等旧 ID。
ALTER TABLE "users" DROP CONSTRAINT "users_avatar_id_check";
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_id_check" CHECK ("avatar_id" IN (
  'flower', 'moon', 'sun', 'star', 'house', 'car', 'bird', 'cloud', 'tree',
  'cat', 'dog', 'mushroom', 'coffee', 'boat', 'lighthouse', 'fish', 'leaf', 'mountain',
  'sprout', 'wave'
));
