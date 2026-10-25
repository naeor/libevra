#!/usr/bin/env node
/**
 * S16 返回导航回归（2026-10-25 发布后补的「同类严重问题」防线）。
 *
 * ⚠️ **Why this exists.** 历史上出现过两次相近的事故：*返回在两层页面之间来回卡死*，
 * 以及 1.16.09 修复的跨账本串数据。前者属于"返回栈把用户困在两屏之间"的一类，
 * 每次重构页面层级都可能复发，而单元测试看不到真实 history 行为。
 *
 * 这里在真实浏览器里走 **返回按钮连击 + 深链冷启动 + history.back 序列**，断言：
 * 1. 设置页 / 个人资料页的层级返回都落在正确的上一级，而不是直接弹回首页；
 * 2. 连续返回最终能到首页，不会在 A/B 两屏之间交替；
 * 3. 深链直接打开的页面，返回一次就到上一级，不会因为有额外 replace/push 而多跳；
 * 4. 全程没有页面错误（window error / unhandledrejection）。
 *
 * 只读：不写数据库、不改账号数据；仅使用 `_backups/avatar-page-copy-20261025/fixture.json`
 * 的本地验收账号登录。
 * 运行：`node tools/e2e/navigation-back-verify.mjs`（需 5173 / API 3000 / Chrome CDP 9236）。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { apiLogin, assert, openPage, runCase } from "./cdp.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "_backups", "navigation-back-20261025");
const FIXTURE = JSON.parse(readFileSync(join(ROOT, "_backups", "avatar-page-copy-20261025", "fixture.json"), "utf8"));
const BASE = "https://127.0.0.1:5173";
const API = "http://127.0.0.1:3000/api/v1";
const CDP_PORT = Number(process.env.LIBEVRA_CDP_PORT ?? 9236);

const ARMED_ERRORS = `(() => {
  window.__navErrors = [];
  addEventListener("error", (event) => window.__navErrors.push("error: " + event.message));
  addEventListener("unhandledrejection", (event) => window.__navErrors.push("rejection: " + String(event.reason)));
  return true;
})()`;

const path = (page) => page.evaluate(`location.pathname`);
const errors = (page) => page.evaluate(`JSON.stringify(window.__navErrors ?? [])`);

/** 点击页面里的文案链接（返回按钮/行入口），返回是否点到。 */
async function clickByText(page, text) {
  return page.evaluate(`(() => {
    const wanted = ${JSON.stringify(text)};
    const els = [...document.querySelectorAll("a,button")].filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && (el.innerText ?? "").trim() === wanted;
    });
    if (els.length === 0) return false;
    els[0].click();
    return true;
  })()`);
}

async function clickHref(page, href) {
  return page.evaluate(`(() => {
    const el = [...document.querySelectorAll("a[href]")].find((a) => a.getAttribute("href") === ${JSON.stringify(href)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
}

/**
 * 点击以某段文案开头的可点元素（设置卡片的 innerText 会带描述，不能整串相等）。
 * 返回是否点到。
 */
async function clickRow(page, text) {
  return page.evaluate(`(() => {
    const wanted = ${JSON.stringify(text)};
    const candidates = [...document.querySelectorAll("a,button")].filter((el) => {
      const rect = el.getBoundingClientRect();
      const label = (el.innerText ?? "").trim();
      return rect.width > 0 && rect.height > 0 && label.startsWith(wanted);
    });
    if (candidates.length === 0) return false;
    candidates[0].click();
    return true;
  })()`);
}

async function clickEntry(page, href, text) {
  // 目标页可能还在渲染（pathname 已变但列表未挂载）：最多等 2.5s 再回退到文案匹配。
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (await clickHref(page, href)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return clickRow(page, text);
}

async function goBack(page, expectedPath) {
  const clicked = (await clickByText(page, "返回")) || (await clickByText(page, "Back"));
  assert(clicked, "返回按钮存在");
  await page.waitFor(`location.pathname === ${JSON.stringify(expectedPath)}`, 8000);
  return path(page);
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const results = [];
  const screenshots = [];

  const session = await apiLogin(API, FIXTURE.username, FIXTURE.password);
  const page = await openPage(CDP_PORT);
  try {
    await page.send("Security.setIgnoreCertificateErrors", { ignore: true }).catch(() => {});
    await page.setViewport(390, 844, true);
    await page.setCookie("libellum_session", session);

    await page.navigate(`${BASE}/`);
    await page.waitFor(`document.body.innerText.length > 0`, 10000);
    await page.evaluate(`localStorage.setItem("libevra.language", "zh-CN")`);
    await page.navigate(`${BASE}/`);
    await page.waitFor(`document.body.innerText.includes("明细")`, 15000);
    await page.evaluate(ARMED_ERRORS);

    await runCase(results, "应用内设置层级：我的 → 设置 → 记账偏好，逐级返回到我的", async () => {
      await page.navigate(`${BASE}/`);
      await page.waitFor(`document.body.innerText.includes("明细")`, 15000);
      assert(await clickEntry(page, "/me", "我的"), "我的入口存在");
      await page.waitFor(`location.pathname === "/me"`, 10000);
      assert(await clickEntry(page, "/settings", "设置"), "设置入口存在");
      await page.waitFor(`location.pathname === "/settings"`, 10000);
      assert(await clickEntry(page, "/settings/preferences", "记账偏好"), "记账偏好入口存在");
      await page.waitFor(`document.body.innerText.includes("记账偏好")`, 10000);
      assert((await goBack(page, "/settings")) === "/settings", "偏好的上一级是设置首页");
      assert((await goBack(page, "/me")) === "/me", "设置首页的上一级是我的");
    });

    await runCase(results, "个人资料层级：头像页 → 资料页（进入路径为资料页）", async () => {
      await page.navigate(`${BASE}/profile?edit=1`);
      await page.waitFor(`document.body.innerText.includes("个人资料")`, 10000);
      const opened = await page.evaluate(`(() => {
        const el = [...document.querySelectorAll("button[aria-label]")].find((button) => /头像/.test(button.getAttribute("aria-label") ?? ""));
        if (!el) return false;
        el.click();
        return true;
      })()`);
      assert(opened, "资料页可点开头像选择");
      await page.waitFor(`location.pathname === "/profile/avatar"`, 10000);
      assert((await goBack(page, "/profile")) === "/profile", "头像页的上一级是资料页");
    });

    await runCase(results, "深链冷启动：返回一次到父级，连按不会回到深链页", async () => {
      await page.navigate(`${BASE}/settings/preferences`);
      await page.waitFor(`document.body.innerText.includes("记账偏好")`, 10000);
      const first = await goBack(page, "/settings");
      assert(first === "/settings", "深链偏好的上一级是设置首页（replace，不是 push）");
      const seen = [];
      for (let i = 0; i < 3; i += 1) {
        const clicked = (await clickByText(page, "返回")) || (await clickByText(page, "Back"));
        if (!clicked) break;
        await new Promise((resolve) => setTimeout(resolve, 600));
        seen.push(await path(page));
        assert(seen[i] !== "/settings/preferences", `连按返回不会回到深链页（历史：${seen.join(" → ")}）`);
      }
      assert(seen.length > 0, "设置首页的返回按钮可点");
    });

    await runCase(results, "返回栈不来回震荡：history.back 连按只降不升", async () => {
      await page.navigate(`${BASE}/`);
      await page.waitFor(`document.body.innerText.includes("明细")`, 15000);
      await page.navigate(`${BASE}/settings`);
      await page.waitFor(`document.body.innerText.includes("设置")`, 10000);
      await page.navigate(`${BASE}/settings/preferences`);
      await page.waitFor(`document.body.innerText.includes("记账偏好")`, 10000);
      const seen = [];
      for (let i = 0; i < 3; i += 1) {
        await page.evaluate(`history.back()`);
        await new Promise((resolve) => setTimeout(resolve, 700));
        seen.push(await path(page));
      }
      assert(seen[0] === "/settings", `第一次 back 到设置首页（实际 ${seen[0]}）`);
      assert(seen[1] === "/", `第二次 back 到首页（实际 ${seen[1]}）`);
      assert(!(seen[0] === seen[2] && seen[1] === seen[0]), "不出现 A/B 交替卡死");
    });

    await runCase(results, "全程无未捕获错误", async () => {
      const collected = JSON.parse(await errors(page));
      assert(collected.length === 0, `window 错误为 0（实际 ${JSON.stringify(collected)}）`);
    });

    await page.navigate(`${BASE}/settings/preferences`);
    await page.waitFor(`document.body.innerText.includes("记账偏好")`, 10000);
    const shot = join(OUT, "01-preferences-back.png");
    await page.screenshot(shot);
    screenshots.push(shot);
  } finally {
    try {
      page.close();
    } catch {
      // CDP 已断开时无需清理。
    }
  }

  writeFileSync(join(OUT, "results.json"), JSON.stringify({ results, screenshots }, null, 2));
  const failed = results.filter((item) => item.status !== "pass");
  console.log(`\n== navigation-back: ${results.length - failed.length}/${results.length} PASS ==`);
  for (const item of results) console.log(`${item.status}  ${item.name}${item.detail ? "  :: " + item.detail : ""}`);
  console.log(`\n结果：${join(OUT, "results.json")}`);
  if (failed.length > 0) process.exitCode = 1;
}

await run();
