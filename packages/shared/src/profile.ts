import { z } from "zod";
import { displayNameSchema, usernameSchema } from "./auth.js";

/** 稳定的素材身份；主题和显示名称不改变这些 ID。 */
export const AVATAR_IDS = ["flower", "moon", "sun", "star", "house", "car", "bird", "cloud", "tree", "cat", "dog", "mushroom", "coffee", "boat", "lighthouse", "fish", "leaf", "mountain", "sprout", "wave", "daoxuan-special", "descent-special"] as const;
/** 审核通过的第一批；旧 ID 继续兼容，但不重新上架未审核素材。 */
export const APPROVED_AVATAR_IDS = ["sprout", "sun", "moon", "star", "wave", "coffee"] as const;
export const SELECTABLE_AVATAR_IDS = ["flower", ...APPROVED_AVATAR_IDS, "daoxuan-special", "descent-special"] as const;
export const avatarIdSchema = z.enum(AVATAR_IDS);
export type AvatarId = z.infer<typeof avatarIdSchema>;

// 每次只保存一个字段。旧值参与原子比较，避免另一设备的修改被静默覆盖。
export const updateProfileRequestSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("displayName"), value: displayNameSchema, previousValue: z.string() }).strict(),
  z.object({ field: z.literal("username"), value: usernameSchema, previousValue: z.string() }).strict(),
  z.object({ field: z.literal("avatarId"), value: avatarIdSchema, previousValue: avatarIdSchema }).strict(),
]);
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;
