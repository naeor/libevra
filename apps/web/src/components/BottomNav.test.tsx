import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GUEST_IDENTITY_STORAGE_KEY } from "../lib/guest/identity.js";
import { BottomNav } from "./BottomNav.js";

/**
 * **The centre menu, checked without a DOM.**
 *
 * The row now has five cards, and the things that can silently break are attributes rather than
 * looks: a card pointed at the wrong import screen, a guest card that pretends to work, a short
 * caption that becomes the accessible name, and a closed menu whose links are still in the tab
 * order.
 *
 * ⚠️ **`/import` vs `/import-ledger` is the expensive mistake this file exists to catch.** The
 * first imports a file into the ledger the reader is in; the second migrates a whole ledger. They
 * are one word apart and only one of them may be reached from this menu.
 *
 * The visual width is pinned by the class names plus the arithmetic in "320px" below. This
 * workspace has no layout engine, so a screenshot is the other half of that check — see the
 * hand-off notes for the real-browser pass.
 */

/** A guest is a signed-out visitor with a persisted identity; that is all `useGuestMode` reads. */
const GUEST_IDENTITY = JSON.stringify({
  id: "guest-0123456789abcdef",
  schemaVersion: 1,
  createdAt: "2026-10-21T00:00:00.000Z",
  welcomePending: false,
  noticeAcknowledged: true,
  lastPath: null,
});

function renderNav({ open = true, guest = false }: { readonly open?: boolean; readonly guest?: boolean } = {}): string {
  if (guest) {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => (key === GUEST_IDENTITY_STORAGE_KEY ? GUEST_IDENTITY : null),
      setItem: () => undefined,
      removeItem: () => undefined,
    });
  }

  /**
   * ⚠️ **A fresh client per render.** `useLedger` is called by the bar for the fourth tab's label;
   * reusing one client would let a test inherit another's cache.
   */
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <BottomNav
          active="/"
          onNavigate={() => undefined}
          cards={{ mode: "toggle", expanded: open, active: false, onToggle: () => undefined }}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The whole opening tag of the first element carrying this `aria-label`. */
function tagWithLabel(html: string, label: string): string {
  const marker = `aria-label="${label}"`;
  const at = html.indexOf(marker);
  if (at < 0) return "";

  const start = html.lastIndexOf("<", at);
  const end = html.indexOf(">", at);

  return html.slice(start, end + 1);
}

/** Every `<a>`/`<button>` in the menu row, in order. */
function menuCards(html: string): string[] {
  const row = /<ul class="[^"]*pb-\[26px\][^"]*">([\s\S]*?)<\/ul>/.exec(html);
  if (row?.[1] === undefined) return [];

  return [...row[1].matchAll(/<(a|button)\b[\s\S]*?<\/\1>/g)].map((match) => match[0]);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("中央 + 菜单的五个入口", () => {
  it("shows the five names in the order that keeps 手动记账 in the centre", () => {
    const html = renderNav();
    const cards = menuCards(html);

    expect(cards).toHaveLength(5);
    for (const label of ["粘贴识别", "语音记账", "手动记账", "拍照识别", "导入账单"]) {
      expect(html).toContain(`>${label}</span>`);
    }
    for (const label of ["粘贴", "语音", "手动", "拍照", "导入"]) {
      expect(html).toContain(`>${label}</span>`);
    }

    // The owner explicitly asked for 手动记账 in the visual centre; the row is a flex list, so
    // index 2 is the centre. Pinning the order catches a reorder that leaves every caption intact.
    expect(cards[2]).toContain(">手动</span>");
    expect(cards[2]).toContain(">手动记账</span>");
  });

  it("shows short captions below 420px and full captions at 420px+", () => {
    const html = renderNav();
    const cards = menuCards(html);
    const shortNames = ["粘贴", "语音", "手动", "拍照", "导入"];
    const fullNames = ["粘贴识别", "语音记账", "手动记账", "拍照识别", "导入账单"];

    expect(cards).toHaveLength(5);
    for (let index = 0; index < cards.length; index += 1) {
      const card = cards[index] ?? "";
      const short = shortNames[index] ?? "";
      const full = fullNames[index] ?? "";

      expect(card).toContain('<span class="min-[420px]:hidden">');
      expect(card).toContain(`>${short}</span>`);
      expect(card).toContain('<span class="hidden min-[420px]:inline">');
      expect(card).toContain(`>${full}</span>`);

      // ⚠️ The visible caption may shorten, but the accessible name must not. Every card keeps
      // the full four-character name in `aria-label`, even while its visible text is 2 chars.
      expect(card).toContain(`aria-label="${full}"`);
      expect(card).toContain('aria-hidden="true"');

      // The wrapper is the existing caption style; the switch only hides one child.
      expect(card).toContain('<span aria-hidden="true" class="whitespace-nowrap text-micro">');
    }
  });

  it("keeps every destination, including the new paste screen", () => {
    const html = renderNav();

    expect(tagWithLabel(html, "粘贴识别")).toContain('href="/paste"');
    expect(tagWithLabel(html, "语音记账")).toContain('href="/record"');
    expect(tagWithLabel(html, "手动记账")).toContain('href="/add"');
    expect(tagWithLabel(html, "拍照识别")).toContain('href="/scan"');
  });

  it("points 导入账单 at /import — never at /import-ledger", () => {
    const html = renderNav();
    const importCard = tagWithLabel(html, "导入账单");

    expect(importCard).not.toBe("");
    // `?from=nav` tells ImportPage this is the central-menu origin (hide the legacy 返回导出 link,
    // use 明细 as the deep-link fallback); the path itself is still the current-ledger import.
    expect(importCard).toContain('href="/import?from=nav"');
    expect(importCard).not.toContain("/import-ledger");

    // Belt and braces: the wrong destination must not be reachable from this menu at all.
    expect(html).not.toContain("/import-ledger");
  });

  it("gives all five cards one elastic shape, one caption size and one icon size", () => {
    const html = renderNav();
    const cards = menuCards(html);
    const widths = cards.map((card) => /class="([^"]*)"/.exec(card)?.[1] ?? "");

    for (const classes of widths) {
      // The card fills the equal-width <li> instead of being pinned to a fixed width.
      expect(classes).toContain("w-full");
      expect(classes).toContain("min-w-0");
      expect(classes).toContain("text-brand-dark");
    }

    // Five equal-width flex items, one per card. The bottom tabs are separate and use flex-1 too,
    // so count the menu-specific `basis-0` rather than every flex-1 on the page.
    expect((html.match(/<li class="min-w-0 flex-1 basis-0">/g) ?? []).length).toBe(5);
    expect(html).not.toContain("w-14");
    expect(html).not.toContain("sm:w-16");

    // Five `size-6` icons and five captions, not four plus an outlier.
    expect((html.match(/<span aria-hidden="true" class="whitespace-nowrap text-micro">/g) ?? []).length).toBe(5);
    // Menu icons plus the four destination-tab icons. The raised `+` is `size-8` on purpose.
    expect((html.match(/class="size-6"/g) ?? []).length).toBe(5 + 4);
  });
});

describe("访客下的入口", () => {
  it("disables the server-backed cards, including 粘贴识别, and links nowhere", () => {
    const html = renderNav({ guest: true });

    const pasteCard = tagWithLabel(html, "粘贴识别，需要正式账号");
    expect(pasteCard.startsWith("<button")).toBe(true);
    expect(pasteCard).toContain('disabled=""');

    const importCard = tagWithLabel(html, "导入账单，需要正式账号");
    expect(importCard.startsWith("<button")).toBe(true);
    expect(importCard).toContain('disabled=""');
    expect(html).not.toContain('href="/paste"');
    expect(html).not.toContain('href="/import"');
    expect(html).not.toContain('href="/record"');
    expect(html).not.toContain('href="/scan"');

    // 手动 is still the guest's live card — the whole point of guest mode.
    expect(html).toContain('href="/add"');
  });
});

describe("菜单开合", () => {
  it("reports the open state and turns the plus into a cross", () => {
    const open = renderNav({ open: true });

    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain('aria-label="收起记账方式"');
    expect(open).toContain("rotate-45");
    expect(open).not.toContain("rotate-0");
  });

  it("reports the closed state, and removes the hidden cards from the tab order", () => {
    const closed = renderNav({ open: false });

    expect(closed).toContain('aria-expanded="false"');
    expect(closed).toContain('aria-label="展开记账方式"');
    expect(closed).toContain("rotate-0");

    // ⚠️ The row stays mounted and only fades, so without this every card would remain a tab stop
    // inside an `aria-hidden` container — focus would disappear behind an invisible menu.
    for (const card of menuCards(closed)) {
      expect(card).toContain('tabindex="-1"');
    }
    expect(menuCards(renderNav({ open: true })).every((card) => card.includes('tabindex="0"'))).toBe(true);
  });
});

describe("320/375/390/430px 的弹性宽度", () => {
  it("uses one row of equal-width cards and a consistent safe margin", () => {
    const html = renderNav();
    const row = /<ul class="([^"]*pb-\[26px\][^"]*)"/.exec(html)?.[1] ?? "";

    // Full-width row, capped only by the existing max-w-md used from sm upward.
    expect(row).toContain("w-full");
    expect(row).toContain("max-w-md");
    expect(row).not.toContain("w-14");

    // The three responsive steps. Each pair moves padding and gap together, so the cards keep
    // equal width and the row keeps a balanced edge margin.
    expect(row).toContain("px-2");
    expect(row).toContain("gap-1");
    expect(row).toContain("min-[360px]:px-3");
    expect(row).toContain("min-[360px]:gap-1.5");
    expect(row).toContain("min-[420px]:px-4");
    expect(row).toContain("min-[420px]:gap-2");
    expect(row).toContain("sm:px-6");
    expect(row).toContain("sm:gap-3");

    // The arithmetic behind those classes. Cards are `(viewport - 2 × padding - 4 × gap) / 5`.
    const layouts = [
      { width: 320, padding: 8, gap: 4, card: 57.6 },
      { width: 375, padding: 12, gap: 6, card: 65.4 },
      { width: 390, padding: 12, gap: 6, card: 68.4 },
      { width: 430, padding: 16, gap: 8, card: 73.2 },
    ] as const;

    for (const { width, padding, gap, card } of layouts) {
      const occupied = 5 * card + 4 * gap;
      expect(card).toBeCloseTo((width - 2 * padding - 4 * gap) / 5, 5);
      expect(occupied).toBeCloseTo(width - 2 * padding, 5);
      // Every card remains a comfortable touch target on every tested screen.
      expect(card).toBeGreaterThanOrEqual(44);
    }
  });
});
