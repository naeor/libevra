import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TidePresentation } from "../s19/motion/tide.js";
import { provideReloadCover, reloadAfterLeaving, type CoverOptions } from "./ledgerSwitchFlow.js";

/**
 * 退出 / 弃置 / 删除当前账本后的整页重新载入（审查 L14）：载入前用与切换账本同一个海浪呈现器盖住画面。
 *
 * ⚠️ 只加遮盖、不改流程：载入一定发生、目标仍是 "/"；没有呈现器时与原来一样同步载入；呈现器失败也照常载入。
 * 测试在没有 DOM 的环境里运行（vitest.config.ts），`window.location.assign` 用替身记录。
 */
function stubLocation(): ReturnType<typeof vi.fn> {
  const assign = vi.fn();
  vi.stubGlobal("window", { location: { assign } });
  return assign;
}

/** 等所有已排队的微任务跑完（呈现器的 then 回调）。 */
const settle = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 0); });

afterEach(() => {
  provideReloadCover(null);
  vi.unstubAllGlobals();
});

describe("离开当前账本后的整页重新载入", () => {
  it("没有呈现器（电脑版、Pad 宽屏）：立即同步载入到 \"/\"，与原来完全一样", () => {
    const assign = stubLocation();
    reloadAfterLeaving({ hint: "正在加载新账本……" });
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith("/");
  });

  it("有呈现器：先让海浪盖满整屏（空任务、参数原样交给呈现器），盖满后才载入，只载入一次", async () => {
    const assign = stubLocation();
    let finish: () => void = () => undefined;
    const calls: { work: () => Promise<void>; options: CoverOptions }[] = [];
    provideReloadCover((work, options) => {
      calls.push({ work, options });
      return new Promise<void>(resolve => { finish = resolve; });
    });

    reloadAfterLeaving({ hint: "正在加载新账本……" });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    // 与账本空间、账本导入后打开目标账本相同：向下划过（不带 rise），等待稍久显示同一行提示。
    expect(call?.options).toEqual({ hint: "正在加载新账本……" });
    // 离开本身已由调用方完成：交给呈现器的是空任务，不会再请求一次服务器。
    await expect(call?.work()).resolves.toBeUndefined();
    await settle();
    expect(assign).not.toHaveBeenCalled();

    finish();
    await settle();
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith("/");
  });

  it("呈现器返回失败：照常载入，不让离开卡住", async () => {
    const assign = stubLocation();
    provideReloadCover(() => Promise.reject(new Error("canvas")));
    reloadAfterLeaving();
    await settle();
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith("/");
  });

  it("呈现器同步抛出：立即照常载入", () => {
    const assign = stubLocation();
    provideReloadCover(() => { throw new Error("matchMedia"); });
    reloadAfterLeaving();
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith("/");
  });

  it("呈现器不播放时立即载入：减少动态效果（真实的海浪呈现器），以及协调器判定不播放（Original、深色）直接执行空任务", async () => {
    const assign = stubLocation();
    vi.stubGlobal("document", { documentElement: { dataset: { themeMode: "light", visualStyle: "c" } }, hidden: false });
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    provideReloadCover((work, { hint, rise }) => new TidePresentation().coverForReload("c", () => ({}) as HTMLElement, work, hint, rise));
    reloadAfterLeaving({ hint: "正在加载新账本……" });
    await settle();
    expect(assign).toHaveBeenCalledTimes(1);

    provideReloadCover(work => work());
    reloadAfterLeaving();
    await settle();
    expect(assign).toHaveBeenCalledTimes(2);
    expect(assign).toHaveBeenLastCalledWith("/");
  });
});

/**
 * 调用方只在原来整页载入的那一行换成 `reloadAfterLeaving`：离开请求、外部账本分支、清本机数据、
 * “是不是当前账本”的判断与先后顺序都不变。按源码比对（去掉注释、压缩空白）。
 */
function flat(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\s+/g, " ");
}

describe("退出 / 弃置入口只加遮盖、不改流程", () => {
  it("账本详情「退出这本账」：退出成功后外部账本仍只跳转，设备当前账本整页载入；失败照原样显示原因", () => {
    const page = flat("../pages/LedgerPage.tsx");
    const section = page.slice(page.indexOf("function LeaveBookSection("));
    expect(section).toContain(
      'void leave .mutateAsync(bookId) .then(() => { if (foreign !== null) { void navigate("/", { replace: true }); return; } '
      + 'reloadAfterLeaving({ hint: t("books.space.loadingLedger") }); }) '
      + ".catch((caught: unknown) => { setError(errorMessage(caught)); setConfirming(false); });",
    );
    expect(page).not.toContain("window.location");
  });

  it("账本设置「退出 / 归档 / 删除」：先完成操作、清本机数据，再按是否当前账本决定整页载入或回账本空间", () => {
    const page = flat("../pages/BookSettingsPage.tsx");
    expect(page).toContain(
      'function afterRemoval(): void { if (bookId === currentBookId) { reloadAfterLeaving({ hint: t("books.space.loadingLedger") }); return; } void navigate("/start"); }',
    );
    expect(page).toContain(
      "void bookLifecycleAction(bookId, action) .then(async () => { if (user !== null) await clearBookLocalData(user.id, bookId); afterRemoval(); })",
    );
    expect(page).not.toContain("window.location");
  });
});
