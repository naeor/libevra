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

/**
 * S15-E3：账本设置里新增了「已忽略的重复交易」管理区，它有自己的数据 hooks。
 * 这一页的布局测试不挂 QueryClient（其余数据 hooks 都在上面 stub 掉了），所以这里把
 * 关系 hooks 也替换成固定的空列表——被测试的仍然是「设置页渲染出了什么」。
 */
vi.mock("../lib/notDuplicateRelations.js", () => ({
  useNotDuplicateRelations: () => ({ data: { items: [] }, isLoading: false, error: null }),
  useRevokeNotDuplicateRelation: () => ({ mutateAsync: async () => undefined }),
}));

import { applyLocale } from "../i18n/index.js";
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

describe("账本设置页的英文界面（S16）", () => {
  it("shows the page in English and leaves the ledger name as stored", () => {
    data.role = "owner";
    applyLocale("en-US");
    try {
      const html = rendered();

      for (const text of ["Ledger settings", "Managing", "Rename ledger", "Recording", "Data", "Danger zone", "Categories", "Switch", "3 members"]) {
        expect(html, text).toContain(text);
      }
      for (const chinese of ["账本设置", "正在管理", "修改账本名称", "记账管理", "数据管理", "危险操作", "分类管理", "切换", "3 人"]) {
        expect(html, chinese).not.toContain(chinese);
      }
      // 账本名是用户数据：原样、只出现一次。
      expect(count(html, NAME)).toBe(1);
      expect(count(html, NUMBER)).toBe(1);
    } finally {
      applyLocale("zh-CN");
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

  it("归档/删除说明不向用户暴露内部墓碑与 UTC 术语", () => {
    // S16：说明文字搬进 `books` 模块（中文原文不变），所以两处都查。
    const copy = stripped("../i18n/resources/zh-CN/books.ts");

    expect(settings).not.toContain("墓碑");
    expect(settings).not.toContain("UTC 时间");
    expect(copy).not.toContain("墓碑");
    expect(copy).not.toContain("UTC 时间");
    expect(copy).toContain("不含账目内容的删除记录");
    expect(settings).toContain('t("books.settings.archiveDialog.cleanup")');
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
    // S16：句子在 `books.settings.viewerNotice`（中文原文不变），页面按键取。
    const viewerNotice = 't("books.settings.viewerNotice")';

    expect(stripped("../i18n/resources/zh-CN/books.ts")).toContain("只有查看权限");
    expect(settings).toContain(viewerNotice);
    expect(settings.indexOf(viewerNotice)).toBeGreaterThan(settings.indexOf("<BookIdentityCard"));
  });
});

describe("返回不再绕圈", () => {
  it("账本设置的父级是账本详情，用 parent 模式", () => {
    const settings = stripped("./BookSettingsPage.tsx");

    expect(settings).toContain("backTo={`/books/${bookId}`}");
    expect(settings).toContain('backMode="parent"');
    expect(settings.indexOf("backTo={`/books/${bookId}`}")).toBeLessThan(settings.indexOf('backMode="parent"'));
  });

  it("导出保持历史返回（它是设置的叶子页，-1 天然回设置并消耗自己的条目）", () => {
    const exportPage = stripped("./ExportPage.tsx");

    expect(exportPage).not.toContain("backMode");
    expect(exportPage).toContain('backTo="/"');
    expect(exportPage).toContain("backTo={`/books/${bookId}/settings`}");
    // The shared view must not forward a mode: history is what keeps 导出 ↔ 设置 from looping,
    // and a declared parent here was the first version's second bug.
    expect(exportPage).not.toContain("backMode={");
  });
});
