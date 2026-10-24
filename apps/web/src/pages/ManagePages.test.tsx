import { EXPENSE_CATEGORIES } from "@libellum/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * **分类 / 支付方式 / 标签管理页的两种语言（S16）。**
 *
 * 要守住的是"界面翻译、数据不翻译"这条线：
 *  * 预置分类与支付方式在列表里按当前语言显示（`餐饮` → `Food & drink`），说明也一样——只要它还是预置原文；
 *  * 用户自建的名字（`猫粮`、`饭卡`、`出差`）任何语言下都原样显示；
 *  * 中文界面与以前逐字相同。
 *
 * 与 `bookSettings.test.tsx` 一样没有 DOM：数据 hooks 换成固定值，真实组件树用 `renderToStaticMarkup` 渲染。
 */
const MEAL = EXPENSE_CATEGORIES.find((preset) => preset.name === "餐饮"); // i18n-ignore：预置分类原名（数据）

vi.mock("../lib/queries.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/queries.js")>();
  const idle = { isPending: false, mutateAsync: async () => undefined };

  return {
    ...actual,
    useLedgerMeta: () => ({
      isPending: false,
      isSuccess: true,
      isError: false,
      error: null,
      data: {
        book: { id: "book-1", name: "家庭账本", bookNumber: "BK-000042", memberCount: 2 },
        categories: [
          { id: "c1", name: "餐饮", kind: "expense", description: MEAL?.description ?? null, isSystem: false, isArchived: false, sortOrder: 1 },
          { id: "c2", name: "猫粮", kind: "expense", description: null, isSystem: false, isArchived: false, sortOrder: 2 },
          { id: "c3", name: "暂无分类", kind: "expense", description: null, isSystem: true, isArchived: false, sortOrder: 99 },
          { id: "c4", name: "购物", kind: "expense", description: null, isSystem: false, isArchived: true, sortOrder: 3 },
        ],
        paymentMethods: [
          { id: "p1", name: "微信", isArchived: false, sortOrder: 1 },
          { id: "p2", name: "饭卡", isArchived: false, sortOrder: 2 },
        ],
        tags: [{ id: "t1", name: "出差", color: "#55997a" }],
      },
    }),
    useBookMembers: () => ({ isPending: false, isSuccess: true, isError: false, data: { myRole: "owner" } }),
    useClassificationUsage: () => ({ data: undefined }),
    useCategoryMutations: () => ({ create: idle, update: idle, archive: idle, permanentDelete: idle }),
    usePaymentMethodMutations: () => ({ create: idle, update: idle, archive: idle, permanentDelete: idle }),
    useTagMutations: () => ({ create: idle, remove: idle }),
  };
});

import { applyLocale } from "../i18n/index.js";
import { TAG_COLORS } from "../lib/tagColors.js";
import { CategoriesPage, PaymentMethodsPage, TagsPage } from "./ManagePages.js";

const CJK = /[㐀-鿿]/;
/** 用户数据：账本名与自建的名字。去掉它们之后，英文界面里不应再剩一个中文字。 */
const USER_DATA = ["家庭账本", "猫粮", "饭卡", "出差"];

function render(path: string, element: React.JSX.Element): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/books/:bookId/settings/:page" element={element} />
      </Routes>
    </MemoryRouter>,
  );
}

function withoutUserData(html: string): string {
  return USER_DATA.reduce((text, name) => text.replaceAll(name, ""), html);
}

afterEach(() => {
  applyLocale("zh-CN");
});

describe("管理页（中文，默认）", () => {
  it("keeps the original wording and the stored names", () => {
    const categories = render("/books/book-1/settings/categories", <CategoriesPage />);

    expect(categories).toContain("分类管理");
    expect(categories).toContain("正在管理「家庭账本（BK-000042）」");
    expect(categories).toContain("餐饮");
    expect(categories).toContain("猫粮");
    expect(categories).toContain("系统分类，不可修改");
    expect(categories).toContain("已归档（1）");
    expect(categories).toContain("归档后不再出现在记账选项中。已有记录仍会显示该分类的名称，可随时恢复。");

    const methods = render("/books/book-1/settings/payment-methods", <PaymentMethodsPage />);
    expect(methods).toContain("微信");
    expect(methods).toContain("饭卡");
  });
});

describe("管理页（英文）", () => {
  it("translates the interface and preset names, and leaves user data alone", () => {
    applyLocale("en-US");
    const categories = render("/books/book-1/settings/categories", <CategoriesPage />);

    expect(withoutUserData(categories)).not.toMatch(CJK);
    expect(categories).toContain("Managing “家庭账本 (BK-000042)”");
    expect(categories).toContain("Food &amp; drink");
    expect(categories).toContain("Everyday meals and drinks");
    expect(categories).toContain("Uncategorized");
    expect(categories).toContain("Shopping");
    expect(categories).toContain("猫粮");
    expect(categories).toContain("Archived (1)");
    expect(categories).toContain("Delete permanently");

    const methods = render("/books/book-1/settings/payment-methods", <PaymentMethodsPage />);
    expect(withoutUserData(methods)).not.toMatch(CJK);
    expect(methods).toContain("WeChat Pay");
    expect(methods).toContain("饭卡");

    const tags = render("/books/book-1/settings/tags", <TagsPage />);
    expect(withoutUserData(tags)).not.toMatch(CJK);
    expect(tags).toContain("出差");
    expect(tags).toContain(`aria-label="Color ${TAG_COLORS[0] ?? ""}"`);
  });
});
