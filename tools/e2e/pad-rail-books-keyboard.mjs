/** 在独立 CDP 浏览器的本机游客账本中运行：node tools/e2e/pad-rail-books-keyboard.mjs <本机预览地址> <CDP 端口> */
import assert from "node:assert/strict";
import { openPage } from "./cdp.mjs";

const [preview, port] = process.argv.slice(2);
const origin = new URL(preview);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
const page = await openPage(Number(port), origin.href);
const brand = ".lv-rail-brand-button";
const collapse = ".lv-rail-collapse";
const books = ".lv-rail-books > button";
const panel = ".lv-books-popover";
const compact = 'document.querySelector(".lv-rail")?.dataset.compact === "true"';
const focused = (selector) => page.evaluate(`document.activeElement?.matches(${JSON.stringify(selector)})`);

async function key(key, code, vk, modifiers = 0) {
  const event = { key, code, windowsVirtualKeyCode: vk, modifiers };
  await page.send("Input.dispatchKeyEvent", { ...event, type: "keyDown", text: key === " " ? " " : "" });
  await page.send("Input.dispatchKeyEvent", { ...event, type: "keyUp" });
}

async function tabTo(selector, backwards = false) {
  for (let i = 0; i < 24; i++) {
    if (await focused(selector)) return;
    await key("Tab", "Tab", 9, backwards ? 8 : 0);
  }
  assert.fail(`键盘无法到达 ${selector}`);
}

const activate = () => key(" ", "Space", 32);
try {
  await page.setViewport(1366, 1024, true);
  await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await page.navigate(origin.href);
  await page.waitFor('!!document.querySelector(".lv-rail")');
  if (!await page.evaluate(compact)) {
    await tabTo(collapse);
    await activate();
    await page.waitFor(compact);
  }
  await tabTo(books);
  await activate();
  await page.waitFor(`document.activeElement?.closest("${panel}") != null`);
  await tabTo(brand, true);
  await activate();
  await page.waitFor(`!(${compact}) && !document.querySelector("${panel}")`);
  await tabTo(collapse);
  await activate();
  await page.waitFor(compact);
  assert.equal(await page.evaluate(`!!document.querySelector("${panel}")`), false, "收起侧栏后旧浮层重新打开");
  assert.equal(await page.evaluate(`document.querySelector("${books}").ariaExpanded`), "false");
  assert.ok(await focused(brand), "焦点应留在可见的侧栏展开按钮上");
  await tabTo(books);
  await activate();
  await page.waitFor(`document.activeElement?.closest("${panel}") != null`);
  await key("Escape", "Escape", 27);
  await page.waitFor(`!document.querySelector("${panel}")`);
  assert.ok(await focused(books), "Esc 应把焦点还给账本按钮");
  console.log("通过：键盘收展不会重开账本浮层，焦点可见，主动重开与 Esc 返回正常。");
} finally {
  page.close();
}
