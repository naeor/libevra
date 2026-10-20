import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { OcrCandidateView } from "../../lib/ocrOverview.js";
import { defaultSelectedIds, summariseOcrOverview } from "../../lib/ocrOverview.js";
import { demoOcrOverviewItems } from "../../lib/ocrOverviewDemo.js";
import { OcrOverview } from "./OcrOverview.js";

/**
 * Static-render tests for the overview prototype.
 *
 * No DOM and no clicking: the component is deliberately presentational (all
 * state and callbacks come from the page), so what is worth checking is the
 * rendered facts — the summary matches the list, missing fields say 待确认,
 * duplicates are marked, and nothing but the one "统一确认" button promises to
 * save anything.
 */

type Props = Parameters<typeof OcrOverview>[0];

const noop = (): void => undefined;

function render(overrides: Partial<Props> = {}): string {
  const items = overrides.items ?? demoOcrOverviewItems();

  return renderToStaticMarkup(
    <OcrOverview
      items={items}
      selectedIds={overrides.selectedIds ?? defaultSelectedIds(items)}
      filter={overrides.filter ?? "all"}
      onFilterChange={overrides.onFilterChange ?? noop}
      onToggleSelection={overrides.onToggleSelection ?? noop}
      onOpenDetail={overrides.onOpenDetail ?? noop}
      onReviewQuestionable={overrides.onReviewQuestionable ?? noop}
      onConfirmSelected={overrides.onConfirmSelected ?? noop}
    />,
  );
}

/** Text within a short window after `label`, to read a specific summary number. */
function around(html: string, label: string, length = 220): string {
  const index = html.indexOf(label);
  return index === -1 ? "" : html.slice(index, index + length);
}

function countOccurrences(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe("OcrOverview", () => {
  it("shows the batch summary matching the list", () => {
    const items = demoOcrOverviewItems();
    const counts = summariseOcrOverview(items, defaultSelectedIds(items));
    const html = render();

    expect(around(html, "待处理总数")).toContain(`>${String(counts.total)}<`);
    expect(around(html, "可直接确认")).toContain(`>${String(counts.complete)}<`);
    expect(around(html, "有疑问")).toContain(`>${String(counts.questionable)}<`);
    expect(around(html, "可能重复")).toContain(`>${String(counts.duplicates)}<`);
    expect(around(html, "当前选中")).toContain(`>${String(counts.selected)}<`);
  });

  it("renders one card per transaction with amount, direction and merchant", () => {
    const html = render();

    expect(countOccurrences(html, "查看 / 编辑详情")).toBe(6);
    expect(html).toContain("20.00");
    expect(html).toContain("老王便利店");
    expect(html).toContain("支出");
    expect(html).toContain("收入");
    expect(html).toContain("1280.00");
  });

  it("says 待确认 for fields that were not read", () => {
    const html = render();

    // img1-2 has no date; img1-3 has no merchant and no direction.
    expect(html).toContain("日期待确认");
    expect(html).toContain("待确认");
    expect(html).toContain("方向待确认");
  });

  it("marks suspected duplicates", () => {
    const html = render();

    // One summary term plus one badge on each of the two duplicate cards.
    expect(countOccurrences(html, ">可能重复<")).toBe(3);
    expect(html).toContain("被标记为可能重复");
  });

  it("renders the issue messages rather than a bare warning icon", () => {
    const html = render();

    expect(html).toContain("没有读出商户/交易对象");
    expect(html).toContain("没有读出收支方向");
  });

  it("shows only the questionable items when the review filter is on", () => {
    const html = render({ filter: "questionable" });

    expect(countOccurrences(html, "查看 / 编辑详情")).toBe(4);
    expect(html).not.toContain("老王便利店");
  });

  it("marks the active filter for assistive technology", () => {
    expect(render()).toContain('aria-pressed="true"');

    expect(render({ filter: "questionable" })).toContain("只看有疑问");
  });

  it("has a summarisation region and a confirm control", () => {
    const html = render();

    expect(html).toContain('aria-label="识别概览汇总"');
    expect(html).toContain("统一确认所选 2 笔");
  });

  it("disables the confirm button when nothing is selected", () => {
    const html = render({ selectedIds: [] });

    expect(html).toMatch(/disabled[^>]*>统一确认所选 0 笔/);
  });

  it("does not claim anything was saved before confirmation", () => {
    const html = render();

    expect(html).toContain("确认前不会写入账本");
    expect(html).not.toContain("已保存");
    expect(html).not.toContain("保存成功");
  });

  it("shows an empty state instead of an empty list", () => {
    expect(render({ items: [], selectedIds: [] })).toContain("还没有识别出任何交易");
  });

  it("does not call any callback just by rendering", () => {
    let calls = 0;
    const counting = (): void => {
      calls += 1;
    };
    const items: readonly OcrCandidateView[] = demoOcrOverviewItems();

    renderToStaticMarkup(
      <OcrOverview
        items={items}
        selectedIds={defaultSelectedIds(items)}
        filter="all"
        onFilterChange={counting}
        onToggleSelection={counting}
        onOpenDetail={counting}
        onReviewQuestionable={counting}
        onConfirmSelected={counting}
        note="演示"
      />,
    );

    expect(calls).toBe(0);
  });
});
