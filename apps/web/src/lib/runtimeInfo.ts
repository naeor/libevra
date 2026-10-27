import type { QueryClient } from "@tanstack/react-query";

import { t } from "../i18n/index.js";
import { APP_VERSION, buildStamp, buildStampLocal, formatAppVersion } from "./version.js";
import { readOfflineLog } from "./offline/diagnostics.js";
import { cacheFootprint } from "./offline/downloadManager.js";

/**
 * The diagnostic snapshot behind "copy version information" and the runtime-information screen.
 *
 * ⚠️ **Kept out of the update home on purpose.** A normal reader needs the version and the latest
 * announcement, not a Service Worker count or a cache size. These values remain reachable through
 * "更多", and the report text is byte-for-byte the same one the old screen copied, so diagnosing a
 * device does not get worse just because the front page got quieter.
 *
 * ⚠️ **S16 国际化：报告的“标签”跟随界面语言，“值”不变。** 中文界面下报告与以前逐字相同；英文界面
 * 下 `构建时间（本机）：` 变成 `Build time (local): ` 之类。版本号、ISO 时间、地址、条数、字节数
 * 这些值不经过翻译，所以不管用户用哪种语言复制，开发者对照的数字都是同一份。快照里的字段名
 * （`RuntimeSnapshot`）与 `offlineReason` 的取值（`unreachable` 等）同样不变。文案在调用时取，
 * 不在模块顶层取。
 */
export interface RuntimeSnapshot {
  readonly version: string;
  readonly buildStamp: string;
  readonly buildStampLocal: string;
  readonly serviceWorker: string;
  readonly online: boolean;
  readonly offlineReason: string | null;
  readonly queryCount: number;
  readonly liveQueryCount: number;
  readonly cacheBytes: number;
  readonly logCount: number;
  readonly page: string;
  readonly capturedAt: string;
}

export async function readRuntimeSnapshot(
  queryClient: QueryClient,
  offline: boolean,
  offlineReason: string | null,
): Promise<RuntimeSnapshot> {
  const [footprint, log] = await Promise.all([
    cacheFootprint(queryClient),
    readOfflineLog(),
  ]);

  return {
    version: APP_VERSION,
    buildStamp: buildStamp(),
    buildStampLocal: buildStampLocal(),
    serviceWorker: await serviceWorkerState(),
    online: !offline,
    offlineReason,
    queryCount: footprint.queryCount,
    liveQueryCount: footprint.liveQueryCount,
    cacheBytes: footprint.cacheBytes,
    logCount: log.length,
    page: typeof window === "undefined" ? "" : window.location.href,
    capturedAt: new Date().toISOString(),
  };
}

async function serviceWorkerState(): Promise<string> {
  try {
    const registrations = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    const controlling = navigator.serviceWorker?.controller !== null;

    return registrations.length === 0
      ? t("update.state.swNone")
      : controlling
        ? t("update.state.swControlling", { count: registrations.length })
        : t("update.state.swNotControlling", { count: registrations.length });
  } catch {
    return t("update.state.swUnknown");
  }
}

/** `在线` / `离线（服务器没有答复）`：运行信息页与诊断报告共用同一种说法。 */
export function networkLabel(snapshot: Pick<RuntimeSnapshot, "online" | "offlineReason">): string {
  if (snapshot.online) return t("update.state.online");
  return t("update.state.offline", {
    reason: snapshot.offlineReason === "unreachable" ? t("update.state.unreachable") : t("update.state.browserOffline"),
  });
}

export function formatRuntimeReport(snapshot: RuntimeSnapshot): string {
  return [
    `Libevra ${formatAppVersion(snapshot.version)}`,
    t("update.report.buildLocal", { value: snapshot.buildStampLocal }),
    t("update.report.buildUtc", { value: snapshot.buildStamp }),
    t("update.report.serviceWorker", { value: snapshot.serviceWorker }),
    t("update.report.network", { value: networkLabel(snapshot) }),
    t("update.report.cacheEntries", { count: snapshot.queryCount, live: snapshot.liveQueryCount }),
    t("update.report.cacheBytes", { count: snapshot.cacheBytes }),
    t("update.report.logs", { count: snapshot.logCount }),
    t("update.report.page", { value: snapshot.page }),
    t("update.report.time", { value: snapshot.capturedAt }),
  ].join("\n");
}
