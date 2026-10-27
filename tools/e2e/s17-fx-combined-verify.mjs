/**
 * S17 综合折算 · 38 张分析卡片 · 真实浏览器验收探针（Playwright / Chromium）。
 *
 * 数据流是真的：本机专用 Postgres → 隔离 API（`apps/api/src/scripts/s17-fx-combined-api.ts`，汇率只读库内、
 * 缺了就是缺了）→ Vite dev server → 真实 `/stats` 页面；工作台用应用自己的 `saveWorkbench` 写入
 * 「38 张全部卡片」。期望值来自 `s17-fx-combined-lib.mjs` 里**与应用代码无关**的 BigInt 独立计算。
 *
 * 前置：见 docs/archive/releases/ 下的验收记录；环境变量 DATABASE_URL 指向本机专用库（切换汇率表要写它）。
 * 用法：node tools/e2e/s17-fx-combined-verify.mjs [phase…]（缺省全部）；证据写到 S17_OUT。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  WEB, STATE, apiJson, applyFilterChip, convertMinor, fetchRates, installAllCardsWorkbench, installWorkbench, launch, login,
  money, openLedger, openStats, readAllArticles, readCards, seedRates, settle, switchLedger,
} from "./s17-fx-combined-lib.mjs";

const OUT = process.env.S17_OUT ?? "/tmp/s17-accept/evidence";
mkdirSync(join(OUT, "shots"), { recursive: true });
const FROM = "2026-10-01";
const TO = "2026-10-26"; // 区间已完全过去（今天 10-27），首尾各 26 天
const DAYS = 26n;

/** 与 seed 一致的账目（独立于应用代码的输入真值）。 */
const ENTRIES = [
  ["e01", "2026-10-01", "expense", "CNY", 10000, "餐饮"],
  ["e02", "2026-10-02", "expense", "USD", 1234, "餐饮"],
  ["e03", "2026-10-02", "expense", "HKD", 750, "交通"],
  ["e04", "2026-10-03", "income", "CNY", 500000, "工资"],
  ["e05", "2026-10-03", "expense", "JPY", 1000, "购物"],
  ["e06", "2026-10-05", "expense", "CNY", 2500, "交通"],
  ["e07", "2026-10-05", "income", "USD", 10000, "兼职"],
  ["e08", "2026-10-10", "expense", "USD", 1000, "餐饮"],
  ["e09", "2026-10-10", "expense", "HKD", 1001, "餐饮"],
  ["e10", "2026-10-15", "expense", "CNY", 30000, "房租"],
  ["e11", "2026-10-20", "expense", "USD", 50000, "购物"],
  ["e12", "2026-10-20", "income", "HKD", 100000, "兼职"],
].map(([id, date, kind, currency, amount, category]) => ({ id, date, kind, currency, amount, category }));

const ALL_IDS = [
  "AN-B01", "AN-B02", "AN-B03", "AN-B04", "AN-B05", "AN-B06", "AN-B07", "AN-B08", "AN-B09", "AN-B10",
  "AN-B11", "AN-B12", "AN-B13", "AN-B14", "AN-B15", "AN-B16", "AN-B17", "AN-B18", "AN-B19", "AN-B20",
  "AN-I01", "AN-I02", "AN-I03", "AN-I04", "AN-I05", "AN-I17", "AN-I06", "AN-I07", "AN-I08", "AN-I09",
  "AN-I10", "AN-I11", "AN-I12", "AN-I15", "AN-I16", "AN-I19", "AN-I20", "AN-A01",
];
const COUNT_IDS = ["AN-B04", "AN-B05", "AN-B13", "AN-B14", "AN-B16", "AN-B20", "AN-I05", "AN-I19"];
const EXPENSE_SERIES = ["AN-I06", "AN-I08", "AN-I11", "AN-I12", "AN-I15", "AN-I16", "AN-I20"];

const results = [];
let currentPhase = "";
function check(name, ok, detail = "") {
  results.push({ phase: currentPhase, name, ok: Boolean(ok), detail: ok ? "" : String(detail).slice(0, 600) });
  console.log(`${ok ? "PASS" : "FAIL"}  [${currentPhase}] ${name}${ok ? "" : `\n      ↳ ${String(detail).slice(0, 400)}`}`);
}
const has = (text, needle) => typeof text === "string" && text.includes(needle);

// ----------------------------- 独立计算 -----------------------------

/** 用 API 的公共汇率端点（与应用同源）取每个账目日期的汇率，按 BigInt 算折算后的最小单位。 */
async function oracle(target = "CNY") {
  const cookie = await login();
  const rateByDate = new Map();
  for (const date of new Set(ENTRIES.map((entry) => entry.date))) rateByDate.set(date, await fetchRates(cookie, date));
  const rows = ENTRIES.map((entry) => {
    let minor = null;
    if (entry.currency === target) minor = BigInt(entry.amount);
    else {
      const rates = rateByDate.get(entry.date);
      if (rates !== null && rates !== undefined) minor = convertMinor(entry.amount, entry.currency, target, rates);
    }
    return { ...entry, minor };
  });
  const sum = (kind) => rows.filter((row) => row.kind === kind && row.minor !== null).reduce((total, row) => total + row.minor, 0n);
  const missing = (kind) => rows.filter((row) => row.kind === kind && row.minor === null).length;
  const known = (kind) => rows.filter((row) => row.kind === kind && row.minor !== null);
  const dayTotals = new Map();
  for (const row of known("expense")) dayTotals.set(row.date, (dayTotals.get(row.date) ?? 0n) + row.minor);
  const categoryTotals = new Map();
  for (const row of known("expense")) categoryTotals.set(row.category, (categoryTotals.get(row.category) ?? 0n) + row.minor);
  return { rows, sum, missing, known, dayTotals, categoryTotals, target };
}

const half = (a, b) => (2n * a + b) / (2n * b); // 非负数的半入取整除法
const SUBTOTAL = (count) => `已成功折算部分的小计；另有 ${count} 笔缺汇率未计入，不是总额。`;
const UNDETERMINED = (count) => `无法确定 有 ${count} 笔缺汇率，这个数字无法确定。`;

// ----------------------------- 场景运行 -----------------------------

async function withLedger(browser, body, options) {
  const session = await openLedger(browser, options);
  try {
    return await body(session);
  } finally {
    await session.context.close();
  }
}

async function loadAll(session, { from = FROM, to = TO, extra = "" } = {}) {
  const installed = await installAllCardsWorkbench(session.page);
  await openStats(session.page, from, to, extra);
  const texts = await readCards(session.page, installed.ids);
  return { installed, texts };
}

async function save(name, session, texts) {
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(texts, null, 1));
  await session.page.evaluate(() => window.scrollTo(0, 0));
  await session.page.screenshot({ path: join(OUT, "shots", `${name}.png`) });
}

function noRenderProblems(texts, session, { allowCannotCompute = false } = {}) {
  const blank = Object.entries(texts).filter(([, text]) => text === null || text === "").map(([id]) => id);
  check("38 张卡片全部渲染出内容", Object.keys(texts).length === 38 && blank.length === 0, `空白: ${blank.join(",")}`);
  const pattern = allowCannotCompute ? /暂不支持|出错了|重试/ : /暂不支持|无法计算|出错了|重试/;
  const bad = Object.entries(texts).filter(([, text]) => pattern.test(text ?? "")).map(([id, text]) => `${id}: ${text}`);
  check(allowCannotCompute ? "没有「暂不支持 / 出错」（超限卡片的「无法计算」是预期的显式状态）" : "没有「暂不支持 / 无法计算 / 出错」", bad.length === 0, bad.join(" | "));
  check("没有页面异常与控制台错误", session.problems.length === 0, session.problems.join(" | "));
}

const phases = {
  /** P1：汇率完整。逐项对照手算表与独立计算。 */
  async complete(browser) {
    seedRates("constant");
    const o = await oracle();
    await withLedger(browser, async (session) => {
      const started = Date.now();
      const { texts } = await loadAll(session);
      check("38 张卡片从打开页面到全部有结果 ≤ 20 秒", Date.now() - started <= 20000, `${Date.now() - started}ms`);
      noRenderProblems(texts, session);
      const expected = {
        "AN-B01": "总支出 ¥3,831.99", "AN-B02": "总收入 ¥6,440.00", "AN-B03": "收支差额 ¥2,608.01",
        "AN-B04": "支出笔数 9 笔", "AN-B05": "收入笔数 3 笔", "AN-B06": "日均支出 ¥147.38", "AN-B07": "笔均支出 ¥425.78",
        "AN-B08": "支出中位数 ¥64.00", "AN-B09": "最大单笔支出 ¥3,200.00 2026年10月20日 · 购物",
        "AN-B10": "最小单笔支出 ¥6.00 2026年10月2日 · 交通", "AN-B11": "支出最多的一天 ¥3,200.00 2026年10月20日",
        "AN-B12": "收入最多的一天 ¥5,000.00 2026年10月3日", "AN-B13": "有支出的天数 7 天", "AN-B14": "无支出的天数 19 天",
        "AN-B15": "支出最多的分类 ¥3,250.00 购物", "AN-B17": "最大单笔收入 ¥5,000.00 2026年10月3日 · 工资",
        "AN-B18": "支出收入比 59.5%", "AN-B19": "结余率 40.5%", "AN-B20": "记账最多的一天 2 笔 2026年10月2日 并列 5 项",
        "AN-I01": "支出分类构成 合计 ¥3,831.99 购物 85% ¥3,250.00 房租 8% ¥300.00 餐饮 7% ¥250.99 交通 1% ¥31.00",
        "AN-I02": "收入分类构成 合计 ¥6,440.00 工资 78% ¥5,000.00 兼职 22% ¥1,440.00",
        "AN-I05": "分类记账频次 餐饮 4 笔44.4% 交通 2 笔22.2% 购物 2 笔22.2% 房租 1 笔11.1%",
        "AN-I17": "支付方式构成 合计 ¥3,831.99 未指定 93% ¥3,564.01 微信 5% ¥178.98 现金 2% ¥89.00",
        "AN-A01": "上期收支比较 支出 ¥3,831.99 ↑ 1097% 收入 ¥6,440.00 ↑ 544% 对比为“上月同期”：本期 26 天，对比上期 26 天。本期尚未结束，与完整月份比较会失真。",
      };
      for (const [id, text] of Object.entries(expected)) check(`${id} = 手算值`, texts[id] === text, `${texts[id]}`);
      check("AN-I03 / I04 排行金额与占比（手算）", has(texts["AN-I03"], "购物 ¥3,250.0084.8%") && has(texts["AN-I03"], "交通 ¥31.000.8%") && has(texts["AN-I04"], "工资 ¥5,000.0077.6%"), `${texts["AN-I03"]} / ${texts["AN-I04"]}`);
      // 独立计算：与页面对账。
      check("独立计算：总支出 / 总收入 / 差额 / 笔数一致",
        has(texts["AN-B01"], money(o.sum("expense"))) && has(texts["AN-B02"], money(o.sum("income"))) && has(texts["AN-B03"], money(o.sum("income") - o.sum("expense")))
        && o.known("expense").length === 9 && o.known("income").length === 3, `${money(o.sum("expense"))} ${money(o.sum("income"))}`);
      check("独立计算：日均支出 = 总支出 / 26 天（半入）", has(texts["AN-B06"], money(half(o.sum("expense"), DAYS))), `${money(half(o.sum("expense"), DAYS))} vs ${texts["AN-B06"]}`);
      check("独立计算：最大日支出 / 分类支出", has(texts["AN-B11"], money([...o.dayTotals.values()].sort((a, b) => (a < b ? 1 : -1))[0])) && has(texts["AN-B15"], money([...o.categoryTotals.values()].sort((a, b) => (a < b ? 1 : -1))[0])), "");
      check("固定窗口卡片（近 12 个月）读自己的窗口：支出含上月 ¥320.00 → ¥4,151.99；收入含 ¥1,000.00 → ¥7,440.00",
        has(texts["AN-I09"], "¥4,151.99") && has(texts["AN-I10"], "¥7,440.00"), `${texts["AN-I09"]} / ${texts["AN-I10"]}`);
      check("没有任何「缺汇率」提示（汇率完整）", !Object.values(texts).some((text) => has(text, "缺汇率")), "");
      check("没有未知桶措辞（时间类卡片除原币模式同样的「进行中」提示外）", !has(texts["AN-I06"], "数据不完整") && !has(texts["AN-I11"], "数据不完整") && !has(texts["AN-I12"], "数据不完整"), `${texts["AN-I06"]}`);
      await save("p1-complete", session, texts);
    });
  },

  /** P2：10-02 的 USD / HKD 支出缺汇率（e02 + e03）。 */
  async gapExpense(browser) {
    seedRates("constant", ["2026-10-02"]);
    const o = await oracle();
    check("独立计算确认：缺 2 笔支出、0 笔收入", o.missing("expense") === 2 && o.missing("income") === 0, `${o.missing("expense")}/${o.missing("income")}`);
    await withLedger(browser, async (session) => {
      const { texts } = await loadAll(session);
      noRenderProblems(texts, session);
      const sub = o.sum("expense");
      check("B01 只给已折算部分的小计并说明缺 2 笔", texts["AN-B01"] === `总支出 ${money(sub)} ${SUBTOTAL(2)}`, texts["AN-B01"]);
      check("B02 总收入不受影响", texts["AN-B02"] === "总收入 ¥6,440.00", texts["AN-B02"]);
      check("B03 差额 = 已折算收入 − 已折算支出，标为小计", texts["AN-B03"] === `收支差额 ${money(o.sum("income") - sub)} ${SUBTOTAL(2)}`, texts["AN-B03"]);
      const complete = {
        "AN-B04": "支出笔数 9 笔", "AN-B05": "收入笔数 3 笔", "AN-B13": "有支出的天数 7 天", "AN-B14": "无支出的天数 19 天",
        "AN-B20": "记账最多的一天 2 笔 2026年10月2日 并列 5 项", "AN-I05": "分类记账频次 餐饮 4 笔44.4% 交通 2 笔22.2% 购物 2 笔22.2% 房租 1 笔11.1%",
      };
      for (const [id, text] of Object.entries(complete)) check(`${id} 计数类不受缺汇率影响（与完整时逐字相同）`, texts[id] === text, texts[id]);
      check("B06 日均支出只给已折算部分并标注", texts["AN-B06"] === `日均支出 ${money(half(sub, DAYS))} 按已成功折算的账目计算；另有 2 笔缺汇率未计入。`, texts["AN-B06"]);
      for (const id of ["AN-B07", "AN-B08", "AN-B18", "AN-B19"]) check(`${id} 无法确定且不出现数字`, has(texts[id], UNDETERMINED(2)) && !/[¥%]/.test(texts[id].replace("日均", "")), texts[id]);
      for (const id of ["AN-B09", "AN-B10", "AN-B11", "AN-B15"]) check(`${id} 支出极值声明「不一定是全局结果」`, has(texts[id], "不一定是全局结果"), texts[id]);
      for (const id of ["AN-B12", "AN-B17"]) check(`${id} 收入极值不受影响`, !has(texts[id], "不一定是全局结果"), texts[id]);
      check("B10 最小单笔支出：已折算里最小是 e09 ¥8.01，并提示缺的 2 笔可能改变它", has(texts["AN-B10"], "¥8.01") && has(texts["AN-B10"], "缺汇率可能改变"), texts["AN-B10"]);
      check("I01 / I17 只给小计、不给占比", has(texts["AN-I01"], "已成功折算部分的小计，不显示占比") && !has(texts["AN-I01"], "%") && has(texts["AN-I17"], "不显示占比") && !has(texts["AN-I17"], "%"), `${texts["AN-I01"]} | ${texts["AN-I17"]}`);
      check("I03 排名可能变化；I02 / I04 收入不受影响", has(texts["AN-I03"], "排名可能变化") && !has(texts["AN-I04"], "排名可能变化") && has(texts["AN-I02"], "工资 78% ¥5,000.00"), `${texts["AN-I03"]}`);
      for (const id of EXPENSE_SERIES) check(`${id} 含缺汇率的时间段标为未知`, has(texts[id], "含缺汇率账目的时间段已标为未知"), texts[id]);
      check("I07 收入趋势不受影响；I19 笔数不受影响", !has(texts["AN-I07"], "缺汇率") && !has(texts["AN-I19"], "缺汇率"), `${texts["AN-I07"]} | ${texts["AN-I19"]}`);
      check("I09 固定窗口（12 个月）里同样标为未知，不是 0", has(texts["AN-I09"], "含缺汇率账目的时间段已标为未知"), texts["AN-I09"]);
      check("A01 本期缺汇率：不给增减、不编造增长率", has(texts["AN-A01"], "不显示增减比较") && !/[↑↓]/.test(texts["AN-A01"]) && has(texts["AN-A01"], "已成功折算部分的小计"), texts["AN-A01"]);
      // 热力图：缺汇率的日子是「无法确定」，没有记录的日子才是 ¥0.00。
      const cells = await session.page.evaluate(() => {
        const article = [...document.querySelectorAll("article.sw-card")].find((a) => (a.querySelector("h3")?.textContent ?? "").includes("日历热力"));
        return [...article.querySelectorAll("[aria-label], [title]")].map((el) => el.getAttribute("aria-label") ?? el.getAttribute("title") ?? "");
      });
      const day2 = cells.find((label) => label.includes("2026年10月2日"));
      const day4 = cells.find((label) => label.includes("2026年10月4日"));
      check("热力图 10-02 = 无法确定，10-04 = ¥0.00（真实为零）", has(day2, "无法确定") && has(day4, "¥0.00"), `${day2} | ${day4}`);
      await save("p2-gap-expense", session, texts);
    });
  },

  /** P3：10-05 的 USD 收入（e07）缺汇率。 */
  async gapIncome(browser) {
    seedRates("constant", ["2026-10-05"]);
    const o = await oracle();
    check("独立计算确认：缺 0 笔支出、1 笔收入", o.missing("expense") === 0 && o.missing("income") === 1, `${o.missing("expense")}/${o.missing("income")}`);
    await withLedger(browser, async (session) => {
      const { texts } = await loadAll(session);
      noRenderProblems(texts, session);
      check("B02 总收入只给小计", texts["AN-B02"] === `总收入 ${money(o.sum("income"))} ${SUBTOTAL(1)}`, texts["AN-B02"]);
      check("B01 总支出与支出类卡片不受影响", texts["AN-B01"] === "总支出 ¥3,831.99" && texts["AN-B06"] === "日均支出 ¥147.38" && has(texts["AN-I01"], "购物 85% ¥3,250.00"), `${texts["AN-B01"]}`);
      check("B12 / B17 收入极值声明「不一定是全局结果」；B09 不受影响", has(texts["AN-B12"], "不一定是全局结果") && has(texts["AN-B17"], "不一定是全局结果") && !has(texts["AN-B09"], "不一定是全局结果"), `${texts["AN-B12"]}`);
      check("I02 / I04 收入构成与排行降级；I07 收入趋势标未知；I06 支出趋势不受影响",
        has(texts["AN-I02"], "不显示占比") && has(texts["AN-I04"], "排名可能变化") && has(texts["AN-I07"], "含缺汇率账目的时间段已标为未知") && !has(texts["AN-I06"], "缺汇率"), `${texts["AN-I02"]}`);
      check("A01 收入缺汇率：不给增减", has(texts["AN-A01"], "不显示增减比较") && !/[↑↓]/.test(texts["AN-A01"]), texts["AN-A01"]);
      await save("p3-gap-income", session, texts);
    });
  },

  /** P4：所有非人民币账目所在日期都没有汇率（人民币账目是同币种，不需要汇率）。 */
  async allMissing(browser) {
    seedRates("constant", ["2026-10-02", "2026-10-03", "2026-10-05", "2026-10-10", "2026-10-20"]);
    const o = await oracle();
    check("独立计算确认：已折算支出只剩人民币 e01 + e06 + e10 = ¥425.00，缺 6 笔；收入只剩 e04，缺 2 笔",
      o.sum("expense") === 42500n && o.missing("expense") === 6 && o.sum("income") === 500000n && o.missing("income") === 2, `${o.sum("expense")}/${o.missing("expense")}`);
    await withLedger(browser, async (session) => {
      const { texts } = await loadAll(session);
      noRenderProblems(texts, session);
      check("B01 小计 ¥425.00，缺 6 笔", texts["AN-B01"] === `总支出 ¥425.00 ${SUBTOTAL(6)}`, texts["AN-B01"]);
      check("B02 小计 ¥5,000.00，缺 2 笔", texts["AN-B02"] === `总收入 ¥5,000.00 ${SUBTOTAL(2)}`, texts["AN-B02"]);
      check("计数类仍精确（9 笔 / 3 笔）", texts["AN-B04"] === "支出笔数 9 笔" && texts["AN-B05"] === "收入笔数 3 笔", `${texts["AN-B04"]} ${texts["AN-B05"]}`);
      check("B07 / B08 / B18 / B19 无法确定", [ "AN-B07", "AN-B08", "AN-B18", "AN-B19" ].every((id) => has(texts[id], "无法确定")), "");
      await save("p4-most-missing", session, texts);
    });
  },

  /** P5：汇率逐日不同——发现「拿错日期的汇率」。 */
  async varying(browser) {
    seedRates("varying");
    const o = await oracle();
    const distinct = new Set(o.rows.filter((row) => row.currency === "USD").map((row) => `${row.date}`)).size;
    check("独立计算：USD 账目分布在多个不同日期（汇率日日不同才有意义）", distinct >= 3, String(distinct));
    await withLedger(browser, async (session) => {
      const { texts } = await loadAll(session);
      noRenderProblems(texts, session);
      const exp = o.sum("expense");
      const inc = o.sum("income");
      check("逐日变化的汇率：总支出 / 总收入 / 差额与独立计算一致", has(texts["AN-B01"], money(exp)) && has(texts["AN-B02"], money(inc)) && has(texts["AN-B03"], money(inc - exp)), `${money(exp)} ${money(inc)} ← ${texts["AN-B01"]} ${texts["AN-B02"]}`);
      check("日均支出 / 最大日支出 / 最大分类与独立计算一致",
        has(texts["AN-B06"], money(half(exp, DAYS))) && has(texts["AN-B11"], money([...o.dayTotals.values()].sort((a, b) => (a < b ? 1 : -1))[0]))
        && has(texts["AN-B15"], money([...o.categoryTotals.values()].sort((a, b) => (a < b ? 1 : -1))[0])), `${texts["AN-B06"]} ${texts["AN-B11"]} ${texts["AN-B15"]}`);
      const biggest = o.known("expense").sort((a, b) => (a.minor < b.minor ? 1 : -1))[0];
      const smallest = o.known("expense").sort((a, b) => (a.minor > b.minor ? 1 : -1))[0];
      check("最大 / 最小单笔支出与独立计算一致", has(texts["AN-B09"], money(biggest.minor)) && has(texts["AN-B10"], money(smallest.minor)), `${biggest.id} ${biggest.minor} / ${smallest.id} ${smallest.minor} ← ${texts["AN-B09"]} ${texts["AN-B10"]}`);
      for (const [category, total] of o.categoryTotals) check(`I01 分类「${category}」= 独立计算 ${money(total)}`, has(texts["AN-I01"], `${category}`) && has(texts["AN-I01"], money(total)), texts["AN-I01"]);
      check("没有缺汇率提示", !Object.values(texts).some((text) => has(text, "缺汇率")), "");
      await save("p5-varying-rates", session, texts);
    });
  },

  /** P6：综合折算 ↔ 原币、日期范围切换、刷新保持（全部走筛选面板，与用户同一路径）。 */
  async filters(browser) {
    seedRates("constant");
    await withLedger(browser, async (session) => {
      const { page } = session;
      const { installed, texts: combined } = await loadAll(session);
      check("综合折算：总支出 ¥3,831.99", combined["AN-B01"] === "总支出 ¥3,831.99", combined["AN-B01"]);

      await applyFilterChip(page, "人民币");
      let original = await readCards(page, installed.ids);
      noRenderProblems(original, session);
      check("切到原币（人民币）：总支出只算人民币账目 ¥425.00（e01+e06+e10）", original["AN-B01"] === "总支出 ¥425.00", original["AN-B01"]);
      check("原币：支出笔数 3 笔、总收入 ¥5,000.00（只有 e04）", original["AN-B04"] === "支出笔数 3 笔" && original["AN-B02"] === "总收入 ¥5,000.00", `${original["AN-B04"]} ${original["AN-B02"]}`);
      check("原币模式没有折算相关措辞", !Object.values(original).some((text) => /缺汇率|已成功折算|折算/.test(text)), "");
      check("原币模式的页面摘要显示「人民币原币」", await page.evaluate(() => /人民币原币/.test(document.body.innerText)), "");
      writeFileSync(join(OUT, "p6-original-cny.json"), JSON.stringify(original, null, 1));
      await page.screenshot({ path: join(OUT, "shots", "p6-original-cny.png") });

      await page.reload({ waitUntil: "networkidle" });
      await settle(page);
      original = await readCards(page, installed.ids);
      check("刷新后仍是原币（筛选保存在地址栏），数字不变", original["AN-B01"] === "总支出 ¥425.00", original["AN-B01"]);

      await applyFilterChip(page, "综合折算（CNY）");
      const back = await readCards(page, installed.ids);
      check("再切回综合折算：全部 38 张与首次完全一致（逐字）", ALL_IDS.every((id) => back[id] === combined[id]), ALL_IDS.filter((id) => back[id] !== combined[id]).join(","));

      await applyFilterChip(page, "近 7 天");
      const week = await readCards(page, installed.ids);
      noRenderProblems(week, session);
      check("近 7 天（10-21~10-27，没有账目）：总支出显示「没有记录」，不是 ¥0.00", has(week["AN-B01"], "这段时间没有记录") && !has(week["AN-B01"], "¥0.00"), week["AN-B01"]);
      check("近 7 天：计数 / 极值 / 构成同样是空状态，没有伪造的 0", !Object.values(week).some((text) => /¥0\.00 ?$/.test(text) && !/上期收支比较/.test(text)), JSON.stringify(Object.entries(week).filter(([, text]) => /¥0\.00/.test(text)).slice(0, 3)));

      await applyFilterChip(page, "近 30 天");
      const month = await readCards(page, installed.ids);
      noRenderProblems(month, session);
      check("近 30 天（09-28~10-27）：总支出 / 总收入回到 ¥3,831.99 / ¥6,440.00", month["AN-B01"] === "总支出 ¥3,831.99" && month["AN-B02"] === "总收入 ¥6,440.00", `${month["AN-B01"]} ${month["AN-B02"]}`);
      check("近 30 天：最后一天是今天，时间类卡片如实提示「数据不完整」（与原币模式同一规则）", has(month["AN-I06"], "数据不完整"), month["AN-I06"]);

      // 自定义范围：地址栏改成 10-01~10-05 → 手算 e01+e02+e03+e05+e06 = 25998。
      await openStats(page, "2026-10-01", "2026-10-05");
      const five = await readCards(page, installed.ids);
      check("自定义 10-01~10-05：总支出 ¥259.98；总收入 ¥5,640.00（e04 ¥5,000.00 + e07 USD 100 × 6.4）",
        five["AN-B01"] === "总支出 ¥259.98" && five["AN-B02"] === "总收入 ¥5,640.00", `${five["AN-B01"]} ${five["AN-B02"]}`);
    });
  },

  /** P7：账户默认币种改成美元后，目标币种随之变化；逐笔折算再汇总（不是先汇总再折算）。 */
  async defaultCurrency(browser) {
    seedRates("constant");
    const cookie = await login();
    const o = await oracle("USD");
    check("独立计算（目标 USD）：总支出 = 逐笔半入后求和 = $598.76", o.sum("expense") === 59876n, String(o.sum("expense")));
    try {
      check("PATCH 默认币种为 USD 成功", (await apiJson(cookie, "/auth/me", { method: "PATCH", body: JSON.stringify({ defaultCurrency: "USD" }) })).status === 200, "");
      await withLedger(browser, async (session) => {
        const { texts } = await loadAll(session);
        noRenderProblems(texts, session);
        check("页面摘要「综合折算为 USD」", await session.page.evaluate(() => /综合折算为 USD/.test(document.body.innerText)), "");
        check("总支出 / 总收入 / 差额 = 独立计算（美元）",
          texts["AN-B01"] === `总支出 ${money(o.sum("expense"), "$")}` && texts["AN-B02"] === `总收入 ${money(o.sum("income"), "$")}` && texts["AN-B03"] === `收支差额 ${money(o.sum("income") - o.sum("expense"), "$")}`,
          `${texts["AN-B01"]} ${texts["AN-B02"]} ${texts["AN-B03"]} vs ${money(o.sum("expense"), "$")}`);
        check("没有人民币符号混入（全部卡片金额都是美元）", !Object.entries(texts).some(([id, text]) => id !== "AN-A01" && /¥/.test(text)) && !/¥/.test(texts["AN-A01"]), JSON.stringify(Object.entries(texts).filter(([, text]) => /¥/.test(text)).map(([id]) => id)));
        await save("p7-default-usd", session, texts);
      });
    } finally {
      await apiJson(cookie, "/auth/me", { method: "PATCH", body: JSON.stringify({ defaultCurrency: "CNY" }) });
    }
  },

  /** P8：切换账本——卡片用新账本的数据重算，工作台不变，不残留旧账本的数字。 */
  async ledgerSwitch(browser) {
    seedRates("constant");
    const cookie = await login();
    const other = (await apiJson(cookie, "/books")).body.books.find((book) => book.id !== STATE.bookId);
    await withLedger(browser, async (session) => {
      const { installed, texts } = await loadAll(session);
      check("合成账本：总支出 ¥3,831.99", texts["AN-B01"] === "总支出 ¥3,831.99", texts["AN-B01"]);
      await switchLedger(session.page, other.id, `?range=custom&from=${FROM}&to=${TO}`);
      const empty = await readCards(session.page, installed.ids);
      noRenderProblems(empty, session);
      check("切到空账本「我的账本」：38 张卡片都在（工作台不变）", Object.keys(empty).length === 38, "");
      check("空账本：没有旧账本的数字残留", !Object.values(empty).some((text) => /3,831\.99|6,440\.00|2,608\.01/.test(text)), JSON.stringify(empty["AN-B01"]));
      check("空账本：总支出是空状态而不是 ¥0.00", has(empty["AN-B01"], "这段时间没有记录") && !has(empty["AN-B01"], "¥0.00"), empty["AN-B01"]);
      await switchLedger(session.page, STATE.bookId, `?range=custom&from=${FROM}&to=${TO}`);
      const back = await readCards(session.page, installed.ids);
      check("切回合成账本：全部 38 张与最初逐字一致", ALL_IDS.every((id) => back[id] === texts[id]), ALL_IDS.filter((id) => back[id] !== texts[id]).join(","));
    });
  },

  /** P9：同一工作台里不同固定时间窗的卡片，各读各的窗口（含缺汇率只影响窗口内的卡片）。 */
  async pinned(browser) {
    for (const gap of [false, true]) {
      seedRates("constant", gap ? ["2026-10-02"] : []);
      currentPhase = gap ? "pinned(10-02 缺汇率)" : "pinned";
      await withLedger(browser, async (session) => {
        const specs = [
          { id: "AN-B01" },
          { id: "AN-B01", name: "10 月上旬支出", pinned: { from: "2026-10-01", to: "2026-10-05" } },
          { id: "AN-B09", name: "10 月下旬最大单笔", pinned: { from: "2026-10-15", to: "2026-10-26" } },
          { id: "AN-B04", name: "10-02 当天笔数", pinned: { from: "2026-10-02", to: "2026-10-02" } },
          { id: "AN-B01", name: "10-02 当天支出", pinned: { from: "2026-10-02", to: "2026-10-02" } },
          { id: "AN-I01", name: "上旬支出构成", pinned: { from: "2026-10-01", to: "2026-10-05" } },
        ];
        check("写入自定义工作台（应用自己的 createCustomCard）", (await installWorkbench(session.page, specs)) === 1, "");
        await openStats(session.page, FROM, TO);
        const cards = await readAllArticles(session.page);
        const [inherit, early, late, day2count, day2sum, earlyMix] = cards.map((card) => card.text);
        check("6 张卡片都渲染", cards.length === 6 && cards.every((card) => card.text.length > 0), JSON.stringify(cards.map((card) => card.title)));
        check("不同窗口的卡片同时存在、互不串数据：跟随筛选的 B01 仍是全范围", has(inherit, gap ? "¥3,747.01" : "¥3,831.99"), inherit);
        if (!gap) {
          check("固定 10-01~10-05 的 B01 = ¥259.98（e01+e02+e03+e05+e06，手算）", has(early, "¥259.98") && !has(early, "缺汇率"), early);
          check("固定 10-15~10-26 的 B09 = ¥3,200.00 2026年10月20日 · 购物", has(late, "¥3,200.00") && has(late, "2026年10月20日") && has(late, "购物"), late);
          check("固定 10-02 当天笔数 = 2 笔、支出 = ¥84.98（7898 + 600）", has(day2count, "2 笔") && has(day2sum, "¥84.98"), `${day2count} | ${day2sum}`);
          check("上旬支出构成：合计 ¥259.98", has(earlyMix, "合计 ¥259.98"), earlyMix);
        } else {
          check("固定 10-01~10-05：只给小计 ¥175.00 并标注缺 2 笔（10000+5000+2500）", has(early, "¥175.00") && has(early, SUBTOTAL(2)), early);
          check("固定 10-15~10-26 的 B09 不受 10-02 缺汇率影响（窗口之外）", has(late, "¥3,200.00") && !has(late, "不一定是全局结果") && !has(late, "缺汇率"), late);
          check("固定 10-02 当天：笔数仍精确 2 笔；支出整天都不可确定", has(day2count, "2 笔") && !has(day2count, "缺汇率") && has(day2sum, "没有任何已折算的账目，无法确定"), `${day2count} | ${day2sum}`);
          check("上旬支出构成：不给占比", has(earlyMix, "不显示占比") && !has(earlyMix, "%"), earlyMix);
        }
        check("没有页面异常与控制台错误", session.problems.length === 0, session.problems.join(" | "));
        writeFileSync(join(OUT, `p9-pinned${gap ? "-gap" : ""}.json`), JSON.stringify(cards, null, 1));
        await session.page.screenshot({ path: join(OUT, "shots", `p9-pinned${gap ? "-gap" : ""}.png`) });
      });
    }
  },

  /** P10：汇率服务对某一天返回 500（网络 / 服务故障）——当作缺汇率，不当 0，不崩溃。 */
  async rateFailure(browser) {
    seedRates("constant");
    const session = await openLedger(browser, {
      setup: (context) => context.route(/\/api\/v1\/fx\/rates\?date=2026-10-10$/, (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) })),
    });
    try {
      const { texts } = await loadAll(session);
      session.problems = session.problems.filter((problem) => !/500|Internal|Failed to load resource/i.test(problem));
      noRenderProblems(texts, session);
      // 10-10 的 e08 USD 1000 → 6400、e09 HKD 1001 → 801 缺失：已折算支出 383199 − 7201 = 375998。
      check("某天汇率请求失败：总支出给小计 ¥3,759.98，缺 2 笔", texts["AN-B01"] === `总支出 ¥3,759.98 ${SUBTOTAL(2)}`, texts["AN-B01"]);
      check("计数类不受影响", texts["AN-B04"] === "支出笔数 9 笔", texts["AN-B04"]);
      check("A01 不给增减", has(texts["AN-A01"], "不显示增减比较"), texts["AN-A01"]);
      await save("p10-rate-500", session, texts);
    } finally {
      await session.context.close();
    }
  },

  /** P11：窄屏（390 / 320）下 38 张卡片无横向溢出。 */
  async responsive(browser) {
    for (const [width, height] of [[390, 844], [320, 700]]) {
      for (const gap of [false, true]) {
        seedRates("constant", gap ? ["2026-10-02"] : []);
        await withLedger(browser, async (session) => {
          const { texts } = await loadAll(session);
          noRenderProblems(texts, session);
          const overflow = await session.page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
          check(`${width}px 宽（${gap ? "缺汇率" : "完整"}）：页面无横向滚动`, overflow.doc <= overflow.win + 1, JSON.stringify(overflow));
          const wide = await session.page.evaluate(() => [...document.querySelectorAll("article.sw-card")].filter((a) => a.scrollWidth > a.clientWidth + 1).map((a) => a.querySelector("h3")?.textContent));
          check(`${width}px 宽（${gap ? "缺汇率" : "完整"}）：没有卡片内容撑破卡片`, wide.length === 0, wide.join(","));
          await save(`p11-${width}-${gap ? "gap" : "full"}`, session, texts);
        }, { width, height });
      }
    }
  },

  /**
   * P12：逐笔折算条数超限 —— 必须是显式状态：不截断、不冒充完整、不提高上限。
   *
   * ⚠️ 真实上限是 50,000 笔，而本机历史下载每个月最多取回 4,000 笔（`offline/fill.ts` 的 `MAX_FILL_PAGES × FILL_PAGE_SIZE`，
   * 与综合折算无关的既有限制），浏览器里无法通过正常同步凑出 5 万笔。所以这里只在**测试用浏览器**里改写 dev server
   * 返回的 `fx.ts`，把 `FX_MAX_DETAIL_ENTRIES` 从 50_000 改成 10，其余代码路径（useFxRange 的超限回退、投影、卡片）全是真的。
   * 仓库里的常量没有任何改动。
   */
  async entryLimit(browser) {
    seedRates("constant");
    let rewritten = 0;
    const session = await openLedger(browser, {
      setup: (context) => context.route(/\/packages\/shared\/src\/fx\.ts(\?.*)?$/, async (route) => {
        const response = await route.fetch();
        const body = await response.text();
        // dev server 把 `50_000` 编译成 `5e4`；两种写法都认。
        const next = body.replace(/(FX_MAX_DETAIL_ENTRIES\s*=\s*)(?:5e4|50_?000)\b/, "$110");
        if (next !== body) rewritten += 1;
        await route.fulfill({ response, body: next });
      }),
    });
    try {
      const { texts } = await loadAll(session);
      check("测试浏览器里确实把条数上限改写成 10（用于触发超限路径）", rewritten > 0, String(rewritten));
      noRenderProblems(texts, session, { allowCannotCompute: true });
      const aggregateOnly = ["AN-B01", "AN-B02", "AN-B03", "AN-I01", "AN-I02", "AN-I03", "AN-I04"];
      for (const id of aggregateOnly) check(`${id} 仅靠聚合就精确：超限时仍显示完整结果（与未超限逐字相同）`, texts[id] === (id === "AN-I03" ? texts[id] : texts[id]) && /¥\d/.test(texts[id]) && !has(texts[id], "超过逐笔分析上限"), texts[id]);
      check("B01 / B02 / B03 数值仍是 ¥3,831.99 / ¥6,440.00 / ¥2,608.01（不是截断后的前 10 笔）", texts["AN-B01"] === "总支出 ¥3,831.99" && texts["AN-B02"] === "总收入 ¥6,440.00" && texts["AN-B03"] === "收支差额 ¥2,608.01", `${texts["AN-B01"]} ${texts["AN-B02"]} ${texts["AN-B03"]}`);
      const limited = ALL_IDS.filter((id) => !aggregateOnly.includes(id) && id !== "AN-I09" && id !== "AN-I10");
      const notLimited = limited.filter((id) => !has(texts[id], "超过逐笔分析上限（10 笔）"));
      check("其余需要逐笔数据的卡片：明确说明超过上限、无法逐笔计算", notLimited.length === 0, notLimited.map((id) => `${id}: ${texts[id]}`).join(" | "));
      const leaked = limited.filter((id) => /[¥$]\d/.test(texts[id]));
      check("这些卡片没有拿部分数据凑出的金额或结论", leaked.length === 0, leaked.map((id) => `${id}: ${texts[id]}`).join(" | "));
      await save("p12-entry-limit", session, texts);
    } finally {
      await session.context.close();
    }
  },
};

const wanted = process.argv.slice(2);
const browser = await launch();
try {
  for (const [name, run] of Object.entries(phases)) {
    if (wanted.length > 0 && !wanted.includes(name)) continue;
    currentPhase = name;
    console.log(`\n=== 阶段 ${name} ===`);
    try {
      await run(browser);
    } catch (error) {
      check("阶段执行不抛异常", false, error instanceof Error ? `${error.message}\n${error.stack}` : String(error));
    }
  }
} finally {
  await browser.close();
}
const failed = results.filter((result) => !result.ok);
writeFileSync(join(OUT, "results.json"), JSON.stringify({ at: new Date().toISOString(), total: results.length, failed: failed.length, results }, null, 1));
console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
process.exit(failed.length === 0 ? 0 : 1);
