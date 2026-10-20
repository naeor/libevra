import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BookIdentityCard } from "./BookSwitcherSheet.js";

/**
 * **The identity card at the top of 账本详情 / 账本设置 (S15-C).**
 *
 * ⚠️ **The owner's screenshot is the reason this test exists.** 账本设置 wrote the ledger's name
 * and number **three** times: in the subtitle, in this card, and again in the 「账本资料」 block.
 * The block is gone, the subtitle is gone, and the way to rename moved into this card — so the
 * guard has to be «each fact appears once» and «the read-only screen did not change».
 *
 * ⚠️ **One button, or two sibling buttons — never one inside the other.** The card is a `<button>`
 * (the owner asked for the whole strip to be the switch), and a nested button is invalid HTML that
 * turns one tap into two actions. `onRename` is therefore a second row, and only the screens that
 * pass it get that row at all.
 *
 * ⚠️ Asserted by static markup, because this project's web tests run in plain Node with no DOM
 * (`vitest.config.ts`). That pins what the card *says*; click wiring is pinned by the source
 * assertion at the bottom, which is the only thing left to check without a browser.
 */
const NAME = "家庭账本";
const NUMBER = "BK-000042";

function markup(onRename?: () => void): string {
  return renderToStaticMarkup(
    <BookIdentityCard
      bookId="book-1"
      name={NAME}
      bookNumber={NUMBER}
      memberCount={2}
      caption="正在管理"
      onSwitch={() => undefined}
      onRename={onRename}
    />,
  );
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** How deeply `<button>`s nest. Anything above 1 is invalid HTML. */
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

describe("账本身份卡片", () => {
  it("不传 onRename 时，仍然是原来那一个按钮（账本详情不变）", () => {
    const html = markup();

    expect(count(html, "<button")).toBe(1);
    expect(count(html, "切换")).toBe(1);
    expect(html).not.toContain("修改账本名称");
  });

  it("传了 onRename 才多出一行改名入口，且排在身份行之后", () => {
    const html = markup(() => undefined);

    expect(count(html, "<button")).toBe(2);
    expect(html).toContain("修改账本名称");
    expect(html.indexOf("修改账本名称")).toBeGreaterThan(html.indexOf("切换"));
  });

  it("改名入口不是「按钮里的按钮」", () => {
    expect(deepestButtonNesting(markup())).toBe(1);
    expect(deepestButtonNesting(markup(() => undefined))).toBe(1);
  });

  it("名称与编号各只出现一次 —— 重复正是这次要修的问题", () => {
    for (const html of [markup(), markup(() => undefined)]) {
      expect(count(html, NAME)).toBe(1);
      expect(count(html, NUMBER)).toBe(1);
    }
  });

  it("改名入口接线到 onRename（它自己不导航、也不发请求）", () => {
    const source = readFileSync(fileURLToPath(new URL("./BookSwitcherSheet.tsx", import.meta.url)), "utf8");

    expect(source).toContain("onClick={onRename}");
    expect(source.match(/onClick=\{onRename\}/g) ?? []).toHaveLength(1);
  });
});
