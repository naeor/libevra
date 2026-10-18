import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { CopyButton } from "../components/CopyButton.js";
import { InnerPage } from "../components/Layouts.js";
import { Button } from "../components/Button.js";
import { formatBytes } from "../lib/offline/persistence.js";
import { useAccountOffline } from "../lib/offline/connectivity.js";
import {
  formatRuntimeReport,
  readRuntimeSnapshot,
  type RuntimeSnapshot,
} from "../lib/runtimeInfo.js";

/**
 * The technical screen behind the update page's 更多 menu.
 *
 * This is a deliberate move, not a deletion: every number that used to be on the update home is
 * still here, and the full report is still copyable as one block. The home page is for readers;
 * this page is for somebody sending a bug report.
 */
export function UpdateRuntimePage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const { offline, reason } = useAccountOffline();
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setSnapshot(await readRuntimeSnapshot(queryClient, offline, reason));
    } catch {
      setError("读取运行信息时出错了。");
    } finally {
      setLoading(false);
    }
  }, [offline, queryClient, reason]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <InnerPage
      title="运行信息"
      subtitle="用于排查问题，不影响正常使用。"
      backTo="/update"
    >
      {loading ? <p className="text-body text-muted">正在读取…</p> : null}
      {error === null ? null : <p role="alert" className="rounded-field bg-danger-soft px-4 py-3 text-body text-danger">{error}</p>}

      {snapshot === null ? null : (
        <>
          <CopyButton
            text={formatRuntimeReport(snapshot)}
            label="复制诊断信息"
            copiedLabel="已复制诊断信息"
            rows={10}
            hint="如果遇到问题，可以把这些内容复制给开发者。"
          />

          <section className="flex flex-col gap-3 rounded-card border border-line bg-surface px-4 py-3.5">
            <h2 className="text-sm font-semibold text-ink">应用与构建</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-body">
              <dt className="text-muted">应用版本</dt>
              <dd className="text-right font-mono text-ink">{snapshot.version}</dd>
              <dt className="text-muted">构建时间（本机）</dt>
              <dd className="text-right text-ink">{snapshot.buildStampLocal}</dd>
              <dt className="text-muted">构建标记（UTC）</dt>
              <dd className="text-right font-mono text-helper text-ink">{snapshot.buildStamp}</dd>
              <dt className="text-muted">Service Worker</dt>
              <dd className="text-right text-ink">{snapshot.serviceWorker}</dd>
              <dt className="text-muted">网络</dt>
              <dd className="text-right text-ink">
                {snapshot.online
                  ? "在线"
                  : `离线（${snapshot.offlineReason === "unreachable" ? "服务器没有答复" : "浏览器报告离线"}）`}
              </dd>
            </dl>
          </section>

          <section className="flex flex-col gap-3 rounded-card border border-line bg-surface px-4 py-3.5">
            <h2 className="text-sm font-semibold text-ink">本机缓存</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-body">
              <dt className="text-muted">缓存条目</dt>
              <dd className="text-right text-ink">{snapshot.queryCount} 条</dd>
              <dt className="text-muted">当前版本会读</dt>
              <dd className="text-right text-ink">{snapshot.liveQueryCount} 条</dd>
              <dt className="text-muted">缓存占用</dt>
              <dd className="text-right text-ink">{formatBytes(snapshot.cacheBytes)}</dd>
              <dt className="text-muted">运行记录</dt>
              <dd className="text-right text-ink">{snapshot.logCount} 条</dd>
            </dl>
          </section>

          <section className="flex flex-col gap-3 rounded-card border border-line bg-surface px-4 py-3.5">
            <h2 className="text-sm font-semibold text-ink">当前页面</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-body">
              <dt className="text-muted">页面</dt>
              <dd className="break-all text-right text-helper text-ink">{snapshot.page}</dd>
              <dt className="text-muted">记录时间</dt>
              <dd className="text-right text-helper text-ink">{snapshot.capturedAt}</dd>
            </dl>
            <Button variant="secondary" onClick={() => void load()} disabled={loading}>
              重新读取
            </Button>
          </section>
        </>
      )}
    </InnerPage>
  );
}
