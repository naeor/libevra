import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";

/**
 * **账本设置页的布局（S15-C）：名称只写一次，编号只写一次。**
 *
 * ⚠️ **The owner's screenshot showed the same two facts three times on one screen**: 「名称 · 编号」
 * in the subtitle, the same pair in `BookIdentityCard`, and again in a 「账本资料」 block that also
 * held the only rename entry. The decisions this pins:
 *
 *  * the 「账本资料」 block is **deleted**, not hidden;
 *  * the subtitle is gone, so the number exists in one place (the card);
 *  * the rename entry **moved into the card**, and only for owner/editor;
 *  * a viewer still gets the sentence about being read-only, now under the card.
 *
 * ⚠️ **Two halves, because each catches what the other cannot.** The rendered half is the real
 * acceptance («the page shows it once»); the source half pins the *shape* that a render of one
 * happy path would miss — that the rename prop is handed over only under `canWrite`, that the page
 * no longer prints the number itself, and that the return mode is the declared one.
 *
 * ⚠️ **The render runs without a DOM**, like the rest of this project's web tests
 * (`vitest.config.ts`): the five data hooks are stubbed and the real component tree is rendered
 * with `renderToStaticMarkup`. Effects do not run, which is why the lifecycle block says
 * 「正在读取账本状态…」 — that is the first paint, not a failure.
 */
const data = vi.hoisted(() => ({ role: "owner" as "owner" | "viewer" }));

vi.mock("../lib/queries.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/queries.js")>();

  const book = {
    id: "book-1",
    name: "家庭账本",
    bookNumber: "BK-000042",
    memberCount: 3,
    isCreator: true,
  };

  return {
    ...actual,
    useLedgerMeta: () => ({
      isPending: false,
      isSuccess: true,
      isError: false,
      error: null,
      data: { book, categories: [] },
    }),
    useBooks: () => ({
      isPending: false,
      isSuccess: true,
      isError: false,
      data: { books: [{ ...book, role: data.role }] },
    }),
    useBookMembers: () => ({
      isPending: false,
      isSuccess: true,
      isError: false,
      data: { myRole: data.role },
    }),
    useCurrentBookId: () => null,
    useRenameBook: () => ({ mutateAsync: async () => undefined, isPending: false }),
  };
});

vi.mock("../auth/AuthProvider.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth/AuthProvider.js")>();
  return { ...actual, useAuth: () => ({ user: { id: "user-1", defaultCurrency: "CNY" } }) };
});

import { BookSettingsPage } from "./BookSettingsPage.js";

const NAME = "家庭账本";
const NUMBER = "BK-000042";

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function stripped(relativePath: string): string {
  return stripComments(source(relativePath));
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function rendered(): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={["/books/book-1/settings"]}>
      <Routes>
        <Route path="/books/:bookId/settings" element={<BookSettingsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("账本设置页渲染出来只剩一次", () => {
  it("所有者看到：名称、编号各一次，卡片下方没有「账本资料」", () => {
    data.role = "owner";
    const html = rendered();

    expect(html).not.toContain("账本资料");
    expect(count(html, NAME)).toBe(1);
    expect(count(html, NUMBER)).toBe(1);
    // The card is still the only identity block, and it offers the rename entry.
    expect(html).toContain("修改账本名称");
    expect(html).not.toContain("只有查看权限");
  });

  it("viewer 看到：一句说明，没有可点的改名入口", () => {
    data.role = "viewer";
    const html = rendered();

    expect(html).not.toContain("账本资料");
    expect(count(html, NAME)).toBe(1);
    expect(count(html, NUMBER)).toBe(1);
    expect(html).not.toContain("修改账本名称");
    expect(html).toContain("只有查看权限");
  });

  it("两个角色都还有完整的三个区域", () => {
    for (const role of ["owner", "viewer"] as const) {
      data.role = role;
      const html = rendered();

      for (const heading of ["记账管理", "数据管理", "危险操作"]) {
        expect(html, heading).toContain(heading);
      }
    }
  });
});

describe("账本设置页源码不再重复", () => {
  const settings = stripped("./BookSettingsPage.tsx");

  it("「账本资料」整块删除，而不是藏起来", () => {
    expect(settings).not.toContain("账本资料");
    expect(settings).not.toContain("账本编号");
    // The two row helpers only existed for that block.
    expect(settings).not.toContain("ActionRow");
    expect(settings).not.toContain("ReadOnlyRow");
  });

  it("编号只在卡片里出现一次", () => {
    // Exactly one place hands the number to something that renders it.
    expect(settings.match(/bookNumber=\{bookNumber\}/g) ?? []).toHaveLength(1);
    // And the page itself never interpolates it into text (that was the subtitle).
    expect(settings).not.toContain("${bookNumber");
  });

  it("标题下面不再用「名称 · 编号」当副标题", () => {
    expect(settings).not.toContain("subtitle=");
  });
});

describe("改名入口搬进了顶部卡片", () => {
  const settings = stripped("./BookSettingsPage.tsx");

  it("只有可写用户才把 onRename 交给卡片", () => {
    expect(settings).toContain("{...(canWrite ? { onRename: openRename } : {})}");
    expect(settings.indexOf("<BookIdentityCard")).toBeLessThan(settings.indexOf("onRename"));
  });

  it("viewer 的说明在卡片下方，不在卡片消失", () => {
    expect(settings).toContain("只有查看权限");
    expect(settings.indexOf("只有查看权限")).toBeGreaterThan(settings.indexOf("<BookIdentityCard"));
  });
});

describe("返回不再绕圈", () => {
  it("账本设置的父级是账本详情，用 parent 模式", () => {
    const settings = stripped("./BookSettingsPage.tsx");

    expect(settings).toContain("backTo={`/books/${bookId}`}");
    expect(settings).toContain('backMode="parent"');
    expect(settings.indexOf("backTo={`/books/${bookId}`}")).toBeLessThan(settings.indexOf('backMode="parent"'));
  });

  it("导出的两个入口都回到它们真正的父级", () => {
    const exportPage = stripped("./ExportPage.tsx");

    expect(exportPage.match(/backMode="parent"/g) ?? []).toHaveLength(2);
    expect(exportPage).toContain('backTo="/"');
    expect(exportPage).toContain("backTo={`/books/${bookId}/settings`}");
    // The shared view has to forward the mode, or both entries would silently fall back to history.
    expect(exportPage).toContain("backMode={backMode}>");
  });
});
