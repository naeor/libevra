import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { validateAnalysisParams } from "@libellum/shared/analysis/layout";

import { CARD_TYPES } from "./catalog.js";
import { readComposition } from "./composition.js";
import { buildCard, CUSTOM_CARD_TYPES, customCardsIn, draftProblem } from "./customCards.js";
import { legacyDefaultWorkbench, newCard } from "./defaults.js";
import { command, sessionDocuments, startSession, updateCard } from "./session.js";
import { ChartGlyph } from "./ui.js";

describe("自定义卡片（组合卡片）草稿", () => {
  it("可选指标 = 目录全部正式实现的分析；A 走 G-12a 白名单，B/C 只读登记；配置不存金额或账本身份", () => {
    expect(CUSTOM_CARD_TYPES.map((type) => type.id)).toEqual(CARD_TYPES.map((type) => type.id));
    for (const type of CUSTOM_CARD_TYPES) {
      const check = validateAnalysisParams({ analysisId: type.id, params: {} });
      if (type.source === "agent-a") expect(check.status).toBe("valid");
      else expect(check.status).toBe("readonly");
    }
    const card = buildCard({ template: "single", slots: [{ id: "s1", analysisId: "AN-I01", family: "table" }], name: "  分类明细  " }, undefined, "custom-table");
    expect(card).toMatchObject({ analysis: { analysisId: "AN-I01", params: {} }, chart: { chartFamily: "table" }, title: { kind: "custom", text: "分类明细" }, rangePolicy: "inherit" });
    expect(JSON.stringify(card)).not.toMatch(/amount|bookId|ledgerId|transaction/i);
    expect(draftProblem({ template: "single", slots: [{ id: "s1", analysisId: "AN-I01", family: "line" }], name: "" })).toBe("family");
    expect(draftProblem({ template: "single", slots: [{ id: "s1", analysisId: "AN-Z99", family: "number" }], name: "" })).toBe("analysis");
    expect(draftProblem({ template: "single", slots: [], name: "" })).toBe("empty");
  });

  it("名称可以不填（自动命名）；超长名称与非法固定日期被拒绝，不静默修正", () => {
    const one = [{ id: "s1", analysisId: "AN-B01", family: "number" as const }];
    expect(buildCard({ template: "single", slots: one, name: " " }, undefined, "auto")?.title).toEqual({ kind: "preset" });
    expect(buildCard({ template: "single", slots: one, name: "A".repeat(41) })).toBeNull();
    expect(buildCard({ template: "single", slots: one, name: "固定支出", pinnedRange: { from: "2026-10-30", to: "2026-10-01" } })).toBeNull();
  });

  it("创建、统一撤销、重配置及文档序列化保持同一实例配置", () => {
    const card = buildCard({ template: "single", slots: [{ id: "s1", analysisId: "AN-I01", family: "table" }], name: "分类明细", pinnedRange: { from: "2026-10-01", to: "2026-10-27" } }, undefined, "custom-table")!;
    const inserted = command(startSession(legacyDefaultWorkbench()), { type: "insert-card", card, size: { colSpan: 2, rowSpan: 2 } });
    expect(inserted.ok).toBe(true);
    const restored = JSON.parse(JSON.stringify(sessionDocuments(inserted.state))) as ReturnType<typeof sessionDocuments>;
    expect(customCardsIn(restored.content.cards)).toEqual([card]);
    const next = buildCard({ template: "single", slots: [{ id: "s1", analysisId: "AN-I01", family: "ranking" }], name: "分类明细", pinnedRange: { from: "2026-10-01", to: "2026-10-27" } }, card)!;
    expect(readComposition(next).slots[0]!.family).toBe("ranking");
    const changed = updateCard(inserted.state, next);
    expect(changed.ok).toBe(true);
    expect(customCardsIn(changed.state.content.cards)).toEqual([next]);
    const undone = command(changed.state, { type: "undo" });
    expect(customCardsIn(undone.state.content.cards)).toEqual([card]);
    const undoneInsert = command(undone.state, { type: "undo" });
    expect(customCardsIn(undoneInsert.state.content.cards)).toEqual([]);
    expect(customCardsIn([newCard("AN-B01")])).toEqual([]);
  });
});

describe("正式图表家族图标", () => {
  it("按实际图表家族映射数字、环形、折线、柱状、日历及表格，支持正式编号", () => {
    const families = ["number", "donut", "line", "bar", "heatmap", "table"];
    const paths = families.map((family) => renderToStaticMarkup(<ChartGlyph family={family} />));
    expect(new Set(paths).size).toBe(families.length);
    expect(renderToStaticMarkup(<ChartGlyph family="CF-B08" />)).toBe(renderToStaticMarkup(<ChartGlyph family="heatmap" />));
    expect(renderToStaticMarkup(<ChartGlyph family="line" />)).toContain('data-chart-family="CF-B01"');
  });
});
