import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";
import { ViewLedgerContext } from "../lib/workspaceLedger.js";
import { PortraitSecondaryRail } from "./GlobalRail.js";

function render(compact: boolean): string {
  const client = new QueryClient({ defaultOptions: { queries: { initialData: { book: { id: "aux", name: "辅助账本", memberCount: 2 }, books: [{ id: "aux", name: "辅助账本" }, { id: "main", name: "主区账本" }] } } } });
  const noop = (): void => {};
  const props: ComponentProps<typeof PortraitSecondaryRail> = {
    compact, orientation: "portrait", splitVisible: true, preference: compact ? "collapsed" : "expanded", primaryPath: "/", secondaryPath: "/stats", secondaryLedger: "aux",
    onNavigate: noop, onNavigateEntry: noop, onNavigateSecondary: noop, onEnterSecondaryLedger: noop, onCloseSecondary: noop, onOpenInSecondary: noop, onSetRail: noop,
    onEnterLedger: noop, canSplit: true, followEntry: false, entryMenuOpen: false, onToggleEntry: noop, onCloseEntry: noop,
  };
  return renderToStaticMarkup(<QueryClientProvider client={client}><ViewLedgerContext.Provider value="aux"><PortraitSecondaryRail {...props} /></ViewLedgerContext.Provider></QueryClientProvider>);
}

describe("竖屏辅助区完整侧栏", () => {
  it("展开后只显示标题、关闭、四项文字及账本列表，没有品牌、侧栏切换与返回", () => {
    const html = render(false);
    for (const label of ["明细", "分析", "协作", "我的", "辅助账本", "主区账本", "辅助工作区", "收起辅助工作区"]) expect(html).toContain(label);
    expect(html.match(/lv-rail-item-label lv-rail-fade/g)).toHaveLength(4);
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain("lv-rail-add");
    expect(html).not.toContain("lv-fab");
    for (const absent of ["Libevra", "lv-rail-brand", "收起侧栏", "返回上一页"]) expect(html).not.toContain(absent);
  });
  it("紧凑模式保留同一组导航与账本入口，读屏仍有名称", () => {
    const html = render(true);
    expect(html).not.toContain("展开侧栏");
    expect(html).toContain("辅助工作区");
    expect(html).toContain("我的账本：辅助账本");
    expect(html.match(/lv-rail-item-label lv-rail-fade/g)).toHaveLength(4);
    expect(html).not.toContain("lv-rail-add");
  });
});
