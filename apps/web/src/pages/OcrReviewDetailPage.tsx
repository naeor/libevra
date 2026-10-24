/**
 * 单笔核对/编辑页（S15-B §3.3）。
 *
 * 路由 `/ocr/overview/:candidateId`。这里**只改批次临时数据**：保存后回到概览，
 * 概览卡片同步最新值；不会写账本。真正写账只发生在概览页的「确认导入」。
 *
 * 类型限制：`TransactionKind` 只有 expense/income，转账不是 kind。所以“类型”只允许
 * 收入/支出；识别为转账的候选保留 `isTransfer` 标记，并在备注里保留“转账”、分类
 * 映射到账本已有的「转账」分类。做真正的 transfer kind 需要改 schema/统计/迁移，
 * 不在本分支范围。
 */

import {
  CURRENCIES,
  type TransactionKind,
} from "@libellum/shared";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";

import { Alert } from "../components/Alert.js";
import { Button } from "../components/Button.js";
import { useDuplicateDetectionSettings } from "../components/DuplicateDetectionSettings.js";
import { InnerPage } from "../components/Layouts.js";
import { TextField } from "../components/TextField.js";
import { ocrChannelLabel, ocrDirectionLabel, ocrIssueText } from "../components/ocr/OcrOverview.js";
import { useI18n } from "../i18n/index.js";
import { displayCategoryName, displayPaymentMethodName } from "../lib/presetNames.js";
import {
  TRANSFER_CATEGORY_NAME,
  batchItem,
  batchBelongsToBook,
  updateBatchItem,
} from "../lib/ocr/batch.js";
import { NOTE_TRANSFER_MARKER } from "../lib/ocr/import.js";
import { loadBatch, saveBatch } from "../lib/ocr/batchStore.js";
import { inferCategory } from "../lib/ocr/category.js";
import { findSuspectedDuplicates, groupsForCandidate } from "../lib/ocr/duplicates.js";
import {
  categorySourceOf,
  deriveIssues,
  isItemComplete,
  type OcrBatch,
  type OcrBatchCandidate,
  type OcrCategorySource,
} from "../lib/ocr/types.js";
import { useLedger, useLedgerMeta } from "../lib/queries.js";

interface FormState {
  amount: string;
  kind: TransactionKind;
  /** False when the screenshot never said income/expense; the user must choose. */
  directionConfirmed: boolean;
  currency: string;
  date: string;
  time: string;
  merchant: string;
  categoryId: string;
  paymentMethodId: string;
  tagIds: string[];
  account: string;
  note: string;
}

function initialForm(item: OcrBatchCandidate): FormState {
  return {
    amount: item.amount ?? "",
    kind: item.direction === "income" ? "income" : "expense",
    directionConfirmed: item.direction === "income" || item.direction === "expense",
    currency: item.currency ?? "",
    date: item.occurredLocalDate ?? "",
    time: item.occurredTime ?? "",
    merchant: item.merchant ?? "",
    categoryId: item.categoryId ?? "",
    paymentMethodId: item.paymentMethodId ?? "",
    tagIds: [...item.tagIds],
    account: item.account ?? "",
    note: item.note ?? "",
  };
}

/** 把表单合回候选，用于在保存前显示“还剩哪些问题”。 */
function previewCandidate(item: OcrBatchCandidate, form: FormState): OcrBatchCandidate {
  return {
    ...item,
    amount: form.amount.trim() === "" ? null : form.amount.trim(),
    currency: form.currency === "" ? null : form.currency,
    // An unconfirmed direction stays unknown instead of quietly becoming the
    // form's default; the import preflight will keep asking for it.
    direction: form.directionConfirmed ? form.kind : item.direction,
    occurredLocalDate: form.date === "" ? null : form.date,
    occurredTime: form.time === "" ? null : form.time,
    merchant: form.merchant.trim() === "" ? null : form.merchant.trim(),
    account: form.account.trim() === "" ? null : form.account.trim(),
    note: form.note.trim() === "" ? null : form.note.trim(),
    categoryId: form.categoryId === "" ? null : form.categoryId,
    paymentMethodId: form.paymentMethodId === "" ? null : form.paymentMethodId,
    tagIds: form.tagIds,
  };
}

export function OcrReviewDetailPage(): React.JSX.Element {
  const { candidateId } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const ledger = useLedger();
  const duplicateSettings = useDuplicateDetectionSettings();

  const [batch, setBatch] = useState<OcrBatch | null>(() => loadBatch());
  /**
   * 分类/支付方式/标签按**批次所属账本**读（`useLedgerMeta`），不是当前账本：
   * 批次可能来自另一本账，用当前账本的下拉选项去改它会把 A 账的分类写进 B 账的草稿。
   * 离线时这个查询可能没有数据，同账本才回退到 `useLedger` 的缓存（它一直在用）；
   * 跨账本时不回退，宁可选项为空也不串账。
   */
  const bookMeta = useLedgerMeta(batch?.bookId ?? "");
  const item = batch === null || candidateId === undefined ? null : batchItem(batch, candidateId);
  const [form, setForm] = useState<FormState | null>(() => (item === null ? null : initialForm(item)));
  const [error, setError] = useState<string | null>(null);

  if (batch === null || item === null || form === null) {
    return (
      <InnerPage title={t("ocr.detail.title")} backTo="/ocr/overview">
        <Alert tone="error">
          {t("ocr.detail.notFound")}
        </Alert>
        <Button
          onClick={() => {
            void navigate("/ocr/overview");
          }}
        >
          {t("ocr.detail.backToOverview")}
        </Button>
      </InnerPage>
    );
  }

  const sameBook = batchBelongsToBook(batch, ledger.data?.book.id ?? null);
  const categories =
    bookMeta.data?.categories ?? (sameBook ? ledger.data?.categories : undefined) ?? [];
  const paymentMethods =
    bookMeta.data?.paymentMethods ?? (sameBook ? ledger.data?.paymentMethods : undefined) ?? [];
  const tags = bookMeta.data?.tags ?? (sameBook ? ledger.data?.tags : undefined) ?? [];

  const categoryOptions = categories.filter(
    (category) => !category.isArchived && !category.isSystem && category.kind === form.kind,
  );
  const methodOptions = paymentMethods.filter((method) => !method.isArchived);
  const unsupportedCurrency =
    item.currency !== null && !(CURRENCIES as readonly string[]).includes(item.currency)
      ? item.currency
      : null;

  /**
   * 「系统建议」提示：只在分类还不是用户自己定的时候出现。
   *
   * 两种情况：
   *  1. 批次里已带推断值（`categorySource === "inferred"`）——概览页已经用 `matchCategory`
   *     在本账本分类里匹配过，这里只是说明“可改”；
   *  2. 还没写进批次（存储写入失败等）——用同一套纯函数现算一次，和概览给的会是同一个结果。
   * 用户改过分类后 `form.categoryId` 不再等于建议值，提示自动消失。
   */
  const itemSource = categorySourceOf(item);
  const suggestedId =
    item.categoryId !== null
      ? itemSource === "inferred"
        ? item.categoryId
        : null
      : itemSource === "user"
        ? null
        : (inferCategory(item, categories)?.categoryId ?? null);
  const suggestedName =
    suggestedId === null
      ? null
      : (categories.find((category) => category.id === suggestedId)?.name ?? null);
  const showSuggestion = suggestedName !== null && form.categoryId === suggestedId;

  const preview = previewCandidate(item, form);
  const issues = deriveIssues(preview);
  const duplicateGroups = groupsForCandidate(
    findSuspectedDuplicates(batch.items, { settings: duplicateSettings.settings }),
    item.candidateId,
  );

  function patch(changes: Partial<FormState>): void {
    setForm((current) => (current === null ? current : { ...current, ...changes }));
  }

  function changeKind(next: TransactionKind): void {
    if (form === null) return;

    // Keep the category valid for the new kind; a transfer falls back to the
    // ledger's own 转账 preset, everything else to “未分类”.
    const currentCategory = categories.find((category) => category.id === form.categoryId);
    const transferCategory = item?.isTransfer === true
      ? categories.find(
          (category) =>
            category.name === TRANSFER_CATEGORY_NAME &&
            category.kind === next &&
            !category.isArchived &&
            !category.isSystem,
        )
      : undefined;

    patch({
      kind: next,
      directionConfirmed: true,
      categoryId:
        currentCategory?.kind === next && !currentCategory.isArchived
          ? currentCategory.id
          : (transferCategory?.id ?? ""),
    });
  }

  function persist(patchItem: Partial<OcrBatchCandidate>): void {
    if (batch === null || item === null) return;

    const updated = updateBatchItem(
      batch,
      item.candidateId,
      patchItem,
      duplicateSettings.settings,
    );
    if (!saveBatch(updated)) {
      setError(t("ocr.detail.storageFailed"));
      return;
    }

    setBatch(updated);
    void navigate("/ocr/overview");
  }

  function save(): void {
    if (form === null || item === null) return;

    const nextCategoryId = form.categoryId === "" ? null : form.categoryId;
    const nextCategorySource = categorySourceAfterSave(item, nextCategoryId);

    // Empty strings become null so a cleared field is honestly “待确认”, not "".
    const patch: Partial<Omit<OcrBatchCandidate, "candidateId" | "imageIndex">> = {
      amount: form.amount.trim() === "" ? null : form.amount.trim(),
      currency: form.currency === "" ? null : form.currency,
      direction: form.directionConfirmed ? form.kind : item.direction,
      occurredLocalDate: form.date === "" ? null : form.date,
      occurredTime: form.time === "" ? null : form.time,
      merchant: form.merchant.trim() === "" ? null : form.merchant.trim(),
      categoryId: nextCategoryId,
      paymentMethodId: form.paymentMethodId === "" ? null : form.paymentMethodId,
      tagIds: form.tagIds,
      account: form.account.trim() === "" ? null : form.account.trim(),
      note: form.note.trim() === "" ? null : form.note.trim(),
      reviewed: true,
    };
    // `exactOptionalPropertyTypes`：不确定来源时不要写 `categorySource: undefined`。
    if (nextCategorySource !== undefined) patch.categorySource = nextCategorySource;

    persist(patch);
  }

  function markInvalid(): void {
    if (item === null) return;
    persist({ invalid: !item.invalid, reviewed: true });
  }

  return (
    <InnerPage
      title={t("ocr.detail.title")}
      subtitle={t("ocr.detail.subtitle")}
      backTo="/ocr/overview"
    >
      {error === null ? null : <Alert tone="error">{error}</Alert>}

      {item.invalid ? <Alert tone="info">{t("ocr.detail.invalid")}</Alert> : null}

      {form.directionConfirmed ? null : (
        <Alert tone="info">
          {t("ocr.detail.directionUnknown")}
        </Alert>
      )}

      {item.isTransfer ? (
        <Alert tone="info">
          {t("ocr.detail.transfer", { marker: NOTE_TRANSFER_MARKER })}
        </Alert>
      ) : null}

      {duplicateGroups.length > 0 ? (
        <Alert tone="info">
          {t("ocr.detail.duplicateNote", {
            reasons: duplicateGroups
              .map((group) => t("ocr.detail.duplicateReason", { reason: group.reason }))
              .join(" "),
          })}
        </Alert>
      ) : null}

      <section className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 shadow-card">
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-full bg-brand-soft px-2.5 py-1 text-helper text-brand-dark">
            {ocrDirectionLabel(item.direction)}
          </span>
          {item.isRefund ? (
            <span className="rounded-full bg-brand-soft px-2.5 py-1 text-helper text-brand-dark">{t("ocr.list.refund")}</span>
          ) : null}
          {item.reviewed ? (
            <span className="rounded-full bg-canvas px-2.5 py-1 text-helper text-muted">{t("ocr.detail.reviewed")}</span>
          ) : null}
          <span className="rounded-full bg-canvas px-2.5 py-1 text-helper text-muted">
            {t("ocr.detail.source", {
              source:
                item.sourcePlatform === null
                  ? t("ocr.detail.sourcePending")
                  : ocrChannelLabel(item.sourcePlatform),
            })}
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-helper text-muted">{t("ocr.detail.kindLabel")}</span>
          <div className="flex gap-2">
            <KindButton
              active={form.directionConfirmed && form.kind === "expense"}
              label={t("common.kind.expense")}
              onSelect={() => { changeKind("expense"); }}
            />
            <KindButton
              active={form.directionConfirmed && form.kind === "income"}
              label={t("common.kind.income")}
              onSelect={() => { changeKind("income"); }}
            />
          </div>
        </div>

        <TextField
          label={t("common.field.amount")}
          inputMode="decimal"
          value={form.amount}
          placeholder="0.00"
          onChange={(event) => { patch({ amount: event.target.value }); }}
        />

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">{t("common.field.currency")}</span>
          <select
            className="w-full rounded-field border border-line bg-surface px-3.5 py-3 text-base text-ink outline-none focus:border-brand focus:ring-4 focus:ring-focus-ring"
            value={form.currency}
            onChange={(event) => { patch({ currency: event.target.value }); }}
          >
            <option value="">{t("ocr.detail.chooseCurrency")}</option>
            {unsupportedCurrency === null ? null : (
              <option value={unsupportedCurrency} disabled>
                {t("ocr.detail.unsupportedCurrency", { currency: unsupportedCurrency })}
              </option>
            )}
            {CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </label>

        {/* S16-A: at 320px the time input used to push past the card edge and scroll the whole
            page sideways. Below 360px the two pickers now stack (the same "one field per row" rule
            the owner chose for the manual entry form); wider screens keep them side by side, and
            `min-w-0` lets each shrink inside its column. */}
        <div className="flex flex-col gap-3 min-[360px]:flex-row">
          <label className="flex min-w-0 flex-[1.4] flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">{t("common.field.date")}</span>
            <input
              type="date"
              className="w-full min-w-0 rounded-field border border-line bg-surface px-3.5 py-3 text-base text-ink outline-none focus:border-brand focus:ring-4 focus:ring-focus-ring"
              value={form.date}
              onChange={(event) => { patch({ date: event.target.value }); }}
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">{t("common.field.time")}</span>
            <input
              type="time"
              className="w-full min-w-0 rounded-field border border-line bg-surface px-3.5 py-3 text-base text-ink outline-none focus:border-brand focus:ring-4 focus:ring-focus-ring"
              value={form.time}
              onChange={(event) => { patch({ time: event.target.value }); }}
            />
          </label>
        </div>

        <TextField
          label={t("ocr.detail.merchant")}
          value={form.merchant}
          placeholder={t("ocr.detail.merchantPlaceholder")}
          onChange={(event) => { patch({ merchant: event.target.value }); }}
        />

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">{t("common.field.category")}</span>
          <select
            className="w-full rounded-field border border-line bg-surface px-3.5 py-3 text-base text-ink outline-none focus:border-brand focus:ring-4 focus:ring-focus-ring"
            value={categoryOptions.some((category) => category.id === form.categoryId) ? form.categoryId : ""}
            onChange={(event) => { patch({ categoryId: event.target.value }); }}
          >
            <option value="">{t("ocr.detail.uncategorized")}</option>
            {categoryOptions.map((category) => (
              <option key={category.id} value={category.id}>
                {displayCategoryName(category.name)}
              </option>
            ))}
          </select>
        </label>

        {showSuggestion ? (
          <p className="text-helper text-muted">
            {t("ocr.detail.suggestion", { name: displayCategoryName(suggestedName ?? "") })}
          </p>
        ) : null}

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">{t("ocr.detail.paymentMethod")}</span>
          <select
            className="w-full rounded-field border border-line bg-surface px-3.5 py-3 text-base text-ink outline-none focus:border-brand focus:ring-4 focus:ring-focus-ring"
            value={methodOptions.some((method) => method.id === form.paymentMethodId) ? form.paymentMethodId : ""}
            onChange={(event) => { patch({ paymentMethodId: event.target.value }); }}
          >
            <option value="">{t("ocr.detail.unspecified")}</option>
            {methodOptions.map((method) => (
              <option key={method.id} value={method.id}>
                {displayPaymentMethodName(method.name)}
              </option>
            ))}
          </select>
        </label>

        <TextField
          label={t("ocr.detail.account")}
          value={form.account}
          placeholder={t("ocr.detail.accountPlaceholder")}
          onChange={(event) => { patch({ account: event.target.value }); }}
          hint={t("ocr.detail.accountHint")}
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-ink">{t("common.field.tags")}</legend>
          {tags.length === 0 ? (
            <p className="text-helper text-muted">{t("ocr.detail.noTags")}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => {
                const selected = form.tagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      patch({
                        tagIds: selected
                          ? form.tagIds.filter((id) => id !== tag.id)
                          : [...form.tagIds, tag.id],
                      });
                    }}
                    className={`rounded-full border px-3 py-1.5 text-helper ${
                      selected
                        ? "border-brand bg-brand-soft text-brand-dark"
                        : "border-line bg-surface text-muted"
                    }`}
                  >
                    {tag.name}
                  </button>
                );
              })}
            </div>
          )}
        </fieldset>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">{t("common.field.note")}</span>
          <textarea
            rows={3}
            maxLength={200}
            className="w-full rounded-field border border-line bg-surface px-3.5 py-3 text-base text-ink outline-none focus:border-brand focus:ring-4 focus:ring-focus-ring"
            value={form.note}
            placeholder={t("ocr.detail.notePlaceholder")}
            onChange={(event) => { patch({ note: event.target.value }); }}
          />
          <span className="text-helper text-muted">{t("ocr.detail.noteHint")}</span>
        </label>

        {issues.length === 0 ? null : (
          <div className="flex flex-col gap-1">
            <span className="text-helper text-muted">{t("ocr.detail.stillToCheck")}</span>
            <ul className="flex flex-col gap-1">
              {issues.map((issue) => (
                <li key={`${issue.code}:${issue.field ?? ""}`} className="text-helper-relaxed text-warning-dark">
                  ⚠ {ocrIssueText(issue)}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-helper text-muted">
          {isItemComplete(preview)
            ? t("ocr.detail.complete")
            : t("ocr.detail.incomplete")}
        </p>
      </section>

      <div className="flex flex-col gap-2">
        <Button onClick={save}>{t("ocr.detail.save")}</Button>
        <Button variant={item.invalid ? "secondary" : "danger-quiet"} onClick={markInvalid}>
          {item.invalid ? t("ocr.detail.restoreValid") : t("ocr.detail.markInvalid")}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            void navigate("/ocr/overview");
          }}
        >
          {t("ocr.detail.backWithoutSaving")}
        </Button>
      </div>
    </InnerPage>
  );
}

function KindButton({
  active,
  label,
  onSelect,
}: {
  readonly active: boolean;
  readonly label: string;
  readonly onSelect: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={`flex-1 rounded-field border px-4 py-3 text-body transition ${
        active ? "border-brand bg-brand-soft text-brand-dark" : "border-line bg-surface text-muted"
      }`}
    >
      {label}
    </button>
  );
}

export type { FormState };
export { initialForm, previewCandidate };

/**
 * 保存后分类值的来源。
 *
 * 只在用户**真的动过**分类时改成 `user`：
 *  - 没动 → 保留原来源，`inferred` 仍然是“系统建议”（用户看过后接受了它）；
 *  - 换了一个 / 清空了推断值 → `user`，否则下次进概览会被重新推断出来，等于覆盖
 *    用户的决定。
 */
export function categorySourceAfterSave(
  item: Pick<OcrBatchCandidate, "categoryId" | "categorySource">,
  nextCategoryId: string | null,
): OcrCategorySource | undefined {
  return nextCategoryId === item.categoryId ? item.categorySource : "user";
}
