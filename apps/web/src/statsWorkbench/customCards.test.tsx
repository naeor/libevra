import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { validateAnalysisParams } from "@libellum/shared/analysis/layout";
import { CUSTOM_CARD_TYPES, createCustomCard, customCardProblem, customCardsIn } from "./customCards.js";
import { defaultWorkbench, newCard } from "./defaults.js";
import { command, sessionDocuments, startSession, updateCard } from "./session.js";
import { ChartGlyph } from "./ui.js";

describe("单分析自定义卡片", () => {
  it("只能选择正式登记的能力及其合法展示，配置不存金额或账本身份", () => {
    expect(CUSTOM_CARD_TYPES.length).toBe(50);
    for (const type of CUSTOM_CARD_TYPES) {
      const check = validateAnalysisParams({ analysisId: type.id, params: {} });
      // A 协议能力走正式 G-12a 白名单；B 第二批的高级分析不带布局参数，登记为只读类型即可。
      if (type.source === "agent-a") expect(check.status).toBe("valid");
      else expect(check.status).toBe("readonly");
    }
    const card = createCustomCard({ analysisId: "AN-I01", family: "table", name: "  分类明细  " }, "custom-table");
    expect(card).toMatchObject({ analysis: { analysisId: "AN-I01", params: {} }, chart: { chartFamily: "table" }, title: { kind: "custom", text: "分类明细" }, rangePolicy: "inherit" });
    expect(JSON.stringify(card)).not.toMatch(/amount|bookId|ledgerId|transaction/i);
    expect(customCardProblem({ analysisId: "AN-I01", family: "line", name: "错误图表" })).toBe("family");
    expect(customCardProblem({ analysisId: "AN-Z99", family: "number", name: "未知指标" })).toBe("analysis");
  });

  it("拒绝空名称及非法固定日期，不静默修正", () => {
    expect(createCustomCard({ analysisId: "AN-B01", family: "number", name: " " })).toBeNull();
    expect(createCustomCard({ analysisId: "AN-B01", family: "number", name: "A".repeat(41) })).toBeNull();
    expect(createCustomCard({ analysisId: "AN-B01", family: "number", name: "固定支出", pinnedRange: { from: "2026-10-30", to: "2026-10-01" } })).toBeNull();
  });

  it("创建、统一撤销、重配置及文档序列化保持同一实例配置", () => {
    const card = createCustomCard({ analysisId: "AN-I01", family: "table", name: "分类明细", pinnedRange: { from: "2026-10-01", to: "2026-10-27" } }, "custom-table")!;
    const inserted = command(startSession(defaultWorkbench()), { type: "insert-card", card, size: { colSpan: 2, rowSpan: 2 } });
    expect(inserted.ok).toBe(true);
    const restored = JSON.parse(JSON.stringify(sessionDocuments(inserted.state))) as ReturnType<typeof sessionDocuments>;
    expect(customCardsIn(restored.content.cards)).toEqual([card]);
    const next = { ...card, chart: { chartFamily: "ranking" } };
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
