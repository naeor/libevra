/**
 * S17 K3 —临时验证脚本：真实账本数据 → B 移动平均卡（集成分支 `/analysis-preview`）。
 * 用法：node tools/e2e/tmp-k3-preview-verify.mjs
 * 前置：API :3035（夹具库 libevra_s17_w1_fixture）、web :5188、Chrome CDP :9401。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { api, apiLogin, assert, openPage } from "./cdp.mjs";

const API_BASE = "http://127.0.0.1:3035/api/v1";
const WEB_BASE = "http://127.0.0.1:5188";
const CDP_PORT = 9401;
const OUT_DIR = resolve("_backups/k3-analysis-preview-20261027");

const results = [];
const cookie = await apiLogin(API_BASE, "s17_fixture_owner", "s17-fixture-local");
const transactions = await api(API_BASE, "/transactions?limit=100", { cookie });
assert(transactions.status === 200, `transactions status ${String(transactions.status)}`);
const items = transactions.data?.items ?? [];
assert(items.length > 0, "fixture account has transactions");

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
  latestTransactionDate: items[0]?.occurredLocalDate ?? null,
  cards,
  screenshot: shot,
};
writeFileSync(resolve(OUT_DIR, "k3-analysis-preview.json"), JSON.stringify(payload, null, 2));
writeFileSync(resolve(OUT_DIR, "k3-body-text.txt"), bodyText);
console.log(JSON.stringify(payload, null, 2));
await page.close();
