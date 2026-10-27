import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { CopyButton } from "../components/CopyButton.js";
import { InnerPage } from "../components/Layouts.js";
import { Button } from "../components/Button.js";
import { useI18n } from "../i18n/index.js";
import { formatBytes } from "../lib/offline/persistence.js";
import { useAccountOffline } from "../lib/offline/connectivity.js";
import { formatAppVersion } from "../lib/version.js";
import {
  formatRuntimeReport,
  networkLabel,
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
  const { t } = useI18n();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setSnapshot(await readRuntimeSnapshot(queryClient, offline, reason));
    } catch {
      /** 存的是“出错了”这一事实对应的文案；切换语言后下次读取会按新语言重写。 */
      setError(t("update.runtime.loadFailed"));
    } finally {
      setLoading(false);
    }
    // `t` 是 i18next 的绑定函数，引用稳定，放进依赖不会多触发读取。
  }, [offline, queryClient, reason, t]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * S16：两列的最小宽度改为 0，长值（构建标记这类没有断点的字符串）可以折行。原来的 `auto 1fr`
   * 在 320px 宽时，"Service Worker" 这类标签的最短宽度 + 一整串构建标记已经超出卡片（中文也是）；
   * 英文标签更长，问题更明显。值列仍然右对齐。
   */
  const grid = "grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-body";

  return (
    <InnerPage
      title={t("update.runtime.title")}
      subtitle={t("update.runtime.subtitle")}
      backTo="/update"
    >
      {loading ? <p className="text-body text-muted">{t("update.runtime.loading")}</p> : null}
      {error === null ? null : <p role="alert" className="rounded-field bg-danger-soft px-4 py-3 text-body text-danger">{error}</p>}

      {snapshot === null ? null : (
        <>
          <section className="flex flex-col gap-3 rounded-card border border-line bg-surface px-4 py-3.5">
            <h2 className="text-sm font-semibold text-ink">{t("update.runtime.app")}</h2>
            <dl className={grid}>
              <dt className="text-muted">{t("update.runtime.appVersion")}</dt>
              <dd className="text-right font-mono text-ink">{formatAppVersion(snapshot.version)}</dd>
              <dt className="text-muted">{t("update.runtime.buildLocal")}</dt>
              <dd className="text-right text-ink [overflow-wrap:anywhere]">{snapshot.buildStampLocal}</dd>
              <dt className="text-muted">{t("update.runtime.buildStamp")}</dt>
              <dd className="text-right font-mono text-helper text-ink [overflow-wrap:anywhere]">{snapshot.buildStamp}</dd>
              <dt className="text-muted">Service Worker</dt>
              <dd className="text-right text-ink">{snapshot.serviceWorker}</dd>
              <dt className="text-muted">{t("update.runtime.network")}</dt>
              <dd className="text-right text-ink">{networkLabel(snapshot)}</dd>
            </dl>
          </section>

          <section className="flex flex-col gap-3 rounded-card border border-line bg-surface px-4 py-3.5">
            <h2 className="text-sm font-semibold text-ink">{t("update.runtime.cache")}</h2>
            <dl className={grid}>
              <dt className="text-muted">{t("update.runtime.cacheEntries")}</dt>
              <dd className="text-right text-ink">{t("update.runtime.entryCount", { count: snapshot.queryCount })}</dd>
              <dt className="text-muted">{t("update.runtime.liveEntries")}</dt>
              <dd className="text-right text-ink">{t("update.runtime.entryCount", { count: snapshot.liveQueryCount })}</dd>
              <dt className="text-muted">{t("update.runtime.cacheSize")}</dt>
              <dd className="text-right text-ink">{formatBytes(snapshot.cacheBytes)}</dd>
              <dt className="text-muted">{t("update.runtime.logs")}</dt>
              <dd className="text-right text-ink">{t("update.runtime.entryCount", { count: snapshot.logCount })}</dd>
            </dl>
          </section>

          <section className="flex flex-col gap-3 rounded-card border border-line bg-surface px-4 py-3.5">
            <h2 className="text-sm font-semibold text-ink">{t("update.runtime.page")}</h2>
            <dl className={grid}>
              <dt className="text-muted">{t("update.runtime.pageUrl")}</dt>
              <dd className="break-all text-right text-helper text-ink">{snapshot.page}</dd>
              <dt className="text-muted">{t("update.runtime.capturedAt")}</dt>
              <dd className="text-right text-helper text-ink [overflow-wrap:anywhere]">{snapshot.capturedAt}</dd>
            </dl>
            <Button variant="secondary" onClick={() => void load()} disabled={loading}>
              {t("update.runtime.reload")}
            </Button>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-ink">{t("update.runtime.diagnostics")}</h2>
            <CopyButton
              text={formatRuntimeReport(snapshot)}
              label={t("update.runtime.copy")}
              copiedLabel={t("update.runtime.copied")}
              rows={10}
              hint={t("update.runtime.copyHint")}
            />
          </section>
        </>
      )}
    </InnerPage>
  );
}
