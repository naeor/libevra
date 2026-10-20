import { describe, expect, it } from "vitest";

import {
  amountText,
  applyOcrDetailUpdate,
  currencyText,
  dateTimeText,
  defaultSelectedIds,
  fieldText,
  filterOcrItems,
  isOcrItemQuestionable,
  summariseOcrOverview,
  withSelectionToggled,
} from "./ocrOverview.js";
import { demoOcrOverviewItems } from "./ocrOverviewDemo.js";

/**
 * The overview's arithmetic and its "待确认" rules.
 *
 * The counts have to match the list, because the design direction asks the page
 * to show 总数/完整/疑问/重复/选中 at the top and the user trusts those numbers
 * when deciding what to review. A preselect rule that quietly includes a
 * questionable item would defeat the "only check the doubtful ones" flow.
 */

describe("overview counts", () => {
  it("matches the demo batch: 6 total, 2 complete, 4 questionable, 2 duplicates", () => {
    const items = demoOcrOverviewItems();
    const summary = summariseOcrOverview(items, defaultSelectedIds(items));

    expect(summary.total).toBe(6);
    expect(summary.complete).toBe(2);
    expect(summary.questionable).toBe(4);
    expect(summary.duplicates).toBe(2);
    expect(summary.selected).toBe(2);
  });

  it("counts only selected ids that still exist", () => {
    const items = demoOcrOverviewItems();

    const summary = summariseOcrOverview(items, ["img0-1", "no-longer-there"]);

    expect(summary.selected).toBe(1);
  });

  it("treats an incomplete item as questionable even without an issue", () => {
    const [first] = demoOcrOverviewItems();

    expect(first).toBeDefined();
    expect(isOcrItemQuestionable(first!)).toBe(false);
    expect(isOcrItemQuestionable({ ...first!, isComplete: false })).toBe(true);
  });
});

describe("default selection", () => {
  it("preselects only complete, non-duplicate, non-questionable items", () => {
    expect(defaultSelectedIds(demoOcrOverviewItems())).toEqual(["img0-1", "img1-1"]);
  });

  it("never preselects a duplicate even when every field is present", () => {
    const items = demoOcrOverviewItems().filter((item) => item.duplicateSuspected);

    expect(items).toHaveLength(2);
    expect(items.every((item) => item.isComplete)).toBe(true);
    expect(defaultSelectedIds(items)).toEqual([]);
  });
});

describe("filters", () => {
  it("shows only the questionable items in the review filter", () => {
    const items = demoOcrOverviewItems();

    const filtered = filterOcrItems(items, "questionable");

    expect(filtered).toHaveLength(4);
    expect(filtered.every(isOcrItemQuestionable)).toBe(true);
    expect(filterOcrItems(items, "all")).toHaveLength(6);
  });
});

describe("selection toggling", () => {
  it("adds and removes ids without mutating the input", () => {
    const original = ["a"];

    expect(withSelectionToggled(original, "b")).toEqual(["a", "b"]);
    expect(withSelectionToggled(original, "a")).toEqual([]);
    expect(original).toEqual(["a"]);
  });
});

describe("detail edit merging", () => {
  it("updates only the matching item and keeps the rest in order", () => {
    const items = demoOcrOverviewItems();

    const updated = applyOcrDetailUpdate(items, "img1-2", { note: "已核对" });

    expect(updated).toHaveLength(6);
    expect(updated[2]?.note).toBe("已核对");
    expect(updated[0]).toBe(items[0]);
    expect(updated.map((item) => item.candidateId)).toEqual(items.map((item) => item.candidateId));
  });

  it("cannot change an item's id through the patch", () => {
    const items = demoOcrOverviewItems();

    const updated = applyOcrDetailUpdate(items, "img0-1", { candidateId: "hijacked" });

    expect(updated[0]?.candidateId).toBe("img0-1");
  });
});

describe("missing values are said out loud", () => {
  it("renders 待确认 instead of an empty or invented value", () => {
    const item = demoOcrOverviewItems()[2]!;

    expect(item.occurredLocalDate).toBeNull();
    expect(dateTimeText(item)).toBe("日期待确认");
    expect(item.merchant).not.toBeNull();
    expect(fieldText(null)).toBe("待确认");
    expect(fieldText("")).toBe("待确认");
    expect(fieldText("已核对")).toBe("已核对");
  });

  it("keeps the amount text exactly as read, without reformatting it", () => {
    expect(amountText(demoOcrOverviewItems()[0]!)).toBe("20.00");
    expect(currencyText(demoOcrOverviewItems()[0]!)).toBe("CNY");
    expect(amountText({ ...demoOcrOverviewItems()[0]!, amount: null })).toBe("待确认");
  });
});
