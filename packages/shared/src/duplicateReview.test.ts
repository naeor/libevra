import { describe, expect, it } from "vitest";

import {
  DEFAULT_DUPLICATE_DETECTION_SETTINGS,
  describeDuplicateMatch,
  evaluateDuplicatePair,
  type DuplicateCandidateFields,
  type DuplicatePairResult,
} from "./duplicateDetection.js";
import {
  duplicateImportReviewRequestSchema,
  duplicateRulesSchema,
  groupDuplicatePairs,
} from "./duplicateReview.js";

/**
 * 统一检测里“给界面用”的那一层：分组、依据文案、请求体的设置解析。
 *
 * 这里不重复测规则本身（`duplicateDetection.test.ts` 已经覆盖金额/时间/分类等），
 * 只测这层新增代码容易犯的错：把组当结论、文案写死、请求体悄悄丢掉设置。
 */

const SETTINGS = DEFAULT_DUPLICATE_DETECTION_SETTINGS;

function candidate(id: string, overrides: Partial<DuplicateCandidateFields> = {}): DuplicateCandidateFields {
  return {
    id,
    bookId: "book-1",
    kind: "expense",
    amountCents: 2_000,
    currency: "CNY",
    occurredAt: "2026-10-21T10:03:00+08:00",
    occurredLocalDate: "2026-10-21",
    categoryId: "cat-1",
    paymentMethodId: "pm-1",
    ...overrides,
  };
}

function pair(left: string, right: string, overrides: Partial<DuplicateCandidateFields> = {}): DuplicatePairResult {
  return evaluateDuplicatePair(candidate(left), candidate(right, overrides), SETTINGS);
}

describe("groupDuplicatePairs", () => {
  it("把 A–B、B–C 折成同一组，而不是两组各显示一半", () => {
    const groups = groupDuplicatePairs([pair("a", "b"), pair("b", "c")]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.ids).toEqual(["a", "b", "c"]);
    expect(groups[0]?.pairs.map((item) => item.pairKey)).toHaveLength(2);
  });

  it("互不相连的配对分成两组，成员多的组排在前面", () => {
    const groups = groupDuplicatePairs([pair("x", "y"), pair("a", "b"), pair("b", "c")]);

    expect(groups.map((group) => group.ids)).toEqual([
      ["a", "b", "c"],
      ["x", "y"],
    ]);
  });

  it("没有配对时返回空数组，不制造空组", () => {
    expect(groupDuplicatePairs([])).toEqual([]);
  });

  it("组的 key 取排序后最小 id，与输入顺序无关", () => {
    const forward = groupDuplicatePairs([pair("b", "c"), pair("a", "b")]);
    const backward = groupDuplicatePairs([pair("a", "b"), pair("b", "c")]);

    expect(forward[0]?.key).toBe("a");
    expect(backward[0]?.key).toBe("a");
  });
});

describe("describeDuplicateMatch", () => {
  it("关闭提醒时明确说不检测，而不是说“没有重复”", () => {
    const result = evaluateDuplicatePair(candidate("a"), candidate("b"), {
      ...SETTINGS,
      enabled: false,
    });

    expect(describeDuplicateMatch(result)).toBe("重复提醒已关闭，本次不进行检测。");
  });

  it("全部字段一致时说“均相同”，并列出真正比对过的字段", () => {
    const text = describeDuplicateMatch(pair("a", "b"));

    expect(text).toBe("收支方向、金额、币种、时间、分类、支付方式均相同。");
  });

  it("关闭分类匹配后，文案里不再出现“分类”", () => {
    const result = evaluateDuplicatePair(candidate("a"), candidate("b"), {
      ...SETTINGS,
      matchCategory: false,
    });

    expect(describeDuplicateMatch(result)).not.toContain("分类");
  });

  it("字段缺失时用中文标签说清楚，不把原始字段名丢给用户", () => {
    const result = pair("a", "b", { categoryId: null, occurredAt: null });

    expect(result.matched).toBe(true);
    const text = describeDuplicateMatch(result);
    expect(text).toContain("分类");
    expect(text).not.toContain("categoryId");
    expect(text).toContain("缺失");
  });

  it("缺失的字段不会被同一句话里说成“相同”", () => {
    const text = describeDuplicateMatch(pair("a", "b", { categoryId: null }));

    // 句子的前半段是“比过且相同的字段”，缺失字段只能出现在后半段。
    const compared = text.split("；")[0] ?? "";
    expect(compared).not.toContain("分类");
    expect(text).toContain("分类缺失");
  });
});

describe("duplicateRulesSchema", () => {
  it("接受商户/备注/标签三个可选开关，并保留它们的值", () => {
    const settings = duplicateRulesSchema.parse({ matchMerchant: true, matchNote: true, matchTags: true });

    expect(settings.matchMerchant).toBe(true);
    expect(settings.matchNote).toBe(true);
    expect(settings.matchTags).toBe(true);
  });

  it("缺省字段回落到默认设置，而不是变成 undefined", () => {
    const settings = duplicateRulesSchema.parse({});

    expect(settings).toMatchObject({
      enabled: true,
      timeWindowSeconds: 60,
      matchCategory: true,
      matchPaymentMethod: true,
    });
  });

  it("未知字段被拒绝，避免前端新加的开关被静默忽略", () => {
    expect(() => duplicateRulesSchema.parse({ matchWeather: true })).toThrow();
  });
});

describe("duplicateImportReviewRequestSchema", () => {
  it("只要求导入编号，设置可选", () => {
    expect(duplicateImportReviewRequestSchema.parse({ importRef: "In-20261021-1" })).toEqual({
      importRef: "In-20261021-1",
    });
    expect(duplicateImportReviewRequestSchema.parse({ importRef: "In-1", settings: { matchCategory: false } })).toMatchObject(
      { importRef: "In-1", settings: { matchCategory: false } },
    );
  });

  it("拒绝空导入编号：那会变成“检查整本账”的另一种说法", () => {
    expect(() => duplicateImportReviewRequestSchema.parse({ importRef: "" })).toThrow();
  });
});
