import { z } from "zod";

/**
 * **头像素材的身份清单（S16）。**
 *
 * 单独放在一个没有任何依赖的模块里，是因为 `profile.ts`（资料校验）与
 * `rewards.ts`（特典奖励规则）都要用同一份 ID 定义，而 `profile.ts` 又依赖
 * `auth.ts`、`auth.ts` 反过来依赖 `rewards.ts` —— 把常量留在 `profile.ts`
 * 会形成 `profile → auth → rewards → profile` 的循环导入，运行时按入口顺序
 * 可能直接报 TDZ 错误。
 */

/** 稳定的素材身份；主题和显示名称不改变这些 ID。 */
export const AVATAR_IDS = [
  "flower",
  "moon",
  "sun",
  "star",
  "house",
  "car",
  "bird",
  "cloud",
  "tree",
  "cat",
  "dog",
  "mushroom",
  "coffee",
  "boat",
  "lighthouse",
  "fish",
  "leaf",
  "mountain",
  "sprout",
  "wave",
  "daoxuan-special",
  "descent-special",
] as const;

/** 审核通过的第一批；旧 ID 继续兼容，但不重新上架未审核素材。 */
export const APPROVED_AVATAR_IDS = ["sprout", "sun", "moon", "star", "wave", "coffee"] as const;

export const SELECTABLE_AVATAR_IDS = ["flower", ...APPROVED_AVATAR_IDS, "daoxuan-special", "descent-special"] as const;

export const avatarIdSchema = z.enum(AVATAR_IDS);

export type AvatarId = z.infer<typeof avatarIdSchema>;
