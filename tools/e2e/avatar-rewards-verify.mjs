/**
 * 头像奖励系统 UI 验收（local-only）：
 * - 首页底部导航上方出现待通知横幅；
 * - 打开「+」菜单时横幅让位，不与入口卡片重叠；
 * - 点击「查看头像收藏」进入头像页，事件随后标记为已确认；
 * - 特典头像锁定态：显示解锁条件、保存按钮禁用；
 * - 创作注记入口与正文（《原神》致敬声明）；
 * - 英文界面同样成立。
 *
 * 依赖本机正在运行的 5173（Vite）与 3000（API），以及 Chrome 的 CDP 端口 9236。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { api, apiLogin, assert, openPage, runCase } from "./cdp.mjs";

const BASE = "https://127.0.0.1:5173";
const API = "http://127.0.0.1:3000/api/v1";
const PORT = 9236;
const OUT = resolve("_backups/avatar-rewards-20261025");
mkdirSync(OUT, { recursive: true });

const username = process.env.REWARD_E2E_USER ?? "pv_avatarcp";
const password = process.env.REWARD_E2E_PASS ?? "AvatarCp-5dc6ea59909b49d3";

const cookie = await apiLogin(API, username, password);
const before = await api(API, "/avatar-rewards", { cookie });
console.log("initial reward state:", JSON.stringify(before.data));

const results = [];
const page = await openPage(PORT, BASE);

const bannerPresent = async () =>
  page.evaluate(`(() => {
    const outer = [...document.querySelectorAll("div")].find((el) => String(el.className).includes("bottom-[calc(100%+2.25rem)]"));
    if (!outer) return false;
    const card = outer.firstElementChild;
    if (!card) return false;
    return getComputedStyle(card).opacity === "1" && card.getAttribute("aria-hidden") !== "true";
  })()`);

const saveDisabled = async () =>
  page.evaluate(`(() => {
    const button = [...document.querySelectorAll("button")].find((el) => el.innerText.trim() === "保存");
    return button ? button.disabled : false;
  })()`);

try {
  await page.send("Security.setIgnoreCertificateErrors", { ignore: true });
  await page.setViewport(390, 844, true);
  await page.setCookie("libellum_session", cookie);
  await page.evaluate(`localStorage.setItem("libevra.language", "zh-CN")`);

  await runCase(results, "首页导航上方出现奖励通知横幅", async () => {
    await page.navigate(`${BASE}/`);
    await page.waitFor(`document.body.innerText.includes("明细")`, 15000);
    await page.waitFor(`document.body.innerText.includes("获得新头像")`, 10000);
    assert(await bannerPresent(), "横幅未出现在导航上方");
    await page.screenshot(`${OUT}/01-home-banner.png`);
    return "banner shown above bottom nav";
  });

  await runCase(results, "打开“+”菜单时通知横幅让位不遮挡", async () => {
    await page.evaluate(`document.querySelector("nav button[aria-expanded]")?.click()`);
    await page.waitFor(
      `document.querySelector("nav button[aria-expanded]")?.getAttribute("aria-expanded") === "true"`,
      5000,
    );
    await new Promise((done) => setTimeout(done, 250));
    assert(!(await bannerPresent()), "菜单展开时横幅仍然显示");
    await page.screenshot(`${OUT}/02-home-menu-open.png`);
    await page.evaluate(`document.querySelector("nav button[aria-expanded]")?.click()`);
    await page.waitFor(
      `document.querySelector("nav button[aria-expanded]")?.getAttribute("aria-expanded") === "false"`,
      5000,
    );
    return "banner hidden while entry menu open";
  });

  await runCase(results, "点击“查看头像收藏”进入头像页", async () => {
    await page.waitFor(`document.body.innerText.includes("查看头像收藏")`, 8000);
    await page.evaluate(`(() => {
      const button = [...document.querySelectorAll("button")].find((el) => el.innerText.trim() === "查看头像收藏");
      if (!button) throw new Error("no banner CTA");
      button.click();
    })()`);
    await page.waitFor(`location.pathname === "/profile/avatar"`, 10000);
    await page.waitFor(`document.querySelector('button[aria-label="倒悬"]') !== null`, 8000);
    await page.screenshot(`${OUT}/03-avatar-page.png`);
    return "navigated to /profile/avatar";
  });

  await runCase(results, "特典「倒悬」锁定态：条件文案 + 保存禁用", async () => {
    await page.evaluate(`document.querySelector('button[aria-label="倒悬"]')?.click()`);
    await page.waitFor(`document.body.innerText.includes("世界哲学日")`, 6000);
    assert(await saveDisabled(), "锁定头像的保存按钮应禁用");
    await page.screenshot(`${OUT}/04-avatar-locked-daoxuan.png`);
    return "locked state visible and save disabled";
  });

  await runCase(results, "创作注记可打开并展示致敬声明", async () => {
    await page.evaluate(`(() => {
      const button = [...document.querySelectorAll("button")].find((el) => el.innerText.trim() === "创作注记");
      if (!button) throw new Error("no creation note entry");
      button.click();
    })()`);
    await page.waitFor(`document.body.innerText.includes("非官方致敬创作")`, 6000);
    await page.screenshot(`${OUT}/05-creation-note.png`);
    await page.evaluate(`(() => {
      const button = [...document.querySelectorAll("button")].find((el) => el.innerText.trim() === "知道了");
      button?.click();
    })()`);
    return "creation note sheet shows tribute notice";
  });

  await runCase(results, "英文界面：系列名、锁定条件与注记入口", async () => {
    await page.evaluate(`localStorage.setItem("libevra.language", "en-US")`);
    await page.navigate(`${BASE}/profile/avatar`);
    await page.waitFor(`document.body.innerText.includes("Choose avatar")`, 10000);
    await page.evaluate(`document.querySelector('button[aria-label="The Hanged"]')?.click()`);
    await page.waitFor(`document.body.innerText.includes("World Philosophy Day")`, 6000);
    await page.waitFor(`document.body.innerText.includes("Creation note")`, 3000);
    await page.screenshot(`${OUT}/06-avatar-en.png`);
    await page.evaluate(`(() => {
      const button = [...document.querySelectorAll("button")].find((el) => el.innerText.trim() === "Creation note");
      if (button) button.click();
    })()`);
    await page.waitFor(`document.body.innerText.includes("unofficial tribute")`, 6000);
    await page.screenshot(`${OUT}/07-creation-note-en.png`);
    return "English avatar page renders";
  });

  await runCase(results, "展示后事件标记为已确认", async () => {
    const after = await api(API, "/avatar-rewards", { cookie });
    const pending = after.data?.pendingEvents ?? [];
    assert(pending.length === 0, `仍有 ${pending.length} 条待通知事件`);
    assert((after.data?.unlocked ?? []).some((entry) => entry.avatarId === "descent-special"), "未包含降临解锁记录");
    return "pending events confirmed after display";
  });
} finally {
  await page.close();
}

const failed = results.filter((entry) => entry.status === "fail");
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2), "utf8");
console.log(failed.length === 0 ? "ALL PASS" : `${failed.length} FAILED`);
process.exitCode = failed.length === 0 ? 0 : 1;
