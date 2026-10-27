import { useEffect, useState } from "react";

import { useI18n } from "../i18n/index.js";
import { FILL_MONTH_ENTRY_LIMIT, readPartialMonths } from "../lib/offline/fillCoverage.js";
import { useOfflineFillStatus } from "../lib/offline/fillContext.js";
import { useGuestMode } from "../lib/guest/session.js";
import { useAccountOffline } from "../lib/offline/connectivity.js";
import { lastLocalRead } from "../lib/offline/localLedger.js";

/**
 * The download notice, the offline notice, and — when everything else has failed to say anything —
 * a plain statement of what this device is showing.
 *
 * ⚠️ **Two corrections from the owner, and both were my mistakes.**
 *
 * **It used to appear again on every screen.** The ten seconds were owned by this component, so every
 * mount started a fresh countdown: open the ledger, see the notice; go to the analysis screen, see it
 * again; come back, see it again. He described it exactly — "会在每一次打开账户和分析页面时出现，
 * 十秒后消失".
 *
 * The window belongs to the **download**, not to whoever happens to be looking at it, so it is
 * computed from the moment the fill finished: "less than ten seconds ago" is true on every screen at
 * once and false on every screen at once.
 *
 * **And it was not on every screen.** He asked for it "在明细，分析，账户等所有页面都作为上方弹窗出现"
 * — which is what `TabPage` already gave it, except that the timer bug made it look like something
 * else.
 *
 * ⚠️ **And the third version answers a complaint that had no answer on screen at all.**
 *
 * He reported a screen flashing placeholders for over a minute with no explanation: "还是一直闪，
 * 什么字都没有……已经过去了差不多一分钟". Every explanation he was offered lived *inside* the screen that
 * was failing — so if that screen never reached the state that renders an explanation, he got nothing.
 *
 * **This strip is outside that chain.** It is rendered by every frame, including the ledger's own, and
 * it depends on nothing but two facts: the account is cut off, and it has been cut off for a while.
 * After four seconds it states the situation and what the device holds, using the same counts the
 * diagnostics page reports. **A message that cannot be reached is not a message.**
 */
const LINGER_MS = 10_000;

/** How long the account has to be cut off before the strip admits it. */
const OFFLINE_NOTICE_MS = 4_000;

export function OfflineStatus(): React.JSX.Element | null {
  const { t } = useI18n();
  const guest = useGuestMode();
  const { fill, ready } = useOfflineFillStatus();
  const { offline } = useAccountOffline();

  /**
   * A ticking clock, so the strip disappears on its own.
   *
   * One interval for the whole component rather than a timeout per render: the state it produces is
   * exactly "what time is it", and every screen derives the same answer from the same timestamp. When
   * the window closes, `now` moves past it and the strip stops rendering — no cleanup to get wrong,
   * and nothing to reset.
   */
  const [now, setNow] = useState(() => Date.now());

  const running = fill?.running ?? false;
  const justFinishedAt = fill?.justFinishedAt ?? null;

  /**
   * ⚠️ **When the account went offline**, tracked here rather than in the connectivity store: the
   * store's job is to answer "is it offline", and *how long for* is a question only the thing drawing
   * a countdown needs to ask.
   */
  const [offlineSince, setOfflineSince] = useState<number | null>(null);

  /**
   * 有多少个月因为单月读取上限而没有取完。
   *
   * ⚠️ **这个数字只对离线状态有意义，所以在这里读。** 联网时分析走服务器，不依赖本地
   * 副本；断网后统计只能看本地，缺一个月的账就会少算金额。提示条是"这条链路真的出了问题"
   * 的兜底发声处——分析页自己的 incomplete 提示可能来不及渲染，这里不会。
   */
  const [partialCount, setPartialCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void readPartialMonths()
      .then((months) => {
        if (!cancelled) setPartialCount(Object.keys(months).length);
      })
      .catch(() => {
        // 读不到状态本身不是要报给用户的事；下载管理页会显示读错误。
      });

    return () => {
      cancelled = true;
    };
  }, [offline, justFinishedAt]);

  useEffect(() => {
    if (!offline) {
      setOfflineSince(null);

      return;
    }

    setOfflineSince((previous) => previous ?? Date.now());
  }, [offline]);

  useEffect(() => {
    if (running || justFinishedAt === null) return;

    // Nothing to count down any more.
    if (Date.now() - justFinishedAt >= LINGER_MS) return;

    setNow(Date.now());

    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 500);

    return () => {
      window.clearInterval(timer);
    };
  }, [running, justFinishedAt]);

  /**
   * A tick while the account is offline, so the strip can appear on its own without any other state
   * changing. **Nothing else in the app is guaranteed to re-render while it is stuck** — which is
   * exactly the situation this strip exists to report.
   */
  useEffect(() => {
    if (!offline || offlineSince === null) return;
    if (now - offlineSince >= OFFLINE_NOTICE_MS) return;

    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 500);

    return () => {
      window.clearInterval(timer);
    };
  }, [offline, offlineSince, now]);

  if (!ready) return null;

  /**
   * ⚠️ **S14-C: the download/offline strip describes account sync state.** A guest has no
   * download queue and no server copy, so every sentence this strip could say would be about
   * something that does not exist. Rendered after all hooks so the component's hook order cannot
   * change between modes.
   */
  if (guest) return null;

  /**
   * ⚠️ **Derived, not stored.** A `lingering` boolean would be a second copy of the same fact, and it
   * would be the copy that goes stale — which is how the notice came to reappear on every screen in
   * the first place.
   */
  const lingering = !running && justFinishedAt !== null && now - justFinishedAt < LINGER_MS;
  const downloadVisible = running || lingering || (fill?.skippedMetered ?? false);

  const offlineLongEnough =
    offline && offlineSince !== null && now - offlineSince >= OFFLINE_NOTICE_MS && !downloadVisible;

  if (!downloadVisible && !offlineLongEnough) return null;

  const read = lastLocalRead();

  return (
    <div
      role="status"
      className="flex flex-col gap-0.5 border-b border-line bg-canvas px-5 py-2 text-micro leading-relaxed text-muted"
    >
      {running ? (
        <>
          <p>{t("offline.status.downloading", { done: fill?.done ?? 0, total: fill?.total ?? 0 })}</p>
          <p>{t("offline.status.manageHint")}</p>
        </>
      ) : null}

      {lingering && fill?.stopped === null ? (
        <>
          <p>{t("offline.status.finished", { count: fill?.total ?? 0 })}</p>
          <p>{t("offline.status.manageHint")}</p>
        </>
      ) : null}

      {/* 停止原因是稳定 id，文字在这里按当前语言选。 */}
      {lingering && fill?.stopped != null ? (
        <p>
          {fill.stopped === "partial" ? t("offline.status.stoppedPartial") : t("offline.status.stoppedInterrupted")}
        </p>
      ) : null}

      {!running && !lingering && (fill?.skippedMetered ?? false) ? <p>{t("offline.status.metered")}</p> : null}

      {/*
        ⚠️ **The fallback statement, and it is deliberately blunt.**

        It says three things and every one is checkable: the account is not connected, what is on
        screen comes from this device, and how many entries the device holds. When a screen is stuck
        and saying nothing, this is the only part of the interface guaranteed to speak.
      */}
      {offlineLongEnough ? (
        <>
          <p>{t("offline.status.unreachable")}</p>
          <p>
            {read.at === 0
              ? t("offline.status.localNotRead", { count: read.total })
              : t("offline.status.localCounts", {
                  count: read.total,
                  stored: read.storedEntries,
                  disk: read.diskEntries,
                  live: read.liveEntries,
                })}
          </p>
          {/* 少算金额的原因要说出来：不是"没有数据"，是"超过单月上限、没取完"。 */}
          {partialCount === 0 ? null : (
            <p>{t("offline.status.partialMonths", { count: partialCount, limit: FILL_MONTH_ENTRY_LIMIT })}</p>
          )}
        </>
      ) : null}
    </div>
  );
}
