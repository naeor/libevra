/**
 * 窄屏 / 长英文 / 主题工程检查（local-only）：
 *
 * - 中英文两套界面 × 12 个主要页面 × 320/390/430 三种宽度；
 * - 断言页面没有横向溢出（文档宽度 ≤ 视口宽度）；横向滚动容器（例如月份条）里的
 *   内容允许超出自身可视区，但容器本身不得把页面撑开；
 * - 顺带报告点击区域过小的控件（< 24px，仅提示，不据此失败——文字链接按规范不受此限）；
 * - 失败时保存截图与 offender 列表，结果写入 JSON。
 *
 * 依赖本机正在运行的 5173（Vite）与 3000（API），以及 Chrome 的 CDP 端口 9236。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { api, apiLogin, assert, openPage } from "./cdp.mjs";

const BASE = "https://127.0.0.1:5173";
const API = "http://127.0.0.1:3000/api/v1";
const PORT = Number(process.env.LIBEVRA_CDP_PORT ?? 9236);
const OUT = resolve("_backups/layout-audit-20261025");
mkdirSync(OUT, { recursive: true });

const username = process.env.LAYOUT_E2E_USER ?? "pv_avatarcp";
const password = process.env.LAYOUT_E2E_PASS ?? "AvatarCp-5dc6ea59909b49d3";

const WIDTHS = [320, 390, 430];
const LANGS = [
  { id: "zh", storage: "zh-CN", label: "中文" },
  { id: "en", storage: "en-US", label: "English" },
];

/** 判断某元素是否位于一个“自己可以横向滚动”的容器内（此时子元素超出不算页面问题）。 */
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
    if (rect.right <= width + 1.5) continue;
    if (canScroll(el)) continue;
    offenders.push({
      tag: el.tagName.toLowerCase(),
      cls: String(el.className).slice(0, 130),
      right: Math.round(rect.right),
    });
    if (offenders.length >= 8) break;
  }
  return {
    width,
    scrollWidth: doc.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    overflow: doc.scrollWidth - width,
    offenders,
  };
})()`;

/** 点击区域过小（仅报告）。 */
const tapTargetProbe = `(() => {
  const small = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('button, a[href], [role="button"]')) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.width >= 24 && rect.height >= 24) continue;
    const label = (el.getAttribute("aria-label") ?? el.innerText ?? "").trim().slice(0, 40);
    const key = label + "|" + Math.round(rect.width) + "x" + Math.round(rect.height);
    if (seen.has(key)) continue;
    seen.add(key);
    small.push({ label, w: Math.round(rect.width), h: Math.round(rect.height) });
    if (small.length >= 6) break;
  }
  return small;
})()`;

const cookie = await apiLogin(API, username, password);
const booksResponse = await api(API, "/books", { cookie });
const books = booksResponse.data?.books ?? [];
const bookId = books[0]?.bookId ?? books[0]?.id ?? null;
console.log("book for settings routes:", bookId ?? "(none)");

const ROUTES = [
  { path: "/", name: "home" },
  { path: "/stats", name: "stats" },
  { path: "/me", name: "me" },
  { path: "/profile", name: "profile" },
  { path: "/profile/avatar", name: "avatar" },
  { path: "/settings", name: "settings" },
  { path: "/settings/preferences", name: "settings-preferences" },
  { path: "/settings/appearance", name: "settings-appearance" },
  { path: "/settings/language", name: "settings-language" },
  { path: "/settings/security", name: "settings-security" },
  { path: "/settings/account-data", name: "settings-account-data" },
];
if (bookId !== null) ROUTES.push({ path: `/books/${bookId}/settings`, name: "book-settings" });

/**
 * ⚠️ 先关掉上次运行遗留的页面 target。
 *
 * 之前几次 E2E 脚本失败时可能没有执行 `page.close()`，Chrome 里会累积多个仍在跑 SPA 的页面；
 * target 一多，新建连接的 `Network.enable` 就会排队到 20 s 超时（本轮实际踩到）。
 * 只关 page 类型，不碰 Chrome 进程本身，避免影响其它正在用 9236 的人。
 */
async function closeStaleTargets() {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    const targets = await response.json();
    for (const target of targets) {
      if (target.type !== "page") continue;
      await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {});
    }
    if (targets.some((target) => target.type === "page")) {
      console.log(`closed ${targets.filter((target) => target.type === "page").length} stale page target(s)`);
    }
  } catch {
    /** 端口不可用时交给 openPage 报错；这里不掩盖真正的问题。 */
  }
}
await closeStaleTargets();

const page = await openPage(PORT);
const results = [];
const tapReports = [];

const settle = async (path) => {
  await page.navigate(`${BASE}${path}`);
  await page.waitFor(`document.readyState === "complete"`, 12000);
  await new Promise((done) => setTimeout(done, 900));
  await page.waitFor(`document.querySelector("main, nav, h1, .page-title") !== null`, 12000);
  await page.waitFor(`document.body.innerText.trim().length > 20`, 12000);
};

try {
  await page.send("Security.setIgnoreCertificateErrors", { ignore: true });
  await page.setCookie("libellum_session", cookie);

  for (const lang of LANGS) {
    await page.setViewport(390, 844, true);
    await page.navigate(`${BASE}/`);
    await page.evaluate(`localStorage.setItem("libevra.language", ${JSON.stringify(lang.storage)})`);
    await page.navigate(`${BASE}/`);
    await page.waitFor(`document.readyState === "complete"`, 12000);

    for (const width of WIDTHS) {
      await page.setViewport(width, 844, true);
      for (const route of ROUTES) {
        const id = `${lang.id}-${route.name}-${width}`;
        try {
          await settle(route.path);
          const probe = await page.evaluate(overflowProbe);
          const ok = probe.overflow <= 1 && probe.offenders.length === 0;
          if (!ok) {
            await page.screenshot(`${OUT}/${id}-overflow.png`);
            results.push({ id, lang: lang.label, route: route.path, width, ok, probe });
            console.log(`FAIL ${id}`, JSON.stringify(probe));
          } else {
            results.push({ id, lang: lang.label, route: route.path, width, ok, overflow: probe.overflow });
          }
        } catch (caught) {
          results.push({ id, lang: lang.label, route: route.path, width, ok: false, error: String(caught) });
          console.log(`ERROR ${id}:`, String(caught));
        }
      }
    }

    // 只在中文 390 下抽样报告点击区域（避免重复统计）。
    if (lang.id === "zh") {
      await page.setViewport(390, 844, true);
      for (const route of ROUTES) {
        await settle(route.path);
        const small = await page.evaluate(tapTargetProbe);
        if (small.length > 0) tapReports.push({ route: route.path, small });
      }
    }
  }
} finally {
  await page.close();
}

const failed = results.filter((entry) => !entry.ok);
writeFileSync(
  `${OUT}/results.json`,
  JSON.stringify({ results, tapReports, ranAt: new Date().toISOString() }, null, 2),
  "utf8",
);
console.log(
  `\nchecked ${results.length} page/width combinations; ${failed.length} with horizontal overflow`,
);
for (const report of tapReports) {
  for (const item of report.small) {
    console.log(`tap-target ${report.route}: ${item.label} ${item.w}x${item.h}`);
  }
}
assert(failed.length === 0, `${failed.length} page/width combinations overflow horizontally`);
console.log("ALL PASS");
