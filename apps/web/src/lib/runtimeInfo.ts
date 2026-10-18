import type { QueryClient } from "@tanstack/react-query";

import { APP_VERSION, buildStamp, buildStampLocal } from "./version.js";
import { readOfflineLog } from "./offline/diagnostics.js";
import { cacheFootprint } from "./offline/downloadManager.js";

/**
 * The diagnostic snapshot behind "copy version information" and the runtime-information screen.
 *
 * ⚠️ **Kept out of the update home on purpose.** A normal reader needs the version and the latest
 * announcement, not a Service Worker count or a cache size. These values remain reachable through
 * "更多", and the report text is byte-for-byte the same one the old screen copied, so diagnosing a
 * device does not get worse just because the front page got quieter.
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
      ? "没有注册（开发模式）"
      : `${String(registrations.length)} 个注册${controlling ? "，正在控制本页" : "，未控制本页"}`;
  } catch {
    return "无法读取";
  }
}

export function formatRuntimeReport(snapshot: RuntimeSnapshot): string {
  const network = snapshot.online
    ? "在线"
    : `离线（${snapshot.offlineReason === "unreachable" ? "服务器没有答复" : "浏览器报告离线"}）`;

  return [
    `Libevra ${snapshot.version}`,
    `构建时间（本机）：${snapshot.buildStampLocal}`,
    `构建时间（UTC）：${snapshot.buildStamp}`,
    `Service Worker：${snapshot.serviceWorker}`,
    `网络：${network}`,
    `缓存条目：${String(snapshot.queryCount)} 条，其中 ${String(snapshot.liveQueryCount)} 条当前版本会读`,
    `缓存大小：${String(snapshot.cacheBytes)} 字节`,
    `运行记录：${String(snapshot.logCount)} 条`,
    `页面：${snapshot.page}`,
    `时间：${snapshot.capturedAt}`,
  ].join("\n");
}
