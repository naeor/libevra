/**
 * 批量识别结果的只读概览（S15-B §3.2/§3.3）。
 *
 * 组件只展示、不编辑、不写账：
 *  - 每笔一张横向卡片，状态、金额、对象、时间、分类/标签/渠道、异常原因一眼可见；
 *  - 卡片上没有输入框，点「查看详情」进入编辑页；
 *  - 汇总数字全部由传入的候选计算（`lib/ocr/types.ts` 的纯函数），和列表同一口径；
 *  - 缺失字段显示「待确认」，不伪造默认值；疑似重复只提示，不合并、不删除。
 */

import {
  OCR_CHANNEL_LABELS,
  OCR_DIRECTION_LABELS,
  type Category,
  type OcrChannel,
  type PaymentMethod,
  type Tag,
} from "@libellum/shared";

import type { OcrDuplicateGroup } from "../../lib/ocr/duplicates.js";
import { groupsForCandidate } from "../../lib/ocr/duplicates.js";
import {
  deriveIssues,
  itemStatus,
  type OcrBatchCandidate,
  type OcrBatchCounts,
  type OcrDirectionFilter,
  type OcrItemStatus,
  type OcrOverviewFilter,
  type OcrSourceFilter,
} from "../../lib/ocr/types.js";

export interface OcrOverviewProps {
  /** 已按当前筛选条件过滤后的候选。 */
  readonly items: readonly OcrBatchCandidate[];
  /** 全部候选的计数（筛选不改变汇总）。 */
  readonly counts: OcrBatchCounts;
  readonly filter: OcrOverviewFilter;
  readonly onFilterChange: (filter: OcrOverviewFilter) => void;
  readonly source: OcrSourceFilter;
  readonly onSourceChange: (source: OcrSourceFilter) => void;
  readonly direction: OcrDirectionFilter;
  readonly onDirectionChange: (direction: OcrDirectionFilter) => void;
  /** 批次里出现过的来源，来自全部候选而不是当前筛选结果。 */
  readonly sources: readonly OcrChannel[];
  readonly duplicateGroups: readonly OcrDuplicateGroup[];
  readonly categories: readonly Category[];
  readonly paymentMethods: readonly PaymentMethod[];
  readonly tags: readonly Tag[];
  readonly onOpenDetail: (candidateId: string) => void;
  /** 数据来源说明，由页面传入；组件不假设批次来自哪里。 */
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
  review: "bg-warning/10 text-warning-dark",
  duplicate: "bg-warning/10 text-warning-dark",
  invalid: "bg-canvas text-muted",
};

function fieldText(value: string | null, fallback: string): string {
  return value === null || value.trim() === "" ? fallback : value;
}

function amountText(item: OcrBatchCandidate): string {
  return fieldText(item.amount, "待确认");
}

function dateTimeText(item: OcrBatchCandidate): string {
  if (item.occurredLocalDate === null) return "日期待确认";
  return item.occurredTime === null
    ? item.occurredLocalDate
    : `${item.occurredLocalDate} ${item.occurredTime}`;
}

function categoryText(
  item: OcrBatchCandidate,
  categories: readonly Category[],
): string {
  if (item.categoryId === null) return "未分类";
  return categories.find((category) => category.id === item.categoryId)?.name ?? "未分类";
}

function paymentText(
  item: OcrBatchCandidate,
  methods: readonly PaymentMethod[],
): string {
  if (item.paymentMethodId === null) return "支付方式待确认";
  return methods.find((method) => method.id === item.paymentMethodId)?.name ?? "支付方式待确认";
}

function tagText(item: OcrBatchCandidate, tags: readonly Tag[]): string {
  if (item.tagIds.length === 0) return "无标签";
  const names = item.tagIds
    .map((id) => tags.find((tag) => tag.id === id)?.name)
    .filter((name): name is string => name !== undefined);
  return names.length === 0 ? "无标签" : names.join("、");
}

export function OcrOverview({
  items,
  counts,
  filter,
  onFilterChange,
  source,
  onSourceChange,
  direction,
  onDirectionChange,
  sources,
  duplicateGroups,
  categories,
  paymentMethods,
  tags,
  onOpenDetail,
  note,
}: OcrOverviewProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <section
        aria-label="识别概览汇总"
        className="rounded-card border border-line bg-surface p-4 shadow-card"
      >
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <SummaryNumber label="本次识别" value={counts.total} />
          <SummaryNumber label="待核对" value={counts.pending} />
          <SummaryNumber label="可直接导入" value={counts.confirmed} />
          <SummaryNumber label="可能重复" value={counts.duplicates} />
          <SummaryNumber label="已标记无效" value={counts.invalid} />
          <SummaryNumber label="可导入" value={counts.valid} />
        </dl>
        <p className="mt-3 text-helper-relaxed text-muted">
          没有问题的记录不用逐笔点开；有疑问或可能重复的才需要进详情核对。确认前不会写入账本。
        </p>
      </section>

      {note === undefined ? null : <p className="text-helper-relaxed text-muted">{note}</p>}

      <div className="flex flex-wrap gap-2" role="group" aria-label="按状态筛选">
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
          active={filter === "confirmed"}
          label={`已确认 ${String(counts.confirmed)}`}
          onSelect={() => {
            onFilterChange("confirmed");
          }}
        />
        <FilterButton
          active={filter === "duplicates"}
          label={`疑似重复 ${String(counts.duplicates)}`}
          onSelect={() => {
            onFilterChange("duplicates");
          }}
        />
      </div>

      {sources.length > 0 ? (
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
      ) : null}

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

      {items.length === 0 ? (
        <p className="rounded-card border border-line bg-surface p-4 text-body text-muted">
          {counts.total === 0
            ? "这次识别没有切分出任何交易。可以返回重新上传，或按单笔/手动录入。"
            : "当前筛选下没有交易。"}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
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
      <dd className="text-section-title text-ink">{value}</dd>
    </div>
  );
}

function FilterButton({
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
      className={`rounded-full border px-3 py-1.5 text-helper transition ${
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

  return (
    <article
      className={`flex flex-col gap-2 rounded-card border bg-surface p-4 shadow-card ${
        item.invalid ? "border-line opacity-70" : "border-line"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex flex-wrap gap-1.5">
          <span
            className={`rounded-full px-2.5 py-1 text-helper ${STATUS_CLASSES[status]}`}
          >
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

        <button
          type="button"
          onClick={() => {
            onOpenDetail(item.candidateId);
          }}
          className="shrink-0 rounded-field px-2 py-1.5 text-link text-brand-dark underline-offset-2 hover:underline"
        >
          查看详情
        </button>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-section-title text-ink">{amountText(item)}</span>
        <span className="text-helper text-muted">{item.currency ?? "币种待确认"}</span>
        <span className="rounded-full bg-brand-soft px-2.5 py-1 text-helper text-brand-dark">
          {OCR_DIRECTION_LABELS[item.direction]}
        </span>
      </div>

      <p className="text-body text-ink">{fieldText(item.merchant, "对象/商户待确认")}</p>
      <p className="text-helper-relaxed text-muted">
        {dateTimeText(item)} ·{" "}
        {item.sourcePlatform === null ? "来源待确认" : OCR_CHANNEL_LABELS[item.sourcePlatform]} ·{" "}
        {fieldText(item.account, "账户待确认")}
      </p>

      <p className="text-helper-relaxed text-muted">
        分类：{categoryText(item, categories)} · 支付方式：{paymentText(item, paymentMethods)} ·
        标签：{tagText(item, tags)}
      </p>

      {item.note === null ? null : (
        <p className="text-helper-relaxed text-muted">备注：{item.note}</p>
      )}

      {groups.length === 0 ? null : (
        <ul className="flex flex-col gap-1">
          {groups.map((group) => (
            <li key={group.groupId} className="text-helper-relaxed text-warning-dark">
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
              className="text-helper-relaxed text-warning-dark"
            >
              ⚠ {issue.message}
            </li>
          ))}
        </ul>
      )}

      {item.invalid ? (
        <p className="text-helper text-muted">已标记无效，确认导入时不会计入。</p>
      ) : null}
    </article>
  );
}
