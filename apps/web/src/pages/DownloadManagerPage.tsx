import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { Trans } from "react-i18next";
import { useNavigate } from "react-router";

import { Alert } from "../components/Alert.js";
import { Button } from "../components/Button.js";
import { ChoiceDialog, type Choice } from "../components/ChoiceDialog.js";
import { GearIcon, MoreIcon } from "../components/Icons.js";
import { InnerPage } from "../components/Layouts.js";
import { useI18n } from "../i18n/index.js";
import { logOffline } from "../lib/offline/diagnostics.js";
import {
  forgetAllMonths,
  monthLabel,
  monthRows,
  readNeverMonths,
  storedMonthsIn,
  type MonthRow,
} from "../lib/offline/downloadManager.js";
import { isMeteredConnection } from "../lib/offline/fill.js";
import { FILL_MONTH_ENTRY_LIMIT, forgetAllPartialMonths, readPartialMonths } from "../lib/offline/fillCoverage.js";
import { useOfflineFillStatus } from "../lib/offline/fillContext.js";
import { readLocalTransactions } from "../lib/offline/localLedger.js";
import { canStoreOffline, formatBytes, requestPersistentStorage } from "../lib/offline/persistence.js";

/**
 * The download manager: what is on this device, month by month.
 *
 * ⚠️ **The diagnostics moved out of here, at the owner's request**: "把下载记录和存储明细……
 * 都不显示在下载管理主页。主页右上角新增一个更多按钮（三个点图标），点击之后会进入'下载管理
 * -更多'页面." The log and the storage breakdown answer a question most people do not have, and
 * they were the largest thing on a screen whose subject is which months are available offline.
 *
 * **And the two explanatory paragraphs went too**: "我觉得大部分用户应该还是能看懂这俩按钮的."
 * He is right. 下载全部 above 删除全部已下载数据 does not need a sentence under each saying what it
 * does, and sentences nobody needs are sentences nobody reads — including the ones that matter.
 *
 * The list states facts and offers one way in: a gear per month. The decisions live on the
 * month's own screen, next to a description of what that month currently is, because the two
 * controls interact — deleting a month still set to download brings it straight back — and
 * that relationship is invisible when they are separate buttons on a list.
 */
export function DownloadManagerPage(): React.JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { fill } = useOfflineFillStatus();
  const { t } = useI18n();

  const [rows, setRows] = useState<readonly MonthRow[]>([]);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  /** 只有一种错误：读本机数据失败。存原因而不是句子，文字随当前语言显示。 */
  const [error, setError] = useState<"read" | null>(null);
  const [confirmCellular, setConfirmCellular] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);

    try {
      const [transactions, never, partials] = await Promise.all([
        readLocalTransactions(),
        readNeverMonths(),
        readPartialMonths(),
      ]);

      /**
       * ⚠️ **Asked of the live query client, not the stored blob.** The blob says what was
       * saved at some point; memory is what the app is using, and memory is what gets written
       * over the blob next. See `storedMonthsIn`.
       */
      const partial = new Map(
        Object.entries(partials).map(([month, record]) => [month, record.entries] as const),
      );

      setRows(monthRows(transactions, never, storedMonthsIn(queryClient), new Date(), undefined, partial));
    } catch {
      setError("read");
    } finally {
      setLoading(false);
    }
  }, [queryClient]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void requestPersistentStorage().then(setPersisted);
  }, []);

  // Reload when a fill finishes, so the list shows what it brought back.
  const fillDone = fill?.done ?? 0;
  const fillRunning = fill?.running ?? false;
  useEffect(() => {
    if (!fillRunning && fillDone > 0) void load();
  }, [fillRunning, fillDone, load]);

  const storedCount = rows.filter((row) => row.state === "stored" || row.state === "partial").length;
  const missingCount = rows.filter((row) => row.state === "missing").length;
  const partialCount = rows.filter((row) => row.state === "partial").length;

  /**
   * What a full download is likely to cost, from the months already here.
   *
   * Measured rather than guessed, and it is the number the confirmation needs: "this will use
   * about 180 KB" is a decision somebody can make, where "continue?" is a prompt with nothing
   * in it.
   */
  const estimatedBytes = rows
    .filter((row) => row.state === "missing")
    .reduce((total, row) => total + row.bytes, 0);

  return (
    <InnerPage
      title={t("offline.downloads.title")}
      subtitle={t("offline.downloads.subtitle")}
      backTo="/me"
      actions={
        <button
          type="button"
          onClick={() => void navigate("/downloads/more")}
          aria-label={t("common.action.more")}
          className="rounded-field p-2.5 text-muted transition hover:bg-brand-soft hover:text-ink"
        >
          <MoreIcon className="size-5" />
        </button>
      }
    >
      {error === null ? null : <Alert tone="error">{t("offline.downloads.readError")}</Alert>}

      {canStoreOffline() ? null : <Alert tone="info">{t("offline.downloads.unsupported")}</Alert>}

      {persisted === false ? <Alert tone="info">{t("offline.downloads.notPersisted")}</Alert> : null}

      {/*
        ⚠️ **几个月没取完，要在主页就说出来。**

        单月上限是本机读取能力的边界，不是"这个月没有数据"。如果不说，用户只会看到一个
        进度条走完、列表里却少了一个月的数字，然后把原因归给别处。句子给出上限数字，让
        「为什么停在这里」有答案。
      */}
      {partialCount === 0 ? null : (
        <Alert tone="info">
          {t("offline.downloads.partialNotice", { count: partialCount, limit: FILL_MONTH_ENTRY_LIMIT })}
        </Alert>
      )}

      <section className="flex flex-col gap-3 rounded-card border border-line bg-surface px-4 py-3 text-sm">
        <p className="text-ink">
          <Trans
            i18nKey={missingCount === 0 ? "offline.downloads.summaryAll" : "offline.downloads.summaryMissing"}
            count={storedCount}
            values={{ count: storedCount, missing: missingCount }}
            components={{ b: <span className="font-medium" /> }}
          />
        </p>

        {fillRunning ? (
          <p className="text-helper text-muted">
            {t("offline.downloads.running", { done: fill?.done ?? 0, total: fill?.total ?? 0 })}
          </p>
        ) : (
          <Button
            onClick={() => {
              /**
               * ⚠️ **On a metered connection, ask — do not decide.**
               *
               * The owner asked for this: "如果用户正在使用流量，改成弹出弹窗提醒用户当前疑似
               * 使用流量，问是否要继续下载，并给出预估消耗多少流量."
               *
               * The earlier behaviour was worse in both directions. The automatic fill refuses
               * silently, so at home on Wi-Fi the button did nothing and looked broken; a
               * download that simply proceeds on cellular spends somebody's data without
               * asking. **A question with a number in it is the only one of the three that is
               * both honest and useful.**
               *
               * It says 疑似 because `effectiveType` is the browser's estimate, and the button
               * is never blocked on the strength of an estimate.
               */
              if (isMeteredConnection()) {
                setConfirmCellular(true);
                return;
              }

              void fill?.start(undefined, true);
            }}
            disabled={fill === null}
          >
            {t("offline.downloads.downloadAll")}
          </Button>
        )}

        <Button
          variant="danger-quiet"
          disabled={fillRunning || storedCount === 0}
          onClick={() => {
            /**
             * ⚠️ **Through the query client, not by editing storage.** Clearing the stored
             * blob alone leaves the months in memory, and the persister writes memory back a
             * moment later — the bug that took two rounds to find, where a deletion looked
             * successful and undid itself.
             */
            const cleared = forgetAllMonths(queryClient);
            void logOffline("删除全部", `清除了 ${String(cleared)} 个月`); // i18n-ignore：诊断日志（存本机，给开发者看）
            void forgetAllPartialMonths().then(() => load());
          }}
        >
          {t("offline.downloads.deleteAll")}
        </Button>
      </section>

      <ChoiceDialog
        open={confirmCellular}
        title={t("offline.downloads.cellularTitle")}
        description={t("offline.downloads.cellularDescription", { size: formatBytes(estimatedBytes) })}
        choices={cellularChoices(t)}
        onChoose={(choice) => {
          setConfirmCellular(false);
          if (choice === "download") void fill?.start(undefined, true);
        }}
      />

      {loading ? (
        <p className="text-body text-muted">{t("common.status.reading")}</p>
      ) : (
        <ul className="flex flex-col overflow-hidden rounded-card border border-line bg-surface">
          {rows.map((row) => (
            <li key={row.month} className="border-b border-line last:border-b-0">
              <button
                type="button"
                onClick={() => void navigate(`/downloads/${row.month}`)}
                aria-label={t("offline.downloads.rowAria", { month: monthLabel(row.month) })}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                {/* 月份名在渲染时按当前语言生成（`row.label` 是读取那一刻的语言）。 */}
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-body text-ink">{monthLabel(row.month)}</span>
                  <span className="text-micro text-muted">
                    {row.state === "stored"
                      ? t("offline.downloads.rowStored", { count: row.entryCount, size: formatBytes(row.bytes) })
                      : row.state === "partial"
                        ? t("offline.downloads.rowPartial", { count: row.entryCount, limit: FILL_MONTH_ENTRY_LIMIT })
                        : row.state === "never"
                          ? t("offline.downloads.rowNever")
                          : t("offline.downloads.rowMissing", { size: formatBytes(row.bytes) })}
                  </span>
                </span>

                <GearIcon className="size-4 shrink-0 text-muted" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </InnerPage>
  );
}

/**
 * What to offer when the connection looks metered.
 *
 * 继续下载 rather than a bare 确定, because the choice is between two real things — data now or
 * data later — and the labels should name them. 等连上 Wi-Fi 再下载 is the dismissive option,
 * since doing nothing is what happens if the user closes the dialog.
 */
function cellularChoices(t: ReturnType<typeof useI18n>["t"]): readonly Choice<"download" | "wait">[] {
  // S16：渲染时生成，选项文字随当前语言；`id` 是稳定值，逻辑只看它。
  return [
    {
      id: "download",
      label: t("offline.downloads.cellularContinue"),
      hint: t("offline.downloads.cellularContinueHint"),
      primary: true,
    },
    { id: "wait", label: t("offline.downloads.cellularWait"), dismissive: true },
  ];
}
