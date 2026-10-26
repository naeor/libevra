/**
 * 「协作页白屏」回归：旧留言缓存里没有 `reference` 字段时，页面必须仍然可读。
 *
 * 出事的是：1.16.18 给 `/books/messages` 的响应加了 `reference`；1.16.17 写进设备的缓存里
 * 留言没有这个键。`MessageRow` 用 `reference === null` 判断，`undefined` 会漏过去，随后读
 * `.available` 抛错，整页被 ErrorBoundary 接住 —— 就是我们看到的「页面无法显示」。
 *
 * 做法：先让应用自己把真实缓存写进 IndexedDB（格式与线上完全一致），再离开应用页面，把缓存里
 * 留言的 `reference` 删掉——这就是「旧版本写下的缓存」本来的样子。然后 reload 进 /ledger，
 * 只让 `/books/messages` 请求失败（CDP Fetch 域），读的就是缓存本身：
 *   1. buster 已是 v2、但留言缺 reference  -> 组件必须当作「无引用」正常渲染（防线二）；
 *   2. buster 是 v1、留言缺 reference      -> 缓存必须被 buster 丢弃，渲染不能崩（防线一）。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { api, apiLogin, assert, openPage, runCase } from "./cdp.mjs";
import { localCandidate } from "./local-candidate.mjs";

const candidate = localCandidate();
const WEB = candidate?.web ?? "https://127.0.0.1:5173";
const API = candidate?.api ?? "http://127.0.0.1:3000/api/v1";
const OUT = candidate ? join(candidate.outputRoot, "stale-cache") : "_backups/stale-cache-resilience-20261026";
const PORT = candidate?.port ?? 9236;

mkdirSync(OUT, { recursive: true });

const SHARED = candidate?.shared ?? {
  username: "pn_270ce57",
  password: "Profile-7f0bf9f3-3027-4557-917d-e81707a02192",
  bookId: "bb832b1b-e397-49d0-a18d-780cd4b59061",
};

const STALE_BODY = "旧缓存留言-no-reference";
const results = [];
const page = await openPage(PORT, WEB);
await page.setViewport(390, 844, true);

const session = await apiLogin(API, SHARED.username, SHARED.password);
const me = await api(API, "/auth/me", { cookie: session });
const userId = me.data.user.id;

await page.setCookie("libellum_session", session, WEB);
await page.send("Page.addScriptToEvaluateOnNewDocument", {
  source: `window.runtimeImport = (path) => import(path);`,
});
await page.navigate(`${WEB}/`);
await page.waitFor("document.body.innerText.length > 0", 15000);
await page.evaluate(`localStorage.setItem("libevra.language", "zh-CN")`);
await page.navigate(`${WEB}/`);
await page.waitFor("document.body.innerText.length > 0", 15000);

const selected = await page.evaluate(`(async () => {
  const module = await window.runtimeImport("/src/lib/currentBook.ts");
  return await module.selectBookForReload(${JSON.stringify(SHARED.bookId)});
})()`);
assert(selected === true, "选中共享账本失败");

// 让应用自己把「当前真实缓存」写下来：/ledger 会拉留言，persister 节流 1s 后落盘。
await page.navigate(`${WEB}/ledger`);
await page.waitFor("document.body.innerText.length > 0", 15000);
await new Promise((resolve) => setTimeout(resolve, 2500));

const cacheKey = `query-cache:${userId}:${SHARED.bookId}`;

async function withCacheDatabase(work) {
  return await page.evaluate(`(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("libellum", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = database.transaction("kv", "readwrite");
    const store = tx.objectStore("kv");
    let result;
    ${work};
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(undefined);
      tx.onerror = () => reject(tx.error);
    });
    return result;
  })()`);
}

/** 把真实缓存改成「1.16.17 写下的样子」：留言没有 reference，buster 换成指定值。 */
async function forgeOldCache(buster) {
  return await withCacheDatabase(`(async () => {
    const raw = await new Promise((resolve, reject) => {
      const request = store.get(${JSON.stringify(cacheKey)});
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (typeof raw !== "string") throw new Error("query-cache 还没有落盘");
    const parsed = JSON.parse(raw);
    const queries = parsed?.clientState?.queries ?? [];
    const messagesQuery = queries.find((query) => JSON.stringify(query.queryKey) === JSON.stringify(["book-messages"]));
    if (!messagesQuery) throw new Error("缓存里没有 book-messages");
    const messages = messagesQuery.state?.data?.messages ?? [];
    if (messages.length === 0) throw new Error("缓存里的留言为空");
    // 每条都改成同一条「旧缓存留言」：卡片只渲染最新两条，数组顺序不值得再猜——哪两条被渲染
    // 都必须是这一条，断言才不依赖缓存里的排序。
    for (const message of messages) {
      delete message.reference;
      message.body = ${JSON.stringify(STALE_BODY)};
    }
    parsed.buster = ${JSON.stringify(buster)};
    const updated = JSON.stringify(parsed);
    await new Promise((resolve, reject) => {
      const request = store.put(updated, ${JSON.stringify(cacheKey)});
      request.onsuccess = () => resolve(undefined);
      request.onerror = () => reject(request.error);
    });
    result = { buster: parsed.buster, count: messages.length, lastBody: messages[messages.length - 1].body };
  })()`);
}

// 只拦截消息接口；其余请求（页面、脚本、别的 API）照常放行。
//
// ⚠️ **Why the request is held, not failed immediately.** Hydration renders the cached messages
// *before* the refetch settles — that first render is exactly where the old code crashed. If we fail
// the request in the same tick, React Query can flip to the error branch before the DOM is painted,
// and the regression would pass for the wrong reason. Holding the request for a few seconds keeps
// the cached render on screen where we can observe it, then fails (so we also exercise the fallback).
let holdMessages = false;
let heldTotal = 0;
const heldRequests = new Set();
const consoleLines = [];
page.socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.exceptionThrown") {
    consoleLines.push(`exception: ${message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text}`);
    return;
  }
  if (message.method === "Runtime.consoleAPICalled") {
    const text = message.params.args.map((arg) => String(arg.value ?? arg.description ?? "")).join(" ");
    consoleLines.push(`${message.params.type}: ${text.slice(0, 300)}`);
    return;
  }
  if (message.method !== "Fetch.requestPaused") return;
  const { requestId, request } = message.params;
  if (holdMessages && request.url.includes("/books/messages")) {
    heldTotal += 1;
    heldRequests.add(requestId);
    return;
  }
  void page.send("Fetch.continueRequest", { requestId });
});
await page.send("Runtime.enable");
await page.send("Fetch.enable", {
  // 应用用同源相对地址 `/api/v1/...`（Vite 代理），不是 127.0.0.1:3000，所以按路径匹配。
  patterns: [{ urlPattern: "*books/messages*", requestStage: "Request" }],
});

async function openCollabWithStaleCache(buster, { waitForStale } = { waitForStale: true }) {
  holdMessages = true;
  // 必须离开应用页面再改缓存：应用还在跑时 persister 会把内存里的新缓存写回去。
  await page.navigate(`${WEB}/@vite/client`);
  await page.waitFor("document.readyState === 'complete'", 15000);
  const forged = await forgeOldCache(buster);
  await page.navigate(`${WEB}/ledger`);
  await page.waitFor("document.body.innerText.length > 0", 15000);

  // 在请求被放行/失败之前，观察「缓存渲染出来的那一刻」。
  let sawStale = false;
  const snippets = [];
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const body = await page.evaluate("document.body.innerText");
    snippets.push(body.replace(/\s+/g, " ").slice(0, 120));
    if (body.includes(STALE_BODY)) {
      sawStale = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const observedBody = await page.evaluate("document.body.innerText");
  holdMessages = false;
  // 让被 hold 的请求失败，再检查错误兜底不会崩页。
  for (const requestId of heldRequests) {
    void page.send("Fetch.failRequest", { requestId, errorReason: "ConnectionRefused" });
  }
  heldRequests.clear();
  await new Promise((resolve) => setTimeout(resolve, 1200));

  const cacheAfter = await withCacheDatabase(`(async () => {
    const raw = await new Promise((resolve, reject) => {
      const request = store.get(${JSON.stringify(cacheKey)});
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (typeof raw !== "string") return { present: false };
    const parsed = JSON.parse(raw);
    const queries = parsed?.clientState?.queries ?? [];
    const messagesQuery = queries.find((query) => JSON.stringify(query.queryKey) === JSON.stringify(["book-messages"]));
    result = {
      present: true,
      buster: parsed.buster,
      messageKeys: queries.length,
      hasMessages: Boolean(messagesQuery),
      lastBody: messagesQuery?.state?.data?.messages?.at(-1)?.body ?? null,
      hasReference: Object.hasOwn(messagesQuery?.state?.data?.messages?.at(-1) ?? {}, "reference"),
    };
  })()`);

  const state = await page.evaluate(`(() => ({
    path: location.pathname,
    boundary: document.body.innerText.includes("页面无法显示"),
    body: document.body.innerText,
  }))()`);
  return { ...state, forged, sawStale: waitForStale ? sawStale : undefined, snippets, observedBody, cacheAfter, heldTotal, consoleLines: consoleLines.slice(-15) };
}

await runCase(results, "旧缓存（v2 buster）缺少 reference：协作页渲染旧留言为「无引用」且不崩", async () => {
  const state = await openCollabWithStaleCache("v2");
  writeFileSync(
    join(OUT, "debug-v2.json"),
    JSON.stringify({ forged: state.forged, snippets: state.snippets, observedBody: state.observedBody, cacheAfter: state.cacheAfter, heldTotal: state.heldTotal, consoleLines: state.consoleLines }, null, 2),
  );
  assert(state.path === "/ledger", `应停在 /ledger，实际 ${state.path}`);
  assert(!state.boundary, "不应出现「页面无法显示」");
  assert(state.sawStale === true, `旧缓存里的留言应被渲染出来（诊断见 debug-v2.json：${JSON.stringify(state.snippets.slice(-2))} | ${JSON.stringify(state.cacheAfter)}）`);
  await page.screenshot(`${OUT}/01-v2-cache-rendered.png`);
  return { forged: state.forged };
});

await runCase(results, "旧缓存（v1 buster）：整个缓存被丢弃，协作页不崩且不显示旧数据", async () => {
  const state = await openCollabWithStaleCache("v1");
  assert(!state.boundary, "不应出现「页面无法显示」");
  assert(state.body.includes("协作"), "协作页标题应正常");
  assert(state.sawStale === false, "v1 缓存应被 buster 丢弃，而不是被渲染");
  await page.screenshot(`${OUT}/02-v1-cache-discarded.png`);
  return { forged: state.forged };
});

await page.navigate(`${WEB}/@vite/client`);
await page.waitFor("document.readyState === 'complete'", 15000);
await page.send("Fetch.disable").catch(() => {});
writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
const failed = results.filter((result) => result.status === "fail");
process.stdout.write(`\n${results.length - failed.length}/${results.length} passed. Output: ${OUT}\n`);
if (failed.length > 0) process.exitCode = 1;
page.close();
