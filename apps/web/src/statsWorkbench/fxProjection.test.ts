import { describe, expect, it } from "vitest";
import type { Transaction } from "@libellum/shared";

import { fxAgentAResult } from "./compute.js";
import { HAND_CONVERTED, MIXED_ENTRIES, RANGE, TODAY } from "./fxFixture.js";
import { FX_CARD_POLICIES } from "./fxPolicy.js";
import { projectFx, type FxProjection, type FxProjectionInput } from "./fxProjection.js";
import { buildFxView, tx } from "./fxTestSupport.js";
import { CARD_TYPES } from "./catalog.js";
import { C_CARD_IDS } from "./cCards.js";

function ready(input: FxProjectionInput): FxProjection {
  const state = projectFx(input);
  if (state.status !== "ready") throw new Error(`expected ready, got ${state.status}`);
  return state.projection;
}

function view(options: Parameters<typeof buildFxView>[0]): FxProjectionInput {
  return buildFxView(options) as unknown as FxProjectionInput;
}

describe("projectFx · 逐笔折算回连原账目", () => {
  it("每一笔的折算金额等于手算值（含半入、JPY 无小数位），币种统一为目标币种", () => {
    const projection = ready(view({ entries: MIXED_ENTRIES }));
    expect(projection.target).toBe("CNY");
    expect(projection.converted).toHaveLength(12);
    expect(projection.missing).toEqual([]);
    for (const row of projection.converted) {
      expect(row.currency).toBe("CNY");
      expect(row.amountCents, row.id).toBe(HAND_CONVERTED[row.id]);
    }
  });

  it("保留身份、日期、方向、分类、支付方式；原账目一个字节都不改", () => {
    const frozen = structuredClone(MIXED_ENTRIES);
    const projection = ready(view({ entries: MIXED_ENTRIES }));
    expect(MIXED_ENTRIES).toEqual(frozen);
    for (const row of projection.converted) {
      const source = MIXED_ENTRIES.find((candidate) => candidate.id === row.id)!;
      expect(row).toMatchObject({
        id: source.id,
        kind: source.kind,
        occurredLocalDate: source.occurredLocalDate,
        categoryId: source.categoryId,
        categoryName: source.categoryName,
        paymentMethodId: source.paymentMethodId,
        paymentMethodName: source.paymentMethodName,
        version: source.version,
      });
    }
  });

  it("同币种账目不二次折算（identity）：CNY 金额原样", () => {
    const projection = ready(view({ entries: MIXED_ENTRIES }));
    expect(projection.converted.find((row) => row.id === "e01")?.amountCents).toBe(10000);
    expect(projection.converted.find((row) => row.id === "e10")?.amountCents).toBe(30000);
  });

  it("目标币种换成 USD 时同样走逐笔折算（CNY 100.00 → 15.63 USD）", () => {
    // 10000 CNY 分 = 100.00 元 = 12.5 EUR... 手算：100 CNY ÷ 6.4 = 15.625 USD → 1563 分（半入）
    const projection = ready(view({ entries: [tx("x", { amountCents: 10000, currency: "CNY" })], target: "USD" }));
    expect(projection.converted[0]).toMatchObject({ currency: "USD", amountCents: 1563 });
  });

  it("缺汇率的账目进入 missing（带日期 / 币种 / 原因 / 方向），不进入 converted，也不是 0", () => {
    const projection = ready(view({ entries: MIXED_ENTRIES, missingDates: ["2026-10-02"] }));
    expect(projection.missing.map((row) => row.id).sort()).toEqual(["e02", "e03"]);
    expect(projection.missing.every((row) => row.date === "2026-10-02" && row.reason === "missing_rate" && row.kind === "expense")).toBe(true);
    expect(projection.converted.map((row) => row.id)).not.toContain("e02");
    expect(projection.converted).toHaveLength(10);
    expect(projection.all).toHaveLength(12);
    expect(projection.all.find((row) => row.id === "e02")?.amountCents).toBe(0); // 占位，仅计数类分析使用
  });

  it("缺汇率的影响按方向分开：缺支出不影响收入口径，反之亦然", () => {
    const expenseMissing = ready(view({ entries: MIXED_ENTRIES, missingDates: ["2026-10-02"] }));
    expect(expenseMissing.missingByScope.expense.count).toBe(2);
    expect(expenseMissing.missingByScope.income.count).toBe(0);
    expect(expenseMissing.missingByScope.both.count).toBe(2);
    expect(expenseMissing.missingByScope.none.count).toBe(0);
    expect([...expenseMissing.missingByScope.expense.dates]).toEqual(["2026-10-02"]);
    const incomeMissing = ready(view({ entries: MIXED_ENTRIES, missingDates: ["2026-10-05"] }));
    // 10-05 的缺汇率账目只有 e07（USD 收入）；e06 是 CNY 支出不需要汇率。
    expect(incomeMissing.missingByScope.income.count).toBe(1);
    expect(incomeMissing.missingByScope.expense.count).toBe(0);
    expect([...incomeMissing.missingByScope.income.dates]).toEqual(["2026-10-05"]);
  });
});

describe("projectFx · 不能证明就不算完整", () => {
  it("加载中、权限不足、读取失败各自是显式状态", () => {
    expect(projectFx(view({ entries: [], loading: true })).status).toBe("loading");
    expect(projectFx(view({ entries: [], error: { reason: "permission" } })).status).toBe("no-permission");
    expect(projectFx(view({ entries: [], error: { reason: "read" } }))).toEqual({ status: "request-failed", reason: "read" });
    expect(projectFx(view({ entries: [], error: { reason: "capacity" } }))).toEqual({ status: "request-failed", reason: "capacity" });
  });

  it("逐笔条数超过上限：显式 entry-limit，不截断、不取前 N 笔冒充完整", () => {
    const state = projectFx(view({ entries: MIXED_ENTRIES, maxEntries: 5 }));
    expect(state).toEqual({ status: "entry-limit", limit: 50_000 });
  });

  it("没有逐笔明细 / 守恒不成立 / 回连不上 / 金额不安全 都是 invalid，而不是少算", () => {
    const base = view({ entries: MIXED_ENTRIES });
    expect(projectFx({ ...base, detail: undefined })).toEqual({ status: "invalid", reason: "detail-missing" });
    expect(projectFx({ ...base, sourceEntries: base.sourceEntries?.slice(1) })).toEqual({ status: "invalid", reason: "conservation" });
    const orphan = { ...base, sourceEntries: base.sourceEntries?.map((row, index) => (index === 0 ? { ...row, id: "other" } : row)) };
    expect(projectFx(orphan).status).toBe("invalid");
    const detail = base.detail!;
    const unsafe = { ...base, detail: { ...detail, entries: detail.entries!.map((row, index) => (index === 0 ? { ...row, targetMinor: String(Number.MAX_SAFE_INTEGER) + "0" } : row)) } };
    expect(projectFx(unsafe)).toEqual({ status: "invalid", reason: "amount-unsafe" });
    const mismatch = { ...base, detail: { ...detail, entries: detail.entries!.map((row, index) => (index === 0 ? { ...row, date: "2026-01-01" } : row)) } };
    expect(projectFx(mismatch).status).toBe("invalid");
    expect(projectFx({ ...base, target: "ZZZ" })).toEqual({ status: "invalid", reason: "currency" });
  });
});

describe("fxAgentAResult · 统一适配层交给已验收的 A 装配函数", () => {
  const projection = ready(view({ entries: MIXED_ENTRIES }));

  it("A 的合计与 S16-D 聚合逐位一致（没有第二套公式）", () => {
    const expense = fxAgentAResult(projection, "AN-B01", RANGE, TODAY, "complete").result;
    const income = fxAgentAResult(projection, "AN-B02", RANGE, TODAY, "complete").result;
    const net = fxAgentAResult(projection, "AN-B03", RANGE, TODAY, "complete").result;
    for (const [result, key] of [[expense, "expenseMinor"], [income, "incomeMinor"], [net, "netMinor"]] as const) {
      expect(result.shape).toBe("scalar");
      if (result.shape !== "scalar" || result.value?.kind !== "money") throw new Error("money scalar expected");
      expect(result.value.money.amountMinor).toBe(projection.aggregate.totals[key]);
    }
    // 手算：支出 383199、收入 644000、净 260801
    expect(projection.aggregate.totals).toMatchObject({ expenseMinor: "383199", incomeMinor: "644000", netMinor: "260801" });
  });

  it("构成卡片的分项与 S16-D 分类聚合逐位一致", () => {
    for (const id of ["AN-I01", "AN-I02"] as const) {
      const result = fxAgentAResult(projection, id, RANGE, TODAY, "complete").result;
      if (result.shape !== "composition") throw new Error("composition expected");
      const field = id === "AN-I01" ? "expenseMinor" : "incomeMinor";
      for (const part of result.parts) {
        expect(part.amount.amountMinor, part.id).toBe(projection.aggregate.categories[part.id]?.[field]);
      }
      expect(result.total?.amountMinor).toBe(projection.aggregate.totals[field]);
      expect(result.completeness).toBe("complete");
    }
  });

  it("信封写 aggregate 币种与折算策略，来源币种不冒充原币", () => {
    const result = fxAgentAResult(projection, "AN-B01", RANGE, TODAY, "complete").result;
    expect(result.resolvedCurrency).toEqual({ mode: "aggregate", targetCurrency: "CNY" });
    expect(result.computation).toMatchObject({ convertedWithFx: true, fxPolicy: "minor-half-away-v1" });
  });
});

describe("计数类分析与金额无关：缺汇率账目照常计数（不被排除，也不依赖占位金额）", () => {
  const COUNT_IDS = Object.entries(FX_CARD_POLICIES)
    .filter(([, policy]) => policy.class === "count")
    .map(([id]) => id)
    .filter((id) => id !== "AN-I19")
    // S17-C 的计数类（A15 连续无支出、P16 币种笔数、P18–P20 汇率诊断）不走 Agent A 入口，由 `cCards.test.tsx` 覆盖。
    .filter((id) => !C_CARD_IDS.has(id));

  it("计数类卡片集合与目录一致", () => {
    expect(COUNT_IDS.sort()).toEqual(["AN-B04", "AN-B05", "AN-B13", "AN-B14", "AN-B16", "AN-B20", "AN-I05"]);
  });

  it("全部账目都缺汇率时，笔数 / 天数 / 分类数 / 最多记录日 / 分类频次与全部折算成功时完全相同", () => {
    const complete = ready(view({ entries: MIXED_ENTRIES }));
    const noRates = ready(view({ entries: MIXED_ENTRIES, missingCurrencies: ["USD", "HKD", "JPY"] }));
    expect(noRates.missing).toHaveLength(8);
    for (const id of COUNT_IDS) {
      const full = fxAgentAResult(complete, id as never, RANGE, TODAY, "complete").result;
      const partial = fxAgentAResult(noRates, id as never, RANGE, TODAY, "complete").result;
      expect(partial, id).toEqual(full);
      expect(partial.completeness, id).toBe("complete");
    }
  });

  it("把未折算账目的占位金额改写成任意值，结果不变（金额无关性守护）", () => {
    const noRates = ready(view({ entries: MIXED_ENTRIES, missingCurrencies: ["USD", "HKD", "JPY"] }));
    const tampered: FxProjection = {
      ...noRates,
      all: noRates.all.map((row: Transaction, index) => (noRates.missing.some((m) => m.id === row.id) ? { ...row, amountCents: 7_777_777 + index } : row)),
    };
    for (const id of COUNT_IDS) {
      const base = fxAgentAResult(noRates, id as never, RANGE, TODAY, "complete").result;
      const changed = fxAgentAResult(tampered, id as never, RANGE, TODAY, "complete").result;
      expect(changed, id).toEqual(base);
    }
  });

  it("手算：9 笔支出 / 3 笔收入 / 7 个有支出天 / 20 个无支出天 / 4 个分类 / 最多记录日 10-02 并列 5 天", () => {
    const projection = ready(view({ entries: MIXED_ENTRIES, missingCurrencies: ["USD", "HKD", "JPY"] }));
    const value = (id: string) => {
      const result = fxAgentAResult(projection, id as never, RANGE, TODAY, "complete").result;
      if (result.shape !== "scalar" || result.value === null) throw new Error("scalar expected");
      return result.value;
    };
    expect(value("AN-B04")).toEqual({ kind: "count", count: 9 });
    expect(value("AN-B05")).toEqual({ kind: "count", count: 3 });
    expect(value("AN-B13")).toEqual({ kind: "days", days: 7 });
    expect(value("AN-B14")).toEqual({ kind: "days", days: 20 });
    expect(value("AN-B16")).toEqual({ kind: "count", count: 4 });
    const busiest = fxAgentAResult(projection, "AN-B20", RANGE, TODAY, "complete").result;
    if (busiest.shape !== "record-extreme") throw new Error("extreme expected");
    expect(busiest.occurredLocalDate).toBe("2026-10-02");
    expect(busiest.tieCount).toBe(5);
    expect(busiest.extremeValue).toEqual({ kind: "count", count: 2 });
  });

  it("分类频次排行不暴露占位金额（次要金额被剥离）", () => {
    const projection = ready(view({ entries: MIXED_ENTRIES, missingCurrencies: ["USD"] }));
    const result = fxAgentAResult(projection, "AN-I05", RANGE, TODAY, "complete").result;
    if (result.shape !== "ranked-groups") throw new Error("ranked-groups expected");
    expect(result.groups.length).toBeGreaterThan(0);
    for (const group of result.groups) expect(group).not.toHaveProperty("secondary");
    // 手算：餐饮 4 笔最多（e01,e02,e08,e09），含缺汇率的 USD 账目。
    expect(result.groups[0]).toMatchObject({ id: "c-food", count: 4 });
  });
});

describe("每张卡片都有缺汇率策略，目录开关与策略表一致", () => {
  it("81 张卡片逐一有策略", () => {
    expect(CARD_TYPES).toHaveLength(81);
    for (const type of CARD_TYPES) {
      expect(FX_CARD_POLICIES[type.id], type.id).toBeDefined();
      expect(type.combined, type.id).toBe(true);
    }
    expect(Object.keys(FX_CARD_POLICIES).sort()).toEqual(CARD_TYPES.map((type) => type.id).sort());
  });

  it("计数类的 kinds 恒为 none；其余必须声明受影响的方向", () => {
    for (const [id, policy] of Object.entries(FX_CARD_POLICIES)) {
      if (policy.class === "count") expect(policy.kinds, id).toBe("none");
      else expect(policy.kinds, id).not.toBe("none");
    }
  });
});
