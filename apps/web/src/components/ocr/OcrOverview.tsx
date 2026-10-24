/**
 * 批量识别结果的概览（S15-B §3.2/§3.3）。
 *
 * 组件只展示、不编辑、不写账：
 *  - 顶部先给一行数字（识别总数/待核对/疑似重复/可导入），其余口径收进「详情」；
 *  - 主筛选只留状态，来源与方向收进可折叠面板，能力一个都不少；
 *  - 每笔一张横向卡片：状态与日期来源一行，金额/币种/方向一层，分类/支付方式等辅助
 *    信息一层；只有真的有疑问才出现警告；
 *  - 底部固定操作条由页面渲染（`OcrImportBar`），确认仍走页面原有的 import 流程；
 *  - 汇总数字全部由传入的候选计算（`lib/ocr/types.ts`、`lib/ocr/import.ts` 的纯函数），
 *    和列表同一口径；缺失字段显示「待确认」，不伪造默认值；疑似重复只提示，不合并、不删除。
 */

import {
  OCR_CHANNEL_LABELS,
  OCR_DIRECTION_LABELS,
  type Category,
  type OcrChannel,
  type PaymentMethod,
  type Tag,
} from "@libellum/shared";

import { groupsForCandidate, type OcrDuplicateGroup } from "../../lib/ocr/duplicates.js";
import { validationBlocker, type OcrImportBlocker } from "../../lib/ocr/import.js";
import {
  categorySourceOf,
  deriveIssues,
  itemStatus,
  type OcrBatchCandidate,
  type OcrBatchCounts,
  type OcrDirectionFilter,
  type OcrItemStatus,
  type OcrOverviewFilter,
  type OcrSourceFilter,
} from "../../lib/ocr/types.js";

/** 折叠面板的 id；`aria-controls` 与它对应。 */
export const OCR_OVERVIEW_FILTERS_ID = "ocr-overview-filters";

export interface OcrOverviewProps {
  /** 已按当前筛选条件过滤后的候选。 */
  readonly items: readonly OcrBatchCandidate[];
  /** 全部候选的计数（筛选不改变汇总）。 */
  readonly counts: OcrBatchCounts;
  /**
   * 通过导入字段校验的笔数（`countImportableItems`）。
   *
   * 与 `counts.valid` 的区别：valid 是“用户没有排除”，这里才是“现在写进去不会失败”。
   * 顶部和底部条都用这个数，避免按钮被禁用时还写着“可导入 5 笔”。
   */
  readonly importableCount: number;
  readonly filter: OcrOverviewFilter;
  readonly onFilterChange: (filter: OcrOverviewFilter) => void;
  readonly source: OcrSourceFilter;
  readonly onSourceChange: (source: OcrSourceFilter) => void;
  readonly direction: OcrDirectionFilter;
  readonly onDirectionChange: (direction: OcrDirectionFilter) => void;
  /** 来源/方向筛选面板是否展开（由页面持有，便于测试静态渲染）。 */
  readonly filtersOpen: boolean;
  readonly onToggleFilters: () => void;
  /** 批次里出现过的来源，来自全部候选而不是当前筛选结果。 */
  readonly sources: readonly OcrChannel[];
  readonly duplicateGroups: readonly OcrDuplicateGroup[];
  readonly categories: readonly Category[];
  readonly paymentMethods: readonly PaymentMethod[];
  readonly tags: readonly Tag[];
  readonly onOpenDetail: (candidateId: string) => void;
  /** 批次级的风险提醒（例如属于另一本账本、有截图没切出候选）。 */
  readonly warnings?: readonly string[];
  /** 存储与临时性说明，收在「详情」里；组件不假设批次来自哪里。 */
  readonly note?: string;
}

const STATUS_LABELS: Readonly<Record<OcrItemStatus, string>> = {
  recognized: "已识别",
  review: "待核对",
  duplicate: "疑似重复",
  invalid: "无效",
};

const STATUS_CLASSES: Readonly<Record<OcrItemStatus, string>> = {
  recognized: "bg-brand-soft text-brand-dark",
  review: "bg-warn-soft text-warn-dark",
  duplicate: "bg-warn-soft text-warn-dark",
  invalid: "bg-canvas text-muted",
};

function fieldText(value: string | null, fallback: string): string {
  return value === null || value.trim() === "" ? fallback : value;
}

function amountText(item: OcrBatchCandidate): string {
  return fieldText(item.amount, "待确认");
}

function currencyText(item: OcrBatchCandidate): string {
  return fieldText(item.currency, "币种待确认");
}

function dateTimeText(item: OcrBatchCandidate): string {
  if (item.occurredLocalDate === null) return "日期待确认";
  return item.occurredTime === null
    ? item.occurredLocalDate
    : `${item.occurredLocalDate} ${item.occurredTime}`;
}

function sourceText(item: OcrBatchCandidate): string {
  return item.sourcePlatform === null ? "来源待确认" : OCR_CHANNEL_LABELS[item.sourcePlatform];
}

/**
 * 分类的文字。系统按交易对象/备注猜出来的值必须带「系统建议」，不能和用户选过的
 * 混成同一句话；旧批次没有来源字段时按“平台默认”处理（见 `categorySourceOf`）。
 */
function categoryText(
  item: OcrBatchCandidate,
  categories: readonly Category[],
): string {
  if (item.categoryId === null) return "未分类";
  const name = categories.find((category) => category.id === item.categoryId)?.name;
  if (name === undefined) return "未分类";
  return categorySourceOf(item) === "inferred" ? `${name}（系统建议）` : name;
}

function paymentText(
  item: OcrBatchCandidate,
  methods: readonly PaymentMethod[],
): string {
  if (item.paymentMethodId === null) return "待确认";
  return methods.find((method) => method.id === item.paymentMethodId)?.name ?? "待确认";
}

/** 没有标签就整段省略，而不是写“无标签”占一行。 */
function tagText(item: OcrBatchCandidate, tags: readonly Tag[]): string | null {
  if (item.tagIds.length === 0) return null;
  const names = item.tagIds
    .map((id) => tags.find((tag) => tag.id === id)?.name)
    .filter((name): name is string => name !== undefined);
  return names.length === 0 ? null : names.join("、");
}

/** 次级筛选是否生效；用于「筛选 · N」与“已筛选”提示。 */
function secondaryFilterCount(source: OcrSourceFilter, direction: OcrDirectionFilter): number {
  return (source === "all" ? 0 : 1) + (direction === "all" ? 0 : 1);
}

function secondaryFilterText(
  source: OcrSourceFilter,
  direction: OcrDirectionFilter,
): string {
  const parts: string[] = [];
  if (source !== "all") parts.push(`来源 ${OCR_CHANNEL_LABELS[source]}`);
  if (direction !== "all") parts.push(direction === "expense" ? "只看支出" : "只看收入");
  return parts.join(" · ");
}

function primaryFilterText(filter: OcrOverviewFilter): string {
  switch (filter) {
    case "pending":
      return "待核对";
    case "duplicates":
      return "疑似重复";
    case "confirmed":
      return "已确认";
    case "all":
      return "全部";
  }
}

/** 当前空列表的筛选说明；没有任何次级筛选时为空串。 */
function activeFilterText(
  filter: OcrOverviewFilter,
  source: OcrSourceFilter,
  direction: OcrDirectionFilter,
): string {
  const parts = [primaryFilterText(filter)];
  const secondary = secondaryFilterText(source, direction);
  if (secondary !== "") parts.push(secondary);
  return parts.join(" · ");
}

export function OcrOverview({
  items,
  counts,
  importableCount,
  filter,
  onFilterChange,
  source,
  onSourceChange,
  direction,
  onDirectionChange,
  filtersOpen,
  onToggleFilters,
  sources,
  duplicateGroups,
  categories,
  paymentMethods,
  tags,
  onOpenDetail,
  warnings,
  note,
}: OcrOverviewProps): React.JSX.Element {
  const extras = secondaryFilterCount(source, direction);
  const filterDetail = activeFilterText(filter, source, direction);

  function clearSecondaryFilters(): void {
    onSourceChange("all");
    onDirectionChange("all");
  }

  return (
    <div className="flex flex-col gap-3">
      <section
        aria-label="识别概览汇总"
        className="rounded-card border border-line bg-surface px-4 py-3 shadow-card"
      >
        <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <SummaryInline label="本次识别" value={counts.total} />
          <SummaryInline label="待核对" value={counts.pending} tone="warning" />
          <SummaryInline label="疑似重复" value={counts.duplicates} tone="warning" />
          <SummaryInline label="可导入" value={importableCount} tone="brand" />
        </dl>

        <details className="mt-1.5">
          <summary className="w-fit cursor-pointer select-none text-helper text-muted">
            数量说明
          </summary>

          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
            <SummaryNumber label="未标记无效" value={counts.valid} />
            <SummaryNumber label="已确认" value={counts.confirmed} />
            <SummaryNumber label="已标记无效" value={counts.invalid} />
            <SummaryNumber label="你已核对过" value={counts.reviewed} />
          </dl>

          <ul className="mt-2 flex flex-col gap-1 text-helper text-muted">
            <li>
              「本次识别」包括无效项。「可导入」表示金额、币种、收支类型和日期完整，仍可能需要核对。
            </li>
            <li>
              「待核对」包括信息不完整、有疑问和疑似重复的账目。「已确认」表示信息齐全且未发现问题。
              两者都尚未入账。
            </li>
            <li>「你已核对过」表示你保存过详情，与自动检查的「已确认」不同，也不代表已入账。</li>
            <li>筛选只影响列表，不改变汇总数量。</li>
          </ul>

          {note === undefined ? null : <p className="mt-2 text-helper text-muted">{note}</p>}
        </details>
      </section>

      {warnings === undefined || warnings.length === 0 ? null : (
        <ul aria-label="批次提醒" className="flex flex-col gap-1">
          {warnings.map((warning) => (
            <li key={warning} className="text-helper-relaxed text-warn-dark">
              ⚠ {warning}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="按状态筛选">
        <FilterButton
          active={filter === "all"}
          label={`全部 ${String(counts.total)}`}
          onSelect={() => {
            onFilterChange("all");
          }}
        />
        <FilterButton
          active={filter === "pending"}
          label={`待核对 ${String(counts.pending)}`}
          onSelect={() => {
            onFilterChange("pending");
          }}
        />
        <FilterButton
          active={filter === "duplicates"}
          label={`疑似重复 ${String(counts.duplicates)}`}
          onSelect={() => {
            onFilterChange("duplicates");
          }}
        />
        <FilterButton
          active={filter === "confirmed"}
          label={`已确认 ${String(counts.confirmed)}`}
          onSelect={() => {
            onFilterChange("confirmed");
          }}
        />
        <button
          type="button"
          aria-expanded={filtersOpen}
          aria-controls={OCR_OVERVIEW_FILTERS_ID}
          onClick={onToggleFilters}
          className={`rounded-full border px-3 py-1.5 text-helper transition ${
            filtersOpen || extras > 0
              ? "border-brand bg-brand-soft text-brand-dark"
              : "border-line bg-surface text-muted"
          }`}
        >
          筛选{extras === 0 ? "" : ` · ${String(extras)}`}
        </button>
      </div>

      {filtersOpen ? (
        <div
          id={OCR_OVERVIEW_FILTERS_ID}
          className="flex flex-col gap-3 rounded-card border border-line bg-surface p-3 shadow-card"
        >
          {sources.length === 0 ? null : (
            <div className="flex flex-col gap-1.5">
              <span className="text-helper text-muted">来源</span>
              <div className="flex flex-wrap gap-2" role="group" aria-label="按来源筛选">
                <FilterButton
                  active={source === "all"}
                  label="全部来源"
                  onSelect={() => {
                    onSourceChange("all");
                  }}
                />
                {sources.map((value) => (
                  <FilterButton
                    key={value}
                    active={source === value}
                    label={OCR_CHANNEL_LABELS[value]}
                    onSelect={() => {
                      onSourceChange(value);
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-helper text-muted">收支方向</span>
            <div className="flex flex-wrap gap-2" role="group" aria-label="按收支筛选">
              <FilterButton
                active={direction === "all"}
                label="全部收支"
                onSelect={() => {
                  onDirectionChange("all");
                }}
              />
              <FilterButton
                active={direction === "expense"}
                label="支出"
                onSelect={() => {
                  onDirectionChange("expense");
                }}
              />
              <FilterButton
                active={direction === "income"}
                label="收入"
                onSelect={() => {
                  onDirectionChange("income");
                }}
              />
            </div>
          </div>

          {extras === 0 ? null : (
            <button
              type="button"
              onClick={clearSecondaryFilters}
              className="self-start text-helper text-brand-dark underline-offset-2 hover:underline"
            >
              清除来源/方向筛选
            </button>
          )}
        </div>
      ) : extras === 0 ? null : (
        <p className="text-helper text-muted">
          已筛选：{secondaryFilterText(source, direction)}
          <button
            type="button"
            onClick={clearSecondaryFilters}
            className="ml-2 text-brand-dark underline-offset-2 hover:underline"
          >
            清除
          </button>
        </p>
      )}

      {items.length === 0 ? (
        <div className="rounded-card border border-line bg-surface p-4">
          <p className="text-body text-muted">
            {counts.total === 0
              ? "这次识别没有切分出任何交易。可以返回重新上传，或按单笔/手动录入。"
              : "当前筛选下没有交易。"}
          </p>
          {counts.total === 0 ? null : (
            <>
              <p className="mt-1 text-helper text-muted">当前筛选：{filterDetail}。</p>
              <button
                type="button"
                onClick={() => {
                  onFilterChange("all");
                  clearSecondaryFilters();
                }}
                className="mt-2 text-helper text-brand-dark underline-offset-2 hover:underline"
              >
                显示全部交易
              </button>
            </>
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.candidateId}>
              <OcrOverviewCard
                item={item}
                duplicateGroups={duplicateGroups}
                categories={categories}
                paymentMethods={paymentMethods}
                tags={tags}
                onOpenDetail={onOpenDetail}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SummaryInline({
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
    <div className="flex items-baseline gap-1">
      <dt className="text-helper text-muted">{label}</dt>
      <dd className={`text-body font-medium ${toneClass}`}>{value}</dd>
    </div>
  );
}

function SummaryNumber({
  label,
  value,
}: {
  readonly label: string;
  readonly value: number;
}): React.JSX.Element {
  return (
    <div>
      <dt className="text-helper text-muted">{label}</dt>
      <dd className="text-body text-ink">{value}</dd>
    </div>
  );
}

export function FilterButton({
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
      className={`min-h-11 rounded-full border px-3 py-1.5 text-helper transition ${
        active ? "border-brand bg-brand-soft text-brand-dark" : "border-line bg-surface text-muted"
      }`}
    >
      {label}
    </button>
  );
}

function OcrOverviewCard({
  item,
  duplicateGroups,
  categories,
  paymentMethods,
  tags,
  onOpenDetail,
}: {
  readonly item: OcrBatchCandidate;
  readonly duplicateGroups: readonly OcrDuplicateGroup[];
  readonly categories: readonly Category[];
  readonly paymentMethods: readonly PaymentMethod[];
  readonly tags: readonly Tag[];
  readonly onOpenDetail: (candidateId: string) => void;
}): React.JSX.Element {
  const status = itemStatus(item);
  const issues = deriveIssues(item);
  const groups = groupsForCandidate(duplicateGroups, item.candidateId);
  const importBlocker = validationBlocker(item);
  const labels = tagText(item, tags);

  /**
   * ⚠️ 一条“已识别”的记录却写不进账（例如币种账本不支持）时，卡片必须自己说出来。
   * 状态为待核对/疑似重复时，缺字段与重复本身已经有提示，不再叠一条同义的警告。
   */
  const showImportBlocker = importBlocker !== null && status === "recognized";

  return (
    <article
      className={`flex flex-col gap-1.5 rounded-card border border-line bg-surface px-4 py-3 shadow-card ${
        item.invalid ? "opacity-70" : ""
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="flex flex-wrap gap-1.5">
          <span className={`rounded-full px-2.5 py-1 text-helper ${STATUS_CLASSES[status]}`}>
            {STATUS_LABELS[status]}
          </span>
          {item.isRefund ? (
            <span className="rounded-full bg-brand-soft px-2.5 py-1 text-helper text-brand-dark">
              退款
            </span>
          ) : null}
          {item.isTransfer ? (
            <span className="rounded-full bg-brand-soft px-2.5 py-1 text-helper text-brand-dark">
              转账
            </span>
          ) : null}
          {item.reviewed && !item.invalid ? (
            <span className="rounded-full bg-canvas px-2.5 py-1 text-helper text-muted">已核对</span>
          ) : null}
        </span>

        <span className="text-helper text-muted">
          {dateTimeText(item)} · {sourceText(item)}
        </span>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-section-title text-ink">{amountText(item)}</span>
        <span className="text-helper text-muted">{currencyText(item)}</span>
        <span className="rounded-full bg-brand-soft px-2.5 py-1 text-helper text-brand-dark">
          {OCR_DIRECTION_LABELS[item.direction]}
        </span>
      </div>

      <p className="text-body text-ink">{fieldText(item.merchant, "对象/商户待确认")}</p>

      <div className="flex items-end justify-between gap-3">
        <p className="text-helper text-muted">
          分类：{categoryText(item, categories)} · 支付方式：
          {paymentText(item, paymentMethods)}
          {labels === null ? "" : ` · 标签：${labels}`}
          {item.account === null || item.account.trim() === ""
            ? ""
            : ` · 账户：${item.account.trim()}`}
        </p>
        <button
          type="button"
          onClick={() => {
            onOpenDetail(item.candidateId);
          }}
          className="shrink-0 rounded-field px-2 py-1 text-link text-brand-dark underline-offset-2 hover:underline"
        >
          查看详情
        </button>
      </div>

      {item.note === null || item.note.trim() === "" ? null : (
        <p className="truncate text-helper text-muted">备注：{item.note.trim()}</p>
      )}

      {groups.length === 0 ? null : (
        <ul className="flex flex-col gap-1">
          {groups.map((group) => (
            <li key={group.groupId} className="text-helper-relaxed text-warn-dark">
              ⚠ 可能重复：{group.reason}
            </li>
          ))}
        </ul>
      )}

      {issues.length === 0 ? null : (
        <ul className="flex flex-col gap-1">
          {issues.map((issue) => (
            <li
              key={`${issue.code}:${issue.field ?? ""}`}
              className="text-helper-relaxed text-warn-dark"
            >
              ⚠ {issue.message}
            </li>
          ))}
        </ul>
      )}

      {showImportBlocker ? (
        <p className="text-helper-relaxed text-warn-dark">⚠ 还不能导入：{importBlocker}</p>
      ) : null}

      {item.invalid ? (
        <p className="text-helper text-muted">已标记无效，确认导入时不会计入。</p>
      ) : null}
    </article>
  );
}

/**
 * 底部固定操作条：可导入数量 + 确认入口。
 *
 * ⚠️ **它只是入口。** 确认后仍然由页面调用 `executeImport`/`createEntry`（既有本地写入与
 * 离线队列、幂等、撤销、权限都不变）；这个组件不 import 任何写账函数，也不写 sessionStorage。
 *
 * ⚠️ **安全区在这里处理**（`pb-[env(safe-area-inset-bottom)]`），因为 OCR 概览页没有底部
 * 导航；页面在列表末尾留出等高空白，最后一笔不会被这条 bar 盖住。
 */
export function OcrImportBar({
  importableCount,
  blockedReason,
  blockers,
  busy,
  onConfirm,
  onCancel,
  cancelLabel = "取消这次识别",
}: {
  readonly importableCount: number;
  /** 不能导入的原因（权限、账本不符、字段不够……）；`null` 表示可以确认。 */
  readonly blockedReason: string | null;
  /** 逐笔阻塞原因，展开可见；不隐藏任何一笔。 */
  readonly blockers: readonly OcrImportBlocker[];
  readonly busy: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly cancelLabel?: string;
}): React.JSX.Element {
  const disabled = importableCount === 0 || blockedReason !== null || busy;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom,0px)] shadow-card">
      <div className="mx-auto w-full max-w-md px-6 pt-2.5 pb-3">
        <div className="flex items-center gap-3">
          <p className="mr-auto text-helper-relaxed text-ink">
            可导入 <strong className="font-semibold">{importableCount}</strong> 笔
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={onConfirm}
            className="rounded-field bg-brand px-4 py-2.5 text-button-lg font-medium text-on-brand shadow-sm transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-45"
          >
            {busy ? "正在导入…" : `确认导入 ${String(importableCount)} 笔`}
          </button>
        </div>

        <div className="mt-1 flex items-start justify-between gap-3">
          <p
            className={`text-helper ${blockedReason === null ? "text-muted" : "text-warn-dark"}`}
          >
            {blockedReason ?? "确认前不会写入账本。"}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="shrink-0 text-helper text-muted underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-45"
          >
            {cancelLabel}
          </button>
        </div>

        {blockers.length === 0 ? null : (
          <details className="mt-1">
            <summary className="w-fit cursor-pointer select-none text-helper text-warn-dark">
              查看 {String(blockers.length)} 笔不能导入的原因
            </summary>
            <ul className="mt-1 flex max-h-32 flex-col gap-1 overflow-y-auto">
              {blockers.map((entry) => (
                <li key={entry.candidateId} className="text-helper-relaxed text-warn-dark">
                  ⚠ {entry.label}：{entry.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
