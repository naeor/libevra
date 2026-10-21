import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  CurrencyQuickPick,
  SettingsCategoryCard,
  currentCurrency,
  type DefaultCurrency,
} from "../components/SettingsCard.js";
import { SettingsHome } from "./SettingsPage.js";

/**
 * **The settings home, checked without a DOM.**
 *
 * The project's web tests run in plain Node (`vitest.config.ts`), so the home is
 * built as a presentational component: flags and callbacks come in, markup comes
 * out. That is enough to pin the things this refactor is actually about —
 * **which categories exist, in what order, who may see the administrator card,
 * and that the quick currency control is not inside the card's own button.**
 *
 * ⚠️ **The last one is not cosmetic.** A currency pill nested in the card's
 * `<button>` produces invalid HTML, fires the navigation on every tap, and leaves
 * a screen reader unable to separate the two actions. The structural checks below
 * are the guard for that.
 */

function fakeCurrency(overrides: Partial<DefaultCurrency> = {}): DefaultCurrency {
  return {
    current: "CNY",
    pending: false,
    saved: false,
    error: null,
    choose: () => undefined,
    ...overrides,
  };
}

function homeHtml({
  isAdmin = false,
  currency = fakeCurrency(),
}: {
  readonly isAdmin?: boolean;
  readonly currency?: DefaultCurrency;
} = {}): string {
  return renderToStaticMarkup(
    <SettingsHome
      isAdmin={isAdmin}
      currency={currency}
      onOpen={() => undefined}
    />,
  );
}

/** Every element in a rendered tree, flattened. Enough for these hooks-free parts. */
type Element = React.ReactElement<Record<string, unknown>>;

function elementsOf(node: React.ReactNode): Element[] {
  const found: Element[] = [];

  const walk = (current: React.ReactNode): void => {
    if (Array.isArray(current)) {
      for (const child of current) walk(child);
      return;
    }

    if (!isValidElement(current)) return;

    const element = current as Element;
    found.push(element);
    walk(element.props["children"] as React.ReactNode);
  };

  walk(node);

  return found;
}

function buttonsOf(node: React.ReactNode): Element[] {
  return elementsOf(node).filter((element) => element.type === "button");
}

/** How deeply `<button>`s nest in the rendered markup. Anything above 1 is invalid. */
function deepestButtonNesting(html: string): number {
  let depth = 0;
  let deepest = 0;

  for (const match of html.matchAll(/<button\b|<\/button>/g)) {
    if (match[0] === "</button>") {
      depth -= 1;
    } else {
      depth += 1;
      deepest = Math.max(deepest, depth);
    }
  }

  return deepest;
}

const CATEGORIES = [
  ["记账偏好", "默认币种、重复提醒与录入习惯"],
  ["显示与数据", "语言、主题与汇率显示"],
  ["账号安全", "密码、恢复码与邀请码"],
  ["账号与数据", "导出、删除数据与注销账号"],
  ["关于 Libevra", "版本信息、开源协议与隐私说明"],
] as const;

describe("设置首页的分类", () => {
  it("lists the five ordinary categories in order, with their descriptions", () => {
    const html = homeHtml();
    let previous = -1;

    for (const [title, description] of CATEGORIES) {
      const at = html.indexOf(title);

      expect(at, title).toBeGreaterThan(previous);
      expect(html, title).toContain(description);
      previous = at;
    }
  });

  it("keeps 关于 Libevra last and opens it as a whole card", () => {
    const html = homeHtml();

    expect(html.indexOf("关于 Libevra")).toBeGreaterThan(html.indexOf("账号与数据"));
  });

  it("offers no fake quick buttons for 显示与数据 or 账号安全", () => {
    // Five category cards + the six currency pills. The account-data card is a real page, not a
    // quick action; any quick 导出/导入 control here would duplicate a page that already exists.
    expect(homeHtml()).not.toContain("导出数据");
    expect(homeHtml()).not.toContain("导入");
    expect((homeHtml().match(/<button\b/g) ?? []).length).toBe(5 + 6);
  });
});

describe("系统管理入口", () => {
  it("is hidden from an ordinary account, leaving no placeholder", () => {
    const html = homeHtml({ isAdmin: false });

    expect(html).not.toContain("系统管理");
    // And the rest of the page is untouched — 关于 is still there.
    expect(html).toContain("关于 Libevra");
  });

  it("is shown to an administrator, between 账号安全 and 关于", () => {
    const html = homeHtml({ isAdmin: true });

    expect(html).toContain("平台概览、账号、邀请码与操作记录");
    expect(html.indexOf("账号与数据")).toBeLessThan(html.indexOf("系统管理"));
    expect(html.indexOf("系统管理")).toBeLessThan(html.indexOf("关于 Libevra"));
    expect((html.match(/<button\b/g) ?? []).length).toBe(6 + 6);
  });
});

describe("默认币种的快捷控件", () => {
  it("shows the current currency and all six choices", () => {
    const html = homeHtml({ currency: fakeCurrency({ current: "USD" }) });

    for (const name of ["人民币", "美元", "欧元", "日元", "港币", "英镑"]) {
      expect(html).toContain(name);
    }

    // The written value is the current one, and its pill is the pressed one.
    expect(html).toMatch(/默认币种<\/span><span[^>]*>美元<\/span>/);
    expect(html).toMatch(/aria-pressed="true"[^>]*>美元</);
  });

  it("sits below the card, outside the card's own button", () => {
    const html = homeHtml();
    const cardButtonEnd = html.indexOf("</button>");
    const firstPill = html.indexOf('data-currency="CNY"');

    expect(cardButtonEnd).toBeGreaterThan(-1);
    // The quick control comes after the whole card, so the card stays one clean target.
    expect(firstPill).toBeGreaterThan(cardButtonEnd);
    expect(deepestButtonNesting(html)).toBe(1);
  });

  it("changes the currency and does nothing else", () => {
    const choose = vi.fn();
    const nodes = buttonsOf(CurrencyQuickPick({ value: fakeCurrency({ choose }) }));
    const usd = nodes.find((element) => element.props["data-currency"] === "USD");

    expect(usd).toBeDefined();

    (usd?.props as { onClick: () => void }).onClick();

    expect(choose).toHaveBeenCalledTimes(1);
    expect(choose).toHaveBeenCalledWith("USD");
  });
});

/**
 * ⚠️ **The card's click target is the whole card, and the quick control is a separate
 * element below it.** This is what makes "change currency" and "open 记账偏好" two
 * different gestures without any event-handling trick.
 */
describe("分类卡片的点击范围", () => {
  it("opens the card's own address when the whole card is pressed", () => {
    const onOpen = vi.fn();
    const card = SettingsCategoryCard({
      title: "记账偏好",
      description: "默认币种、录入习惯与记账界面",
      to: "/settings/preferences",
      onOpen,
    });

    const buttons = buttonsOf(card);
    expect(buttons).toHaveLength(1);

    const button = buttons[0];
    expect(button?.props["data-section"]).toBe("/settings/preferences");

    (button?.props as { onClick: () => void }).onClick();

    expect(onOpen).toHaveBeenCalledWith("/settings/preferences");
  });
});

/**
 * The default currency's single source of truth, as a pure function.
 *
 * ⚠️ **The PATCH answer wins over `AuthProvider`'s state** — that ordering is the
 * S13-E 8.4 fix, and it is why this is a function with a test rather than a line
 * buried in the hook.
 */
describe("默认币种以哪个回答为准", () => {
  it("prefers the PATCH's own answer, so the new choice is highlighted at once", () => {
    expect(currentCurrency({ defaultCurrency: "USD" }, "EUR")).toBe("EUR");
  });

  it("falls back to the signed-in user when no PATCH has answered yet", () => {
    expect(currentCurrency({ defaultCurrency: "USD" }, undefined)).toBe("USD");
  });

  it("falls back to CNY when neither is known", () => {
    expect(currentCurrency(null, undefined)).toBe("CNY");
  });
});
