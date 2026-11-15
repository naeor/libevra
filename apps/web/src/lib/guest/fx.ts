/**
 * **游客的汇率缓存与取数**（1.19.94，游客模式补齐）。
 *
 * 登录用户的汇率来自 `GET /api/v1/fx/rates`（需要登录），缓存在账号离线库（`lib/offline/fx.ts`，键 `fx-public-rates-v1`）。
 * 游客没有账号，也不能碰账号库，所以：
 * - 取数：所有者 2026-11-15 决定开放一个不需要登录、按 IP 限频的公开路由 `GET /api/v1/fx/public-rates`
 *   （见 `apps/api/src/fx/routes.ts`）。请求只有一个日期、只发给我们自己的服务器，返回与登录用户完全相同；
 * - 缓存：存在游客库 `libellum-guest` 的 `guest:<游客 id>:fx-rates`。合并、乱序保护、容量裁剪、
 *   回退天数（`FX_MAX_FALLBACK_DAYS`）与登录用户同一套代码（`OfflineFxRepository`），只是存储位置不同；
 * - 清理：`clearGuestData` / `clearAllDeviceData` 都会删除整个 `libellum-guest` 库，缓存随之清掉。
 *
 * ⚠️ 缓存里只有公共汇率（日期、币种、汇率、取到的时间），没有金额、交易、账本。
 * ⚠️ 离线（`offline: true`）时只用缓存，不发请求；没有缓存就是“缺汇率”，与登录用户一致。
 */
import { FxError, FxHistoryService, fxHistoryOptionsFromEnv, type FxLookup, type FxProvider, type FxRepository } from "@libellum/shared";

import { OfflineFxRepository, type FxRepositoryStore, type PublicRates } from "../offline/fx.js";
import { guestRuntimeId } from "./runtime.js";
import { guestKey, readGuestValue, writeGuestValue } from "./storage.js";

/** 游客库里放汇率缓存的键名（完整键是 `guest:<游客 id>:fx-rates`）。 */
export const GUEST_FX_KEY_NAME = "fx-rates";

/** 公开路由的路径（相对 `/api/v1`）。 */
export const GUEST_FX_PATH = "/fx/public-rates";

export function guestFxKey(guestId: string): string {
  return guestKey(guestId, GUEST_FX_KEY_NAME);
}

/** 游客汇率仓库：用“当前游客 id”定位键；没有游客身份时读不到、写不进（不会落到别的键上）。 */
export function createGuestFxRepository(currentGuestId: () => string | null = guestRuntimeId, capacity = 512): FxRepository {
  const key = (): string | null => {
    const id = currentGuestId();
    if (id === null) return null;
    try { return guestFxKey(id); } catch { return null; }
  };
  const store: FxRepositoryStore = {
    lockName: () => key() ?? "guest-fx-none",
    read: async () => { const k = key(); return k === null ? null : readGuestValue<PublicRates>(k); },
    write: async value => { const k = key(); return k === null ? false : writeGuestValue(k, value); },
  };
  return new OfflineFxRepository(capacity, store);
}

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * 游客的汇率来源：公开路由，返回格式与登录用户的 `/fx/rates` 相同。
 *
 * ⚠️ 这里**不用** `apiFetch`：它会带上设备标识、时区、账本头，而这个请求只该有“一个日期”。
 * 不带 cookie（`credentials: "omit"`）、不带设备头，只发给本站（相对路径，CSP `connect-src 'self'`）。
 * 任何失败（离线、超时、429 限频、非 JSON）都按“暂时取不到”处理，不影响已缓存日期的折算。
 */
export function createGuestFxProvider(fetcher: typeof fetch = (input, init) => fetch(input, init)): FxProvider {
  return {
    id: "ecb-via-frankfurter-v2",
    async fetch(date) {
      if (typeof navigator !== "undefined" && navigator.onLine === false) throw new FxError("network");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetcher(`/api/v1${GUEST_FX_PATH}?date=${encodeURIComponent(date)}`, {
          method: "GET", credentials: "omit", headers: { accept: "application/json" }, signal: controller.signal,
        });
        if (!response.ok) throw new FxError("network");
        const answer = await response.json() as FxLookup;
        if (answer.status !== "available") throw new FxError(answer.reason);
        return answer.snapshot;
      } catch (error) {
        throw error instanceof FxError ? error : new FxError("network");
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
export const guestFxProvider: FxProvider = createGuestFxProvider();

export function createGuestFxService(
  repository: FxRepository = createGuestFxRepository(),
  provider: FxProvider = guestFxProvider,
  options: ConstructorParameters<typeof FxHistoryService>[2] = fxHistoryOptionsFromEnv(import.meta.env ?? {}, "VITE_"),
): FxHistoryService {
  return new FxHistoryService(repository, provider, options);
}
