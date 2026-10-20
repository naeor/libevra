/**
 * 「识别概览」页面（S15-B B3，候选原型）。
 *
 * ⚠️ **这是候选原型，未经所有者验收：**
 *  - 数据来自 `lib/ocrOverviewDemo.ts` 的**合成演示数据**，不是真实识别结果；
 *  - 还没接入真实 OCR 多笔接口（Python 侧 `overview.py` 已可离线产出同形状数据，
 *    但 API/保存边界等所有者决定，见设计方向 §10.5）；
 *  - 详情页只是占位，「统一确认」只显示提示，**不会写入账本**；
 *  - 没有绕过 S14 的导入锁/撤销/最终确认机制 —— 因为这里根本没有保存动作。
 *
 * 页面职责按设计方向 §3.3：只展示、选择、核对；点卡片进详情；最后统一确认。
 */

import { useState } from "react";

import { Alert } from "../components/Alert.js";
import { Button } from "../components/Button.js";
import { InnerPage } from "../components/Layouts.js";
import { OcrOverview } from "../components/ocr/OcrOverview.js";
import {
  accountText,
  amountText,
  applyOcrDetailUpdate,
  currencyText,
  dateTimeText,
  defaultSelectedIds,
  directionText,
  fieldText,
  merchantText,
  platformText,
  statusText,
  withSelectionToggled,
  type OcrCandidateView,
  type OcrOverviewFilter,
} from "../lib/ocrOverview.js";
import { demoOcrOverviewItems } from "../lib/ocrOverviewDemo.js";

export function OcrOverviewPage(): React.JSX.Element {
  const [items, setItems] = useState<OcrCandidateView[]>(() => demoOcrOverviewItems());
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    defaultSelectedIds(demoOcrOverviewItems()),
  );
  const [filter, setFilter] = useState<OcrOverviewFilter>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const editing = items.find((item) => item.candidateId === editingId) ?? null;

  function toggleSelection(candidateId: string): void {
    setSelectedIds((current) => withSelectionToggled(current, candidateId));
  }

  function confirmSelected(ids: readonly string[]): void {
    setNotice(
      `已选择 ${String(ids.length)} 笔。统一确认还没有接入既有保存流程——这是候选原型，不会写入账本。`,
    );
  }

  function simulateDetailEditReturn(): void {
    // 详情编辑没有接入；这个按钮只演示设计方向要求的「详情返回后概览同步最新值」。
    if (editing === null) return;
    setItems((current) =>
      applyOcrDetailUpdate(current, editing.candidateId, { note: "已核对（演示）" }),
    );
    setEditingId(null);
  }

  return (
    <InnerPage
      title="识别概览（候选原型）"
      subtitle="先看到识别出的全部交易，只核对有疑问的，最后统一确认。"
      backTo="/"
    >
      <Alert tone="info">
        候选原型：使用合成演示数据，未经所有者验收；没有接入真实识别、详情编辑与保存流程，不会写入账本。
      </Alert>

      {notice === null ? null : <Alert tone="success">{notice}</Alert>}

      {editing === null ? (
        <OcrOverview
          items={items}
          selectedIds={selectedIds}
          filter={filter}
          onFilterChange={setFilter}
          onToggleSelection={toggleSelection}
          onOpenDetail={setEditingId}
          onReviewQuestionable={() => {
            setFilter("questionable");
          }}
          onConfirmSelected={confirmSelected}
          note="演示数据：2 笔完整、2 笔有疑问、2 笔怀疑跨图重复。"
        />
      ) : (
        <OcrDetailPlaceholder
          item={editing}
          onBack={() => {
            setEditingId(null);
          }}
          onSimulateReturn={simulateDetailEditReturn}
        />
      )}
    </InnerPage>
  );
}

/**
 * 详情编辑占位。
 *
 * 真正的详情页要复用现有核对/编辑体验（设计方向 §3.4），这里只把「概览不直接编辑、
 * 点击进入详情、返回后同步」这条数据流演示出来。字段在这里也是只读的。
 */
function OcrDetailPlaceholder({
  item,
  onBack,
  onSimulateReturn,
}: {
  readonly item: OcrCandidateView;
  readonly onBack: () => void;
  readonly onSimulateReturn: () => void;
}): React.JSX.Element {
  const status = statusText(item);

  return (
    <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card">
      <header>
        <h2 className="text-section-title text-ink">详情编辑（占位）</h2>
        <p className="mt-1 text-helper-relaxed text-muted">
          真实的详情编辑页尚未接入。概览页本身不直接改字段；按设计方向，修改应在本页完成后返回并同步。
        </p>
      </header>

      <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-2 text-body">
        <DetailRow label="金额" value={`${amountText(item)} ${currencyText(item)}`} />
        <DetailRow label="方向" value={directionText(item)} />
        <DetailRow label="日期" value={dateTimeText(item)} />
        <DetailRow label="商户" value={merchantText(item)} />
        <DetailRow label="来源" value={platformText(item)} />
        <DetailRow label="账户" value={accountText(item)} />
        <DetailRow label="备注" value={fieldText(item.note)} />
        <DetailRow label="状态" value={status ?? "状态待确认"} />
        <DetailRow
          label="问题"
          value={
            item.issues.length === 0
              ? "没有发现问题"
              : item.issues.map((issue) => issue.message).join("；")
          }
        />
      </dl>

      <div className="flex flex-col gap-2">
        <Button variant="secondary" onClick={onSimulateReturn}>
          模拟：修改备注后返回概览（演示数据流）
        </Button>
        <Button variant="ghost" onClick={onBack}>
          返回概览（不修改）
        </Button>
      </div>
    </section>
  );
}

function DetailRow({ label, value }: { readonly label: string; readonly value: string }): React.JSX.Element {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </>
  );
}
