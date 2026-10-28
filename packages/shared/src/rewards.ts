/**
 * **特典头像奖励：活动规则与接口契约（S16 头像奖励系统）。**
 *
 * 规则表放在 shared，是因为它同时被服务端判定与前端展示使用：
 *   - 服务端用它决定“现在能不能发、按哪个时区发、能不能补领”；
 *   - 前端用它知道“哪些头像属于特典、锁定条件是什么”，而不需要把
 *     头像 id 与规则硬编码在页面里。
 *
 * ⚠️ **服务端才是判定的唯一出处。** 前端拿到的 `activities` 只用于显示
 * 锁定说明；任何“解锁/补领”都必须由服务端依据可信时间与数据库记录确认，
 * 客户端提交“我解锁了”这种请求永远不会被接受。
 *
 * ⚠️ **后续新增特典头像只需改这张表 + 新活动定义**，不要把“两个头像”的
 * 特例写进判断逻辑里。年度重复活动必须保持稳定的活动 ID（同一活动每年
 * 复用同一 ID，已拥有则不重复发放）。
 */
import { z } from "zod";

import { avatarIdSchema } from "./avatarIds.js";

/** 需要解锁才能使用的特典头像。经典头像不在此列。 */
export const SPECIAL_AVATAR_IDS = ["daoxuan-special", "descent-special", "halloween-special"] as const;

export type SpecialAvatarId = (typeof SPECIAL_AVATAR_IDS)[number];

export const specialAvatarIdSchema = z.enum(SPECIAL_AVATAR_IDS);

/** 解锁来源。`first_login` 同时承担“老用户首次在线请求补发”的含义。 */
export const AVATAR_REWARD_SOURCES = ["first_login", "anniversary", "make_up"] as const;

export type AvatarRewardSource = (typeof AVATAR_REWARD_SOURCES)[number];

export const avatarRewardSourceSchema = z.enum(AVATAR_REWARD_SOURCES);

/** 活动规则类别。 */
export const AVATAR_REWARD_RULE_KINDS = ["first_login", "yearly_nth_weekday", "yearly_fixed_date"] as const;

export type AvatarRewardRuleKind = (typeof AVATAR_REWARD_RULE_KINDS)[number];

export type AvatarRewardRule =
  | { readonly kind: "first_login" }
  /**
   * 每年重复的纪念日：`month` 月第 `nth` 个星期 `weekday`（1=周一 … 7=周日）。
   * 按账户时区的当地日期判定，而不是按 UTC 日期。
   */
  | { readonly kind: "yearly_nth_weekday"; readonly month: number; readonly weekday: number; readonly nth: number }
  | { readonly kind: "yearly_fixed_date"; readonly month: number; readonly day: number };

/** 一个奖励活动的全部配置。 */
export interface AvatarRewardActivity {
  readonly id: string;
  readonly avatarId: SpecialAvatarId;
  readonly rule: AvatarRewardRule;
  /** 是否允许“一次性补领”把它补发。 */
  readonly allowMakeUp: boolean;
  /** 活动是否已结束；结束后不再发放（已发的不可撤销）。 */
  readonly ended: boolean;
}

/**
 * 特典活动（年度活动使用稳定 ID，跨年不重复发放）。
 *
 * 「降临」：首次登录（以及老用户第一次在线请求）自动获得。
 * 「倒悬」：每年 11 月第三个星期四（世界哲学日）按账户当地日期发放。
 * 「万圣」：每年 10 月 31 日按账户当地日期登录领取，不开放补领。
 */
export const AVATAR_REWARD_ACTIVITIES: readonly AvatarRewardActivity[] = [
  {
    id: "descent-first-login",
    avatarId: "descent-special",
    rule: { kind: "first_login" },
    allowMakeUp: false,
    ended: false,
  },
  {
    id: "daoxuan-philosophy-day",
    avatarId: "daoxuan-special",
    rule: { kind: "yearly_nth_weekday", month: 11, weekday: 4, nth: 3 },
    allowMakeUp: true,
    ended: false,
  },
  {
    id: "halloween-login",
    avatarId: "halloween-special",
    rule: { kind: "yearly_fixed_date", month: 10, day: 31 },
    allowMakeUp: false,
    ended: false,
  },
];

export function isSpecialAvatarId(value: string): value is SpecialAvatarId {
  return (SPECIAL_AVATAR_IDS as readonly string[]).includes(value);
}

export function avatarRewardActivityForAvatar(avatarId: string): AvatarRewardActivity | undefined {
  return AVATAR_REWARD_ACTIVITIES.find(activity => activity.avatarId === avatarId);
}

export function avatarRewardActivityById(activityId: string): AvatarRewardActivity | undefined {
  return AVATAR_REWARD_ACTIVITIES.find(activity => activity.id === activityId);
}

/** 允许“一次性补领”的活动。 */
export function avatarRewardMakeUpActivities(): readonly AvatarRewardActivity[] {
  return AVATAR_REWARD_ACTIVITIES.filter(activity => activity.allowMakeUp && !activity.ended);
}

// ---------------------------------------------------------------------------
// 接口契约
// ---------------------------------------------------------------------------

/** 一条“已获得但尚未被界面确认展示”的奖励事件。 */
export const avatarRewardEventSchema = z.object({
  id: z.string(),
  avatarId: specialAvatarIdSchema,
  activityId: z.string(),
  occurredAt: z.string(),
});

export type AvatarRewardEvent = z.infer<typeof avatarRewardEventSchema>;

export const avatarRewardUnlockSchema = z.object({
  avatarId: specialAvatarIdSchema,
  activityId: z.string(),
  source: avatarRewardSourceSchema,
  unlockedAt: z.string(),
});

export type AvatarRewardUnlock = z.infer<typeof avatarRewardUnlockSchema>;

/** 下发给前端的活动摘要（不下发服务端内部判定细节）。 */
export const avatarRewardActivitySchema = z.object({
  id: z.string(),
  avatarId: specialAvatarIdSchema,
  kind: z.enum(AVATAR_REWARD_RULE_KINDS),
  allowMakeUp: z.boolean(),
  ended: z.boolean(),
});

export type AvatarRewardActivitySummary = z.infer<typeof avatarRewardActivitySchema>;

export const avatarRewardsResponseSchema = z.object({
  activities: z.array(avatarRewardActivitySchema),
  unlocked: z.array(avatarRewardUnlockSchema),
  /** 是否还能使用那唯一一次补领（与服务端判定一致）。 */
  makeUpAvailable: z.boolean(),
  /** 重复下发也未确认的奖励事件（前端按 id 去重）。 */
  pendingEvents: z.array(avatarRewardEventSchema),
  /** 当前用于纪念日判定的账户时区；`confirmed` 为 false 表示尚未从设备获得过时区。 */
  timeZone: z.object({ zone: z.string(), confirmed: z.boolean() }),
});

export type AvatarRewardsResponse = z.infer<typeof avatarRewardsResponseSchema>;

export const avatarRewardMakeUpRequestSchema = z.object({ avatarId: specialAvatarIdSchema });

export type AvatarRewardMakeUpRequest = z.infer<typeof avatarRewardMakeUpRequestSchema>;

export const avatarRewardMakeUpResponseSchema = z.object({
  unlocked: avatarRewardUnlockSchema,
  pendingEvents: z.array(avatarRewardEventSchema),
});

export type AvatarRewardMakeUpResponse = z.infer<typeof avatarRewardMakeUpResponseSchema>;

export const avatarRewardEventConfirmParamsSchema = z.object({ eventId: z.string().min(1).max(64) });

/** 头像是否属于“经典、默认可选”的集合（不需要解锁）。 */
export function isClassicAvatarId(value: string): boolean {
  return avatarIdSchema.safeParse(value).success && !isSpecialAvatarId(value);
}
