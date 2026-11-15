import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * 游客多账本（第二批）的接线：切换账本走“激活 + 整页重新载入”、游客的当前账本不进账号的 `currentBook`、
 * 只对服务器有意义的入口对游客隐藏。界面组件在 Node 里不好整页渲染，这里与 `ledgerSwitchFlow.test.ts`
 * 一样断言源码（空白压平后比较）。
 */
function flat(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8").replace(/\s+/g, " ");
}

describe("切换游客账本", () => {
  const queries = flat("../queries.ts");

  it("useActivateBook 的游客分支只写游客库，不调用 selectBookForReload（不写账号的 currentBook）", () => {
    expect(queries).toContain("if (guest) { await switchGuestBook(bookId); return { ok: true }; }");
    expect(queries).toContain("onSuccess: (_result, bookId) => { if (guest) return;");
  });

  it("账本空间：游客进入另一本账走 activateAndReload（海浪 + 整页重新载入），不走只换工作区的路径", () => {
    const page = flat("../../pages/LedgerSpacePage.tsx");
    expect(page).toContain("if (guest) { await activateAndReload(bookId); return; }");
    // “点的就是当前账本”仍然只是回到明细。
    expect(page).toContain("if (bookId === currentBookId) { navigate(\"/\"); return; }");
  });

  it("侧栏：游客换账本后整页载入；游客没有“在辅助区查看另一本账”与拖入辅助区", () => {
    const rail = flat("../../workspace/GlobalRail.tsx");
    expect(rail).toContain("if (guest) { if (bookId === currentId) { onNavigate(\"/\"); return; }");
    expect(rail).toContain("...(guest ? [] : [ { label: t(\"workspace.rail.bookWorkspaceInSecondary\")");
    expect(rail).toContain("draggable={!guest}");
  });

  it("胶囊与电脑版账本选择：游客同样经 useEnterLedger 激活后整页载入", () => {
    const nav = flat("../../desktop/DesktopNav.tsx");
    expect(nav).toContain("if (bookId === currentId) {");
    expect(nav).not.toContain("if (guest || bookId === currentId)");
    expect(flat("../../components/CurrentBookCaption.tsx")).toContain("pane.shell === \"phone\" ? <CurrentBookPicker");
    expect(flat("../../components/PersistentBookCapsule.tsx")).toContain("<CurrentBookPicker caption={caption} name={shown} />");
  });
});

describe("只对服务器有意义的入口对游客隐藏", () => {
  it("齿轮面板：游客没有“成员与邀请”“分享链接”", () => {
    const sheet = flat("../../components/BookManageSheet.tsx");
    expect(sheet).toContain("...(guest ? [] : [ { key: \"members\"");
  });

  it("账本详情：游客不显示通知铃铛，附件显示本机版本", () => {
    const detail = flat("../../pages/BookDetailPage.tsx");
    expect(detail).toContain("actions={guest ? undefined : <BookNotificationBell bookId={bookId} />}");
    expect(detail).toContain("{guest ? <GuestBookAttachmentSummary bookId={bookId} /> : <BookAttachmentSummary bookId={bookId} />}");
  });

  it("账本设置：游客显示导入账单（1.19.96 本机导入）、不显示导入账本；删除对话框给出导出入口", () => {
    const settings = flat("../../pages/BookSettingsPage.tsx");
    expect(settings).not.toContain("{guest ? null : ( <NavRow label={t(\"books.settings.row.import.label\")}");
    expect(settings).toContain("<NavRow label={t(\"books.settings.row.import.label\")} hint={t(\"books.settings.row.import.hint\")} to={`/books/${bookId}/settings/import`} />");
    expect(settings).toContain("{!guest && row?.isCreator === true && memberCount === 1 ? (");
    expect(settings).toContain("to={`/books/${bookId}/settings/export`}");
    expect(settings).toContain("t(\"books.guest.deleteDialog.noBackup\")");
  });

  it("总览：游客只放当前账本（每本账的卡片在那本账的上下文里读数，游客只有当前账本一份快照）", () => {
    const dashboard = flat("../../desktop/DesktopDashboardPage.tsx");
    expect(dashboard).toContain(".filter((book) => !guestMode || book.id === currentBookId)");
  });
});
