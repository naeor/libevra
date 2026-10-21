import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { DuplicateReviewPage } from "./DuplicateReviewPage.js";

/**
 * 全账本检查页（S15-E5）的静态结构。
 *
 * 这个工作区的 Web 测试跑在纯 Node 环境（无 DOM），所以能断言的是“第一次打开时
 * 说了什么、给了什么操作”，而不是“点一下之后进度条动到 40%”。真正的分块与进度由
 * 服务端接口测试 + 页面里的游标代码保证。
 *
 * 重点在**不能出现的承诺**：这一页不许说“自动删除/合并”。
 */

vi.mock("../auth/AuthProvider.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth/AuthProvider.js")>();

  return {
    ...actual,
    useAuth: () => ({ status: "ready", user: { id: "test-user", username: "tester" } }),
  };
});

function renderPage(): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/books/book-1/settings/duplicates"]}>
        <Routes>
          <Route path="/books/:bookId/settings/duplicates" element={<DuplicateReviewPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("全账本重复检查页", () => {
  it("打开时说明规则来自当前设置，并给一个开始检查的按钮", () => {
    const html = renderPage();

    expect(html).toContain("重复账目检测");
    expect(html).toContain("判断规则与你当前的重复提醒设置一致");
    expect(html).toContain("开始检查");
  });

  it("明确“只提示”，并说明删不删、留几笔都由用户决定", () => {
    const html = renderPage();

    expect(html).toContain("疑似重复只是提示");
    expect(html).toContain("删不删、留几笔都由你决定");
  });

  it("明确“不会自动删除或合并”，不把删除写成这一页的动作", () => {
    const html = renderPage();

    // 只允许出现“不会自动删除或合并”这种否定句；没有“自动删除/自动合并”的承诺。
    expect(html).toContain("不会自动删除或合并任何账目");
    expect(html).not.toContain("自动删除了");
    expect(html).not.toContain("已合并");
  });
});
