import { describe, expect, it } from "vitest";

import {
  DEFAULT_DUPLICATE_DETECTION_SETTINGS,
  DUPLICATE_TIME_WINDOW_MAX_SECONDS,
  DUPLICATE_TIME_WINDOW_MIN_SECONDS,
  DUPLICATE_TIME_WINDOW_PRESETS_SECONDS,
  duplicatePairKey,
  evaluateDuplicateCandidates,
  evaluateDuplicatePair,
  recoverDuplicateDetectionSettings,
  validateDuplicateDetectionSettings,
  type DuplicateCandidateFields,
  type DuplicateDetectionSettings,
} from "./duplicateDetection.js";

/**
 * S15-E2 统一重复检测核心的固定样本。
 *
 * 这些用例就是“规则说明”的可执行版本：时间边界、跨分钟/跨日/时区、金额与币种、
 * 分类/支付方式的缺失与不一致、不同账本隔离、配置校验与恢复、批量复用。
 */

function candidate(overrides: Partial<DuplicateCandidateFields> = {}): DuplicateCandidateFields {
  return {
    id: "left",
    bookId: "book-1",
    kind: "expense",
    amountCents: 1_234,
    currency: "CNY",
    occurredAt: "2026-10-21T10:00:00.000Z",
    occurredAtPrecision: "second",
    occurredLocalDate: "2026-10-21",
    categoryId: "cat-food",
    paymentMethodId: "pay-wechat",
    ...overrides,
  };
}

function right(overrides: Partial<DuplicateCandidateFields> = {}): DuplicateCandidateFields {
  return candidate({ id: "right", ...overrides });
}

function settings(overrides: Partial<DuplicateDetectionSettings> = {}): DuplicateDetectionSettings {
  return { ...DEFAULT_DUPLICATE_DETECTION_SETTINGS, ...overrides };
}

describe("默认配置", () => {
  it("开启提醒、60 秒、比较金额/币种/方向/时间/分类/支付方式", () => {
    expect(DEFAULT_DUPLICATE_DETECTION_SETTINGS).toEqual({
      enabled: true,
      timeWindowSeconds: 60,
      matchAmount: true,
      matchCurrency: true,
      matchKind: true,
      matchTime: true,
      matchMerchant: false,
      matchNote: false,
      matchTags: false,
      matchCategory: true,
      matchPaymentMethod: true,
    });
    expect(DUPLICATE_TIME_WINDOW_MIN_SECONDS).toBe(1);
    expect(DUPLICATE_TIME_WINDOW_MAX_SECONDS).toBe(2_592_000);
    expect(DUPLICATE_TIME_WINDOW_PRESETS_SECONDS).toEqual([60, 300, 1_800, 3_600, 86_400]);
    expect(validateDuplicateDetectionSettings(DEFAULT_DUPLICATE_DETECTION_SETTINGS)).toMatchObject({
      ok: true,
    });
  });
});

describe("时间窗口：真实时间差而不是 HH:mm 字符串", () => {
  it("默认 60 秒：59 / 60 秒命中，61 秒不命中", () => {
    const base = candidate();

    expect(
      evaluateDuplicatePair(base, right({ occurredAt: "2026-10-21T10:00:59.000Z" })).matched,
    ).toBe(true);
    expect(
      evaluateDuplicatePair(base, right({ occurredAt: "2026-10-21T10:01:00.000Z" })).matched,
    ).toBe(true);

    const outside = evaluateDuplicatePair(
      base,
      right({ occurredAt: "2026-10-21T10:01:01.000Z" }),
    );
    expect(outside.matched).toBe(false);
    expect(outside.exclusionCodes).toContain("time_outside_window");
    expect(outside.timeDifferenceSeconds).toBe(61);
  });

  it("跨分钟按实际时间差计算", () => {
    const result = evaluateDuplicatePair(
      candidate({ occurredAt: "2026-10-21T10:00:30.000Z" }),
      right({ occurredAt: "2026-10-21T10:01:00.000Z" }),
    );

    expect(result.matched).toBe(true);
    expect(result.timeDifferenceSeconds).toBe(30);
  });

  it("跨日按实际时间差计算：23:59:30 与次日 00:00:20 相差 50 秒", () => {
    const result = evaluateDuplicatePair(
      candidate({
        occurredAt: "2026-10-21T23:59:30.000Z",
        occurredLocalDate: "2026-10-21",
      }),
      right({
        occurredAt: "2026-10-22T00:00:20.000Z",
        occurredLocalDate: "2026-10-22",
      }),
    );

    expect(result.matched).toBe(true);
    expect(result.timeDifferenceSeconds).toBe(50);
    expect(result.missingFields).toEqual([]);
  });

  it("时区不同但实际是同一时刻附近：+08:00 与 Z 相差 30 秒", () => {
    const result = evaluateDuplicatePair(
      candidate({ occurredAt: "2026-10-21T18:00:00+08:00" }),
      right({ occurredAt: "2026-10-21T10:00:30Z" }),
    );

    expect(result.matched).toBe(true);
    expect(result.timeDifferenceSeconds).toBe(30);
  });

  it("无时区偏移的 ISO 字符串视为缺失，不做跨环境猜测", () => {
    const result = evaluateDuplicatePair(
      candidate({ occurredAt: "2026-10-21T10:00:00" }),
      right({ occurredAt: "2026-10-21T10:00:30" }),
    );

    expect(result.matched).toBe(true);
    expect(result.evidence).toBe("weak");
    expect(result.missingFields).toContain("occurredAt");
    expect(result.rules.find((rule) => rule.rule === "time")?.outcome).toBe("missing");
  });

  it("只有日期精度（day）时不把中午 12:00 当成真实时间", () => {
    const result = evaluateDuplicatePair(
      candidate({ occurredAt: "2026-10-21T12:00:00.000Z", occurredAtPrecision: "day" }),
      right({ occurredAt: "2026-10-21T12:00:30.000Z", occurredAtPrecision: "day" }),
    );

    expect(result.matched).toBe(true);
    expect(result.evidence).toBe("weak");
    expect(result.missingFields).toContain("occurredAt");
  });

  it("时间缺失但日期相同：弱证据命中；日期不同：排除", () => {
    const sameDay = evaluateDuplicatePair(
      candidate({ occurredAt: null, occurredLocalDate: "2026-10-21" }),
      right({ occurredAt: null, occurredLocalDate: "2026-10-21" }),
    );
    expect(sameDay.matched).toBe(true);
    expect(sameDay.evidence).toBe("weak");

    const differentDay = evaluateDuplicatePair(
      candidate({ occurredAt: null, occurredLocalDate: "2026-10-21" }),
      right({ occurredAt: null, occurredLocalDate: "2026-10-22" }),
    );
    expect(differentDay.matched).toBe(false);
    expect(differentDay.exclusionCodes).toContain("date_mismatch");
    expect(differentDay.mismatchedFields).toContain("occurredLocalDate");
  });

  it("时间与日期都没有：没有时间依据，排除并记为缺失", () => {
    const result = evaluateDuplicatePair(
      candidate({ occurredAt: null, occurredLocalDate: null }),
      right({ occurredAt: null, occurredLocalDate: null }),
    );

    expect(result.matched).toBe(false);
    expect(result.exclusionCodes).toContain("time_missing");
    expect(result.missingFields).toContain("occurredAt");
  });

  it("自定义窗口改变判定结果", () => {
    const left = candidate({ occurredAt: "2026-10-21T10:00:00.000Z" });
    const fourMinutesLater = right({ occurredAt: "2026-10-21T10:04:00.000Z" });

    expect(evaluateDuplicatePair(left, fourMinutesLater).matched).toBe(false);
    expect(
      evaluateDuplicatePair(left, fourMinutesLater, settings({ timeWindowSeconds: 300 })).matched,
    ).toBe(true);
  });
});

describe("金额与币种", () => {
  it("金额完全相等才命中；整数最小单位，不做浮点近似", () => {
    expect(evaluateDuplicatePair(candidate(), right()).matched).toBe(true);

    const different = evaluateDuplicatePair(candidate(), right({ amountCents: 1_235 }));
    expect(different.matched).toBe(false);
    expect(different.exclusionCodes).toContain("amount_mismatch");
    expect(different.mismatchedFields).toContain("amountCents");
  });

  it("缺失金额与非法金额分别报告", () => {
    expect(
      evaluateDuplicatePair(candidate({ amountCents: null }), right()).exclusionCodes,
    ).toContain("amount_missing");
    expect(
      evaluateDuplicatePair(candidate({ amountCents: Number.NaN }), right()).exclusionCodes,
    ).toContain("amount_invalid");
    expect(
      evaluateDuplicatePair(candidate({ amountCents: 12.5 }), right()).exclusionCodes,
    ).toContain("amount_invalid");
    expect(
      evaluateDuplicatePair(candidate({ amountCents: 0 }), right()).exclusionCodes,
    ).toContain("amount_invalid");
  });

  it("同金额不同币种不命中；缺币种单独报告", () => {
    const differentCurrency = evaluateDuplicatePair(candidate(), right({ currency: "USD" }));
    expect(differentCurrency.matched).toBe(false);
    expect(differentCurrency.exclusionCodes).toContain("currency_mismatch");

    expect(
      evaluateDuplicatePair(candidate({ currency: null }), right()).exclusionCodes,
    ).toContain("currency_missing");
  });

  it("币种大小写与空白被规范化后比较", () => {
    expect(evaluateDuplicatePair(candidate({ currency: "cny " }), right({ currency: "CNY" })).matched).toBe(
      true,
    );
  });
});

describe("分类", () => {
  it("双方分类一致：通过", () => {
    const result = evaluateDuplicatePair(candidate(), right());

    expect(result.matched).toBe(true);
    expect(result.rules.find((rule) => rule.rule === "category")).toMatchObject({
      outcome: "passed",
      code: null,
    });
  });

  it("双方分类不同：排除", () => {
    const result = evaluateDuplicatePair(candidate(), right({ categoryId: "cat-shopping" }));

    expect(result.matched).toBe(false);
    expect(result.exclusionCodes).toContain("category_mismatch");
    expect(result.mismatchedFields).toContain("categoryId");
  });

  it("只有一方有分类：记为缺失，但不排除", () => {
    const result = evaluateDuplicatePair(candidate(), right({ categoryId: null }));

    expect(result.matched).toBe(true);
    expect(result.missingFields).toContain("categoryId");
    expect(result.rules.find((rule) => rule.rule === "category")?.outcome).toBe("missing");
    expect(result.evidence).toBe("weak");
  });

  it("双方都没有分类：不排除", () => {
    const result = evaluateDuplicatePair(
      candidate({ categoryId: null }),
      right({ categoryId: null }),
    );

    expect(result.matched).toBe(true);
    expect(result.missingFields).toContain("categoryId");
  });

  it("关闭分类匹配后，不同分类也不排除", () => {
    const result = evaluateDuplicatePair(
      candidate(),
      right({ categoryId: "cat-shopping" }),
      settings({ matchCategory: false }),
    );

    expect(result.matched).toBe(true);
    expect(result.rules.find((rule) => rule.rule === "category")).toMatchObject({
      outcome: "skipped",
      code: null,
    });
    expect(result.missingFields).not.toContain("categoryId");
  });
});

describe("支付方式", () => {
  it("双方一致：通过", () => {
    expect(evaluateDuplicatePair(candidate(), right()).matched).toBe(true);
  });

  it("双方不同：排除", () => {
    const result = evaluateDuplicatePair(candidate(), right({ paymentMethodId: "pay-alipay" }));

    expect(result.matched).toBe(false);
    expect(result.exclusionCodes).toContain("payment_method_mismatch");
    expect(result.mismatchedFields).toContain("paymentMethodId");
  });

  it("只有一方有：记为缺失，不排除", () => {
    const result = evaluateDuplicatePair(candidate(), right({ paymentMethodId: null }));

    expect(result.matched).toBe(true);
    expect(result.missingFields).toContain("paymentMethodId");
  });

  it("双方都没有：不排除", () => {
    const result = evaluateDuplicatePair(
      candidate({ paymentMethodId: null }),
      right({ paymentMethodId: null }),
    );

    expect(result.matched).toBe(true);
    expect(result.missingFields).toContain("paymentMethodId");
  });

  it("关闭支付方式匹配后，不同支付方式也不排除", () => {
    const result = evaluateDuplicatePair(
      candidate(),
      right({ paymentMethodId: "pay-alipay" }),
      settings({ matchPaymentMethod: false }),
    );

    expect(result.matched).toBe(true);
    expect(result.rules.find((rule) => rule.rule === "paymentMethod")?.outcome).toBe("skipped");
  });
});

describe("账本、方向与边界", () => {
  it("不同账本永不构成重复", () => {
    const result = evaluateDuplicatePair(candidate(), right({ bookId: "book-2" }));

    expect(result.matched).toBe(false);
    expect(result.exclusionCodes).toContain("book_mismatch");
    expect(result.mismatchedFields).toContain("bookId");
  });

  it("缺少账本信息时排除", () => {
    expect(
      evaluateDuplicatePair(candidate({ bookId: " " }), right()).exclusionCodes,
    ).toContain("book_missing");
  });

  it("普通收入与支出不互为重复；方向未知不猜", () => {
    const mismatch = evaluateDuplicatePair(candidate(), right({ kind: "income" }));
    expect(mismatch.matched).toBe(false);
    expect(mismatch.exclusionCodes).toContain("kind_mismatch");

    const unknown = evaluateDuplicatePair(candidate({ kind: "unknown" }), right());
    expect(unknown.matched).toBe(false);
    expect(unknown.exclusionCodes).toContain("kind_unknown");
  });

  it("关闭提醒只返回 suppressed，不产生 matched", () => {
    const result = evaluateDuplicatePair(candidate(), right(), settings({ enabled: false }));

    expect(result.matched).toBe(false);
    expect(result.suppressed).toBe(true);
    expect(result.exclusionCodes).toEqual(["reminders_disabled"]);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]?.rule).toBe("reminders");
    expect(result.settings.enabled).toBe(false);
  });

  it("左右交换不改变结论与 pairKey", () => {
    const leftCandidate = candidate({ id: "a" });
    const rightCandidate = right({ id: "b", occurredAt: "2026-10-21T10:02:00.000Z" });

    const forward = evaluateDuplicatePair(leftCandidate, rightCandidate);
    const backward = evaluateDuplicatePair(rightCandidate, leftCandidate);

    expect(backward.matched).toBe(forward.matched);
    expect(backward.pairKey).toBe(forward.pairKey);
    expect(backward.exclusionCodes).toEqual(forward.exclusionCodes);
    expect(duplicatePairKey("b", "a")).toBe(duplicatePairKey("a", "b"));
  });

  it("结果保留 E3 预留字段但本轮不参与判断", () => {
    const result = evaluateDuplicatePair(candidate(), right());

    expect(result.extensions).toEqual({
      sourceTransactionIds: [],
      userConfirmedRelation: null,
    });
  });

  it("不修改传入对象", () => {
    const leftCandidate = candidate();
    const rightCandidate = right();
    const before = JSON.stringify({ leftCandidate, rightCandidate });

    evaluateDuplicatePair(leftCandidate, rightCandidate, settings({ matchCategory: false }));

    expect(JSON.stringify({ leftCandidate, rightCandidate })).toBe(before);
  });
});

describe("设置校验与恢复默认", () => {
  it("合法配置通过校验并原样返回", () => {
    const result = validateDuplicateDetectionSettings({
      enabled: false,
      timeWindowSeconds: 300,
      matchCategory: false,
      matchPaymentMethod: true,
    });

    expect(result).toMatchObject({
      ok: true,
      settings: {
        enabled: false,
        timeWindowSeconds: 300,
        matchCategory: false,
        matchPaymentMethod: true,
      },
      unknownFields: [],
    });
  });

  it("时间窗口的负数、0、NaN、Infinity、小数与超上限都被拒绝", () => {
    const cases: readonly (readonly [string, number, string])[] = [
      ["负数", -1, "below_minimum"],
      ["0", 0, "below_minimum"],
      ["NaN", Number.NaN, "not_integer"],
      ["Infinity", Number.POSITIVE_INFINITY, "not_integer"],
      ["小数", 1.5, "not_integer"],
      ["超过 30 天", DUPLICATE_TIME_WINDOW_MAX_SECONDS + 1, "above_maximum"],
    ];

    for (const [label, seconds, code] of cases) {
      const result = validateDuplicateDetectionSettings({
        ...DEFAULT_DUPLICATE_DETECTION_SETTINGS,
        timeWindowSeconds: seconds,
      });

      expect(result.ok, label).toBe(false);
      if (!result.ok) {
        expect(result.issues.map((issue) => issue.code), label).toContain(code);
        expect(result.issues.every((issue) => issue.message.length > 0), label).toBe(true);
      }
    }
  });

  it("非对象、未知字段、缺失字段、错误类型都被拒绝", () => {
    expect(validateDuplicateDetectionSettings(null)).toMatchObject({
      ok: false,
      issues: [{ code: "not_object" }],
    });
    expect(validateDuplicateDetectionSettings([])).toMatchObject({ ok: false });

    const unknown = validateDuplicateDetectionSettings({
      ...DEFAULT_DUPLICATE_DETECTION_SETTINGS,
      timeWindowSecs: 60,
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.issues).toContainEqual(expect.objectContaining({ code: "unknown_field" }));

    const missing = validateDuplicateDetectionSettings({ enabled: true });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.issues.map((issue) => issue.code)).toContain("missing");

    const wrongType = validateDuplicateDetectionSettings({
      ...DEFAULT_DUPLICATE_DETECTION_SETTINGS,
      enabled: "true",
    });
    expect(wrongType.ok).toBe(false);
    if (!wrongType.ok) expect(wrongType.issues.map((issue) => issue.code)).toContain("not_boolean");
  });

  it("恢复函数对损坏数据回落到默认值，并报告用到的默认字段", () => {
    const result = recoverDuplicateDetectionSettings({
      enabled: false,
      timeWindowSeconds: -10,
      matchCategory: "yes",
      legacyField: true,
    });

    expect(result.settings).toEqual({
      enabled: false,
      timeWindowSeconds: 60,
      matchCategory: true,
      matchPaymentMethod: true,
    });
    expect(result.usedDefaults).toEqual(["matchCategory", "matchPaymentMethod", "timeWindowSeconds"]);
    expect(result.unknownFields).toEqual(["legacyField"]);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["not_boolean", "below_minimum", "unknown_field"]),
    );
  });

  it("恢复函数对完全不可读的值不抛异常", () => {
    for (const value of [null, "x", 42, [], { timeWindowSeconds: Number.POSITIVE_INFINITY }]) {
      const result = recoverDuplicateDetectionSettings(value);
      expect(result.settings.timeWindowSeconds).toBe(60);
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });

  it("恢复默认设置 = 默认配置", () => {
    const recovered = recoverDuplicateDetectionSettings(
      DEFAULT_DUPLICATE_DETECTION_SETTINGS,
    );

    expect(recovered.settings).toEqual(DEFAULT_DUPLICATE_DETECTION_SETTINGS);
    expect(recovered.usedDefaults).toEqual([]);
    expect(recovered.issues).toEqual([]);
  });
});

describe("批量候选判断", () => {
  it("每个组合都复用单对规则，结果稳定排序", () => {
    const a = candidate({ id: "a", occurredAt: "2026-10-21T10:00:00.000Z" });
    const b = candidate({ id: "b", occurredAt: "2026-10-21T10:00:30.000Z" });
    const c = candidate({ id: "c", occurredAt: "2026-10-21T10:01:20.000Z" });

    const batch = evaluateDuplicateCandidates([a, b, c]);

    // a-b 30s、b-c 50s 命中；a-c 80s 不命中。
    expect(batch.pairs.map((pair) => [pair.leftId, pair.rightId])).toEqual([
      ["a", "b"],
      ["b", "c"],
    ]);
    expect(batch.evaluatedPairs).toBe(3);
    expect(batch.suppressed).toBe(false);
    expect(batch.pairs.every((pair) => pair.matched)).toBe(true);
    expect(batch.pairs[0]?.pairKey).toBe(duplicatePairKey("a", "b"));
  });

  it("同一 id 只保留一条，空 id 被忽略", () => {
    const batch = evaluateDuplicateCandidates([
      candidate({ id: "a" }),
      candidate({ id: "a", amountCents: 9_999 }),
      candidate({ id: " " }),
    ]);

    expect(batch.pairs).toEqual([]);
    expect(batch.evaluatedPairs).toBe(0);
  });

  it("不同账本即使同金额也不进入同一桶", () => {
    const batch = evaluateDuplicateCandidates([
      candidate({ id: "a", bookId: "book-1" }),
      candidate({ id: "b", bookId: "book-2" }),
    ]);

    expect(batch.pairs).toEqual([]);
  });

  it("关闭提醒时批量判断不执行", () => {
    const batch = evaluateDuplicateCandidates(
      [candidate({ id: "a" }), candidate({ id: "b" })],
      settings({ enabled: false }),
    );

    expect(batch.suppressed).toBe(true);
    expect(batch.pairs).toEqual([]);
    expect(batch.evaluatedPairs).toBe(0);
  });

  it("分类/支付方式设置对批量结果生效", () => {
    const candidates = [
      candidate({ id: "a", categoryId: "cat-food" }),
      candidate({ id: "b", categoryId: "cat-shopping" }),
    ];

    expect(evaluateDuplicateCandidates(candidates).pairs).toHaveLength(0);
    expect(
      evaluateDuplicateCandidates(candidates, settings({ matchCategory: false })).pairs,
    ).toHaveLength(1);
  });
});
