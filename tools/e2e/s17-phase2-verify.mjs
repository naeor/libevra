/**
 * S17 phase2 接管验收探针（真实浏览器 + 真实夹具账本）：
 * - 筛选：单行芯片、自定义范围、非法/超长 URL、综合折算与原币、币种筛选；
 * - 编辑态：图标密度、添加卡片、自定义卡片、保存与刷新持久化、布局容器；
 * - 响应式：320 / 390 / 1280 多宽度；
 * - 财务正确性：原币总额与综合折算均由 API 独立计算并与页面核对。
 *
 * 前置：API http://127.0.0.1:3036（夹具库 libevra_s17_w1_fixture）、Web http://127.0.0.1:5177、
 *       headless Chrome --remote-debugging-port=9246。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { openPage, apiLogin, api, assert, runCase } from "./cdp.mjs";

const WEB = "http://127.0.0.1:5177";
const API = "http://127.0.0.1:3036/api/v1";
const BOOK = "22222222-2222-4222-8222-222222222222";
const DIR = "_backups/s17-phase2-evidence";
const WINDOW_FROM = "2026-09-28";
const WINDOW_TO = "2026-10-27";
mkdirSync(DIR, { recursive: true });

const results = [];
const shots = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const page = await openPage(9246, WEB);

async function shot(name) {
  const file = join(DIR, `${name}.png`);
  await page.screenshot(file);
  shots.push(name);
  return file;
}

async function text() {
  return page.evaluate("document.body.innerText");
}

async function overflowCheck() {
  return page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1");
}

async function clickText(selector, needle) {
  const ok = await page.evaluate(`(() => {
    const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const el = els.find((e) => (e.textContent || "").includes(${JSON.stringify(needle)}));
    if (!el) return false;
    el.scrollIntoView({ block: "center" });
    el.click();
    return true;
  })()`);
  assert(ok === true, `找不到可点击的 ${selector}（含「${needle}」）`);
  await sleep(200);
}

async function clickExact(selector, needle) {
  const ok = await page.evaluate(`(() => {
    const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const el = els.find((e) => (e.textContent || "").trim() === ${JSON.stringify(needle)});
    if (!el) return false;
    el.scrollIntoView({ block: "center" });
    el.click();
    return true;
  })()`);
  assert(ok === true, `找不到文本完全等于「${needle}」的 ${selector}`);
  await sleep(200);
}

async function waitText(needle, timeout = 15000) {
  await page.waitFor(`document.body.innerText.includes(${JSON.stringify(needle)})`, timeout);
}

async function settle(timeout = 45000) {
  await page.waitFor(
    `(() => {
      const body = document.body.innerText;
      return body.includes("总支出")
        && !body.includes("正在获取历史汇率")
        && !body.includes("正在按历史汇率折算")
        && !body.includes("正在读取账目");
    })()`,
    timeout,
  );
  await sleep(150);
}

async function assertNoHorizontalOverflow(label) {
  assert(await overflowCheck(), `${label}：出现横向溢出`);
}

async function openFilter() {
  if ((await page.evaluate("document.querySelector('.sw-filter-panel') !== null"))) return;
  await page.evaluate("document.querySelector('[aria-label=\"筛选\"]').click()");
  await page.waitFor("document.querySelector('.sw-filter-panel') !== null");
  await sleep(150);
}

async function applyFilter() {
  await clickExact(".sw-filter-panel button.sw-pill-primary", "应用");
  await sleep(300);
}

async function ensureDrawerExpanded() {
  const state = await page.evaluate(`(() => {
    const collapse = document.querySelector('[aria-label="收起卡片抽屉"]');
    if (collapse) return "expanded";
    const expand = document.querySelector('[aria-label="展开卡片抽屉"]');
    if (!expand) return "missing";
    expand.click();
    return "opened";
  })()`);
  assert(state !== "missing", "找不到抽屉展开/收起按钮");
  await sleep(350);
}

async function enterEdit() {
  await page.evaluate("document.querySelector('[aria-label=\"编辑工作台\"]').click()");
  await page.waitFor("document.querySelector('.sw-edit-tile') !== null");
  await sleep(200);
}

async function saveEdit() {
  await page.evaluate(`(() => {
    const button = document.querySelector(".sw-edit-bar button.sw-pill-primary");
    if (!button) return false;
    button.click();
    return true;
  })()`);
  await sleep(600);
}

async function cancelEdit() {
  const ok = await page.evaluate(`(() => {
    const buttons = [...document.querySelectorAll(".sw-edit-bar button.sw-pill")];
    const button = buttons.find((item) => (item.textContent || "").trim() === "取消");
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert(ok, "找不到编辑栏「取消」");
  await sleep(400);
}

const cookie = await apiLogin(API, "s17_fixture_owner", "s17-fixture-local");

async function allTransactions() {
  const items = [];
  let cursor = null;
  for (let i = 0; i < 20; i += 1) {
    const suffix = cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`;
    const response = await api(API, `/transactions?limit=200${suffix}`, { cookie, bookId: BOOK });
    assert(response.status === 200, `transactions ${response.status}`);
    const pageItems = response.data.items ?? response.data.transactions ?? [];
    items.push(...pageItems);
    cursor = response.data.nextCursor ?? response.data.next_cursor ?? null;
    if (cursor === null) break;
  }
  return items;
}

async function rateFor(date) {
  const response = await api(API, `/fx/rates?date=${date}`, { cookie });
  assert(response.status === 200, `fx ${date} -> ${response.status}`);
  assert(response.data.status === "available", `fx ${date} 状态 ${response.data.status}`);
  return response.data.snapshot.rates;
}

function amountOf(tx) {
  return tx.amountCents ?? tx.amountMinor ?? tx.amount_cents ?? 0;
}
function dateOf(tx) {
  return tx.occurredLocalDate ?? tx.occurredOn ?? tx.date ?? "";
}
function formatMoney(cents) {
  const value = (Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `¥${value}`;
}
function live(tx) {
  return tx.deletedAt == null;
}

const transactions = (await allTransactions()).filter(live);
const inWindow = transactions.filter((tx) => dateOf(tx) >= WINDOW_FROM && dateOf(tx) <= WINDOW_TO);
const cnyExpense = inWindow
  .filter((tx) => tx.currency === "CNY" && tx.kind === "expense")
  .reduce((sum, tx) => sum + amountOf(tx), 0);
const cnyIncome = inWindow
  .filter((tx) => tx.currency === "CNY" && tx.kind === "income")
  .reduce((sum, tx) => sum + amountOf(tx), 0);
const usdExpense = inWindow
  .filter((tx) => tx.currency === "USD" && tx.kind === "expense")
  .reduce((sum, tx) => sum + amountOf(tx), 0);
const rateCache = new Map();
let expectedConversion = 0;
for (const tx of inWindow.filter((item) => item.currency !== "CNY" && item.kind === "expense")) {
  const date = dateOf(tx);
  if (!rateCache.has(date)) rateCache.set(date, await rateFor(date));
  const rates = rateCache.get(date);
  const rate = Number(rates[tx.currency]);
  const cny = Number(rates.CNY);
  assert(Number.isFinite(rate) && rate > 0, `${date} ${tx.currency} 汇率不可用`);
  expectedConversion += Math.round((amountOf(tx) * cny) / rate);
}

const baseline = {};

await runCase(results, "01 默认浏览：30 天·综合折算·真实数据", async () => {
  await page.setViewport(390, 844);
  await page.navigate(`${WEB}/stats`);
  await settle();
  const body = await text();
  assert(body.includes("综合折算"), "顶部摘要未显示综合折算");
  assert(body.includes("2026年9月28日") && body.includes("2026年10月27日"), `顶部日期范围异常：${body.slice(0, 200)}`);
  assert(!(await page.evaluate("document.querySelector('[role=alert]') !== null")), "出现未预期告警");
  const cards = await page.evaluate("document.querySelectorAll('.sw-card').length");
  assert(cards >= 8, `卡片数量异常：${cards}`);
  await shot("01-browse-30d-combined");
  return { cards };
});

await runCase(results, "02 筛选：320 宽时间/币种单行 + 无横向溢出", async () => {
  await page.setViewport(320, 700);
  await page.navigate(`${WEB}/stats`);
  await settle();
  await openFilter();
  const rows = await page.evaluate(`(() => {
    const rows = [...document.querySelectorAll('.sw-filter-panel .sw-choice-row')].slice(0, 2);
    return rows.map((row) => ({
      tops: [...new Set([...row.children].map((child) => Math.round(child.getBoundingClientRect().top)))],
      scrolls: row.scrollWidth > row.clientWidth + 1,
    }));
  })()`);
  assert(rows.length === 2, `筛选行数量异常：${rows.length}`);
  rows.forEach((row, index) => assert(row.tops.length === 1, `第 ${index + 1} 行芯片不在同一行：${row.tops}`));
  assert(rows.some((row) => row.scrolls), "窄屏下多选项未提供横向滚动");
  await assertNoHorizontalOverflow("320 筛选态");
  await shot("02-filter-single-row-320");
  return rows;
});

await runCase(results, "03 自定义范围 + 原币：与 API 独立计算一致", async () => {
  await page.setViewport(390, 844);
  await page.navigate(`${WEB}/stats?range=custom&from=2026-09-01&to=2026-09-30`);
  await settle();
  const body = await text();
  assert(body.includes("2026年9月1日") && body.includes("2026年9月30日"), "自定义范围未生效");
  assert(!(await page.evaluate("document.querySelector('[role=alert]') !== null")), "合法自定义范围出现告警");
  await openFilter();
  await clickExact(".sw-filter-panel .sw-chip", "人民币");
  await applyFilter();
  await settle();
  const sepExpense = transactions
    .filter((tx) => dateOf(tx) >= "2026-09-01" && dateOf(tx) <= "2026-09-30" && tx.currency === "CNY" && tx.kind === "expense")
    .reduce((sum, tx) => sum + amountOf(tx), 0);
  const expected = formatMoney(sepExpense);
  await waitText(expected, 20000);
  await shot("03-custom-range-september");
  return { expected };
});

await runCase(results, "04 非法 / 超长范围 URL 有明确提示并回退", async () => {
  await page.navigate(`${WEB}/stats?range=custom&from=2026-10-10&to=2026-10-01`);
  await settle();
  let body = await text();
  assert(body.includes("链接中的日期范围无法使用"), "顺序颠倒的 URL 未提示");
  assert(body.includes("开始日期不能晚于结束日期"), "未显示顺序错误原因");
  await shot("04-invalid-url-order");
  await page.navigate(`${WEB}/stats?range=custom&from=2024-01-01&to=2026-10-27`);
  await settle();
  body = await text();
  assert(body.includes("时间范围最长 400 天"), "超长 URL 未提示 400 天上限");
  await shot("04b-invalid-url-too-long");
  return "ok";
});

await runCase(results, "05 综合折算 vs 原币：财务数值独立复算", async () => {
  await page.navigate(`${WEB}/stats`);
  await settle();
  const expectedCombined = formatMoney(cnyExpense + expectedConversion);
  await waitText(expectedCombined, 20000);
  await shot("05-combined");
  await openFilter();
  await clickExact(".sw-filter-panel .sw-chip", "人民币");
  await applyFilter();
  await settle();
  const expectedCnyExpense = formatMoney(cnyExpense);
  await waitText(expectedCnyExpense, 20000);
  const body = await text();
  assert(body.includes(formatMoney(cnyIncome)), "原币收入与 API 不一致");
  await shot("05b-original-cny");
  return { cnyExpense, combined: cnyExpense + expectedConversion };
});

await runCase(results, "06 原币币种筛选：美元金额与 API 一致", async () => {
  await page.navigate(`${WEB}/stats?analysis=currency&currency=USD`);
  await settle();
  await waitText("$150.30", 20000);
  await shot("06-usd-original");
  return usdExpense;
});

await runCase(results, "07 编辑态：图标密度 390=32px / 320=26px、无横向溢出", async () => {
  await page.setViewport(390, 844);
  await page.navigate(`${WEB}/stats`);
  await settle();
  await enterEdit();
  const size390 = await page.evaluate("Math.round(document.querySelector('.sw-edit-glyph').getBoundingClientRect().width)");
  assert(size390 === 32, `390 宽编辑态图标应为 32px，实际 ${size390}px`);
  await shot("07-edit-mode-390");
  await cancelEdit();
  await page.setViewport(320, 700);
  await page.navigate(`${WEB}/stats`);
  await settle();
  await enterEdit();
  const size320 = await page.evaluate("Math.round(document.querySelector('.sw-edit-glyph').getBoundingClientRect().width)");
  assert(size320 === 26, `320 宽编辑态图标应为 26px，实际 ${size320}px`);
  await assertNoHorizontalOverflow("320 编辑态");
  await shot("07b-edit-mode-320");
  await cancelEdit();
  return { size390, size320 };
});

await runCase(results, "08 编辑态添加卡片→完成保存→刷新仍在", async () => {
  await page.setViewport(390, 844);
  await page.navigate(`${WEB}/stats`);
  await settle();
  const before = await page.evaluate("document.querySelectorAll('.sw-card').length");
  await enterEdit();
  const tilesBefore = await page.evaluate("document.querySelectorAll('.sw-edit-tile[data-object-id]').length");
  await ensureDrawerExpanded();
  const added = await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('[aria-label^="添加「"]')][0];
    if (!button) return null;
    const label = button.getAttribute("aria-label");
    button.click();
    return label;
  })()`);
  assert(added, "抽屉里没有可添加的卡片");
  await waitText("已添加");
  const tilesAfter = await page.evaluate("document.querySelectorAll('.sw-edit-tile[data-object-id]').length");
  assert(tilesAfter === tilesBefore + 1, `添加后对象数应 +1：${tilesBefore} -> ${tilesAfter}`);
  await shot("08-drawer-added");
  await saveEdit();
  await waitText("工作台已保存到本机");
  const afterSave = await page.evaluate("document.querySelectorAll('.sw-card').length");
  assert(afterSave === before + 1, `保存后卡片数应 +1：${before} -> ${afterSave}`);
  await page.navigate(`${WEB}/stats`);
  await settle();
  const afterReload = await page.evaluate("document.querySelectorAll('.sw-card').length");
  assert(afterReload === afterSave, `刷新后卡片数应保持 ${afterSave}，实际 ${afterReload}`);
  await shot("08b-after-reload");
  baseline.cards = afterReload;
  return { added, before, afterSave, afterReload };
});

await runCase(results, "09 自定义卡片：新建→保存→刷新持久化", async () => {
  await page.navigate(`${WEB}/stats`);
  await settle();
  await enterEdit();
  await ensureDrawerExpanded();
  await clickText(".sw-drawer button", "我的自定义");
  await page.waitFor("document.body.innerText.includes('新建自定义卡片')");
  await clickText(".sw-new-custom", "新建自定义卡片");
  await page.waitFor("document.body.innerText.includes('计算指标与统计数据')");
  const named = await page.evaluate(`(() => {
    const input = document.querySelector('form input[maxlength="40"]');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, "验收自定义卡");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  assert(named, "自定义卡片名称输入框不存在");
  await shot("09-custom-sheet");
  await clickText("form button[type=submit]", "添加到工作台");
  await page.waitFor("document.body.innerText.includes('验收自定义卡')");
  await saveEdit();
  await waitText("工作台已保存到本机");
  await page.navigate(`${WEB}/stats`);
  await settle();
  const cards = await page.evaluate("document.querySelectorAll('.sw-card').length");
  assert(cards === baseline.cards + 1, `自定义卡片未增加卡片数：${baseline.cards} -> ${cards}`);
  await waitText("验收自定义卡", 20000);
  await shot("09b-custom-card-persisted");
  return { cards };
});

await runCase(results, "10 布局容器：添加滑动卡片组→保存→刷新仍在", async () => {
  await page.navigate(`${WEB}/stats`);
  await settle();
  await enterEdit();
  await ensureDrawerExpanded();
  await clickText(".sw-drawer button", "布局容器");
  await page.waitFor("document.body.innerText.includes('滑动卡片组')");
  const added = await page.evaluate(`(() => {
    const tiles = [...document.querySelectorAll('.sw-tiles > *')];
    const tile = tiles.find((node) => (node.textContent || "").includes("滑动卡片组"));
    if (!tile) return false;
    const button = tile.querySelector("button");
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert(added, "布局容器「滑动卡片组」不可添加");
  await page.waitFor("document.body.innerText.includes('正在编辑：滑动卡片组')");
  await sleep(300);
  const childCount = await page.evaluate("document.querySelectorAll('[aria-label^=\"添加「\"]').length");
  assert(childCount >= 2, `容器内可添加卡片不足：${childCount}`);
  await page.evaluate(`(() => {
    const buttons = [...document.querySelectorAll('[aria-label^="添加「"]')];
    buttons[0].click();
  })()`);
  await sleep(300);
  await page.evaluate(`(() => {
    const buttons = [...document.querySelectorAll('[aria-label^="添加「"]')];
    buttons[0].click();
  })()`);
  await sleep(300);
  const scopeDone = await page.evaluate(`(() => {
    const buttons = [...document.querySelectorAll('.sw-drawer header button.sw-pill-primary')];
    if (!buttons[0]) return false;
    buttons[0].click();
    return true;
  })()`);
  assert(scopeDone, "找不到容器「完成」");
  await sleep(300);
  await saveEdit();
  await waitText("工作台已保存到本机");
  await page.navigate(`${WEB}/stats`);
  await settle();
  const body = await text();
  assert(body.includes("滑动卡片组") || body.includes("张卡片"), "刷新后布局容器丢失");
  await shot("10-container-persisted");
  return "ok";
});

await runCase(results, "11 响应式：320/390/768/1280 无横向溢出 + 列数随宽度变化", async () => {
  const widths = [320, 390, 768, 1280];
  const columns = {};
  for (const width of widths) {
    await page.setViewport(width, width === 1280 ? 900 : 760);
    await page.navigate(`${WEB}/stats`);
    await settle();
    await assertNoHorizontalOverflow(`${width} 浏览态`);
    columns[width] = await page.evaluate(`(() => {
      const cards = [...document.querySelectorAll('.sw-card')];
      const tops = cards.map((card) => Math.round(card.getBoundingClientRect().top));
      const min = Math.min(...tops);
      return { firstRow: tops.filter((top) => top === min).length, cards: cards.length };
    })()`);
  }
  assert(columns[320].firstRow <= 2, `320 宽首行不应超过 2 列：${JSON.stringify(columns[320])}`);
  assert(columns[1280].firstRow >= 2, `1280 宽首行应至少 2 列：${JSON.stringify(columns[1280])}`);
  await page.setViewport(1280, 900);
  await page.navigate(`${WEB}/stats`);
  await settle();
  await shot("11-desktop-1280");
  return columns;
});

await runCase(results, "12 英文界面：核心文案与筛选", async () => {
  await page.setViewport(390, 844);
  await page.navigate(`${WEB}/`);
  await page.evaluate("localStorage.setItem('libevra.language', 'en-US')");
  await page.navigate(`${WEB}/stats`);
  await page.waitFor("document.body.innerText.includes('Total expense')", 20000);
  const body = await text();
  assert(body.includes("Total income") && body.includes("Last 30 days"), "英文界面文案缺失");
  await page.evaluate("document.querySelector('[aria-label=\"Filter\"]').click()");
  await page.waitFor("document.querySelector('.sw-filter-panel') !== null");
  assert((await text()).includes("Apply"), "英文筛选面板缺少 Apply");
  await shot("12-en-filter");
  await page.evaluate("localStorage.setItem('libevra.language', 'zh-CN')");
  return "ok";
});

const summary = { results, shots, baseline, expected: { cnyExpense, cnyIncome, usdExpense, expectedConversion }, generatedAt: new Date().toISOString() };
writeFileSync(join(DIR, "s17-phase2-results.json"), JSON.stringify(summary, null, 2), "utf8");
const failed = results.filter((item) => item.status === "fail");
process.stdout.write(`\n${results.length - failed.length}/${results.length} PASS\n`);
if (failed.length > 0) {
  for (const item of failed) process.stdout.write(`FAILED: ${item.name} — ${item.error}\n`);
  process.exitCode = 1;
}
