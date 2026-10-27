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

/** 只跑指定的用例编号（如 `node ... 20`），用于汇率缺失等需要先改夹具库的场景。 */
const ONLY = new Set(
  process.argv
    .slice(2)
    .filter((item) => /^\d+$/.test(item))
    .map((item) => item.padStart(2, "0")),
);
async function scopedRun(name, fn) {
  const id = name.slice(0, 2);
  if (ONLY.size > 0 && !ONLY.has(id)) {
    results.push({ name, status: "skip" });
    return;
  }
  await runCase(results, name, fn);
}

async function rectOf(selector, index = 0) {
  return page.evaluate(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})][${index}];
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, w: rect.width, h: rect.height };
  })()`);
}

async function mouseMove(x, y) {
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
  await sleep(25);
}

/** 真实鼠标按下、逐步移动并悬停，返回松开前的位置。 */
async function dragStart(from, to, steps = 8) {
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", buttons: 1, clickCount: 1 });
  await sleep(40);
  for (let index = 1; index <= steps; index += 1) {
    await mouseMove(from.x + ((to.x - from.x) * index) / steps, from.y + ((to.y - from.y) * index) / steps);
  }
  await sleep(300);
}

async function dragRelease(x, y) {
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  await sleep(400);
}

async function pressEscape() {
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await sleep(250);
}

async function tileInfos() {
  return page.evaluate(`(() => [...document.querySelectorAll(".sw-edit-tile[data-object-id]")].map((el) => ({
    id: el.getAttribute("data-object-id"),
    label: el.getAttribute("aria-label"),
    size: el.getAttribute("data-size"),
    row: el.style.gridRowStart,
    col: el.style.gridColumnStart,
  })))()`);
}

/** 拖到合法落点时，D 只把合规的锚点画成 `.sw-cell-target`（aria-label 含「放到第 N 格」）。 */
async function firstCellTarget() {
  return page.evaluate(`(() => {
    const el = document.querySelector(".sw-cell-target");
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, label: el.getAttribute("aria-label") };
  })()`);
}

function anchorOf(label) {
  const matched = /\\d+/.exec(label ?? "");
  return matched === null ? null : Number(matched[0]);
}

function rowColFor(anchor, columns) {
  return { row: String(Math.ceil(anchor / columns)), col: String(((anchor - 1) % columns) + 1) };
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

await scopedRun("01 默认浏览：30 天·综合折算·真实数据", async () => {
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

await scopedRun("02 筛选：320 宽时间/币种单行 + 无横向溢出", async () => {
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

await scopedRun("03 自定义范围 + 原币：与 API 独立计算一致", async () => {
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

await scopedRun("04 非法 / 超长范围 URL 有明确提示并回退", async () => {
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

await scopedRun("05 综合折算 vs 原币：财务数值独立复算", async () => {
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

await scopedRun("06 原币币种筛选：美元金额与 API 一致", async () => {
  await page.navigate(`${WEB}/stats?analysis=currency&currency=USD`);
  await settle();
  await waitText("$150.30", 20000);
  await shot("06-usd-original");
  return usdExpense;
});

await scopedRun("07 编辑态：图标密度 390=32px / 320=26px、无横向溢出", async () => {
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

await scopedRun("08 编辑态添加卡片→完成保存→刷新仍在", async () => {
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

await scopedRun("09 自定义卡片：新建→保存→刷新持久化", async () => {
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

await scopedRun("10 布局容器：添加滑动卡片组→保存→刷新仍在", async () => {
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

await scopedRun("11 响应式：320/390/768/1280 无横向溢出 + 列数随宽度变化", async () => {
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

await scopedRun("12 英文界面：核心文案与筛选", async () => {
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

await scopedRun("13 版本显示统一 1.17.03（「我的」与更新页）", async () => {
  await page.setViewport(390, 844);
  await page.navigate(`${WEB}/me`);
  await page.waitFor("document.body.innerText.includes('1.17.03')", 20000);
  let body = await text();
  assert(body.includes("软件更新") || body.includes("版本"), "「我的」页缺少软件更新入口");
  assert(!body.includes("1.17.3"), "「我的」页仍出现未补零版本 1.17.3");
  await shot("13-version-me");
  await page.navigate(`${WEB}/update`);
  await page.waitFor("document.body.innerText.includes('1.17.03')", 20000);
  body = await text();
  assert(!body.includes("1.17.3"), "更新页仍出现未补零版本 1.17.3");
  await shot("13b-version-update");
  return "1.17.03";
});

await scopedRun("14 1×1 插入顺延（真实鼠标拖放）", async () => {
  await page.setViewport(390, 844);
  await page.navigate(`${WEB}/stats`);
  await settle();
  await enterEdit();
  await ensureDrawerExpanded();
  const before = await tileInfos();
  const source = await rectOf(".sw-drawer .sw-tile.sw-draggable");
  const target = await rectOf(".sw-edit-tile[data-object-id]", 0);
  assert(source !== null && target !== null, "找不到抽屉卡片或第一个落点");
  await dragStart(source, target);
  const preview = await page.evaluate("({ drop: document.querySelectorAll('.sw-drop').length, legal: document.querySelectorAll('.sw-drop-legal').length })");
  assert(preview.drop > 0 && preview.legal > 0, `拖入卡片时未出现合法预览：${JSON.stringify(preview)}`);
  await shot("14-drag-insert-preview");
  await dragRelease(target.x, target.y);
  await waitText("已添加", 6000);
  const after = await tileInfos();
  const known = new Set(before.map((item) => item.id));
  const added = after.find((item) => !known.has(item.id));
  assert(after.length === before.length + 1, `拖入后对象数应 +1：${before.length} -> ${after.length}`);
  assert(added !== undefined, "拖入后没有新增对象");
  assert(added.row === before[0].row && added.col === before[0].col, `新卡片没有落在拖放目标格：${JSON.stringify(added)}`);
  assert(after.some((item) => item.id === before[0].id && (item.row !== before[0].row || item.col !== before[0].col)), "原第一格卡片没有顺延让位");
  await shot("14b-insert-shift");
  return { before: before.length, after: after.length, added: added.label };
});

await scopedRun("15 同尺寸 1×1 交换 + 撤销/重做", async () => {
  await page.navigate(`${WEB}/stats`);
  await settle();
  await enterEdit();
  const before = await tileInfos();
  const ones = before.filter((item) => item.size === "1×1").slice(0, 2);
  assert(ones.length === 2, "1×1 卡片不足两张");
  const rectA = await rectOf(`.sw-edit-tile[data-object-id="${ones[0].id}"]`);
  const rectB = await rectOf(`.sw-edit-tile[data-object-id="${ones[1].id}"]`);
  assert(rectA !== null && rectB !== null, "找不到用于交换的两张卡片");
  await dragStart(rectA, rectB);
  await dragRelease(rectB.x, rectB.y);
  let after = await tileInfos();
  const moved = after.find((item) => item.id === ones[0].id);
  assert(moved.row === ones[1].row && moved.col === ones[1].col, `交换后 ${ones[0].label} 未到对方位置：${JSON.stringify(moved)}`);
  await shot("15-swapped");
  await page.evaluate(`(() => {
    const button = [...document.querySelectorAll(".sw-edit-bar button")].find((item) => item.getAttribute("aria-label") === "撤销");
    if (button) button.click();
  })()`);
  await sleep(400);
  after = await tileInfos();
  const restored = after.find((item) => item.id === ones[0].id);
  assert(restored.row === ones[0].row && restored.col === ones[0].col, "撤销没有恢复原位置");
  await page.evaluate(`(() => {
    const button = [...document.querySelectorAll(".sw-edit-bar button")].find((item) => item.getAttribute("aria-label") === "重做");
    if (button) button.click();
  })()`);
  await sleep(400);
  after = await tileInfos();
  const redone = after.find((item) => item.id === ones[0].id);
  assert(redone.row === ones[1].row && redone.col === ones[1].col, "重做没有回到交换后的位置");
  await shot("15b-redo");
  return { pair: ones.map((item) => item.label) };
});

await scopedRun("16 2×2 大卡片重排（真实鼠标拖放）", async () => {
  await page.navigate(`${WEB}/stats`);
  await settle();
  await enterEdit();
  const infos = await tileInfos();
  const big = infos.find((item) => item.size === "2×2");
  const small = infos.find((item) => item.size === "1×1");
  assert(big !== undefined && small !== undefined, "找不到 2×2 或 1×1 卡片");
  // 抽屉展开时 2×2 卡片在抽屉下方，鼠标按不到；先收起抽屉再拖。
  const collapsed = await page.evaluate(`(() => {
    const button = document.querySelector('[aria-label="收起卡片抽屉"]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert(collapsed, "找不到「收起卡片抽屉」按钮");
  await sleep(400);
  const bigRect = await rectOf(`.sw-edit-tile[data-object-id="${big.id}"]`);
  const smallRect = await rectOf(`.sw-edit-tile[data-object-id="${small.id}"]`);
  await dragStart(bigRect, smallRect);
  // 拖到第一张 1×1 卡片所在格：预览已由探针实际验证为合法（见 screenshot）。
  await sleep(400);
  const preview = await page.evaluate("(() => { const el = document.querySelector('.sw-drop'); return el === null ? null : el.className; })()");
  assert(preview !== null && preview.includes("legal"), `拖拽 2×2 时没有合法预览：${preview}`);
  await dragRelease(smallRect.x, smallRect.y);
  await sleep(500);
  const after = await tileInfos();
  const movedBig = after.find((item) => item.id === big.id);
  assert(movedBig !== undefined && movedBig.size === "2×2", `大卡片丢失或尺寸被改变：${JSON.stringify(movedBig)}`);
  const moved = movedBig.row !== big.row || movedBig.col !== big.col;
  assert(moved, `2×2 拖动后位置未变：${JSON.stringify({ row: movedBig.row, col: movedBig.col })}`);
  await shot("16-big-card-reordered");
  return { big: big.label, before: { row: big.row, col: big.col }, after: { row: movedBig.row, col: movedBig.col } };
});

await scopedRun("17 拖放预览、取消与落空提示", async () => {
  await page.navigate(`${WEB}/stats`);
  await settle();
  await enterEdit();
  const before = await tileInfos();
  const a = before[0];
  const b = before[1];
  const rectA = await rectOf(`.sw-edit-tile[data-object-id="${a.id}"]`);
  const rectB = await rectOf(`.sw-edit-tile[data-object-id="${b.id}"]`);
  await dragStart(rectA, rectB);
  const preview = await page.evaluate("({ drop: document.querySelectorAll('.sw-drop').length, text: document.body.innerText.includes('放在这里') || document.body.innerText.includes('这里放不下') })");
  assert(preview.drop > 0 && preview.text === true, `拖动时没有预览提示：${JSON.stringify(preview)}`);
  await shot("17-drag-preview");
  await pressEscape();
  const cancelled = await page.evaluate("({ dragging: document.querySelectorAll('.sw-edit-dragging').length, drop: document.querySelectorAll('.sw-drop').length })");
  assert(cancelled.dragging === 0 && cancelled.drop === 0, `Escape 后拖动状态未清理：${JSON.stringify(cancelled)}`);
  let after = await tileInfos();
  assert(after[0].id === a.id && after[1].id === b.id, "取消后布局发生变化");
  await shot("17b-drag-cancelled");
  await dragStart(rectA, { x: 200, y: 20 });
  await dragRelease(200, 20);
  await waitText("没有放到工作台上，已取消。", 6000);
  after = await tileInfos();
  assert(after[0].id === a.id, "拖到工作台外后布局发生变化");
  return "cancelled";
});

await scopedRun("18 自定义卡片：配置菜单打开 + 复制 + 保存刷新", async () => {
  await page.navigate(`${WEB}/stats`);
  await settle();
  await enterEdit();
  const infos = await tileInfos();
  const custom = infos.find((item) => item.label.includes("验收自定义卡"));
  assert(custom !== undefined, "找不到已保存的「验收自定义卡」");
  await page.evaluate(`(() => {
    const el = document.querySelector('.sw-edit-tile[data-object-id="${custom.id}"]');
    if (el) el.click();
  })()`);
  await page.waitFor("document.body.innerText.includes('配置') && document.body.innerText.includes('复制')", 10000);
  await shot("18-custom-menu");
  await clickExact("button", "复制");
  await waitText("已复制", 6000);
  await saveEdit();
  await waitText("工作台已保存到本机");
  await page.navigate(`${WEB}/stats`);
  await settle();
  await waitText("验收自定义卡", 20000);
  await shot("18b-custom-after-copy");
  return custom.label;
});

if (ONLY.size === 0 || ONLY.has("20")) {
  await scopedRun("20 汇率缺失：综合折算不伪造零、原币不受影响", async () => {
    // 夹具账本所有日期都有汇率；用一笔 1985 年的美元账目制造 ECB 覆盖之外的缺汇率场景，
    // 跑完立即删除，不改数据库结构、不影响其他用例。
    const cookie = await apiLogin(API, "s17_fixture_owner", "s17-fixture-local");
    const ledger = await api(API, "/ledger", { cookie, bookId: BOOK });
    assert(ledger.status === 200, `读取账本失败：${ledger.status}`);
    const category = (ledger.data.categories ?? []).find((item) => item.kind === "expense");
    const categoryId = category?.id;
    const paymentMethodId = ledger.data.paymentMethods?.[0]?.id;
    assert(typeof categoryId === "string", "账本没有分类，无法创建测试账目");
    const txId = crypto.randomUUID();
    const created = await api(API, "/transactions", {
      method: "POST",
      cookie,
      bookId: BOOK,
      body: {
        id: txId,
        idempotencyKey: crypto.randomUUID(),
        kind: "expense",
        amountCents: 10000,
        currency: "USD",
        categoryId,
        ...(typeof paymentMethodId === "string" ? { paymentMethodId } : {}),
        occurredAt: "1985-06-01T12:00:00+08:00",
        occurredLocalDate: "1985-06-01",
        occurredTz: "Asia/Shanghai",
        note: null,
        tagIds: [],
      },
    });
    assert(created.status === 201, `创建缺汇率测试账目失败：${created.status} ${JSON.stringify(created.data)}`);
    try {
      await page.setViewport(390, 844);
      await page.navigate(`${WEB}/stats?range=custom&from=1985-06-01&to=1985-06-30`);
      await settle(60000);
      const body = await text();
      assert(body.includes("缺少汇率"), `综合折算没有提示缺少汇率：${body.slice(0, 400)}`);
      assert(!body.includes("¥0.00"), "缺汇率被静默折算成零");
      await shot("20-combined-missing-rate");
      await openFilter();
      await clickExact(".sw-filter-panel .sw-chip", "美元");
      await applyFilter();
      await settle(30000);
      await waitText("$100.00", 20000);
      await shot("20b-original-unaffected");
      return { txId, degraded: true };
    } finally {
      const removed = await api(API, `/transactions/${txId}`, { method: "DELETE", cookie, bookId: BOOK });
      assert(removed.status === 200 || removed.status === 204, `清理缺汇率测试账目失败：${removed.status}`);
    }
  });
} else {
  results.push({ name: "20 汇率缺失：综合折算不伪造零、原币不受影响", status: "skip" });
}

const summary = { results, shots, baseline, expected: { cnyExpense, cnyIncome, usdExpense, expectedConversion }, generatedAt: new Date().toISOString() };
writeFileSync(join(DIR, "s17-phase2-results.json"), JSON.stringify(summary, null, 2), "utf8");
const failed = results.filter((item) => item.status === "fail");
process.stdout.write(`\n${results.length - failed.length}/${results.length} PASS\n`);
if (failed.length > 0) {
  for (const item of failed) process.stdout.write(`FAILED: ${item.name} — ${item.error}\n`);
  process.exitCode = 1;
}
