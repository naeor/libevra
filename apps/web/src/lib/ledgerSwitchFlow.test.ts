import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { t } from "../i18n/index.js";
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
    reloadAfterLeaving({ hint: "正在重新载入……" });
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

    reloadAfterLeaving({ hint: "正在重新载入……" });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    // 与账本空间、账本导入后打开目标账本相同：向下划过（不带 rise）；等待稍久时显示调用方给的提示（1.19.61 起是“正在重新载入……”）。
    expect(call?.options).toEqual({ hint: "正在重新载入……" });
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
    reloadAfterLeaving({ hint: "正在重新载入……" });
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
 *
 * 1.19.61 更新了这里的逐字比对（待办 §6 第 9、11 条）：海浪提示从切换账本的 `books.space.loadingLedger`
 * 改为 `books.space.reloading`（“正在重新载入……”）；载入前多一句“保持忙碌”的标记（LedgerPage 的
 * `setReloading(true)`、BookSettingsPage 的 `reloadingRef.current = true`）。请求、条件与先后仍逐字钉住。
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
      + 'setReloading(true); reloadAfterLeaving({ hint: t("books.space.reloading") }); }) '
      + ".catch((caught: unknown) => { setError(errorMessage(caught)); setConfirming(false); });",
    );
    expect(page).not.toContain("window.location");
  });

  it("账本详情「退出这本账」：成功后正在重新载入时按钮保持忙碌（不再因请求结束而恢复可点）", () => {
    const page = flat("../pages/LedgerPage.tsx");
    const section = page.slice(page.indexOf("function LeaveBookSection("));
    expect(section).toContain("const [reloading, setReloading] = useState(false);");
    expect(section).toContain("disabled={leave.isPending || reloading}");
    expect(section).toContain('{leave.isPending || reloading ? t("ledger.page.leaving") : t("ledger.page.leaveConfirm")}');
    // 只有成功、整页载入的那条路径会置位；外部账本只跳转、失败路径都不碰它。
    expect(section.match(/setReloading\(true\)/g)).toHaveLength(1);
    // 创建者看不到退出按钮的判断原样保留。
    expect(section).toContain("if (me === null || me.isCreator) return null;");
  });

  it("账本设置「退出 / 归档 / 删除」：先完成操作、清本机数据，再按是否当前账本决定整页载入或回账本空间", () => {
    const page = flat("../pages/BookSettingsPage.tsx");
    expect(page).toContain(
      'function afterRemoval(): void { if (bookId === currentBookId) { reloadingRef.current = true; reloadAfterLeaving({ hint: t("books.space.reloading") }); return; } void navigate("/start"); }',
    );
    expect(page).toContain(
      "void bookLifecycleAction(bookId, action) .then(async () => { if (user !== null) await clearBookLocalData(user.id, bookId); afterRemoval(); })",
    );
    expect(page).not.toContain("window.location");
  });

  it("账本设置：整页载入期间不放开忙碌状态，失败时照旧放开；按钮上的权限判断原样不动", () => {
    const page = flat("../pages/BookSettingsPage.tsx");
    expect(page).toContain("const reloadingRef = useRef(false);");
    expect(page).toContain(
      ".catch((caught: unknown) => { setError(errorMessage(caught)); setConfirming(null); }) "
      + ".finally(() => { if (!reloadingRef.current) setLifecycleBusy(false); });",
    );
    // 只在当前账本整页载入的分支置位。
    expect(page.match(/reloadingRef\.current = true/g)).toHaveLength(1);
    for (const guard of [
      "disabled={lifecycleBusy || !lifecycle.canLeave}",
      "disabled={lifecycleBusy || !lifecycle.canArchive}",
      "disabled={lifecycleBusy || !lifecycle.canDelete}",
    ]) {
      expect(page).toContain(guard);
    }
    expect(page.match(/busy=\{lifecycleBusy\}/g)).toHaveLength(3);
  });

  it("切换账本仍用“正在加载新账本……”，离开后用“正在重新载入……”", () => {
    expect(t("books.space.loadingLedger")).toBe("正在加载新账本……");
    expect(t("books.space.reloading")).toBe("正在重新载入……");
    expect(readFileSync(fileURLToPath(new URL("../i18n/resources/en-US/books.ts", import.meta.url)), "utf8")).toContain('reloading: "Reloading…",');
    for (const file of ["../pages/LedgerSpacePage.tsx", "../pages/LedgerImportPage.tsx"]) {
      expect(flat(file), file).toContain('{ hint: t("books.space.loadingLedger") }');
    }
    for (const file of ["../pages/LedgerPage.tsx", "../pages/BookSettingsPage.tsx"]) {
      const page = flat(file);
      expect(page, file).not.toContain("books.space.loadingLedger");
      expect(page, file).toContain('reloadAfterLeaving({ hint: t("books.space.reloading") })');
    }
  });
});

/**
 * 账本导入后归档来源账本（待办 §6 第 10 条，所有者 2026-11-14 单独批准改流程）：来源恰好是设备当前账本时，
 * 归档成功后与“弃置当前账本”一致——海浪盖住画面、整页载入到 "/"；来源不是当前账本时留在结果页（原行为）。
 * 1.19.63（待办 §6 第 25 条）：与账本设置的普通归档一致，归档成功后先清掉**来源账本**的本机离线数据（不论是不是当前账本），
 * 再决定是否整页载入。先后、两条分支、失败与“目标账本不受影响”由 lib/ledgerImport/sourceArchive.test.ts 的行为测试覆盖；
 * 这里只按源码比对钉住页面怎么接线：交出去的是来源账本 ID、目标只做保护、整页载入仍是同一个 reloadAfterLeaving。
 * 归档请求、确认框、能否归档的判断不变。本仓库测试没有 DOM，按源码比对（与上面同一做法）；
 * 载入本身（目标 "/"、海浪、失败照常载入）由本文件开头的 reloadAfterLeaving 行为测试覆盖。
 */
describe("账本导入后归档来源账本", () => {
  const page = flat("../pages/LedgerImportPage.tsx");
  const card = page.slice(page.indexOf("export function SourceRetentionCard("), page.indexOf("export function ReviewStep("));
  const archive = card.slice(card.indexOf("async function archiveFormalSource("), card.indexOf("if (guestBookId === null && result.sourceBookId === undefined)"));

  it("归档成功后清来源账本本机数据，来源是设备当前账本才整页载入；判断用项目已有的 useCurrentBookId", () => {
    expect(page).toContain('import { useActivateBook, useBooks, useCurrentBookId } from "../lib/queries.js";');
    expect(page).toContain('import { activateAndReload, reloadAfterLeaving } from "../lib/ledgerSwitchFlow.js";');
    expect(page).toContain('import { clearBookLocalData } from "../lib/offline/localCleanup.js";');
    expect(page).toContain('import { archiveImportSource } from "../lib/ledgerImport/sourceArchive.js";');
    expect(card).toContain("const currentBookId = useCurrentBookId();");
    expect(archive).toContain(
      "const outcome = await archiveImportSource({ "
      + "sourceBookId: disposition.sourceBookId, targetBookId: result.targetBook.id, currentBookId, accountId, "
      + 'archive: (bookId) => bookLifecycleAction(bookId, "archive"), clearLocalData: clearBookLocalData, '
      + 'onArchived: () => { setArchived(t("ledgerImport.retention.formal.archived")); setArchiveConfirmOpen(false); setDisposition(null); }, '
      + 'reload: () => { reloadAfterLeaving({ hint: t("books.space.reloading") }); }, }); '
      + 'reloading = outcome === "reloading"; '
      + "} catch (caught) { onError(errorMessage(caught)); } finally { if (!reloading) setArchiveBusy(false); }",
    );
    // 整页载入只有这一处，且只在归档成功之后；不自己写 window.location。
    expect(card.match(/reloadAfterLeaving\(/g)).toHaveLength(1);
    expect(page).not.toContain("window.location");
  });

  it("清理只交出来源账本：账号来自页面的登录用户，目标账本 ID 只作为保护传入", () => {
    expect(page).toContain("accountId={user?.id ?? null}");
    // 卡片里只有归档这一处用到清理函数，且不直接调用（由 archiveImportSource 按来源 ID 调用）。
    expect(card.match(/clearBookLocalData/g)).toHaveLength(1);
    expect(card).not.toContain("clearBookLocalData(");
    expect(page.match(/clearBookLocalData/g)).toHaveLength(2);
    expect(archive.match(/result\.targetBook\.id/g)).toHaveLength(1);
    expect(archive).toContain("targetBookId: result.targetBook.id,");
  });

  it("来源不是当前账本：不载入、不跳转，仍显示“已归档”并放开忙碌状态（原行为）", () => {
    expect(archive).toContain("let reloading = false;");
    expect(archive).not.toContain("navigate(");
    expect(archive.match(/reloading = /g)).toHaveLength(2);
  });

  it("归档按钮的可见性、确认框与归档请求不变", () => {
    expect(card).toContain("{disposition !== null && disposition.canArchive && archived === null ? (");
    expect(card).toContain("onConfirm={() => void archiveFormalSource()}");
    expect(card).toContain("if (!archiveBusy) setArchiveConfirmOpen(false);");
    expect(card.match(/bookLifecycleAction\(/g)).toHaveLength(1);
  });

  it("导入撤销、最终确认与打开目标账本的路径不受影响", () => {
    // 撤销与最终确认不在来源保留卡片里，也不会触发整页载入。
    expect(card).not.toContain("undoImportJob");
    expect(card).not.toContain("confirmImportJob");
    expect(page).toContain(
      'void activateAndReload(() => activateBook.mutateAsync(bookId), { hint: t("books.space.loadingLedger") }).catch(',
    );
    expect(page.match(/reloadAfterLeaving\(/g)).toHaveLength(1);
  });
});
