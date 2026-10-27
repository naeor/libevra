/**
 * K4：正式 /stats 工作台浏览器功能验收（真实 API + 夹具账本）。
 *
 * 环境（本机 PowerShell 会话内启动后保持运行，供所有者查看）：
 * - API  http://127.0.0.1:3036  DATABASE_URL=libevra_s17_w1_fixture
 * - Web  http://127.0.0.1:5189  LIBELLUM_API_TARGET=http://127.0.0.1:3036
 * - Chrome --headless=new --remote-debugging-port=9246
 *
 * 夹具库说明：libevra_s17_w1_fixture 是从开发库最小化复制的。本脚本的“新建账本 → 切换账本”
 * 用例需要计数器行，夹具库原本为 0 行（真实产品路径会 500 报 “book_number counter is missing”，
 * 是夹具数据缺口而非产品缺陷）；本次已在夹具库补 counters：book_number / account_number /
 * account_number_direct。产品侧的完整建账/切换链路由 API 测试兜底。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { openPage, apiLogin, api, runCase } from "./cdp.mjs";

const WEB = "http://127.0.0.1:5189";
const API = `${WEB}/api/v1`;
/** 夹具主账本；API 调用必须显式带 x-libellum-book，否则服务端回退到最旧成员账本（可能是临时账本）。 */
const FIXTURE_BOOK = "22222222-2222-4222-8222-222222222222";
const OUT = "C:/Users/ZhuanZ（无密码）/Desktop/工作/记账程序/记账程序v1-s17-integration/_backups/k4-workbench-20261027";
mkdirSync(OUT, { recursive: true });

const results = [];
const screenshots = [];
const page = await openPage(9246, WEB + "/");
await page.setViewport(390, 844);
const cookie = await apiLogin(API, "s17_fixture_owner", "s17-fixture-local");
// 清掉上一次验收遗留的设备存储（尤其 current-book）：本地选中的账本会覆盖服务端当前账本，
// 让浏览态期待值失真。清完再写 session cookie。
await page.clearStorage(WEB).catch(() => {});
await page.setCookie("libellum_session", cookie, WEB);
// 每次运行前回到夹具主账本：上一次验收可能留下临时账本并被设为当前账本。
// 走真实 UI（/start 账本列表点行 = 服务端激活 + 设备侧 current-book 写入 + 整页刷新），
// 这样浏览态的数据来自夹具账本，而不是服务端 lastBookId 或设备残留。
await page.navigate(WEB + "/start");
await page.waitFor("document.readyState === 'complete'");
await page.waitFor("(document.body.innerText || '').includes('S17 W1 Fixture')", 15000);
await page.evaluate(`(() => {
  const target = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').includes('S17 W1 Fixture'));
  if (!target) throw new Error('fixture book row missing');
  target.scrollIntoView({block:'center'}); target.click();
})()`);
await page.waitFor("location.pathname === '/'", 25000);

const js = (expr) => page.evaluate(expr);
const q = (sel) => JSON.stringify(sel);
const clickSel = async (sel) => js(`(() => { const el = document.querySelector(${q(sel)}); if (!el) return 'missing'; el.scrollIntoView({block:'center'}); el.click(); return 'ok'; })()`);
const countSel = async (sel) => js(`document.querySelectorAll(${q(sel)}).length`);
const clickText = async (text, scope = null) => js(`(() => {
  const root = ${scope ? `document.querySelector(${q(scope)})` : 'document'};
  if (!root) return 'no-scope';
  const el = [...root.querySelectorAll('button')].find((b) => (b.innerText || '').trim().includes(${q(text)}));
  if (!el) return 'missing';
  el.scrollIntoView({block:'center'}); el.click(); return 'ok';
})()`);
const clickAria = async (label) => js(`(() => { const el = [...document.querySelectorAll('button,[role="button"]')].find((b) => b.getAttribute('aria-label') === ${q(label)}); if (!el) return 'missing'; el.scrollIntoView({block:'center'}); el.click(); return 'ok'; })()`);
const bodyText = async () => js(`document.body.innerText || ''`);
const shoot = async (name) => { const path = `${OUT}/${name}.png`; await page.screenshot(path); screenshots.push(path); return path; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitText = (text, timeout = 8000) => page.waitFor(`(document.body.innerText || '').includes(${q(text)})`, timeout);
const waitCount = (sel, n, timeout = 8000) => page.waitFor(`document.querySelectorAll(${q(sel)}).length >= ${n}`, timeout);
const watchErrors = () => js(`(() => {
  if (window.__k4errs) return;
  window.__k4errs = [];
  const push = (m) => window.__k4errs.push(String(m));
  window.addEventListener('error', (e) => push(e.message));
  window.addEventListener('unhandledrejection', (e) => push(e.reason && e.reason.message ? e.reason.message : e.reason));
})()`);
const goto = async (path, width = null, height = null) => {
  if (width !== null) await page.setViewport(width, height);
  await page.navigate(WEB + path);
  await page.waitFor("document.readyState === 'complete'");
  await watchErrors();
};
const enterEdit = async () => {
  const entered = await clickAria("编辑工作台");
  if (entered !== "ok") throw new Error(`enter edit: ${entered}`);
  await waitText("完成", 5000);
};
const exitEdit = async () => {
  // 编辑态里没有「编辑工作台」按钮（它被替换成完成/取消），所以按取消按钮判断。
  const inEdit = await js("[...document.querySelectorAll('button')].some((b) => (b.innerText || '').trim() === '取消')");
  if (!inEdit) return;
  await clickText("取消");
  await sleep(300);
  if (await js("(document.body.innerText || '').includes('放弃这次编辑')")) {
    await clickText("放弃修改");
    await sleep(500);
  }
  await sleep(300);
};
const waitBrowse = async () => {
  await waitText("总支出", 15000);
  await waitCount(".sw-card", 5);
};

// 期待值：直接用 API 数据独立计算（近 30 天 = 2026-09-28..2026-10-27，原币 CNY）。
async function allTransactions() {
  const items = [];
  let cursor = null;
  for (let i = 0; i < 10; i += 1) {
    const suffix = cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`;
    const { data } = await api(API, `/transactions?limit=100${suffix}`, { cookie, bookId: FIXTURE_BOOK });
    items.push(...(data.items ?? []));
    cursor = data.nextCursor ?? null;
    if (cursor === null) break;
  }
  return items;
}
const txns = await allTransactions();
const from = "2026-09-28";
const to = "2026-10-27";
const within = txns.filter((tx) => tx.occurredLocalDate >= from && tx.occurredLocalDate <= to && tx.currency === "CNY");
const expectedExpense = within.filter((tx) => tx.kind === "expense").reduce((sum, tx) => sum + tx.amountCents, 0);
const expectedIncome = within.filter((tx) => tx.kind === "income").reduce((sum, tx) => sum + tx.amountCents, 0);
const fmt = (minor) => `¥${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const state = { savedTiles: 0 };

await runCase(results, "1. 登录后 /stats 浏览态（真实数据）", async () => {
  await page.evaluate("localStorage.setItem('libevra.language','zh-CN')");
  await goto("/stats", 390, 844);
  await waitBrowse();
  await sleep(1200);
  const body = await bodyText();
  const cards = await countSel(".sw-card");
  if (body.includes("暂时无法计算")) throw new Error("card failed to compute");
  if (cards < 8) throw new Error(`only ${cards} cards`);
  if (!body.includes(fmt(expectedExpense))) throw new Error(`总支出 mismatch: expected ${fmt(expectedExpense)}`);
  if (!body.includes(fmt(expectedIncome))) throw new Error(`总收入 mismatch: expected ${fmt(expectedIncome)}`);
  await shoot("01-browse-zh-390");
  return { cards, expectedExpense, expectedIncome };
});

await runCase(results, "2. 筛选展开态：时间范围 + 币种", async () => {
  const opened = await clickAria("筛选");
  if (opened !== "ok") throw new Error(`open filter: ${opened}`);
  await page.waitFor("!!document.querySelector('#sw-filter-panel')", 5000);
  await clickText("近 90 天", "#sw-filter-panel");
  const applied = await clickText("应用", "#sw-filter-panel");
  if (applied !== "ok") throw new Error(`apply: ${applied}`);
  await waitText("近 90 天", 5000);
  await sleep(800);
  const url = await js("location.search");
  if (!url.includes("from=") && !url.includes("range=")) throw new Error(`search params missing: ${url}`);
  const after = await bodyText();
  if (after.includes("暂时无法计算")) throw new Error("card failed after 90d");
  await shoot("02-filter-90d");
  // 币种切到美元：应只用 USD 数据或空态，不得混币。
  const openedAgain = await clickAria("筛选");
  if (openedAgain === "ok" || (await js("!!document.querySelector('#sw-filter-panel')"))) {
    await clickText("美元", "#sw-filter-panel");
    await clickText("应用", "#sw-filter-panel");
    await sleep(900);
    const usdBody = await bodyText();
    if (usdBody.includes("暂时无法计算")) throw new Error("card failed in USD mode");
    await shoot("03-filter-usd");
    // 恢复默认币种与近 30 天
    await clickAria("筛选");
    await clickText("人民币", "#sw-filter-panel").catch(() => {});
    await clickText("近 30 天", "#sw-filter-panel");
    await clickText("应用", "#sw-filter-panel");
    await sleep(700);
  }
  return { url };
});

await runCase(results, "3. 进入编辑态 + 卡片抽屉展开/收起", async () => {
  await enterEdit();
  const drawerExpanded = await js("(() => { const b = document.querySelector('.sw-drawer-body'); return b ? b.getAttribute('aria-hidden') : 'none'; })()");
  if (drawerExpanded !== null && drawerExpanded !== "false") throw new Error(`drawer not expanded: ${drawerExpanded}`);
  await shoot("04-edit-mode");
  const collapse = await clickAria("收起卡片抽屉");
  if (collapse !== "ok") throw new Error(`collapse drawer: ${collapse}`);
  await sleep(350);
  const hidden = await js("(() => { const b = document.querySelector('.sw-drawer-body'); return b ? b.getAttribute('aria-hidden') : 'none'; })()");
  if (hidden !== "true") throw new Error(`drawer not collapsed: ${hidden}`);
  const expand = await clickAria("展开卡片抽屉");
  if (expand !== "ok") throw new Error(`expand drawer: ${expand}`);
  await sleep(350);
  return { collapse: "ok" };
});

await runCase(results, "4. 从抽屉添加卡片 + 复制/撤销/重做", async () => {
  const before = await countSel(".sw-edit-tile");
  const add = await js("(() => { const b = document.querySelector('button.sw-add-button'); if (!b) return 'missing'; b.scrollIntoView({block:'center'}); b.click(); return 'ok'; })()");
  if (add !== "ok") throw new Error(`add button: ${add}`);
  await waitCount(".sw-edit-tile", before + 1, 5000);
  await waitText("已添加", 4000);
  const afterAdd = await countSel(".sw-edit-tile");
  await js(`(() => { const t = document.querySelectorAll('button.sw-edit-tile'); const el = t[t.length - 1]; el.scrollIntoView({block:'center'}); el.click(); })()`);
  await waitText("复制", 4000);
  const copied = await clickText("复制");
  if (copied !== "ok") throw new Error(`copy: ${copied}`);
  await waitText("已复制", 4000);
  const afterCopy = await countSel(".sw-edit-tile");
  await clickAria("撤销");
  await sleep(400);
  const afterUndo = await countSel(".sw-edit-tile");
  await clickAria("重做");
  await sleep(400);
  const afterRedo = await countSel(".sw-edit-tile");
  if (!(afterAdd === before + 1 && afterCopy === afterAdd + 1 && afterUndo === afterAdd && afterRedo === afterCopy)) {
    throw new Error(`tile counts add/copy/undo/redo = ${before}/${afterAdd}/${afterCopy}/${afterUndo}/${afterRedo}`);
  }
  await shoot("05-edit-added-copied");
  return { before, afterAdd, afterCopy, afterUndo, afterRedo };
});

await runCase(results, "5. 卡片菜单：删除+撤销、移动、调整尺寸", async () => {
  const menuOpened = await js(`(() => { const el = document.querySelector('button.sw-edit-tile'); if (!el) return 'missing'; el.scrollIntoView({block:'center'}); el.click(); return 'ok'; })()`);
  if (menuOpened !== "ok") throw new Error("open menu failed");
  await waitText("这些修改要点", 4000);
  await shoot("06-card-menu");
  const removed = await clickText("删除");
  if (removed !== "ok") throw new Error(`remove: ${removed}`);
  await waitText("已删除", 4000);
  const undoInToast = await js("(() => { const b = document.querySelector('.sw-toast button'); if (!b) return 'missing'; b.click(); return 'ok'; })()");
  if (undoInToast !== "ok") throw new Error("toast undo missing");
  await sleep(400);
  // 移动
  await js(`(() => { const el = document.querySelector('button.sw-edit-tile'); el.scrollIntoView({block:'center'}); el.click(); })()`);
  await waitText("移动", 4000);
  await clickText("移动");
  await waitCount(".sw-cell-target", 1, 4000);
  await js(`(() => { const el = document.querySelector('.sw-cell-target'); el.scrollIntoView({block:'center'}); el.click(); })()`);
  await sleep(400);
  const targetsLeft = await countSel(".sw-cell-target");
  // 调整尺寸（按钮文本是「2×1 当前尺寸」「2×1 可以放下」等，必须按前缀匹配）
  await js(`(() => { const el = document.querySelector('button.sw-edit-tile'); el.scrollIntoView({block:'center'}); el.click(); })()`);
  await waitText("调整尺寸", 4000);
  await clickText("调整尺寸");
  await waitText("尺寸按「宽×高」", 4000);
  const sizeLabels = await js(`[...document.querySelectorAll('button')].map((b) => (b.innerText || '').trim()).filter((t) => /^\\d+×\\d+/.test(t))`);
  if (sizeLabels.length === 0) throw new Error("no size options");
  const picked = await js(`(() => {
    const el = [...document.querySelectorAll('button')].find((b) => {
      const text = (b.innerText || '').trim();
      return /^\\d+×\\d+/.test(text) && text.includes('可以放下') && !text.includes('当前尺寸');
    });
    if (!el) return 'missing';
    el.click(); return 'ok';
  })()`);
  if (picked !== "ok") throw new Error(`pick size failed (${sizeLabels.join(' | ')})`);
  await sleep(500);
  await shoot("07-after-move-resize");
  return { targetsLeft, sizeLabels };
});

await runCase(results, "6. 布局操作：桌面宽度调整行列（切 3 列）+ 撤销", async () => {
  await exitEdit();
  await goto("/stats", 1280, 900);
  await waitBrowse();
  await enterEdit();
  const adjust = await clickAria("调整行列");
  if (adjust !== "ok") throw new Error(`adjust: ${adjust}`);
  await waitText("列数", 4000);
  const columnLabels = await js(`[...document.querySelectorAll('button')].map((b) => (b.innerText || '').trim()).filter((t) => /\\d 列/.test(t))`);
  // 列数选项只有 2 列 / 3 列；默认 2 列，必须点「3 列」，不能再取第一个可用项（那会点回当前值，页面直接返回不发提示）。
  const changed = await js(`(() => {
    const el = [...document.querySelectorAll('button')].find((b) => {
      const text = (b.innerText || '').trim();
      return /^3 列/.test(text) && !b.disabled;
    });
    if (!el) return 'missing';
    el.click(); return 'ok';
  })()`);
  if (changed !== "ok") throw new Error(`change columns failed (${columnLabels.join(' | ')})`);
  await waitText("已改为", 4000);
  await clickAria("撤销");
  await sleep(500);
  await clickText("完成");
  await sleep(700);
  await shoot("08-columns-desktop");
  return { columnLabels };
});

await runCase(results, "7. 布局容器：滑动卡片组（创建并填充 2 张卡片）", async () => {
  await goto("/stats", 390, 844);
  await waitBrowse();
  await enterEdit();
  const tab = await clickText("布局容器");
  if (tab !== "ok") throw new Error(`layout tab: ${tab}`);
  await sleep(500);
  await shoot("09-drawer-layout-tab");
  const addCarousel = await clickAria("添加「滑动卡片组」");
  if (addCarousel !== "ok") throw new Error(`add carousel: ${addCarousel}`);
  await waitCount("[data-pending-container]", 1, 4000);
  if (!(await bodyText()).includes("滑动卡片组")) throw new Error("container scope missing");
  await sleep(400);
  await shoot("10-container-editing");
  // 卡片组至少要 2 张卡片：抽屉里点两个分析卡片，再点「完成」
  for (let i = 0; i < 2; i += 1) {
    await js(`(() => { const list = [...document.querySelectorAll('.sw-drawer-body button.sw-tile')].filter((b) => !b.disabled); const el = list[${i}]; if (!el) return 'missing'; el.scrollIntoView({block:'center'}); el.click(); return 'ok'; })()`);
    await sleep(300);
  }
  // 容器编辑态的「完成」在抽屉 header 内（不在 .sw-drawer-body 里）。
  const doneBtn = await js(`(() => { const el = document.querySelector('.sw-drawer header .sw-pill-primary'); if (!el) return 'missing'; el.scrollIntoView({block:'center'}); el.click(); return 'ok'; })()`);
  if (doneBtn !== "ok") throw new Error(`scope done: ${doneBtn}`);
  await sleep(700);
  const pendingLeft = await countSel("[data-pending-container]");
  if (pendingLeft !== 0) throw new Error(`pending container left: ${pendingLeft}`);
  await shoot("11-container-created");
  return { pendingLeft };
});

await runCase(results, "8. 保存布局 → 刷新恢复（D 本机存储契约）", async () => {
  // 编辑态下的卡片数量在点「完成」前统计（完成后编辑网格会卸载）。
  const savedTiles = await countSel(".sw-edit-tile");
  await clickText("完成");
  await waitText("工作台已保存到本机", 5000);
  const storageInfo = await js(`Promise.race([
    (async () => {
      const ls = Object.keys(localStorage).filter((k) => /stats-workbench|workbench/.test(k));
      const idb = await new Promise((resolve) => {
        const req = indexedDB.open('libevra');
        req.onsuccess = () => {
          const db = req.result;
          const names = [...db.objectStoreNames];
          if (!names.includes('storage')) { resolve({ stores: names, keys: [] }); return; }
          const all = db.transaction('storage', 'readonly').objectStore('storage').getAllKeys();
          all.onsuccess = () => resolve({ stores: names, keys: (all.result || []).map(String).filter((k) => /stats-workbench|workbench/.test(k)) });
          all.onerror = () => resolve({ stores: names, keys: [] });
        };
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      });
      return { ls, idb };
    })(),
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 2500)),
  ])`);
  await goto("/stats", 390, 844);
  await waitBrowse();
  await enterEdit();
  const restoredTiles = await countSel(".sw-edit-tile");
  if (restoredTiles !== savedTiles) throw new Error(`restored ${restoredTiles} != saved ${savedTiles}`);
  const restoreNotice = await js("(document.body.innerText || '').includes('暂时无法读取')");
  if (restoreNotice) throw new Error("restore notice shown after reload");
  await shoot("12-after-reload-persisted");
  state.savedTiles = savedTiles;
  const workbenchKeys = storageInfo === 'timeout' ? 0 : (storageInfo.ls.length + (storageInfo.idb?.keys.length ?? 0));
  if (workbenchKeys === 0) throw new Error("no workbench storage key found");
  return { savedTiles, restoredTiles, workbenchKeys, storageInfo: JSON.stringify(storageInfo).slice(0, 300) };
});

await runCase(results, "9. 卡片详情页（真实数据条件区）", async () => {
  await exitEdit();
  // 上层用例（保存/重载后进入编辑再退出）可能让页面停在非浏览态；兜底重新进入浏览态。
  if (!(await js("!!document.querySelector('.sw-card-hit')"))) {
    await goto("/stats", 390, 844);
    await waitBrowse();
  }
  const entered = await js("(() => { const el = document.querySelector('.sw-card-hit'); if (!el) return 'missing'; el.scrollIntoView({block:'center'}); el.click(); return 'ok'; })()");
  if (entered !== "ok") throw new Error(`open card: ${entered}`);
  await page.waitFor("location.pathname.startsWith('/stats/cards/')", 5000);
  await waitText("计算方法", 5000);
  const body = await bodyText();
  if (!body.includes("计算方法") || !body.includes("数据来源")) throw new Error("detail sections missing");
  await sleep(500);
  await shoot("13-card-detail");
  await goto("/stats", 390, 844);
  await waitBrowse();
  return { path: await js("location.pathname") };
});

await runCase(results, "10. 中文窄屏 320（无横向溢出）", async () => {
  await page.evaluate("localStorage.setItem('libevra.language','zh-CN')");
  await goto("/stats", 320, 700);
  await waitBrowse();
  await sleep(700);
  const overflow = await js("document.documentElement.scrollWidth - document.documentElement.clientWidth");
  if (overflow > 1) throw new Error(`320 overflow ${overflow}px`);
  await shoot("14-zh-320");
  return { overflow };
});

await runCase(results, "11. 英文界面 320 / 桌面 1280", async () => {
  await page.evaluate("localStorage.setItem('libevra.language','en-US')");
  await goto("/stats", 320, 700);
  await waitText("Total expense", 15000);
  const ariaEn = await js("[...document.querySelectorAll('button')].some((b) => b.getAttribute('aria-label') === 'Edit workspace')");
  if (!ariaEn) throw new Error("english edit aria missing");
  const overflowEn = await js("document.documentElement.scrollWidth - document.documentElement.clientWidth");
  if (overflowEn > 1) throw new Error(`en 320 overflow ${overflowEn}px`);
  await shoot("15-en-320");
  await goto("/stats", 1280, 900);
  await waitText("Total expense", 15000);
  await sleep(700);
  const overflowDesktop = await js("document.documentElement.scrollWidth - document.documentElement.clientWidth");
  if (overflowDesktop > 1) throw new Error(`desktop overflow ${overflowDesktop}px`);
  await shoot("16-en-desktop-1280");
  await page.evaluate("localStorage.setItem('libevra.language','zh-CN')");
  await page.setViewport(390, 844);
  return { overflowEn, overflowDesktop };
});

await runCase(results, "12. 新建账本 → 进入空账本 → 切回原账本", async () => {
  // 夹具库可重复跑：已有同名临时账本就复用，避免每次验收都新建一本。
  const listed = await api(API, "/books", { cookie });
  const existing = (listed.data?.books ?? []).find((book) => book.name.startsWith("K4 验收临时账本"));
  let newBookId = existing?.id ?? null;
  let createdStatus = null;
  if (newBookId === null) {
    const created = await api(API, "/books", { cookie, method: "POST", body: { name: "K4 验收临时账本" } });
    createdStatus = created.status;
    if (created.status !== 200 && created.status !== 201) throw new Error(`create book: ${created.status} ${JSON.stringify(created.data).slice(0, 300)}`);
    newBookId = created.data?.book?.id ?? created.data?.id;
    if (!newBookId) throw new Error(`new book id missing: ${JSON.stringify(created.data).slice(0, 200)}`);
  }

  await page.evaluate("localStorage.setItem('libevra.language','zh-CN')");
  await goto("/start", 390, 844);
  await waitText("我的账本", 15000);
  await waitText("K4 验收临时账本", 15000);
  await shoot("17-ledger-list");
  const entered = await js(`(() => {
    const target = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').includes('K4 验收临时账本'));
    if (!target) return 'missing';
    target.scrollIntoView({block:'center'}); target.click(); return 'ok';
  })()`);
  if (entered !== "ok") throw new Error(`enter new book: ${entered}`);
  await page.waitFor("location.pathname === '/'", 25000);
  await goto("/stats", 390, 844);
  await waitText("K4 验收临时账本", 15000);
  await sleep(1500);
  const emptyBody = await bodyText();
  if (emptyBody.includes("暂时无法计算")) throw new Error("empty book cards failed");
  await shoot("18-empty-book");

  // 切回原账本（同样走 UI 的 enterLedger + 整页刷新）
  await goto("/start", 390, 844);
  await waitText("我的账本", 15000);
  await waitText("S17 W1 Fixture", 15000);
  const back = await js(`(() => {
    const target = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').includes('S17 W1 Fixture'));
    if (!target) return 'missing';
    target.scrollIntoView({block:'center'}); target.click(); return 'ok';
  })()`);
  if (back !== "ok") throw new Error(`enter fixture book: ${back}`);
  await page.waitFor("location.pathname === '/'", 25000);
  await goto("/stats", 390, 844);
  await waitText("总支出", 15000);
  await sleep(1200);
  const restoredBody = await bodyText();
  if (!restoredBody.includes(fmt(expectedExpense))) throw new Error("expense mismatch after switching back");
  await shoot("19-back-to-fixture");
  return { newBookId, reused: existing !== undefined, createdStatus };
});

await runCase(results, "13. 控制台错误检查（主会话）", async () => {
  // 收尾：把夹具主账本设回当前账本，方便所有者继续从干净状态查看。
  await api(API, `/books/${FIXTURE_BOOK}/activate`, { cookie, method: "POST" });
  const errs = await js("window.__k4errs || []");
  const relevant = errs.filter((message) => !/ResizeObserver|favicon|Download the React DevTools/.test(message));
  if (relevant.length > 0) throw new Error(`console errors: ${JSON.stringify(relevant).slice(0, 500)}`);
  return { total: errs.length };
});

writeFileSync(`${OUT}/k4-results.json`, JSON.stringify({ generatedAt: new Date().toISOString(), web: WEB, api: API, results, screenshots, expected: { expectedExpense, expectedIncome } }, null, 2));
const failed = results.filter((r) => r.status === "fail");
console.log(`\nK4 ${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) { console.log(JSON.stringify(failed, null, 2)); process.exitCode = 1; }
await page.close();
