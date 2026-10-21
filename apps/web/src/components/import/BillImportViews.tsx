/**
 * 账单导入 V2 的展示组件：**纯展示，不取数、不写 storage**。
 *
 * 页面（`pages/ImportPage.tsx`）负责请求、状态和提交；这些组件只接收数据与回调。
 * 这样它们可以用 `renderToStaticMarkup` 在纯 Node 测试里验证（本仓库没有 DOM 测试环境），
 * 页面本身则用纯函数测试 + 源码契约测试覆盖。
 *
 * 视觉语言沿用 OCR 概览/语音/拍照页：`rounded-card` 卡片、`text-section-title` 金额、
 * `min-h-11` 触控目标、`text-helper` 辅助文字、`warn-*` 提醒色。
 */

import { CURRENCIES, type BillImportCandidate, type BillImportPreview } from "@libellum/shared";
import type { ReactNode, SelectHTMLAttributes } from "react";

import { Button } from "../Button.js";
import { currencyName } from "../../lib/format.js";
import {
  BILL_IMPORT_FILTERS,
  BILL_ROW_STATUS_CLASSES,
  BILL_ROW_STATUS_LABELS,
  billDirectionLabel,
  billLocationText,
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
      className="min-h-11 w-full rounded-field border border-line bg-surface px-3 text-base text-ink outline-none focus-visible:ring-4 focus-visible:ring-brand-soft"
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
          <span className="text-body text-ink">{busy ? "正在识别…" : "选择账单文件"}</span>
          <span className="text-helper text-muted">微信 XLSX · 支付宝 CSV · 银行 PDF · Libevra CSV</span>
          <span className="text-helper text-muted">单个文件最大 10 MB；电脑上也可以把文件拖进来</span>
        </button>
      </div>

      <details className="rounded-field bg-canvas px-4 py-3 text-helper-relaxed text-muted">
        <summary className="w-fit cursor-pointer select-none font-medium text-ink">
          识别和判重是怎么做的
        </summary>
        <ul className="mt-2 flex flex-col gap-1">
          <li>格式按文件内容识别，不看文件名：同一份账单换了名字也能认出来。</li>
          <li>
            文件内部重复、以及和账本里已有账目的重复，都用同一套规则判定；只提示，不自动删除，
            也不会取消你已有的勾选。
          </li>
          <li>
            之前导入过的同一份来源会标成「来源已存在」并跳过，所以同一个文件再导一次不会多出账目。
          </li>
          <li>全部在本机处理，不上传第三方服务。</li>
        </ul>
      </details>

      {template === null ? null : (
        <p className="text-helper-relaxed text-muted">
          想从零开始整理？可以
          <button
            type="button"
            disabled={template.busy}
            onClick={template.onDownload}
            className="mx-1 min-h-11 rounded-field px-1 text-link text-brand-dark underline-offset-2 hover:underline disabled:opacity-45"
          >
            {template.busy ? "正在生成模板…" : "下载 Libevra CSV 模板"}
          </button>
          照着表头填。
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
  return (
    <section
      aria-label="已选文件"
      className="flex flex-col gap-2 rounded-card border border-line bg-surface px-4 py-3 shadow-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          {/* ⚠️ `min-w-0` + `truncate`：长文件名不能把卡片撑出屏幕。 */}
          <p className="truncate text-body font-medium text-ink">{fileName}</p>
          <p className="text-helper text-muted">
            {formatBillFileSize(fileSize)}
            {formatLabel === null ? "" : ` · ${formatLabel}`}
            {sourceLabel === null ? "" : ` · 识别为 ${sourceLabel}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            disabled={busy}
            onClick={onChange}
            className="min-h-11 rounded-field px-2 py-1 text-link text-brand-dark underline-offset-2 hover:underline disabled:opacity-45"
          >
            更换
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onClear}
            className="min-h-11 rounded-field px-2 py-1 text-link text-muted underline-offset-2 hover:underline disabled:opacity-45"
          >
            清除
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
  return (
    <section
      aria-label="正在识别"
      className="flex flex-col gap-2 rounded-card border border-line bg-surface px-4 py-6 text-center shadow-card"
    >
      <p className="text-body text-ink">正在识别账单…</p>
      <p className="truncate text-helper text-muted">
        {fileName} · {formatBillFileSize(fileSize)}
      </p>
      <p className="text-helper text-muted">逐行读取并做判重，大文件可能需要几十秒，不要关闭页面。</p>
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
  return (
    <section
      aria-label="账单概览汇总"
      className="rounded-card border border-line bg-surface px-4 py-3 shadow-card"
    >
      <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <SummaryInline label="本次读到" value={readCount} />
        <SummaryInline label="待核对" value={counts.review} tone={counts.review > 0 ? "warning" : "default"} />
        <SummaryInline
          label="疑似重复"
          value={counts.duplicate}
          tone={counts.duplicate > 0 ? "warning" : "default"}
        />
        <SummaryInline label="可导入" value={counts.selected} tone="brand" />
        {identitySkipped === 0 ? null : (
          <SummaryInline label="来源已存在" value={identitySkipped} tone="default" />
        )}
      </dl>

      <details className="mt-1.5">
        <summary className="w-fit min-h-11 cursor-pointer select-none text-helper text-muted">
          数字是怎么算的
        </summary>
        <ul className="mt-1 flex flex-col gap-1 text-helper text-muted">
          <li>「本次读到」是文件里被识别出的交易笔数，不是行数。</li>
          <li>
            「待核对」= 有提醒或字段不完整的笔数；「疑似重复」= 被判重规则标记的笔数，两者可能重叠。
          </li>
          <li>
            「可导入」只算已勾选、且不是「来源已存在」的笔数；勾选状态改变时它会立刻变，而上面的
            「待核对/疑似重复」不会。
          </li>
          <li>全部数字都还没有写入账本，确认导入之后才会写。</li>
        </ul>
      </details>

      <p className="mt-1 text-helper text-muted">已勾选 {selectedCount} 笔。</p>
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
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="按状态筛选">
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
            {entry.label} {String(counts[entry.id])}
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
        aria-label={`导入 ${location}：${moneyText}`}
        className="mt-1.5 size-5 shrink-0 accent-brand disabled:opacity-45"
      />

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span className="flex flex-wrap gap-1.5">
            <span className={`rounded-full px-2.5 py-1 text-helper ${BILL_ROW_STATUS_CLASSES[status]}`}>
              {BILL_ROW_STATUS_LABELS[status]}
            </span>
            <span className="rounded-full bg-canvas px-2.5 py-1 text-helper text-muted">
              {billDirectionLabel(item.kind)}
            </span>
          </span>
          <span className="text-helper text-muted">
            {location} · {billTimeText(item)}
          </span>
        </div>

        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-section-title text-ink">{moneyText}</span>
          <span className="text-helper text-muted">{item.currency}</span>
        </p>

        <p className="truncate text-body text-ink">
          {item.merchant.trim() === "" ? "对象/商户待确认" : item.merchant}
        </p>

        <p className="text-helper text-muted">
          分类：{categoryName ?? "未分类"} · 支付方式：{paymentName ?? "未填写"}
          {item.tags.length === 0 ? "" : ` · 标签：${billTagsText(item.tags)}`}
        </p>

        {sourceRef === null ? null : (
          <p className="truncate text-helper text-muted">
            来源单号：<span className="font-mono">{sourceRef}</span>
            {item.sourceStatus.trim() === "" ? "" : ` · ${item.sourceStatus}`}
          </p>
        )}

        {item.note.trim() === "" ? null : (
          <p className="truncate text-helper text-muted">备注：{item.note}</p>
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
          {expanded ? "收起详情" : "查看详情"}
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
  const fieldClass =
    "min-h-11 w-full rounded-field border border-line bg-surface px-3 text-base text-ink outline-none focus-visible:ring-4 focus-visible:ring-brand-soft";

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <label className="flex flex-col gap-1">
        <span className="text-helper text-muted">金额（{item.currency}）</span>
        <input
          type="text"
          inputMode="decimal"
          value={item.amount}
          disabled={busy}
          aria-label="金额"
          onChange={(event) => {
            onPatch({ amount: event.target.value });
          }}
          className={fieldClass}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-helper text-muted">币种</span>
        <BillSelect
          value={item.currency}
          disabled={busy}
          aria-label="币种"
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
        <span className="text-helper text-muted">方向</span>
        <BillSelect
          value={item.kind}
          disabled={busy}
          aria-label="方向"
          onChange={(event) => {
            const value = event.target.value;
            if (value === "income" || value === "expense" || value === "unknown") onPatch({ kind: value });
          }}
        >
          <option value="expense">支出</option>
          <option value="income">收入</option>
          <option value="unknown">方向待确认</option>
        </BillSelect>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-helper text-muted">日期</span>
        <input
          type="date"
          value={item.date}
          disabled={busy}
          aria-label="日期"
          onChange={(event) => {
            onPatch({ date: event.target.value });
          }}
          className={fieldClass}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-helper text-muted">时间</span>
        <input
          type="time"
          step="1"
          value={item.time ?? ""}
          disabled={busy}
          aria-label="时间"
          onChange={(event) => {
            const value = event.target.value;
            onPatch({ time: value === "" ? null : value });
          }}
          className={fieldClass}
        />
        <span className="text-helper text-muted">
          {item.time === null
            ? "留空时按「时间信息不足」入账，不会补一个编造的时分。"
            : "按账单上的当地时间填写；时区在下面单独确认。"}
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-helper text-muted">时区</span>
        <input
          type="text"
          value={item.timezone}
          disabled={busy}
          aria-label="时区"
          onChange={(event) => {
            onPatch({ timezone: event.target.value });
          }}
          className={fieldClass}
        />
        <span className="text-helper text-muted">IANA 名称，例如 Asia/Shanghai、America/New_York。</span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-helper text-muted">分类</span>
        <BillSelect
          value={item.categoryId ?? ""}
          disabled={busy}
          aria-label="分类"
          onChange={(event) => {
            onPatch({ categoryId: event.target.value === "" ? null : event.target.value });
          }}
        >
          <option value="">未分类</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </BillSelect>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-helper text-muted">支付方式</span>
        <BillSelect
          value={item.paymentMethodId ?? ""}
          disabled={busy}
          aria-label="支付方式"
          onChange={(event) => {
            onPatch({ paymentMethodId: event.target.value === "" ? null : event.target.value });
          }}
        >
          <option value="">未填写</option>
          {paymentMethods.map((method) => (
            <option key={method.id} value={method.id}>
              {method.name}
            </option>
          ))}
        </BillSelect>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-helper text-muted">备注</span>
        <textarea
          rows={2}
          value={item.note}
          disabled={busy}
          aria-label="备注"
          maxLength={2000}
          onChange={(event) => {
            onPatch({ note: event.target.value });
          }}
          className={`${fieldClass} py-2`}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-helper text-muted">标签</span>
        <input
          type="text"
          value={billTagsText(item.tags)}
          disabled={busy}
          aria-label="标签"
          onChange={(event) => {
            onPatch({ tags: parseBillTags(event.target.value) });
          }}
          className={fieldClass}
        />
        <span className="text-helper text-muted">空格或逗号分隔，最多 30 个。</span>
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
  if (groups.length === 0 && history.length === 0) return null;

  return (
    <section aria-label="疑似重复" className="flex flex-col gap-3">
      <h2 className="text-helper text-muted">疑似重复，需要你判断</h2>

      {groups.map((group, index) => (
        <div
          key={group.groupId}
          className="flex flex-col gap-2 rounded-card border border-warn-soft bg-surface px-4 py-3 shadow-card"
        >
          <p className="text-body font-medium text-ink">
            同一份文件里的第 {String(index + 1)} 组（{String(group.ids.length)} 笔）
          </p>
          <p className="text-helper-relaxed text-muted">
            {group.reason}。请核对后决定保留哪些；系统不会替你删掉或合并任何一笔。
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
                    aria-label={`保留 ${billLocationText(item)}`}
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
                      {item.merchant.trim() === "" ? "对象/商户待确认" : item.merchant}
                      {billSourceRefText(item) === null ? "" : ` · 单号 ${billSourceRefText(item) ?? ""}`}
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
          <p className="text-body font-medium text-ink">和账本里已有账目相似</p>
          <p className="text-helper-relaxed text-muted">
            这些笔可能是之前已经记过的。已有账目不会被改动，这里只决定这次的笔要不要再写一次。
          </p>
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
                    aria-label={`保留 ${billLocationText(item)}`}
                    className="mt-0.5 size-5 shrink-0 accent-brand"
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-helper text-ink">
                      {billLocationText(item)} · {billTimeText(item)} · 已有账目编号{" "}
                      <span className="font-mono">{entry.ids.join("、")}</span>
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
  const disabled = importableCount === 0 || blockers.length > 0 || busy || dirty;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom,0px)] shadow-card">
      <div className="mx-auto w-full max-w-md px-6 pt-2.5 pb-3">
        <div className="flex items-center gap-3">
          <p className="mr-auto text-helper-relaxed text-ink">
            可导入 <strong className="font-semibold">{String(importableCount)}</strong> 笔
            <span className="text-muted">（已勾选 {String(selectedCount)}）</span>
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={onConfirm}
            className="min-h-11 rounded-field bg-brand px-4 py-2.5 text-button-lg font-medium text-white shadow-sm transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-45"
          >
            {busy ? "正在导入…" : `确认导入 ${String(importableCount)} 笔`}
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
            我已了解上面的提示（对账差异/文件提醒）
          </label>
        ) : null}

        <div className="mt-1 flex flex-wrap items-start justify-between gap-2">
          <p className={`text-helper ${blockers.length === 0 ? "text-muted" : "text-warn-dark"}`}>
            {dirty ? "记录或选择有变化，请先重新检查重复。" : (blockers[0] ?? "确认前不会写入账本。")}
          </p>
          <span className="flex shrink-0 items-center gap-3">
            {dirty ? (
              <button
                type="button"
                disabled={busy || rechecking}
                onClick={onRecheck}
                className="min-h-11 text-helper text-brand-dark underline-offset-2 hover:underline disabled:opacity-45"
              >
                {rechecking ? "正在重新检查…" : "重新检查重复"}
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="min-h-11 text-helper text-muted underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-45"
            >
              取消这次导入
            </button>
          </span>
        </div>

        {blockers.length > 1 ? (
          <details className="mt-1">
            <summary className="w-fit min-h-11 cursor-pointer select-none text-helper text-warn-dark">
              还有 {String(blockers.length - 1)} 条原因
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
  const heading =
    view.status === "success" ? "导入完成" : view.status === "partial" ? "部分导入成功" : "没有导入成功";
  const subtitle =
    view.status === "success"
      ? "所有选中的记录都已写入账本。"
      : view.status === "partial"
        ? "成功的已经写入账本；失败的仍留在这份预览里，可以重试。"
        : "这次没有记录写入账本，预览还留着，可以改好再试。";

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col items-center gap-2 py-2 text-center">
        <StatusMark status={view.status} />
        <h2 className="text-lg font-semibold text-ink">{heading}</h2>
        <p className={`w-full text-body-relaxed ${view.status === "success" ? "text-muted" : view.status === "partial" ? "text-warn-dark" : "text-danger"}`}>
          {subtitle}
        </p>
        {targetLabel === null ? null : (
          <p className="text-helper text-muted">写入「{targetLabel}」</p>
        )}
      </header>

      <dl className="overflow-hidden rounded-field border border-line bg-surface">
        <DoneRow label="本次读到" value={`${String(view.read)} 笔`} />
        <DoneRow label="选中导入" value={`${String(view.selected)} 笔`} />
        <DoneRow label="成功写入" value={`${String(view.imported)} 笔`} />
        <DoneRow label="跳过（已存在）" value={`${String(view.skipped)} 笔`} />
        <DoneRow label="失败" value={`${String(view.failed)} 笔`} tone={view.failed > 0 ? "danger" : "default"} />
        {fileRef === null ? null : <DoneRow label="导入编号" value={fileRef} mono />}
        {exportedFileRef === null ? null : <DoneRow label="来自这次导出" value={exportedFileRef} mono />}
      </dl>

      {view.failures.length === 0 ? null : (
        <section aria-label="失败原因" className="flex flex-col gap-2">
          <h3 className="text-helper text-muted">失败原因（可以按位置回文件里改）</h3>
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
              只显示了前 50 处，还有 {String(view.failures.length - 50)} 处。
            </p>
          ) : null}
        </section>
      )}

      {view.skippedLines.length === 0 ? null : (
        <p className="text-helper-relaxed text-muted">
          跳过的行：{view.skippedLines.slice(0, 20).map((line) => `第 ${String(line)} 行`).join("、")}
          {view.skippedLines.length > 20 ? ` 等 ${String(view.skippedLines.length)} 行` : ""}。
          这些是来源已存在的记录，没有重复写入。
        </p>
      )}

      {fileRef === null ? null : (
        <p className="text-helper-relaxed text-muted">
          导入编号写进了这批每一笔记录里，日后可以据此追溯它们来自哪个文件。
        </p>
      )}

      <Button onClick={onDone} disabled={busy}>
        {doneLabel}
      </Button>
      {view.failed === 0 ? null : (
        <Button variant="secondary" onClick={onRetry} disabled={busy}>
          {busy ? "正在重试…" : "重试失败的记录"}
        </Button>
      )}
      <Button variant="secondary" onClick={onAgain} disabled={busy}>
        再导入一个文件
      </Button>
    </section>
  );
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
      <dt className="text-body text-muted">{label}</dt>
      <dd
        className={`text-body tabular-nums ${mono ? "font-mono text-helper" : ""} ${
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
