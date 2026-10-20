/**
 * OCR 批量识别结果的「概览」组件（S15-B B3，候选原型）。
 *
 * 设计方向 §3.2/§3.3 的边界，组件刻意照做：
 *  - **只读展示**：卡片上没有任何输入框，不直接改字段；
 *  - 点卡片进入详情（`onOpenDetail`），详情改完由页面把结果合并回来；
 *  - 汇总数字全部来自传入的候选列表（由纯函数计算，测试覆盖）；
 *  - 「统一确认」只是一个回调，组件不写账本、不绕过保存/锁/幂等；
 *  - 缺失字段显示「待确认」，不伪造默认值。
 *
 * 组件是纯展示：不持有状态，不调用 API，方便静态渲染测试，也方便以后放到真实的
 * 识别结果页里复用。
 */

import type { OcrCandidateView, OcrOverviewFilter } from "../../lib/ocrOverview.js";
import {
  accountText,
  amountText,
  currencyText,
  dateTimeText,
  directionText,
  filterOcrItems,
  isOcrItemQuestionable,
  merchantText,
  platformText,
  statusText,
  summariseOcrOverview,
} from "../../lib/ocrOverview.js";
import { Button } from "../Button.js";

export interface OcrOverviewProps {
  readonly items: readonly OcrCandidateView[];
  readonly selectedIds: readonly string[];
  readonly filter: OcrOverviewFilter;
  readonly onFilterChange: (filter: OcrOverviewFilter) => void;
  readonly onToggleSelection: (candidateId: string) => void;
  readonly onOpenDetail: (candidateId: string) => void;
  readonly onReviewQuestionable: () => void;
  readonly onConfirmSelected: (selectedIds: readonly string[]) => void;
  /** 原型/数据来源说明，由页面传入；组件不假设数据来自哪里。 */
  readonly note?: string;
}

export function OcrOverview({
  items,
  selectedIds,
  filter,
  onFilterChange,
  onToggleSelection,
  onOpenDetail,
  onReviewQuestionable,
  onConfirmSelected,
  note,
}: OcrOverviewProps): React.JSX.Element {
  const counts = summariseOcrOverview(items, selectedIds);
  const visibleItems = filterOcrItems(items, filter);
  const selected = new Set(selectedIds);

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-label="识别概览汇总"
        className="rounded-card border border-line bg-surface p-4 shadow-card"
      >
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <SummaryNumber label="待处理总数" value={counts.total} />
          <SummaryNumber label="可直接确认" value={counts.complete} />
          <SummaryNumber label="有疑问" value={counts.questionable} />
          <SummaryNumber label="可能重复" value={counts.duplicates} />
          <SummaryNumber label="当前选中" value={counts.selected} />
        </dl>
        <p className="mt-3 text-helper-relaxed text-muted">
          没有问题的记录不用逐笔点开；有疑问或可能重复的才需要进详情核对。确认前不会写入账本。
        </p>
      </section>

      {note === undefined ? null : <p className="text-helper-relaxed text-muted">{note}</p>}

      <div role="group" aria-label="筛选交易" className="flex flex-wrap gap-2">
        <FilterButton
          active={filter === "all"}
          label={`全部 ${counts.total}`}
          onSelect={() => onFilterChange("all")}
        />
        <FilterButton
          active={filter === "questionable"}
          label={`只看有疑问 ${counts.questionable}`}
          onSelect={() => onFilterChange("questionable")}
        />
      </div>

      {visibleItems.length === 0 ? (
        <p className="rounded-card border border-line bg-surface p-4 text-body text-muted">
          {filter === "questionable" ? "没有需要重点核对的项。" : "还没有识别出任何交易。"}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {visibleItems.map((item) => (
            <li key={item.candidateId}>
              <OcrOverviewCard
                item={item}
                selected={selected.has(item.candidateId)}
                onToggleSelection={onToggleSelection}
                onOpenDetail={onOpenDetail}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        <Button
          onClick={() => {
            onConfirmSelected(selectedIds);
          }}
          disabled={counts.selected === 0}
        >
          统一确认所选 {counts.selected} 笔
        </Button>
        <Button
          variant="secondary"
          onClick={onReviewQuestionable}
          disabled={counts.questionable === 0}
        >
          只处理有疑问的项（{counts.questionable}）
        </Button>
      </div>
    </div>
  );
}

function SummaryNumber({ label, value }: { readonly label: string; readonly value: number }): React.JSX.Element {
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
  selected,
  onToggleSelection,
  onOpenDetail,
}: {
  readonly item: OcrCandidateView;
  readonly selected: boolean;
  readonly onToggleSelection: (candidateId: string) => void;
  readonly onOpenDetail: (candidateId: string) => void;
}): React.JSX.Element {
  const questionable = isOcrItemQuestionable(item);
  const status = statusText(item);

  return (
    <article
      className={`flex flex-col gap-2 rounded-card border bg-surface p-4 shadow-card ${
        selected ? "border-brand" : "border-line"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <label className="flex items-center gap-2 text-helper text-muted">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => {
              onToggleSelection(item.candidateId);
            }}
            aria-label={`选择 ${amountText(item)} ${merchantText(item)}`}
          />
          {selected ? "已选中" : "未选中"}
        </label>

        <span className="flex flex-wrap justify-end gap-1.5">
          {item.duplicateSuspected ? (
            <span className="rounded-full bg-warning/10 px-2.5 py-1 text-helper text-warning-dark">
              可能重复
            </span>
          ) : null}
          {questionable && !item.duplicateSuspected ? (
            <span className="rounded-full bg-warning/10 px-2.5 py-1 text-helper text-warning-dark">
              待核对
            </span>
          ) : null}
          {item.isRefund ? (
            <span className="rounded-full bg-brand-soft px-2.5 py-1 text-helper text-brand-dark">退款</span>
          ) : null}
          {item.isTransfer ? (
            <span className="rounded-full bg-brand-soft px-2.5 py-1 text-helper text-brand-dark">转账</span>
          ) : null}
          {status === null ? null : (
            <span className="rounded-full bg-canvas px-2.5 py-1 text-helper text-muted">{status}</span>
          )}
        </span>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-section-title text-ink">{amountText(item)}</span>
        <span className="text-helper text-muted">{currencyText(item)}</span>
        <span className="rounded-full bg-brand-soft px-2.5 py-1 text-helper text-brand-dark">
          {directionText(item)}
        </span>
      </div>

      <p className="text-body text-ink">{merchantText(item)}</p>
      <p className="text-helper-relaxed text-muted">
        {dateTimeText(item)} · {platformText(item)} · {accountText(item)}
      </p>

      {item.note === null ? null : (
        <p className="text-helper-relaxed text-muted">备注：{item.note}</p>
      )}

      {item.issues.length === 0 ? (
        <p className="text-helper text-muted">没有发现问题</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {item.issues.map((issue) => (
            <li
              key={`${issue.code}:${issue.field ?? ""}`}
              className="text-helper-relaxed text-warning-dark"
            >
              ⚠ {issue.message}
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => {
          onOpenDetail(item.candidateId);
        }}
        className="self-start rounded-field px-2 py-1.5 text-link text-brand-dark underline-offset-2 hover:underline"
      >
        查看 / 编辑详情
      </button>
    </article>
  );
}
