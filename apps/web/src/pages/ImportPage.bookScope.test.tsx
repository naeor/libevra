import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DUPLICATE_DETECTION_SETTINGS } from "@libellum/shared";

const state = vi.hoisted(() => ({ currentBook: "selected-book" as string | null, requestedBooks: [] as string[], currentReads: 0 }));

vi.mock("../lib/queries.js", () => ({
  useCurrentBookId: () => state.currentBook,
  useLedger: () => { state.currentReads += 1; return { isError: false }; },
  useLedgerMeta: (book: string) => {
    state.requestedBooks.push(book);
    return { data: { book: { id: book, name: `账本-${book}`, bookNumber: "00000001" }, categories: [], paymentMethods: [], tags: [] } };
  },
  useMoneyInvalidator: () => async () => {},
  fetchTemplate: vi.fn(),
}));
vi.mock("../components/DuplicateDetectionSettings.js", () => ({
  useDuplicateDetectionSettings: () => ({ settings: DEFAULT_DUPLICATE_DETECTION_SETTINGS }),
}));
vi.mock("../components/Layouts.js", () => ({
  InnerPage: ({ children, title }: { children: React.ReactNode; title: string }) => <main><h1>{title}</h1>{children}</main>,
}));

import { ImportPage } from "./ImportPage.js";

function render(path = "/import?from=nav"): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/import" element={<ImportPage />} />
        <Route path="/books/:bookId/settings/import" element={<ImportPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  state.currentBook = "selected-book";
  state.requestedBooks = [];
  state.currentReads = 0;
});

describe("导入页面账本作用域", () => {
  it("中央入口读取当前选定账本，绝不以空字符串取默认账本", () => {
    expect(render()).toContain("选择账单文件");
    expect(state.requestedBooks).toEqual(["selected-book"]);
    expect(state.currentReads).toBe(1);
  });

  it("设备账本尚未恢复时显示等待，不打开导入表单或请求默认账本", () => {
    state.currentBook = null;
    const html = render();
    expect(html).toContain("正在读取当前账本");
    expect(html).not.toContain('type="file"');
    expect(state.requestedBooks).toEqual([]);
  });

  it("目标入口只读取目标账本，不触发切换当前账本的查询", () => {
    expect(render("/books/target-book/settings/import")).toContain("账本-target-book");
    expect(state.requestedBooks.every((id) => id === "target-book")).toBe(true);
    expect(state.currentReads).toBe(0);
  });
});
