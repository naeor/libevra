import { z } from "zod";

import { displayNameSchema, usernameSchema } from "./auth.js";
import { avatarIdSchema } from "./avatarIds.js";

export { AVATAR_IDS, APPROVED_AVATAR_IDS, SELECTABLE_AVATAR_IDS, avatarIdSchema, type AvatarId } from "./avatarIds.js";

// 每次只保存一个字段。旧值参与原子比较，避免另一设备的修改被静默覆盖。
export const updateProfileRequestSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("displayName"), value: displayNameSchema, previousValue: z.string() }).strict(),
  z.object({ field: z.literal("username"), value: usernameSchema, previousValue: z.string() }).strict(),
  z.object({ field: z.literal("avatarId"), value: avatarIdSchema, previousValue: avatarIdSchema }).strict(),
]);
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;
