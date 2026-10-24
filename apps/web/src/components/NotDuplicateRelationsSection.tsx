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
  NOT_DUPLICATE_DECISION_SOURCES,
  UNCATEGORISED_NAME,
  formatTransactionNumber,
  type NotDuplicateRelation,
  type NotDuplicateRelationTransaction,
  type NotDuplicateDecisionSource,
} from "@libellum/shared";
import { useState } from "react";

import { Alert } from "./Alert.js";
import { Button } from "./Button.js";
import { t as translate, useI18n } from "../i18n/index.js";
import { useAccountOffline } from "../lib/offline/connectivity.js";
import { formatDateTimeInZone, localTimeZone } from "../lib/datetime.js";
import { duplicateFieldLabel, joinDuplicateList } from "../lib/duplicateReview.js";
import { formatMoney } from "../lib/format.js";
import { errorMessage } from "../lib/api.js";
import { displayCategoryName } from "../lib/presetNames.js";
import {
  useNotDuplicateRelations,
  useRevokeNotDuplicateRelation,
} from "../lib/notDuplicateRelations.js";

/** 失效时会列出的字段：只在这里出现的才翻译，其它字段名原样显示（与以前一致）。 */
const STALE_FIELDS: ReadonlySet<string> = new Set(["amountCents", "currency", "kind", "occurredAt"]);

function transactionLine(entry: NotDuplicateRelationTransaction | null): string {
  if (entry === null) return translate("duplicates.relations.missingEntry");

  return [
    `${formatTransactionNumber(entry.seq)}`,
    entry.occurredLocalDate,
    formatMoney(entry.amountCents, entry.currency, { withCode: true }),
    translate(entry.kind === "income" ? "common.kind.income" : "common.kind.expense"),
    // 分类名是账本数据：只有预置名在英文界面显示译名（`displayCategoryName`）。
    displayCategoryName(entry.categoryName ?? UNCATEGORISED_NAME),
  ].join(" · ");
}

/** 确认来源按代码翻译（`NOT_DUPLICATE_DECISION_SOURCE_LABELS` 的界面语言版本）；未知代码原样显示。 */
function decisionSourceText(source: string): string {
  return (NOT_DUPLICATE_DECISION_SOURCES as readonly string[]).includes(source)
    ? translate(`duplicates.relations.source.${source as NotDuplicateDecisionSource}`)
    : source;
}

function statusText(relation: NotDuplicateRelation): string {
  if (relation.revokedAt !== null) {
    const who = relation.revokedByName ?? translate("duplicates.relations.unknownMember");
    const when = formatDateTimeInZone(relation.revokedAt, localTimeZone());
    return translate("duplicates.relations.revoked", { who, when });
  }

  if (relation.stale) {
    const fields = joinDuplicateList(
      relation.staleFields.map((field) => (STALE_FIELDS.has(field) ? duplicateFieldLabel(field) : field)),
    );
    return fields === ""
      ? translate("duplicates.relations.staleNoFields")
      : translate("duplicates.relations.staleFields", { fields });
  }

  if (relation.transactionA === null || relation.transactionB === null) {
    return translate("duplicates.relations.orphaned");
  }

  return translate("duplicates.relations.activeStatus");
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
  const { t } = useI18n();

  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-helper text-muted">{t("duplicates.relations.heading")}</h2>

      <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
        <p className="text-helper-relaxed text-muted">
          {t("duplicates.relations.intro")}
        </p>

        {/* S16：英文按钮更长，窄屏允许换行。 */}
        <div role="group" aria-label={t("duplicates.relations.filterLabel")} className="flex flex-wrap gap-2">
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
            {t("duplicates.relations.active")}
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
            {t("duplicates.relations.includeRevoked")}
          </button>
        </div>

        {offline ? (
          <p className="text-helper-relaxed text-warn-dark">
            {t("duplicates.relations.offline")}
          </p>
        ) : null}

        {canWrite ? null : (
          <p className="text-helper-relaxed text-muted">
            {t("duplicates.relations.viewer")}
          </p>
        )}

        {error === null ? null : <Alert tone="error">{error}</Alert>}

        {loading ? (
          <p className="text-helper text-muted">{t("common.status.reading")}</p>
        ) : items.length === 0 ? (
          <p className="text-helper-relaxed text-muted">
            {showRevoked
              ? t("duplicates.relations.emptyRevoked")
              : t("duplicates.relations.empty")}
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
                    {t("duplicates.relations.decided", {
                      who: relation.decidedByName ?? t("duplicates.relations.unknownMember"),
                      when: formatDateTimeInZone(relation.decidedAt, localTimeZone()),
                      source: decisionSourceText(relation.decisionSource),
                    })}
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
                      {busy ? t("duplicates.relations.revoking") : t("duplicates.relations.revoke")}
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
