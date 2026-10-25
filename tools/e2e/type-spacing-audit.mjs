/**
 * 文字样式 / 圆角与页面级间距采样（S16-0-02 / S16-0-03 的自动化差异表，local-only）。
 *
 * 目标：不靠人眼逐页量，而是把真实浏览器里 **实际渲染出来的组合** 抽出来：
 * - 每个页面上「直接带文字的元素」的 fontSize / lineHeight / fontWeight / letterSpacing 组合；
 * - 实际出现的 border-radius 值；
 * - 页面根容器与一级区块的左右/上下 padding。
 *
 * 输出 `_backups/type-spacing-audit-20261025/results.json`，再与
 * `docs/specs/design/文字语义与排版规范.md` §13.1 的 token 表对照，
 * 差异写在 `docs/specs/design/S16-0-文字与间距页面核对-20261025.md`。
 *
 * 依赖：本机 5173 / 3000 与 Chrome CDP（默认 9236，可用 LIBEVRA_CDP_PORT 覆盖）。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { apiLogin, openPage } from "./cdp.mjs";

const BASE = "https://127.0.0.1:5173";
const API = "http://127.0.0.1:3000/api/v1";
const PORT = Number(process.env.LIBEVRA_CDP_PORT ?? 9236);
const OUT = resolve("_backups/type-spacing-audit-20261025");
mkdirSync(OUT, { recursive: true });

const username = process.env.AUDIT_E2E_USER ?? "pv_avatarcp";
const password = process.env.AUDIT_E2E_PASS ?? "AvatarCp-5dc6ea59909b49d3";

const ROUTES = [
  { path: "/", name: "home" },
  { path: "/ledger", name: "ledger" },
  { path: "/stats", name: "stats" },
  { path: "/me", name: "me" },
  { path: "/settings", name: "settings" },
  { path: "/profile", name: "profile" },
  { path: "/profile/avatar", name: "avatar" },
];

const probe = `(() => {
  const combos = new Map();
  const weights = new Map();
  const radii = new Map();
  const samples = new Map();
  const radiusSamples = new Map();
  const add = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
  const round = (value, base) => Math.round(value / base) * base;

  for (const el of document.querySelectorAll("body *")) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const cs = getComputedStyle(el);
    const hasText = [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim().length > 0);
    if (hasText) {
      const size = round(parseFloat(cs.fontSize), 0.1);
      const lineHeight = round(parseFloat(cs.lineHeight), 0.1);
      const letterSpacing = cs.letterSpacing === "normal" ? "normal" : round(parseFloat(cs.letterSpacing), 0.01);
      const key = size + "/" + lineHeight + "/" + letterSpacing;
      add(combos, key);
      add(weights, cs.fontWeight);
      // 记录最多 3 个样本来定位"这个字号是谁渲染的"，差异表要能指回组件。
      const list = samples.get(key) ?? [];
      if (list.length < 3) {
        list.push({
          tag: el.tagName.toLowerCase(),
          cls: String(el.className ?? "").slice(0, 120),
          text: String(el.textContent ?? "").trim().slice(0, 36),
        });
        samples.set(key, list);
      }
    }
    for (const value of cs.borderRadius.split(" ")) {
      if (value && value !== "0px" && !value.endsWith("%")) {
        add(radii, value);
        const list = radiusSamples.get(value) ?? [];
        if (list.length < 3) {
          list.push({ tag: el.tagName.toLowerCase(), cls: String(el.className ?? "").slice(0, 100) });
          radiusSamples.set(value, list);
        }
      }
    }
  }

  const padding = (el) => {
    if (el === null) return null;
    const cs = getComputedStyle(el);
    return cs.paddingTop + " " + cs.paddingRight + " " + cs.paddingBottom + " " + cs.paddingLeft;
  };
  // 一级页面用 div 滚动区（TabPage）而不是 <main>，两种都取。
  const main = document.querySelector("main");
  const scroll = [...document.querySelectorAll("div")].find((el) => {
    const cs = getComputedStyle(el);
    return (cs.overflowY === "auto" || cs.overflowY === "scroll") && el.getBoundingClientRect().height > 300;
  }) ?? null;
  const container = main ?? scroll;
  const firstSection = container?.firstElementChild ?? null;

  const toSorted = (map) => [...map]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);

  return {
    combos: toSorted(combos).map((item) => ({ ...item, samples: samples.get(item.key) ?? [] })),
    weights: toSorted(weights),
    radii: toSorted(radii).map((item) => ({ ...item, samples: radiusSamples.get(item.key) ?? [] })),
    containerTag: container === null ? null : container.tagName.toLowerCase(),
    containerPadding: padding(container),
    firstSectionPadding: padding(firstSection),
    viewport: innerWidth,
    docWidth: document.documentElement.scrollWidth,
    url: location.pathname,
  };
})()`;

async function closeStaleTargets() {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    const targets = await response.json();
    for (const target of targets) {
      if (target.type !== "page") continue;
      await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {});
    }
  } catch {
    /** 交给 openPage 报错。 */
  }
}

await closeStaleTargets();
const page = await openPage(PORT);
const results = [];

const settle = async (path) => {
  await page.navigate(`${BASE}${path}`);
  await page.waitFor(`document.readyState === "complete"`, 12000);
  await new Promise((done) => setTimeout(done, 700));
  await page.waitFor(`document.querySelector("main, nav, h1, .page-title") !== null`, 12000);
  await page.waitFor(`document.body.innerText.trim().length > 20`, 12000);
};

try {
  await page.send("Security.setIgnoreCertificateErrors", { ignore: true });
  const cookie = await apiLogin(API, username, password);
  await page.setCookie("libellum_session", cookie);
  await page.setViewport(390, 844, true);
  await page.navigate(`${BASE}/`);
  await page.evaluate(`localStorage.setItem("libevra.language", ${JSON.stringify("zh-CN")})`);

  for (const route of ROUTES) {
    await settle(route.path);
    const data = await page.evaluate(probe);
    results.push({ route: route.path, name: route.name, ...data });
    console.log(`sampled ${route.path}: ${data.combos.length} text combos, ${data.radii.length} radii`);
  }
} finally {
  try {
    page.close();
  } catch {
    /** 关闭失败不影响结果。 */
  }
}

const allCombos = new Map();
const allRadii = new Map();
const allWeights = new Map();
const allSamples = new Map();
const allRadiusSamples = new Map();
for (const result of results) {
  for (const item of result.combos) {
    allCombos.set(item.key, (allCombos.get(item.key) ?? 0) + item.count);
    const list = allSamples.get(item.key) ?? [];
    for (const sample of item.samples) {
      if (list.length >= 3) break;
      const seen = list.some((existing) => existing.cls === sample.cls && existing.text === sample.text);
      if (!seen) list.push(sample);
    }
    allSamples.set(item.key, list);
  }
  for (const item of result.radii) {
    allRadii.set(item.key, (allRadii.get(item.key) ?? 0) + item.count);
    const list = allRadiusSamples.get(item.key) ?? [];
    for (const sample of item.samples) {
      if (list.length >= 3) break;
      if (!list.some((existing) => existing.cls === sample.cls)) list.push(sample);
    }
    allRadiusSamples.set(item.key, list);
  }
  for (const item of result.weights) allWeights.set(item.key, (allWeights.get(item.key) ?? 0) + item.count);
}

const totals = {
  combos: [...allCombos]
    .map(([key, count]) => ({ key, count, samples: allSamples.get(key) ?? [] }))
    .sort((a, b) => b.count - a.count),
  radii: [...allRadii]
    .map(([key, count]) => ({ key, count, samples: allRadiusSamples.get(key) ?? [] }))
    .sort((a, b) => b.count - a.count),
  weights: [...allWeights].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
};

writeFileSync(
  resolve(OUT, "results.json"),
  `${JSON.stringify({ pages: results, totals, ranAt: new Date().toISOString() }, null, 2)}\n`,
  "utf8",
);

console.log("\n=== 全站文字组合（size/lineHeight/letterSpacing × 次数；样例用于定位）===");
for (const item of totals.combos) {
  console.log(`${item.key}  ×${item.count}`);
  for (const sample of item.samples) console.log(`    <${sample.tag}> ${sample.cls}  「${sample.text}」`);
}
console.log("\n=== 字重 ===", totals.weights.map((item) => `${item.key} ×${item.count}`).join("  "));
console.log("\n=== 圆角（含样例）===");
for (const item of totals.radii) {
  console.log(`${item.key}  ×${item.count}`);
  for (const sample of item.samples) console.log(`    <${sample.tag}> ${sample.cls}`);
}
console.log("\n=== 页面容器 padding ===");
for (const result of results) {
  console.log(`${result.route}  <${result.containerTag}> ${result.containerPadding}`);
}
console.log(`\n结果已写入 ${resolve(OUT, "results.json")}`);
