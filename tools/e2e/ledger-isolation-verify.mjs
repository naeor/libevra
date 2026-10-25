/** 仅 localhost：专用浏览器、既有测试账号、新建两本隔离测试账，不触碰生产。 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { api, apiLogin, assert, openPage, runCase } from "./cdp.mjs";

const BASE = process.env.LIBEVRA_E2E_BASE ?? "https://127.0.0.1:5173";
if (!["127.0.0.1", "localhost"].includes(new URL(BASE).hostname)) throw new Error("只允许本机测试");
const API = "http://127.0.0.1:3000/api/v1";
const OUT = process.env.LIBEVRA_E2E_OUT ?? "_backups/ledger-isolation-20261025";
mkdirSync(OUT, { recursive: true });
const fixture = JSON.parse(readFileSync("_backups/avatar-page-copy-20261025/fixture.json", "utf8"));
const session = await apiLogin(API, fixture.username, fixture.password);
const call = (path, options = {}) => api(API, path, { cookie: session, ...options });
const user = (await call("/auth/me")).data.user;
const a = (await call("/books", { method: "POST", body: { name: "隔离回归原账本" } })).data;
const b = (await call("/books", { method: "POST", body: { name: "隔离回归Test01" } })).data;
assert(a.id && b.id, "创建测试账本失败");
const created = await call("/transactions", { method: "POST", bookId: a.id, body: {
  id: randomUUID(), idempotencyKey: randomUUID(), kind: "expense", amountCents: 12345, currency: "CNY",
  categoryId: null, paymentMethodId: null, occurredAt: "2026-10-25T07:00:00Z", occurredLocalDate: "2026-10-25",
  occurredTz: "Asia/Shanghai", note: "隔离回归专用旧记录", tagIds: [],
} });
assert(created.status === 201, "创建原账本记录失败");
const ledgerA = (await call("/ledger", { bookId: a.id })).data;
const cache = JSON.stringify({ timestamp: Date.now(), buster: "", clientState: { mutations: [], queries: [
  { queryKey: ["ledger"], queryHash: '["ledger"]', state: { data: ledgerA, status: "success", dataUpdatedAt: Date.now() } },
  { queryKey: ["transactions", { month: "2026-10" }], queryHash: "legacy-row", state: {
    data: { pages: [{ items: [created.data], nextCursor: null }], pageParams: [null] }, status: "success", dataUpdatedAt: Date.now(),
  } },
] } });
const page = await openPage(9241, BASE);
const results = [];
try {
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `window.runtimeImport = path => import(performance.getEntriesByType('resource').map(r=>r.name).findLast(url => new URL(url).pathname === path) ?? path);` });
  await page.send("Security.setIgnoreCertificateErrors", { ignore: true });
  await page.setCookie("libellum_session", session);
  await page.navigate(BASE + "/");
  await page.waitFor('document.body.innerText.includes("当前账本")', 15000);
  // 写入独立测试浏览器的历史缓存，模拟旧版创建新账本后的磁盘状态。
  await page.evaluate(`(async () => {
    const { writeValue } = await window.runtimeImport('/src/lib/offline/storage.ts');
    await writeValue('auth-user', ${JSON.stringify(user)});
    await writeValue('offline-scope', {account: ${JSON.stringify(user.id)}, ledger: ${JSON.stringify(a.id)}});
    await writeValue('current-book', ${JSON.stringify(b.id)});
    await writeValue('query-cache', ${JSON.stringify(cache)});
    await writeValue('query-cache:' + ${JSON.stringify(user.id + ":" + a.id)}, ${JSON.stringify(cache)});
    await writeValue('ledger-months', {'2026-10': [${JSON.stringify(created.data)}]});
    await writeValue('ledger-marks', {});
    await writeValue('ledger-months:' + ${JSON.stringify(user.id + ":" + a.id)}, {'2026-10': [${JSON.stringify(created.data)}]});
  })()`);

  await runCase(results, "新账本冷启动不继承旧全局缓存", async () => {
    await page.navigate(BASE + "/");
    await page.waitFor(`document.body.innerText.includes('隔离回归Test01')`, 15000);
    const check = await page.evaluate(`(async () => {
      const { readLocalTransactions } = await window.runtimeImport('/src/lib/offline/localLedger.ts');
      const { offlineScope } = await window.runtimeImport('/src/lib/offline/scope.ts');
      return { scope: offlineScope(), rows: (await readLocalTransactions()).map(row => row.id), text: document.body.innerText };
    })()`);
    assert(check.scope === user.id + ":" + b.id, "启动作用域未对应新账本");
    assert(check.rows.length === 0, "新账本出现旧记录");
    assert(!check.text.includes("隔离回归专用旧记录"), "页面出现旧备注");
    await page.screenshot(OUT + "/empty-new-ledger.png");
    return { rows: check.rows.length, scopeCorrect: true };
  });

  await runCase(results, "离线读取新账本仍为空，切回原账本保留原记录", async () => {
    await page.setOffline(true);
    const empty = await page.evaluate(`(async () => (await (await window.runtimeImport('/src/lib/offline/localLedger.ts')).readLocalTransactions()).length)()`);
    assert(empty === 0, "离线新账本串账");
    await page.setOffline(false);
    await page.evaluate(`(async () => { await (await window.runtimeImport('/src/lib/currentBook.ts')).selectBookForReload(${JSON.stringify(a.id)}); })()`);
    await page.navigate(BASE + "/");
    await page.waitFor(`document.body.innerText.includes('隔离回归原账本')`, 15000);
    await page.setOffline(true);
    const rows = await page.evaluate(`(async () => (await (await window.runtimeImport('/src/lib/offline/localLedger.ts')).readLocalTransactions()).map(row => row.id))()`);
    assert(rows.includes(created.data.id), "原账本离线记录丢失");
    await page.screenshot(OUT + "/original-ledger-offline.png");
    return { originalEntryPresent: true };
  });

  await runCase(results, "服务端新账本保持零记录", async () => {
    const response = await call("/transactions", { bookId: b.id });
    assert(response.status === 200 && response.data.items.length === 0, "新账本服务器出现旧记录");
    return { serverRows: 0 };
  });
} finally {
  await page.setOffline(false).catch(() => {});
  page.close();
  writeFileSync(OUT + "/results.json", JSON.stringify({ results, testBooks: [a.id, b.id] }, null, 2));
}
if (results.some(result => result.status === "fail")) process.exitCode = 1;
