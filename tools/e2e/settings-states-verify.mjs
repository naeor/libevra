#!/usr/bin/env node
/**
 * S16-E-10：设置页的**错误 / 离线 / 空状态与可访问性**回归。
 *
 * ⚠️ **Why this exists.** The settings screens were audited for storage ownership (S16-E) and
 * for "future items must read as facts" (the `后续开放` rule), but nobody had walked them with
 * the network *off*: does a failed currency save say something, or does the row just not move?
 * And do the icon-only / list-row controls keep an accessible name?
 *
 * Read-only against real services, except one deliberate write: the default-currency PATCH on
 * the throw-away fixture account, which is restored to CNY at the end.
 *
 * Screenshots + results: `_backups/settings-states-20261025/`.
 * Run: `node tools/e2e/settings-states-verify.mjs`（需 5173 / API 3000 / Chrome CDP 9236）。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { api, apiLogin, assert, openPage, runCase } from "./cdp.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "_backups", "settings-states-20261025");
const FIXTURE = JSON.parse(readFileSync(join(ROOT, "_backups", "avatar-page-copy-20261025", "fixture.json"), "utf8"));
const BASE = "https://127.0.0.1:5173";
const API = "http://127.0.0.1:3000/api/v1";
const CDP_PORT = Number(process.env.LIBEVRA_CDP_PORT ?? 9236);

const ROUTES = [
  "/settings",
  "/settings/preferences",
  "/settings/appearance",
  "/settings/security",
  "/settings/account-data",
  "/settings/appearance/language",
  "/settings/appearance/theme",
];

/** 无障碍名：aria-label / labelledby / 可见文字 / label / title 任一存在即可。 */
const A11Y_PROBE = `(() => {
  const violations = [];
  const els = [...document.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,[role="switch"],[role="button"]')];
  for (const el of els) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    let name = (el.getAttribute("aria-label") ?? "").trim();
    if (!name && el.getAttribute("aria-labelledby")) name = "ok";
    if (!name) name = (el.innerText ?? "").trim();
    if (!name && el.tagName === "INPUT") {
      const id = el.id;
      if (id && document.querySelector('label[for="' + CSS.escape(id) + '"]')) name = "ok";
      if (!name && el.getAttribute("placeholder")) name = "ok";
    }
    if (!name && el.title) name = "ok";
    if (!name) violations.push(el.tagName.toLowerCase() + " " + String(el.className).slice(0, 90));
  }
  return JSON.stringify({
    violations,
    hasMain: !!document.querySelector("main"),
    h1: document.querySelector("h1")?.textContent?.trim() ?? null,
    errors: Array.isArray(window.__s16errors) ? window.__s16errors.slice(0, 5) : [],
    disabledRows: [...document.querySelectorAll("button[disabled]")].filter((b) => b.innerText.includes("后续开放")).length,
  });
})()`;

const ARMED_ERRORS = `(() => {
  window.__s16errors = [];
  addEventListener("error", (event) => window.__s16errors.push("error: " + event.message));
  addEventListener("unhandledrejection", (event) => window.__s16errors.push("rejection: " + String(event.reason)));
  return true;
})()`;

async function probe(page) {
  return JSON.parse(await page.evaluate(A11Y_PROBE));
}

async function openSettingsRoute(page, route) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.navigate(`${BASE}${route}`);
      await page.waitFor(`document.querySelector("main") !== null`, 15000);
      return;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const session = await apiLogin(API, FIXTURE.username, FIXTURE.password);
  /**
   * 先归一到 CNY：这个夹具账号可能被上一轮中断在 USD（离线挂起的 PATCH 在恢复网络后会自己提交），
   * 失败用例的「选中项不变」断言必须以本轮开始时的值为基线。
   */
  await api(API, "/auth/me", { method: "PATCH", cookie: session, body: { defaultCurrency: "CNY" } });
  const page = await openPage(CDP_PORT, `${BASE}/`);
  const results = [];

  try {
    await page.send("Security.setIgnoreCertificateErrors", { ignore: true }).catch(() => {});
    await page.send("Page.enable").catch(() => {});
    await page.setViewport(390, 844, true);
    await page.setCookie("libellum_session", session);
    await page.navigate(`${BASE}/`);
    await page.evaluate(`localStorage.setItem("libevra.language", "zh-CN")`);

    await runCase(results, "全部设置页可达且无未捕获异常", async () => {
      for (const route of ROUTES) {
        await openSettingsRoute(page, route);
        await page.evaluate(ARMED_ERRORS);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    });

    await runCase(results, "设置页交互控件都有可访问名", async () => {
      const report = [];
      for (const route of ROUTES) {
        await openSettingsRoute(page, route);
        await page.evaluate(ARMED_ERRORS);
        await new Promise((resolve) => setTimeout(resolve, 350));
        const data = await probe(page);
        report.push({ route, ...data });
      }
      writeFileSync(join(OUT, "a11y.json"), JSON.stringify(report, null, 2), "utf8");
      const withViolations = report.filter((item) => item.violations.length > 0);
      assert(withViolations.length === 0, `无名字控件：${JSON.stringify(withViolations)}`);
      const withoutMain = report.filter((item) => !item.hasMain);
      assert(withoutMain.length === 0, `缺少 main 地标：${withoutMain.map((item) => item.route).join(",")}`);
      const withErrors = report.filter((item) => item.errors.length > 0);
      assert(withErrors.length === 0, `页面未捕获异常：${JSON.stringify(withErrors)}`);
    });

    await runCase(results, "记账偏好：币种同时只有一个选中，五项未开放显示「后续开放」", async () => {
      await page.navigate(`${BASE}/settings/preferences`);
      await page.waitFor(`document.querySelectorAll("[data-currency]").length === 6`, 15000);
      const pressed = await page.evaluate(
        `[...document.querySelectorAll("[data-currency]")].filter((b) => b.getAttribute("aria-pressed") === "true").length`,
      );
      assert(pressed === 1, `aria-pressed=true 数量=${pressed}`);
      const comingLater = await page.evaluate(
        `[...document.querySelectorAll("button[disabled]")].filter((b) => b.innerText.includes("后续开放")).length`,
      );
      assert(comingLater >= 5, `「后续开放」行=${comingLater}`);
      await page.screenshot(join(OUT, "01-preferences.png"));
    });

    await runCase(results, "显示与数据：语言/外观可进入，汇率折算为未开放说明", async () => {
      await page.navigate(`${BASE}/settings/appearance`);
      await page.waitFor(`document.body.innerText.includes("后续开放")`, 15000);
      const rows = await page.evaluate(
        `(() => {
          const buttons = [...document.querySelectorAll("button")];
          return JSON.stringify({
            language: buttons.some((b) => !b.disabled && b.innerText.includes("Language")),
            theme: buttons.some((b) => !b.disabled && b.innerText.includes("外观")),
            exchangeDisabled: buttons.some((b) => b.disabled && b.innerText.includes("汇率")),
          });
        })()`,
      );
      const parsed = JSON.parse(rows);
      assert(parsed.language, "语言行不跳转");
      assert(parsed.theme, "外观行不跳转");
      assert(parsed.exchangeDisabled, "汇率折算行不是未开放状态");
      await page.screenshot(join(OUT, "02-appearance.png"));
    });

    await runCase(results, "账号与安全页三行都是真实入口", async () => {
      await page.navigate(`${BASE}/settings/security`);
      await page.waitFor(`document.body.innerText.includes("账号与安全")`, 15000);
      const enabled = await page.evaluate(
        `[...document.querySelectorAll("main button")].filter((b) => !b.disabled).length`,
      );
      assert(enabled >= 3, `可点击入口=${enabled}（应含密码/恢复码/邀请码）`);
      await page.screenshot(join(OUT, "03-security.png"));
    });

    await runCase(results, "离线时币种保存失败有可见错误，不显示已保存", async () => {
      await openSettingsRoute(page, "/settings/preferences");
      await page.waitFor(`document.querySelectorAll("[data-currency]").length === 6`, 15000);
      /** 失败断言要对比“点击前的选中项”：夹具账号的默认币种可能被前几轮用例改成 USD。 */
      const baseline = await page.evaluate(
        `[...document.querySelectorAll("[data-currency]")].find((b) => b.getAttribute("aria-pressed") === "true")?.getAttribute("data-currency")`,
      );
      let state = null;
      try {
        await page.setOffline(true);
        await page.evaluate(`document.querySelector('[data-currency="USD"]').click()`);
        /**
         * ⚠️ 错误提示要定位**币种卡片内部**的 `bg-danger-soft` 警告，不能只看全局 `role=status`：
         * 顶部离线横幅同样带 `bg-danger-soft`，会在点击之前就满足条件、截到错误的画面。
         */
        await page.waitFor(
          `[...document.querySelectorAll("[role=status]")].some((el) => el.className.includes("bg-danger-soft") && el.closest(".rounded-card") !== null && !el.closest("[class*=sticky]"))`,
          20000,
        );
        state = JSON.parse(
          await page.evaluate(
            `(() => {
              const status = [...document.querySelectorAll("[role=status]")]
                .filter((el) => el.className.includes("bg-danger-soft") && el.closest(".rounded-card") !== null)
                .map((el) => el.innerText.trim());
              const pressed = [...document.querySelectorAll("[data-currency]")].find((b) => b.getAttribute("aria-pressed") === "true")?.getAttribute("data-currency");
              const disabledCount = [...document.querySelectorAll("[data-currency]")].filter((b) => b.disabled).length;
              return JSON.stringify({ status, pressed, disabledCount, saved: document.body.innerText.includes("已保存") });
            })()`,
          ),
        );
        await page.screenshot(join(OUT, "04-preferences-offline-error.png"));
      } finally {
        await page.setOffline(false).catch(() => {});
      }
      assert(state !== null, "离线保存失败后未取到页面状态");
      assert(state.status.some((text) => text.length > 0), "离线失败没有可见错误提示");
      assert(state.pressed === baseline, `离线失败后选中币种被改动：${state.pressed}（应为 ${baseline}）`);
      assert(!state.saved, "离线失败却显示了已保存");
      assert(state.disabledCount === 0, `失败后币种按钮仍被禁用（${state.disabledCount} 个），用户无法重试`);
      writeFileSync(join(OUT, "offline-state.json"), JSON.stringify(state, null, 2), "utf8");
    });

    await runCase(results, "在线币种保存成功并恢复原值", async () => {
      await page.navigate(`${BASE}/settings/preferences`);
      await page.waitFor(`document.querySelectorAll("[data-currency]").length === 6`, 15000);
      await page.evaluate(`document.querySelector('[data-currency="USD"]').click()`);
      await page.waitFor(`document.body.innerText.includes("已保存")`, 15000);
      const usd = await page.evaluate(
        `[...document.querySelectorAll("[data-currency]")].find((b) => b.getAttribute("aria-pressed") === "true")?.getAttribute("data-currency")`,
      );
      assert(usd === "USD", `保存后选中=${usd}`);
      await page.evaluate(`document.querySelector('[data-currency="CNY"]').click()`);
      await page.waitFor(
        `[...document.querySelectorAll("[data-currency]")].find((b) => b.getAttribute("aria-pressed") === "true")?.getAttribute("data-currency") === "CNY"`,
        15000,
      );
      await page.screenshot(join(OUT, "05-preferences-saved.png"));
    });

    const failed = results.filter((item) => item.status !== "pass");
    writeFileSync(
      join(OUT, "results.json"),
      JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2),
      "utf8",
    );
    console.log(`\n${results.length - failed.length}/${results.length} PASS`);
    if (failed.length > 0) {
      for (const item of failed) console.log(`FAIL ${item.name}: ${item.error}`);
      process.exitCode = 1;
    }
  } finally {
    await page.evaluate(`localStorage.setItem("libevra.language", "zh-CN")`).catch(() => {});
    await page.close?.();
  }
}

await main();
