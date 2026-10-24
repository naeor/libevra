import {
  groupDuplicatePairs,
  normalizeNotDuplicatePair,
  type CreateNotDuplicateRelationsInput,
  type DuplicatePairResult,
} from "@libellum/shared";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Trans } from "react-i18next";
import { Link, useParams } from "react-router";

import { Alert } from "../components/Alert.js";
import { useDuplicateDetectionSettings } from "../components/DuplicateDetectionSettings.js";
import { Button } from "../components/Button.js";
import { InnerPage } from "../components/Layouts.js";
import { useI18n } from "../i18n/index.js";
import { errorMessage } from "../lib/api.js";
import { ReviewScanController } from "../lib/reviewScanController.js";
import {
  describeDuplicateMatchText,
  fetchReviewChunk,
  joinDuplicateList,
  releaseReviewCursor,
} from "../lib/duplicateReview.js";
import { formatMoney } from "../lib/format.js";
import { isGuestRuntime } from "../lib/guest/runtime.js";
import { createNotDuplicateRelations } from "../lib/notDuplicateRelations.js";

/**
 * 全账本重复检查（S15-E5）。
 *
 * 这个页面只做四件事：**分块扫描、显示真实进度、按组展示依据、把用户的决定记下来**。
 *
 * ⚠️ **它不会删除、合并或修改任何账目。** 疑似重复不是结论；用户在这一页能做的只有
 * 「不是同一笔」（写关系记忆，下次不再提示）和「保留」（什么都不写）。真要删除，
 * 走明细页的现有软删除：撤销、权限和同步都在那里，这里再实现一套就是第二个口径。
 *
 * ⚠️ **进度必须是真的。** 每次分块返回的 `processed` / `total` 都来自服务器实际处理的行数，
 * 不跑假动画；中途可以取消，取消后已经扫到的组仍然可以处理（它们是真的）。
 */
export function DuplicateReviewPage(): React.JSX.Element {
  const { bookId = "" } = useParams();
  const { t } = useI18n();
  const duplicateSettings = useDuplicateDetectionSettings();
  const settings = duplicateSettings.settings;

  const settingsKey = JSON.stringify(settings);
  const controller = useMemo(() => new ReviewScanController(
    (after, through, cursor) => fetchReviewChunk(bookId, JSON.parse(settingsKey) as typeof settings, after, through, cursor),
    releaseReviewCursor,
  ), [bookId, settingsKey]);
  const activeController = useRef(controller);
  activeController.current = controller;
  const { phase, processed, total, pairs, entries, scope, truncated, failure } = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => () => controller.dispose(), [controller]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyPairKey, setBusyPairKey] = useState<string | null>(null);

  /** 已经处理过的配对（确认不是同一笔 / 该组已保留）。 */
  const [resolved, setResolved] = useState<ReadonlySet<string>>(new Set());
  const [dismissedGroups, setDismissedGroups] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => { setResolved(new Set()); setDismissedGroups(new Set()); setActionError(null); setBusyPairKey(null); }, [controller]);
  const byId = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);
  const scan = (resume: boolean) => {
    if (!settings.enabled) return;
    if (!resume) { setResolved(new Set()); setDismissedGroups(new Set()); setActionError(null); }
    void controller.scan(resume);
  };

  /** 分组只用于排版；组内每一对的依据都必须摊开显示。 */
  const groups = useMemo(
    () => groupDuplicatePairs(pairs.filter((pair) => !resolved.has(pair.pairKey))),
    [pairs, resolved],
  );
  const visibleGroups = groups.filter((group) => !dismissedGroups.has(group.key));

  const markNotDuplicate = useCallback(async (pair: DuplicatePairResult) => {
    const normalized = normalizeNotDuplicatePair(pair.leftId, pair.rightId);
    if (!normalized.ok) {
      setActionError(t("duplicates.review.cannotRelate"));
      return;
    }
    const input: CreateNotDuplicateRelationsInput = {
      pairs: [{ transactionIdA: normalized.pair.transactionAId, transactionIdB: normalized.pair.transactionBId }],
      decisionSource: "review_group",
    };
    setBusyPairKey(pair.pairKey);
    setActionError(null);
    try {
      await createNotDuplicateRelations(bookId, input);
      if (activeController.current === controller) setResolved((current) => new Set(current).add(pair.pairKey));
    } catch (caught) {
      if (activeController.current === controller) setActionError(t("duplicates.review.relateFailed", { reason: errorMessage(caught) }));
    } finally {
      if (activeController.current === controller) setBusyPairKey(null);
    }
  }, [bookId, controller, t]);

  const relationsUnavailable = isGuestRuntime();

  /** 当前开启的比较项：与重复提醒设置一致，拼成一句里的清单。 */
  const ruleFields = joinDuplicateList([
    t("duplicates.review.ruleField.amount"),
    t("duplicates.review.ruleField.currency"),
    t("duplicates.review.ruleField.kind"),
    t("duplicates.review.ruleField.timeWindow"),
    ...(settings.matchCategory ? [t("duplicates.review.ruleField.category")] : []),
    ...(settings.matchPaymentMethod ? [t("duplicates.review.ruleField.paymentMethod")] : []),
  ]);
  const percent = total === null || total === 0 ? null : Math.min(100, Math.round((processed / total) * 100));

  return (
    <InnerPage
      title={t("duplicates.review.title")}
      subtitle={t("duplicates.review.subtitle")}
      backTo={`/books/${bookId}/settings`}
    >
      {failure === null ? null : <Alert tone="error">{failure}</Alert>}
      {actionError === null ? null : <Alert tone="error">{actionError}</Alert>}

      <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
        <p className="text-body-relaxed text-muted">
          {t("duplicates.review.rules", { fields: ruleFields })}
        </p>
        {settings.enabled ? null : (
          <Alert tone="info">{t("duplicates.review.disabled")}</Alert>
        )}

        {phase === "paused" || phase === "error" ? (
          <p className="text-helper text-muted">
            {total === null
              ? t("duplicates.review.paused", { processed })
              : t("duplicates.review.pausedWithTotal", { processed, total })}
          </p>
        ) : null}
        {phase === "running" ? (
          <div className="flex flex-col gap-2">
            <p className="text-body">
              <Trans
                i18nKey={
                  total === null
                    ? "duplicates.review.running"
                    : percent === null
                      ? "duplicates.review.runningWithTotal"
                      : "duplicates.review.runningWithPercent"
                }
                values={{ processed, total, percent }}
                components={{ b: <strong /> }}
              />
            </p>
            <div
              aria-hidden="true"
              className="h-2 w-full overflow-hidden rounded-full bg-brand-soft"
            >
              <div
                className="h-full rounded-full bg-brand transition-all"
                style={{ width: percent === null ? "0%" : `${String(percent)}%` }}
              />
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                controller.cancel();
              }}
            >
              {t("duplicates.review.cancel")}
            </Button>
          </div>
        ) : (
          // S16：英文按钮更长（如“Retry from where it stopped”），窄屏允许换行。
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => void scan(phase === "error" || phase === "paused")}
              disabled={!settings.enabled}
            >
              {phase === "idle"
                ? t("duplicates.review.start")
                : phase === "error"
                  ? t("duplicates.review.retry")
                  : phase === "paused"
                    ? t("duplicates.review.resume")
                    : t("duplicates.review.restart")}
            </Button>
            {phase === "paused" || phase === "error" ? <Button variant="secondary" disabled={!settings.enabled} onClick={() => scan(false)}>{t("duplicates.review.restart")}</Button> : null}
          </div>
        )}
      </section>

      {phase !== "idle" ? (
        <section className="flex flex-col gap-3">
          <h2 className="px-1 text-helper text-muted">
            {visibleGroups.length === 0
              ? t("duplicates.review.heading")
              : t("duplicates.review.headingCount", { count: visibleGroups.length })}
          </h2>

          {scope === "local" ? (
            <Alert tone="info">
              {t("duplicates.review.localOnly")}
            </Alert>
          ) : null}
          {truncated ? (
            <Alert tone="info">{t("duplicates.review.truncated")}</Alert>
          ) : null}

          {visibleGroups.length === 0 ? (
            <p className="rounded-card border border-line bg-surface p-5 text-body-relaxed text-muted">
              {phase !== "done" ? t("duplicates.review.noneSoFar") : t("duplicates.review.none")}
            </p>
          ) : null}

          {visibleGroups.map((group) => (
            <article key={group.key} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
              {/* S16：标题与“都保留”在英文下都更长，允许换行；标题可收缩。 */}
              <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 className="min-w-0 text-body font-medium">{t("duplicates.review.groupSize", { count: group.ids.length })}</h3>
                <button
                  type="button"
                  className="text-helper text-muted underline"
                  onClick={() => setDismissedGroups((current) => new Set(current).add(group.key))}
                >
                  {t("duplicates.review.keepGroup")}
                </button>
              </header>

              <ul className="flex flex-col gap-2">
                {group.ids.map((id) => {
                  const entry = byId.get(id);
                  if (entry === undefined) return null;
                  return (
                    <li key={id}>
                      <Link
                        to={`/transactions/${id}`}
                        className="flex items-baseline justify-between gap-3 rounded-field bg-canvas px-3 py-2 text-body"
                      >
                        <span className="min-w-0 truncate">{entry.note?.trim() === "" || entry.note === null ? t("duplicates.review.noNote") : entry.note}</span>
                        <span className="shrink-0 text-muted">
                          {entry.occurredLocalDate} · {formatMoney(entry.amountCents, entry.currency)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>

              <ul className="flex flex-col gap-2 border-t border-line pt-3">
                {group.pairs.map((pair) => (
                  <li key={pair.pairKey} className="flex flex-col gap-1">
                    <p className="text-helper text-muted">{describeDuplicateMatchText(pair)}</p>
                    <button
                      type="button"
                      disabled={relationsUnavailable || busyPairKey === pair.pairKey}
                      onClick={() => void markNotDuplicate(pair)}
                      className="self-start text-helper text-brand-dark underline disabled:opacity-45"
                    >
                      {busyPairKey === pair.pairKey ? t("duplicates.review.recording") : t("duplicates.review.notDuplicate")}
                    </button>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>
      ) : null}

      {relationsUnavailable ? (
        <Alert tone="info">{t("duplicates.review.guest")}</Alert>
      ) : null}
    </InnerPage>
  );
}
