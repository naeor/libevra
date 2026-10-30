import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ENTRY_ACTIONS } from "../components/BottomNav.js";
import { ViewLedgerContext } from "../lib/workspaceLedger.js";
import { EntryMethodList, FollowEntryChooser } from "./RailEntryMenu.js";
import { AddEntryButton } from "./GlobalRail.js";

const mode = vi.hoisted(() => ({ guest: false }));
vi.mock("../lib/guest/session.js", () => ({ useGuestMode: () => mode.guest }));

describe("侧栏五种记账方式", () => {
  it("手动在首位；五个功能、路由与原图标定义保留，导入仍为当前账本 CSV 入口", () => {
    mode.guest = false;
    const html = renderToStaticMarkup(<div role="menu"><EntryMethodList disabledFor={() => false} onNavigate={() => {}} /></div>);
    expect(html.match(/role="menuitem"/g)).toHaveLength(5);
    expect(html).not.toContain("disabled");
    expect(html.indexOf("手动记账")).toBeLessThan(html.indexOf("粘贴识别"));
    expect(html).toContain('data-import="true"');
    expect(ENTRY_ACTIONS.map(({ id, to, picksImages }) => ({ id, to, picksImages }))).toEqual([
      { id: "paste", to: "/paste" }, { id: "voice", to: "/record" }, { id: "manual", to: "/add" },
      { id: "scan", to: "/scan", picksImages: true }, { id: "import", to: "/import?from=nav" },
    ]);
    expect(html).toContain('accept="image/*"');
  });
  it("保留游客的原有禁用判断与可访问名称", () => {
    mode.guest = true;
    const html = renderToStaticMarkup(<AddEntryButton compact={false} follow={false} followOpen={false} onNavigate={() => {}} onToggleFollow={() => {}} onCloseFollow={() => {}} />);
    expect(html.match(/disabled=""/g)).toHaveLength(4);
    expect(html).toContain('aria-label="手动记账"');
    mode.guest = false;
  });
  it("关闭的内嵌菜单保留 DOM 用于反向动画，但不进入键盘及读屏路径", () => {
    const html = renderToStaticMarkup(<AddEntryButton compact={false} follow={false} followOpen={false} onNavigate={() => {}} onToggleFollow={() => {}} onCloseFollow={() => {}} />);
    expect(html).toContain('class="lv-entry-inline"');
    expect(html).toContain('inert=""');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('aria-expanded="false"');
  });
  it("辅助区局部面板显示继承的来源账本，五个选项同一组件渲染", () => {
    const client = new QueryClient({ defaultOptions: { queries: { initialData: { book: { id: "book-a", name: "来源账本", memberCount: 1 } } } } });
    const html = renderToStaticMarkup(<QueryClientProvider client={client}><ViewLedgerContext.Provider value="book-a"><FollowEntryChooser onNavigate={() => {}} onClose={() => {}} /></ViewLedgerContext.Provider></QueryClientProvider>);
    expect(html).toContain("记入账本：来源账本");
    expect(html).toContain('data-entry-chooser=""');
    expect(html.match(/role="menuitem"/g)).toHaveLength(5);
  });
});
