/**
 * S17-C 深入与专业分析卡片（1.17.10）逐卡渲染测试。
 *
 * 夹具是 8 笔人民币支出 + 1 笔收入（区间 2026-10-01 ~ 10-27，今天 11-02，区间已完全过去），
 * 期望值都是**手算**写成字面量的（独立复核，不再调用一次被测函数）：
 *
 *   支出：x1 10-01 餐饮 微信 10.00 · x2 10-01 交通 现金 5.00 · x3 10-02 餐饮 微信 30.00 · x4 10-05 购物（未指定）200.00
 *        x5 10-05 餐饮 现金 15.00 · x6 10-12 房租 微信 1,000.00 · x7 10-20 餐饮 微信 25.00 · x8 10-20 交通 微信 5.00
 *   合计 1,290.00；分类：房租 1,000 / 购物 200 / 餐饮 80 / 交通 10
 *   上一可比期（09-04 ~ 09-30）：餐饮 50.00 · 交通 20.00 · 旅行 100.00，合计 170.00
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { Transaction } from "@libellum/shared";
import type { AnalysisCardNode } from "@libellum/shared/analysis/layout";

import { applyLocale } from "../i18n/index.js";
import { C_CARD_IDS } from "./cCards.js";
import { CardBody } from "./cards.js";
import { CARD_TYPES, type ChartFamily } from "./catalog.js";
import { newCard } from "./defaults.js";
import { FX_CARD_POLICIES } from "./fxPolicy.js";
import { buildFxView, tx } from "./fxTestSupport.js";
import type { WorkbenchScope } from "./scope.js";

const RANGE = { from: "2026-10-01", to: "2026-10-27" } as const;

afterEach(() => {
  applyLocale("zh-CN");
});

function entry(id: string, date: string, kind: "expense" | "income", amountCents: number, category: readonly [string, string], payment: readonly [string, string] | null, currency: Transaction["currency"] = "CNY"): Transaction {
  return tx(id, {
    occurredLocalDate: date,
    occurredAt: `${date}T04:00:00.000Z`,
    kind,
    amountCents,
    currency,
    categoryId: category[0],
    categoryName: category[1],
    paymentMethodId: payment?.[0] ?? null,
    paymentMethodName: payment?.[1] ?? null,
  });
}

const FOOD = ["c-food", "餐饮"] as const;
const TRANSPORT = ["c-transport", "交通"] as const;
const SHOPPING = ["c-shopping", "购物"] as const;
const RENT = ["c-rent", "房租"] as const;
const TRAVEL = ["c-travel", "旅行"] as const;
const SALARY = ["c-salary", "工资"] as const;
const WECHAT = ["p-wechat", "微信"] as const;
const CASH = ["p-cash", "现金"] as const;

const ENTRIES: readonly Transaction[] = [
  entry("x1", "2026-10-01", "expense", 1000, FOOD, WECHAT),
  entry("x2", "2026-10-01", "expense", 500, TRANSPORT, CASH),
  entry("x3", "2026-10-02", "expense", 3000, FOOD, WECHAT),
  entry("i1", "2026-10-03", "income", 500000, SALARY, null),
  entry("x4", "2026-10-05", "expense", 20000, SHOPPING, null),
  entry("x5", "2026-10-05", "expense", 1500, FOOD, CASH),
  entry("x6", "2026-10-12", "expense", 100000, RENT, WECHAT),
  entry("x7", "2026-10-20", "expense", 2500, FOOD, WECHAT),
  entry("x8", "2026-10-20", "expense", 500, TRANSPORT, WECHAT),
];

const PREVIOUS: readonly Transaction[] = [
  entry("p1", "2026-09-10", "expense", 5000, FOOD, WECHAT),
  entry("p2", "2026-09-15", "expense", 2000, TRANSPORT, CASH),
  entry("p3", "2026-09-20", "expense", 10000, TRAVEL, WECHAT),
];

function scope(entries: readonly Transaction[], over: Partial<WorkbenchScope> = {}): WorkbenchScope {
  return {
    today: "2026-11-02",
    filters: { time: { kind: "custom", from: RANGE.from, to: RANGE.to }, currency: null, combined: false },
    range: RANGE,
    bucket: "day",
    combined: false,
    fxAvailable: true,
    currency: "CNY",
    defaultCurrency: "CNY",
    entries,
    loaded: true,
    fx: null,
    coverageGap: null,
    repairing: false,
    accountScope: "user:fixture",
    rangeReadState: "complete",
    rangeSourceComplete: true,
    comparisonRead: { entries: PREVIOUS, verified: true },
    ...over,
  };
}

function card(id: string, family?: ChartFamily): AnalysisCardNode {
  const base = newCard(id, `card-${id}`);
  return family === undefined ? base : { ...base, chart: { chartFamily: family } };
}

const text = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function render(id: string, family?: ChartFamily, over: Partial<WorkbenchScope> = {}, entries: readonly Transaction[] = ENTRIES): string {
  return text(renderToStaticMarkup(<CardBody card={card(id, family)} scope={scope(entries, over)} density="expanded" detail />));
}

const C_TYPES = CARD_TYPES.filter((type) => C_CARD_IDS.has(type.id));

describe("S17-C 目录：33 张卡片全部登记、全部有缺汇率策略与文案", () => {
  it("登记数量与编号", () => {
    expect(C_TYPES).toHaveLength(33);
    expect(C_CARD_IDS.size).toBe(33);
    for (const type of C_TYPES) {
      expect(FX_CARD_POLICIES[type.id], type.id).toBeDefined();
      expect(type.source, type.id).toBe("agent-c");
    }
    // W7 已提供真实层级，P05/P07 开放；P21 仍需要独立维度参数。
    for (const id of ["AN-P05", "AN-P07"]) expect(CARD_TYPES.some((type) => type.id === id), id).toBe(true);
    expect(CARD_TYPES.some(type=>type.id==="AN-P21")).toBe(false);
  });

  it("每张卡片的每种展示方式都能渲染：没有 NaN / undefined / Infinity，没有「卡片来自更新的版本」", () => {
    for (const type of C_TYPES) {
      for (const family of type.families) {
        for (const combined of [false, true]) {
          const html = combined
            ? text(renderToStaticMarkup(<CardBody card={card(type.id, family)} scope={scope(ENTRIES, { combined: true, fx: buildFxView({ entries: ENTRIES }), previousFx: buildFxView({ entries: PREVIOUS }) })} density="expanded" detail />))
            : render(type.id, family);
          const label = `${type.id}/${family}/${combined ? "combined" : "original"}`;
          expect(html.length, label).toBeGreaterThan(0);
          for (const bad of ["NaN", "undefined", "Infinity", "更新的版本", "出错"]) expect(html, label).not.toContain(bad);
        }
      }
    }
  });
});

describe("排行与集中度（手算）", () => {
  it("I18 大额支出明细：第一行是 10-12 房租 微信 ¥1,000.00，未指定支付方式如实写出", () => {
    const html = render("AN-I18");
    expect(html).toContain("1 2026年10月12日 房租 微信 ¥1,000.00");
    expect(html).toContain("2 2026年10月5日 购物 未指定支付方式 ¥200.00");
  });

  it("A08 分类集中度：前 3 个分类占 99.2%（128,000 / 129,000），最多的是房租 77.5%", () => {
    const html = render("AN-A08");
    expect(html).toContain("99.2%");
    expect(html).toContain("前 3 个分类合计占比");
    expect(html).toContain("最多：房租 77.5%");
  });

  it("P08 分类帕累托（表格）：累计占比 77.5% → 93.0% → 99.2% → 100.0%", () => {
    expect(render("AN-P08", "table")).toContain("房租 ¥1,000.00 77.5% 购物 ¥200.00 93.0% 餐饮 ¥80.00 99.2% 交通 ¥10.00 100.0%");
  });

  it("A16 大额交易集中度：前 5 笔占 98.4%（127,000 / 129,000）", () => {
    const html = render("AN-A16");
    expect(html).toContain("98.4%");
    expect(html).toContain("前 5 笔合计占比");
    expect(html).toContain("¥1,270.00 / ¥1,290.00");
  });
});

describe("分布（手算）", () => {
  it("A10 箱线图（图形）：数轴取须线范围，房租 1,000.00 这样的离群值画在两端并写明", () => {
    const html = render("AN-A10", "boxplot");
    expect(html).toContain("笔离群值画在两端（最高 ¥1,000.00）");
    expect(html).toContain("8 笔");
  });

  it("A10 箱线图（数字）：中位数 ¥20.00（8 笔排序后第 4、5 笔 15.00 与 25.00 的平均）", () => {
    expect(render("AN-A10", "number")).toContain("¥20.00");
  });

  it("A11 离散程度：笔均 ¥161.25（129,000 / 8）", () => {
    const html = render("AN-A11");
    expect(html).toContain("变异系数");
    expect(html).toContain("笔均 ¥161.25");
  });

  it("A09 直方图：8 笔都画入", () => {
    expect(render("AN-A09")).toContain("8 笔 · 每格");
  });

  it("A15 连续无支出：最长 7 天，当前（截至区间末 10-27）已连续 7 天", () => {
    // 有支出：01 02 05 12 20 → 无支出段 03–04 (2) · 06–11 (6) · 13–19 (7) · 21–27 (7)
    const html = render("AN-A15");
    expect(html).toContain("7 天");
    expect(html).toContain("当前已连续 7 天");
    expect(render("AN-A15", "table")).toContain("2026年10月6日 2026年10月11日 6 天");
  });

  it("A15 本机覆盖未确认：不能确认的日子是「未知」，不算无支出", () => {
    const html = render("AN-A15", undefined, { rangeSourceComplete: false });
    expect(html).toContain("天数据不完整，未计入");
    expect(html).not.toContain("当前已连续 7 天");
    // 一段能确认的无支出日都没有：结果未知，不是「0 天」
    expect(html).toContain("无法确定");
    expect(html).not.toContain("0 天");
  });

  it("P12 分类箱线图（表格）：餐饮 4 笔，中位数 ¥20.00", () => {
    expect(render("AN-P12", "table")).toContain("餐饮 4");
  });

  it("P11 气泡（表格）：餐饮 4 笔 · 合计 ¥80.00 · 笔均 ¥20.00", () => {
    expect(render("AN-P11", "table")).toContain("餐饮 ¥80.00 4 ¥20.00");
  });
});

describe("矩阵与透视（手算）", () => {
  it("P03 分类 × 支付方式：微信 / 现金 / 未指定支付方式都有列", () => {
    const html = render("AN-P03");
    for (const label of ["微信", "现金", "未指定支付方式"]) expect(html).toContain(label);
  });

  it("P13 透视表：总计 ¥1,290.00，房租行 ¥1,000.00", () => {
    const html = render("AN-P13");
    expect(html).toContain("合计");
    expect(html).toContain("¥1,290.00");
    expect(html).toContain("房租 ¥1,000.00 ¥1,000.00");
  });

  it("P15 全年日历：2026 年合计 ¥1,290.00 · 8 笔；11 月 3 日以后是「尚未到来」", () => {
    const html = render("AN-P15");
    expect(html).toContain("2026 年 · ¥1,290.00 · 8 笔");
    expect(html).toContain("2026年11月3日 · 尚未到来");
    expect(html).toContain("2026年10月12日 · ¥1,000.00");
  });

  it("P16 币种笔数：CNY 9 笔，只数笔数不加金额", () => {
    const html = render("AN-P16", "table");
    expect(html).toContain("CNY 9 8 1");
  });

  it("P09 排名变化：区间只有一个月时明确说需要两个月", () => {
    expect(render("AN-P09")).toContain("至少需要两个月的数据才能比较排名");
  });
});

describe("两期分析（本期 vs 上一可比期，手算）", () => {
  it("A06 变化归因：合计 +¥1,120.00；房租 +¥1,000.00（新出现）、旅行 −¥100.00（本期没有）", () => {
    const html = render("AN-A06");
    expect(html).toContain("支出合计 +¥1,120.00");
    expect(html).toContain("房租 +¥1,000.00 新出现");
    expect(html).toContain("旅行 −¥100.00 本期没有");
    expect(html).toContain("餐饮 +¥30.00");
  });

  it("P22 瀑布（表格）：上期 ¥170.00 → 本期 ¥1,290.00，变化 +¥1,120.00", () => {
    expect(render("AN-P22", "table")).toContain("合计 ¥170.00 ¥1,290.00 +¥1,120.00");
  });

  it("A17 分类变化排行（表格）：餐饮 +¥30.00 · 60.0%；交通 −¥10.00 · −50.0%", () => {
    const html = render("AN-A17", "table");
    expect(html).toContain("餐饮 +¥30.00 60.0%");
    expect(html).toContain("交通 −¥10.00 −50.0%");
  });

  it("A07 / P24 占比变化：餐饮 29.4% → 6.2%，−23.2 个百分点", () => {
    // 上期 5,000 / 17,000 = 29.41%；本期 8,000 / 129,000 = 6.20%；差 −23.21 个百分点
    expect(render("AN-A07")).toContain("餐饮 −23.2 个百分点 6.2%");
    expect(render("AN-P24", "table")).toContain("餐饮 29.4% 6.2% −23.2 个百分点");
    // 上期有支出（分母 170.00 已知）时，新出现分类的上期份额确实是 0%
    expect(render("AN-P24", "table")).toContain("房租 0.0% 77.5% +77.5 个百分点");
  });

  it("上一可比期按月对齐：10-01 ~ 10-27 对比 09-01 ~ 09-27", () => {
    expect(render("AN-A06")).toContain("上期 9/1–9/27 · 本期 10/1–10/27");
  });

  it("上期一笔支出都没有（账本从本期才开始记）：不画「全部新出现」，说明没有基准", () => {
    for (const id of ["AN-A06", "AN-A07", "AN-A17", "AN-P22", "AN-P24"]) {
      expect(render(id, undefined, { comparisonRead: { entries: [], verified: true } }), id).toContain("没有支出记录，无法比较变化");
    }
  });

  it("上期没有完整读取：不比较，说明原因", () => {
    expect(render("AN-A06", undefined, { comparisonRead: { entries: PREVIOUS, verified: false } })).toContain("上期的账目尚未完整读取");
  });
});

describe("综合折算", () => {
  // 两笔 USD 支出，一笔有汇率、一笔没有（10-02 缺汇率）。
  const mixed = [
    ...ENTRIES,
    entry("u1", "2026-10-02", "expense", 1000, FOOD, WECHAT, "USD"),
    entry("u2", "2026-10-06", "expense", 500, SHOPPING, null, "USD"),
  ];
  const fxMissing = buildFxView({ entries: mixed, missingDates: ["2026-10-02"] });
  const fxComplete = buildFxView({ entries: mixed });
  const combined = (id: string, fx: WorkbenchScope["fx"], family?: ChartFamily) =>
    text(renderToStaticMarkup(<CardBody card={card(id, family)} scope={scope(mixed, { combined: true, fx, previousFx: buildFxView({ entries: PREVIOUS }) })} density="expanded" detail />));

  it("缺汇率时：分位 / 集中度 / 归因无法确定；分布只画已折算部分并写明另有 1 笔", () => {
    for (const id of ["AN-A08", "AN-A10", "AN-A11", "AN-A16", "AN-P08", "AN-P12", "AN-P23"]) {
      expect(combined(id, fxMissing), id).toContain("有 1 笔缺汇率，这个数字无法确定");
    }
    expect(combined("AN-A06", fxMissing)).toContain("不显示增减比较");
    expect(combined("AN-A09", fxMissing)).toContain("只画已成功折算的账目；另有 1 笔缺汇率未画入");
    expect(combined("AN-P10", fxMissing)).toContain("另有 1 笔缺汇率未画入");
  });

  it("缺汇率时构成类不显示占比、树图退化为排行；P06 不画面积", () => {
    const html = combined("AN-P06", fxMissing);
    expect(html).toContain("不显示占比");
    expect(html).not.toContain("分类目前只有一层");
  });

  it("P19 汇率覆盖：需折算 2 笔，已折算 1 笔；P17 折算后币种构成：USD 1 笔折算 ¥32.00", () => {
    expect(combined("AN-P19", fxMissing)).toContain("需折算 2 笔，已折算 1 笔");
    // u2 500 美分 × 6.4 = 3200 分 = ¥32.00；缺汇率的 u1 不计入
    const p17 = combined("AN-P17", fxMissing, "table");
    expect(p17).toContain("USD 1 ¥32.00");
    expect(p17).toContain("另有 1 笔缺汇率未计入");
  });

  it("P20 汇率回退：两笔都有当天汇率时为「当天汇率 2 笔」", () => {
    expect(combined("AN-P20", fxComplete, "table")).toContain("当天汇率 2");
  });

  it("P18 汇率观测：只列实际用到的快照，1 USD = 6.4000 CNY", () => {
    const html = combined("AN-P18", fxComplete, "table");
    expect(html).toContain("6.4000");
    expect(html).toContain("USD → CNY");
  });

  it("原币模式下 P17–P20 明确说明只在综合折算下有意义", () => {
    for (const id of ["AN-P17", "AN-P18", "AN-P19", "AN-P20"]) expect(render(id), id).toContain("只在「综合折算」模式下有意义");
  });

  it("A15 是计数类：缺汇率不影响连续无支出天数", () => {
    expect(combined("AN-A15", fxMissing)).toBe(combined("AN-A15", fxComplete));
  });

  it("缺汇率时：I18 排行不给占比；P11 只给分类小计；P14 分类合计不给、P15 合计写明只是已知部分", () => {
    expect(combined("AN-I18", fxMissing, "ranking")).not.toContain("%");
    const p11 = combined("AN-P11", fxMissing);
    expect(p11).toContain("不显示占比");
    expect(p11).not.toContain("笔均");
    expect(combined("AN-P14", fxMissing)).toContain("—");
    // P15 自带全年窗口：作用域的日期就是它读取的那一年（今天 11-02 之前）
    const year = { from: "2026-01-01", to: "2026-11-02" } as const;
    const p15 = text(renderToStaticMarkup(<CardBody card={card("AN-P15")} scope={scope(mixed, { combined: true, range: year, fx: fxMissing })} density="expanded" detail />));
    expect(p15).toContain("不是全年合计");
  });

  it("两期分析：本期或上期账目覆盖不完整时不比较", () => {
    const partialFx = buildFxView({ entries: mixed, sourceComplete: false });
    const currentPartial = text(renderToStaticMarkup(<CardBody card={card("AN-A06")} scope={scope(mixed, { combined: true, fx: partialFx, previousFx: buildFxView({ entries: PREVIOUS }) })} density="expanded" detail />));
    expect(currentPartial).toContain("本期的账目覆盖不完整");
    const previousPartial = text(renderToStaticMarkup(<CardBody card={card("AN-P22")} scope={scope(mixed, { combined: true, fx: fxComplete, previousFx: buildFxView({ entries: PREVIOUS, sourceComplete: false }) })} density="expanded" detail />));
    expect(previousPartial).toContain("上期的折算或账目不完整");
  });
});

describe("空数据与英文", () => {
  it("没有任何账目：说明没有记录，不画 0", () => {
    for (const type of C_TYPES) {
      if (type.requiresCombined === true || type.id === "AN-P15" || type.id === "AN-A15") continue;
      const html = render(type.id, undefined, { comparisonRead: { entries: [], verified: true } }, []);
      expect(html, type.id).not.toContain("¥0.00");
    }
  });

  it("区间里只有收入：说没有记录，不说缺汇率；排名变化不误说「需要两个月」", () => {
    const incomeOnly = [entry("i1", "2026-10-03", "income", 500000, SALARY, null)];
    for (const id of ["AN-I18", "AN-A09", "AN-P01", "AN-P10", "AN-P13"]) {
      const html = render(id, undefined, {}, incomeOnly);
      expect(html, id).toContain("这段时间没有记录");
      expect(html, id).not.toContain("缺汇率");
    }
    expect(render("AN-P09", undefined, { range: { from: "2026-08-01", to: "2026-10-27" } }, incomeOnly)).not.toContain("两个月");
  });

  it("矩阵格子的短金额按币种小数位换算（JPY 12,345 显示为 12k，不是 123）", () => {
    const jpy = [entry("j1", "2026-10-02", "expense", 12345, FOOD, WECHAT, "JPY")];
    const html = render("AN-P01", undefined, { currency: "JPY", defaultCurrency: "JPY" }, jpy);
    expect(html).toContain("12k");
    expect(html).not.toContain("123");
  });

  it("英文界面：标题与说明都有译文", () => {
    applyLocale("en-US");
    const html = render("AN-A06");
    expect(html).toContain("Total expense +¥1,120.00");
  });
});

describe("1.17.12 新增读法（布局预设用，手算）", () => {
  // 本期支出：房租 1,000 / 购物 200 / 餐饮 80 / 交通 10，合计 1,290；上期（9/1–9/27）：餐饮 50 / 交通 20 / 旅行 100，合计 170。
  it("A17 增加最多：房租 +¥1,000.00（上期没有，标「新出现」）；减少最多：旅行 −¥100.00", () => {
    const rise = render("AN-A17", "top-rise");
    expect(rise).toContain("房租");
    expect(rise).toContain("+¥1,000.00");
    expect(rise).toContain("新出现");
    const fall = render("AN-A17", "top-fall");
    expect(fall).toContain("旅行");
    expect(fall).toContain("−¥100.00");
  });

  it("A17 没有方向上的变化时说明，而不是写 0", () => {
    // 本期只有一笔餐饮 10.00，上期餐饮 50.00：没有任何分类增加。
    const html = render("AN-A17", "top-rise", {}, [entry("only", "2026-10-02", "expense", 1000, FOOD, WECHAT)]);
    expect(html).toContain("没有比上期增加的分类");
    expect(html).not.toContain("¥0.00");
  });

  it("A06 要点：支出比上期多 ¥1,120.00（658.8%）；增加最多的是「房租」，多了 ¥1,000.00", () => {
    const html = render("AN-A06", "insights");
    expect(html).toContain("支出比上期多 ¥1,120.00（658.8%）");
    expect(html).toContain("增加最多的是「房租」，多了 ¥1,000.00");
  });

  it("A10 第 90 百分位：Type 7，h = 1 + 7 × 0.9 = 7.3 → 200 + 0.3 × 800 = ¥440.00，8 笔样本较少", () => {
    const html = render("AN-A10", "p90");
    expect(html).toContain("¥440.00");
    expect(html).toContain("共 8 笔");
    expect(html).toContain("样本较少");
  });

  it("P06 支出流向：支出总额 ¥1,290.00 → 4 个分类（shared 层级桑基守恒）", () => {
    const html = render("AN-P06", "sankey");
    expect(html).toContain("支出总额 ¥1,290.00 → 4 个分类");
    expect(html).toContain("分类目前只有一层");
  });

  it("P16 数据状态：9 笔、1 种币种、数据完整；本机覆盖不完整时如实说明", () => {
    const html = render("AN-P16", "status");
    expect(html).toContain("9 笔");
    expect(html).toContain("数据完整");
    expect(html).toContain("1 种币种");
    expect(render("AN-P16", "status", { rangeSourceComplete: false })).toContain("本机数据不完整");
  });

  it("P19 汇率覆盖：原币模式说明只在综合折算下有意义；全部人民币时「无需折算」", () => {
    expect(render("AN-P19", "status")).toContain("综合折算");
    const combined = text(renderToStaticMarkup(<CardBody card={card("AN-P19", "status")} scope={scope(ENTRIES, { combined: true, fx: buildFxView({ entries: ENTRIES }) })} density="expanded" detail />));
    expect(combined).toContain("无需折算");
  });
});

describe("1.17.12 A01 的两种新读法（手算）", () => {
  it("较上期变化：本期支出 ¥1,290.00 对上期 ¥170.00 → +658.8%", () => {
    const html = render("AN-A01", "number");
    expect(html).toContain("+658.8%");
    expect(html).toContain("上期 ¥170.00 → 本期 ¥1,290.00");
  });

  it("上期未完整读取：不给增幅，说明原因", () => {
    const html = render("AN-A01", "number", { comparisonRead: { entries: PREVIOUS, verified: false } });
    expect(html).not.toContain("%");
    expect(html).toContain("—");
  });

  it("累计对比：两期合计写在上方，图里有两条线", () => {
    const html = renderToStaticMarkup(<CardBody card={card("AN-A01", "cumulative-compare")} scope={scope(ENTRIES)} density="expanded" detail />);
    expect(text(html)).toContain("本期 ¥1,290.00 · 上期同期 ¥170.00");
    expect((html.match(/<path /g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("1.17.12 A01 新读法 · 综合折算", () => {
  const combinedScope = () => scope(ENTRIES, { combined: true, fx: buildFxView({ entries: ENTRIES }), previousFx: buildFxView({ entries: PREVIOUS }) });
  it("较上期变化与累计对比在综合折算下同样手算一致", () => {
    const number = text(renderToStaticMarkup(<CardBody card={card("AN-A01", "number")} scope={combinedScope()} density="expanded" detail />));
    expect(number).toContain("+658.8%");
    const cumulative = text(renderToStaticMarkup(<CardBody card={card("AN-A01", "cumulative-compare")} scope={combinedScope()} density="expanded" detail />));
    expect(cumulative).toContain("本期 ¥1,290.00 · 上期同期 ¥170.00");
    for (const html of [number, cumulative]) for (const bad of ["NaN", "undefined", "Infinity"]) expect(html).not.toContain(bad);
  });
});
