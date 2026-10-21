import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GUEST_IDENTITY_STORAGE_KEY } from "../lib/guest/identity.js";
import { BottomNav } from "./BottomNav.js";

/**
 * **The centre menu, checked without a DOM.**
 *
 * The row now has four cards, and the things that can silently break are attributes rather than
 * looks: a card pointed at the wrong import screen, a guest card that pretends to work, a caption
 * shortened to fit, and a closed menu whose links are still in the tab order.
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

describe("中央 + 菜单的四个入口", () => {
  it("shows 语音 / 手动 / 拍照 / 导入账单, with the full four-character caption", () => {
    const html = renderNav();
    const cards = menuCards(html);

    expect(cards).toHaveLength(4);
    for (const label of ["语音", "手动", "拍照", "导入账单"]) {
      expect(html).toContain(`>${label}</span>`);
    }

    // ⚠️ The owner asked for 「导入账单」, not 「导入」. A narrower card that clipped or shortened
    // the caption would be the visible failure, so the words are asserted exactly.
    expect(html).toContain("导入账单");
    expect(html).not.toMatch(/>\s*导入\s*<\/span>/);
  });

  it("keeps the three existing destinations", () => {
    const html = renderNav();

    expect(tagWithLabel(html, "语音记账")).toContain('href="/record"');
    expect(tagWithLabel(html, "手动记账")).toContain('href="/add"');
    expect(tagWithLabel(html, "拍照记账")).toContain('href="/scan"');
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

  it("gives all four cards one shape, one caption size and one icon size", () => {
    const html = renderNav();
    const cards = menuCards(html);
    const widths = cards.map((card) => /class="([^"]*)"/.exec(card)?.[1] ?? "");

    for (const classes of widths) {
      expect(classes).toContain("w-16");
      expect(classes).toContain("sm:w-[4.5rem]");
      expect(classes).toContain("text-brand-dark");
    }

    // Four `size-6` icons and four captions, not three plus an outlier.
    expect((html.match(/<span class="whitespace-nowrap text-micro">/g) ?? []).length).toBe(4);
    // Menu icons plus the four destination-tab icons. The raised `+` is `size-8` on purpose.
    expect((html.match(/class="size-6"/g) ?? []).length).toBe(4 + 4);
  });
});

describe("访客下的导入账单", () => {
  it("is disabled with the same honest reason as 语音/拍照, and links nowhere", () => {
    const html = renderNav({ guest: true });

    const importCard = tagWithLabel(html, "导入账单，需要正式账号");
    expect(importCard.startsWith("<button")).toBe(true);
    expect(importCard).toContain('disabled=""');
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

describe("320px 窄屏", () => {
  it("keeps four cards on one row by shrinking them below sm", () => {
    const html = renderNav();
    const row = /<ul class="([^"]*pb-\[26px\][^"]*)"/.exec(html)?.[1] ?? "";

    expect(row).toContain("px-3");
    expect(row).toContain("gap-2");
    expect(row).toContain("sm:px-6");
    expect(row).toContain("sm:gap-3");

    /**
     * ⚠️ **These are the numbers the classes above mean**, checked here because a class name alone
     * does not prove they fit: 4 × 64px cards + 3 × 8px gaps + 2 × 12px padding = 304px, which
     * leaves 16px on a 320px screen. A second row was rejected because the frame reserves 100px for
     * this menu and two rows would cover the bar.
     */
    const CARD_PX = 64;
    const GAP_PX = 8;
    const PADDING_PX = 12;
    const NARROW_PHONE_PX = 320;
    const occupied = 4 * CARD_PX + 3 * GAP_PX + 2 * PADDING_PX;

    expect(occupied).toBe(304);
    expect(occupied).toBeLessThanOrEqual(NARROW_PHONE_PX);
  });
});
