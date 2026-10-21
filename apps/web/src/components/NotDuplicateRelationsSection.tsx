/**
 * S15-E3 · 账本设置里的「已忽略的重复交易」管理区。
 *
 * 为什么必须有这一块：不重复关系一旦记录，就会让这一对**不再出现在重复提示里**。
 * 用户误点一次之后如果无处查看、无法撤销，等于系统永久替他做了决定——规划 §5.5 明确要求
 * 提供查看与撤销能力。
 *
 * ⚠️ **viewer 只读**：按钮渲染但禁用，并写明原因（服务器的 `requireBookForWrite`
 * 也会拒绝，界面只是提前说明）。
 * ⚠️ **离线不能写**：关系是服务器权威状态，首版不进入离线队列；离线时只展示已加载的
 * 缓存，撤销按钮禁用并说明"联网后可撤销"。
 * ⚠️ **已撤销 / 失效的行仍可查看**（`含已撤销` 筛选），这样"我撤销过什么"是可回答的。
 */

import {
  NOT_DUPLICATE_DECISION_SOURCE_LABELS,
  formatTransactionNumber,
  type NotDuplicateRelation,
  type NotDuplicateRelationTransaction,
  type NotDuplicateDecisionSource,
} from "@libellum/shared";
import { useState } from "react";

import { Alert } from "./Alert.js";
import { Button } from "./Button.js";
import { useAccountOffline } from "../lib/offline/connectivity.js";
import { formatDateTimeInZone, localTimeZone } from "../lib/datetime.js";
import { formatMoney } from "../lib/format.js";
import { errorMessage } from "../lib/api.js";
import {
  useNotDuplicateRelations,
  useRevokeNotDuplicateRelation,
} from "../lib/notDuplicateRelations.js";

const STALE_FIELD_LABELS: Readonly<Record<string, string>> = {
  amountCents: "金额",
  currency: "币种",
  kind: "收支方向",
  occurredAt: "时间",
};

function transactionLine(entry: NotDuplicateRelationTransaction | null): string {
  if (entry === null) return "交易已不存在";

  return [
    `${formatTransactionNumber(entry.seq)}`,
    entry.occurredLocalDate,
    formatMoney(entry.amountCents, entry.currency, { withCode: true }),
    entry.kind === "income" ? "收入" : "支出",
    entry.categoryName ?? "暂无分类",
  ].join(" · ");
}

function statusText(relation: NotDuplicateRelation): string {
  if (relation.revokedAt !== null) {
    const who = relation.revokedByName ?? "未知成员";
    const when = formatDateTimeInZone(relation.revokedAt, localTimeZone());
    return `已撤销：${who} · ${when}`;
  }

  if (relation.stale) {
    const fields = relation.staleFields
      .map((field) => STALE_FIELD_LABELS[field] ?? field)
      .join("、");
    return fields === ""
      ? "判定依据已变化：这一对重新参与重复提示"
      : `判定依据已变化（${fields}）：这一对重新参与重复提示`;
  }

  if (relation.transactionA === null || relation.transactionB === null) {
    return "对端交易已不存在：这一对不再参与提示";
  }

  return "生效中：重复提示会忽略这一对";
}

/**
 * 纯展示层：不读网络、不读浏览器状态，方便用 `renderToStaticMarkup` 做结构测试。
 */
export function NotDuplicateRelationsView({
  items,
  canWrite,
  offline,
  showRevoked,
  loading,
  error,
  pendingId,
  onToggleRevoked,
  onRevoke,
}: {
  readonly items: readonly NotDuplicateRelation[];
  readonly canWrite: boolean;
  readonly offline: boolean;
  readonly showRevoked: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly pendingId: string | null;
  readonly onToggleRevoked: () => void;
  readonly onRevoke: (relationId: string) => void;
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-helper text-muted">已忽略的重复交易</h2>

      <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
        <p className="text-helper-relaxed text-muted">
          这里是你明确确认过「不是同一笔」的交易对。它们不会再出现在重复提示里；撤销后重新参与提示。
          记录保存在服务器、由全账本共享，不随个人检测偏好同步。
        </p>

        <div role="group" aria-label="关系筛选" className="flex gap-2">
          <button
            type="button"
            aria-pressed={!showRevoked}
            onClick={() => {
              if (showRevoked) onToggleRevoked();
            }}
            className={`rounded-full border px-3 py-1.5 text-helper ${
              showRevoked ? "border-line text-muted" : "border-brand bg-brand-soft text-brand-dark"
            }`}
          >
            生效中
          </button>
          <button
            type="button"
            aria-pressed={showRevoked}
            onClick={() => {
              if (!showRevoked) onToggleRevoked();
            }}
            className={`rounded-full border px-3 py-1.5 text-helper ${
              showRevoked ? "border-brand bg-brand-soft text-brand-dark" : "border-line text-muted"
            }`}
          >
            含已撤销
          </button>
        </div>

        {offline ? (
          <p className="text-helper-relaxed text-warn-dark">
            当前离线：只能查看已加载的记录，不能新建或撤销；联网后会自动刷新。
          </p>
        ) : null}

        {canWrite ? null : (
          <p className="text-helper-relaxed text-muted">
            你是这本账的查看者，只能查看「不重复」判断，不能撤销。
          </p>
        )}

        {error === null ? null : <Alert tone="error">{error}</Alert>}

        {loading ? (
          <p className="text-helper text-muted">正在读取…</p>
        ) : items.length === 0 ? (
          <p className="text-helper-relaxed text-muted">
            {showRevoked
              ? "还没有撤销过的「不重复」判断。"
              : "还没有确认过「不是同一笔」的交易。确认之后，这一对会出现在这里。"}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {items.map((relation) => {
              const revoked = relation.revokedAt !== null;
              const busy = pendingId === relation.id;

              return (
                <li key={relation.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                  <p className="text-body break-words text-ink">
                    {transactionLine(relation.transactionA)}
                  </p>
                  <p className="text-body break-words text-ink">
                    {transactionLine(relation.transactionB)}
                  </p>

                  <p className="text-helper-relaxed text-muted">
                    确认人：{relation.decidedByName ?? "未知成员"} ·{" "}
                    {formatDateTimeInZone(relation.decidedAt, localTimeZone())} ·{" "}
                    {NOT_DUPLICATE_DECISION_SOURCE_LABELS[
                      relation.decisionSource as NotDuplicateDecisionSource
                    ] ?? relation.decisionSource}
                  </p>

                  <p
                    className={`text-helper-relaxed ${
                      revoked || relation.stale ? "text-warn-dark" : "text-brand-dark"
                    }`}
                  >
                    {statusText(relation)}
                  </p>

                  {revoked ? null : (
                    <Button
                      variant="secondary"
                      fullWidth={false}
                      disabled={!canWrite || offline || busy}
                      onClick={() => {
                        onRevoke(relation.id);
                      }}
                    >
                      {busy ? "撤销中…" : "撤销这条判断"}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

/**
 * 容器：查询 + 撤销 + 离线/权限状态。真正的数据访问在 `lib/notDuplicateRelations.ts`。
 */
export function NotDuplicateRelationsSection({
  bookId,
  canWrite,
}: {
  readonly bookId: string;
  readonly canWrite: boolean;
}): React.JSX.Element {
  const [showRevoked, setShowRevoked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const { offline } = useAccountOffline();

  const relations = useNotDuplicateRelations(bookId, { includeRevoked: showRevoked });
  const revoke = useRevokeNotDuplicateRelation(bookId);

  function handleRevoke(relationId: string): void {
    setError(null);
    setPendingId(relationId);
    void revoke
      .mutateAsync(relationId)
      .catch((caught: unknown) => {
        setError(errorMessage(caught));
      })
      .finally(() => {
        setPendingId(null);
      });
  }

  return (
    <NotDuplicateRelationsView
      items={relations.data?.items ?? []}
      canWrite={canWrite}
      offline={offline}
      showRevoked={showRevoked}
      loading={relations.isLoading}
      error={error ?? (relations.error === null ? null : errorMessage(relations.error))}
      pendingId={pendingId}
      onToggleRevoked={() => {
        setShowRevoked((current) => !current);
      }}
      onRevoke={handleRevoke}
    />
  );
}
