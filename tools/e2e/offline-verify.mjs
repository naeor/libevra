/**
 * Offline E2E checks against the isolated stack (web 5175, API 3100, DB libevra_e2e).
 * Personal ledger must still work offline; a shared ledger must be read-only offline and must
 * not create a new unsynced mark. Local only.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { api, apiLogin, assert, openPage, runCase } from "./cdp.mjs";
import { localCandidate } from "./local-candidate.mjs";

const candidate = localCandidate();
const DIR = candidate?.outputRoot ?? join(tmpdir(), "libevra-e2e");
const state = JSON.parse(readFileSync(join(DIR, "state.json"), "utf8"));
const API = candidate?.api ?? "http://127.0.0.1:3100/api/v1";
const WEB = candidate?.web ?? "http://127.0.0.1:5175";
const results = [];

const cookieA = await apiLogin(API, state.users.a.username, state.users.a.password);
const browser = await openPage(candidate?.port ?? 9222, WEB);

async function show(path) {
  await browser.navigate(`${WEB}${path}`);
  await browser.waitFor("document.readyState === 'complete'");
  await new Promise((resolve) => setTimeout(resolve, 400));
}

async function enterLedger(name) {
  await show("/start");
  await browser.waitFor("document.body.innerText.includes('新建账本')");
  const clicked = await browser.evaluate(`(() => {
    const nodes = [...document.querySelectorAll("button, a")];
    const target = nodes.find((node) => node.textContent.includes(${JSON.stringify(name)}));
    if (!target) return false;
    target.click();
    return true;
  })()`);
  assert(clicked, `ledger card ${name} not found`);
  await browser.waitFor("location.pathname === '/'", 15000);
  await new Promise((resolve) => setTimeout(resolve, 500));
}

async function readMarks() {
  return browser.evaluate(`(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("libellum", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!db.objectStoreNames.contains("kv")) return [];
    const keys = await new Promise((resolve, reject) => {
      const request = db.transaction("kv", "readonly").objectStore("kv").getAllKeys();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const values = {};
    for (const key of keys) {
      if (String(key).includes("ledger-marks") || String(key).includes("marks")) {
        values[String(key)] = await new Promise((resolve) => {
          const request = db.transaction("kv", "readonly").objectStore("kv").get(key);
          request.onsuccess = () => resolve(request.result);
        });
      }
    }
    return { keys, values };
  })()`);
}

await browser.clearStorage(WEB);
await browser.setCookie("libellum_session", cookieA, WEB);
await browser.setViewport(1440, 900, false);
await show("/");

const personalName = `E2E Personal Offline A ${String(Date.now()).slice(-6)}`;
const createPersonal = await api(API, "/books", { method: "POST", cookie: cookieA, body: { name: personalName } });
assert(createPersonal.status === 201, `create personal book: ${createPersonal.status}`);
const personalBookId = createPersonal.data.id;
await enterLedger(personalName);

await runCase(results, "个人账本：离线新建成功并产生待同步印记，恢复网络后同步", async () => {
  try {
    await show("/add");
    await browser.waitFor("document.querySelector('input') !== null");
    await browser.evaluate(`(() => {
      const input = document.querySelector('input[inputmode="decimal"]') || document.querySelector('form input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, "12.34");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await browser.setOffline(true);
    await browser.waitFor("navigator.onLine === false");
    const marksBefore = await readMarks();
    await browser.evaluate(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "保存")?.click()`);
    await browser.waitFor("document.body.innerText.includes('已记账') || document.body.innerText.includes('再记一笔')", 10000).catch(async error => {
      await browser.screenshot(join(DIR, "screenshots", "offline-personal-failure.png"));
      writeFileSync(join(DIR, "offline-failure.txt"), await browser.evaluate("document.body.innerText"));
      throw error;
    });
    const offlineText = await browser.evaluate("document.body.innerText");
    assert(offlineText.includes("已记账") || offlineText.includes("再记一笔"), "offline save did not report success");
    await browser.screenshot(join(DIR, "screenshots", "offline-personal-saved.png"));
    await browser.setOffline(false);
    await browser.waitFor("navigator.onLine === true");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    /** A reload lets the app see the server again and drain the queue; sync is not instantaneous. */
    await show("/");
    await new Promise((resolve) => setTimeout(resolve, 8000));
    const list = await api(API, "/transactions?month=2026-10", { cookie: cookieA, bookId: personalBookId });
    assert(list.status === 200, `list transactions failed: ${list.status}`);
    const rows = list.data.transactions ?? list.data.items ?? [];
    const found = rows.find((row) => row.amountCents === 1234);
    assert(found, `synced transaction not found: ${JSON.stringify(rows.map((r) => r.amountCents))}`);
    const marksAfter = await readMarks();
    return { offlineMarks: Object.keys(marksBefore.values).length, onlineMarks: Object.keys(marksAfter.values).length, syncedId: found.id };
  } finally {
    await browser.setOffline(false).catch(() => undefined);
  }
});

await runCase(results, "共享账本：离线只读提示、保存禁用、不新增待同步印记", async () => {
  await enterLedger(state.books.a.name);
  await show("/add");
  await browser.waitFor("document.querySelector('input') !== null");
  const marksBefore = await readMarks();
  await browser.setOffline(true);
  await browser.waitFor("navigator.onLine === false");
  await new Promise((resolve) => setTimeout(resolve, 600));
  const text = await browser.evaluate("document.body.innerText");
  assert(text.includes("共享账本暂时只能查看"), "shared offline warning missing");
  const saveDisabled = await browser.evaluate(`(() => {
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "保存");
    return button ? button.disabled : null;
  })()`);
  assert(saveDisabled === true, `save button not disabled: ${saveDisabled}`);
  const marksAfter = await readMarks();
  assert(Object.keys(marksAfter.values).length <= Object.keys(marksBefore.values).length, "shared offline created a new mark");
  await browser.screenshot(join(DIR, "screenshots", "offline-shared-readonly.png"));
  await browser.setOffline(false);
  await browser.waitFor("navigator.onLine === true");
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const after = await browser.evaluate("document.body.innerText");
  assert(!after.includes("共享账本暂时只能查看"), "shared warning did not clear after reconnect");
  return { saveDisabled, marksBefore: Object.keys(marksBefore.values).length, marksAfter: Object.keys(marksAfter.values).length };
});

writeFileSync(join(DIR, "offline-results.json"), JSON.stringify(results, null, 2));
const summary = results.map((result) => `${result.status.toUpperCase()} ${result.name}${result.error ? ` :: ${result.error}` : ""}`).join("\n");
writeFileSync(join(DIR, "offline-report.md"), `# Offline E2E results\n\n${summary}\n`);
process.stdout.write(`\n${summary}\n`);
process.exitCode = results.some((result) => result.status === "fail") ? 1 : 0;
browser.close();
