import {
  DUPLICATE_SCOPE_LABELS,
  describeDuplicateMatch,
  groupDuplicatePairs,
  normalizeNotDuplicatePair,
  type CreateNotDuplicateRelationsInput,
  type DuplicatePairResult,
  type Transaction,
} from "@libellum/shared";
import { useCallback, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";

import { Alert } from "../components/Alert.js";
import { useDuplicateDetectionSettings } from "../components/DuplicateDetectionSettings.js";
import { Button } from "../components/Button.js";
import { InnerPage } from "../components/Layouts.js";
import { errorMessage } from "../lib/api.js";
import { fetchReviewChunk } from "../lib/duplicateReview.js";
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
  const duplicateSettings = useDuplicateDetectionSettings();
  const settings = duplicateSettings.settings;

  type Phase = "idle" | "running" | "done" | "error";

  const [phase, setPhase] = useState<Phase>("idle");
  const [processed, setProcessed] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [pairs, setPairs] = useState<readonly DuplicatePairResult[]>([]);
  const [entries, setEntries] = useState<readonly Transaction[]>([]);
  const [scope, setScope] = useState<"server" | "local">("server");
  const [truncated, setTruncated] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyPairKey, setBusyPairKey] = useState<string | null>(null);

  /** 已经处理过的配对（确认不是同一笔 / 该组已保留）。 */
  const [resolved, setResolved] = useState<ReadonlySet<string>>(new Set());
  const [dismissedGroups, setDismissedGroups] = useState<ReadonlySet<string>>(new Set());

  const cancelled = useRef(false);
  /** 游标留在 ref 里：失败重试要从断点继续，而不是重扫一遍。 */
  const cursor = useRef(0);
  const through = useRef<number | undefined>(undefined);

  const byId = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);

  const scan = useCallback(async (resume: boolean) => {
    cancelled.current = false;
    setFailure(null);
    setActionError(null);
    setPhase("running");
    if (!resume) {
      cursor.current = 0;
      through.current = undefined;
      setProcessed(0);
      setTotal(null);
      setPairs([]);
      setEntries([]);
      setResolved(new Set());
      setDismissedGroups(new Set());
      setTruncated(false);
    }

    const collectedPairs = [...pairs];
    const collectedEntries = new Map(entries.map((entry) => [entry.id, entry]));
    let done = 0;

    try {
      for (;;) {
        const chunk = await fetchReviewChunk(bookId, settings, cursor.current, through.current);
        through.current = chunk.throughSeq;
        setScope(chunk.scope);
        setTotal(chunk.total);
        if (chunk.truncated) setTruncated(true);
        collectedPairs.push(...chunk.pairs);
        for (const entry of chunk.entries) collectedEntries.set(entry.id, entry);
        done += chunk.processed;
        cursor.current = chunk.nextSeq ?? chunk.throughSeq;
        setProcessed(done);
        setPairs([...collectedPairs]);
        setEntries([...collectedEntries.values()]);
        if (chunk.nextSeq === null || cancelled.current) break;
        // 让出事件循环，进度与取消按钮才有机会被画出来/被点到。
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      setPhase("done");
    } catch (caught) {
      setFailure(errorMessage(caught));
      setPhase("error");
    }
  }, [bookId, settings, pairs, entries]);

  /** 分组只用于排版；组内每一对的依据都必须摊开显示。 */
  const groups = useMemo(
    () => groupDuplicatePairs(pairs.filter((pair) => !resolved.has(pair.pairKey))),
    [pairs, resolved],
  );
  const visibleGroups = groups.filter((group) => !dismissedGroups.has(group.key));

  const markNotDuplicate = useCallback(async (pair: DuplicatePairResult) => {
    const normalized = normalizeNotDuplicatePair(pair.leftId, pair.rightId);
    if (!normalized.ok) {
      setActionError("这两笔无法建立「不是同一笔」关系。");
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
      setResolved((current) => new Set(current).add(pair.pairKey));
    } catch (caught) {
      setActionError(`「不是同一笔」没有记住：${errorMessage(caught)}`);
    } finally {
      setBusyPairKey(null);
    }
  }, [bookId]);

  const relationsUnavailable = isGuestRuntime();

  return (
    <InnerPage
      title="重复账目检测"
      subtitle="扫描这本账的历史记录，按组查看疑似重复。不会自动删除或合并任何账目。"
      backTo={`/books/${bookId}/settings`}
    >
      {failure === null ? null : <Alert tone="error">{failure}</Alert>}
      {actionError === null ? null : <Alert tone="error">{actionError}</Alert>}

      <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
        <p className="text-body-relaxed text-muted">
          判断规则与你当前的重复提醒设置一致：金额、币种、收支方向、时间窗口
          {settings.matchCategory ? "、分类" : ""}
          {settings.matchPaymentMethod ? "、支付方式" : ""}
          。疑似重复只是提示，删不删、留几笔都由你决定。
        </p>
        {settings.enabled ? null : (
          <Alert tone="info">重复提醒已关闭，所以本次不会给出结果。需要检查请先在设置里打开重复提醒。</Alert>
        )}

        {phase === "running" ? (
          <div className="flex flex-col gap-2">
            <p className="text-body">
              正在检查：已处理 <strong>{processed}</strong>
              {total === null ? "" : ` / ${String(total)}`} 笔
              {total === null || total === 0 ? "" : `（${String(Math.min(100, Math.round((processed / total) * 100)))}%）`}
            </p>
            <div
              aria-hidden="true"
              className="h-2 w-full overflow-hidden rounded-full bg-brand-soft"
            >
              <div
                className="h-full rounded-full bg-brand transition-all"
                style={{ width: total === null || total === 0 ? "10%" : `${String(Math.min(100, Math.round((processed / total) * 100)))}%` }}
              />
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                cancelled.current = true;
              }}
            >
              取消检查
            </Button>
          </div>
        ) : (
          <div className="flex gap-3">
            <Button
              onClick={() => void scan(phase === "error")}
              disabled={!settings.enabled}
            >
              {phase === "idle" ? "开始检查" : phase === "error" ? "从断点重试" : "重新检查"}
            </Button>
          </div>
        )}
      </section>

      {phase === "done" || phase === "running" ? (
        <section className="flex flex-col gap-3">
          <h2 className="px-1 text-helper text-muted">
            疑似重复{visibleGroups.length === 0 ? "" : `（${String(visibleGroups.length)} 组）`}
          </h2>

          {scope === "local" ? (
            <Alert tone="info">
              当前这次检查只覆盖了{DUPLICATE_SCOPE_LABELS.local}（离线或服务端暂时不可用），
              不能据此认为账本里没有重复。
            </Alert>
          ) : null}
          {truncated ? (
            <Alert tone="info">结果已达到单次上限，还有配对没有显示。处理完这些后再检查一次即可看到更多。</Alert>
          ) : null}

          {visibleGroups.length === 0 ? (
            <p className="rounded-card border border-line bg-surface p-5 text-body-relaxed text-muted">
              {phase === "running" ? "还没有发现符合当前规则的疑似重复。" : "没有发现符合当前规则的疑似重复。"}
            </p>
          ) : null}

          {visibleGroups.map((group) => (
            <article key={group.key} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
              <header className="flex items-baseline justify-between gap-3">
                <h3 className="text-body font-medium">这一组有 {group.ids.length} 笔</h3>
                <button
                  type="button"
                  className="text-helper text-muted underline"
                  onClick={() => setDismissedGroups((current) => new Set(current).add(group.key))}
                >
                  这一组都保留
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
                        <span className="truncate">{entry.note?.trim() === "" || entry.note === null ? "（无备注）" : entry.note}</span>
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
                    <p className="text-helper text-muted">{describeDuplicateMatch(pair)}</p>
                    <button
                      type="button"
                      disabled={relationsUnavailable || busyPairKey === pair.pairKey}
                      onClick={() => void markNotDuplicate(pair)}
                      className="self-start text-helper text-brand-dark underline disabled:opacity-45"
                    >
                      {busyPairKey === pair.pairKey ? "正在记录…" : "这两笔不是同一笔"}
                    </button>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>
      ) : null}

      {relationsUnavailable ? (
        <Alert tone="info">游客账本不记录「不是同一笔」：关系保存在服务器账本上。登录后可以逐组处理。</Alert>
      ) : null}
    </InnerPage>
  );
}
