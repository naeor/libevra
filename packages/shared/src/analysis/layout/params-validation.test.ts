/**
 * D-6 前置：G-12a v1 params 白名单校验测试。
 *
 * 覆盖 A 的发布物 §8 的 30 条用例（编号注释对应）、只读占位（未知分析/较新版本）、
 * 错误码与路径稳定性、分享导入门，以及若干边界（键数上限、嵌套对象、自由文本、
 * 通用键在各分析的复用）。
 *
 * 边界：不查账本权限/分类是否存在（属查询层）；纯函数、无时钟/随机/存储依赖。
 */

import { describe, expect, it } from "vitest";
import {
  ANALYSIS_PARAMS_SCHEMA_VERSION,
  MAX_ANALYSIS_PARAMS_KEYS,
  analysisParamsKeys,
  checkShareImportGate,
  isAcceptableAnalysisReference,
  isAnalysisParamsErrorCode,
  isAnalysisReferenceShape,
  isKnownAnalysisId,
  validateAnalysisParams,
} from "./params-validation.js";

const UUID_A = "8f14e45f-ceea-4e8b-bd66-0e9c39f5d7a1";
const UUID_B = "2c1f6a3b-4d5e-4f70-9a8b-0c1d2e3f4a5b";

function ref(
  analysisId: string,
  params: Record<string, unknown>,
  analysisVersion?: string,
): unknown {
  return analysisVersion === undefined
    ? { analysisId, params }
    : { analysisId, analysisVersion, params };
}

function codes(result: ReturnType<typeof validateAnalysisParams>): string[] {
  return result.issues.map((item) => item.code);
}

describe("params-validation：G-12a §8 的 30 条用例", () => {
  it("1) 空 params 通过（全部继承默认）", () => {
    const result = validateAnalysisParams(ref("AN-B01", {}));
    expect(result.status).toBe("valid");
    expect(result.value).toEqual({});
    expect(result.issues).toEqual([]);
  });

  it("2) {kind:'expense'} on B01 通过", () => {
    expect(validateAnalysisParams(ref("AN-B01", { kind: "expense" })).status).toBe("valid");
  });

  it("3) {kind:'income'} on B01 拒绝 params_type", () => {
    const result = validateAnalysisParams(ref("AN-B01", { kind: "income" }));
    expect(result.status).toBe("invalid");
    expect(codes(result)).toContain("params_type");
  });

  it("4) {categoryIds:[uuid]} 通过", () => {
    expect(validateAnalysisParams(ref("AN-B01", { categoryIds: [UUID_A] })).status).toBe("valid");
  });

  it("5) {categoryIds:'uuid'} 拒绝 params_type", () => {
    const result = validateAnalysisParams(ref("AN-B01", { categoryIds: UUID_A }));
    expect(result.status).toBe("invalid");
    expect(codes(result)).toContain("params_type");
  });

  it("6) categoryIds 重复 → 去重后通过", () => {
    const result = validateAnalysisParams(ref("AN-B01", { categoryIds: [UUID_A, UUID_A] }));
    expect(result.status).toBe("valid");
  });

  it("7) {tagIds:[uuid]} on B01 通过（通用键）", () => {
    expect(validateAnalysisParams(ref("AN-B01", { tagIds: [UUID_B] })).status).toBe("valid");
  });

  it("8) {unknownKey:1} 拒绝 params_unknown_key", () => {
    const result = validateAnalysisParams(ref("AN-B01", { unknownKey: 1 }));
    expect(result.status).toBe("invalid");
    expect(codes(result)).toContain("params_unknown_key");
  });

  it("9) {bookId:'...'} 拒绝 params_private_data", () => {
    const result = validateAnalysisParams(ref("AN-B01", { bookId: "book" }));
    expect(result.status).toBe("invalid");
    expect(codes(result)).toContain("params_private_data");
  });

  it("10) {categoryName:'餐饮'} 拒绝 params_private_data", () => {
    const result = validateAnalysisParams(ref("AN-B01", { categoryName: "餐饮" }));
    expect(result.status).toBe("invalid");
    expect(codes(result)).toContain("params_private_data");
  });

  it("11) {amountMinor:'100'} 拒绝 params_private_data", () => {
    const result = validateAnalysisParams(ref("AN-B01", { amountMinor: "100" }));
    expect(result.status).toBe("invalid");
    expect(codes(result)).toContain("params_private_data");
  });

  it("12) {title:'我的卡片'} 拒绝 params_private_data（v1 不允许自定义文案）", () => {
    const result = validateAnalysisParams(ref("AN-B01", { title: "我的卡片" }));
    expect(result.status).toBe("invalid");
    expect(codes(result)).toContain("params_private_data");
  });

  it("13) {timePreset:'30d'} 通过", () => {
    expect(validateAnalysisParams(ref("AN-B01", { timePreset: "30d" })).status).toBe("valid");
  });

  it("14) {timePreset:'30d', timeRelativeDays:7} 拒绝 params_conflict", () => {
    const result = validateAnalysisParams(ref("AN-B01", { timePreset: "30d", timeRelativeDays: 7 }));
    expect(result.status).toBe("invalid");
    expect(codes(result)).toContain("params_conflict");
  });

  it("15) {timeRelativeDays:400} 通过", () => {
    expect(validateAnalysisParams(ref("AN-B01", { timeRelativeDays: 400 })).status).toBe("valid");
  });

  it("16) {timeRelativeDays:401} 拒绝 params_out_of_range", () => {
    const result = validateAnalysisParams(ref("AN-B01", { timeRelativeDays: 401 }));
    expect(result.status).toBe("invalid");
    expect(codes(result)).toContain("params_out_of_range");
  });

  it("17) {timeRelativeDays:3660, allowLongRange:true} 通过（显式请求）", () => {
    const result = validateAnalysisParams(
      ref("AN-B01", { timeRelativeDays: 3660, allowLongRange: true }),
    );
    expect(result.status).toBe("valid");
  });

  it("18) {timeRelativeDays:3661, allowLongRange:true} 拒绝 params_out_of_range", () => {
    const result = validateAnalysisParams(
      ref("AN-B01", { timeRelativeDays: 3661, allowLongRange: true }),
    );
    expect(result.status).toBe("invalid");
    expect(codes(result)).toContain("params_out_of_range");
  });

  it("19) timeFixed 逆序区间 拒绝 params_out_of_range", () => {
    const result = validateAnalysisParams(
      ref("AN-B01", { timeFixed: { from: "2026-10-01", to: "2026-09-01" } }),
    );
    expect(result.status).toBe("invalid");
    expect(codes(result)).toContain("params_out_of_range");
  });

  it("20) timeFixed 非法日期 2026-02-30 拒绝 params_out_of_range", () => {
    const result = validateAnalysisParams(
      ref("AN-B01", { timeFixed: { from: "2026-02-30", to: "2026-03-01" } }),
    );
    expect(result.status).toBe("invalid");
    expect(codes(result)).toContain("params_out_of_range");
  });

  it("21) {maxParts:0} on I01 拒绝 params_out_of_range", () => {
    const result = validateAnalysisParams(ref("AN-I01", { maxParts: 0 }));
    expect(result.status).toBe("invalid");
    expect(codes(result)).toContain("params_out_of_range");
  });

  it("22) {topN:30} on I03 通过", () => {
    expect(validateAnalysisParams(ref("AN-I03", { topN: 30 })).status).toBe("valid");
  });

  it("23) {metric:'count'} on I17 通过", () => {
    expect(validateAnalysisParams(ref("AN-I17", { metric: "count" })).status).toBe("valid");
  });

  it("24) {metric:'share'} on I17 拒绝 params_type", () => {
    const result = validateAnalysisParams(ref("AN-I17", { metric: "share" }));
    expect(result.status).toBe("invalid");
    expect(codes(result)).toContain("params_type");
  });

  it("25) {includeSystemCategories:true} on B16 通过", () => {
    expect(
      validateAnalysisParams(ref("AN-B16", { includeSystemCategories: true })).status,
    ).toBe("valid");
  });

  it("26) {comparisonPolicy:'equal-length-window'} on B03 通过", () => {
    const result = validateAnalysisParams(
      ref("AN-B03", { comparisonPolicy: "equal-length-window" }),
    );
    expect(result.status).toBe("valid");
    expect(result.value).toEqual({ comparisonPolicy: "equal-length-window" });
  });

  it("27) {comparisonPolicy:'random'} on B03 拒绝 params_type", () => {
    const result = validateAnalysisParams(ref("AN-B03", { comparisonPolicy: "random" }));
    expect(result.status).toBe("invalid");
    expect(codes(result)).toContain("params_type");
  });

  it("28) 未知 analysisId → 只读占位 params_unknown_analysis，保留配置", () => {
    const result = validateAnalysisParams(ref("AN-Z99", { timePreset: "30d" }));
    expect(result.status).toBe("readonly");
    expect(result.readonlyReason).toBe("analysis-unknown");
    expect(codes(result)).toEqual(["params_unknown_analysis"]);
    expect(result.value).toEqual({ timePreset: "30d" });
  });

  it("29) 较新 analysisVersion → 只读占位 params_newer_version，保留配置", () => {
    const result = validateAnalysisParams(ref("AN-B01", { kind: "expense" }, "s01-v3"), {
      currentAnalysisVersion: "s01-v2",
    });
    expect(result.status).toBe("readonly");
    expect(result.readonlyReason).toBe("analysis-version-newer");
    expect(codes(result)).toEqual(["params_newer_version"]);
    expect(result.value).toEqual({ kind: "expense" });
  });

  it("30) 分享导入门关闭 → 拒绝 share_import_closed", () => {
    expect(checkShareImportGate()).toEqual({
      ok: false,
      issues: [
        {
          code: "share_import_closed",
          path: "$",
          detail: expect.stringContaining("分享导入尚未开放") as unknown as string,
        },
      ],
    });
  });
});

describe("params-validation：通用键与边界", () => {
  it("通用键在各分析复用（paymentMethodIds/paramsSchemaVersion/timePreset 组合）", () => {
    const result = validateAnalysisParams(
      ref("AN-B02", {
        paramsSchemaVersion: ANALYSIS_PARAMS_SCHEMA_VERSION,
        paymentMethodIds: [UUID_A, UUID_B],
        timePreset: "7d",
      }),
    );
    expect(result.status).toBe("valid");
  });

  it("paramsSchemaVersion 未知 → params_invalid", () => {
    const result = validateAnalysisParams(ref("AN-B01", { paramsSchemaVersion: "2" }));
    expect(result.status).toBe("invalid");
    expect(codes(result)).toContain("params_invalid");
  });

  it("非 timeFixed 的嵌套对象 → params_private_data", () => {
    const result = validateAnalysisParams(ref("AN-B01", { timePreset: { nested: true } }));
    expect(result.status).toBe("invalid");
    expect(codes(result)).toContain("params_private_data");
  });

  it("键总数超上限 → params_invalid", () => {
    const params: Record<string, unknown> = {};
    for (let index = 0; index < MAX_ANALYSIS_PARAMS_KEYS; index += 1) {
      params[`unknown${String(index)}`] = index;
    }
    // 超出上限（13 键）优先报 params_invalid。
    params["unknown-more"] = 1;
    const result = validateAnalysisParams(ref("AN-B01", params));
    expect(result.status).toBe("invalid");
    expect(codes(result)).toContain("params_invalid");
  });

  it("引用形状非法（非对象/缺 analysisId/params 非对象）→ params_invalid", () => {
    expect(validateAnalysisParams(null).status).toBe("invalid");
    expect(validateAnalysisParams({ params: {} }).status).toBe("invalid");
    expect(validateAnalysisParams({ analysisId: "AN-B01", params: [] }).status).toBe("invalid");
    expect(validateAnalysisParams({ analysisId: "", params: {} }).status).toBe("invalid");
  });

  it("analysisVersion 非字符串 → params_invalid", () => {
    const result = validateAnalysisParams({ analysisId: "AN-B01", analysisVersion: 2, params: {} });
    expect(result.status).toBe("invalid");
    expect(codes(result)).toContain("params_invalid");
  });

  it("analysisVersion 等于/省略当前版本 → 正常校验", () => {
    expect(
      validateAnalysisParams(ref("AN-B01", { kind: "expense" }, "s01-v2"), {
        currentAnalysisVersion: "s01-v2",
      }).status,
    ).toBe("valid");
    expect(validateAnalysisParams(ref("AN-B01", {})).status).toBe("valid");
  });

  it("id 数组上限：50 个通过、51 个（去重后）拒绝", () => {
    const ids = Array.from({ length: 50 }, (_, index) => {
      const suffix = index.toString(16).padStart(12, "0");
      return `8f14e45f-ceea-4e8b-bd66-${suffix}`;
    });
    expect(validateAnalysisParams(ref("AN-B01", { categoryIds: ids })).status).toBe("valid");
    const tooMany = [...ids, "2c1f6a3b-4d5e-4f70-9a8b-000000000001"];
    const result = validateAnalysisParams(ref("AN-B01", { categoryIds: tooMany }));
    expect(result.status).toBe("invalid");
    expect(codes(result)).toContain("params_out_of_range");
  });

  it("I01 不接受 topN（白名单外键）", () => {
    const result = validateAnalysisParams(ref("AN-I01", { topN: 5 }));
    expect(result.status).toBe("invalid");
    expect(codes(result)).toContain("params_unknown_key");
  });

  it("I17 接受 metric+maxParts 组合", () => {
    expect(
      validateAnalysisParams(ref("AN-I17", { metric: "count", maxParts: 8 })).status,
    ).toBe("valid");
  });

  it("B03 的 comparisonPolicy 不允许出现在 B01（白名单外键）", () => {
    const result = validateAnalysisParams(
      ref("AN-B01", { comparisonPolicy: "same-day-index" }),
    );
    expect(result.status).toBe("invalid");
    expect(codes(result)).toContain("params_unknown_key");
  });

  it("timeFixed 超 400 天须 allowLongRange；显式后可到 3660", () => {
    const tooLong = validateAnalysisParams(
      ref("AN-B01", { timeFixed: { from: "2020-01-01", to: "2021-12-31" } }),
    );
    expect(tooLong.status).toBe("invalid");
    expect(codes(tooLong)).toContain("params_out_of_range");

    const allowed = validateAnalysisParams(
      ref("AN-B01", {
        timeFixed: { from: "2020-01-01", to: "2021-12-31" },
        allowLongRange: true,
      }),
    );
    expect(allowed.status).toBe("valid");
  });

  it("allowLongRange=true 但区间不足 400 天 → params_out_of_range（发布物字面约束）", () => {
    const result = validateAnalysisParams(
      ref("AN-B01", { timePreset: "30d", allowLongRange: true }),
    );
    expect(result.status).toBe("invalid");
    expect(codes(result)).toContain("params_out_of_range");
  });

  it("timeFixed 只允许 from/to（额外键报 params_unknown_key）", () => {
    const result = validateAnalysisParams(
      ref("AN-B01", { timeFixed: { from: "2026-01-01", to: "2026-01-02", tz: "UTC" } }),
    );
    expect(result.status).toBe("invalid");
    expect(codes(result)).toContain("params_unknown_key");
  });

  it("B16 允许三种 kind（含 both）", () => {
    for (const kind of ["expense", "income", "both"] as const) {
      expect(validateAnalysisParams(ref("AN-B16", { kind })).status).toBe("valid");
    }
  });

  it("输出路径稳定（params_type 指向 $params.kind）", () => {
    const result = validateAnalysisParams(ref("AN-B01", { kind: "income" }));
    expect(result.issues[0]?.path).toBe("$params.kind");
  });
});

describe("params-validation：分享导入门与辅助函数", () => {
  it("shareImportAllowed=true 放行；false/省略关闭", () => {
    expect(checkShareImportGate({ shareImportAllowed: true })).toEqual({ ok: true });
    expect(checkShareImportGate({ shareImportAllowed: false }).ok).toBe(false);
    expect(checkShareImportGate({}).ok).toBe(false);
  });

  it("isKnownAnalysisId / analysisParamsKeys", () => {
    expect(isKnownAnalysisId("AN-B01")).toBe(true);
    expect(isKnownAnalysisId("an-b01")).toBe(false);
    expect(isKnownAnalysisId("AN-Z99")).toBe(false);
    expect(isKnownAnalysisId("AN-B01", ["AN-B01"])).toBe(true);
    expect(analysisParamsKeys("AN-B03")).toContain("comparisonPolicy");
    expect(analysisParamsKeys("AN-Z99")).toEqual(analysisParamsKeys("AN-B01"));
  });

  it("isAnalysisParamsErrorCode 收窄 9 个稳定错误码", () => {
    expect(isAnalysisParamsErrorCode("params_type")).toBe(true);
    expect(isAnalysisParamsErrorCode("share_import_closed")).toBe(true);
    expect(isAnalysisParamsErrorCode("whatever")).toBe(false);
  });

  it("isAcceptableAnalysisReference 对 valid/readonly 返回 true，对 invalid 返回 false", () => {
    expect(isAcceptableAnalysisReference(ref("AN-B01", {}))).toBe(true);
    expect(isAcceptableAnalysisReference(ref("AN-Z99", {}))).toBe(true);
    expect(isAcceptableAnalysisReference(ref("AN-B01", { kind: "income" }))).toBe(false);
  });

  it("isAnalysisReferenceShape 只做基本形状判定", () => {
    expect(isAnalysisReferenceShape({ analysisId: "AN-B01", params: {} })).toBe(true);
    expect(isAnalysisReferenceShape({ analysisId: "AN-B01", params: [] })).toBe(false);
    expect(isAnalysisReferenceShape(null)).toBe(false);
  });
});
