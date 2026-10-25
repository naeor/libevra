/**
 * **特典头像奖励的服务端判定（S16）。**
 *
 * 职责：把“用户现在能不能拿某个特典头像”变成数据库里的事实，并留下一条
 * 待通知事件。所有判定都以**服务端时间**与**账户时区**为基准，客户端提交的
 * 内容只用于“我在哪个时区”，不参与“我是否满足条件”。
 *
 * 三条硬约束（见设计决定文档）：
 *  1. **发奖先于通知。** 先把 `avatar_unlocks` 写进去，再写 `avatar_reward_events`；
 *     通知没送达最多是没看到，不会丢奖励。
 *  2. **同一头像只发一次。** `@@unique([userId, avatarId])` + `skipDuplicates` /
 *     唯一冲突兜底；多设备同时触发也只会有一个赢家。
 *  3. **失败不牵连主流程。** 调用方（`/auth/me`、`/avatar-rewards`）必须把这里
 *     的异常吞掉并记日志；头像奖励坏了不能把人挡在登录/记账之外。
 */
import { randomUUID } from "node:crypto";

import {
  AVATAR_REWARD_ACTIVITIES,
  avatarRewardMakeUpActivities,
  isSpecialAvatarId,
  type AvatarRewardActivity,
  type AvatarRewardActivitySummary,
  type AvatarRewardEvent,
  type AvatarRewardMakeUpResponse,
  type AvatarRewardRuleKind,
  type AvatarRewardSource,
  type AvatarRewardUnlock,
  type AvatarRewardsResponse,
} from "@libellum/shared";

import type { PrismaClient } from "../db.js";
import type { Prisma } from "../generated/prisma/client.js";
import { conflict } from "../lib/errors.js";
import {
  FALLBACK_TIME_ZONE,
  instantToLocalDate,
  isYearlyRuleDate,
  latestPastYearlyRuleDate,
  normalizeTimeZone,
  type YearlyNthWeekdayRule,
} from "./timeZone.js";

type Tx = Prisma.TransactionClient;

/** 客户端上报设备时区用的请求头。 */
export const TIME_ZONE_HEADER = "x-libellum-time-zone";

/**
 * 同一账户在多长时间内只接受一次“时区变化”。
 *
 * 防的不是隐私，而是**靠反复改时区反复触发或躲避纪念日判定**：6 小时足够覆盖
 * 一次真实旅行/设备切换，又不会让人在同一天里用改时区拿到两次判定。
 * 已经发出去的奖励永不因时区变化而撤回。
 */
const TIME_ZONE_CHANGE_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export interface AccountTimeZoneState {
  /** 当前用于纪念日判定的账户时区。 */
  readonly zone: string;
  /** 是否已经从设备获得过时区；false 表示在用回退值。 */
  readonly confirmed: boolean;
}

export interface RewardCheckResult {
  readonly timeZone: AccountTimeZoneState;
  readonly events: readonly AvatarRewardEvent[];
}

/** 从 Fastify 请求头里取出时区。头缺失或格式不对都只返回 undefined。 */
export function readTimeZoneHeader(
  headers: Readonly<Record<string, string | string[] | undefined>>,
): string | undefined {
  const raw = headers[TIME_ZONE_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function toActivitySummary(activity: AvatarRewardActivity): AvatarRewardActivitySummary {
  const kind: AvatarRewardRuleKind = activity.rule.kind;
  return {
    id: activity.id,
    avatarId: activity.avatarId,
    kind,
    allowMakeUp: activity.allowMakeUp,
    ended: activity.ended,
  };
}

function toEventDto(row: {
  id: string;
  avatarId: string;
  activityId: string;
  occurredAt: Date;
}): AvatarRewardEvent | null {
  if (!isSpecialAvatarId(row.avatarId)) return null;
  return {
    id: row.id,
    avatarId: row.avatarId,
    activityId: row.activityId,
    occurredAt: row.occurredAt.toISOString(),
  };
}

function toUnlockDto(row: {
  avatarId: string;
  activityId: string;
  source: string;
  unlockedAt: Date;
}): AvatarRewardUnlock | null {
  if (!isSpecialAvatarId(row.avatarId)) return null;
  const source: AvatarRewardSource = row.source === "anniversary" || row.source === "make_up" ? row.source : "first_login";
  return {
    avatarId: row.avatarId,
    activityId: row.activityId,
    source,
    unlockedAt: row.unlockedAt.toISOString(),
  };
}

/**
 * 在事务内发放一个活动对应的头像。
 *
 * ⚠️ **返回 null 表示“这个头像已经有解锁记录了”**，不是错误：并发请求里输掉的
 * 那个会拿到 null，然后继续返回已有的 pending 事件（或什么都不返回）。
 */
async function grantActivity(
  tx: Tx,
  input: {
    readonly userId: string;
    readonly activity: AvatarRewardActivity;
    readonly source: AvatarRewardSource;
    readonly now: Date;
  },
): Promise<AvatarRewardEvent | null> {
  const { userId, activity, source, now } = input;
  const unlockId = randomUUID();
  const created = await tx.avatarUnlock.createMany({
    data: [
      {
        id: unlockId,
        userId,
        avatarId: activity.avatarId,
        activityId: activity.id,
        source,
        unlockedAt: now,
      },
    ],
    skipDuplicates: true,
  });
  if (created.count === 0) return null;
  const event = await tx.avatarRewardEvent.create({
    data: {
      id: randomUUID(),
      userId,
      avatarId: activity.avatarId,
      activityId: activity.id,
      unlockId,
      status: "pending",
      occurredAt: now,
    },
  });
  return toEventDto(event);
}

async function findPendingEvents(prisma: PrismaClient, userId: string): Promise<AvatarRewardEvent[]> {
  const rows = await prisma.avatarRewardEvent.findMany({
    where: { userId, status: "pending" },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    select: { id: true, avatarId: true, activityId: true, occurredAt: true },
  });
  return rows.map(toEventDto).filter((event): event is AvatarRewardEvent => event !== null);
}

/**
 * 判断并发放当前时刻满足条件的活动。
 *
 * 只遍历“尚未拥有”的活动；已拥有的直接跳过，所以重复调用只多两条查询，
 * 不会重复写库。年度活动只在**账户当地日期正好是规则日**时发放；服务端会在
 * 每次 `/auth/me`（App 每 60 秒 / 重新聚焦前台时调用）以及打开头像页时被触发。
 */
export async function evaluateAvatarRewards(
  prisma: PrismaClient,
  input: { readonly userId: string; readonly timeZone: string; readonly now: Date },
): Promise<AvatarRewardEvent[]> {
  const { userId, timeZone, now } = input;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
  if (!user) return [];
  const owned = await prisma.avatarUnlock.findMany({ where: { userId }, select: { avatarId: true } });
  const ownedIds = new Set(owned.map(row => row.avatarId));

  for (const activity of AVATAR_REWARD_ACTIVITIES) {
    if (activity.ended || ownedIds.has(activity.avatarId)) continue;
    if (activity.rule.kind === "first_login") {
      await prisma.$transaction(tx => grantActivity(tx, { userId, activity, source: "first_login", now }));
      continue;
    }
    const yearlyRule: YearlyNthWeekdayRule = activity.rule;
    if (isYearlyRuleDate(now, timeZone, yearlyRule)) {
      await prisma.$transaction(tx => grantActivity(tx, { userId, activity, source: "anniversary", now }));
    }
  }

  return findPendingEvents(prisma, userId);
}

/**
 * 解析/更新账户时区。
 *
 * 规则：
 *  - 请求头是合法 IANA 时区且账户还没有时区 → 立即写入（首次登录/老用户首次在线请求）；
 *  - 与已保存时区相同 → 直接使用；
 *  - 不同 → 只有距上次变更超过 6 小时才更新并记一条历史，否则沿用已保存时区。
 *    **已发放的奖励不会因为时区变化被收回**，判定只影响“从现在起”的纪念日。
 */
export async function resolveAccountTimeZone(
  prisma: PrismaClient,
  input: {
    readonly userId: string;
    readonly headerZone: string | undefined;
    readonly now: Date;
    readonly source?: "first_login" | "request";
  },
): Promise<AccountTimeZoneState> {
  const { userId, headerZone, now, source = "request" } = input;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timeZone: true, timeZoneUpdatedAt: true },
  });
  if (!user) return { zone: FALLBACK_TIME_ZONE, confirmed: false };

  const requested = normalizeTimeZone(headerZone);
  const stored = normalizeTimeZone(user.timeZone);
  if (requested === null) {
    return { zone: stored ?? FALLBACK_TIME_ZONE, confirmed: stored !== null };
  }
  if (stored === null) {
    await prisma.$transaction(async tx => {
      await tx.user.update({
        where: { id: userId },
        data: { timeZone: requested, timeZoneUpdatedAt: now },
      });
      await tx.userTimeZoneChange.create({
        data: { userId, fromZone: null, toZone: requested, source: "first_login" },
      });
    });
    return { zone: requested, confirmed: true };
  }
  if (stored === requested) return { zone: stored, confirmed: true };

  const lastChangedAt = user.timeZoneUpdatedAt?.getTime() ?? 0;
  if (now.getTime() - lastChangedAt < TIME_ZONE_CHANGE_COOLDOWN_MS) {
    return { zone: stored, confirmed: true };
  }
  await prisma.$transaction(async tx => {
    await tx.user.update({
      where: { id: userId },
      data: { timeZone: requested, timeZoneUpdatedAt: now },
    });
    await tx.userTimeZoneChange.create({
      data: { userId, fromZone: stored, toZone: requested, source },
    });
  });
  return { zone: requested, confirmed: true };
}

/**
 * 一次完整的“按需检查”：解析时区 → 发放满足条件的奖励 → 返回待通知事件。
 *
 * 调用方必须包 try/catch：这里抛出任何异常都不应让 `/auth/me` 失败。
 */
export async function runAvatarRewardCheck(
  prisma: PrismaClient,
  input: { readonly userId: string; readonly headerZone: string | undefined; readonly now: Date },
): Promise<RewardCheckResult> {
  const timeZone = await resolveAccountTimeZone(prisma, {
    userId: input.userId,
    headerZone: input.headerZone,
    now: input.now,
  });
  const events = await evaluateAvatarRewards(prisma, {
    userId: input.userId,
    timeZone: timeZone.zone,
    now: input.now,
  });
  return { timeZone, events };
}

/**
 * 头像选择页/资料保存前的归属校验。
 *
 * 经典头像永远可选；特典头像必须有解锁记录，否则 409。**这是服务端判定**：
 * 前端把锁定头像的保存按钮禁掉只是体验，不能防住直接调接口。
 */
export async function assertAvatarSelectable(
  prisma: PrismaClient,
  input: { readonly userId: string; readonly avatarId: string },
): Promise<void> {
  if (!isSpecialAvatarId(input.avatarId)) return;
  const unlock = await prisma.avatarUnlock.findUnique({
    where: { userId_avatarId: { userId: input.userId, avatarId: input.avatarId } },
    select: { id: true },
  });
  if (unlock === null) {
    throw conflict("avatar_locked", "这个头像还没有解锁，请先在头像页查看解锁条件。");
  }
}

async function listUnlocks(prisma: PrismaClient, userId: string): Promise<AvatarRewardUnlock[]> {
  const rows = await prisma.avatarUnlock.findMany({
    where: { userId },
    orderBy: { unlockedAt: "asc" },
    select: { avatarId: true, activityId: true, source: true, unlockedAt: true },
  });
  return rows.map(toUnlockDto).filter((unlock): unlock is AvatarRewardUnlock => unlock !== null);
}

/** 组装头像页/通知组件需要的完整状态。 */
export async function getAvatarRewardState(
  prisma: PrismaClient,
  input: { readonly userId: string; readonly timeZone: AccountTimeZoneState; readonly now: Date },
): Promise<AvatarRewardsResponse> {
  const { userId, timeZone, now } = input;
  const [unlocks, makeUpGrant, user, pendingEvents] = await Promise.all([
    listUnlocks(prisma, userId),
    prisma.avatarMakeUpGrant.findUnique({ where: { userId }, select: { userId: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } }),
    findPendingEvents(prisma, userId),
  ]);
  const ownedIds = new Set(unlocks.map(unlock => unlock.avatarId));
  const creationDate = user ? instantToLocalDate(user.createdAt, timeZone.zone) : null;
  const makeUpAvailable =
    makeUpGrant === null &&
    creationDate !== null &&
    avatarRewardMakeUpActivities().some(activity => {
      if (ownedIds.has(activity.avatarId)) return false;
      if (activity.rule.kind !== "yearly_nth_weekday") return false;
      return latestPastYearlyRuleDate(now, timeZone.zone, activity.rule, creationDate) !== null;
    });
  return {
    activities: AVATAR_REWARD_ACTIVITIES.map(toActivitySummary),
    unlocked: unlocks,
    makeUpAvailable,
    pendingEvents,
    timeZone,
  };
}

/**
 * 使用那唯一一次补领。
 *
 * 只对“允许补领且未结束”的年度活动有效；服务端重新计算最近一次已经过去、
 * 且账户当时已经存在的纪念日。补领失败（并发/不满足条件）**不消耗**名额：
 * 名额记录和发放写在同一个事务里，事务回滚名额也不会被记下。
 */
export async function useAvatarRewardMakeUp(
  prisma: PrismaClient,
  input: { readonly userId: string; readonly avatarId: string; readonly timeZone: string; readonly now: Date },
): Promise<AvatarRewardMakeUpResponse> {
  const { userId, avatarId, timeZone, now } = input;
  const activity = AVATAR_REWARD_ACTIVITIES.find(candidate => candidate.avatarId === avatarId);
  if (activity === undefined || !activity.allowMakeUp) {
    throw conflict("make_up_unavailable", "这个头像不支持补领。");
  }
  if (activity.ended) throw conflict("make_up_unavailable", "这个活动已经结束。");
  if (activity.rule.kind !== "yearly_nth_weekday") {
    throw conflict("make_up_unavailable", "这个头像没有可补领的历史条件。");
  }
  const yearlyRule: YearlyNthWeekdayRule = activity.rule;

  const [owned, existingGrant, user] = await Promise.all([
    prisma.avatarUnlock.findUnique({
      where: { userId_avatarId: { userId, avatarId } },
      select: { id: true },
    }),
    prisma.avatarMakeUpGrant.findUnique({ where: { userId }, select: { userId: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } }),
  ]);
  // ⚠️ 名额检查必须排在“已拥有”之前：补领成功后同一个头像已在名下，
  // 再点一次应回答“名额已用完”，而不是“你已经拥有”——否则界面会以为还能补。
  if (existingGrant !== null) throw conflict("make_up_used", "那一次补领已经用过了。");
  if (owned !== null) throw conflict("avatar_already_owned", "你已经拥有这个头像了。");
  if (user === null) throw conflict("make_up_unavailable", "找不到账户资料，请重新登录后再试。");

  const creationDate = instantToLocalDate(user.createdAt, timeZone);
  const occurrence = latestPastYearlyRuleDate(now, timeZone, yearlyRule, creationDate);
  if (occurrence === null) throw conflict("make_up_unavailable", "没有可以补领的历史奖励。");

  let granted: { readonly unlock: AvatarRewardUnlock; readonly event: AvatarRewardEvent } | null = null;
  try {
    granted = await prisma.$transaction(async tx => {
      await tx.avatarMakeUpGrant.create({
        data: { userId, avatarId, activityId: activity.id, usedAt: now },
      });
      const unlockId = randomUUID();
      await tx.avatarUnlock.create({
        data: {
          id: unlockId,
          userId,
          avatarId,
          activityId: activity.id,
          source: "make_up",
          unlockedAt: now,
        },
      });
      const event = await tx.avatarRewardEvent.create({
        data: {
          id: randomUUID(),
          userId,
          avatarId,
          activityId: activity.id,
          unlockId,
          status: "pending",
          occurredAt: now,
        },
      });
      const unlockRow = await tx.avatarUnlock.findUniqueOrThrow({
        where: { id: unlockId },
        select: { avatarId: true, activityId: true, source: true, unlockedAt: true },
      });
      const unlockDto = toUnlockDto(unlockRow);
      const eventDto = toEventDto(event);
      if (unlockDto === null || eventDto === null) throw new Error("补领写入了非法的头像 ID");
      return { unlock: unlockDto, event: eventDto };
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw conflict("make_up_used", "那一次补领已经用过了。");
    }
    throw error;
  }
  if (granted === null) throw conflict("make_up_unavailable", "补领没有完成，请稍后重试。");
  return {
    unlocked: granted.unlock,
    pendingEvents: await findPendingEvents(prisma, userId),
  };
}

/** 界面确认“这条奖励已经展示给用户”。重复确认幂等。 */
export async function confirmAvatarRewardEvent(
  prisma: PrismaClient,
  input: { readonly userId: string; readonly eventId: string; readonly now: Date },
): Promise<void> {
  await prisma.avatarRewardEvent.updateMany({
    where: { id: input.eventId, userId: input.userId, status: "pending" },
    data: { status: "confirmed", confirmedAt: input.now },
  });
}

/** 账户是否已经拥有某个特典头像（资料保存校验用）。 */
export async function ownsAvatar(prisma: PrismaClient, userId: string, avatarId: string): Promise<boolean> {
  const unlock = await prisma.avatarUnlock.findUnique({
    where: { userId_avatarId: { userId, avatarId } },
    select: { id: true },
  });
  return unlock !== null;
}
