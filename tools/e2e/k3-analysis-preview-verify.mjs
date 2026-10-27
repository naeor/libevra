/**
 * S17 K3 — 真实账本数据 → B 移动平均卡（集成分支 `/analysis-preview`）验证脚本。
 * 用法：node tools/e2e/k3-analysis-preview-verify.mjs
 * 前置：API :3035（夹具库 libevra_s17_w1_fixture）、web :5188、Chrome CDP :9401。
 *
 * K3 修复（B 对账发现）：页面原先只取最新 100 笔，30 天窗口起点被截断成"确认零"。
 * 现在页面按 cursor 分页加载账本全部交易；本脚本同时核对"页面加载范围覆盖读取窗口"。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { api, apiLogin, assert, openPage } from "./cdp.mjs";

const API_BASE = "http://127.0.0.1:3035/api/v1";
const WEB_BASE = "http://127.0.0.1:5188";
const CDP_PORT = 9401;
const OUT_DIR = resolve("_backups/k3-analysis-preview-20261027");

/** 全账本分页拉取（与页面同一 cursor 契约），用于独立期望值。 */
async function fetchAllLedgerTransactions(cookie) {
  const items = [];
  let cursor = null;
  for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
    const query = cursor === null ? "/transactions?limit=100" : `/transactions?limit=100&cursor=${encodeURIComponent(cursor)}`;
    const response = await api(API_BASE, query, { cookie });
    assert(response.status === 200, `transactions status ${String(response.status)}`);
    items.push(...(response.data?.items ?? []));
    cursor = response.data?.nextCursor ?? null;
    if (cursor === null) break;
  }
  return items;
}

const results = [];
const cookie = await apiLogin(API_BASE, "s17_fixture_owner", "s17-fixture-local");
const items = await fetchAllLedgerTransactions(cookie);
assert(items.length > 0, "fixture account has transactions");
const ledgerEarliest = items.map((row) => row.occurredLocalDate).sort()[0] ?? null;

const page = await openPage(CDP_PORT, `${WEB_BASE}/analysis-preview`);
await page.setCookie("libellum_session", cookie, "http://127.0.0.1");
await page.setViewport(1280, 900);
await page.navigate(`${WEB_BASE}/analysis-preview`);
await page.waitFor("document.querySelectorAll('[data-testid=moving-average-card]').length === 2", 20000);

const cards = await page.evaluate(`
  (() => {
    const read = (el) => ({
      window: el.getAttribute("data-window"),
      title: el.querySelector("h3")?.textContent?.trim() ?? null,
      caption: el.querySelector('[data-testid="moving-average-card-caption"]')?.textContent?.trim() ?? null,
      sample: el.querySelector('[data-testid="moving-average-card-sample"]')?.textContent?.trim() ?? null,
      metrics: [...el.querySelectorAll("[data-metric-label]")].map((node) => ({
        label: node.getAttribute("data-metric-label"),
        value: node.textContent?.trim() ?? null,
      })),
      excludedToday: el.querySelector('[data-testid="moving-average-card-excluded-today"]')?.textContent?.trim() ?? null,
      chartPoints: el.querySelectorAll("svg path, svg circle, svg rect").length,
      hasSvg: el.querySelector("svg") !== null,
    });
    return [...document.querySelectorAll('[data-testid=moving-average-card]')].map(read);
  })()
`);
const bodyText = await page.evaluate("document.body.innerText");
const loaded = await page.evaluate(`
  (() => {
    const line = document.querySelector('[data-testid="analysis-preview-currency"]')?.textContent?.trim() ?? "";
    const truncated = document.querySelector('[data-testid="analysis-preview-truncated"]') !== null;
    return { line, truncated };
  })()
`);
const earliestMatch = /loaded (\d{4}-\d{2}-\d{2})/.exec(loaded.line);
const windowMatch = /window starts (\d{4}-\d{2}-\d{2})/.exec(loaded.line);
assert(earliestMatch !== null, `loaded range readable: ${loaded.line}`);
assert(windowMatch !== null, `read window start readable: ${loaded.line}`);
const loadedEarliest = earliestMatch[1];
const windowStart = windowMatch[1];
assert(!loaded.truncated, "loaded slice covers the read window (no truncation banner)");
assert(loadedEarliest <= windowStart, `loaded earliest ${loadedEarliest} is at or before window start ${windowStart}`);
assert(
  ledgerEarliest !== null && loadedEarliest === ledgerEarliest,
  `loaded earliest ${loadedEarliest} equals ledger earliest ${String(ledgerEarliest)}`,
);
assert(cards.length === 2, `expected 2 cards, got ${String(cards.length)}`);
for (const card of cards) {
  assert(card.hasSvg, `${String(card.window)}-day card renders a chart`);
  assert(card.sample !== null && card.sample.length > 0, `${String(card.window)}-day sample text visible`);
  assert(card.caption !== null && card.caption.length > 0, `${String(card.window)}-day caption visible`);
  assert(!bodyText.includes("Could not load transactions"), "no adapter error shown");
  assert(!/No complete observations/.test(card.sample === null ? "" : card.sample), "has computable days");
}
assert(/Analysis card preview/.test(bodyText), "preview page heading rendered");

mkdirSync(OUT_DIR, { recursive: true });
const shot = resolve(OUT_DIR, "k3-analysis-preview-1280.png");
await page.screenshot(shot);
const payload = {
  generatedAt: new Date().toISOString(),
  webBase: WEB_BASE,
  account: "s17_fixture_owner",
  transactionCount: items.length,
  currencies: [...new Set(items.map((row) => row.currency))],
  earliestTransactionDate: ledgerEarliest,
  latestTransactionDate: items[0]?.occurredLocalDate ?? null,
  loadedRange: loaded.line,
  windowStart,
  cards,
  screenshot: shot,
};
writeFileSync(resolve(OUT_DIR, "k3-analysis-preview.json"), JSON.stringify(payload, null, 2));
writeFileSync(resolve(OUT_DIR, "k3-body-text.txt"), bodyText);
console.log(JSON.stringify(payload, null, 2));
await page.close();
