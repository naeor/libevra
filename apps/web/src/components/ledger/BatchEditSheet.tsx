import type { Category, PaymentMethod, Tag, TransactionKind } from "@libellum/shared";
import { BottomSheet } from "../BottomSheet.js";
import { SlidingSelection } from "../ui/SlidingSelection.js";
import { useI18n } from "../../i18n/index.js";
import { displayCategoryName, displayPaymentMethodName } from "../../lib/presetNames.js";
import { tagFillStyle } from "../../lib/tagColors.js";

import { draftTouchesAnything, type BatchEditDraft, type BatchTagMode } from "./batch.js";

/**
 * The batch edit sheet: three safe fields, each one opt-in.
 *
 * ⚠️ **A field only changes when its box is ticked.** That is the owner's rule — "只改用户明确选择的
 * 字段，未勾选的字段保持原值" — expressed as the sheet's shape rather than as a promise in the copy:
 * every field starts unticked, and unticked means the patch does not mention it at all.
 *
 * ⚠️ **Amount, direction, currency and date are not offered.** They are not "guarded" here; they are
 * absent, because the one destructive mistake a batch operation can make is to flatten sixty entries
 * onto one number, and there is no undo for that.
 *
 * ⚠️ **Mixed directions disable the category field instead of guessing.** The list is filtered by
 * expense/income, so a mixed selection should not normally happen — but if it ever does, grouping by
 * direction would silently split one request into two different results, which is harder to explain
 * than a disabled control with a sentence beside it.
 */
export function BatchEditSheet({
  open,
  count,
  kinds,
  categories,
  paymentMethods,
  tags,
  draft,
  blockedReason,
  busy,
  onDraftChange,
  onApply,
  onClose,
}: {
  readonly open: boolean;
  readonly count: number;
  /** The distinct directions among the selected entries. */
  readonly kinds: readonly TransactionKind[];
  readonly categories: readonly Category[];
  readonly paymentMethods: readonly PaymentMethod[];
  readonly tags: readonly Tag[];
  readonly draft: BatchEditDraft;
  /** Why the whole operation is not allowed right now (permission/read-only), or `null`. */
  readonly blockedReason: string | null;
  readonly busy: boolean;
  readonly onDraftChange: (next: BatchEditDraft) => void;
  readonly onApply: () => void;
  readonly onClose: () => void;
}): React.JSX.Element | null {
  const { t } = useI18n();
  if (!open) return null;

  const mixedKinds = kinds.length > 1;
  const usableCategories = categories.filter(
    (category) => !category.isArchived && (mixedKinds || kinds.includes(category.kind)),
  );
  const usablePaymentMethods = paymentMethods.filter((method) => !method.isArchived);

  const incomplete = draftTouchesAnything(draft)
    ? (draft.setCategory && draft.categoryId === null) ||
      (draft.setPaymentMethod && draft.paymentMethodId === null) ||
      (draft.setTags && draft.tagIds.length === 0)
    : true;

  const applyReason =
    blockedReason ??
    (count === 0
      ? t("ledger.batch.sheet.noneSelected")
      : !draftTouchesAnything(draft)
        ? t("ledger.batch.sheet.tickFirst")
        : incomplete
          ? t("ledger.batch.sheet.incomplete")
          : null);

  /**
   * 弹出面板模板 T2（1.19.59）：原来缺 `aria-modal`、没有 Esc；现在外壳补上焦点、Esc、下拉关闭与模板标题行，
   * 取消 / 应用放进固定底部操作区。宽屏下仍一直贴底（电脑版明细也用这一块，形态不变）。
   * ⚠️ `blockedReason`、`applyReason` 与各字段的禁用判断原地不动，只换外壳（AGENTS §5）。
   * 关闭前询问（所有者 2026-11-14）：一次影响多笔账目，勾选了要改的字段后关闭先问；应用中不响应关闭。
   */
  return (
    <BottomSheet
      label={t("ledger.batch.sheet.title")}
      title={t("ledger.batch.sheet.title")}
      headerActions={<span className="px-1 text-helper text-muted">{t("ledger.batch.sheet.selectedCount", { count })}</span>}
      wide="bottom"
      dirty={draftTouchesAnything(draft)}
      busy={busy}
      bodyClassName="px-6 pt-1 pb-4"
      footer={({ close }) => (
        <>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={close}
              className="flex-1 rounded-field bg-brand-soft px-4 py-3 text-button-lg font-medium text-brand-dark transition hover:bg-brand/20"
            >
              {t("common.action.cancel")}
            </button>

            <button
              type="button"
              disabled={applyReason !== null || busy}
              onClick={onApply}
              className="flex-1 rounded-field bg-brand px-4 py-3 text-button-lg font-medium text-on-brand transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-45"
            >
              {busy ? t("common.status.processing") : t("ledger.batch.sheet.applyCount", { count })}
            </button>
          </div>

          {applyReason === null ? null : (
            <p className="mt-2 text-center text-helper text-muted">{applyReason}</p>
          )}
        </>
      )}
      onClose={onClose}
    >
        {blockedReason === null ? null : (
          <p role="alert" className="mt-3 rounded-field bg-warn-soft px-3 py-2 text-helper-relaxed text-ink">
            {blockedReason}
          </p>
        )}

        {/* 分类 */}
        <section className={`mt-4 rounded-field bg-canvas px-4 py-3 ${blockedReason === null ? "" : "opacity-60"}`}>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={draft.setCategory}
              disabled={mixedKinds || blockedReason !== null}
              aria-label={t("ledger.batch.sheet.changeCategory")}
              onChange={(event) => {
                onDraftChange({ ...draft, setCategory: event.target.checked });
              }}
              className="size-4 shrink-0 accent-brand"
            />
            {t("ledger.batch.sheet.changeCategory")}
          </label>

          {mixedKinds ? (
            <p className="mt-1.5 text-helper-relaxed text-muted">
              {t("ledger.batch.sheet.mixedKinds")}
            </p>
          ) : (
            <select
              value={draft.categoryId ?? ""}
              disabled={!draft.setCategory || blockedReason !== null}
              aria-label={t("ledger.batch.sheet.chooseCategory")}
              onChange={(event) => {
                onDraftChange({
                  ...draft,
                  categoryId: event.target.value === "" ? null : event.target.value,
                });
              }}
              className="mt-2 w-full rounded-field border border-line bg-surface px-3 py-2 text-base text-ink disabled:opacity-45"
            >
              <option value="">{t("ledger.batch.sheet.chooseCategoryOption")}</option>
              {usableCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {displayCategoryName(category.name)}
                </option>
              ))}
            </select>
          )}
        </section>

        {/* 标签 */}
        <section className={`mt-3 rounded-field bg-canvas px-4 py-3 ${blockedReason === null ? "" : "opacity-60"}`}>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={draft.setTags}
              disabled={blockedReason !== null}
              aria-label={t("ledger.batch.sheet.changeTags")}
              onChange={(event) => {
                onDraftChange({ ...draft, setTags: event.target.checked });
              }}
              className="size-4 shrink-0 accent-brand"
            />
            {t("ledger.batch.sheet.changeTags")}
          </label>

          <SlidingSelection data-select-track="" className="mt-2 flex gap-1 rounded-full bg-line/70 p-1">
            {(["add", "remove"] as const).map((mode: BatchTagMode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={draft.tagMode === mode}
                disabled={!draft.setTags || blockedReason !== null}
                onClick={() => {
                  onDraftChange({ ...draft, tagMode: mode });
                }}
                className={`flex-1 rounded-full py-1.5 text-helper transition disabled:opacity-45 ${
                  draft.tagMode === mode ? "bg-surface text-brand-dark shadow-sm" : "text-muted"
                }`}
              >
                {mode === "add" ? t("ledger.batch.sheet.tagAdd") : t("ledger.batch.sheet.tagRemove")}
              </button>
            ))}
          </SlidingSelection>

          <div className="mt-2 flex flex-wrap gap-2">
            {tags.map((tag) => {
              const chosen = draft.tagIds.includes(tag.id);

              return (
                <button
                  key={tag.id}
                  type="button"
                  aria-pressed={chosen}
                  disabled={!draft.setTags || blockedReason !== null}
                  onClick={() => {
                    onDraftChange({
                      ...draft,
                      tagIds: chosen
                        ? draft.tagIds.filter((id) => id !== tag.id)
                        : [...draft.tagIds, tag.id],
                    });
                  }}
                  style={chosen ? tagFillStyle(tag.color) : undefined}
                  className={`rounded-full border px-3 py-1.5 text-helper transition disabled:opacity-45 ${
                    chosen ? "text-on-tag" : "border-line bg-surface text-ink"
                  }`}
                >
                  {tag.name}
                </button>
              );
            })}

            {tags.length === 0 ? <span className="text-helper text-muted">{t("ledger.batch.sheet.noTags")}</span> : null}
          </div>
        </section>

        {/* 支付方式 */}
        <section className={`mt-3 rounded-field bg-canvas px-4 py-3 ${blockedReason === null ? "" : "opacity-60"}`}>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={draft.setPaymentMethod}
              disabled={blockedReason !== null}
              aria-label={t("ledger.batch.sheet.changePayment")}
              onChange={(event) => {
                onDraftChange({ ...draft, setPaymentMethod: event.target.checked });
              }}
              className="size-4 shrink-0 accent-brand"
            />
            {t("ledger.batch.sheet.changePayment")}
          </label>

          <select
            value={draft.paymentMethodId ?? ""}
            disabled={!draft.setPaymentMethod || blockedReason !== null}
            aria-label={t("ledger.batch.sheet.choosePayment")}
            onChange={(event) => {
              onDraftChange({
                ...draft,
                paymentMethodId: event.target.value === "" ? null : event.target.value,
              });
            }}
            className="mt-2 w-full rounded-field border border-line bg-surface px-3 py-2 text-base text-ink disabled:opacity-45"
          >
            <option value="">{t("ledger.batch.sheet.choosePaymentOption")}</option>
            {usablePaymentMethods.map((method) => (
              <option key={method.id} value={method.id}>
                {displayPaymentMethodName(method.name)}
              </option>
            ))}
          </select>
        </section>

    </BottomSheet>
  );
}
