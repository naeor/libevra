import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App.js";
import { startThemeRuntime } from "./lib/theme.js";
import { startLanguageRuntime } from "./lib/languageRuntime.js";
import { primeBookId } from "./lib/api.js";
import { currentBookId, restoreCurrentBook, subscribeCurrentBook } from "./lib/currentBook.js";
import { restoreOfflineScope } from "./lib/offline/scope.js";
import { requestPersistentStorage } from "./lib/offline/persistence.js";
import { registerServiceWorker } from "./lib/offline/worker.js";
import "./index.css";

startThemeRuntime();

/**
 * ⚠️ **界面语言在第一次渲染前确定**（S16 国际化）：读本机偏好 → 切换 i18next → 写 `<html lang>`。
 * 文案已经打包在主包里，这一步是同步的，所以首屏不会先闪一下中文再变成英文。
 */
startLanguageRuntime();

const container = document.getElementById("root");

if (!container) {
  throw new Error('Root container "#root" was not found in index.html');
}

/**
 * Registered before the first render, and not awaited.
 *
 * Before, because the worker should be in place by the time the user has finished
 * reading the first screen — and every load it is not registered is a load that
 * cannot be opened offline. Not awaited, because the app must not wait for a cache
 * to start: everything except offline works without it, and a slow or failed
 * registration must not delay somebody's ledger.
 */
void registerServiceWorker();

/**
 * ⚠️ **The difference between "data" and "a cache".**
 *
 * Storage a browser treats as *best-effort* may be evicted when the device is short
 * of space, and Safari discards it after seven days for sites not recently visited.
 * Everything built for offline would then be thrown away silently, and the user
 * would open the app on a plane to find a login screen.
 *
 * Asked for at startup rather than when the first entry is saved: the answer is
 * needed before the data matters, and the browser may show the user a prompt it
 * would rather show once.
 */
void requestPersistentStorage();

/**
 * ⚠️ **The one place the ledger and the request header are joined.**
 *
 * `currentBook.ts` owns the fact, `api.ts` owns the header it feeds, and neither imports the
 * other — a cycle between them would be a module-initialisation order bug, which is the kind
 * that only ever reproduces on somebody else's device. Wiring them here keeps both honest and
 * makes the dependency visible in one line.
 *
 * ⚠️ **Before the first render, and not awaited — but it fills a synchronous mirror.** Every
 * ledger-scoped request names its ledger, and the area a person was last in is remembered on
 * the device so a reload does not lose it. If the value is already in memory the header is set
 * before React mounts; if it is not, the server refuses the request rather than filing it under
 * the wrong ledger.
 */
primeBookId(currentBookId());
subscribeCurrentBook(() => {
  primeBookId(currentBookId());
});

/** 首屏查询恢复前先有界读盘，不能把尚未恢复身份误当成旧全局缓存的所有者。 */
/**
 * S19 视觉风格实验（只在开发环境或 `VITE_S19_STYLE_LAB=1` 的测试构建里加载）。与账本恢复并行加载，
 * 首次渲染前等它完成，带着已选风格刷新时不会先闪一下 Original；加载失败也不影响应用启动。
 */
const styleLab: Promise<void> | null = import.meta.env.DEV || __S19_STYLE_LAB__
  ? import("./s19/lab.js").then((lab) => lab.startStyleLab()).catch(() => undefined)
  : null;
const b2Appearance = import("./s19/product.js").then(module => module.startB2Appearance()).catch(() => undefined);

/**
 * 切换账本整页重新载入后（s19/motion/tide.ts）：风格一确定就把铺底的交接帧换成会动的海浪，不等账本恢复与首次渲染；
 * 页面在浪下面渲染，协调器挂载后浪接着划过。只有 public/tide-resume.js 铺了交接帧时才载入转场模块（平时不占首屏）。
 */
async function resumeLedgerTide(): Promise<void> {
  const root = document.documentElement;
  if (!root.hasAttribute("data-tide-resume")) return;
  try {
    const { beginTideResume } = await import("./s19/motion/tide.js");
    beginTideResume();
  } catch {
    root.setAttribute("data-tide-resume", "fade"); // 转场不影响启动：铺底淡出
  }
}
const appearance = Promise.all([b2Appearance, styleLab]).then(resumeLedgerTide);

async function start(): Promise<void> {
  const book = await restoreCurrentBook();
  await restoreOfflineScope(book);
  await appearance;
  createRoot(container!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
}

void start();
