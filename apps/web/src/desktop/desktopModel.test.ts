import type { Tag, Transaction } from "@libellum/shared";
import { describe, expect, it } from "vitest";

import {
  cardSpan,
  dashboardColumns,
  defaultDashboard,
  ledgerCardId,
  moveCard,
  parseDashboard,
  resolveDashboard,
  totalsByCurrency,
  updateCard,
} from "./dashboardModel.js";
import { popoverPosition } from "./DesktopPopover.js";
import { shouldLandOnDashboard } from "./landing.js";
import { dailyTotals, entryMatches, groupByDay } from "./entriesView.js";
import { activeCollabTab, activeSettingsItem, sectionFor, settingsItems } from "./sections.js";
import { DESKTOP_ENTER_WIDTH, DESKTOP_EXIT_WIDTH, parseShellOverride, shellKindFor } from "./shellKind.js";
import { MIN_MAIN, PANEL_DEFAULT, PANEL_MAX, PANEL_MIN, clampPanel, splitLayout } from "./split.js";

describe("shellKindFor：按输入能力 × 窗口大小选外壳", () => {
  const base = { fine: true, width: 1280, height: 800, override: "auto" as const, previous: null };

  it("鼠标为主且窗口够大才进电脑版；触屏为主一律原工作区", () => {
    expect(shellKindFor(base)).toBe("desktop");
    expect(shellKindFor({ ...base, fine: false })).toBe("workspace");
    expect(shellKindFor({ ...base, fine: false, width: 1366, height: 1024 })).toBe("workspace");
    expect(shellKindFor({ ...base, height: 400 })).toBe("workspace");
  });

  it("进入与退出用不同宽度，临界附近不来回切换", () => {
    const between = (DESKTOP_ENTER_WIDTH + DESKTOP_EXIT_WIDTH) / 2;
    expect(shellKindFor({ ...base, width: between, previous: "workspace" })).toBe("workspace");
    expect(shellKindFor({ ...base, width: between, previous: "desktop" })).toBe("desktop");
    expect(shellKindFor({ ...base, width: DESKTOP_EXIT_WIDTH - 1, previous: "desktop" })).toBe("workspace");
  });

  it("地址参数可以强制指定，未知值忽略", () => {
    expect(shellKindFor({ ...base, fine: false, override: "desktop" })).toBe("desktop");
    expect(shellKindFor({ ...base, override: "workspace" })).toBe("workspace");
    expect(parseShellOverride("desktop")).toBe("desktop");
    expect(parseShellOverride("mobile")).toBeNull();
    expect(parseShellOverride(null)).toBeNull();
  });
});

describe("shouldLandOnDashboard：根路径何时先到总览", () => {
  const base = { previous: null, previousStandalone: false, pathname: "/", search: "", tabVisited: false };
  it("这个标签第一次打开、或刚从登录页进来时到总览", () => {
    expect(shouldLandOnDashboard(base)).toBe(true);
    expect(shouldLandOnDashboard({ ...base, previous: "/login", previousStandalone: true, tabVisited: true })).toBe(true);
  });
  it("刷新明细、切换账本后的整页载入、在应用里回到明细：留在明细", () => {
    expect(shouldLandOnDashboard({ ...base, tabVisited: true })).toBe(false);
    expect(shouldLandOnDashboard({ ...base, previous: "/transactions/e1", tabVisited: true })).toBe(false);
    expect(shouldLandOnDashboard({ ...base, search: "?entry=e1" })).toBe(false);
    expect(shouldLandOnDashboard({ ...base, pathname: "/stats" })).toBe(false);
  });
});

describe("splitLayout：辅助栏宽度", () => {
  it("夹在 280–520 之间，非数字回到默认", () => {
    expect(clampPanel(100)).toBe(PANEL_MIN);
    expect(clampPanel(900)).toBe(PANEL_MAX);
    expect(clampPanel(Number.NaN)).toBe(PANEL_DEFAULT);
  });

  it("主区至少保留 MIN_MAIN；放不下时先收窄辅助栏，再放不下就不并排", () => {
    expect(splitLayout(1400, 400)).toEqual({ fits: true, panelWidth: 400, maxPanel: PANEL_MAX });
    expect(splitLayout(MIN_MAIN + 300, 400)).toEqual({ fits: true, panelWidth: 300, maxPanel: 300 });
    expect(splitLayout(MIN_MAIN + PANEL_MIN - 1, 320).fits).toBe(false);
    expect(splitLayout(0, 360)).toEqual({ fits: true, panelWidth: 360, maxPanel: PANEL_MAX });
  });
});

describe("popoverPosition：弹出面板不超出视口", () => {
  const viewport = { width: 1000, height: 700 };
  it("向右弹出时夹在视口内", () => {
    expect(popoverPosition({ left: 10, top: 600, right: 60, bottom: 650 }, { width: 280, height: 300 }, viewport, "right-start")).toEqual({ left: 70, top: 392 });
  });
  it("下方放不下时翻到上方；右对齐时不越过左边", () => {
    expect(popoverPosition({ left: 900, top: 600, right: 960, bottom: 640 }, { width: 240, height: 200 }, viewport, "bottom-end")).toEqual({ left: 720, top: 394 });
    expect(popoverPosition({ left: 20, top: 10, right: 60, bottom: 40 }, { width: 240, height: 200 }, viewport, "bottom-end")).toEqual({ left: 8, top: 46 });
  });
});

describe("dashboardModel：总览布局", () => {
  it("一本账时账本卡片扩展；多本账时按数量变紧凑，最近与待处理默认在网格", () => {
    const single = defaultDashboard(["a"]);
    expect(single.cards[0]).toMatchObject({ id: ledgerCardId("a"), size: "expanded" });
    expect(single.cards.find((card) => card.kind === "cross")?.hidden).toBe(true);
    expect(defaultDashboard(["a", "b"]).cards.filter((card) => card.kind === "ledger").every((card) => card.size === "standard")).toBe(true);
    expect(defaultDashboard(["a", "b", "c", "d", "e"]).cards[0]?.size).toBe("compact");
    const multi = defaultDashboard(["a", "b"]);
    expect(multi.cards.find((card) => card.kind === "recent")?.hidden).toBeUndefined();
    expect(multi.cards.find((card) => card.kind === "cross")?.hidden).toBeUndefined();
  });

  it("读本机配置时丢掉格式不对的卡片与重复编号", () => {
    expect(parseDashboard(null)).toBeNull();
    expect(parseDashboard({ version: 2, cards: [] })).toBeNull();
    const parsed = parseDashboard({
      version: 1,
      cards: [
        { id: "ledger:a", kind: "ledger", size: "standard", bookId: "a", metric: "income" },
        { id: "ledger:a", kind: "ledger", size: "compact", bookId: "a" },
        { id: "x", kind: "chart", size: "standard" },
        { id: "quick", kind: "quick", size: "huge" },
        { id: "ledger:b", kind: "ledger", size: "standard" },
        { id: "recent", kind: "recent", size: "compact", hidden: true, metric: "nope" },
      ],
      crossScope: ["a", 3],
    });
    expect(parsed).toEqual({
      version: 1,
      cards: [
        { id: "ledger:a", kind: "ledger", size: "standard", bookId: "a", metric: "income" },
        { id: "recent", kind: "recent", size: "compact", hidden: true },
      ],
      crossScope: ["a"],
    });
  });

  it("和真实账本对齐：去掉不在的账本，新账本接在账本卡片后，缺的功能卡片补上并隐藏", () => {
    const saved = {
      version: 1 as const,
      cards: [
        { id: "quick", kind: "quick" as const, size: "compact" as const },
        { id: ledgerCardId("a"), kind: "ledger" as const, size: "expanded" as const, bookId: "a" },
        { id: ledgerCardId("gone"), kind: "ledger" as const, size: "standard" as const, bookId: "gone" },
        { id: "cross", kind: "cross" as const, size: "standard" as const },
      ],
      crossScope: ["gone"],
    };
    const resolved = resolveDashboard(saved, ["a", "b"]);
    expect(resolved.cards.map((card) => card.id)).toEqual(["quick", ledgerCardId("a"), ledgerCardId("b"), "cross", "recent", "pending", "trend"]);
    expect(resolved.cards.find((card) => card.id === "recent")?.hidden).toBe(true);
    // 指定的账本都不在了：回到「全部」，而不是变成空范围。
    expect(resolved.crossScope).toBe("all");
    expect(resolveDashboard(null, ["a"])).toEqual(defaultDashboard(["a"]));
  });

  it("移动只和相邻的可见卡片交换；取消隐藏去掉 hidden 字段", () => {
    const config = defaultDashboard(["a", "b"]);
    const moved = moveCard(config, ledgerCardId("b"), -1);
    expect(moved.cards.slice(0, 2).map((card) => card.id)).toEqual([ledgerCardId("b"), ledgerCardId("a")]);
    expect(moveCard(config, ledgerCardId("a"), -1)).toBe(config);
    // 最后一张待处理卡片不能再后移。
    expect(moveCard(config, "pending", 1)).toBe(config);
    const shown = updateCard(config, "recent", { hidden: false });
    expect("hidden" in (shown.cards.find((card) => card.id === "recent") ?? {})).toBe(false);
  });

  it("列数按宽度、最多 8 列；卡片跨度不超过列数", () => {
    expect(dashboardColumns(0)).toBe(6);
    expect(dashboardColumns(200)).toBe(1);
    expect(dashboardColumns(472)).toBe(2);
    expect(dashboardColumns(5000)).toBe(8);
    expect(cardSpan("expanded", 1)).toEqual({ columns: 1, rows: 2 });
    expect(cardSpan("standard", 4)).toEqual({ columns: 2, rows: 1 });
    expect(cardSpan("compact", 4)).toEqual({ columns: 1, rows: 1 });
  });

  it("多账本合计按币种分开、不折算、不去重；首选币种排第一", () => {
    const totals = totalsByCurrency(
      [
        { currencies: [{ currency: "CNY", expenseCents: 1000, incomeCents: 0, balanceCents: -1000 }, { currency: "USD", expenseCents: 500, incomeCents: 0, balanceCents: -500 }] },
        { currencies: [{ currency: "CNY", expenseCents: 1000, incomeCents: 3000, balanceCents: 2000 }, { currency: "JPY", expenseCents: 90000, incomeCents: 0, balanceCents: -90000 }] },
      ],
      "USD",
    );
    expect(totals).toEqual([
      { currency: "USD", expenseCents: 500, incomeCents: 0, balanceCents: -500 },
      { currency: "JPY", expenseCents: 90000, incomeCents: 0, balanceCents: -90000 },
      { currency: "CNY", expenseCents: 2000, incomeCents: 3000, balanceCents: 1000 },
    ]);
  });
});

function tag(id: string, name = id): Tag {
  return { id, name } as Tag;
}

function entry(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "e1",
    kind: "expense",
    amountCents: 3850,
    currency: "CNY",
    categoryId: "c-food",
    categoryName: "吃饭",
    categoryIsSystem: false,
    paymentMethodId: "p-cash",
    paymentMethodName: "现金",
    occurredAt: "2026-10-10T09:12:00+08:00",
    occurredLocalDate: "2026-10-10",
    occurredTz: "Asia/Shanghai",
    note: "午饭 Sandwich",
    tags: [tag("t-a", "出差")],
    version: 1,
    ...overrides,
  };
}

describe("entriesView：明细的搜索与分组", () => {
  it("备注、分类、支付方式、标签和金额都能搜，大小写不敏感，多个词都要命中", () => {
    const item = entry();
    expect(entryMatches(item, "")).toBe(true);
    expect(entryMatches(item, "sandwich")).toBe(true);
    expect(entryMatches(item, "吃饭 现金")).toBe(true);
    expect(entryMatches(item, "出差")).toBe(true);
    expect(entryMatches(item, "38.5")).toBe(true);
    expect(entryMatches(item, "38.50")).toBe(true);
    expect(entryMatches(item, "吃饭 银行卡")).toBe(false);
  });

  it("按本地日期分组，保持原有顺序", () => {
    const groups = groupByDay([entry({ id: "a", occurredLocalDate: "2026-10-12" }), entry({ id: "b", occurredLocalDate: "2026-10-12" }), entry({ id: "c" })]);
    expect(groups.map((group) => [group.date, group.entries.map((item) => item.id)])).toEqual([
      ["2026-10-12", ["a", "b"]],
      ["2026-10-10", ["c"]],
    ]);
  });

  it("每日趋势只算这一币种的支出", () => {
    const totals = dailyTotals(
      [entry(), entry({ id: "b", amountCents: 150 }), entry({ id: "c", kind: "income" }), entry({ id: "d", currency: "USD" }), entry({ id: "e", occurredLocalDate: "2026-09-30" })],
      "2026-10",
      "CNY",
    );
    expect(totals).toHaveLength(31);
    expect(totals[9]).toBe(4000);
    expect(totals.reduce((sum, value) => sum + value, 0)).toBe(4000);
    expect(dailyTotals([], "2026-13", "CNY")).toEqual([]);
  });
});

describe("sections：电脑版页面分组", () => {
  it("设置类与协作类地址分开，记账流程里的 /ledger/more 不算协作", () => {
    expect(sectionFor("/settings/appearance/theme")).toBe("settings");
    expect(sectionFor("/me")).toBe("settings");
    expect(sectionFor("/profile")).toBe("settings");
    expect(sectionFor("/ledger")).toBe("collab");
    expect(sectionFor("/ledger/members/u1")).toBe("collab");
    expect(sectionFor("/ledger/more")).toBe("plain");
    expect(sectionFor("/ledger/cards")).toBe("plain");
    expect(sectionFor("/stats")).toBe("plain");
    expect(sectionFor("/settingsx")).toBe("plain");
  });

  it("设置分类按身份给出，当前项取最长前缀", () => {
    const account = settingsItems({ guest: false, admin: false });
    expect(account.some((item) => item.id === "admin")).toBe(false);
    expect(settingsItems({ guest: false, admin: true }).some((item) => item.id === "admin")).toBe(true);
    expect(settingsItems({ guest: true, admin: true }).map((item) => item.id)).toEqual(["guestHome", "language"]);
    expect(activeSettingsItem(account, "/settings/appearance/theme")).toBe("appearance");
    expect(activeSettingsItem(account, "/settings/password")).toBe("security");
    expect(activeSettingsItem(account, "/legal/privacy")).toBe("about");
    expect(activeSettingsItem(account, "/stats")).toBeNull();
  });

  it("协作分页按地址标出当前页", () => {
    expect(activeCollabTab("/ledger")).toBe("overview");
    expect(activeCollabTab("/ledger/members/u1")).toBe("members");
    expect(activeCollabTab("/ledger/history")).toBe("history");
  });
});
