import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "../components/Button.js";
import { ChoiceDialog, type Choice } from "../components/ChoiceDialog.js";
import { InnerPage } from "../components/Layouts.js";
import { CopyButton } from "../components/CopyButton.js";
import { useI18n } from "../i18n/index.js";
import { formatInstant } from "../lib/datetime.js";
import {
  cacheFootprint,
  describeKey,
  forgetStaleEntries,
  type CacheFootprint,
} from "../lib/offline/downloadManager.js";
import { clearOfflineLog, readOfflineLog, type LogEntry } from "../lib/offline/diagnostics.js";
import { formatBytes, storageBreakdown, type StorageBreakdown } from "../lib/offline/persistence.js";
import { resetEverything } from "../lib/offline/reset.js";
import { databaseReport, type DatabaseReport } from "../lib/offline/dbstatus.js";
import { readStoredMonths } from "../lib/offline/localLedger.js";
import { readTrace, traceLine, readValue } from "../lib/offline/storage.js";

/**
 * The diagnostics screen, behind a "more" button.
 *
 * ⚠️ **The owner asked for it to move, and gave the reason with the request**: the download
 * log and the storage breakdown had been on the download manager's home screen, where they
 * are noise for anybody who is not chasing a problem. "把下载记录和存储明细……都不显示在下载
 * 管理主页。主页右上角新增一个更多按钮（三个点图标）."
 *
 * **And he asked for one thing more, which is the important part**: "还有一个按钮提供一键复制
 * 到剪贴板，底下写上小字提示用户如果碰到bug可以复制这些内容并提交给开发者."
 *
 * That turns the screen from something to *read* into something to *send*. Every round of
 * this offline work has been slowed down by the same gap — the person holding the phone
 * could see the problem and the developer could not — and a button that puts the whole state
 * on the clipboard is the shortest path between them.
 *
 * ⚠️ S16：页面与诊断文本的**标题、标签**随界面语言；**运行记录与存储追踪的每一行是写入时的原文**
 * （诊断数据，存在本机，给开发者看），不随语言改写。时间戳保持 ISO 8601，便于对照服务器日志。
 */
/**
 * How many storage-trace steps the full report keeps.
 *
 * ⚠️ **Twenty, because the trace is a sequence of *steps*, not a log** - what matters is the run-up to whatever
 * went wrong, and ninety lines of 
ead query-cache push that run-up off the top of a phone screen.
 */
const TRACE_LINES = 20;

export function DownloadMorePage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { t } = useI18n();

  const [log, setLog] = useState<readonly LogEntry[]>([]);
  const [footprint, setFootprint] = useState<CacheFootprint | null>(null);
  const [storage, setStorage] = useState<StorageBreakdown | null>(null);
  const [queries, setQueries] = useState<readonly string[]>([]);
  const [trace, setTrace] = useState<readonly string[]>([]);
  const [db, setDb] = useState<DatabaseReport | null>(null);
  const [storedMonths, setStoredMonths] = useState(0);
  const [storedEntries, setStoredEntries] = useState(0);
  const [confirmReset, setConfirmReset] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);

    /**
     * ⚠️ **Stale entries are cleared on sight rather than only on request.**
     *
     * The owner's report showed "共 82 条，其中 74 条当前版本会读" — eight entries under a key shape
     * this version no longer writes, left over from before the filter fields changed. They are
     * invisible, never read, and counted in the storage total. **A cleanup that only happens when
     * somebody presses a button is a cleanup that never happens.**
     *
     * Safe by construction: it only removes entries whose key shape cannot be read by this version,
     * and it writes nothing when it finds none — see `forgetStaleEntries`.
     */
    void forgetStaleEntries();

    try {
      const [entries, measured, breakdown, database] = await Promise.all([
        readOfflineLog(),
        cacheFootprint(queryClient),
        storageBreakdown(),
        databaseReport(),
      ]);

      setDb(database);
      /**
       * ⚠️ **The count that says whether the download actually stayed on the device.**
       *
       * The owner asked for his history to be stored locally so the app "可以直接拿这些本地的数据去计算
       * 去显示". This is the number that proves it did: months kept, and entries in them. **A number that
       * can be read at a glance beats one inferred from whether a screen happens to work.**
       */
      const months = await readStoredMonths();

      setStoredMonths(Object.keys(months).length);
      setStoredEntries(Object.values(months).reduce((total, entries) => total + entries.length, 0));

      setLog(entries);
      setFootprint(measured);
      setStorage(breakdown);

      /**
       * The stored keys, listed so the clipboard text can be read without this app.
       *
       * `describeKey` prints the **field count** as well as the values, because "four fields
       * or three" is exactly what distinguishes a leftover entry from a live one — and it
       * is invisible if only the values are shown.
       */
      const raw = await readValue<{ clientState?: { queries?: readonly { queryKey?: unknown }[] } }>(
        "query-cache",
      );

      setQueries((raw?.clientState?.queries ?? []).map((query) => describeKey(query.queryKey)));

      /**
       * ⚠️ **The storage layer's own trace, every line of it.**
       *
       * It records each open, read and write with the key and what came back — including *why*
       * a read failed, which is the one thing an empty ledger cannot tell you. The owner asked
       * for the diagnostics to be as rich as possible and said the length does not matter,
       * since he copies the whole thing anyway.
       */
      setTrace(readTrace().map((line) => traceLine(line)));
    } finally {
      setLoading(false);
    }
  }, [queryClient]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Everything a developer would need, as plain text. */
  const notRead = t("offline.report.notRead");
  const report = [
    t("offline.report.title"),
    /**
     * ⚠️ **The build first, and it is not decoration.**
     *
     * Three rounds were spent diagnosing code that had not reached the device. A report that
     * does not say which build produced it cannot be trusted to be about the current one — and
     * the giveaway was subtle: an identical timestamp to the previous report.
     */
    t("offline.report.build", { value: __BUILD_STAMP__ }),
    t("offline.report.time", { value: new Date().toISOString() }),
    t("offline.report.page", { value: window.location.href }),
    "",
    t("offline.report.storageHeading"),
    storage === null
      ? notRead
      : [
          t("offline.report.storageTotal", { size: formatBytes(storage.totalBytes) }),
          t("offline.report.storageLedger", { size: formatBytes(storage.queryCacheBytes) }),
          t("offline.report.storageShell", { size: formatBytes(storage.shellCacheBytes) }),
          t("offline.report.storageLog", { size: formatBytes(storage.diagnosticsBytes) }),
          t("offline.report.storageOther", { size: formatBytes(storage.otherBytes) }),
        ].join("\n"),
    "",
    t("offline.report.cacheHeading"),
    footprint === null
      ? notRead
      : t("offline.report.cacheCount", { count: footprint.queryCount, live: footprint.liveQueryCount }),
    ...(footprint?.heaviest ?? []).map(
      (entry) => `  ${entry.label} — ${formatBytes(entry.bytes)}`,
    ),
    "",
    /**
     * ⚠️ **Trimmed at the owner's request**: "请你稍微精简一下完成诊断，相对不那么重要的诊断可以不写出来."
     *
     * The trace ran to ninety lines of `read outbox` and `read query-cache` — **a hundred and fifty lines of a
     * report somebody reads on a phone, where the two or three lines that matter are indistinguishable from the
     * noise around them.** The last twenty steps show what just happened, which is the only thing this section
     * has ever been used for; the total is kept so it is clear that trimming happened.
     */
    t("offline.report.traceHeading", { shown: Math.min(trace.length, TRACE_LINES), total: trace.length }),
    ...trace.slice(-TRACE_LINES),
    "",
    /** ⚠️ **Omitted entirely when empty** — a heading and no content is one more thing to read past. */
    ...(queries.length === 0 ? [] : [t("offline.report.keysHeading", { count: queries.length }), ...queries, ""]),
    t("offline.report.logHeading", { shown: Math.min(log.length, 60), total: log.length }),
    // 每一行运行记录是写入时的原文（诊断数据），不翻译。
    ...log.slice(0, 60).map((entry) => `${new Date(entry.at).toISOString()} ${entry.what}${entry.detail === undefined ? "" : ` — ${entry.detail}`}`),
    "",
  ].join("\n");

  /**
   * The version somebody can paste into a chat window.
   *
   * ⚠️ **Deliberately short, and it keeps only what identifies the situation**: which build,
   * which page, what is stored, whether the database opened. The trace and the log are what makes
   * the full report long, and they are only needed once the short one has narrowed it down.
   */
  const shortReport = [
    t("offline.report.shortTitle"),
    t("offline.report.build", { value: __BUILD_STAMP__ }),
    t("offline.report.page", { value: window.location.href }),
    t("offline.report.network", {
      value: navigator.onLine ? t("offline.report.online") : t("offline.report.offline"),
    }),
    t("offline.report.cacheEntries", { count: footprint?.queryCount ?? 0, live: footprint?.liveQueryCount ?? 0 }),
    t("offline.report.cacheSize", { bytes: footprint?.cacheBytes ?? 0 }),
    t("offline.report.database", {
      value:
        db === null
          ? notRead
          : db.opened
            ? t("offline.report.databaseOpened", { count: db.keyCount, keys: db.keys.join(",") })
            : t("offline.report.databaseFailed", { error: db.error ?? t("offline.report.unknown") }),
    }),
    t("offline.report.stored", { months: storedMonths, entries: storedEntries }),
    t("offline.report.cacheContent", {
      value:
        db === null
          ? notRead
          : t("offline.report.cacheContentValue", {
              kind: db.cacheKind,
              bytes: db.cacheBytes,
              parse: db.cacheParses
                ? t("offline.report.cacheParses", { count: db.cacheQueryCount })
                : t("offline.report.cacheUnparsable"),
            }),
    }),
    t("offline.report.usage", {
      total: formatBytes(storage?.totalBytes ?? 0),
      ledger: formatBytes(storage?.queryCacheBytes ?? 0),
    }),
    t("offline.report.logCount", { count: log.length }),
  ].join("\n");

  return (
    <InnerPage
      title={t("offline.more.title")}
      subtitle={t("offline.more.subtitle")}
      backTo="/downloads"
      /*
        ⚠️ **The back control replaces rather than pushes.**
        
        The owner found a loop: signing out from this screen bounced between it and the download
        manager. Part of the cause is history that grows every time a screen is entered from a
        button rather than from the back stack — so entering here from the manager and pressing
        返回 should return to the manager, not add a third entry that has to be unwound.
      */
      onBack={() => void navigate("/downloads", { replace: true })}
    >
      <section className="flex flex-col gap-3">
        {/*
          ⚠️ **The shared button, because this one silently did nothing.**
          
          The owner asked for the same behaviour here as on the version screen, and reported that
          this one "还是没有生效" — the click handler had been written separately, its outcome was
          never read, the label never changed, and no fallback was ever offered. **A feature
          implemented twice is a feature that works in one of the two places**, and which one is
          decided by luck.
          
          ⚠️ **And the fallback is inside the button now, always rendered.** Two rounds were spent
          detecting when the clipboard would fail; the tablet then answered differently on two
          screens running identical code. **A fallback that has to predict a failure can be wrong;
          one that is always present cannot** — and text on screen can be screenshotted.
        */}
        <CopyButton
          text={shortReport}
          label={t("offline.more.copyShort")}
          rows={5}
          hint={t("offline.more.copyShortHint")}
        />

        {/*
          ⚠️ **Two lengths, because the owner found the limit the hard way**: "他复制这个剪贴版，
          但是因为太长了，所以没法在微信发出来；而我看到粘贴之后什么都没有，就以为他是没粘贴上."

          **A report that cannot be sent is a report that does not exist** — and the failure looked
          exactly like a broken clipboard, which is why it was diagnosed as one twice. The short
          version fits in a message; the full one is for when somebody asks for it.
        */}
        <CopyButton
          text={report}
          label={t("offline.more.copyFull")}
          rows={12}
          hint={t("offline.more.copyFullHint")}
        />

        <p className="text-helper-relaxed text-muted">{t("offline.more.serverSafe")}</p>
      </section>

      <section className="flex flex-col gap-2">
        <Button
          variant="danger-quiet"
          onClick={() => {
            setConfirmReset(true);
          }}
        >
          {t("offline.more.reset")}
        </Button>

        <p className="text-helper-relaxed text-muted">{t("offline.more.resetHint")}</p>
      </section>

      <ChoiceDialog
        open={confirmReset}
        title={t("offline.more.resetTitle")}
        description={t("offline.more.resetDescription")}
        choices={resetChoices(t)}
        onChoose={(choice) => {
          setConfirmReset(false);
          if (choice !== "reset") return;

          void resetEverything().finally(() => {
            window.location.reload();
          });
        }}
      />

      {storage === null ? null : (
        <section className="flex flex-col gap-1.5 rounded-card border border-line bg-surface px-4 py-3 text-sm">
          <h2 className="text-helper text-muted">{t("offline.more.storageTitle")}</h2>
          <p className="text-ink">{t("offline.more.storageTotal", { size: formatBytes(storage.totalBytes) })}</p>
          <ul className="flex flex-col gap-0.5 text-micro text-muted">
            <li>{t("offline.more.storageLedger", { size: formatBytes(storage.queryCacheBytes) })}</li>
            <li>{t("offline.more.storageShell", { size: formatBytes(storage.shellCacheBytes) })}</li>
            <li>{t("offline.more.storageLog", { size: formatBytes(storage.diagnosticsBytes) })}</li>
            <li>{t("offline.more.storageOther", { size: formatBytes(storage.otherBytes) })}</li>
          </ul>
          {/*
            ⚠️ **The honest note about the remainder.**

            "浏览器其它" is the biggest number on the screen and it is **not ours to clear**:
            `storage.estimate()` counts the whole origin, including data Chrome may hold
            before writing it to disk. Saying what it is stops the ledger taking the blame,
            and stops a "free up space" button being expected where none can exist.
          */}
          <p className="text-micro leading-relaxed text-muted">{t("offline.more.storageOtherNote")}</p>
        </section>
      )}

      {footprint === null ? null : (
        <section className="flex flex-col gap-1.5 rounded-card border border-line bg-surface px-4 py-3 text-sm">
          <h2 className="text-helper text-muted">{t("offline.more.cacheTitle")}</h2>
          <p className="text-ink">
            {t("offline.more.cacheCount", { count: footprint.queryCount, live: footprint.liveQueryCount })}
          </p>
          <ul className="flex flex-col gap-0.5 text-micro text-muted">
            {footprint.heaviest.map((entry) => (
              <li key={entry.label} className="flex justify-between gap-3">
                <span className="min-w-0 truncate font-mono">{entry.label}</span>
                <span className="shrink-0">{formatBytes(entry.bytes)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="min-w-0 text-helper text-muted">{t("offline.more.logTitle", { count: log.length })}</h2>
          <button
            type="button"
            onClick={() => {
              void clearOfflineLog().then(() => load());
            }}
            className="shrink-0 text-micro text-muted underline"
          >
            {t("offline.more.logClear")}
          </button>
        </div>

        {loading ? (
          <p className="text-body text-muted">{t("common.status.reading")}</p>
        ) : log.length === 0 ? (
          <p className="text-body text-muted">{t("offline.more.logEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-1 rounded-card border border-line bg-surface px-4 py-3">
            {log.map((entry, index) => (
              <li
                key={`${String(entry.at)}-${String(index)}`}
                className="text-micro leading-relaxed"
              >
                <span className="font-mono text-muted">{formatInstant(entry.at, { timeStyle: "medium" })}</span>{" "}
                <span className="text-ink">{entry.what}</span>
                {entry.detail === undefined ? null : (
                  <span className="text-muted"> — {entry.detail}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </InnerPage>
  );
}

/**
 * What to offer before wiping the device's copy.
 *
 * 清除并重新加载 names both halves of what happens, because the reload is not incidental —
 * the app cannot run with its own cache removed. 先不清理 is the dismissive option, since
 * closing the dialog is the same as doing nothing.
 */
function resetChoices(t: ReturnType<typeof useI18n>["t"]): readonly Choice<"reset" | "cancel">[] {
  // S16：渲染时生成，选项文字随当前语言；逻辑只看 `id`。
  return [
    { id: "reset", label: t("offline.more.resetConfirm"), hint: t("offline.more.resetConfirmHint"), primary: true },
    { id: "cancel", label: t("offline.more.resetCancel"), dismissive: true },
  ];
}
