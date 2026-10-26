/**
 * E2E：共享账本留言的「账目引用」功能（m05272）。
 *
 * 覆盖：
 *  1. 留言页保持简单：普通留言可直接发送，引用按钮低调存在
 *  2. 入口 B：引用按钮展开选择面板 → 引用一笔账目 → 发送后卡片可见
 *  3. 引用某次修改：引用的是那次历史事实，后续再改不会改变已发出的卡片
 *  4. 入口 A：共享账本记账成功后出现「就这笔留言」胶囊，点开即引用刚保存的账目，忽略时无任何干扰
 *  5. 个人账本没有「就这笔留言」入口
 *  6. 引用目标被删除后安全降级（卡片显示不可访问，页面不报错；新引用被服务端拒绝）
 *  7. 英文界面
 *  8. 深色主题 + 移动端底部输入区不被遮挡
 *
 * 运行前置：
 *  - API dev（http://127.0.0.1:3000）与 web dev（LIBELLUM_LAN=1，https://127.0.0.1:5173）
 *  - Chrome 以 --remote-debugging-port=9239 启动，且 --user-data-dir 必须是全新目录
 *    （旧 profile 的 IndexedDB 损坏会让 App 永远停在 Loading…，教训见 S16 头像页 E2E）
 *  - 夹具：共享账本 pn_270ce57（book bb832b1b…）、个人账本 pv_descent_a812d8（book 5abeff3a…）
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { api, apiLogin, assert, openPage, runCase } from "./cdp.mjs";
import { localCandidate } from "./local-candidate.mjs";

const candidate = localCandidate();
const WEB = candidate?.web ?? "https://127.0.0.1:5173";
const API = candidate?.api ?? "http://127.0.0.1:3000/api/v1";
const OUTPUT = candidate ? join(candidate.outputRoot, "quotes") : join(process.env.USERPROFILE ?? ".", "Desktop", "工作", "记账程序", "记账程序v1", "_backups", "quote-refine-20261026");

const SHARED = candidate?.shared ?? {
  username: "pn_270ce57",
  password: "Profile-7f0bf9f3-3027-4557-917d-e81707a02192",
  bookId: "bb832b1b-e397-49d0-a18d-780cd4b59061",
  bookName: "个人资料验收账本",
};
const SOLO = candidate?.solo ?? {
  username: "pv_avatarcp",
  password: "AvatarCp-5dc6ea59909b49d3",
  bookId: "8fafe6c9-0815-48e5-a256-f526dca85963",
  bookName: "我的账本",
};

mkdirSync(OUTPUT, { recursive: true });

const results = [];
const page = await openPage(candidate?.port ?? 9239, WEB);
await page.setViewport(390, 844, true);
await page.send("Page.addScriptToEvaluateOnNewDocument", {
  source: `window.runtimeImport = (path) => import(path);`,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const bodyText = () => page.evaluate("document.body.innerText");
const shot = async (name) => page.screenshot(join(OUTPUT, name));

/** 通过真实 /start 界面进入指定账本（同时写入本机 current-book 记忆）。 */
async function enterBook(bookId, bookName) {
  await page.navigate(`${WEB}/start`);
  await page.waitFor("document.readyState === 'complete'");
  await page.waitFor("document.body.innerText.includes('账本')", 15000);
  const clicked = await page.evaluate(`(() => {
    const nodes = [...document.querySelectorAll("button, a")];
    const target = nodes.find((node) => node.textContent.includes(${JSON.stringify(bookName)}) && !node.textContent.includes("重命名") && !node.textContent.includes("成员"));
    if (!target) return false;
    target.click();
    return true;
  })()`);
  let entered = false;
  if (clicked) {
    entered = await page
      .waitFor("location.pathname === '/'", 8000)
      .then(() => true)
      .catch(() => false);
  }
  if (!entered) {
    await page.evaluate(`(async () => { const m = await window.runtimeImport('/src/lib/currentBook.ts'); await m.selectBookForReload(${JSON.stringify(bookId)}); })()`);
    await page.navigate(`${WEB}/`);
    await page.waitFor("document.readyState === 'complete'");
  }
  await page.waitFor("document.body.innerText.length > 0", 15000);
  await sleep(400);
}

async function login(session, book) {
  await page.navigate(`${WEB}/`);
  await page.waitFor("document.readyState === 'complete'");
  await page.setCookie("libellum_session", session, WEB);
  await page.setViewport(390, 844, true);
  // 浏览器默认语言是 en-US；先钉住中文，后续再切英文用例。
  await page.evaluate(`localStorage.setItem("libevra.language", "zh-CN")`);
  await page.navigate(`${WEB}/`);
  await page.waitFor("document.readyState === 'complete'");
  await page.waitFor("document.body.innerText.length > 0", 15000);
  await sleep(400);
  await enterBook(book.bookId, book.bookName);
}

async function setLocale(locale) {
  await page.evaluate(`localStorage.setItem("libevra.language", ${JSON.stringify(locale)})`);
}

async function quoteButton() {
  return page.evaluate(`(() => {
    const button = document.querySelector('[aria-label="引用账目或修改"], [aria-label="Quote an entry or edit"]');
    return button !== null;
  })()`);
}

async function clickQuoteButton() {
  const clicked = await page.evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')];
    const button = buttons.find((item) => item.getAttribute('aria-label') === '引用账目或修改' || item.getAttribute('aria-label') === 'Quote an entry or edit');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert(clicked, "没有找到留言输入框旁的引用按钮");
}

async function pickerRows() {
  return page.evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"][aria-label="引用一条记录"], [role="dialog"][aria-label="Quote a record"]');
    if (!dialog) return [];
    return [...dialog.querySelectorAll('button')].map((button) => button.innerText.trim()).filter((text) => text !== '');
  })()`);
}

async function closePicker() {
  await page.evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"][aria-label="引用一条记录"], [role="dialog"][aria-label="Quote a record"]');
    const close = dialog?.querySelector('[aria-label="关闭"], [aria-label="Close"]');
    close?.click();
  })()`);
  await sleep(250);
}

async function typeIntoComposer(text) {
  const typed = await page.evaluate(`(() => {
    const textareas = [...document.querySelectorAll('textarea')];
    const area = textareas.at(-1);
    if (!area) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(area, ${JSON.stringify(text)});
    area.dispatchEvent(new Event('input', { bubbles: true }));
    area.focus();
    return true;
  })()`);
  assert(typed, "没有找到留言输入框");
}

async function clickText(pattern) {
  const clicked = await page.evaluate(`(() => {
    const nodes = [...document.querySelectorAll('button, a, [role="tab"], [role="button"]')];
    const target = nodes.find((node) => node.textContent.trim().includes(${JSON.stringify(pattern)}));
    if (!target) return false;
    target.click();
    return true;
  })()`);
  return clicked;
}

async function sendMessage() {
  const sent = await clickText("发送");
  assert(sent, "没有找到发送按钮");
}

async function waitForMessage(token) {
  await page.waitFor(`document.body.innerText.includes(${JSON.stringify(token)})`, 10000);
}

async function hasQuoteCard() {
  return page.evaluate(
    `document.querySelector('[aria-label="取消引用"], [aria-label="Remove quote"]') !== null`,
  );
}

async function waitQuoteCard() {
  await page.waitFor(
    `document.querySelector('[aria-label="取消引用"], [aria-label="Remove quote"]') !== null`,
    10000,
  );
}

async function messageRows() {
  return page.evaluate(`(() => [...document.querySelectorAll('li')].map((item) => item.innerText.trim()))()`);
}

async function rowWith(token) {
  const rows = await messageRows();
  return rows.find((item) => item.includes(token)) ?? null;
}

function uniqueToken(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 7)}`;
}

/* ------------------------------------------------------------------ */
/* 准备：API 创建两笔可被引用的账目                                     */
/* ------------------------------------------------------------------ */
const cookie = await apiLogin(API, SHARED.username, SHARED.password);
const bookHeader = { cookie, bookId: SHARED.bookId };

async function createEntry(note, amountCents) {
  const id = randomUUID();
  const occurredAt = new Date().toISOString();
  const response = await api(API, "/transactions", {
    method: "POST",
    ...bookHeader,
    body: {
      id,
      idempotencyKey: id,
      kind: "expense",
      amountCents,
      currency: "CNY",
      occurredAt,
      occurredLocalDate: occurredAt.slice(0, 10),
      occurredTz: "Asia/Shanghai",
      note,
      tagIds: [],
    },
  });
  assert(response.status === 201, `创建账目失败：${response.status} ${JSON.stringify(response.data)}`);
  return response.data;
}

const grocery = await createEntry("买菜", 8600);
const electricity = await createEntry("电费", 12000);
assert(grocery.id !== electricity.id, "两笔账目 id 相同");

let groceryQuoteToken = "";
let plainToken = "";

await login(cookie, SHARED);
await page.navigate(`${WEB}/ledger/messages`);
await page.waitFor("document.readyState === 'complete'");
await page.waitFor("document.body.innerText.includes('留言')", 15000);

/* ------------------------------------------------------------------ */
await runCase(results, "留言页默认仍是简单输入框，引用按钮低调存在", async () => {
  await page.waitFor("document.querySelector('textarea') !== null", 15000);
  const placeholder = await page.evaluate("document.querySelector('textarea').getAttribute('placeholder')");
  assert(placeholder === "写点什么……", `留言输入框占位不对：${placeholder}`);
  assert(await quoteButton(), "引用按钮不可见");
  assert(!(await bodyText()).includes("引用一条记录"), "选择面板不应该默认展开");
  await shot("01-messages-default.png");
  return "输入框正常，引用按钮存在且面板默认收起";
});

await runCase(results, "普通留言可以直接发送，不需要任何引用", async () => {
  const token = uniqueToken("普通留言");
  plainToken = token;
  await typeIntoComposer(token);
  await sendMessage();
  await waitForMessage(token);
  const row = await rowWith(token);
  assert(row, "发送后的留言不在列表里");
  assert(!row.includes("¥"), "普通留言不应该出现引用卡片");
  return `${token} 已发送且不带引用`;
});

await runCase(results, "留言顺序与默认位置：最新在最下面，从协作页展开后自动停在最下方", async () => {
  // 先看协作页的小卡片：最新一条应该在卡片最下面。
  await page.navigate(`${WEB}/ledger`);
  await page.waitFor("document.readyState === 'complete'");
  await page.waitFor("document.body.innerText.includes('展开完整对话')", 15000);
  await page.waitFor(`document.body.innerText.includes(${JSON.stringify(plainToken)})`, 8000);
  const cardRows = await page.evaluate(`(() => {
    const list = [...document.querySelectorAll('ul')].find((node) => node.className.includes('max-h'));
    return [...(list?.querySelectorAll('li') ?? [])].map((row) => row.innerText);
  })()`);
  assert(cardRows.length > 0, "协作页留言卡片里没有留言");
  assert(
    cardRows.at(-1).includes(plainToken),
    `卡片最下面不是最新留言：${cardRows.at(-1).slice(0, 60)}`,
  );

  // 再点「展开完整对话」，全屏页应该停在最下方（最新）。
  const expanded = await clickText("展开完整对话");
  assert(expanded, "没有「展开完整对话」入口");
  await page.waitFor("location.pathname === '/ledger/messages'", 8000);
  await page.waitFor("document.querySelector('textarea') !== null", 15000);
  await page.waitFor(`document.body.innerText.includes(${JSON.stringify(plainToken)})`, 8000);
  await sleep(400);
  const state = await page.evaluate(`(() => {
    const scroller = [...document.querySelectorAll('div')].find((node) => {
      const style = getComputedStyle(node);
      return style.overflowY === 'auto' && node.scrollHeight > node.clientHeight + 20;
    });
    if (!scroller) return null;
    const rows = [...scroller.querySelectorAll('li')];
    return {
      atBottom: Math.abs(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop) < 4,
      lastRow: rows.at(-1)?.innerText ?? '',
    };
  })()`);
  assert(state !== null, "没有找到留言滚动区");
  assert(state.lastRow.includes(plainToken), `最新留言不在列表最下面：${state.lastRow.slice(0, 60)}`);
  assert(state.atBottom, "进入留言页没有默认跳到最下方");
  await shot("02c-messages-bottom.png");
  return "卡片与全屏页都是最新在下，进入后停在最下方";
});

await runCase(results, "引用面板从下往上展开、从上往下收回（入场/退场动画类齐全）", async () => {
  await clickQuoteButton();
  await page.waitFor("document.querySelector('[role=\"dialog\"]') !== null", 5000);
  const openClass = await page.evaluate("document.querySelector('[role=\"dialog\"]').className");
  assert(openClass.includes("sheet-in"), `面板没有入场动画类：${openClass}`);
  await shot("02b-sheet-open.png");

  await page.evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const close = dialog?.querySelector('[aria-label="关闭"], [aria-label="Close"]');
    close?.click();
  })()`);
  await sleep(60);
  const closingClass = await page.evaluate(`document.querySelector('[role="dialog"]')?.className ?? ""`);
  assert(closingClass.includes("sheet-out"), `面板没有收回动画类：${closingClass}`);
  await page.waitFor("document.querySelector('[role=\"dialog\"]') === null", 5000);
  return "入场 .sheet-in、退场 .sheet-out，动画播完才从 DOM 移除";
});

await runCase(results, "入口 B：引用按钮展开面板，引用一笔账目并发送", async () => {
  await clickQuoteButton();
  await page.waitFor("document.querySelector('[role=\"dialog\"]') !== null", 5000);
  await page.waitFor(`document.querySelector('[role="dialog"]').innerText.includes('买菜')`, 8000);
  const rows = await pickerRows();
  assert(rows.some((row) => row.includes("买菜")), `面板里没有「买菜」：${rows.join(" | ")}`);
  assert(rows.some((row) => row.includes("¥86.00")), "面板里没有「买菜」的金额");
  await shot("02-quote-picker.png");

  const picked = await page.evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const row = [...dialog.querySelectorAll('button')].find((node) => node.textContent.includes('买菜'));
    if (!row) return false;
    row.click();
    return true;
  })()`);
  assert(picked, "点击「买菜」失败");
  await waitQuoteCard();
  assert((await bodyText()).includes("¥86.00"), "引用卡片没有显示金额");
  await shot("03-composer-quote.png");

  const token = uniqueToken("引用买菜");
  groceryQuoteToken = token;
  await typeIntoComposer(token);
  await sendMessage();
  await waitForMessage(token);
  const row = await rowWith(token);
  assert(row, "引用留言没有出现在列表里");
  assert(row.includes("买菜") && row.includes("¥86.00"), `留言行没有引用卡片：${row}`);

  const messages = await api(API, "/books/messages?limit=50", bookHeader);
  const saved = messages.data.messages.find((message) => message.body.includes(token));
  assert(saved?.reference?.kind === "transaction", `服务端没有保存引用：${JSON.stringify(saved?.reference)}`);
  assert(saved.reference.id === grocery.id, "服务端引用的账目 id 不对");
  assert(saved.reference.available === true, "引用应该可用");
  return `引用 ${grocery.id} 已随留言保存，卡片显示 买菜 ¥86.00`;
});

await runCase(results, "引用一次修改：之后账目再改，已发出的历史引用不变", async () => {
  // 通过 PATCH changes 链把金额 86.00 → 68.00，制造一次 updated 事件。
  const current = await api(API, `/transactions/${grocery.id}`, bookHeader);
  const patched = await api(API, `/transactions/${grocery.id}`, {
    method: "PATCH",
    ...bookHeader,
    body: {
      version: current.data.version,
      changes: [{ field: "amountCents", base: 8600, wanted: 6800, chain: [6800] }],
    },
  });
  assert(patched.status === 200, `修改账目失败：${patched.status} ${JSON.stringify(patched.data)}`);

  await page.navigate(`${WEB}/ledger/messages`);
  await page.waitFor("document.readyState === 'complete'");
  await page.waitFor("document.querySelector('textarea') !== null", 15000);
  await clickQuoteButton();
  await page.waitFor("document.querySelector('[role=\"dialog\"]') !== null", 5000);
  const switched = await clickText("修改历史");
  assert(switched, "没有「修改历史」标签");
  await page.waitFor(`document.querySelector('[role="dialog"]').innerText.includes('修改了')`, 8000);
  const rows = await pickerRows();
  assert(rows.some((row) => row.includes("修改了")), `修改历史里没有修改事件：${rows.join(" | ")}`);
  const picked = await page.evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const row = [...dialog.querySelectorAll('button')].find((node) => node.textContent.includes('修改了'));
    if (!row) return false;
    row.click();
    return true;
  })()`);
  assert(picked, "点击修改事件失败");
  await waitQuoteCard();
  assert((await bodyText()).includes("修改了"), "引用卡片没有显示修改事件");
  await shot("04-event-quote.png");

  const token = uniqueToken("引用修改");
  await typeIntoComposer(token);
  await sendMessage();
  await waitForMessage(token);

  // 再改一次，已发出的引用应保持 ¥86 → ¥68 的历史事实。
  const next = await api(API, `/transactions/${grocery.id}`, bookHeader);
  const patchedAgain = await api(API, `/transactions/${grocery.id}`, {
    method: "PATCH",
    ...bookHeader,
    body: {
      version: next.data.version,
      changes: [{ field: "amountCents", base: 6800, wanted: 7000, chain: [7000] }],
    },
  });
  assert(patchedAgain.status === 200, "第二次修改失败");

  await page.navigate(`${WEB}/ledger/messages`);
  await page.waitFor("document.readyState === 'complete'");
  await page.waitFor(`document.body.innerText.includes(${JSON.stringify(token)})`, 15000);
  const row = await rowWith(token);
  assert(row, "历史引用留言不见了");
  assert(row.includes("86") && row.includes("68"), `历史引用卡片丢了原值：${row}`);
  assert(!row.includes("70.00"), `历史引用卡片被后续修改改变了：${row}`);
  await shot("05-event-quote-stable.png");
  return "修改引用保持 86→68，账目后续改到 70 不影响已发出的卡片";
});

await runCase(results, "入口 A：保存成功后出现「就这笔留言」胶囊，点开即引用刚保存的账目", async () => {
  const beforeMessages = await api(API, "/books/messages?limit=200", bookHeader);
  const beforeCount = beforeMessages.data.messages.length;

  await page.navigate(`${WEB}/add`);
  await page.waitFor("document.readyState === 'complete'");
  await page.waitFor("document.body.innerText.includes('保存') || document.body.innerText.includes('记一笔')", 15000);

  // 用随机金额，避免与之前运行留下的账目触发「疑似重复」确认。
  const amount = String(100 + Math.floor(Math.random() * 800));
  const amountTyped = await page.evaluate(`(() => {
    const input = document.querySelector('input[aria-label="金额"]');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(amount)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  assert(amountTyped, "没有找到金额输入框");

  const saved = await clickText("保存");
  assert(saved, "没有保存按钮");
  await page.waitFor("document.body.innerText.includes('已记账')", 10000);
  await sleep(300);
  const text = await bodyText();
  assert(text.includes("就这笔留言"), "共享账本记账成功后没有「就这笔留言」入口");
  assert(!text.includes("引用留言"), "旧入口文案「引用留言」不应再出现");
  assert(text.includes("再记一笔"), "保存成功页缺少「再记一笔」");
  /**
   * ⚠️ m06693：入口必须在「成功信息区」（金额/分类下方）而不是主按钮下方；它看起来像成功说明的一部分，
   * 然后才是两个真正的动作。
   */
  assert(
    text.indexOf("就这笔留言") < text.indexOf("再记一笔"),
    "「就这笔留言」应在「再记一笔」之前（成功信息区里）",
  );
  await shot("06-saved-shortcut.png");

  /* 打开面板：自动带上引用卡片 */
  assert(await clickText("就这笔留言"), "点击「就这笔留言」失败");
  await page.waitFor(
    `document.querySelector('[role="dialog"][aria-label="就这笔留言"], [role="dialog"][aria-label="Message about this"]') !== null`,
    10000,
  );
  await waitQuoteCard();
  const sheetText = await page.evaluate(`document.querySelector('[role="dialog"]').innerText`);
  assert(sheetText.includes(`¥${amount}.00`), `面板里的引用卡片没有金额：${sheetText.slice(0, 120)}`);
  assert(sheetText.includes("发送留言"), "面板没有「发送留言」按钮");
  await shot("07-quote-message-sheet.png");

  /* 取消：不新增留言、不动账目 */
  await page.evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const close = dialog?.querySelector('[aria-label="关闭"], [aria-label="Close"]');
    close?.click();
  })()`);
  await page.waitFor(`document.querySelector('[role="dialog"]') === null`, 10000);
  await sleep(300);
  const afterCancel = await api(API, "/books/messages?limit=200", bookHeader);
  assert(
    afterCancel.data.messages.length === beforeCount,
    `取消留言后不应新增留言：${beforeCount} → ${afterCancel.data.messages.length}`,
  );
  const afterCancelText = await bodyText();
  assert(afterCancelText.includes("已记账"), "取消留言不应影响已保存账目");
  assert(afterCancelText.includes("就这笔留言"), "取消后入口应恢复可用");
  assert(afterCancelText.includes(`¥${amount}.00`), "取消后金额应原样保留");

  /* 再打开：输入并发送留言 */
  assert(await clickText("就这笔留言"), "第二次点击「就这笔留言」失败");
  await page.waitFor(`document.querySelector('[role="dialog"]') !== null`, 10000);
  await waitQuoteCard();
  const token = uniqueToken("就这笔留言");
  await typeIntoComposer(token);
  assert(await clickText("发送留言"), "没有「发送留言」按钮");
  await page.waitFor("document.body.innerText.includes('留言已发送')", 15000);
  await shot("08-quote-sent.png");
  const afterSendText = await bodyText();
  assert(!afterSendText.includes("就这笔留言"), "发送后入口应换成「留言已发送」");
  assert(afterSendText.includes(`¥${amount}.00`), "发送后成功屏金额应原样保留");

  /* 到完整留言页核对：引用卡片与正文都在，且只发了一条 */
  await page.navigate(`${WEB}/ledger/messages`);
  await page.waitFor("document.readyState === 'complete'");
  await page.waitFor("document.querySelector('textarea') !== null", 15000);
  await page.waitFor(`document.body.innerText.includes(${JSON.stringify(token)})`, 15000);
  const row = await rowWith(token);
  assert(row && row.includes(`¥${amount}.00`), `快捷引用留言没有卡片：${row}`);
  const afterMessages = await api(API, "/books/messages?limit=200", bookHeader);
  assert(
    afterMessages.data.messages.length === beforeCount + 1,
    `应只新增一条留言：${beforeCount} → ${afterMessages.data.messages.length}`,
  );
  return "保存 → 就这笔留言 → 面板引用 → 取消无副作用 → 再次发送 → 留言带引用且只发一条";
});

await runCase(results, "快捷引用可以被忽略：「就这笔留言」外直接返回主页/再记一笔都没有额外步骤", async () => {
  await page.navigate(`${WEB}/add`);
  await page.waitFor("document.readyState === 'complete'");
  await page.waitFor("document.body.innerText.includes('保存')", 15000);
  const amount = String(100 + Math.floor(Math.random() * 800));
  await page.evaluate(`(() => {
    const input = document.querySelector('input[aria-label="金额"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(amount)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await clickText("保存");
  await page.waitFor("document.body.innerText.includes('已记账')", 10000);
  const homeClicked = await clickText("返回主页");
  assert(homeClicked, "没有「返回主页」");
  await page.waitFor("location.pathname === '/'", 10000);
  return "忽略引用入口直接返回主页，流程不变";
});

await runCase(results, "引用目标被删除后安全降级：卡片显示不可访问，页面不报错", async () => {
  const deleted = await api(API, `/transactions/${grocery.id}`, { method: "DELETE", ...bookHeader });
  assert(deleted.status === 204, `删除账目失败：${deleted.status}`);

  await page.navigate(`${WEB}/ledger/messages`);
  await page.waitFor("document.readyState === 'complete'");
  await page.waitFor("document.querySelector('textarea') !== null", 15000);
  await page.waitFor(`document.body.innerText.includes(${JSON.stringify(groceryQuoteToken)})`, 15000);
  const row = await rowWith(groceryQuoteToken);
  assert(row, "引用过「买菜」的留言消失了");
  assert(row.includes("已删除或不可访问"), `被删除的引用目标没有降级提示：${row}`);
  await shot("09-quote-unavailable.png");

  // 新留言再引用这笔已删除账目，服务端必须拒绝（不能只靠前端）。
  const rejected = await api(API, "/books/messages", {
    method: "POST",
    ...bookHeader,
    body: { body: "还引用得到吗", reference: { kind: "transaction", id: grocery.id } },
  });
  assert(rejected.status === 400, `服务端应拒绝已删除目标，实际 ${rejected.status}`);
  assert(rejected.data?.code === "quote_target_unavailable", `错误码不对：${JSON.stringify(rejected.data)}`);
  return "卡片降级为「已删除或不可访问」，新引用被服务端 400 quote_target_unavailable 拒绝";
});

/* ------------------------------------------------------------------ */
await runCase(results, "个人账本没有「就这笔留言」入口", async () => {
  const soloCookie = await apiLogin(API, SOLO.username, SOLO.password);
  await page.navigate(`${WEB}/`);
  await page.waitFor("document.readyState === 'complete'");
  await page.setCookie("libellum_session", soloCookie, WEB);
  await page.setViewport(390, 844, true);
  await page.evaluate(`localStorage.setItem("libevra.language", "zh-CN")`);
  await page.navigate(`${WEB}/`);
  await page.waitFor("document.readyState === 'complete'");
  await sleep(300);
  await enterBook(SOLO.bookId, SOLO.bookName);

  await page.navigate(`${WEB}/add`);
  await page.waitFor("document.readyState === 'complete'");
  await page.waitFor("document.body.innerText.includes('保存')", 15000);
  const amount = String(100 + Math.floor(Math.random() * 800));
  await page.evaluate(`(() => {
    const input = document.querySelector('input[aria-label="金额"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(amount)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await clickText("保存");
  await page.waitFor("document.body.innerText.includes('已记账')", 10000);
  const text = await bodyText();
  assert(!text.includes("就这笔留言"), "个人账本不应该出现「就这笔留言」");
  await shot("10-solo-saved.png");
  return "个人账本保存后没有引用入口";
});

await runCase(results, "英文界面：引用流程与文案完整", async () => {
  // 切回共享账本账号。
  await page.navigate(`${WEB}/`);
  await page.waitFor("document.readyState === 'complete'");
  await page.setCookie("libellum_session", cookie, WEB);
  await page.setViewport(390, 844, true);
  await page.navigate(`${WEB}/`);
  await page.waitFor("document.readyState === 'complete'");
  await sleep(300);
  await enterBook(SHARED.bookId, SHARED.bookName);
  await setLocale("en-US");
  await page.navigate(`${WEB}/ledger/messages`);
  await page.waitFor("document.readyState === 'complete'");
  await page.waitFor(
    "document.querySelector('textarea') !== null && document.querySelector('textarea').getAttribute('aria-label') === 'Write a message'",
    15000,
  );
  const text = await bodyText();
  assert(text.includes("Messages") || text.includes("Message"), `英文留言页没有加载：${text.slice(0, 120)}`);
  assert(await quoteButton(), "英文引用按钮不可见");
  await clickQuoteButton();
  await page.waitFor("document.querySelector('[role=\"dialog\"]') !== null", 5000);
  const dialogText = await page.evaluate("document.querySelector('[role=\"dialog\"]').innerText");
  assert(dialogText.includes("Entries") && dialogText.includes("Edit history"), `英文面板文案不对：${dialogText}`);
  assert(!dialogText.includes("暂无分类"), `英文面板里出现了中文系统分类名：${dialogText}`);
  await shot("11-en-picker.png");
  await closePicker();
  await setLocale("zh-CN");
  return "英文引用按钮/面板正常";
});

await runCase(results, "深色主题 + 移动端：底部输入区完整可见、无横向溢出", async () => {
  await setLocale("zh-CN");
  await page.evaluate(`localStorage.setItem("libevra.theme", ${JSON.stringify(JSON.stringify({ mode: "dark", palette: "green" }))})`);
  await page.navigate(`${WEB}/ledger/messages`);
  await page.waitFor("document.readyState === 'complete'");
  await page.waitFor("document.querySelector('textarea') !== null", 15000);
  const layout = await page.evaluate(`(() => {
    const composer = document.querySelector('textarea')?.closest('form, div');
    const rect = composer?.getBoundingClientRect() ?? null;
    return {
      theme: document.documentElement.dataset.themeMode ?? null,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      composerBottom: rect ? Math.round(rect.bottom) : null,
      viewportHeight: window.innerHeight,
    };
  })()`);
  assert(layout.theme === "dark", `深色主题没有生效：${layout.theme}`);
  assert(!layout.overflow, "深色/移动端出现了横向溢出");
  assert(layout.composerBottom !== null && layout.composerBottom <= layout.viewportHeight + 1, `输入区被截断：${JSON.stringify(layout)}`);
  await shot("12-dark-mobile.png");
  return JSON.stringify(layout);
});

writeFileSync(join(OUTPUT, "results.json"), JSON.stringify(results, null, 2));

const failed = results.filter((result) => result.status === "fail");
process.stdout.write(`\n${results.length - failed.length}/${results.length} passed. Output: ${OUTPUT}\n`);
page.close();
if (failed.length > 0) process.exitCode = 1;
