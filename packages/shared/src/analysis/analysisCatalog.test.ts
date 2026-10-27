import { describe, expect, it } from "vitest";

import {
  ANALYSIS_CATALOG,
  ANALYSIS_CATALOG_DRAFT,
  ANALYSIS_CATALOG_IDS,
  defaultDefinitionFor,
  defaultKindFor,
  getAnalysisCatalogEntry,
  requireCatalogAnalysisId,
  shapeFor,
  type CatalogAnalysisId,
} from "./analysisCatalog.js";
import { makePeriod, type WorkbenchState } from "./context.js";
import {
  SAMPLE_B_INCOME_ONLY,
  SAMPLE_C_EXPENSE_ONLY,
  SAMPLE_O_FILTERS,
} from "./fixtures.js";
import { ANALYSIS_PROTOCOL_VERSION } from "./types.js";

const ALL_IDS: readonly CatalogAnalysisId[] = ANALYSIS_CATALOG_IDS;

function workbenchFor(
  sample: { readonly today: string; readonly range: { readonly from: string; readonly to: string } },
): WorkbenchState {
  return {
    period: makePeriod(sample.range.from, sample.range.to),
    today: sample.today,
    currency: { mode: "original", currency: "CNY" },
  };
}

describe("analysis catalog (A-4 prep)", () => {
  it("是被标记为 draft 的静态目录", () => {
    expect(ANALYSIS_CATALOG_DRAFT).toBe(true);
  });

  it("覆盖 26 项、编号唯一且与 ANALYSIS_CATALOG_IDS 同序", () => {
    expect(ANALYSIS_CATALOG).toHaveLength(26);
    expect(new Set(ALL_IDS).size).toBe(26);
    expect(ANALYSIS_CATALOG.map((entry) => entry.analysisId)).toEqual([
      ...ALL_IDS,
    ]);
    expect(new Set(ANALYSIS_CATALOG.map((entry) => entry.metric)).size).toBe(26);
  });

  it("每项都有合法的 analysisId / 形状 / 默认 kind / groupBy / 装配函数", () => {
    const shapes = new Set(["scalar", "ranked-groups", "composition", "record-extreme"]);
    const groupBys = new Set([null, "category", "paymentMethod", "day", "record"]);

    for (const entry of ANALYSIS_CATALOG) {
      expect(ALL_IDS).toContain(entry.analysisId);
      expect(shapes.has(entry.shape)).toBe(true);
      expect(["expense", "income", "both"]).toContain(entry.defaultKind);
      expect(groupBys.has(entry.groupBy)).toBe(true);
      expect(typeof entry.assemble).toBe("function");
      expect(entry.analysisType.length).toBeGreaterThan(0);
      expect(entry.metric.length).toBeGreaterThan(0);
    }
  });

  it("getAnalysisCatalogEntry：已知返回同一条目，未知返回 null", () => {
    const b01 = getAnalysisCatalogEntry("AN-B01");
    expect(b01).not.toBeNull();
    expect(b01).toBe(ANALYSIS_CATALOG[0]);
    expect(getAnalysisCatalogEntry("AN-X99")).toBeNull();
    expect(getAnalysisCatalogEntry("")).toBeNull();
  });

  it("defaultDefinitionFor 生成继承区间/币种、带默认 kind 与 groupBy 的定义", () => {
    for (const id of ALL_IDS) {
      const entry = requireCatalogAnalysisId(id);
      const catalogEntry = getAnalysisCatalogEntry(entry);
      expect(catalogEntry).not.toBeNull();
      const definition = defaultDefinitionFor(entry);

      expect(definition.version).toBe(ANALYSIS_PROTOCOL_VERSION);
      expect(definition.analysisId).toBe(entry);
      expect(definition.analysisType).toBe(catalogEntry!.analysisType);
      expect(definition.metric).toBe(catalogEntry!.metric);
      expect(definition.time).toEqual({ mode: "inherit" });
      expect(definition.currency).toEqual({ mode: "inherit" });
      expect(definition.filters?.kind).toBe(catalogEntry!.defaultKind);
      expect(definition.filters?.categoryIds).toBeUndefined();
      expect(definition.filters?.paymentMethodIds).toBeUndefined();
      expect(definition.filters?.tagIds).toBeUndefined();
      expect(definition.groupBy).toBe(catalogEntry!.groupBy ?? undefined);
    }
  });

  it("defaultKindFor / shapeFor 与目录一致；未知编号抛 RangeError", () => {
    for (const id of ALL_IDS) {
      const entry = getAnalysisCatalogEntry(id)!;
      expect(defaultKindFor(id)).toBe(entry.defaultKind);
      expect(shapeFor(id)).toBe(entry.shape);
    }

    expect(() => requireCatalogAnalysisId("AN-X99")).toThrowError(
      /unknown_analysis_id:AN-X99/,
    );
    expect(() =>
      shapeFor("AN-X99" as unknown as CatalogAnalysisId),
    ).toThrowError(RangeError);
    expect(() =>
      defaultKindFor("AN-X99" as unknown as CatalogAnalysisId),
    ).toThrowError(RangeError);
  });

  it("smoke：26 项默认定义在样本上都能装配出声明形状且不抛错", () => {
    for (const entry of ANALYSIS_CATALOG) {
      const sample =
        entry.defaultKind === "income"
          ? SAMPLE_B_INCOME_ONLY
          : entry.defaultKind === "both"
            ? SAMPLE_O_FILTERS
            : SAMPLE_C_EXPENSE_ONLY;
      const definition = defaultDefinitionFor(entry.analysisId);

      const result = entry.assemble(
        sample.entries,
        definition,
        workbenchFor(sample),
      );

      expect(result.shape).toBe(entry.shape);
      expect(result.analysisId).toBe(entry.analysisId);
      expect(result.analysisType).toBe(entry.analysisType);
      expect(result.version).toBe(ANALYSIS_PROTOCOL_VERSION);
      expect(result.completeness.length).toBeGreaterThan(0);
    }
  });

  it("smoke：空账本不抛错且保持目录声明的形状", () => {
    const emptySample = SAMPLE_O_FILTERS;
    const emptyWorkbench = workbenchFor(emptySample);
    const emptyEntries = emptySample.entries.filter(
      (entry) => entry.id === "__none__",
    );

    for (const entry of ANALYSIS_CATALOG) {
      const result = entry.assemble(
        emptyEntries,
        defaultDefinitionFor(entry.analysisId),
        emptyWorkbench,
      );
      expect(result.shape).toBe(entry.shape);
      expect(result.completeness).toBe("no-transactions");
    }
  });
});
