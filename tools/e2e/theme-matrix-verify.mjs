/**
 * 主题 / 深色矩阵 + 页面级回归截图（local-only，S16-F-05/F-06 的自动化证据）。
 *
 * 目标（不是"设计验收"，只是把可自动化的部分做完，减少所有者手工重复）：
 * - 4 组外观（浅色绿、深色绿、深色蓝、浅色丹霞红）× 7 个主要页面 × 390×844；
 * - 每组切换后读取 `html[data-theme-mode]` / `[data-theme-palette]`，确认主题运行时真的生效；
 * - 采样页面背景色，确认浅色与深色确实不同（防"切了模式但没生效"）；
 * - 同时做横向溢出探测（与 layout-overflow-verify 相同口径）；
 * - 截图存 `_backups/theme-matrix-20261025/`，结果 JSON 同目录。
 *
 * 依赖：本机 5173（Vite）、3000（API）与 Chrome 的 CDP 端口（默认 9236，可用 LIBEVRA_CDP_PORT 覆盖）。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { api, apiLogin, assert, openPage } from "./cdp.mjs";

const BASE = "https://127.0.0.1:5173";
const API = "http://127.0.0.1:3000/api/v1";
const PORT = Number(process.env.LIBEVRA_CDP_PORT ?? 9236);
const OUT = resolve("_backups/theme-matrix-20261025");
mkdirSync(OUT, { recursive: true });

const username = process.env.THEME_E2E_USER ?? "pv_avatarcp";
const password = process.env.THEME_E2E_PASS ?? "AvatarCp-5dc6ea59909b49d3";

const THEMES = [
  { id: "light-green", mode: "light", palette: "green", label: "浅色·森林绿" },
  { id: "dark-green", mode: "dark", palette: "green", label: "深色·森林绿" },
  { id: "dark-blue", mode: "dark", palette: "blue", label: "深色·雾霭蓝" },
  { id: "light-red", mode: "light", palette: "red", label: "浅色·丹霞红" },
];

const ROUTES = [
  { path: "/", name: "home" },
  { path: "/stats", name: "stats" },
  { path: "/me", name: "me" },
  { path: "/profile", name: "profile" },
  { path: "/settings", name: "settings" },
  { path: "/settings/appearance", name: "appearance" },
  { path: "/settings/language", name: "language" },
];

const overflowProbe = `(() => {
  const width = window.innerWidth;
  const doc = document.documentElement;
  const canScroll = (el) => {
    for (let node = el.parentElement; node !== null && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      const scrolls = style.overflowX === "auto" || style.overflowX === "scroll";
      if (scrolls && node.getBoundingClientRect().width <= width + 1) return true;
    }
    return false;
  };
  const offenders = [];
  for (const el of document.querySelectorAll("body *")) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.right > width + 1 && !canScroll(el)) {
      offenders.push({ tag: el.tagName, cls: String(el.className).slice(0, 80), right: Math.round(rect.right) });
      if (offenders.length > 5) break;
    }
  }
  return { overflow: Math.max(0, doc.scrollWidth - width), offenders };
})()`;

const htmlTheme = `(() => ({
  mode: document.documentElement.dataset.themeMode ?? null,
  palette: document.documentElement.dataset.themePalette ?? null,
  bg: getComputedStyle(document.body).backgroundColor,
}))()`;

async function closeStaleTargets() {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    const targets = await response.json();
    for (const target of targets) {
      if (target.type !== "page") continue;
      await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {});
    }
  } catch {
    /** 端口不可用时交给 openPage 报错。 */
  }
}

await closeStaleTargets();

const page = await openPage(PORT);
const results = [];
const sampled = new Map();

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

  for (const theme of THEMES) {
    const storage = JSON.stringify({ mode: theme.mode, palette: theme.palette });
    await page.navigate(`${BASE}/`);
    await page.evaluate(`localStorage.setItem("libevra.language", ${JSON.stringify("zh-CN")})`);
    await page.evaluate(`localStorage.setItem("libevra.theme", ${JSON.stringify(storage)})`);
    await page.navigate(`${BASE}/`);
    await page.waitFor(`document.readyState === "complete"`, 12000);

    for (const route of ROUTES) {
      const id = `${theme.id}-${route.name}`;
      try {
        await settle(route.path);
        const probe = await page.evaluate(overflowProbe);
        const applied = await page.evaluate(htmlTheme);
        await page.screenshot(`${OUT}/${id}.png`);
        const ok = probe.overflow <= 1 && probe.offenders.length === 0
          && applied.mode === theme.mode
          && applied.palette === theme.palette;

        sampled.set(theme.id, applied.bg);

        results.push({
          id,
          theme: theme.label,
          route: route.path,
          ok,
          overflow: probe.overflow,
          offenders: probe.offenders,
          applied,
        });
        console.log(`${ok ? "PASS" : "FAIL"} ${id} mode=${applied.mode} palette=${applied.palette} bg=${applied.bg}`);
      } catch (error) {
        results.push({ id, theme: theme.label, route: route.path, ok: false, error: String(error) });
        console.log(`ERROR ${id}: ${String(error)}`);
      }
    }
  }

  const lightBg = sampled.get("light-green");
  const darkBg = sampled.get("dark-green");
  assert(lightBg !== undefined && darkBg !== undefined, "should sample both light and dark backgrounds");
  assert(lightBg !== darkBg, `light and dark must differ (light=${lightBg} dark=${darkBg})`);

  const failures = results.filter((item) => item.ok !== true);
  assert(failures.length === 0, `all combinations should pass, failures: ${failures.map((item) => item.id).join(", ")}`);

  writeFileSync(
    resolve(OUT, "results.json"),
    `${JSON.stringify({ results, backgrounds: Object.fromEntries(sampled), ranAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
  console.log(`\nALL PASS (${results.length} page/theme combinations)`);
} finally {
  try {
    page.close();
  } catch {
    /** 关闭失败不影响结果。 */
  }
}
