/**
 * 电脑版导航的一致性测试。
 *
 * ⚠️ `desktopEntryDisabled` 是「游客能用哪些记账方式」的**第二份判断**（AGENTS §6：界面上的「是否可点」判断只许
 * 新增、不许改动，第二份必须有一致性测试）。这里把原侧栏「记一笔」菜单真正渲染出来，逐项比对：两边不一致，测试失败。
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ENTRY_ACTIONS } from "../components/BottomNav.js";
import { AddEntryButton } from "../workspace/GlobalRail.js";
import { desktopEntryDisabled, navIdFor, pathAfterSwitch } from "./DesktopNav.js";

const mode = vi.hoisted(() => ({ guest: false }));
vi.mock("../lib/guest/session.js", () => ({ useGuestMode: () => mode.guest }));

/** 原侧栏菜单里每一项是否禁用，按渲染顺序（手动记账在首位）。 */
function railDisabled(guest: boolean): readonly boolean[] {
  mode.guest = guest;
  const html = renderToStaticMarkup(
    <AddEntryButton compact={false} follow={false} followOpen={false} onNavigate={() => {}} onToggleFollow={() => {}} onCloseFollow={() => {}} />,
  );
  mode.guest = false;
  return [...html.matchAll(/<button([^>]*)role="menuitem"([^>]*)>/g)].map((match) => `${match[1] ?? ""}${match[2] ?? ""}`.includes('disabled=""'));
}

describe("电脑版记账菜单与原侧栏的游客判断一致", () => {
  const ordered = [...ENTRY_ACTIONS].sort((a, b) => Number(b.id === "manual") - Number(a.id === "manual"));

  for (const guest of [true, false]) {
    it(guest ? "游客：只有手动记账可用" : "已登录：五种方式都可用", () => {
      const rail = railDisabled(guest);
      expect(rail).toHaveLength(ENTRY_ACTIONS.length);
      expect(ordered.map((action) => desktopEntryDisabled(action, guest))).toEqual(rail);
    });
  }
});

describe("navIdFor", () => {
  it("把地址归到对应的导航目的地", () => {
    expect(navIdFor("/dashboard")).toBe("dashboard");
    expect(navIdFor("/")).toBe("entries");
    expect(navIdFor("/transactions/abc")).toBe("entries");
    expect(navIdFor("/stats")).toBe("stats");
    expect(navIdFor("/stats/cards/x")).toBe("stats");
    expect(navIdFor("/ledger/members")).toBe("collab");
    expect(navIdFor("/books/b1")).toBe("book");
    expect(navIdFor("/start")).toBe("book");
    expect(navIdFor("/settings/appearance")).toBeNull();
    expect(navIdFor("/statsx")).toBeNull();
  });
});

describe("pathAfterSwitch", () => {
  it("属于某一笔账或某张卡片的页面回到明细，其它页面原地重新载入", () => {
    expect(pathAfterSwitch("/transactions/e1")).toBe("/");
    expect(pathAfterSwitch("/books/b1/settings")).toBe("/");
    expect(pathAfterSwitch("/stats/cards/c1")).toBe("/");
    expect(pathAfterSwitch("/dashboard")).toBe("/dashboard");
    expect(pathAfterSwitch("/stats")).toBe("/stats");
    expect(pathAfterSwitch("/ledger/members")).toBe("/ledger/members");
  });
});
