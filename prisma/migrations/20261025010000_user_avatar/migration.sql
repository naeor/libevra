ALTER TABLE "users" ADD COLUMN "avatar_id" VARCHAR(24) NOT NULL DEFAULT 'flower';
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_id_check" CHECK ("avatar_id" IN (
  'flower', 'moon', 'sun', 'star', 'house', 'car', 'bird', 'cloud', 'tree',
  'cat', 'dog', 'mushroom', 'coffee', 'boat', 'lighthouse', 'fish', 'leaf', 'mountain'
));
