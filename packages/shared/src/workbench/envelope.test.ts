import { describe, expect, it } from "vitest";

import {
  ANALYSIS_PROTOCOL_VERSION,
  ANALYSIS_ROUNDING_POLICY,
  buildAnalysisEnvelope,
  type AnalysisCompleteness,
  type AnalysisResultBase,
  type ComputationMetadata,
  type EnvelopeBuildInput,
  type ResolvedFilters,
  type ResolvedPeriod,
  type S01V2Envelope,
  type SourceDescriptor,
} from "./envelope.js";
import { runLayoutPipeline } from "./pipeline.js";

/**
 * B 移动平均卡真实示例载荷（来源：B 移动平均卡接口说明 `394b70c` §7，
 * 原数据来自 `apps/web/src/lib/s4b.analysisData.test.ts`）。
 *
 * 仅作为 I-1b 测试夹具使用：字段形状按 B 文档描述本地声明，**不 import B 代码**。
 */
interface MovingAveragePointLike {
  readonly date: string;
  readonly state: "complete" | "in-progress" | "unknown";
  readonly rawMinor: string | null;
  readonly average: { readonly numeratorMinor: string; readonly denominatorDays: number } | null;
  readonly averageScaledMinor: string | null;
  readonly gapReason: "window-incomplete" | null;
}

interface MovingAverageResultLike {
  readonly version: "s17-b-moving-average-v1";
  readonly windowDays: number;
  readonly trailing: true;
  readonly granularity: "day";
  readonly gapPolicy: "require-complete-window";
  readonly scale: number;
  readonly complete: boolean;
  readonly points: readonly MovingAveragePointLike[];
  readonly observedDays: number;
  readonly computablePoints: number;
  readonly unknownWindowPoints: number;
  readonly missingHistoryPoints: number;
}

/** 示例 A：A13 7 天窗口 + 历史补读（来源：B 接口说明 `394b70c` §7 示例 A）。 */
const B_MOVING_AVERAGE_SEVEN_DAY: MovingAverageResultLike = {
  version: "s17-b-moving-average-v1",
  windowDays: 7,
  trailing: true,
  granularity: "day",
  gapPolicy: "require-complete-window",
  scale: 4,
  complete: true,
  points: [
    {
      date: "2026-10-07",
      state: "complete",
      rawMinor: "0",
      average: { numeratorMinor: "70000", denominatorDays: 7 },
      averageScaledMinor: "100000000",
      gapReason: null,
    },
    {
      date: "2026-10-08",
      state: "complete",
      rawMinor: "0",
      average: { numeratorMinor: "0", denominatorDays: 7 },
      averageScaledMinor: "0",
      gapReason: null,
    },
    {
      date: "2026-10-09",
      state: "complete",
      rawMinor: "0",
      average: { numeratorMinor: "0", denominatorDays: 7 },
      averageScaledMinor: "0",
      gapReason: null,
    },
  ],
  observedDays: 3,
  computablePoints: 3,
  unknownWindowPoints: 0,
  missingHistoryPoints: 0,
};

/** 示例 B：A14 30 天窗口（来源：B 接口说明 `394b70c` §7 示例 B）。 */
const B_MOVING_AVERAGE_THIRTY_DAY: MovingAverageResultLike = {
  version: "s17-b-moving-average-v1",
  windowDays: 30,
  trailing: true,
  granularity: "day",
  gapPolicy: "require-complete-window",
  scale: 4,
  complete: true,
  points: [
    {
      date: "2026-10-30",
      state: "complete",
      rawMinor: "0",
      average: { numeratorMinor: "30000", denominatorDays: 30 },
      averageScaledMinor: "10000000",
      gapReason: null,
    },
  ],
  observedDays: 1,
  computablePoints: 1,
  unknownWindowPoints: 0,
  missingHistoryPoints: 0,
};

/** 示例 C：B-Q20 进行中的今天被排除（来源：B 接口说明 `394b70c` §7 示例 C）。 */
const B_MOVING_AVERAGE_TODAY_EXCLUDED: MovingAverageResultLike = {
  version: "s17-b-moving-average-v1",
  windowDays: 7,
  trailing: true,
  granularity: "day",
  gapPolicy: "require-complete-window",
  scale: 4,
  complete: false,
  points: [
    {
      date: "2026-10-20",
      state: "complete",
      rawMinor: "0",
      average: { numeratorMinor: "10000", denominatorDays: 7 },
      averageScaledMinor: "14285714",
      gapReason: null,
    },
    {
      date: "2026-10-27",
      state: "in-progress",
      rawMinor: null,
      average: null,
      averageScaledMinor: null,
      gapReason: "window-incomplete",
    },
  ],
  observedDays: 2,
  computablePoints: 7,
  unknownWindowPoints: 1,
  missingHistoryPoints: 0,
};

const PERIOD: ResolvedPeriod = { from: "2026-10-01", to: "2026-10-09", dayCount: 9 };
const FILTERS: ResolvedFilters = {
  kind: "expense",
  categoryIds: null,
  paymentMethodIds: null,
  tagIds: null,
  currency: "CNY",
};

function makeSource(overrides: Partial<SourceDescriptor> = {}): SourceDescriptor {
  return {
    analysisId: "AN-T01",
    period: PERIOD,
    filters: FILTERS,
    groupBy: null,
    query: { kind: "transactions", from: "2026-10-01", to: "2026-10-09", currency: "CNY" },
    dataVersion: "dv-2026-10-27",
    ...overrides,
  };
}

function makeComputation(overrides: Partial<ComputationMetadata> = {}): ComputationMetadata {
  return { rounding: ANALYSIS_ROUNDING_POLICY, method: "trailing-average", sampleCount: 7, ...overrides };
}

function makeInput<TPayload>(
  payload: TPayload,
  overrides: Partial<EnvelopeBuildInput<TPayload>> = {},
): EnvelopeBuildInput<TPayload> {
  return {
    analysisId: "AN-T01",
    analysisType: "time.moving-average",
    metric: "money",
    resolvedFilters: FILTERS,
    resolvedPeriod: PERIOD,
    resolvedCurrency: { mode: "original", currency: "CNY" },
    completeness: "complete",
    dataVersion: "dv-2026-10-27",
    computation: makeComputation(),
    source: makeSource(),
    shape: "moving-average",
    payload,
    ...overrides,
  };
}

function codes(result: { ok: boolean; issues?: readonly { code: string }[] }): readonly string[] {
  return result.ok ? [] : (result.issues ?? []).map((item) => item.code);
}

describe("I-1b buildAnalysisEnvelope：字段映射", () => {
  it("13 个公开字段逐一映射，version 固定 s01-v2，payload 原样引用", () => {
    const input = makeInput(B_MOVING_AVERAGE_SEVEN_DAY);
    const result = buildAnalysisEnvelope(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const envelope = result.envelope;
    expect(envelope.version).toBe(ANALYSIS_PROTOCOL_VERSION);
    expect(envelope.version).toBe("s01-v2");
    expect(envelope.analysisId).toBe("AN-T01");
    expect(envelope.analysisType).toBe("time.moving-average");
    expect(envelope.metric).toBe("money");
    expect(envelope.resolvedFilters).toEqual(FILTERS);
    expect(envelope.resolvedPeriod).toEqual(PERIOD);
    expect(envelope.resolvedCurrency).toEqual({ mode: "original", currency: "CNY" });
    expect(envelope.completeness).toBe("complete");
    expect(envelope.dataVersion).toBe("dv-2026-10-27");
    expect(envelope.computation).toEqual(makeComputation());
    expect(envelope.source).toEqual(makeSource());
    expect(envelope.shape).toBe("moving-average");
    // 载荷 pass-through：不解包、不复制、不增删字段。
    expect(envelope.payload).toBe(B_MOVING_AVERAGE_SEVEN_DAY);
    expect(envelope.payload.points[0]?.average).toEqual({ numeratorMinor: "70000", denominatorDays: 7 });
  });

  it("A14 30 天示例与 B-Q20 示例可原样组装（不改 payload）", () => {
    const thirty = buildAnalysisEnvelope(makeInput(B_MOVING_AVERAGE_THIRTY_DAY));
    expect(thirty.ok).toBe(true);
    if (thirty.ok) {
      expect(thirty.envelope.payload.windowDays).toBe(30);
      expect(thirty.envelope.payload.points[0]?.average).toEqual({ numeratorMinor: "30000", denominatorDays: 30 });
    }

    const excluded = buildAnalysisEnvelope(
      makeInput(B_MOVING_AVERAGE_TODAY_EXCLUDED, { completeness: "partial", unavailableReason: "window-incomplete" }),
    );
    expect(excluded.ok).toBe(true);
    if (excluded.ok) {
      expect(excluded.envelope.completeness).toBe("partial");
      expect(excluded.envelope.unavailableReason).toBe("window-incomplete");
      expect(excluded.envelope.payload.complete).toBe(false);
      expect(excluded.envelope.payload.points[1]?.state).toBe("in-progress");
      expect(excluded.envelope.payload.points[1]?.average).toBeNull();
    }
  });
});

describe("I-1b buildAnalysisEnvelope：完整性规则", () => {
  it("completeness 9 态全部可组装（需 reason 的态按规则传入）", () => {
    const values: readonly AnalysisCompleteness[] = [
      "complete",
      "no-transactions",
      "partial",
      "fx-incomplete",
      "offline-incomplete",
      "loading",
      "request-failed",
      "no-permission",
      "not-applicable",
    ];
    for (const completeness of values) {
      const needsReason = !(completeness === "complete" || completeness === "no-transactions");
      const result = buildAnalysisEnvelope(
        makeInput(B_MOVING_AVERAGE_SEVEN_DAY, {
          completeness,
          ...(needsReason ? { unavailableReason: `reason:${completeness}` } : {}),
        }),
      );
      expect(result.ok, `completeness=${completeness}`).toBe(true);
    }
  });

  it("非法 completeness 拒绝（envelope-invalid-completeness）", () => {
    const result = buildAnalysisEnvelope(
      makeInput(B_MOVING_AVERAGE_SEVEN_DAY, { completeness: "weird" as unknown as AnalysisCompleteness }),
    );
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("envelope-invalid-completeness");
  });

  it("complete=false 必须提供 unavailableReason；complete 不应携带", () => {
    const missing = buildAnalysisEnvelope(makeInput(B_MOVING_AVERAGE_SEVEN_DAY, { completeness: "partial" }));
    expect(missing.ok).toBe(false);
    expect(codes(missing)).toContain("envelope-unavailable-reason-required");

    const unexpected = buildAnalysisEnvelope(
      makeInput(B_MOVING_AVERAGE_SEVEN_DAY, { completeness: "complete", unavailableReason: "oops" }),
    );
    expect(unexpected.ok).toBe(false);
    expect(codes(unexpected)).toContain("envelope-unavailable-reason-unexpected");
  });
});

describe("I-1b buildAnalysisEnvelope：shape 与 payload 一致性", () => {
  it("allowedShapes 白名单：moving-average 通过，未知 shape 拒绝（不硬编码形状）", () => {
    const allowed = ["moving-average"] as const;
    const ok = buildAnalysisEnvelope(makeInput(B_MOVING_AVERAGE_SEVEN_DAY), { allowedShapes: allowed });
    expect(ok.ok).toBe(true);

    const rejected = buildAnalysisEnvelope(
      makeInput(B_MOVING_AVERAGE_SEVEN_DAY, { shape: "unknown-shape" }),
      { allowedShapes: allowed },
    );
    expect(rejected.ok).toBe(false);
    expect(codes(rejected)).toContain("envelope-shape-not-allowed");

    // 不传白名单时只要求非空：其他形状（如 time-series）不被本模块拒绝。
    const unconstrained = buildAnalysisEnvelope(makeInput(B_MOVING_AVERAGE_SEVEN_DAY, { shape: "time-series" }));
    expect(unconstrained.ok).toBe(true);
  });

  it("isEmptyPayload 只做一致性校验：空载荷→须 no-transactions；非空→不得 no-transactions", () => {
    const options = {
      isEmptyPayload: (payload: MovingAverageResultLike) => payload.points.length === 0,
    };
    const emptyPayload = B_MOVING_AVERAGE_SEVEN_DAY;

    // 空 payload + no-transactions：通过。
    const ok = buildAnalysisEnvelope(
      makeInput({ ...emptyPayload, points: [] }, { completeness: "no-transactions" }),
      options,
    );
    expect(ok.ok).toBe(true);

    // 空 payload 但 completeness=complete：拒绝（builder 不改写 completeness）。
    const mismatchEmpty = buildAnalysisEnvelope(makeInput({ ...emptyPayload, points: [] }), options);
    expect(mismatchEmpty.ok).toBe(false);
    expect(codes(mismatchEmpty)).toContain("envelope-payload-completeness-mismatch");

    // 非空 payload 但 completeness=no-transactions：拒绝。
    const mismatchFull = buildAnalysisEnvelope(
      makeInput(emptyPayload, { completeness: "no-transactions" }),
      options,
    );
    expect(mismatchFull.ok).toBe(false);
    expect(codes(mismatchFull)).toContain("envelope-payload-completeness-mismatch");
  });
});

describe("I-1b buildAnalysisEnvelope：纯函数性质", () => {
  it("输入不变（组装前后深度相等）", () => {
    const input = makeInput(B_MOVING_AVERAGE_TODAY_EXCLUDED, {
      completeness: "partial",
      unavailableReason: "window-incomplete",
    });
    const before = JSON.stringify(input);
    buildAnalysisEnvelope(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("确定性：同输入重复组装结果深相等", () => {
    const input = makeInput(B_MOVING_AVERAGE_THIRTY_DAY);
    const first = buildAnalysisEnvelope(input);
    const second = buildAnalysisEnvelope(input);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("JSON 序列化稳定：往返后深相等（载荷 JSON-safe）", () => {
    const result = buildAnalysisEnvelope(makeInput(B_MOVING_AVERAGE_SEVEN_DAY));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const roundTripped: unknown = JSON.parse(JSON.stringify(result.envelope));
    expect(roundTripped).toEqual(result.envelope);
  });

  it("非法结构拒绝：resolvedPeriod / computation.rounding / source.query.kind / resolvedCurrency", () => {
    const badPeriod = buildAnalysisEnvelope(
      makeInput(B_MOVING_AVERAGE_SEVEN_DAY, { resolvedPeriod: { from: "2026-10-09", to: "2026-10-01", dayCount: 0 } }),
    );
    expect(badPeriod.ok).toBe(false);
    expect(codes(badPeriod)).toContain("envelope-invalid-resolved-period");

    const badRounding = buildAnalysisEnvelope(
      makeInput(B_MOVING_AVERAGE_SEVEN_DAY, {
        computation: { rounding: "float" as unknown as typeof ANALYSIS_ROUNDING_POLICY },
      }),
    );
    expect(badRounding.ok).toBe(false);
    expect(codes(badRounding)).toContain("envelope-invalid-computation");

    const badSource = buildAnalysisEnvelope(
      makeInput(B_MOVING_AVERAGE_SEVEN_DAY, {
        source: makeSource({ query: { kind: "api" as unknown as "stats", from: "2026-10-01", to: "2026-10-09", currency: null } }),
      }),
    );
    expect(badSource.ok).toBe(false);
    expect(codes(badSource)).toContain("envelope-invalid-source");

    const badCurrency = buildAnalysisEnvelope(
      makeInput(B_MOVING_AVERAGE_SEVEN_DAY, {
        resolvedCurrency: { mode: "weird" } as unknown as { mode: "original"; currency: string },
      }),
    );
    expect(badCurrency.ok).toBe(false);
    expect(codes(badCurrency)).toContain("envelope-invalid-resolved-currency");
  });

  it("类型层：结果可赋值给 A 的 AnalysisResultBase 形状且保留 payload 类型", () => {
    const result = buildAnalysisEnvelope(makeInput(B_MOVING_AVERAGE_SEVEN_DAY));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const envelope: S01V2Envelope<MovingAverageResultLike> = result.envelope;
    const base: AnalysisResultBase = envelope;
    const payload: MovingAverageResultLike = envelope.payload;
    const version: typeof ANALYSIS_PROTOCOL_VERSION = envelope.version;
    expect(base.analysisType).toBe("time.moving-average");
    expect(payload.windowDays).toBe(7);
    expect(version).toBe("s01-v2");
  });
});

describe("I-1b 与 I-1a 管道集成", () => {
  it("信封 → 卡片引用 → runLayoutPipeline ok 且有投影", () => {
    const built = buildAnalysisEnvelope(
      makeInput(B_MOVING_AVERAGE_SEVEN_DAY, { analysisId: "AN-T01" }),
      { allowedShapes: ["moving-average"] },
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const content = {
      schemaVersion: 1,
      cards: [
        {
          objectId: "card-envelope",
          type: "analysis-card" as const,
          analysis: { analysisId: built.envelope.analysisId, params: {} },
          chart: { chartFamily: "line" as const },
          rangePolicy: "inherit" as const,
        },
      ],
      containers: [],
    };
    const layout = {
      schemaVersion: 1,
      layoutAlgorithmVersion: 1,
      mode: "unified" as const,
      main: {
        baseCols: 2,
        objects: [
          { objectId: "card-envelope", objectType: "analysis-card" as const, anchor: 1, colSpan: 1, rowSpan: 1 },
        ],
      },
    };

    const result = runLayoutPipeline({ content, layout }, { targetColumns: 2 });
    expect(result.ok).toBe(true);
    expect(result.content?.cards).toHaveLength(1);
    expect(result.layout?.main.objects).toHaveLength(1);
    expect(result.projection?.objects).toHaveLength(1);
    expect(result.projection?.columns).toBe(2);
    // AN-T01 不在 D 的 26 项白名单内：只读占位仅 warning，不阻塞布局投影。
    expect(result.issues?.some((item) => item.code === "pipeline-readonly-analysis")).toBe(true);
    expect(result.issues?.some((item) => item.severity === "error")).toBeFalsy();
  });
});
