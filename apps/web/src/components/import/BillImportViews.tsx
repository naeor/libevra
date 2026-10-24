/**
 * 账单导入 V2 的展示组件：**纯展示，不取数、不写 storage**。
 *
 * 页面（`pages/ImportPage.tsx`）负责请求、状态和提交；这些组件只接收数据与回调。
 * 这样它们可以用 `renderToStaticMarkup` 在纯 Node 测试里验证（本仓库没有 DOM 测试环境），
 * 页面本身则用纯函数测试 + 源码契约测试覆盖。
 *
 * 视觉语言沿用 OCR 概览/语音/拍照页：`rounded-card` 卡片、`text-section-title` 金额、
 * `min-h-11` 触控目标、`text-helper` 辅助文字、`warn-*` 提醒色。
 *
 * S16 国际化：文案都来自 `dataio.*`；账单里的商户、备注、标签、单号、来源状态是数据，原样显示。
 * 英文比中文长，按钮行一律允许换行（`flex-wrap`），说明文字不截断。
 */

import { CURRENCIES, type BillImportCandidate, type BillImportPreview } from "@libellum/shared";
import type { ReactNode, SelectHTMLAttributes } from "react";
import { Trans } from "react-i18next";

import { Button } from "../Button.js";
import { useI18n } from "../../i18n/index.js";
import { currencyName } from "../../lib/format.js";
import { displayCategoryName, displayPaymentMethodName } from "../../lib/presetNames.js";
import {
  BILL_IMPORT_FILTERS,
  BILL_ROW_STATUS_CLASSES,
  billDirectionLabel,
  billFilterLabel,
  billLocationText,
  billRowStatusLabel,
  billSourceRefText,
  billTagsText,
  billTimeText,
  formatBillFileSize,
  parseBillTags,
  type BillDuplicateGroup,
  type BillFilterCounts,
  type BillHistoryDuplicate,
  type BillImportFilter,
  type BillReportView,
  type BillRowStatus,
} from "../../lib/billImportUi.js";

const MAX_BAR_BLOCKERS = 5;

/**
 * 带字段形状的下拉框。
 *
 * ⚠️ 单独包一层，而不是每处写 `className={fieldClass}`：`uiConsistency.test.ts` 检查的是
 * `<select>` 起始标签里**字面出现** `rounded-field`，用变量拼会被判成裸 select——
 * 而裸 select 会画出浏览器默认的方角/边框/字号，是另一个软件的控制件。
 */
function BillSelect({
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { readonly children: ReactNode }): React.JSX.Element {
  return (
    <select
      {...props}
      className="min-h-11 w-full rounded-field border border-line bg-surface px-3 text-base text-ink outline-none focus-visible:ring-4 focus-visible:ring-focus-ring"
    >
      {children}
    </select>
  );
}

// ---------------------------------------------------------------------------
// 选文件
// ---------------------------------------------------------------------------

/**
 * 未选文件时的入口卡片。
 *
 * ⚠️ 真正的 `<input type="file">` 在页面里（`sr-only`，绝不 `hidden`——iOS 会忽略对
 * 未渲染 input 的程序化 click），本组件只有触发按钮。桌面拖拽是**增强**，不是唯一入口。
 */
export function BillPickCard({
  busy,
  disabled,
  dragging,
  onPick,
  onDragOver,
  onDragLeave,
  onDrop,
  template,
}: {
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly dragging: boolean;
  readonly onPick: () => void;
  readonly onDragOver: (event: React.DragEvent<HTMLElement>) => void;
  readonly onDragLeave: () => void;
  readonly onDrop: (event: React.DragEvent<HTMLElement>) => void;
  /** 模板下载入口；`null` 表示不显示（例如账本信息还没读到）。 */
  readonly template: { readonly busy: boolean; readonly onDownload: () => void } | null;
}): React.JSX.Element {
  const { t } = useI18n();

  return (
    <section className="flex flex-col gap-3">
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`rounded-card border-2 border-dashed px-4 py-6 transition ${
          dragging ? "border-brand bg-brand-soft" : "border-line bg-surface"
        }`}
      >
        <button
          type="button"
          disabled={busy || disabled}
          onClick={onPick}
          className="flex min-h-11 w-full flex-col items-center justify-center gap-2 text-center disabled:cursor-not-allowed disabled:opacity-45"
        >
          <UploadIcon />
          <span className="text-body text-ink">{busy ? t("dataio.pick.recognizing") : t("dataio.pick.choose")}</span>
          <span className="text-helper text-muted">{t("dataio.pick.formats")}</span>
          <span className="text-helper text-muted">{t("dataio.pick.limit")}</span>
        </button>
      </div>

      <details className="rounded-field bg-canvas px-4 py-3 text-helper-relaxed text-muted">
        <summary className="w-fit cursor-pointer select-none font-medium text-ink">
          {t("dataio.pick.howTitle")}
        </summary>
        <ul className="mt-2 flex flex-col gap-1">
          <li>{t("dataio.pick.howFormat")}</li>
          <li>{t("dataio.pick.howDuplicates")}</li>
          <li>{t("dataio.pick.howIdentity")}</li>
          <li>{t("dataio.pick.howLocal")}</li>
        </ul>
      </details>

      {template === null ? null : (
        <p className="text-helper-relaxed text-muted">
          {/* 按钮在句子中间：整句交给 `<Trans>`，英文语序由文案决定，不拆成前后两段。 */}
          <Trans
            i18nKey="dataio.pick.template"
            values={{ label: template.busy ? t("dataio.pick.templateGenerating") : t("dataio.pick.templateDownload") }}
            components={{
              btn: (
                <button
                  type="button"
                  disabled={template.busy}
                  onClick={template.onDownload}
                  className="mx-1 min-h-11 rounded-field px-1 text-link text-brand-dark underline-offset-2 hover:underline disabled:opacity-45"
                />
              ),
            }}
          />
        </p>
      )}
    </section>
  );
}

/** 已选文件的摘要卡：文件名、大小、格式、识别出的来源，以及更换/清除。 */
export function BillFileSummary({
  fileName,
  fileSize,
  formatLabel,
  sourceLabel,
  busy,
  onChange,
  onClear,
}: {
  readonly fileName: string;
  readonly fileSize: number;
  readonly formatLabel: string | null;
  readonly sourceLabel: string | null;
  readonly busy: boolean;
  readonly onChange: () => void;
  readonly onClear: () => void;
}): React.JSX.Element {
  const { t } = useI18n();

  return (
    <section
      aria-label={t("dataio.fileSummary.aria")}
      className="flex flex-col gap-2 rounded-card border border-line bg-surface px-4 py-3 shadow-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          {/* ⚠️ `min-w-0` + `truncate`：长文件名不能把卡片撑出屏幕。 */}
          <p className="truncate text-body font-medium text-ink">{fileName}</p>
          <p className="text-helper text-muted">
            {formatBillFileSize(fileSize)}
            {formatLabel === null ? "" : ` · ${formatLabel}`}
            {sourceLabel === null ? "" : ` · ${t("dataio.fileSummary.recognizedAs", { source: sourceLabel })}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            disabled={busy}
            onClick={onChange}
            className="min-h-11 rounded-field px-2 py-1 text-link text-brand-dark underline-offset-2 hover:underline disabled:opacity-45"
          >
            {t("dataio.fileSummary.change")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onClear}
            className="min-h-11 rounded-field px-2 py-1 text-link text-muted underline-offset-2 hover:underline disabled:opacity-45"
          >
            {t("dataio.fileSummary.clear")}
          </button>
        </div>
      </div>
    </section>
  );
}

/** 文件已选中、但还没拿到预览时的等待态（解析可能几十秒）。 */
export function BillParsingCard({
  fileName,
  fileSize,
}: {
  readonly fileName: string;
  readonly fileSize: number;
}): React.JSX.Element {
  const { t } = useI18n();

  return (
    <section
      aria-label={t("dataio.parsing.aria")}
      className="flex flex-col gap-2 rounded-card border border-line bg-surface px-4 py-6 text-center shadow-card"
    >
      <p className="text-body text-ink">{t("dataio.parsing.title")}</p>
      <p className="truncate text-helper text-muted">
        {fileName} · {formatBillFileSize(fileSize)}
      </p>
      <p className="text-helper text-muted">{t("dataio.parsing.hint")}</p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 概览
// ---------------------------------------------------------------------------

/** 顶部汇总：读到 / 待核对 / 疑似重复 / 可导入 / 身份重复已跳过。 */
export function BillSummaryPanel({
  counts,
  selectedCount,
  readCount,
  identitySkipped,
}: {
  readonly counts: BillFilterCounts;
  readonly selectedCount: number;
  readonly readCount: number;
  readonly identitySkipped: number;
}): React.JSX.Element {
  const { t } = useI18n();

  return (
    <section
      aria-label={t("dataio.summary.aria")}
      className="rounded-card border border-line bg-surface px-4 py-3 shadow-card"
    >
      <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <SummaryInline label={t("dataio.summary.read")} value={readCount} />
        <SummaryInline
          label={t("dataio.summary.review")}
          value={counts.review}
          tone={counts.review > 0 ? "warning" : "default"}
        />
        <SummaryInline
          label={t("dataio.summary.duplicate")}
          value={counts.duplicate}
          tone={counts.duplicate > 0 ? "warning" : "default"}
        />
        <SummaryInline label={t("dataio.summary.importable")} value={counts.selected} tone="brand" />
        {identitySkipped === 0 ? null : (
          <SummaryInline label={t("dataio.summary.identity")} value={identitySkipped} tone="default" />
        )}
      </dl>

      <details className="mt-1.5">
        <summary className="w-fit min-h-11 cursor-pointer select-none text-helper text-muted">
          {t("dataio.summary.explainTitle")}
        </summary>
        <ul className="mt-1 flex flex-col gap-1 text-helper text-muted">
          <li>{t("dataio.summary.explainRead")}</li>
          <li>{t("dataio.summary.explainOverlap")}</li>
          <li>{t("dataio.summary.explainImportable")}</li>
          <li>{t("dataio.summary.explainPending")}</li>
        </ul>
      </details>

      <p className="mt-1 text-helper text-muted">{t("dataio.summary.selected", { count: selectedCount })}</p>
    </section>
  );
}

/** 状态筛选胶囊，与 OCR 概览同一套交互（`aria-pressed`，不靠颜色单独表意）。 */
export function BillFilterRow({
  filter,
  counts,
  onSelect,
}: {
  readonly filter: BillImportFilter;
  readonly counts: BillFilterCounts;
  readonly onSelect: (filter: BillImportFilter) => void;
}): React.JSX.Element {
  const { t } = useI18n();

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("dataio.filter.aria")}>
      {BILL_IMPORT_FILTERS.map((entry) => {
        const active = entry.id === filter;
        return (
          <button
            key={entry.id}
            type="button"
            aria-pressed={active}
            onClick={() => {
              onSelect(entry.id);
            }}
            className={`min-h-11 rounded-full border px-3 py-1.5 text-helper transition ${
              active ? "border-brand bg-brand-soft text-brand-dark" : "border-line bg-surface text-muted"
            }`}
          >
            {billFilterLabel(entry.id)} {String(counts[entry.id])}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 逐笔卡片
// ---------------------------------------------------------------------------

/**
 * 一笔交易。默认收起；只有用户点「查看详情」才展开编辑区——**没有问题的笔不需要弹窗**。
 *
 * ⚠️ 身份重复（`identityDuplicate`）的勾选框永久禁用且不勾选：它由服务端判定为“来源已存在”，
 * 前端连提交机会都不给，避免重复写入。
 */
export function BillRowCard({
  item,
  status,
  notes,
  moneyText,
  categoryName,
  paymentName,
  expanded,
  busy,
  categories,
  paymentMethods,
  onToggle,
  onExpand,
  onPatch,
}: {
  readonly item: BillImportCandidate;
  readonly status: BillRowStatus;
  readonly notes: readonly string[];
  readonly moneyText: string;
  readonly categoryName: string | null;
  readonly paymentName: string | null;
  readonly expanded: boolean;
  readonly busy: boolean;
  readonly categories: readonly { readonly id: string; readonly name: string }[];
  readonly paymentMethods: readonly { readonly id: string; readonly name: string }[];
  readonly onToggle: (selected: boolean) => void;
  readonly onExpand: () => void;
  readonly onPatch: (patch: Partial<BillImportCandidate>) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const location = billLocationText(item);
  const sourceRef = billSourceRefText(item);
  const checked = item.selected && !item.identityDuplicate;

  return (
    <article
      className={`flex items-start gap-3 rounded-card border border-line bg-surface px-4 py-3 shadow-card ${
        item.identityDuplicate ? "opacity-70" : ""
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={item.identityDuplicate || busy}
        onChange={(event) => {
          onToggle(event.target.checked);
        }}
        aria-label={t("dataio.row.toggleAria", { location, amount: moneyText })}
        className="mt-1.5 size-5 shrink-0 accent-brand disabled:opacity-45"
      />

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span className="flex flex-wrap gap-1.5">
            <span className={`rounded-full px-2.5 py-1 text-helper ${BILL_ROW_STATUS_CLASSES[status]}`}>
              {billRowStatusLabel(status)}
            </span>
            <span className="rounded-full bg-canvas px-2.5 py-1 text-helper text-muted">
              {billDirectionLabel(item.kind)}
            </span>
          </span>
          <span className="min-w-0 text-helper text-muted">
            {location} · {billTimeText(item)}
          </span>
        </div>

        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-section-title text-ink">{moneyText}</span>
          <span className="text-helper text-muted">{item.currency}</span>
        </p>

        <p className="truncate text-body text-ink">
          {item.merchant.trim() === "" ? t("dataio.row.merchantUnknown") : item.merchant}
        </p>

        {/* 分类 / 支付方式只在显示时翻译预置名；勾选与提交仍用 id。 */}
        <p className="text-helper text-muted [overflow-wrap:anywhere]">
          {t("dataio.row.categoryAndPayment", {
            category: categoryName === null ? t("dataio.row.uncategorized") : displayCategoryName(categoryName),
            payment: paymentName === null ? t("dataio.row.paymentNone") : displayPaymentMethodName(paymentName),
          })}
          {item.tags.length === 0 ? "" : ` · ${t("dataio.row.tags", { tags: billTagsText(item.tags) })}`}
        </p>

        {sourceRef === null ? null : (
          <p className="truncate text-helper text-muted">
            <Trans
              i18nKey="dataio.row.sourceRef"
              values={{ ref: sourceRef }}
              components={{ mono: <span className="font-mono" /> }}
            />
            {item.sourceStatus.trim() === "" ? "" : ` · ${item.sourceStatus}`}
          </p>
        )}

        {item.note.trim() === "" ? null : (
          <p className="truncate text-helper text-muted">{t("dataio.row.note", { note: item.note })}</p>
        )}

        {notes.length === 0 ? null : (
          <ul className="flex flex-col gap-1">
            {notes.map((note) => (
              <li key={note} className="text-helper-relaxed text-warn-dark">
                ⚠ {note}
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          aria-expanded={expanded}
          onClick={onExpand}
          className="w-fit min-h-11 rounded-field px-1 py-1 text-link text-brand-dark underline-offset-2 hover:underline"
        >
          {expanded ? t("dataio.row.collapse") : t("dataio.row.expand")}
        </button>

        {expanded ? (
          <BillRowEditor
            item={item}
            categories={categories}
            paymentMethods={paymentMethods}
            busy={busy}
            onPatch={onPatch}
          />
        ) : null}
      </div>
    </article>
  );
}

/**
 * 允许编辑的字段。
 *
 * 契约里可提交的整行字段都能改（金额/币种/方向/日期/时间/时区/分类/支付方式/备注/标签），
 * 改完立刻按本地规则校验；`recheckBill` 由页面在「重新检查」时调用，用于重算疑似重复。
 */
function BillRowEditor({
  item,
  categories,
  paymentMethods,
  busy,
  onPatch,
}: {
  readonly item: BillImportCandidate;
  readonly categories: readonly { readonly id: string; readonly name: string }[];
  readonly paymentMethods: readonly { readonly id: string; readonly name: string }[];
  readonly busy: boolean;
  readonly onPatch: (patch: Partial<BillImportCandidate>) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const fieldClass =
    "min-h-11 w-full rounded-field border border-line bg-surface px-3 text-base text-ink outline-none focus-visible:ring-4 focus-visible:ring-focus-ring";

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <label className="flex flex-col gap-1">
        <span className="text-helper text-muted">{t("dataio.editor.amountWithCurrency", { currency: item.currency })}</span>
        <input
          type="text"
          inputMode="decimal"
          value={item.amount}
          disabled={busy}
          aria-label={t("dataio.editor.amount")}
          onChange={(event) => {
            onPatch({ amount: event.target.value });
          }}
          className={fieldClass}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-helper text-muted">{t("dataio.editor.currency")}</span>
        <BillSelect
          value={item.currency}
          disabled={busy}
          aria-label={t("dataio.editor.currency")}
          onChange={(event) => {
            onPatch({ currency: event.target.value });
          }}
        >
          {CURRENCIES.map((code) => (
            <option key={code} value={code}>
              {code} {currencyName(code)}
            </option>
          ))}
        </BillSelect>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-helper text-muted">{t("dataio.editor.direction")}</span>
        <BillSelect
          value={item.kind}
          disabled={busy}
          aria-label={t("dataio.editor.direction")}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "income" || value === "expense" || value === "unknown") onPatch({ kind: value });
          }}
        >
          <option value="expense">{billDirectionLabel("expense")}</option>
          <option value="income">{billDirectionLabel("income")}</option>
          <option value="unknown">{billDirectionLabel("unknown")}</option>
        </BillSelect>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-helper text-muted">{t("dataio.editor.date")}</span>
        <input
          type="date"
          value={item.date}
          disabled={busy}
          aria-label={t("dataio.editor.date")}
          onChange={(event) => {
            onPatch({ date: event.target.value });
          }}
          className={fieldClass}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-helper text-muted">{t("dataio.editor.time")}</span>
        <input
          type="time"
          step="1"
          value={item.time ?? ""}
          disabled={busy}
          aria-label={t("dataio.editor.time")}
          onChange={(event) => {
            const value = event.target.value;
            onPatch({ time: value === "" ? null : value });
          }}
          className={fieldClass}
        />
        <span className="text-helper text-muted">
          {item.time === null ? t("dataio.editor.timeHintEmpty") : t("dataio.editor.timeHint")}
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-helper text-muted">{t("dataio.editor.timezone")}</span>
        <input
          type="text"
          value={item.timezone}
          disabled={busy}
          aria-label={t("dataio.editor.timezone")}
          onChange={(event) => {
            onPatch({ timezone: event.target.value });
          }}
          className={fieldClass}
        />
        <span className="text-helper text-muted">{t("dataio.editor.timezoneHint")}</span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-helper text-muted">{t("dataio.editor.category")}</span>
        <BillSelect
          value={item.categoryId ?? ""}
          disabled={busy}
          aria-label={t("dataio.editor.category")}
          onChange={(event) => {
            onPatch({ categoryId: event.target.value === "" ? null : event.target.value });
          }}
        >
          <option value="">{t("dataio.row.uncategorized")}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {displayCategoryName(category.name)}
            </option>
          ))}
        </BillSelect>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-helper text-muted">{t("dataio.editor.paymentMethod")}</span>
        <BillSelect
          value={item.paymentMethodId ?? ""}
          disabled={busy}
          aria-label={t("dataio.editor.paymentMethod")}
          onChange={(event) => {
            onPatch({ paymentMethodId: event.target.value === "" ? null : event.target.value });
          }}
        >
          <option value="">{t("dataio.row.paymentNone")}</option>
          {paymentMethods.map((method) => (
            <option key={method.id} value={method.id}>
              {displayPaymentMethodName(method.name)}
            </option>
          ))}
        </BillSelect>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-helper text-muted">{t("dataio.editor.note")}</span>
        <textarea
          rows={2}
          value={item.note}
          disabled={busy}
          aria-label={t("dataio.editor.note")}
          maxLength={2000}
          onChange={(event) => {
            onPatch({ note: event.target.value });
          }}
          className={`${fieldClass} py-2`}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-helper text-muted">{t("dataio.editor.tags")}</span>
        <input
          type="text"
          value={billTagsText(item.tags)}
          disabled={busy}
          aria-label={t("dataio.editor.tags")}
          onChange={(event) => {
            onPatch({ tags: parseBillTags(event.target.value) });
          }}
          className={fieldClass}
        />
        <span className="text-helper text-muted">{t("dataio.editor.tagsHint")}</span>
      </label>
    </div>
  );
}

/** 编辑器里即时解析标签（与 `parseBillTags` 同一规则，避免页面/组件各写一套拆分）。 */
// ---------------------------------------------------------------------------
// 疑似重复分组
// ---------------------------------------------------------------------------

/**
 * 疑似重复：文件内部（可以并排对比）与已有账目（只有编号，不能对比内容）。
 *
 * ⚠️ 这里的按钮只改「保留/跳过」，**绝不删除、不合并、不自动取消已有勾选**。
 */
export function BillDuplicateSection({
  groups,
  history,
  itemsById,
  moneyText,
  busy,
  onToggle,
}: {
  readonly groups: readonly BillDuplicateGroup[];
  readonly history: readonly BillHistoryDuplicate[];
  readonly itemsById: ReadonlyMap<string, BillImportCandidate>;
  readonly moneyText: (item: BillImportCandidate) => string;
  readonly busy: boolean;
  readonly onToggle: (id: string, selected: boolean) => void;
}): React.JSX.Element | null {
  const { t } = useI18n();

  if (groups.length === 0 && history.length === 0) return null;

  return (
    <section aria-label={t("dataio.duplicates.aria")} className="flex flex-col gap-3">
      <h2 className="text-helper text-muted">{t("dataio.duplicates.title")}</h2>

      {groups.map((group, index) => (
        <div
          key={group.groupId}
          className="flex flex-col gap-2 rounded-card border border-warn-soft bg-surface px-4 py-3 shadow-card"
        >
          <p className="text-body font-medium text-ink">
            {t("dataio.duplicates.groupTitle", { index: index + 1, count: group.ids.length })}
          </p>
          <p className="text-helper-relaxed text-muted">
            {t("dataio.duplicates.groupHint", { reason: group.reason })}
          </p>
          <ul className="flex flex-col gap-2">
            {group.ids.map((id) => {
              const item = itemsById.get(id);
              if (item === undefined) return null;
              const checked = item.selected && !item.identityDuplicate;
              return (
                <li
                  key={id}
                  className="flex items-start gap-2 rounded-field bg-canvas px-3 py-2"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={item.identityDuplicate || busy}
                    onChange={(event) => {
                      onToggle(id, event.target.checked);
                    }}
                    aria-label={t("dataio.duplicates.keepAria", { location: billLocationText(item) })}
                    className="mt-0.5 size-5 shrink-0 accent-brand"
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-helper text-ink">
                      {billLocationText(item)} · {billTimeText(item)}
                    </span>
                    <span className="text-body text-ink">
                      {moneyText(item)} <span className="text-helper text-muted">{item.currency}</span> ·{" "}
                      {billDirectionLabel(item.kind)}
                    </span>
                    <span className="truncate text-helper text-muted">
                      {item.merchant.trim() === "" ? t("dataio.row.merchantUnknown") : item.merchant}
                      {billSourceRefText(item) === null
                        ? ""
                        : ` · ${t("dataio.duplicates.ref", { ref: billSourceRefText(item) ?? "" })}`}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {history.length === 0 ? null : (
        <div className="flex flex-col gap-2 rounded-card border border-line bg-surface px-4 py-3 shadow-card">
          <p className="text-body font-medium text-ink">{t("dataio.duplicates.historyTitle")}</p>
          <p className="text-helper-relaxed text-muted">{t("dataio.duplicates.historyHint")}</p>
          <ul className="flex flex-col gap-2">
            {history.map((entry) => {
              const item = itemsById.get(entry.candidateId);
              if (item === undefined) return null;
              const checked = item.selected && !item.identityDuplicate;
              return (
                <li key={entry.candidateId} className="flex items-start gap-2 rounded-field bg-canvas px-3 py-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={busy}
                    onChange={(event) => {
                      onToggle(entry.candidateId, event.target.checked);
                    }}
                    aria-label={t("dataio.duplicates.keepAria", { location: billLocationText(item) })}
                    className="mt-0.5 size-5 shrink-0 accent-brand"
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-helper text-ink">
                      {billLocationText(item)} · {billTimeText(item)} ·{" "}
                      <Trans
                        i18nKey="dataio.duplicates.existingIds"
                        values={{ ids: entry.ids.join(t("dataio.common.listSeparator")) }}
                        components={{ mono: <span className="font-mono" /> }}
                      />
                    </span>
                    <span className="text-body text-ink">
                      {moneyText(item)} <span className="text-helper text-muted">{item.currency}</span> ·{" "}
                      {billDirectionLabel(item.kind)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 底部确认条
// ---------------------------------------------------------------------------

/**
 * 固定底部的统一确认条：可导入数量 + 确认 + 取消 + 重新检查。
 *
 * ⚠️ 安全区在这里处理（`pb-[env(safe-area-inset-bottom)]`）；页面在列表末尾留出等高空白，
 * 最后一笔不会被这条 bar 盖住。
 */
export function BillCommitBar({
  importableCount,
  selectedCount,
  blockers,
  needsAcknowledgement,
  acknowledged,
  busy,
  dirty,
  rechecking,
  onAcknowledge,
  onConfirm,
  onCancel,
  onRecheck,
}: {
  readonly importableCount: number;
  readonly selectedCount: number;
  readonly blockers: readonly string[];
  readonly needsAcknowledgement: boolean;
  readonly acknowledged: boolean;
  readonly busy: boolean;
  /** 有编辑但还没重新检查判重。 */
  readonly dirty: boolean;
  readonly rechecking: boolean;
  readonly onAcknowledge: (acknowledged: boolean) => void;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly onRecheck: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const disabled = importableCount === 0 || blockers.length > 0 || busy || dirty;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom,0px)] shadow-card">
      <div className="mx-auto w-full max-w-md px-6 pt-2.5 pb-3">
        {/* ⚠️ 英文的按钮文字更长：窄屏允许数量说明与按钮分两行，不挤压、不溢出。 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="mr-auto min-w-0 text-helper-relaxed text-ink">
            <Trans
              i18nKey="dataio.commit.importable"
              count={importableCount}
              values={{ count: importableCount }}
              components={{ b: <strong className="font-semibold" /> }}
            />
            <span className="text-muted">{t("dataio.commit.selected", { count: selectedCount })}</span>
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={onConfirm}
            className="min-h-11 rounded-field bg-brand px-4 py-2.5 text-button-lg font-medium text-on-brand shadow-sm transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-45"
          >
            {busy ? t("dataio.commit.importing") : t("dataio.commit.confirm", { count: importableCount })}
          </button>
        </div>

        {needsAcknowledgement ? (
          <label className="mt-1 flex min-h-11 items-center gap-2 text-helper-relaxed text-ink">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => {
                onAcknowledge(event.target.checked);
              }}
              className="size-5 shrink-0 accent-brand"
            />
            {t("dataio.commit.acknowledge")}
          </label>
        ) : null}

        <div className="mt-1 flex flex-wrap items-start justify-between gap-2">
          <p className={`min-w-0 text-helper ${blockers.length === 0 ? "text-muted" : "text-warn-dark"}`}>
            {dirty ? t("dataio.commit.dirty") : (blockers[0] ?? t("dataio.commit.safe"))}
          </p>
          <span className="flex max-w-full shrink-0 flex-wrap items-center gap-x-3">
            {dirty ? (
              <button
                type="button"
                disabled={busy || rechecking}
                onClick={onRecheck}
                className="min-h-11 text-helper text-brand-dark underline-offset-2 hover:underline disabled:opacity-45"
              >
                {rechecking ? t("dataio.commit.rechecking") : t("dataio.commit.recheck")}
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="min-h-11 text-helper text-muted underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-45"
            >
              {t("dataio.commit.cancel")}
            </button>
          </span>
        </div>

        {blockers.length > 1 ? (
          <details className="mt-1">
            <summary className="w-fit min-h-11 cursor-pointer select-none text-helper text-warn-dark">
              {t("dataio.commit.moreReasons", { count: blockers.length - 1 })}
            </summary>
            <ul className="mt-1 flex flex-col gap-1">
              {blockers.slice(1, MAX_BAR_BLOCKERS + 1).map((blocker) => (
                <li key={blocker} className="text-helper text-warn-dark">
                  · {blocker}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 结果
// ---------------------------------------------------------------------------

/**
 * 完成页：读到/选中/导入/跳过/失败，失败定位到行或 PDF 页，导入编号可追溯。
 *
 * 三态与 OCR 的 `ImportDoneView` 一致：全部成功 / 部分成功 / 全部失败。
 */
export function BillDoneView({
  view,
  fileRef,
  exportedFileRef,
  targetLabel,
  doneLabel,
  busy,
  onDone,
  onAgain,
  onRetry,
}: {
  readonly view: BillReportView;
  readonly fileRef: string | null;
  readonly exportedFileRef: string | null;
  readonly targetLabel: string | null;
  readonly doneLabel: string;
  readonly busy: boolean;
  readonly onDone: () => void;
  readonly onAgain: () => void;
  readonly onRetry: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const heading =
    view.status === "success"
      ? t("dataio.done.success")
      : view.status === "partial"
        ? t("dataio.done.partial")
        : t("dataio.done.failed");
  const subtitle =
    view.status === "success"
      ? t("dataio.done.successHint")
      : view.status === "partial"
        ? t("dataio.done.partialHint")
        : t("dataio.done.failedHint");
  const entries = (count: number): string => t("common.count.entries", { count });

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col items-center gap-2 py-2 text-center">
        <StatusMark status={view.status} />
        <h2 className="text-lg font-semibold text-ink">{heading}</h2>
        <p className={`w-full text-body-relaxed ${view.status === "success" ? "text-muted" : view.status === "partial" ? "text-warn-dark" : "text-danger"}`}>
          {subtitle}
        </p>
        {targetLabel === null ? null : (
          <p className="text-helper text-muted">{t("dataio.done.target", { target: targetLabel })}</p>
        )}
      </header>

      <dl className="overflow-hidden rounded-field border border-line bg-surface">
        <DoneRow label={t("dataio.done.read")} value={entries(view.read)} />
        <DoneRow label={t("dataio.done.selected")} value={entries(view.selected)} />
        <DoneRow label={t("dataio.done.imported")} value={entries(view.imported)} />
        <DoneRow label={t("dataio.done.skipped")} value={entries(view.skipped)} />
        <DoneRow
          label={t("dataio.done.failedCount")}
          value={entries(view.failed)}
          tone={view.failed > 0 ? "danger" : "default"}
        />
        {fileRef === null ? null : <DoneRow label={t("dataio.done.fileRef")} value={fileRef} mono />}
        {exportedFileRef === null ? null : (
          <DoneRow label={t("dataio.done.exportedFileRef")} value={exportedFileRef} mono />
        )}
      </dl>

      {view.failures.length === 0 ? null : (
        <section aria-label={t("dataio.done.failuresAria")} className="flex flex-col gap-2">
          <h3 className="text-helper text-muted">{t("dataio.done.failuresTitle")}</h3>
          <ul className="overflow-hidden rounded-field border border-line bg-surface">
            {view.failures.slice(0, 50).map((failure) => (
              <li
                key={`${String(failure.line)}-${failure.where}`}
                className="flex gap-3 border-b border-line px-4 py-3 text-helper-relaxed last:border-b-0"
              >
                <span className="shrink-0 font-mono text-helper text-muted">{failure.where}</span>
                <span className="min-w-0 text-ink">{failure.message}</span>
              </li>
            ))}
          </ul>
          {view.failures.length > 50 ? (
            <p className="text-helper text-muted">
              {t("dataio.done.failuresMore", { count: view.failures.length - 50 })}
            </p>
          ) : null}
        </section>
      )}

      {view.skippedLines.length === 0 ? null : (
        <p className="text-helper-relaxed text-muted">
          {view.skippedLines.length > 20
            ? t("dataio.done.skippedLinesMore", {
                lines: skippedLineList(view.skippedLines, t("dataio.common.listSeparator")),
                count: view.skippedLines.length,
              })
            : t("dataio.done.skippedLines", {
                lines: skippedLineList(view.skippedLines, t("dataio.common.listSeparator")),
              })}{" "}
          {t("dataio.done.skippedExplain")}
        </p>
      )}

      {fileRef === null ? null : (
        <p className="text-helper-relaxed text-muted">{t("dataio.done.fileRefNote")}</p>
      )}

      <Button onClick={onDone} disabled={busy}>
        {doneLabel}
      </Button>
      {view.failed === 0 ? null : (
        <Button variant="secondary" onClick={onRetry} disabled={busy}>
          {busy ? t("dataio.done.retrying") : t("dataio.done.retry")}
        </Button>
      )}
      <Button variant="secondary" onClick={onAgain} disabled={busy}>
        {t("dataio.done.again")}
      </Button>
    </section>
  );
}

/** 跳过的行号：最多列 20 个，`第 3 行、第 7 行` / `Row 3, Row 7`。 */
function skippedLineList(lines: readonly number[], separator: string): string {
  return lines
    .slice(0, 20)
    .map((line) => billLocationText({ line }))
    .join(separator);
}

// ---------------------------------------------------------------------------
// 小部件
// ---------------------------------------------------------------------------

function SummaryInline({
  label,
  value,
  tone = "default",
}: {
  readonly label: string;
  readonly value: number;
  readonly tone?: "default" | "warning" | "brand";
}): React.JSX.Element {
  const toneClass =
    tone === "warning" ? "text-warn-dark" : tone === "brand" ? "text-brand-dark" : "text-ink";
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-helper text-muted">{label}</dt>
      <dd className={`text-body font-semibold tabular-nums ${toneClass}`}>{String(value)}</dd>
    </div>
  );
}

function DoneRow({
  label,
  value,
  mono = false,
  tone = "default",
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
  readonly tone?: "default" | "danger";
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0">
      <dt className="min-w-0 text-body text-muted">{label}</dt>
      {/* 数量（`12 笔` / `12 entries`）不拆行；编号较长时允许在任意处换行，不撑出屏幕。 */}
      <dd
        className={`text-right text-body tabular-nums ${mono ? "min-w-0 font-mono text-helper [overflow-wrap:anywhere]" : "shrink-0"} ${
          tone === "danger" ? "text-danger" : "text-ink"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function StatusMark({ status }: { readonly status: "success" | "partial" | "failed" }): React.JSX.Element {
  const classes =
    status === "success"
      ? "bg-brand-soft text-brand-dark"
      : status === "partial"
        ? "bg-warn-soft text-warn-dark"
        : "bg-danger-soft text-danger";
  return (
    <span
      aria-hidden="true"
      className={`flex size-12 items-center justify-center rounded-full text-xl ${classes}`}
    >
      {status === "success" ? "✓" : status === "partial" ? "!" : "×"}
    </span>
  );
}

function UploadIcon(): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-8 text-muted"
    >
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}

/** 供测试/页面复用：把预览里的候选整理成 `id → 候选`。 */
export function billItemsById(
  preview: Pick<BillImportPreview, "candidates">,
): Map<string, BillImportCandidate> {
  return new Map(preview.candidates.map((item) => [item.id, item]));
}
