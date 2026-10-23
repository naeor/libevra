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
  OCR_CHANNEL_LABELS,
  OCR_DIRECTION_LABELS,
  type TransactionKind,
} from "@libellum/shared";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";

import { Alert } from "../components/Alert.js";
import { Button } from "../components/Button.js";
import { useDuplicateDetectionSettings } from "../components/DuplicateDetectionSettings.js";
import { InnerPage } from "../components/Layouts.js";
import { TextField } from "../components/TextField.js";
import { batchItem, batchBelongsToBook, updateBatchItem } from "../lib/ocr/batch.js";
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
      <InnerPage title="核对这一笔" backTo="/ocr/overview">
        <Alert tone="error">
          找不到这一笔：批次可能已经被清除，或这条链接来自另一个标签页。
        </Alert>
        <Button
          onClick={() => {
            void navigate("/ocr/overview");
          }}
        >
          返回批量识别结果
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
            category.name === "转账" &&
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
      setError("浏览器无法保存这笔修改（可能是隐私模式或存储空间已满）。修改没有生效，请重试。");
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
      title="核对这一笔"
      subtitle="只修改本批次的临时数据；保存不会写入账本。"
      backTo="/ocr/overview"
    >
      {error === null ? null : <Alert tone="error">{error}</Alert>}

      {item.invalid ? <Alert tone="info">这笔已标记无效，确认导入时不会计入。</Alert> : null}

      {form.directionConfirmed ? null : (
        <Alert tone="info">
          截图没有说明这笔是收入还是支出。请选择类型；不选的话它不会进入确认导入。
        </Alert>
      )}

      {item.isTransfer ? (
        <Alert tone="info">
          这是一笔转账。账本只有收入/支出两种类型，没有 transfer 类型；这笔会按你选的收支记录，
          备注里保留「转账」，分类可映射到账本已有的「转账」分类。
        </Alert>
      ) : null}

      {duplicateGroups.length > 0 ? (
        <Alert tone="info">
          {duplicateGroups.map((group) => `可能重复：${group.reason}。`).join(" ")}
          系统不会自动合并或删除，是否保留由你在概览页确认。
        </Alert>
      ) : null}

      <section className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 shadow-card">
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-full bg-brand-soft px-2.5 py-1 text-helper text-brand-dark">
            {OCR_DIRECTION_LABELS[item.direction]}
          </span>
          {item.isRefund ? (
            <span className="rounded-full bg-brand-soft px-2.5 py-1 text-helper text-brand-dark">退款</span>
          ) : null}
          {item.reviewed ? (
            <span className="rounded-full bg-canvas px-2.5 py-1 text-helper text-muted">已核对过</span>
          ) : null}
          <span className="rounded-full bg-canvas px-2.5 py-1 text-helper text-muted">
            来源：{item.sourcePlatform === null ? "待确认" : OCR_CHANNEL_LABELS[item.sourcePlatform]}
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-helper text-muted">类型（转账不是单独类型）</span>
          <div className="flex gap-2">
            <KindButton
              active={form.directionConfirmed && form.kind === "expense"}
              label="支出"
              onSelect={() => { changeKind("expense"); }}
            />
            <KindButton
              active={form.directionConfirmed && form.kind === "income"}
              label="收入"
              onSelect={() => { changeKind("income"); }}
            />
          </div>
        </div>

        <TextField
          label="金额"
          inputMode="decimal"
          value={form.amount}
          placeholder="0.00"
          onChange={(event) => { patch({ amount: event.target.value }); }}
        />

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">币种</span>
          <select
            className="w-full rounded-field border border-line bg-surface px-3.5 py-3 text-base text-ink outline-none focus:border-brand focus:ring-4 focus:ring-brand-soft"
            value={form.currency}
            onChange={(event) => { patch({ currency: event.target.value }); }}
          >
            <option value="">请选择币种</option>
            {unsupportedCurrency === null ? null : (
              <option value={unsupportedCurrency} disabled>
                {unsupportedCurrency}（账本不支持，请改选）
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
            <span className="text-sm font-medium text-ink">日期</span>
            <input
              type="date"
              className="w-full min-w-0 rounded-field border border-line bg-surface px-3.5 py-3 text-base text-ink outline-none focus:border-brand focus:ring-4 focus:ring-brand-soft"
              value={form.date}
              onChange={(event) => { patch({ date: event.target.value }); }}
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">时间</span>
            <input
              type="time"
              className="w-full min-w-0 rounded-field border border-line bg-surface px-3.5 py-3 text-base text-ink outline-none focus:border-brand focus:ring-4 focus:ring-brand-soft"
              value={form.time}
              onChange={(event) => { patch({ time: event.target.value }); }}
            />
          </label>
        </div>

        <TextField
          label="对象 / 商户"
          value={form.merchant}
          placeholder="未读出就留空"
          onChange={(event) => { patch({ merchant: event.target.value }); }}
        />

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">分类</span>
          <select
            className="w-full rounded-field border border-line bg-surface px-3.5 py-3 text-base text-ink outline-none focus:border-brand focus:ring-4 focus:ring-brand-soft"
            value={categoryOptions.some((category) => category.id === form.categoryId) ? form.categoryId : ""}
            onChange={(event) => { patch({ categoryId: event.target.value }); }}
          >
            <option value="">未分类（导入时归入暂无分类）</option>
            {categoryOptions.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>

        {showSuggestion ? (
          <p className="text-helper text-muted">
            系统建议：{suggestedName}（可改；按交易对象/备注的文字匹配本账本已有分类，不是已确认）。
          </p>
        ) : null}

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">渠道 / 支付方式</span>
          <select
            className="w-full rounded-field border border-line bg-surface px-3.5 py-3 text-base text-ink outline-none focus:border-brand focus:ring-4 focus:ring-brand-soft"
            value={methodOptions.some((method) => method.id === form.paymentMethodId) ? form.paymentMethodId : ""}
            onChange={(event) => { patch({ paymentMethodId: event.target.value }); }}
          >
            <option value="">未指定</option>
            {methodOptions.map((method) => (
              <option key={method.id} value={method.id}>
                {method.name}
              </option>
            ))}
          </select>
        </label>

        <TextField
          label="账户"
          value={form.account}
          placeholder="例如：零钱、尾号 6688"
          onChange={(event) => { patch({ account: event.target.value }); }}
          hint="会写进备注；账本没有单独的账户字段。"
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-ink">标签</legend>
          {tags.length === 0 ? (
            <p className="text-helper text-muted">这本账还没有标签。</p>
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
          <span className="text-sm font-medium text-ink">备注</span>
          <textarea
            rows={3}
            maxLength={200}
            className="w-full rounded-field border border-line bg-surface px-3.5 py-3 text-base text-ink outline-none focus:border-brand focus:ring-4 focus:ring-brand-soft"
            value={form.note}
            placeholder="可以留空"
            onChange={(event) => { patch({ note: event.target.value }); }}
          />
          <span className="text-helper text-muted">最多 200 字；导入时还会在前面加上商户、账户信息。</span>
        </label>

        {issues.length === 0 ? null : (
          <div className="flex flex-col gap-1">
            <span className="text-helper text-muted">还需要核对</span>
            <ul className="flex flex-col gap-1">
              {issues.map((issue) => (
                <li key={`${issue.code}:${issue.field ?? ""}`} className="text-helper-relaxed text-warning-dark">
                  ⚠ {issue.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-helper text-muted">
          {isItemComplete(preview)
            ? "关键字段已齐全；保存后回概览，仍要统一确认才会写账。"
            : "关键字段还不齐：保存的是草稿，确认导入前需要补齐或标记无效。"}
        </p>
      </section>

      <div className="flex flex-col gap-2">
        <Button onClick={save}>保存并返回概览</Button>
        <Button variant={item.invalid ? "secondary" : "danger-quiet"} onClick={markInvalid}>
          {item.invalid ? "恢复为有效" : "标记为无效"}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            void navigate("/ocr/overview");
          }}
        >
          返回概览（不保存）
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
