/**
 * 38 张卡片的综合折算专项测试（逐卡）。
 *
 * - 夹具 `fxFixture.ts` 是 12 笔 CNY/USD/HKD/JPY 混币种账目，每一笔的人民币分、以及总额 / 笔数 / 极值 / 排行 / 占比
 *   都是**手算**后写进这里的字面量，不通过再调用一次被测函数得出（独立复核）。
 * - 缺汇率各情形的语义见 `fxPolicy.ts`：不当 0、不宣称完整、能算的才算。
 * - 渲染走真实的 `CardBody`（与生产同一条数据路径：`aggregateFxDetailed` → `projectFx` → A/B 入口）。
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { applyLocale } from "../i18n/index.js";
import { CardBody, cardRange, COMPARISON_IDS } from "./cards.js";
import { CARD_TYPES } from "./catalog.js";
import { cumulativeFor, flowFor, heatmapFor, timeSeriesFor, categorySeriesFor } from "./compute.js";
import { newCard } from "./defaults.js";
import { FX_CARD_POLICIES } from "./fxPolicy.js";
import { MIXED_ENTRIES, PREVIOUS_ENTRIES, RANGE } from "./fxFixture.js";
import { projectFx } from "./fxProjection.js";
import { buildFxView, tx } from "./fxTestSupport.js";
import type { WorkbenchScope } from "./scope.js";

/** 区间（10-01~10-27）已完全过去：没有「进行中」的桶，完整情形下不该出现任何「数据不完整」。 */
const PAST = "2026-11-02";
/** 区间结束当天：最后一个桶「进行中」，原币模式同样会提示。 */
const LIVE = "2026-10-27";

afterEach(() => {
  applyLocale("zh-CN");
});

function scope(fx: WorkbenchScope["fx"], over: Partial<WorkbenchScope> = {}): WorkbenchScope {
  return {
    today: PAST,
    filters: { time: { kind: "preset", preset: "30d" }, currency: null, combined: true },
    range: RANGE,
    bucket: "day",
    combined: true,
    fxAvailable: true,
    currency: "CNY",
    defaultCurrency: "CNY",
    entries: MIXED_ENTRIES,
    loaded: true,
    fx,
    coverageGap: null,
    repairing: false,
    accountScope: "user:a",
    ...over,
  };
}

const text = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function render(id: string, fx: WorkbenchScope["fx"], over: Partial<WorkbenchScope> = {}): string {
  const previousFx = COMPARISON_IDS.has(id) && over.previousFx === undefined ? buildFxView({ entries: PREVIOUS_ENTRIES }) : over.previousFx;
  return text(renderToStaticMarkup(<CardBody card={newCard(id)} scope={scope(fx, { ...over, ...(previousFx === undefined ? {} : { previousFx }) })} density="expanded" />));
}

const ALL_IDS = CARD_TYPES.map((type) => type.id);
/** 自带窗口（近 12 个月 / 全年）的卡片读各自的日期，见「固定窗口」一节。 */
const OWN_WINDOW = new Set(CARD_TYPES.filter((type) => type.ownWindow !== undefined).map((type) => type.id));
/** 只在综合折算下有意义的汇率诊断卡片（S17-C P17–P20）：原币模式明确说明，不与原币逐字比较。 */
const COMBINED_ONLY = new Set(CARD_TYPES.filter((type) => type.requiresCombined === true).map((type) => type.id));
const complete = buildFxView({ entries: MIXED_ENTRIES });

describe("全部卡片在综合折算下都有真实结果（无「暂不支持」、无原币数字冒充）", () => {
  it("目录共 81 张（S17-A/B 50 + S17-C 31），全部 combined，且都有缺汇率策略", () => {
    expect(ALL_IDS).toHaveLength(83);
    expect(new Set(ALL_IDS).size).toBe(83);
    expect([...OWN_WINDOW].sort()).toEqual(["AN-I09", "AN-I10", "AN-P15"]);
    expect([...COMBINED_ONLY].sort()).toEqual(["AN-P17", "AN-P18", "AN-P19", "AN-P20"]);
    for (const id of ALL_IDS) {
      expect(FX_CARD_POLICIES[id], id).toBeDefined();
      expect(CARD_TYPES.find((type) => type.id === id)?.combined, id).toBe(true);
    }
  });

  it("完整折算：每张卡片都渲染出内容，没有「暂不支持」「无法计算」，I09/I10 以外也不会因为区间不同而缺数据", () => {
    for (const id of ALL_IDS) {
      if (OWN_WINDOW.has(id)) continue; // 自带 12 个月窗口，见「固定窗口」一节
      const html = render(id, complete);
      expect(html.length, id).toBeGreaterThan(0);
      expect(html, id).not.toContain("暂不支持");
      expect(html, id).not.toContain("无法计算");
      expect(html, id).not.toContain("还没有读取到");
      // 汇率诊断卡片的职责就是报告缺汇率情况（表头「缺汇率」、计数 0），不算降级提示。
      if (!COMBINED_ONLY.has(id)) expect(html, id).not.toContain("缺汇率");
    }
    // 手算：MIXED_ENTRIES 里 8 笔外币（USD/HKD/JPY）全部有汇率。
    expect(render("AN-P19", complete)).toContain("需折算 8 笔，已折算 8 笔");
  });
});

describe("完整折算 · 手算金额与统计量（独立复核）", () => {
  /**
   * 手算（目标 CNY，单位：分）：
   *   支出 e01 10000 + e02 7898 + e03 600 + e05 5000 + e06 2500 + e08 6400 + e09 801 + e10 30000 + e11 320000 = 383199
   *   收入 e04 500000 + e07 64000 + e12 80000 = 644000；净额 260801
   */
  const expected: Readonly<Record<string, string>> = {
    "AN-B01": "¥3,831.99",
    "AN-B02": "¥6,440.00",
    "AN-B03": "¥2,608.01",
    "AN-B04": "9 笔",
    "AN-B05": "3 笔",
    "AN-B06": "¥141.93", // 383199 / 27 天 = 14192.56 分
    "AN-B07": "¥425.78", // 383199 / 9 笔 = 42577.67 分
    "AN-B08": "¥64.00", // 9 笔排序后第 5 个 = 6400
    "AN-B09": "¥3,200.00 2026年10月20日 · 购物",
    "AN-B10": "¥6.00 2026年10月2日 · 交通",
    "AN-B11": "¥3,200.00 2026年10月20日", // 10-20 当日支出合计 320000
    "AN-B12": "¥5,000.00 2026年10月3日",
    "AN-B13": "7 天", // 10-01 02 03 05 10 15 20
    "AN-B14": "20 天", // 27 − 7
    "AN-B15": "¥3,250.00 购物", // 购物 5000 + 320000
    "AN-B16": "4 个", // 餐饮 交通 购物 房租
    "AN-B17": "¥5,000.00 2026年10月3日 · 工资",
    "AN-B18": "59.5%", // 383199 / 644000
    "AN-B19": "40.5%", // 260801 / 644000
    "AN-B20": "2 笔 2026年10月2日 并列 5 项", // 有 2 笔的日子：10-02 03 05 10 20
  };

  it.each(Object.entries(expected))("%s", (id, value) => {
    expect(render(id, complete)).toBe(value);
  });

  it("支出构成 I01：分项和占比（手算 3250 / 300 / 250.99 / 31 元，合计 3831.99）", () => {
    const html = render("AN-I01", complete);
    for (const piece of ["合计 ¥3,831.99", "购物 85% ¥3,250.00", "房租 8% ¥300.00", "餐饮 7% ¥250.99", "交通 1% ¥31.00"]) expect(html).toContain(piece);
  });

  it("收入构成 I02 / 排行 I03 I04 / 频次 I05 / 支付方式 I17", () => {
    expect(render("AN-I02", complete)).toContain("合计 ¥6,440.00 工资 78% ¥5,000.00 兼职 22% ¥1,440.00");
    expect(render("AN-I03", complete)).toBe("购物 ¥3,250.00 84.8% 房租 ¥300.00 7.8% 餐饮 ¥250.99 6.5% 交通 ¥31.00 0.8%");
    expect(render("AN-I04", complete)).toBe("工资 ¥5,000.00 77.6% 兼职 ¥1,440.00 22.4%");
    // 笔数：餐饮 4（e01 e02 e08 e09）、购物 2、交通 2、房租 1；占 9 笔
    expect(render("AN-I05", complete)).toBe("餐饮 4 笔 44.4% 购物 2 笔 22.2% 交通 2 笔 22.2% 房租 1 笔 11.1%");
    // 支付方式：微信 e01+e02 = 17898；现金 e06+e08 = 8900；未指定 = 383199 − 17898 − 8900 = 356401
    expect(render("AN-I17", complete)).toContain("合计 ¥3,831.99 未指定 93% ¥3,564.01 微信 5% ¥178.98 现金 2% ¥89.00");
  });

  it("上期比较 A01：支出 ¥3,831.99 对上期 ¥320.00 → ↑1097%；收入 ¥6,440.00 对 ¥1,000.00 → ↑544%", () => {
    const html = render("AN-A01", complete);
    expect(html).toContain("支出 ¥3,831.99 ↑ 1097%");
    expect(html).toContain("收入 ¥6,440.00 ↑ 544%");
  });

  it("完整折算且区间已过去：时间类卡片没有任何「不完整」提示", () => {
    for (const id of ["AN-I06", "AN-I07", "AN-I08", "AN-I11", "AN-I12", "AN-I15", "AN-I16", "AN-I19", "AN-I20", "AN-A01"]) {
      expect(render(id, complete), id).not.toContain("数据不完整");
    }
  });

  it("区间最后一天是今天：最后一个桶「进行中」，如实提示（与原币模式一致），但不是汇率问题", () => {
    const html = render("AN-I06", complete, { today: LIVE });
    expect(html).toContain("数据不完整");
    expect(html).not.toContain("缺汇率");
  });
});

describe("时间序列的数据层（手算桶金额）", () => {
  const projection = (() => {
    const state = projectFx(complete as never);
    if (state.status !== "ready") throw new Error("ready expected");
    return state.projection;
  })();
  const converted = projection.converted;

  it("每日支出：与手算逐日一致，合计 383199", () => {
    const view = timeSeriesFor(converted, "expense", "day", RANGE, PAST);
    const byDay = new Map(view.result.buckets.map((bucket) => [bucket.bucket.key, bucket.amountMinor]));
    // 10-01 10000；10-02 7898+600；10-03 5000；10-05 2500；10-10 6400+801；10-15 30000；10-20 320000
    expect(byDay.get("2026-10-01")).toBe("10000");
    expect(byDay.get("2026-10-02")).toBe("8498");
    expect(byDay.get("2026-10-03")).toBe("5000");
    expect(byDay.get("2026-10-05")).toBe("2500");
    expect(byDay.get("2026-10-10")).toBe("7201");
    expect(byDay.get("2026-10-15")).toBe("30000");
    expect(byDay.get("2026-10-20")).toBe("320000");
    expect(byDay.get("2026-10-04")).toBe("0");
    expect(view.result.totalMinor).toBe("383199");
    expect(view.result.complete).toBe(true);
  });

  it("每周支出（周一起）：23498 / 9701 / 30000 / 320000 / 0", () => {
    const view = timeSeriesFor(converted, "expense", "week", RANGE, PAST);
    expect(view.result.buckets.map((bucket) => bucket.amountMinor)).toEqual(["23498", "9701", "30000", "320000", "0"]);
  });

  it("每月收入：10 月 644000", () => {
    const view = timeSeriesFor(converted, "income", "month", RANGE, PAST);
    expect(view.result.buckets.map((bucket) => bucket.amountMinor)).toEqual(["644000"]);
  });

  it("收支流向：10-03 收入 500000 / 支出 5000；10-20 收入 80000 / 支出 320000", () => {
    const flow = flowFor(converted, "day", RANGE, PAST).result;
    const day = (key: string) => flow.buckets.find((bucket) => bucket.bucket.key === key);
    expect(day("2026-10-03")).toMatchObject({ incomeMinor: "500000", expenseMinor: "5000" });
    expect(day("2026-10-20")).toMatchObject({ incomeMinor: "80000", expenseMinor: "320000" });
    expect(flow.totalIncomeMinor).toBe("644000");
    expect(flow.totalExpenseMinor).toBe("383199");
  });

  it("累计支出终值 383199；日历热力 10-20 为 320000，没有记录的日子是已知的 0", () => {
    const cumulative = cumulativeFor(converted, RANGE, PAST).result;
    expect(cumulative.totalMinor).toBe("383199");
    const heat = heatmapFor(converted, RANGE, PAST);
    const cell = (date: string) => heat.cells.find((candidate) => candidate.date === date);
    expect(cell("2026-10-20")).toMatchObject({ valueMinor: "320000", state: "complete" });
    expect(cell("2026-10-04")).toMatchObject({ valueMinor: "0", level: 0 });
    expect(heat.complete).toBe(true);
  });

  it("分类序列：按折算后支出取前 4 个分类（购物 房租 餐饮 交通）", () => {
    const view = categorySeriesFor(converted, "day", RANGE, PAST);
    expect(view.result.categoryIds.filter((id) => id !== "__other__")).toEqual(["c-shopping", "c-rent", "c-food", "c-transport"]);
  });

  it("日记账笔数（计数类）：用全部账目，10-02 与 10-03 各 2 笔", () => {
    const view = timeSeriesFor(projection.all, "count", "day", RANGE, PAST);
    const byDay = new Map(view.result.buckets.map((bucket) => [bucket.bucket.key, bucket.transactionCount]));
    expect(byDay.get("2026-10-02")).toBe(2);
    expect(byDay.get("2026-10-03")).toBe(2);
    expect(byDay.get("2026-10-04")).toBe(0);
    expect(view.result.totalCount).toBe(12);
  });
});

describe("缺汇率 · 各类卡片如实降级（10-02 的 USD 与 HKD 支出缺汇率：e02 + e03）", () => {
  const missing = buildFxView({ entries: MIXED_ENTRIES, missingDates: ["2026-10-02"] });
  // 缺 e02(7898) + e03(600)：已折算支出 = 383199 − 8498 = 374701；净额 = 644000 − 374701 = 269299
  it("金额合计：给「已成功折算部分的小计」并标注，不是总额；收入合计不受缺的支出影响，仍完整", () => {
    expect(render("AN-B01", missing)).toBe("¥3,747.01 已成功折算部分的小计；另有 2 笔缺汇率未计入，不是总额。");
    expect(render("AN-B02", missing)).toBe("¥6,440.00");
    expect(render("AN-B03", missing)).toBe("¥2,692.99 已成功折算部分的小计；另有 2 笔缺汇率未计入，不是总额。");
  });

  it("计数类：缺汇率账目照常计数，结果与完整时逐字相同，且不提示不完整", () => {
    for (const id of ["AN-B04", "AN-B05", "AN-B13", "AN-B14", "AN-B16", "AN-B20", "AN-I05"]) {
      expect(render(id, missing), id).toBe(render(id, complete));
    }
  });

  it("日均支出只给已折算部分并标注；平均 / 中位数 / 比率 无法确定，只说缺了几笔", () => {
    expect(render("AN-B06", missing)).toBe("¥138.78 按已成功折算的账目计算；另有 2 笔缺汇率未计入。");
    for (const id of ["AN-B07", "AN-B08", "AN-B18", "AN-B19"]) {
      const html = render(id, missing);
      expect(html, id).toBe("无法确定 有 2 笔缺汇率，这个数字无法确定。");
      expect(html, id).not.toMatch(/[¥%]/);
    }
  });

  it("极值：只在已折算账目中比较，明确不一定是全局结果（缺的 e03 本是最小单笔）", () => {
    // 已折算的最小单笔变成 e09 = ¥8.01，而真正的最小是缺汇率的 e03 ¥6.00。
    const min = render("AN-B10", missing);
    expect(min).toContain("¥8.01 2026年10月10日");
    expect(min).toContain("不一定是全局结果");
    expect(min).toContain("2 笔缺汇率可能改变它");
    for (const id of ["AN-B09", "AN-B11", "AN-B15"]) expect(render(id, missing), id).toContain("不一定是全局结果");
    // 收入极值不受缺的支出影响：没有这句话。
    for (const id of ["AN-B12", "AN-B17"]) expect(render(id, missing), id).not.toContain("不一定是全局结果");
  });

  it("支出构成：给小计、不给占比（不出现 %），图形退化为排行并说明", () => {
    const html = render("AN-I01", missing);
    expect(html).toContain("已成功折算部分的小计，不显示占比");
    expect(html).toContain("分母不完整或分项太少，改用排行显示");
    expect(html).not.toContain("%");
    // 餐饮 e01 + e08 + e09 = 10000 + 6400 + 801 = 17201（e02 缺）；交通 e06 = 2500（e03 缺）
    expect(html).toContain("餐饮 ¥172.01");
    expect(html).toContain("交通 ¥25.00");
    expect(render("AN-I17", missing)).not.toContain("%");
  });

  it("排行：只含已折算账目，明确排名可能变化；收入排行 / 构成不受影响", () => {
    expect(render("AN-I03", missing)).toContain("排名可能变化");
    expect(render("AN-I04", missing)).not.toContain("排名可能变化");
    expect(render("AN-I02", missing)).toBe(render("AN-I02", complete));
  });

  it("支出时间序列：含缺汇率日期的桶是未知（不是 0），合计不给；收入序列不受影响", () => {
    const projection = projectFx(missing as never);
    if (projection.status !== "ready") throw new Error("ready expected");
    const { converted, missingByScope } = projection.projection;
    const daily = timeSeriesFor(converted, "expense", "day", RANGE, PAST, missingByScope.expense.dates);
    const cell = daily.result.buckets.find((bucket) => bucket.bucket.key === "2026-10-02");
    expect(cell).toMatchObject({ amountMinor: null, transactionCount: null, unknownReason: "coverage-missing" });
    expect(cell?.bucket.state).toBe("unknown");
    expect(daily.result.totalMinor).toBeNull();
    expect(daily.result.unknownBucketCount).toBe(1);
    // 周粒度：包含 10-02 的第一周整周未知；其余周精确（9701 / 30000 / 320000 / 0）
    const weekly = timeSeriesFor(converted, "expense", "week", RANGE, PAST, missingByScope.expense.dates);
    expect(weekly.result.buckets.map((bucket) => bucket.amountMinor)).toEqual([null, "9701", "30000", "320000", "0"]);
    // 累计：未知之后全部不可确认
    const cumulative = cumulativeFor(converted, RANGE, PAST, missingByScope.expense.dates).result;
    expect(cumulative.points.find((point) => point.bucket.key === "2026-10-01")?.cumulativeMinor).toBe("10000");
    expect(cumulative.points.filter((point) => point.bucket.key > "2026-10-02").every((point) => point.cumulativeMinor === null)).toBe(true);
    expect(cumulative.totalMinor).toBeNull();
    // 热力图：未知日 level / 金额 null，不是 0
    const heat = heatmapFor(converted, RANGE, PAST, missingByScope.expense.dates);
    expect(heat.cells.find((candidate) => candidate.date === "2026-10-02")).toMatchObject({ valueMinor: null, level: null });
    expect(heat.cells.find((candidate) => candidate.date === "2026-10-04")).toMatchObject({ valueMinor: "0", level: 0 });
    // 收入序列：缺的是支出，收入口径没有未知日期
    const income = timeSeriesFor(converted, "income", "day", RANGE, PAST, missingByScope.income.dates);
    expect(income.result.totalMinor).toBe("644000");
  });

  it("支出时间类卡片说明含缺汇率的时间段已标未知；收入趋势没有这句话", () => {
    for (const id of ["AN-I06", "AN-I08", "AN-I11", "AN-I12", "AN-I15", "AN-I16", "AN-I20"]) {
      expect(render(id, missing), id).toContain("含缺汇率账目的时间段已标为未知");
    }
    expect(render("AN-I07", missing)).not.toContain("缺汇率");
    // 日记账笔数与金额无关：缺汇率不影响
    expect(render("AN-I19", missing)).toBe(render("AN-I19", complete));
  });

  it("缺汇率的日子里的未知桶不会被画成「0」或「没有记录」", () => {
    for (const id of ["AN-I06", "AN-I20"]) {
      const html = render(id, missing);
      expect(html, id).not.toContain("这段时间没有记录");
    }
  });

  it("上期比较：本期缺汇率时不给增减，不编造增长率；本期小计仍标注", () => {
    const html = render("AN-A01", missing);
    expect(html).toContain("支出 ¥3,747.01");
    expect(html).not.toMatch(/[↑↓]/);
    expect(html).toContain("本期或上期有缺汇率的账目（共 2 笔），不显示增减比较");
    expect(html).toContain("已成功折算部分的小计");
  });

  it("上期缺汇率（本期完整）：本期数字照常显示，只是不给增减", () => {
    const previousMissing = buildFxView({ entries: PREVIOUS_ENTRIES, missingCurrencies: ["USD"] });
    const html = render("AN-A01", complete, { previousFx: previousMissing });
    expect(html).toContain("支出 ¥3,831.99");
    expect(html).toContain("收入 ¥6,440.00");
    expect(html).not.toMatch(/[↑↓]/);
    expect(html).toContain("本期或上期有缺汇率的账目（共 1 笔），不显示增减比较");
    expect(html).not.toContain("已成功折算部分的小计");
  });

  it("上期读取失败 / 加载中 / 来源不全：不比较，且原因说得对", () => {
    expect(render("AN-A01", complete, { previousFx: buildFxView({ entries: [], error: { reason: "read" } }) })).toContain("上期的折算或账目不完整");
    expect(render("AN-A01", complete, { previousFx: buildFxView({ entries: [], loading: true }) })).toContain("正在按历史汇率折算");
    expect(render("AN-A01", complete, { previousFx: buildFxView({ entries: PREVIOUS_ENTRIES, sourceComplete: false }) })).toContain("上期的折算或账目不完整");
    const currentIncomplete = render("AN-A01", buildFxView({ entries: MIXED_ENTRIES, sourceComplete: false }));
    expect(currentIncomplete).toContain("本期的账目覆盖不完整");
    expect(currentIncomplete).not.toMatch(/[↑↓]/);
  });
});

describe("缺汇率 · 收入方向（10-05 的 USD 收入缺汇率：e07）", () => {
  const missing = buildFxView({ entries: MIXED_ENTRIES, missingDates: ["2026-10-05"] });
  it("收入合计只给小计；支出合计与支出类卡片不受影响", () => {
    // 已折算收入 = 500000 + 80000 = 580000
    expect(render("AN-B02", missing)).toBe("¥5,800.00 已成功折算部分的小计；另有 1 笔缺汇率未计入，不是总额。");
    expect(render("AN-B01", missing)).toBe("¥3,831.99");
    expect(render("AN-B06", missing)).toBe("¥141.93");
    expect(render("AN-I01", missing)).toBe(render("AN-I01", complete));
    expect(render("AN-I02", missing)).toContain("不显示占比");
    expect(render("AN-I04", missing)).toContain("排名可能变化");
  });
});

describe("缺汇率 · 全部缺失：不显示 0，也不说「没有记录」", () => {
  const only = [tx("u1", { currency: "USD", amountCents: 1234, occurredLocalDate: "2026-10-02" }), tx("u2", { currency: "USD", amountCents: 500, occurredLocalDate: "2026-10-03", kind: "income", categoryId: "c-salary", categoryName: "工资" })];
  const none = buildFxView({ entries: only, missingCurrencies: ["USD"] });

  it("每张卡片都不说「这段时间没有记录」；非时间序列卡片不出现 ¥0.00（序列里没有任何记录的日子是真的 0，另测）", () => {
    for (const id of ALL_IDS) {
      if (OWN_WINDOW.has(id)) continue;
      const html = render(id, none);
      expect(html, id).not.toContain("这段时间没有记录");
      if (FX_CARD_POLICIES[id]?.class !== "series") expect(html, id).not.toContain("¥0.00");
    }
  });

  it("序列卡片：只有缺汇率的那一天（10-02）是未知；其余 26 天没有任何账目，是真的 0（不是未知）", () => {
    // 27 天里 10-02 是未知支出日 → 其余 26 天各出一个「¥0.00」，未知日不出现 0。
    const html = render("AN-I15", none);
    expect(html.split("¥0.00").length - 1).toBe(26);
    expect(html).toContain("1 笔缺汇率");
  });

  it("金额类卡片说明「没有任何已折算的账目，无法确定」；计数类仍精确（1 笔支出）", () => {
    for (const id of ["AN-B01", "AN-B06", "AN-B09", "AN-B15", "AN-I01", "AN-I03", "AN-I17"]) {
      expect(render(id, none), id).toContain("没有任何已折算的账目，无法确定");
    }
    expect(render("AN-B04", none)).toBe("1 笔");
    expect(render("AN-B05", none)).toBe("1 笔");
    expect(render("AN-B13", none)).toBe("1 天");
  });
});

describe("逐笔条数超限 · 不截断、不冒充完整", () => {
  const limited = buildFxView({ entries: MIXED_ENTRIES, maxEntries: 5 });
  const AGGREGATE_ONLY = ["AN-B01", "AN-B02", "AN-B03", "AN-I01", "AN-I02", "AN-I03", "AN-I04"];

  it("仅靠聚合就精确的 7 张卡片照常显示完整结果；其余明确说明超过上限、无法计算", () => {
    for (const id of ALL_IDS) {
      if (OWN_WINDOW.has(id)) continue;
      const html = render(id, limited);
      if (AGGREGATE_ONLY.includes(id)) {
        expect(html, id).toBe(render(id, complete));
      } else {
        expect(html, id).toContain("超过逐笔分析上限（50000 笔）");
        expect(html, id).not.toContain("¥");
      }
    }
  });
});

describe("读取状态 · 加载 / 失败 / 无权限 / 对不上 都是显式状态", () => {
  it("所有卡片：加载中不是 0，无权限不显示金额，失败可重试", () => {
    for (const id of ALL_IDS) {
      if (OWN_WINDOW.has(id)) continue;
      expect(render(id, buildFxView({ entries: [], loading: true })), id).toContain("正在按历史汇率折算");
      expect(render(id, buildFxView({ entries: [], error: { reason: "permission" } })), id).toContain("无权访问该账本");
      const failed = render(id, buildFxView({ entries: [], error: { reason: "read" } }));
      expect(failed, id).toContain("暂时无法完成折算");
      expect(failed, id).toContain("重试");
      for (const html of [render(id, buildFxView({ entries: [], loading: true })), failed]) {
        expect(html, id).not.toContain("¥0.00");
        expect(html, id).not.toContain("这段时间没有记录");
      }
    }
  });
});

describe("固定窗口 · 卡片读自己的时间窗，不拿全局范围冒充", () => {
  it("自带 12 个月窗口的卡片：窗口与全局范围不同时明确说明尚未读取，不显示全局金额", () => {
    for (const id of ["AN-I09", "AN-I10"]) {
      const html = render(id, complete);
      expect(html, id).toContain("还没有读取到");
      expect(html, id).not.toContain("¥3,831.99");
      expect(html, id).not.toContain("¥6,440.00");
    }
  });

  it("读到该窗口的折算后：I09 每月支出 / I10 每月收入为手算的 10 月合计", () => {
    const window = cardRange(newCard("AN-I09"), scope(complete));
    expect(window.to).toBe(PAST);
    expect(window.from).toBe("2025-12-01");
    const own = buildFxView({ entries: MIXED_ENTRIES });
    const expense = render("AN-I09", own, { range: window });
    const income = render("AN-I10", own, { range: window });
    expect(expense).toContain("¥3,831.99");
    expect(income).toContain("¥6,440.00");
    // 窗口末月（11 月）仍在进行中：如实提示；不是汇率问题
    expect(expense).not.toContain("缺汇率");
  });

  it("固定窗口里缺汇率：对应月份未知，不是 0", () => {
    const window = cardRange(newCard("AN-I09"), scope(complete));
    const missing = buildFxView({ entries: MIXED_ENTRIES, missingDates: ["2026-10-02"] });
    const html = render("AN-I09", missing, { range: window });
    expect(html).toContain("含缺汇率账目的时间段已标为未知");
  });
});

describe("综合 ↔ 原币、默认币种变化", () => {
  it("目标币种换成 USD：逐笔折算后再汇总（手算支出 598.76 美元，≠ 先汇总再折算）", () => {
    // 逐笔半入取整（分）：e01 1563 · e02 1234 · e03 94 · e05 781 · e06 391 · e08 1000 · e09 125 · e10 4688 · e11 50000 = 59876
    const usd = buildFxView({ entries: MIXED_ENTRIES, target: "USD" });
    const html = render("AN-B01", usd, { currency: "USD", defaultCurrency: "USD" });
    expect(html).toContain("598.76");
    expect(html).not.toContain("¥");
  });

  it("切回原币模式：同一张卡片只算所选币种，不混币（CNY 支出 = 10000 + 2500 + 30000 = 42500）", () => {
    const original = text(renderToStaticMarkup(<CardBody card={newCard("AN-B01")} scope={scope(null, { combined: false })} density="medium" />));
    expect(original).toBe("¥425.00");
  });
});

describe("同币种账本：综合折算与原币逐字一致（恒等折算不得改变任何一张卡片的输出）", () => {
  // 只有人民币账目：折算是恒等（不需要任何汇率），综合折算路径的输出必须与原币路径完全相同。
  const cnyOnly = MIXED_ENTRIES.filter((entry) => entry.currency === "CNY");
  const previousCny = PREVIOUS_ENTRIES.filter((entry) => entry.currency === "CNY");
  // 原币路径的「上期比较」从 comparisonRead 读上一周期；综合折算从 previousFx 读——两边喂同样的上期账目。
  const originalText = (id: string): string =>
    text(renderToStaticMarkup(
      <CardBody
        card={newCard(id)}
        scope={scope(null, { combined: false, fxAvailable: false, entries: cnyOnly, comparisonRead: { entries: previousCny, verified: true } })}
        density="expanded"
      />,
    ));

  it("每一张卡片：综合折算（全部为人民币）= 人民币原币", () => {
    const view = buildFxView({ entries: cnyOnly });
    const previousFx = buildFxView({ entries: previousCny });
    const differing: string[] = [];
    for (const id of ALL_IDS) {
      if (OWN_WINDOW.has(id)) continue; // 固定窗口：数据来自各自窗口，见「固定窗口」一节
      if (COMBINED_ONLY.has(id)) continue; // 汇率诊断：原币模式明确说明「只在综合折算下有意义」，另测
      const combined = render(id, view, { entries: cnyOnly, previousFx });
      if (combined !== originalText(id)) differing.push(`${id}\n  综合: ${combined}\n  原币: ${originalText(id)}`);
    }
    expect(differing, differing.join("\n")).toEqual([]);
  });
});

describe("规模与不变性", () => {
  it("两万笔账目的投影与汇总在合理时间内完成，且不改动输入", () => {
    const rows = Array.from({ length: 20_000 }, (_, index) =>
      tx(`b${String(index)}`, { currency: index % 3 === 0 ? "USD" : "CNY", amountCents: 100 + (index % 977), occurredLocalDate: `2026-10-${String((index % 27) + 1).padStart(2, "0")}` }),
    );
    const frozen = JSON.stringify(rows);
    const view = buildFxView({ entries: rows });
    const started = performance.now();
    const state = projectFx(view as never);
    expect(state.status).toBe("ready");
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(JSON.stringify(rows)).toBe(frozen);
  });
});
