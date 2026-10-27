/**
 * W5 完整筛选：维度筛选的权威语义（S-01 v2 `ResolvedFilters`）与现有工作台接线。
 *
 * 这些测试只覆盖**能单独确定的行为**：地址栏往返、去重/上限、`null` 与 `[]` 的区别、
 * 分类/支付方式/标签的匹配语义、结果元数据如实回写，以及筛选面板确实渲染出对应控件。
 * 「顶部筛选是否真的影响了所有卡片」由 `cards.test.tsx`/`fxCards.test.tsx` 与真实浏览器验收覆盖。
 */
import type { Transaction } from "@libellum/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { applyLocale } from "../i18n/index.js";
import { agentAResult } from "./compute.js";
import { FilterPanel } from "./FilterPanel.js";
import {
  filterIds,
  filterKey,
  filterWorkbenchEntries,
  hasDimensionFilters,
  matchesWorkbenchFilters,
  readFilters,
  sameFilters,
  toggleFilterId,
  writeFilters,
  type WorkbenchFilters,
} from "./filters.js";
import { timeResultBridge } from "./results.js";
import type { WorkbenchScope } from "./scope.js";
import type { ResolvedFilters } from "@libellum/shared/workbench/envelope";

const defaults = readFilters(new URLSearchParams());
const range = { from: "2026-10-01", to: "2026-10-27" };

function tx(overrides: Partial<Transaction> & { readonly id: string }): Transaction {
  return {
    kind: "expense",
    amountCents: 100,
    currency: "CNY",
    categoryId: "c1",
    categoryName: "餐饮",
    categoryIsSystem: false,
    paymentMethodId: "p1",
    paymentMethodName: "支付宝",
    occurredAt: "2026-10-20T12:00:00Z",
    occurredLocalDate: "2026-10-20",
    occurredTz: "Asia/Shanghai",
    note: null,
    tags: [],
    version: 1,
    ...overrides,
  } as Transaction;
}

const withFilters = (overrides: Partial<WorkbenchFilters>): WorkbenchFilters => ({ ...defaults, ...overrides });

function panel(draft: WorkbenchFilters): string {
  return renderToStaticMarkup(
    <FilterPanel
      id="filters"
      draft={draft}
      effective={defaults}
      today="2026-10-27"
      fxAvailable
      fxTarget="CNY"
      defaultCurrency="CNY"
      currenciesInLedger={["USD"]}
      categories={[{ id: "c1", name: "餐饮" }, { id: "c2", name: "交通" }]}
      paymentMethods={[{ id: "p1", name: "支付宝" }]}
      tags={[{ id: "t1", name: "出差", color: "#112233" }]}
      onDraft={() => {}}
      onApply={() => {}}
      onRevert={() => {}}
      onCollapse={() => {}}
    />,
  );
}

afterEach(() => applyLocale("zh-CN"));

describe("维度筛选的地址栏契约（S-01 v2 / G-12a）", () => {
  it("读出分类/支付方式/标签，按首次出现去重，缺失参数表示不限", () => {
    const params = new URLSearchParams("category=a&category=b&category=a&payment=p&tag=t1&tag=t2");
    const filters = readFilters(params);
    expect(filters.categoryIds).toEqual(["a", "b"]);
    expect(filters.paymentMethodIds).toEqual(["p"]);
    expect(filters.tagIds).toEqual(["t1", "t2"]);
    const none = readFilters(new URLSearchParams());
    expect(filterIds(none)).toEqual({ categoryIds: null, paymentMethodIds: null, tagIds: null });
    expect(hasDimensionFilters(none)).toBe(false);
  });

  it("显式空参数表示空集（不是不限），`null` 与 `[]` 不相等", () => {
    const empty = readFilters(new URLSearchParams("category="));
    expect(empty.categoryIds).toEqual([]);
    expect(filterIds(empty).categoryIds).toEqual([]);
    expect(sameFilters(empty, defaults)).toBe(false);
    expect(sameFilters(withFilters({ categoryIds: [] }), withFilters({ categoryIds: null }))).toBe(false);
    expect(filterIds(withFilters({ categoryIds: ["c1"] })).categoryIds).toEqual(["c1"]);
  });

  it("数组去重后上限 50（G-12a），超出的参数被截断且不报错", () => {
    const many = Array.from({ length: 60 }, (_, index) => `c${index}`);
    const params = new URLSearchParams();
    for (const id of many) params.append("category", id);
    expect(readFilters(params).categoryIds).toHaveLength(50);
    expect(filterIds(withFilters({ tagIds: [...many, ...many] })).tagIds).toHaveLength(50);
  });

  it("写回地址栏保留其它参数，并清掉旧维度参数；空集往返后仍是空集", () => {
    const previous = new URLSearchParams("keep=1&category=old&payment=old&tag=old");
    const next = writeFilters(previous, withFilters({ categoryIds: ["a", "b"], paymentMethodIds: null, tagIds: [] }));
    expect(next.get("keep")).toBe("1");
    expect(next.getAll("category")).toEqual(["a", "b"]);
    expect(next.has("payment")).toBe(false);
    expect(next.getAll("tag")).toEqual([""]);
    const roundTrip = readFilters(next);
    expect(roundTrip.tagIds).toEqual([]);
    expect(roundTrip.paymentMethodIds).toBeNull();
  });

  it("多选 chip 语义：不限→单选、取消、追加，最多 50", () => {
    expect(toggleFilterId(null, "c1")).toEqual(["c1"]);
    expect(toggleFilterId(["c1"], "c2")).toEqual(["c1", "c2"]);
    expect(toggleFilterId(["c1", "c2"], "c1")).toEqual(["c2"]);
    const many = Array.from({ length: 50 }, (_, index) => `c${index}`);
    expect(toggleFilterId(many, "c50")).toHaveLength(50);
  });
});

describe("维度筛选的匹配语义（维间 AND、维内 IN、标签任一命中）", () => {
  const food = tx({ id: "food", categoryId: "c1", paymentMethodId: "p1", tags: [{ id: "t1", name: "出差", color: "#112233" }] });
  const taxi = tx({ id: "taxi", categoryId: "c2", paymentMethodId: null, tags: [] });
  const entries = [food, taxi];

  it("不限（null）保留全部；空集（[]）一个都不保留", () => {
    expect(matchesWorkbenchFilters(food, defaults)).toBe(true);
    expect(filterWorkbenchEntries(entries, defaults)).toBe(entries);
    const empty = withFilters({ categoryIds: [] });
    expect(matchesWorkbenchFilters(food, empty)).toBe(false);
    expect(filterWorkbenchEntries(entries, empty)).toHaveLength(0);
  });

  it("分类多选是「属于所选集」；不同维度同时生效是 AND", () => {
    expect(filterWorkbenchEntries(entries, withFilters({ categoryIds: ["c2"] }))).toEqual([taxi]);
    expect(filterWorkbenchEntries(entries, withFilters({ categoryIds: ["c1", "c2"] }))).toEqual(entries);
    expect(filterWorkbenchEntries(entries, withFilters({ categoryIds: ["c1"], paymentMethodIds: ["p1"] }))).toEqual([food]);
    expect(matchesWorkbenchFilters(taxi, withFilters({ paymentMethodIds: ["p1"] }))).toBe(false);
  });

  it("标签是任一命中，且不因多标签重复计算", () => {
    const both = tx({ id: "both", tags: [{ id: "t1", name: "出差", color: "#112233" }, { id: "t2", name: "报销", color: "#445566" }] });
    expect(matchesWorkbenchFilters(both, withFilters({ tagIds: ["t2"] }))).toBe(true);
    expect(matchesWorkbenchFilters(both, withFilters({ tagIds: ["t1", "t2"] }))).toBe(true);
    const kept = filterWorkbenchEntries([both, food, taxi], withFilters({ tagIds: ["t1"] }));
    expect(kept.map((entry) => entry.id)).toEqual(["both", "food"]);
  });

  it("筛选键随维度变化（用于综合折算缓存与重算）", () => {
    expect(filterKey(withFilters({ categoryIds: ["c1"] }))).not.toBe(filterKey(defaults));
    expect(filterKey(withFilters({ tagIds: [] }))).not.toBe(filterKey(withFilters({ tagIds: null })));
  });
});

describe("结果元数据如实回写生效筛选", () => {
  it("B 桶结果声明的 resolvedFilters 与 source.filters 都是真实条件", () => {
    const filters = withFilters({ categoryIds: ["c1"], paymentMethodIds: null, tagIds: [] });
    const scope = {
      today: "2026-10-27",
      filters,
      range,
      bucket: "day",
      combined: false,
      fxAvailable: true,
      currency: "CNY",
      defaultCurrency: "CNY",
      entries: [],
      loaded: true,
      fx: null,
      coverageGap: null,
      repairing: false,
      accountScope: "user:a",
    } as unknown as WorkbenchScope;
    const bridge = timeResultBridge("AN-I06", {}, { complete: true }, scope, range, { metric: "expense", kind: "expense", groupBy: "day" });
    expect(bridge.metadata.resolvedFilters).toEqual({ kind: "expense", categoryIds: ["c1"], paymentMethodIds: null, tagIds: [], currency: "CNY" });
    expect(bridge.metadata.source.filters).toEqual(bridge.metadata.resolvedFilters);
  });
});

describe("A 层结果信封如实声明生效筛选（与前置过滤幂等）", () => {
  const entries = [
    tx({ id: "a", categoryId: "c1", amountCents: 1_000 }),
    tx({ id: "b", categoryId: "c2", amountCents: 3_000 }),
  ];
  const filters: ResolvedFilters = { kind: "expense", categoryIds: ["c1"], paymentMethodIds: null, tagIds: null, currency: "CNY" };

  it("resolvedFilters 回写真实条件，且前置过滤与 A 内部再过滤不会改变数字", () => {
    const prefiltered = filterWorkbenchEntries(entries, withFilters({ categoryIds: ["c1"] }));
    const fromAll = agentAResult(entries, "AN-B01", range, "CNY", "2026-10-27", "complete", undefined, false, filters);
    const fromPrefiltered = agentAResult(prefiltered, "AN-B01", range, "CNY", "2026-10-27", "complete", undefined, false, filters);
    expect(fromAll.resolvedFilters).toEqual(filters);
    expect(fromPrefiltered.resolvedFilters).toEqual(filters);
    expect(fromAll.shape).toBe("scalar");
    if (fromAll.shape !== "scalar" || fromPrefiltered.shape !== "scalar") throw new Error("expected scalar");
    expect(fromAll.value).toEqual(fromPrefiltered.value);
  });

  it("不传维度筛选时保持旧行为（三维不限），供旧调用点与测试使用", () => {
    const result = agentAResult(entries, "AN-B01", range, "CNY", "2026-10-27");
    expect(result.resolvedFilters.categoryIds).toBeNull();
    expect(result.resolvedFilters.paymentMethodIds).toBeNull();
    expect(result.resolvedFilters.tagIds).toBeNull();
  });
});

describe("筛选面板渲染三组维度控件（复用现有 chips，不新造 UI）", () => {
  it("分类/支付方式/标签各有一组，含「全部」与选项，选中态可读", () => {
    applyLocale("zh-CN");
    const html = panel(withFilters({ categoryIds: ["c1"], tagIds: ["t1"] }));
    expect(html).toContain('data-filter-dimension="categoryIds"');
    expect(html).toContain('data-filter-dimension="paymentMethodIds"');
    expect(html).toContain('data-filter-dimension="tagIds"');
    expect(html).toContain("餐饮");
    expect(html).toContain("支付宝");
    expect(html).toContain("出差");
    expect(html).toContain("全部");
    expect(html).toMatch(/aria-pressed="true" class="sw-chip sw-chip-on">餐饮/);
    expect(html).toContain('sw-chip-on"><span aria-hidden="true"');
    expect(html).toContain(">出差<");
    expect(html).toMatch(/aria-pressed="false" class="sw-chip ">交通/);
  });

  it("某个维度选了空集时明确提示「不会显示任何账目」", () => {
    applyLocale("zh-CN");
    const html = panel(withFilters({ categoryIds: [] }));
    expect(html).toContain("没有选择任何项");
  });

  it("账本没有标签时不渲染标签组（避免空控件），英文文案跟随语言", () => {
    applyLocale("zh-CN");
    const noTags = renderToStaticMarkup(
      <FilterPanel
        id="filters" draft={defaults} effective={defaults} today="2026-10-27" fxAvailable fxTarget="CNY" defaultCurrency="CNY"
        currenciesInLedger={[]} categories={[{ id: "c1", name: "餐饮" }]} paymentMethods={[]} tags={[]}
        onDraft={() => {}} onApply={() => {}} onRevert={() => {}} onCollapse={() => {}}
      />,
    );
    expect(noTags).toContain('data-filter-dimension="categoryIds"');
    expect(noTags).not.toContain('data-filter-dimension="tagIds"');
    applyLocale("en-US");
    expect(panel(defaults)).toContain("Categories");
  });
});
