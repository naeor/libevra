/**
 * Real-browser E2E checks against the isolated stack (web 5175, API 3100, DB libevra_e2e).
 * Uses two isolated Edge instances (CDP 9222 / 9223). Local only.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { api, apiLogin, assert, openPage, runCase } from "./cdp.mjs";

const DIR = join(tmpdir(), "libevra-e2e");
const state = JSON.parse(readFileSync(join(DIR, "state.json"), "utf8"));
const API = "http://127.0.0.1:3100/api/v1";
const WEB = "http://127.0.0.1:5175";
const results = [];
const screenshotDir = join(DIR, "screenshots");

const cookieA = await apiLogin(API, state.users.a.username, state.users.a.password);
const cookieB = await apiLogin(API, state.users.b.username, state.users.b.password);

const browserA = await openPage(9222);
const browserB = await openPage(9223);

async function show(page, path) {
  await page.navigate(`${WEB}${path}`);
  await page.waitFor("document.readyState === 'complete'");
  await new Promise((resolve) => setTimeout(resolve, 350));
}

async function bodyText(page) {
  return page.evaluate("document.body.innerText");
}

async function loginPage(page, cookie) {
  await page.clearStorage();
  await page.setCookie("libellum_session", cookie);
  await page.setViewport(1440, 900, false);
  await show(page, "/");
  await page.waitFor("document.body.innerText.includes('明细')");
}

/** Enter `bookId` through the real /start UI, so the device's own current-book memory changes. */
async function setCurrentBookA(bookId) {
  const name = bookId === bookA ? bookAName : bookBName;
  await loginPage(browserA, cookieA);
  await show(browserA, "/start");
  await browserA.waitFor("document.body.innerText.includes('上滑进入我的账本') || document.body.innerText.includes('共 ')");
  const clicked = await browserA.evaluate(`(() => {
    const nodes = [...document.querySelectorAll("button, a")];
    const target = nodes.find((node) => node.textContent.includes(${JSON.stringify(name)}) && !node.textContent.includes("重命名") && !node.textContent.includes("成员"));
    if (!target) return false;
    target.click();
    return true;
  })()`);
  assert(clicked, `could not find ledger card for ${name}`);
  await browserA.waitFor("location.pathname === '/'", 15000);
  await new Promise((resolve) => setTimeout(resolve, 500));
}

/* ------------------------------------------------------------------ */
/* G3: 我的 / 设置                                                      */
/* ------------------------------------------------------------------ */
await runCase(results, "登录后进入应用并显示底部「我的」", async () => {
  await loginPage(browserA, cookieA);
  const text = await bodyText(browserA);
  assert(text.includes("明细") && text.includes("我的"), "bottom nav missing 我的/明细");
  return "bottom nav shows 我的";
});

await runCase(results, "设置首页：四张分类卡片、无系统管理、无导出/导入", async () => {
  await show(browserA, "/settings");
  const title = await browserA.evaluate("document.querySelector('h1')?.textContent ?? ''");
  const text = await bodyText(browserA);
  assert(text.includes("记账偏好") && text.includes("显示与数据") && text.includes("账号安全") && text.includes("关于 Libevra"), "category cards missing");
  assert(!text.includes("系统管理"), "non-admin should not see 系统管理");
  assert(!text.includes("导出数据") && !text.includes("导入历史账"), "export/import must not be on settings home");
  return `title=${title}`;
});

await runCase(results, "设置首页默认币种快捷控件：改 USD 立即生效且不跳转", async () => {
  await show(browserA, "/settings");
  await browserA.evaluate("document.querySelector('[data-currency=\"USD\"]').click()");
  await browserA.waitFor("document.body.innerText.includes('已保存')", 8000);
  const selected = await browserA.evaluate("document.querySelector('[data-currency=\"USD\"]')?.getAttribute('aria-pressed')");
  const path = await browserA.evaluate("location.pathname");
  assert(selected === "true", "USD not selected");
  assert(path === "/settings", `unexpected navigation to ${path}`);
  return "USD selected, still /settings";
});

await runCase(results, "设置首页币种刷新后保持，然后恢复 CNY", async () => {
  await show(browserA, "/settings");
  const usd = await browserA.evaluate("document.querySelector('[data-currency=\"USD\"]')?.getAttribute('aria-pressed')");
  assert(usd === "true", "USD did not persist after reload");
  await browserA.evaluate("document.querySelector('[data-currency=\"CNY\"]').click()");
  await browserA.waitFor("document.querySelector('[data-currency=\"CNY\"]')?.getAttribute('aria-pressed') === 'true'", 8000);
  return "persisted then restored";
});

await runCase(results, "记账偏好子页：条目完整、返回设置首页", async () => {
  await show(browserA, "/settings");
  await browserA.evaluate("document.querySelector('[data-section=\"/settings/preferences\"]').click()");
  await browserA.waitFor("location.pathname === '/settings/preferences'");
  const text = await bodyText(browserA);
  for (const item of ["默认币种", "大键盘输入金额", "沿用上一笔", "登录后直接开始记账", "币种显示顺序", "主界面按钮位置"]) {
    assert(text.includes(item), `missing ${item}`);
  }
  await browserA.evaluate("document.querySelector('button')?.click()");
  await browserA.waitFor("location.pathname === '/settings'", 8000);
  return "subpage + back OK";
});

await runCase(results, "我的页：只剩个人中心入口，分类/标签/支付方式已移出", async () => {
  await show(browserA, "/me");
  const text = await bodyText(browserA);
  for (const item of ["个人资料", "我的账本", "下载管理", "软件更新", "设置", "退出登录"]) {
    assert(text.includes(item), `missing ${item}`);
  }
  for (const moved of ["分类管理", "支付方式", "标签"]) {
    assert(!text.includes(moved), `${moved} must not be in /me`);
  }
  return "my page correct";
});

/* ------------------------------------------------------------------ */
/* G3: 账本/协作、详情、设置、切换隔离                                    */
/* ------------------------------------------------------------------ */
const bookA = state.books.a.id;
const bookB = state.books.b.id;
const bookAName = state.books.a.name;
const bookBName = state.books.b.name;

await runCase(results, "共享账本主页：协作标题、当前卡片双点击区、铃铛+齿轮", async () => {
  await setCurrentBookA(bookA);
  await show(browserA, "/ledger");
  await browserA.waitFor("document.body.innerText.includes('切换账本')");
  const text = await bodyText(browserA);
  assert(text.includes("协作"), "shared ledger title missing");
  const left = await browserA.evaluate(`document.querySelector('a[href="/books/${bookA}"]') !== null`);
  const switchLink = await browserA.evaluate("document.querySelector('a[href=\"/start\"]') !== null");
  const gear = await browserA.evaluate("document.querySelector('button[aria-label=\"账本设置\"]') !== null");
  const bell = await browserA.evaluate("document.querySelector('button[aria-label*=\"提醒\"]') !== null");
  assert(left && switchLink && gear && bell, `ledger actions/card links missing left=${left} switch=${switchLink} gear=${gear} bell=${bell}`);
  return "card links + gear + bell present";
});

await runCase(results, "当前账本卡片：右区图标在文字上方且居中", async () => {
  await show(browserA, "/ledger");
  await browserA.waitFor("document.querySelector('a[href=\"/start\"]') !== null");
  const layout = await browserA.evaluate(`(() => {
    const link = document.querySelector('a[href="/start"]');
    const icon = link.querySelector('svg');
    const text = [...link.querySelectorAll('span')].find((s) => s.textContent.trim() === '切换账本');
    if (!icon || !text) return null;
    const l = link.getBoundingClientRect(), i = icon.getBoundingClientRect(), t = text.getBoundingClientRect();
    return { iconW: i.width, iconCenter: i.left + i.width / 2, linkCenter: l.left + l.width / 2, iconBottom: i.bottom, textTop: t.top, linkH: l.height };
  })()`);
  assert(layout, "icon/text not found");
  assert(layout.iconW >= 28 && layout.iconW <= 40, `icon width ${layout.iconW} not ~32px`);
  assert(Math.abs(layout.iconCenter - layout.linkCenter) < 2, "icon not horizontally centred");
  assert(layout.iconBottom <= layout.textTop + 1, "text is not below icon");
  return JSON.stringify(layout);
});

await runCase(results, "账本详情：左侧整块进入", async () => {
  await show(browserA, "/ledger");
  await browserA.evaluate(`document.querySelector('a[href="/books/${bookA}"]').click()`);
  await browserA.waitFor(`location.pathname === '/books/${bookA}'`);
  const text = await bodyText(browserA);
  assert(text.includes("账本详情"), "detail title missing");
  return "detail opened";
});

await runCase(results, "切换板：两本账仍有稳定高度（约 45–55%）", async () => {
  await show(browserA, `/books/${bookA}/settings`);
  await browserA.evaluate("[...document.querySelectorAll('button')].find((b) => b.textContent.trim().includes('切换'))?.click()");
  await browserA.waitFor("document.querySelector('[role=\"dialog\"]') !== null");
  const ratio = await browserA.evaluate("document.querySelector('[role=\"dialog\"]').getBoundingClientRect().height / innerHeight");
  const hint = await bodyText(browserA);
  assert(ratio >= 0.4 && ratio <= 0.6, `sheet height ratio ${ratio}`);
  assert(hint.includes("不会更改当前记账账本"), "hint missing");
  await browserA.screenshot(join(screenshotDir, "switch-sheet-desktop.png"));
  await browserA.evaluate("document.querySelector('[role=\"dialog\"] button[aria-label=\"关闭账本列表\"]').click()");
  return `ratio=${ratio.toFixed(3)}`;
});

await runCase(results, "目标切换：只改 URL，不改当前记账账本", async () => {
  await setCurrentBookA(bookA);
  await show(browserA, `/books/${bookA}/settings`);
  await browserA.evaluate("[...document.querySelectorAll('button')].find((b) => b.textContent.trim().includes('切换'))?.click()");
  await browserA.waitFor("document.querySelector('[role=\"dialog\"]') !== null");
  await browserA.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.includes(${JSON.stringify(bookBName)}))?.click()`);
  await browserA.waitFor(`location.pathname === '/books/${bookB}/settings'`);
  await show(browserA, "/ledger");
  await browserA.waitFor("document.body.innerText.includes('切换账本')");
  const text = await bodyText(browserA);
  assert(text.includes(bookAName), "current ledger changed after target switch");
  return "target changed, current ledger unchanged";
});

await runCase(results, "目标账本设置：viewer(A 在 B) 名称不可编辑，分类/标签/支付方式入口可达", async () => {
  await show(browserA, `/books/${bookB}/settings`);
  const text = await bodyText(browserA);
  assert(text.includes("正在管理") && text.includes(bookBName), "target identity missing");
  const hasNameButton = await browserA.evaluate("[...document.querySelectorAll('button')].some((b) => b.textContent.includes('账本名称'))");
  assert(!hasNameButton, "viewer should not have editable name row");
  for (const label of ["分类管理", "标签管理", "支付方式", "导出数据", "导入历史账"]) assert(text.includes(label), `missing ${label}`);
  return "viewer target settings read-only";
});

await runCase(results, "viewer：分类/标签/支付方式页面不提供任何写入口", async () => {
  for (const section of ["categories", "tags", "payment-methods"]) {
    await show(browserA, `/books/${bookB}/settings/${section}`);
    await browserA.waitFor("document.body.innerText.includes('查看者')");
    const state = await browserA.evaluate(`(() => ({
      addCategory: document.querySelector('input[placeholder="新分类名称"]') !== null,
      addPayment: document.querySelector('input[placeholder="新支付方式"]') !== null,
      addTag: document.querySelector('input[placeholder="新标签名称"]') !== null,
      addTagButton: [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "添加标签"),
      deleteButtons: [...document.querySelectorAll("button")].filter((b) => ["永久删除", "归档", "恢复", "删除"].includes(b.textContent.trim())).length,
      text: document.body.innerText,
    }))()`);
    assert(!state.addCategory && !state.addPayment && !state.addTag && !state.addTagButton, `write input still visible on ${section}`);
    assert(state.deleteButtons === 0, `${state.deleteButtons} write buttons still visible on ${section}`);
    assert(state.text.includes("只能查看"), `read-only explanation missing on ${section}`);
  }
  return "no write entry for viewer on all three pages";
});

/* ------------------------------------------------------------------ */
/* G3: 响应式（手机宽度）                                                */
/* ------------------------------------------------------------------ */
await runCase(results, "手机宽度：卡片上下分区、无横向溢出、图标居中", async () => {
  await browserA.setViewport(390, 844, true);
  await show(browserA, "/ledger");
  await browserA.waitFor("document.querySelector('a[href=\"/start\"]') !== null");
  const layout = await browserA.evaluate(`(() => {
    const link = document.querySelector('a[href="/start"]');
    const icon = link.querySelector('svg');
    const text = [...link.querySelectorAll('span')].find((s) => s.textContent.trim() === '切换账本');
    const l = link.getBoundingClientRect(), i = icon.getBoundingClientRect(), t = text.getBoundingClientRect();
    return { iconW: i.width, iconX: i.left + i.width / 2, linkX: l.left + l.width / 2, iconBottom: i.bottom, textTop: t.top, scrollW: document.documentElement.scrollWidth, innerW: innerWidth };
  })()`);
  assert(layout.scrollW <= layout.innerW + 1, `horizontal overflow ${layout.scrollW} > ${layout.innerW}`);
  assert(Math.abs(layout.iconX - layout.linkX) < 2, "mobile icon not centred");
  assert(layout.iconBottom <= layout.textTop + 1, "mobile text not below icon");
  await browserA.screenshot(join(screenshotDir, "ledger-mobile.png"));
  await browserA.setViewport(1440, 900, false);
  return JSON.stringify(layout);
});

/* ------------------------------------------------------------------ */
/* G3: 双账号 UI 角色差异                                               */
/* ------------------------------------------------------------------ */
await runCase(results, "双账号：B 在 A 中作为 editor 可看到名称编辑入口", async () => {
  await browserB.clearStorage();
  await browserB.setCookie("libellum_session", cookieB);
  await browserB.setViewport(1440, 900, false);
  await show(browserB, `/books/${bookA}/settings`);
  const text = await bodyText(browserB);
  const hasNameButton = await browserB.evaluate("[...document.querySelectorAll('button')].some((b) => b.textContent.includes('账本名称'))");
  assert(text.includes(bookAName), "B cannot see A settings");
  assert(hasNameButton, "editor should have editable name row");
  return "editor can edit";
});

await runCase(results, "双账号：A 把 B 降为 viewer 后，B 刷新界面只读且写 API 403", async () => {
  const patch = await api(API, `/books/members/${state.members.a.userId}`, {
    method: "PATCH", cookie: cookieA, bookId: bookA,
    body: { role: "viewer" },
  });
  assert(patch.status === 200, `role change failed: ${patch.status}`);
  await show(browserB, `/books/${bookA}/settings`);
  const hasNameButton = await browserB.evaluate("[...document.querySelectorAll('button')].some((b) => b.textContent.includes('账本名称'))");
  assert(!hasNameButton, "viewer still sees editable name row");
  const write = await api(API, "/categories", { method: "POST", cookie: cookieB, bookId: bookA, body: { name: "E2E Forbidden", kind: "expense" } });
  assert(write.status === 403, `viewer write returned ${write.status}`);
  const restore = await api(API, `/books/members/${state.members.a.userId}`, {
    method: "PATCH", cookie: cookieA, bookId: bookA,
    body: { role: "editor" },
  });
  assert(restore.status === 200, "could not restore editor role");
  return "viewer read-only + 403";
});

await runCase(results, "目标账本管理页：B 以 editor 在 A 的分类页新建，API 落到 A", async () => {
  await api(API, `/books/members/${state.members.a.userId}`, { method: "PATCH", cookie: cookieA, bookId: bookA, body: { role: "editor" } });
  await browserB.clearStorage();
  await browserB.setCookie("libellum_session", cookieB);
  await browserB.setViewport(1440, 900, false);
  await show(browserB, `/books/${bookA}/settings/categories`);
  const subtitle = await browserB.evaluate("document.body.innerText");
  assert(subtitle.includes(bookAName), "target categories subtitle does not name book A");
  const name = `E2E Target UI ${String(Date.now()).slice(-6)}`;
  const created = await browserB.evaluate(`(() => {
    const input = document.querySelector('input[placeholder="新分类名称"]');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, ${JSON.stringify(name)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  assert(created, "category input missing");
  await browserB.evaluate("[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '添加')?.click()");
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const ledger = await api(API, "/ledger", { cookie: cookieA, bookId: bookA });
  assert(ledger.data.categories.some((category) => category.name === name), "category did not land in target book A");
  return name;
});

/* ------------------------------------------------------------------ */
/* G3: 删除 UI 端到端（测试对象，不影响基线）                             */
/* ------------------------------------------------------------------ */
await runCase(results, "分类永久删除 UI：影响数、替换、取消与确认后 API 一致", async () => {
  const unique = `E2E UI Delete ${String(Date.now()).slice(-6)}`;
  const category = await api(API, "/categories", { method: "POST", cookie: cookieA, bookId: bookA, body: { name: unique, kind: "expense" } });
  assert(category.status === 201, `create temp category: ${category.status}`);
  const categoryId = category.data.id;
  const txId = crypto.randomUUID();
  const tx = await api(API, "/transactions", {
    method: "POST", cookie: cookieA, bookId: bookA,
    body: {
      id: txId, idempotencyKey: txId, kind: "expense", amountCents: 4321, currency: "CNY",
      categoryId, paymentMethodId: state.organisers.a.payId,
      occurredAt: new Date().toISOString(), occurredLocalDate: new Date().toISOString().slice(0, 10), occurredTz: "Asia/Shanghai",
      note: "E2E UI delete target", tagIds: [],
    },
  });
  assert([200, 201].includes(tx.status), `create temp transaction: ${tx.status}`);
  await show(browserA, `/books/${bookA}/settings/categories`);
  await browserA.evaluate(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "永久删除" && b.closest("li")?.textContent.includes(${JSON.stringify(unique)}))?.click()`);
  await browserA.waitFor("document.body.innerText.includes('永久删除「')");
  const dialog = await browserA.evaluate("document.body.innerText");
  assert(dialog.includes("有 1 笔记账正在使用这个分类"), "impact count missing from dialog");
  assert(dialog.includes("这是共享账本"), "shared warning missing from delete dialog");
  const hasSelect = await browserA.evaluate("document.querySelector('[role=\"alertdialog\"] select') !== null");
  assert(hasSelect, "replacement select missing");
  await browserA.evaluate("[...document.querySelectorAll('[role=\"alertdialog\"] button')].find((b) => b.textContent.trim() === '取消')?.click()");
  const afterCancel = await api(API, "/ledger", { cookie: cookieA, bookId: bookA });
  assert(afterCancel.data.categories.some((item) => item.id === categoryId), "cancel deleted the category");
  await browserA.evaluate(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "永久删除" && b.closest("li")?.textContent.includes(${JSON.stringify(unique)}))?.click()`);
  await browserA.waitFor("document.querySelector('[role=\"alertdialog\"] select') !== null");
  await browserA.evaluate(`(() => {
    const select = document.querySelector('[role="alertdialog"] select');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    setter.call(select, ${JSON.stringify(state.organisers.a.shopId)});
    select.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await browserA.evaluate("[...document.querySelectorAll('[role=\"alertdialog\"] button')].find((b) => b.textContent.trim() === '永久删除')?.click()");
  await browserA.waitFor("document.body.innerText.includes('已删除')", 10000);
  const finalLedger = await api(API, "/ledger", { cookie: cookieA, bookId: bookA });
  assert(!finalLedger.data.categories.some((item) => item.id === categoryId), "category still exists after delete");
  const list = await api(API, "/transactions?month=2026-10&limit=100", { cookie: cookieA, bookId: bookA });
  const moved = (list.data.items ?? []).find((item) => item.id === txId);
  assert(moved && moved.categoryId === state.organisers.a.shopId, "history was not re-pointed to replacement");
  return "impact + replacement + cancel + confirm verified";
});

/* ------------------------------------------------------------------ */
/* G3: 管理员设置卡片（专用 E2E 管理员，验证后撤销）                      */
/* ------------------------------------------------------------------ */
await runCase(results, "管理员：设置首页出现系统管理卡片并进入 /admin", async () => {
  const admin = state.users.admin;
  assert(admin?.username && admin?.password, "admin test user missing");
  const cookieAdmin = await apiLogin(API, admin.username, admin.password);
  await browserB.clearStorage();
  await browserB.setCookie("libellum_session", cookieAdmin);
  await show(browserB, "/settings");
  const text = await bodyText(browserB);
  assert(text.includes("系统管理"), "admin card missing for admin account");
  await browserB.evaluate("document.querySelector('[data-section=\"/admin\"]')?.click()");
  await browserB.waitFor("location.pathname === '/admin'", 10000);
  const adminText = await bodyText(browserB);
  assert(adminText.includes("概览") || adminText.includes("管理"), "admin overview did not render");
  await browserB.screenshot(join(screenshotDir, "admin-home.png"));
  return "admin card + overview";
});
await browserA.setViewport(1440, 900, false);
const summary = results.map((result) => `${result.status.toUpperCase()} ${result.name}${result.error ? ` :: ${result.error}` : ""}`).join("\n");
writeFileSync(join(DIR, "browser-results.json"), JSON.stringify(results, null, 2));
writeFileSync(join(DIR, "browser-report.md"), `# Browser E2E results\n\n${summary}\n`);
process.stdout.write(`\n${summary}\n`);
process.exitCode = results.some((result) => result.status === "fail") ? 1 : 0;
browserA.close();
browserB.close();
