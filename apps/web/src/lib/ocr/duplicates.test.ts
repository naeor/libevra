import { describe, expect, it } from "vitest";

import { DEFAULT_DUPLICATE_DETECTION_SETTINGS } from "@libellum/shared";

import {
  duplicateReason,
  findSuspectedDuplicates,
  withDuplicateMarks,
} from "./duplicates.js";
import { batchCandidate } from "./testFixtures.js";

/**
 * The duplicate rule is a *prompt*, not a decision.
 *
 * These tests pin the two things the product cares about: the same transaction
 * seen twice is surfaced (same image and across images), and editing a number
 * makes the prompt go away instead of leaving a stale warning.
 */
describe("duplicateReason", () => {
  it("matches equal money in the same direction at the same time", () => {
    // 文案来自统一核心：说清楚比过哪几项，以及哪几项两边都没有（弱依据）。
    expect(duplicateReason(batchCandidate(), batchCandidate({ candidateId: "img1-1" }))).toBe(
      "收支方向、金额、币种、时间相同；分类、支付方式缺失，按较弱依据提示。",
    );
  });

  it("商户匹配默认关闭：不同商户也会提示，由用户决定是否同一笔", () => {
    expect(
      duplicateReason(
        batchCandidate(),
        batchCandidate({ candidateId: "img1-1", merchant: "中石化加油站" }),
      ),
    ).not.toBeNull();
  });

  it("开启商户匹配后按原文严格比较，OCR 文本差异不再自动当作同一笔", () => {
    const settings = { ...DEFAULT_DUPLICATE_DETECTION_SETTINGS, matchMerchant: true };

    expect(
      duplicateReason(
        batchCandidate({ merchant: "Starbucks Coffee" }),
        batchCandidate({ candidateId: "img1-1", merchant: "STARBUCKSCOFFEE" }),
        { settings },
      ),
    ).toBeNull();

    expect(
      duplicateReason(
        batchCandidate({ merchant: "老王便利店" }),
        batchCandidate({ candidateId: "img1-1", merchant: "老王便利店" }),
        { settings },
      ),
    ).not.toBeNull();
  });

  it("uses the 60-second window and refuses a minute later", () => {
    expect(
      duplicateReason(
        batchCandidate({ occurredTime: "12:34" }),
        batchCandidate({ candidateId: "img1-1", occurredTime: "12:35" }),
      ),
    ).not.toBeNull();

    expect(
      duplicateReason(
        batchCandidate({ occurredTime: "12:34" }),
        batchCandidate({ candidateId: "img1-1", occurredTime: "12:36" }),
      ),
    ).toBeNull();
  });

  it("treats a missing time as weak evidence, not a contradiction", () => {
    expect(
      duplicateReason(
        batchCandidate({ occurredTime: null }),
        batchCandidate({ candidateId: "img1-1", occurredTime: "12:34" }),
      ),
    ).toBe("收支方向、金额、币种相同；时间、分类、支付方式缺失，按较弱依据提示。");
  });

  it("never guesses a direction or a date", () => {
    expect(
      duplicateReason(
        batchCandidate({ direction: "unknown" }),
        batchCandidate({ candidateId: "img1-1" }),
      ),
    ).toBeNull();
    expect(
      duplicateReason(
        batchCandidate({ occurredLocalDate: null }),
        batchCandidate({ candidateId: "img1-1" }),
      ),
    ).toBeNull();
  });

  it("defaults to the printed serial when both screens have one", () => {
    const left = batchCandidate({ serial: "4200002318202610091234567890" });
    const right = batchCandidate({
      candidateId: "img1-1",
      serial: "4200002318202610091234567890",
    });
    expect(duplicateReason(left, right)).toBe("交易单号相同");

    expect(
      duplicateReason(left, batchCandidate({ candidateId: "img1-1", serial: "999999999999999" })),
    ).toBeNull();
  });

  it("flags the same serial with a different amount rather than ignoring it", () => {
    expect(
      duplicateReason(
        batchCandidate({ serial: "4200002318202610091234567890" }),
        batchCandidate({
          candidateId: "img1-1",
          serial: "4200002318202610091234567890",
          amount: "21.00",
        }),
      ),
    ).toBe("交易单号相同但金额不同，疑似同一笔，请核对");
  });
});

describe("OCR 适配层接入统一核心", () => {
  it("分类或支付方式不同：默认规则下不提示，关闭匹配后恢复", () => {
    const left = batchCandidate({ categoryId: "cat-a", paymentMethodId: "pay-a" });
    const right = batchCandidate({
      candidateId: "img1-1",
      categoryId: "cat-b",
      paymentMethodId: "pay-b",
    });

    expect(duplicateReason(left, right)).toBeNull();
    expect(
      duplicateReason(left, right, {
        settings: {
          ...DEFAULT_DUPLICATE_DETECTION_SETTINGS,
          matchCategory: false,
          matchPaymentMethod: false,
        },
      }),
    ).not.toBeNull();
  });

  it("用户把窗口改成 5 分钟后，相差 4 分钟的两笔才提示", () => {
    const left = batchCandidate({ occurredTime: "12:00" });
    const right = batchCandidate({ candidateId: "img1-1", occurredTime: "12:04" });

    expect(duplicateReason(left, right)).toBeNull();
    expect(
      duplicateReason(left, right, {
        settings: { ...DEFAULT_DUPLICATE_DETECTION_SETTINGS, timeWindowSeconds: 300 },
      }),
    ).not.toBeNull();
  });

  it("跨日的相邻分钟按真实时间差命中（旧实现要求日期字符串相同）", () => {
    const reason = duplicateReason(
      batchCandidate({ occurredLocalDate: "2026-10-09", occurredTime: "23:59" }),
      batchCandidate({
        candidateId: "img1-1",
        occurredLocalDate: "2026-10-10",
        occurredTime: "00:00",
      }),
    );

    expect(reason).toContain("跨日");
  });

  it("关闭提醒：不分组、不标记，但不会删除或改坏候选", () => {
    const items = [
      batchCandidate(),
      batchCandidate({ candidateId: "img1-1", imageIndex: 1 }),
    ];
    const disabled = {
      settings: { ...DEFAULT_DUPLICATE_DETECTION_SETTINGS, enabled: false },
    };

    expect(findSuspectedDuplicates(items, disabled)).toEqual([]);
    expect(duplicateReason(items[0]!, items[1]!, disabled)).toBeNull();

    const marked = withDuplicateMarks(items, disabled);
    expect(marked.groups).toEqual([]);
    expect(marked.items).toHaveLength(2);
    expect(marked.items.every((item) => !item.duplicateSuspected && !item.invalid)).toBe(true);
  });
});

describe("findSuspectedDuplicates", () => {
  it("separates overlaps inside one screenshot from overlaps across screenshots", () => {
    const groups = findSuspectedDuplicates([
      batchCandidate({ candidateId: "img0-1" }),
      // Same image, same money: an overlap inside a long screenshot.
      batchCandidate({ candidateId: "img0-2" }),
      // Another screenshot showing the same transaction.
      batchCandidate({ candidateId: "img1-1", imageIndex: 1 }),
    ]);

    expect(groups.map((group) => group.kind)).toEqual(["same-image", "cross-image"]);
    expect(groups.map((group) => group.candidateIds)).toEqual([
      ["img0-1", "img0-2"],
      // All three screenshots show the same money, so the cross-image component
      // contains the in-image pair as well: one decision, not two conflicting ones.
      ["img0-1", "img0-2", "img1-1"],
    ]);
    // The second screenshot's candidate appears in a cross-image group too; each
    // candidate is not restricted to one group.
    expect(groups[1]?.message).toContain("重复上传");
  });

  it("does not link two unrelated rows of the same amount on the same day", () => {
    expect(
      findSuspectedDuplicates([
        batchCandidate({ candidateId: "img0-1", occurredTime: "09:00", merchant: "早餐店" }),
        batchCandidate({ candidateId: "img0-2", occurredTime: "18:00", merchant: "晚餐店" }),
      ]),
    ).toEqual([]);
  });
});

describe("withDuplicateMarks", () => {
  it("marks both copies and keeps the user's edits authoritative", () => {
    const first = withDuplicateMarks([
      batchCandidate(),
      batchCandidate({ candidateId: "img1-1", imageIndex: 1 }),
    ]);

    expect(first.groups).toHaveLength(1);
    expect(first.items.every((item) => item.duplicateSuspected)).toBe(true);

    // The user changes the amount in the detail screen: the prompt must vanish.
    const edited = first.items.map((item) =>
      item.candidateId === "img1-1" ? { ...item, amount: "21.00" } : item,
    );
    const second = withDuplicateMarks(edited);

    expect(second.groups).toEqual([]);
    expect(second.items.every((item) => !item.duplicateSuspected)).toBe(true);
  });

  it("never deletes or invalidates a candidate", () => {
    const items = [batchCandidate(), batchCandidate({ candidateId: "img0-2" })];
    const marked = withDuplicateMarks(items);

    expect(marked.items).toHaveLength(2);
    expect(marked.items.every((item) => item.invalid === false)).toBe(true);
  });
});
