import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Transaction } from "@libellum/shared";
import { getAnalysisCatalogEntry } from "@libellum/shared/analysis/catalog";
import { validateContentDocumentV1, validateLayoutDocumentV1, type AnalysisCardNode } from "@libellum/shared/analysis/layout";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import zh from "../i18n/resources/zh-CN/statsWorkbench.js";
import en from "../i18n/resources/en-US/statsWorkbench.js";
import { CARD_TYPES, cardType } from "./catalog.js";
import { agentAResult, entriesInCurrency, statsFor, liveEntries } from "./compute.js";
import { defaultWorkbench, legacyDefaultWorkbench, newCard } from "./defaults.js";
import { customRangeProblem, followDraft, readFilters, resolveRange, sameFilters, writeFilters } from "./filters.js";
import {
  command,
  containerOf,
  duplicateObject,
  insertContainer,
  isDirty,
  placementProblem,
  removeObject,
  replaceContainerChildren,
  sessionDocuments,
  startSession,
  updateCard,
} from "./session.js";
import { documentsProblems, followSystemDefault, isSystemDefault, loadWorkbench, readStored, retireLegacyDefault, saveWorkbench, workbenchStorageKey } from "./storage.js";
import { reidentify } from "./presets.js";
import { customCardsIn } from "./customCards.js";

let nextId = 1;
function entry(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: `t-${String(nextId++).padStart(4, "0")}`,
    kind: "expense",
    amountCents: 1_000,
    currency: "CNY",
    categoryId: "c-food",
    categoryName: "餐饮",
    categoryIsSystem: false,
    paymentMethodId: null,
    paymentMethodName: null,
    occurredAt: "2026-10-02T04:00:00.000Z",
    occurredLocalDate: "2026-10-02",
    occurredTz: "Asia/Shanghai",
    note: null,
    tags: [],
    version: 1,
    ...overrides,
  };
}

describe("筛选：地址栏是生效条件的唯一出处", () => {
  it("缺省是近 30 天、跟随默认币种、开启折算时默认综合，且三个维度筛选均不限（与 1.16.23 一致）", () => {
    const filters = readFilters(new URLSearchParams(""));
    expect(filters).toEqual({
      time: { kind: "preset", preset: "30d" },
      currency: null,
      combined: true,
      categoryIds: null,
      paymentMethodIds: null,
      tagIds: null,
    });
  });

  it("旧分析页的参数（range / month / currency / analysis）继续有效", () => {
    const filters = readFilters(new URLSearchParams("range=90d&currency=USD&analysis=currency"));
    expect(filters.time).toEqual({ kind: "preset", preset: "90d" });
    expect(filters.currency).toBe("USD");
    expect(filters.combined).toBe(false);
    expect(readFilters(new URLSearchParams("month=2026-08")).time).toEqual({ kind: "month", month: "2026-08" });
  });

  it("写回再读出得到同一份条件，并保留无关参数", () => {
    const filters = { time: { kind: "custom" as const, from: "2026-01-05", to: "2026-03-01" }, currency: "HKD" as const, combined: false };
    const params = writeFilters(new URLSearchParams("keep=1"), filters);
    expect(params.get("keep")).toBe("1");
    expect(sameFilters(readFilters(params), filters)).toBe(true);
  });

  it("不合法的自定义区间被拒绝，而不是截断", () => {
    expect(customRangeProblem("2026-03-01", "2026-01-01")).toBe("order");
    expect(customRangeProblem("2026-02-30", "2026-03-01")).toBe("invalid");
    expect(customRangeProblem("2024-01-01", "2026-01-01")).toBe("too-long");
    expect(readFilters(new URLSearchParams("range=custom&from=2026-03-01&to=2026-01-01")).time).toEqual({ kind: "preset", preset: "30d" });
  });

  it("生效条件被外部改变时：没改过的草稿跟着走，改过的草稿保留", () => {
    const before = readFilters(new URLSearchParams(""));
    const after = readFilters(new URLSearchParams("analysis=currency"));
    expect(followDraft(before, before, after)).toBe(after);
    const edited = { ...before, time: { kind: "preset" as const, preset: "90d" as const } };
    expect(followDraft(edited, before, after)).toBe(edited);
  });

  it("本月 / 指定月份按日历月计算（含闰年二月）", () => {
    expect(resolveRange({ kind: "this-month" }, "2026-10-27")).toEqual({ from: "2026-10-01", to: "2026-10-27" });
    expect(resolveRange({ kind: "month", month: "2028-02" }, "2028-05-01")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
});

describe("计算：只组合既有实现，原币绝不跨币种相加", () => {
  const range = { from: "2026-10-01", to: "2026-10-31" };
  const entries = [
    entry({ amountCents: 1_000 }),
    entry({ amountCents: 2_500, currency: "USD" }),
    entry({ amountCents: 300, occurredLocalDate: "2026-10-05" }),
    entry({ amountCents: 9_999, deletedAt: "2026-10-06T00:00:00.000Z" }),
    entry({ kind: "income", amountCents: 50_000, categoryId: "c-salary", categoryName: "工资" }),
  ];
  const live = liveEntries(entries);

  it("软删除的账目不进统计", () => {
    expect(live).toHaveLength(4);
  });

  it("混有其它币种时，Agent A 的总支出只算所选币种（A 自己会拒绝混币输入）", () => {
    const cny = agentAResult(live, "AN-B01", range, "CNY", "2026-10-27");
    const usd = agentAResult(live, "AN-B01", range, "USD", "2026-10-27");
    expect(cny.shape === "scalar" && cny.value?.kind === "money" ? cny.value.money.amountMinor : null).toBe("1300");
    expect(usd.shape === "scalar" && usd.value?.kind === "money" ? usd.value.money.amountMinor : null).toBe("2500");
  });

  it("同一条件只算一次：两张卡拿到同一个结果对象（ACC-02）", () => {
    expect(agentAResult(live, "AN-B03", range, "CNY", "2026-10-27")).toBe(agentAResult(live, "AN-B03", range, "CNY", "2026-10-27"));
    expect(statsFor(live, range, "CNY", "day")).toBe(statsFor(live, range, "CNY", "day"));
  });

  it("与旧分析页同一实现：computeStats 的合计和 A 的结果一致", () => {
    const stats = statsFor(live, range, "CNY", "day");
    const net = agentAResult(live, "AN-B03", range, "CNY", "2026-10-27");
    expect(stats.totals.expenseMinor).toBe(1300);
    expect(net.shape === "scalar" && net.value?.kind === "money" ? net.value.money.amountMinor : null).toBe(String(50_000 - 1300));
    expect(entriesInCurrency(live, "USD")).toHaveLength(1);
  });

  it("没有记录时给出「没有交易」状态，而不是伪装成完整结果", () => {
    const empty = agentAResult(liveEntries([]), "AN-B09", range, "CNY", "2026-10-27");
    expect(empty.completeness).toBe("no-transactions");
  });
});

describe("卡片目录", () => {
  it("每张卡片都有中英文名称与说明", () => {
    for (const type of CARD_TYPES) {
      const id = type.id as keyof typeof zh.cards;
      expect(zh.cards[id], type.id).toBeDefined();
      expect(en.cards[id], type.id).toBeDefined();
    }
    expect(Object.keys(zh.cards).sort()).toEqual(CARD_TYPES.map((type) => type.id).sort());
  });

  it("Agent A 的编号都能在 A 的目录里找到（没有自造编号）", () => {
    for (const type of CARD_TYPES.filter((item) => item.source === "agent-a")) {
      expect(getAnalysisCatalogEntry(type.id), type.id).not.toBeNull();
    }
  });

  it("未知编号返回 null（来自新版本的卡片按只读占位处理）", () => {
    expect(cardType("AN-Z99")).toBeNull();
  });
});

describe("默认工作台与编辑会话（D 的命令 + 过渡适配）", () => {
  it("默认工作台（新手布局）与旧版「日常总览」都通过 D 的校验", () => {
    for (const docs of [defaultWorkbench(), legacyDefaultWorkbench()]) {
      expect(validateContentDocumentV1(docs.content).ok).toBe(true);
      expect(validateLayoutDocumentV1(docs.layout).ok).toBe(true);
      expect(documentsProblems(docs)).toEqual([]);
    }
  });

  it("系统默认是新手预设：第一张是「支出分类」（整行 2×2，环形图，本月至今），手机与宽屏同一顺序", () => {
    const docs = defaultWorkbench();
    const first = [...docs.layout.main.objects].sort((a, b) => a.anchor - b.anchor)[0]!;
    expect(first).toMatchObject({ objectId: "preset-beginner-where", anchor: 1, colSpan: 2, rowSpan: 2 });
    // 内容文档里也排第一（详情页、读屏顺序与布局一致）。
    expect(docs.content.cards[0]!.objectId).toBe("preset-beginner-where");
    const card = docs.content.cards[0]!;
    expect(card.analysis.analysisId).toBe("AN-I01");
    expect(card.chart.chartFamily).toBe("donut");
    // 标题用分析自身的名称（随界面语言变化），不写死模块名。
    expect(card.title).toEqual({ kind: "preset" });
    expect(card.chart.options?.["window"]).toBe("month-to-date");
  });

  it("移动到已占用的位置失败且状态不变；合法位置成功并可撤销", () => {
    const start = startSession(legacyDefaultWorkbench());
    const bad = command(start, { type: "move", objectId: "default-b06", anchor: 1 });
    expect(bad.ok).toBe(false);
    expect(bad.state).toBe(start);
    const free = 40;
    expect(placementProblem(start.layout, "default-b06", free, { colSpan: 1, rowSpan: 1 })).toBeNull();
    const moved = command(start, { type: "move", objectId: "default-b06", anchor: free });
    expect(moved.ok).toBe(true);
    expect(isDirty(moved.state, legacyDefaultWorkbench())).toBe(true);
    const undone = command(moved.state, { type: "undo" });
    expect(undone.state.layout).toBe(start.layout);
  });

  it("空容器不能直接写入（D 要求 2 张起）；凑够张数后一次插入，整组删除、整组撤销", () => {
    const start = startSession(legacyDefaultWorkbench());
    const empty = insertContainer(start, { objectId: "box-x", type: "carousel", children: [] }, [], 40, { colSpan: 2, rowSpan: 1 });
    expect(empty.ok).toBe(false);
    const a = newCard("AN-B01", "card-a");
    const b = newCard("AN-B02", "card-b");
    const added = insertContainer(start, { objectId: "box-x", type: "carousel", children: ["card-a", "card-b"] }, [a, b], 41, { colSpan: 2, rowSpan: 1 });
    expect(added.ok).toBe(true);
    const removed = removeObject(added.state, "box-x");
    expect(removed.ok).toBe(true);
    expect(removed.state.content.cards.some((card) => card.objectId === "card-a")).toBe(false);
    const restored = command(removed.state, { type: "undo" });
    expect(containerOf(restored.state, "box-x")?.children).toEqual(["card-a", "card-b"]);
  });

  it("容器内部编辑一次提交：新增、排序、移出；少于 2 张被拒绝", () => {
    const start = startSession(legacyDefaultWorkbench());
    const current = containerOf(start, "default-extremes");
    expect(current?.children).toHaveLength(3);
    const cards = start.content.cards.filter((card) => current?.children.includes(card.objectId));
    const extra = newCard("AN-I03", "card-extra");
    const next = replaceContainerChildren(start, "default-extremes", [extra, cards[2] as AnalysisCardNode, cards[0] as AnalysisCardNode]);
    expect(next.ok).toBe(true);
    expect(containerOf(next.state, "default-extremes")?.children).toEqual(["card-extra", "default-b15", "default-b09"]);
    // 移出的卡片连同配置一起删除，不留孤儿
    expect(next.state.content.cards.some((card) => card.objectId === "default-b11")).toBe(false);
    const tooFew = replaceContainerChildren(start, "default-extremes", [cards[0] as AnalysisCardNode]);
    expect(tooFew.ok).toBe(false);
  });

  it("复制容器是整组深复制：新容器、新子卡片 ID，配置独立", () => {
    const start = startSession(legacyDefaultWorkbench());
    const copy = duplicateObject(start, "default-extremes");
    expect(copy.ok).toBe(true);
    const copied = copy.state.content.containers.find((item) => item.objectId !== "default-extremes");
    expect(copied).toBeDefined();
    expect(copied?.children).toHaveLength(3);
    for (const id of copied?.children ?? []) expect(id.startsWith("default-")).toBe(false);
  });

  it("配置只改卡片定义，不改几何；固定区间被如实保存", () => {
    const start = startSession(legacyDefaultWorkbench());
    const card = start.content.cards.find((item) => item.objectId === "default-b01") as AnalysisCardNode;
    const next = updateCard(start, { ...card, title: { kind: "custom", text: "本月开销" }, rangePolicy: "pinned", pinnedRange: { from: "2026-10-01", to: "2026-10-31" } });
    expect(next.ok).toBe(true);
    expect(next.state.layout).toBe(start.layout);
    expect(sessionDocuments(next.state).content.cards.find((item) => item.objectId === "default-b01")?.pinnedRange).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });
});

describe("本机保存：按账号隔离、读不出时不覆盖", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    };
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("保存后同一账号读回同一份文档，另一账号仍是默认工作台", () => {
    const docs = legacyDefaultWorkbench();
    const moved = command(startSession(docs), { type: "move", objectId: "default-b06", anchor: 40 });
    const version = saveWorkbench("user:a", sessionDocuments(moved.state), 0);
    expect(version).toBe(1);
    const loaded = loadWorkbench("user:a");
    expect(loaded.status).toBe("ok");
    expect(readStored("user:b").documents.layout).toEqual(defaultWorkbench().layout);
  });

  it("本机保存的仍是旧版「日常总览」：备份后移除，显示新手布局；之后照常保存；重复读取不再动作", () => {
    expect(saveWorkbench("user:a", legacyDefaultWorkbench(), 0)).toBe(1);
    const raw = store.get(workbenchStorageKey("user:a"));
    const stored = readStored("user:a");
    expect(stored.documents).toEqual(defaultWorkbench());
    expect(stored.version).toBe(0);
    expect(stored.unreadable).toBe(false);
    expect(store.has(workbenchStorageKey("user:a"))).toBe(false);
    expect(store.get(`${workbenchStorageKey("user:a")}:legacy-default`)).toBe(raw);
    expect(retireLegacyDefault("user:a")).toBe(false);
    // 迁移后用户再编辑保存：版本从 0 起，不被旧记录挡住。
    const moved = command(startSession(stored.documents), { type: "move", objectId: "preset-beginner-rise", anchor: 40 });
    expect(moved.ok).toBe(true);
    expect(saveWorkbench("user:a", sessionDocuments(moved.state), stored.version)).toBe(1);
    expect(readStored("user:a").documents).toEqual(sessionDocuments(moved.state));
  });

  it("「恢复默认」后保存：不存副本，删掉自己的记录跟随系统默认；版本被别处改过时不动", () => {
    const moved = command(startSession(defaultWorkbench()), { type: "move", objectId: "preset-beginner-rise", anchor: 40 });
    expect(saveWorkbench("user:a", sessionDocuments(moved.state), 0)).toBe(1);
    const raw = store.get(workbenchStorageKey("user:a"));
    expect(isSystemDefault(defaultWorkbench())).toBe(true);
    expect(isSystemDefault(sessionDocuments(moved.state))).toBe(false);
    // 应用「新手」系统预设得到的是换了新 ID 的副本，是用户自己的选择，不当作系统默认。
    expect(isSystemDefault(reidentify(defaultWorkbench()))).toBe(false);
    expect(followSystemDefault("user:a", 0)).toBeNull();
    expect(store.get(workbenchStorageKey("user:a"))).toBe(raw);
    expect(followSystemDefault("user:a", 1)).toBe(0);
    expect(store.has(workbenchStorageKey("user:a"))).toBe(false);
    expect(store.get(`${workbenchStorageKey("user:a")}:previous`)).toBe(raw);
    expect(readStored("user:a")).toMatchObject({ version: 0, unreadable: false });
    expect(readStored("user:a").documents).toEqual(defaultWorkbench());
  });

  it("系统默认里的卡片不出现在「我的自定义」里；复制出来的卡片照常算", () => {
    const docs = defaultWorkbench();
    expect(customCardsIn(docs.content.cards)).toEqual([]);
    const copy = { ...docs.content.cards[1]!, objectId: "card-copy" };
    expect(customCardsIn([...docs.content.cards, copy])).toEqual([copy]);
  });

  it("与旧版默认只差一处的布局（用户改过）原样保留", () => {
    const moved = command(startSession(legacyDefaultWorkbench()), { type: "move", objectId: "default-b06", anchor: 40 });
    expect(saveWorkbench("user:a", sessionDocuments(moved.state), 0)).toBe(1);
    const raw = store.get(workbenchStorageKey("user:a"));
    expect(retireLegacyDefault("user:a")).toBe(false);
    expect(readStored("user:a").documents).toEqual(sessionDocuments(moved.state));
    expect(store.get(workbenchStorageKey("user:a"))).toBe(raw);
    expect(store.has(`${workbenchStorageKey("user:a")}:legacy-default`)).toBe(false);
  });

  it("记录里没有任何金额或交易 ID", () => {
    saveWorkbench("user:a", legacyDefaultWorkbench(), 0);
    const raw = store.get(workbenchStorageKey("user:a")) ?? "";
    expect(raw).not.toMatch(/amount|Minor|transaction/i);
  });

  it("损坏的记录：显示默认工作台并标记，原记录保持不动", () => {
    store.set(workbenchStorageKey("user:a"), "{not json");
    const stored = readStored("user:a");
    expect(stored.unreadable).toBe(true);
    expect(store.get(workbenchStorageKey("user:a"))).toBe("{not json");
  });

  it("不合法的文档拒绝保存", () => {
    const docs = legacyDefaultWorkbench();
    const broken = { ...docs, content: { ...docs.content, containers: [{ objectId: "x", type: "carousel" as const, children: [] }] } };
    expect(saveWorkbench("user:a", broken, 0)).toBeNull();
  });
});

describe("数据边界（总需求规格 §3.2 静态守卫）", () => {
  it("工作台目录不引用任何交易 / 账本写接口", () => {
    const directory = fileURLToPath(new URL(".", import.meta.url));
    const forbidden = /\b(createTransaction|updateTransaction|deleteTransaction|useCreate|useUpdate|useDelete|enqueueWrite|writeEntry|upsertEntry|apiFetch\([^)]*method)/;
    for (const name of readdirSync(directory).filter((file) => /\.(ts|tsx)$/.test(file) && !file.endsWith(".test.ts"))) {
      const source = readFileSync(`${directory}${name}`, "utf8");
      expect(forbidden.test(source), name).toBe(false);
    }
  });
});
