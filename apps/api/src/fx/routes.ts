import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { fxDate, type FxLookup } from "../../../../packages/shared/src/fx.js";
import type { FxHistoryService } from "../../../../packages/shared/src/fxHistory.js";

/** 公开汇率接口每个 IP 每分钟的上限；比登录路由（600 次）严得多，见 registerFxRoutes 注释。 */
export const FX_PUBLIC_RATE_LIMIT = { max: 60, timeWindow: "1 minute" } as const;
/** 公开汇率接口接受的最早日期：欧洲央行参考汇率自 1999 年起，更早的一定没有数据。 */
export const FX_PUBLIC_MIN_DATE = "1999-01-01";
/** 允许的未来天数（跨时区的“今天”最多比 UTC 早一天，再留一天余量）。 */
export const FX_PUBLIC_MAX_FUTURE_DAYS = 2;

/** 两条路由共用的参数校验：只接受恰好一个字符串参数 date，且是真实存在的 YYYY-MM-DD。 */
export function parseFxDateQuery(query: unknown): string | null {
  const q = (query ?? {}) as Record<string, unknown>;
  if (Object.keys(q).some(key => key !== "date") || typeof q["date"] !== "string" || !fxDate(q["date"])) return null;
  return q["date"];
}

/** 公开路由是否值得向上游/数据库查：日期落在 [1999-01-01, 今天+2天] 之外必定没有汇率。 */
function fxPublicDateInRange(date: string, nowMs: number): boolean {
  return date >= FX_PUBLIC_MIN_DATE && date <= new Date(nowMs + FX_PUBLIC_MAX_FUTURE_DAYS * 86400000).toISOString().slice(0, 10);
}

/**
 * 只提供公共汇率，不接受金额/账号/账本，不读取任何财务表。
 *
 * 两条路由，同一个服务（`FxHistoryService.lookup`）、同一套参数校验、同一种返回：
 * - `GET /api/v1/fx/rates`：需要登录并同意协议，登录用户使用（行为不变）。
 * - `GET /api/v1/fx/public-rates`：不需要登录，给游客模式使用。
 *
 * ## 为什么要有公开版
 * 游客不登录、数据只在本机；网站 CSP 为 `connect-src 'self'`，浏览器只能连自己的服务器，
 * 所以游客想看到和登录用户一样的汇率，只能由我们的服务器代取。所有者 2026-11-15 决定开放。
 *
 * ## 为什么可以不需要登录
 * 它回答的是“某一天的公共参考汇率是多少”——对所有人相同，不属于任何账号或账本，
 * 请求里只有日期，不读、不写用户数据，也不记录是谁在问。
 * 登录路由经过协议同意门禁（属于账号业务）；公开路由不属于账号业务，所以不在门禁内。
 *
 * ## 能返回什么 / 不能返回什么
 * - 能：与登录路由完全相同的 `FxLookup`（该日汇率快照，或“没有汇率”的原因）。
 * - 不能：任何账号、账本、金额、交易信息；多余参数一律 400；超出 [1999-01-01, 今天+2天] 的日期
 *   不去查缓存/上游，直接答“没有汇率”。
 *
 * ## 防滥用
 * - 按 IP 每分钟 60 次（登录路由 600 次）：游客一次分析最多按“不同日期”逐日查，缓存后命中本机，
 *   正常使用远低于此；超出得到 429，前端把它当作“暂时取不到”，已缓存的日期照常折算。
 * - 单次只能查一个日期、没有币种参数（返回整张快照），因此“单次范围/币种数”天然是最小值。
 * - 服务端结果落库缓存，同一天只会向上游取一次，攻击者换日期也只能触发有限的、全站共享的取数。
 */
export async function registerFxRoutes(app: FastifyInstance, options: {
  requireAuth: (request: FastifyRequest) => Promise<void>;
  service: FxHistoryService;
  /** 测试用：覆盖“现在”，只影响公开路由的日期窗口。 */
  now?: () => number;
}): Promise<void> {
  const now = options.now ?? Date.now;
  // 一个受支持时段可含十四个月；冷缓存按日查询也应能完成一次分析。
  app.get("/api/v1/fx/rates", { preHandler: options.requireAuth, config: { rateLimit: { max: 600, timeWindow: "1 minute" } } }, async (request, reply) => {
    const date = parseFxDateQuery(request.query);
    if (date === null) return reply.code(400).send({ error: "invalid_fx_date" });
    return options.service.lookup(date);
  });
  // 公开版：没有 preHandler（不要求登录）。不要在这里读 cookie / 用户 / 账本。
  app.get("/api/v1/fx/public-rates", { config: { rateLimit: FX_PUBLIC_RATE_LIMIT } }, async (request: FastifyRequest, reply: FastifyReply): Promise<FxLookup | FastifyReply> => {
    const date = parseFxDateQuery(request.query);
    if (date === null) return reply.code(400).send({ error: "invalid_fx_date" });
    if (!fxPublicDateInRange(date, now())) return { status: "unavailable", reason: "missing_rate" };
    return options.service.lookup(date);
  });
}
