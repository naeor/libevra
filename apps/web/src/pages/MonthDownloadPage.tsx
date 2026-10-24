import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { Alert } from "../components/Alert.js";
import { Button } from "../components/Button.js";
import { InnerPage } from "../components/Layouts.js";
import { useI18n } from "../i18n/index.js";
import { useOfflineFillStatus } from "../lib/offline/fillContext.js";
import {
  bytesForMonth,
  forgetMonth,
  monthLabel,
  readNeverMonths,
  setNeverMonth,
  storedMonthsIn,
} from "../lib/offline/downloadManager.js";
import { readLocalTransactions } from "../lib/offline/localLedger.js";
import { formatBytes, requestPersistentStorage, storageReport } from "../lib/offline/persistence.js";

/**
 * One month's download settings.
 *
 * The owner's design: "每个月份右面显示一个齿轮图标，点击齿轮图标后会跳转到月份下载管理
 * 界面，其中能看到对应月份的当前下载状态，占用空间等数据，并且可以管理（开关做成明细页的
 * 支出收入那种按钮好，左侧是文字标题「联网时自动下载」，右侧是两个按钮）."
 *
 * **Why a page rather than two inline buttons.** The list had "删除已下载" and
 * "永不下载" beside every row, and he was right that it was ugly — but the deeper
 * problem is that those two controls *interact*: deleting a month that is set to
 * download for ever means it comes straight back. Putting them on one screen, next
 * to a description of what the month currently is, is what lets the relationship be
 * visible instead of surprising.
 *
 * The toggle is the spending/income switch from the entry form, deliberately: the
 * same shape for the same idea — a setting with exactly two states, where one is
 * already chosen.
 */
export function MonthDownloadPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { month = "" } = useParams<{ month: string }>();
  const queryClient = useQueryClient();
  const { fill } = useOfflineFillStatus();
  const { t } = useI18n();

  const [stored, setStored] = useState(false);
  const [entryCount, setEntryCount] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [never, setNever] = useState(false);
  const [usage, setUsage] = useState<number | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  /** 只有一种错误：读本机数据失败。存原因而不是句子，文字随当前语言显示。 */
  const [error, setError] = useState<"read" | null>(null);

  const load = useCallback(async () => {
    if (month === "") return;

    setLoading(true);

    try {
      const [transactions, storedSet, neverList, report] = await Promise.all([
        readLocalTransactions(),
        Promise.resolve(storedMonthsIn(queryClient)),
        readNeverMonths(),
        storageReport(),
      ]);

      setStored(storedSet.has(month));
      setEntryCount(transactions.filter((entry) => entry.occurredLocalDate.slice(0, 7) === month).length);
      setBytes(bytesForMonth(transactions, month));
      setNever(neverList.includes(month));
      setUsage(report.usageBytes);
    } catch {
      setError("read");
    } finally {
      setLoading(false);
    }
  }, [month, queryClient]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void requestPersistentStorage().then(setPersisted);
  }, []);

  const label = monthLabel(month);
  const running = fill?.running ?? false;

  return (
    <InnerPage title={label} subtitle={t("offline.month.subtitle")} backTo="/downloads">
      {error === null ? null : <Alert tone="error">{t("offline.downloads.readError")}</Alert>}

      {/*
        ⚠️ **The "will not be kept" warning lives here now**, not on every screen.

        The owner asked for it to be moved: "把这个弹窗挪到下载管理界面以及下载管理的每个
        子界面." He is right, and for the reason the download notice was already cut
        back — a line that follows the user everywhere stops being read. This is a
        fact about *storage*, so it belongs on the screens about storage, which are
        the two the user opens on purpose.
      */}
      {persisted === false ? <Alert tone="info">{t("offline.downloads.notPersisted")}</Alert> : null}

      {/* 标签 + 值：标签 `min-w-0` 可换行，值不换行（英文标签更长）。 */}
      <section className="flex flex-col gap-3 rounded-card border border-line bg-surface px-4 py-4 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 text-muted">{t("offline.month.status")}</span>
          <span className="shrink-0 text-ink">
            {loading ? t("offline.month.loading") : stored ? t("offline.month.stored") : t("offline.month.missing")}
          </span>
        </div>

        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 text-muted">{t("offline.month.entries")}</span>
          <span className="shrink-0 text-ink">{loading ? "…" : t("common.count.entries", { count: entryCount })}</span>
        </div>

        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 text-muted">{t("offline.month.size")}</span>
          <span className="shrink-0 text-ink">
            {loading ? "…" : stored ? formatBytes(bytes) : t("offline.month.estimate", { size: formatBytes(bytes) })}
          </span>
        </div>

        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 text-muted">{t("offline.month.deviceTotal")}</span>
          <span className="shrink-0 text-ink">{usage === null ? "…" : formatBytes(usage)}</span>
        </div>
      </section>

      {/*
        The toggle, built like the spending/income switch: a label on the left, two
        buttons on the right, one of them already chosen.
      */}
      {/* `flex-wrap`：窄屏（尤其英文）放不下时，两个按钮换到标题下一行，而不是把标题挤成一列。 */}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3">
        <span className="min-w-0 text-body text-ink">{t("offline.month.autoTitle")}</span>

        <span className="flex shrink-0 gap-2">
          {([true, false] as const).map((auto) => (
            <button
              key={String(auto)}
              type="button"
              aria-pressed={!never === auto}
              disabled={loading}
              onClick={() => {
                setNever(!auto);
                void setNeverMonth(month, !auto).then(() => load());
              }}
              className={`rounded-field px-4 py-2 text-sm font-medium transition ${
                !never === auto ? "bg-brand text-on-brand" : "bg-canvas text-muted"
              }`}
            >
              {auto ? t("offline.month.auto") : t("offline.month.never")}
            </button>
          ))}
        </span>
      </section>

      <p className="text-helper-relaxed text-muted">
        {never ? t("offline.month.neverHint") : t("offline.month.autoHint")}
      </p>

      <section className="flex flex-col gap-2">
        {stored ? (
          <Button
            variant="danger"
            disabled={working || running}
            onClick={() => {
              setWorking(true);
              void Promise.resolve(forgetMonth(queryClient, month))
                .then(() => load())
                .finally(() => {
                  setWorking(false);
                });
            }}
          >
            {working ? t("offline.month.deleting") : t("offline.month.delete")}
          </Button>
        ) : (
          <Button
            disabled={working || running}
            onClick={() => {
              /**
               * ⚠️ **The metered check is skipped for a request the user made.**
               *
               * The automatic fill waits for Wi-Fi because it is a download nobody
               * asked for. This one *was* asked for, and silently doing nothing is
               * the worst answer — which is exactly how the "下载全部" button came
               * to look broken.
               */
              setWorking(true);
              void fill
                ?.start([month], true)
                .then(() => load())
                .finally(() => {
                  setWorking(false);
                });
            }}
          >
            {running ? t("offline.month.downloading") : t("offline.month.download")}
          </Button>
        )}

        <p className="text-helper-relaxed text-muted">
          {stored ? t("offline.month.deleteHint") : t("offline.month.downloadHint")}
        </p>
      </section>

      <button
        type="button"
        onClick={() => void navigate("/downloads")}
        className="text-helper text-muted underline"
      >
        {t("offline.month.back")}
      </button>
    </InnerPage>
  );
}
