/**
 * S17 综合折算浏览器验收的公共部分（Playwright）：登录、进入合成账本、载入「38 张全部卡片」的工作台、
 * 读取每张卡片的渲染文本，以及与应用代码**无关**的独立金额计算（BigInt 有理数，半入取整）。
 *
 * 前置（见 s17-fx-combined-verify.mjs 头部）：本机专用库 + 隔离 API + Vite dev server。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// Playwright 以 CommonJS 全局安装：用 createRequire 加载，避免 ESM 解析不到。
const { chromium } = createRequire(import.meta.url)("playwright");

export const WEB = process.env.S17_WEB ?? "http://127.0.0.1:5175";
export const STATE = JSON.parse(readFileSync(process.env.S17_STATE ?? "/tmp/s17-accept/state.json", "utf8"));

/** 切换汇率表（仅写本机专用库）。 */
export function seedRates(mode, gaps = []) {
  execFileSync("node", ["--import", "tsx", "src/scripts/s17-fx-combined-seed.ts", "rates", mode, gaps.join(",")], {
    cwd: process.env.S17_API_DIR ?? "/home/claude/libevra/apps/api",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export async function login() {
  const response = await fetch(`${WEB}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: STATE.username, password: STATE.password }),
  });
  if (!response.ok) throw new Error(`login failed ${response.status}`);
  const raw = response.headers.getSetCookie()[0].split(";")[0];
  const at = raw.indexOf("=");
  return { name: raw.slice(0, at), value: raw.slice(at + 1) };
}

/** 新的浏览器上下文（全新的本机存储 = 全新的汇率缓存），已登录并进入合成账本。 */
export async function openLedger(browser, { width = 1280, height = 900, timezoneId = "Asia/Shanghai", setup = null } = {}) {
  const cookie = await login();
  const context = await browser.newContext({ viewport: { width, height }, timezoneId, locale: "zh-CN" });
  // 需要在任何页面加载之前就生效的拦截（客户端会缓存首次读到的汇率，晚了就拦不到）。
  if (setup !== null) await setup(context);
  await context.addCookies([{ ...cookie, url: WEB }]);
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console.error: ${message.text().slice(0, 300)}`);
  });
  // 用应用自己的 selectBookForReload 把本设备的「当前账本」切到合成账本（与「进入账本」同一条写入路径），
  // 随后整页重载读回。
  await page.goto(`${WEB}/start`, { waitUntil: "networkidle" });
  const saved = await page.evaluate(async (bookId) => (await import("/src/lib/currentBook.ts")).selectBookForReload(bookId), STATE.bookId);
  if (saved !== true) throw new Error("切换到合成账本失败");
  await page.goto(`${WEB}/stats`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  return { context, page, problems };
}

/** 用应用自己的 saveWorkbench / newCard 写入「全部 38 张卡片」的工作台（每张 2×2）。 */
export async function installAllCardsWorkbench(page, ids = null) {
  await page.goto(`${WEB}/stats`, { waitUntil: "networkidle" });
  return page.evaluate(
    async ({ userId, only }) => {
      const catalog = await import("/src/statsWorkbench/catalog.ts");
      const defaults = await import("/src/statsWorkbench/defaults.ts");
      const storage = await import("/src/statsWorkbench/storage.ts");
      const all = catalog.CARD_TYPES.map((type) => type.id).filter((id) => only === null || only.includes(id));
      const cards = all.map((id) => defaults.newCard(id, `all-${id}`));
      const objects = all.map((id, index) => ({ objectId: `all-${id}`, objectType: "analysis-card", anchor: 1 + index * 4, colSpan: 2, rowSpan: 2 }));
      const documents = {
        content: { schemaVersion: 1, cards, containers: [] },
        layout: { schemaVersion: 1, layoutAlgorithmVersion: 1, mode: "unified", main: { baseCols: 2, objects } },
      };
      const version = storage.saveWorkbench(`user:${userId}`, documents, 0);
      return { saved: version, count: all.length, ids: all };
    },
    { userId: STATE.userId, only: ids },
  );
}

/**
 * 写入自定义工作台：`specs` 每项 `{ id, name?, pinned?: {from,to}, family? }`，用应用自己的 `createCustomCard` /
 * `newCard` 生成（带固定时间窗的卡片 = 自定义卡片的 `rangePolicy: "pinned"`）。每张 2×2，顺序即读取顺序。
 */
export async function installWorkbench(page, specs) {
  await page.goto(`${WEB}/stats`, { waitUntil: "networkidle" });
  return page.evaluate(
    async ({ userId, specs }) => {
      const custom = await import("/src/statsWorkbench/customCards.ts");
      const defaults = await import("/src/statsWorkbench/defaults.ts");
      const catalog = await import("/src/statsWorkbench/catalog.ts");
      const storage = await import("/src/statsWorkbench/storage.ts");
      const cards = specs.map((spec, index) => {
        const objectId = `wb-${index}-${spec.id}`;
        if (spec.name === undefined && spec.pinned === undefined) return defaults.newCard(spec.id, objectId);
        const family = spec.family ?? catalog.cardType(spec.id).families[0];
        const card = custom.createCustomCard({ analysisId: spec.id, family, name: spec.name ?? spec.id, ...(spec.pinned ? { pinnedRange: spec.pinned } : {}) }, objectId);
        if (card === null) throw new Error(`createCustomCard refused ${spec.id}`);
        return card;
      });
      const objects = cards.map((card, index) => ({ objectId: card.objectId, objectType: "analysis-card", anchor: 1 + index * 4, colSpan: 2, rowSpan: 2 }));
      const documents = {
        content: { schemaVersion: 1, cards, containers: [] },
        layout: { schemaVersion: 1, layoutAlgorithmVersion: 1, mode: "unified", main: { baseCols: 2, objects } },
      };
      return storage.saveWorkbench(`user:${userId}`, documents, 0);
    },
    { userId: STATE.userId, specs },
  );
}

/** 读取当前页面上全部卡片：`[{ title, text }]`（浏览模式，按页面顺序）。 */
export async function readAllArticles(page) {
  const articles = await page.$$("article.sw-card");
  const out = [];
  for (const article of articles) {
    await article.scrollIntoViewIfNeeded();
    await page.waitForTimeout(40);
    out.push({
      title: ((await (await article.$("h3"))?.innerText()) ?? "").trim(),
      text: (await article.innerText()).replace(/\s+/g, " ").trim(),
    });
  }
  return out;
}

/** 通过筛选面板操作（与用户相同的路径）。`chip` 是芯片文字（如「近 7 天」「人民币」「综合折算（CNY）」）。 */
export async function applyFilterChip(page, chip) {
  // 面板在「应用」之后可能仍保持展开：已展开就不再点「筛选」（再点会收起）。
  const opened = await page.locator(".sw-filter-panel").getByRole("button", { name: "应用", exact: true }).isVisible().catch(() => false);
  if (!opened) {
    await page.getByRole("button", { name: "筛选", exact: true }).click();
    await page.waitForTimeout(400);
  }
  // 芯片文字里的空格可能是不换行空格：按「任意空白」匹配。
  const pattern = new RegExp(chip.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*"));
  await page.locator(".sw-filter-panel button", { hasText: pattern }).first().click();
  await page.getByRole("button", { name: "应用", exact: true }).click();
  await page.waitForTimeout(600);
  await settle(page);
}

/** 以本设备「当前账本」的名义切换账本（与进入账本同一条写入路径），随后重载 /stats。 */
export async function switchLedger(page, bookId, query = "") {
  const saved = await page.evaluate(async (id) => (await import("/src/lib/currentBook.ts")).selectBookForReload(id), bookId);
  if (saved !== true) throw new Error("switchLedger failed");
  await page.goto(`${WEB}/stats${query}`, { waitUntil: "networkidle" });
  await settle(page);
}

export async function apiJson(cookie, path, init = {}) {
  const response = await fetch(`${WEB}/api/v1${path}`, {
    ...init,
    headers: { "content-type": "application/json", cookie: `${cookie.name}=${cookie.value}`, ...(init.headers ?? {}) },
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

export async function openStats(page, from, to, extra = "") {
  await page.goto(`${WEB}/stats?range=custom&from=${from}&to=${to}${extra}`, { waitUntil: "networkidle" });
  await settle(page);
}

/** 等到没有「正在折算 / 正在读取」的卡片。 */
export async function settle(page, timeout = 30000) {
  const started = Date.now();
  for (;;) {
    await page.waitForTimeout(400);
    const busy = await page.evaluate(() => /正在按历史汇率折算|正在读取|正在计算|加载中/.test(document.body.innerText));
    if (!busy || Date.now() - started > timeout) return !busy;
  }
}

/** 逐张读取卡片文本：浏览模式下每张卡片是一个 `article.sw-card`，顺序与安装顺序一致。 */
export async function readCards(page, ids) {
  const articles = await page.$$("article.sw-card");
  const out = {};
  for (const [index, id] of ids.entries()) {
    const article = articles[index];
    if (article === undefined) { out[id] = null; continue; }
    await article.scrollIntoViewIfNeeded();
    await page.waitForTimeout(60);
    out[id] = (await article.innerText()).replace(/\s+/g, " ").trim();
  }
  return out;
}

// ----------------------------- 独立金额计算（与应用代码无关）-----------------------------

const DECIMALS = { CNY: 2, USD: 2, HKD: 2, JPY: 0, EUR: 2 };
const SCALE = 10n ** 12n;

function decimal(value) {
  const [whole, fraction = ""] = String(value).split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(12, "0").slice(0, 12));
}

/** 半入（away from zero）取整的 a / b，a、b 为非负 BigInt。 */
function roundDiv(a, b) {
  return (2n * a + b) / (2n * b);
}

/**
 * 把 `amount`（来源币种最小单位）按 `rates`（每 EUR 的主币单位数）折算为 `target` 的最小单位。
 * target_minor = round(amount × 10^dT × r_T / (10^dS × r_S))
 */
export function convertMinor(amount, from, target, rates) {
  if (from === target) return BigInt(amount);
  const rFrom = decimal(rates[from]);
  const rTarget = decimal(rates[target]);
  return roundDiv(BigInt(amount) * 10n ** BigInt(DECIMALS[target]) * rTarget, 10n ** BigInt(DECIMALS[from]) * rFrom);
}

export async function fetchRates(cookie, date) {
  const response = await fetch(`${WEB}/api/v1/fx/rates?date=${date}`, { headers: { cookie: `${cookie.name}=${cookie.value}` } });
  const body = await response.json();
  return body.status === "available" ? body.snapshot.rates : null;
}

export function money(minor, symbol = "¥") {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${symbol}${whole}.${cents}`;
}

export async function launch() {
  return chromium.launch();
}
