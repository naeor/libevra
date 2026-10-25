/**
 * 特典头像奖励接口（S16）。
 *
 * 三个路由都挂在**账号级**认证上，不带账本头：头像属于账户，不属于某一本账。
 *
 * ⚠️ **判定和发放都在服务端。** 客户端只说“我在哪个时区”，从不提交“我解锁了”；
 * 前端把锁标出来只是体验，直接调接口也拿不到未解锁的头像。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  avatarRewardEventConfirmParamsSchema,
  avatarRewardMakeUpRequestSchema,
  avatarRewardMakeUpResponseSchema,
  avatarRewardsResponseSchema,
} from "@libellum/shared";

import type { PrismaClient } from "../db.js";
import {
  confirmAvatarRewardEvent,
  getAvatarRewardState,
  readTimeZoneHeader,
  resolveAccountTimeZone,
  runAvatarRewardCheck,
  useAvatarRewardMakeUp,
} from "../rewards/service.js";

export interface AvatarRewardRouteOptions {
  readonly prisma: PrismaClient;
  readonly requireAuth: (request: FastifyRequest) => Promise<void>;
}

export function registerAvatarRewardRoutes(app: FastifyInstance, options: AvatarRewardRouteOptions): void {
  const { prisma, requireAuth } = options;

  const timeZoneHeader = (request: FastifyRequest): string | undefined =>
    readTimeZoneHeader(request.headers);

  // ---------------------------------------------------------------------------
  // GET /api/v1/avatar-rewards — 头像页/通知组件需要的完整状态
  // ---------------------------------------------------------------------------
  app.get("/api/v1/avatar-rewards", { preHandler: requireAuth }, async (request) => {
    const userId = request.currentUser!.id;
    const now = new Date();

    /**
     * ⚠️ **读取路径顺带补发。** 老用户首次在线、纪念日当天第一次打开头像页，都要
     * 在这里拿到奖励；发放失败不能把页面变成 500 —— 最多这一次没看到，下一次请求
     * 还会重试（库里没有重复记录，重试是幂等的）。
     */
    await runAvatarRewardCheck(prisma, { userId, headerZone: timeZoneHeader(request), now }).catch(
      () => undefined,
    );

    const timeZone = await resolveAccountTimeZone(prisma, {
      userId,
      headerZone: timeZoneHeader(request),
      now,
    });
    const state = await getAvatarRewardState(prisma, { userId, timeZone, now });
    return avatarRewardsResponseSchema.parse(state);
  });

  // ---------------------------------------------------------------------------
  // POST /api/v1/avatar-rewards/:avatarId/make-up — 用掉唯一一次补领
  // ---------------------------------------------------------------------------
  app.post("/api/v1/avatar-rewards/:avatarId/make-up", { preHandler: requireAuth }, async (request) => {
    const { avatarId } = avatarRewardMakeUpRequestSchema.parse(request.params);
    const userId = request.currentUser!.id;
    const now = new Date();
    const timeZone = await resolveAccountTimeZone(prisma, {
      userId,
      headerZone: timeZoneHeader(request),
      now,
    });
    const result = await useAvatarRewardMakeUp(prisma, {
      userId,
      avatarId,
      timeZone: timeZone.zone,
      now,
    });
    return avatarRewardMakeUpResponseSchema.parse(result);
  });

  // ---------------------------------------------------------------------------
  // POST /api/v1/avatar-rewards/:eventId/confirm — 界面确认“看到了这条奖励”
  // ---------------------------------------------------------------------------
  app.post("/api/v1/avatar-rewards/:eventId/confirm", { preHandler: requireAuth }, async (request, reply) => {
    const { eventId } = avatarRewardEventConfirmParamsSchema.parse(request.params);
    await confirmAvatarRewardEvent(prisma, {
      userId: request.currentUser!.id,
      eventId,
      now: new Date(),
    });
    return reply.status(204).send();
  });
}
