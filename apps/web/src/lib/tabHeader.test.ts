import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("一级页面共用收缩顶栏", () => {
  it("分析、账本、正式账号与游客我的页复用同一组件", () => {
    for (const page of ["StatsPage", "LedgerPage", "MePage", "GuestMePage"]) {
      expect(source(`../pages/${page}.tsx`), `${page} 没有用共享头部`).toContain("TabPageHeader");
    }
  });
  it("共享布局与语义主题保留单一出处", () => {
    const header = source("../components/TabPageHeader.tsx");
    expect(header).toContain('className = "bg-brand text-on-brand"');
    expect(header).toContain("text-page-title");
    expect(header).toContain("text-body-relaxed");
    expect(header).toContain("GuestModeBadge");
    expect(header).toContain("useCollapsingHeader()");
    expect(header.match(/\{action\}/g)).toHaveLength(1);
  });
  it("页面不复制标题栏的布局与动画", () => {
    for (const page of ["StatsPage", "LedgerPage"]) {
      const text = source(`../pages/${page}.tsx`);
      expect(text).not.toContain("bg-brand px-6 pt-8 pb-6");
      expect(text).not.toContain("text-xl font-semibold tracking-tight");
      expect(text).not.toContain("useCollapsingHeader");
    }
  });
  it("分析页的当前账本提示保留在底部，不重复放入顶栏", () => {
    const text = source("../pages/StatsPage.tsx");
    expect(text).toContain("currentBookName={ledger.data?.book.name}");
    expect(text).not.toContain("ledger.data.book.name}</p>");
  });
});
