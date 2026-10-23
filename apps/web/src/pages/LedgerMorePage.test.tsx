import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { LedgerMorePage, RELOAD_CONFIRMATION } from "./LedgerMorePage.js";

/**
 * The ledger's 更多 screen.
 *
 * ⚠️ **Three promises are checked here, and each of them has already been broken once elsewhere in
 * this project:**
 *
 *  * 导出 is reachable — it lost its top-level button, so this is now the only way in;
 *  * 清空「待同步」印记 describes discarded pending actions and server conflict resolution;
 *  * 重新加载应用 is described as a page reload, and is **not** confused with 下载管理's
 *    「清除并重新加载」, which deletes the device's copy first.
 */
function renderPage(): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={["/ledger/more"]}>
      <LedgerMorePage />
    </MemoryRouter>,
  );
}

describe("LedgerMorePage", () => {
  it("groups the screen into 导出账目 / 筛选与查找 / 数据维护", () => {
    const html = renderPage();

    expect(html).toContain("导出账目");
    expect(html).toContain("导出为文件");
    expect(html).toContain("筛选与查找");
    expect(html).toContain("数据维护");
  });

  it("is honest that there is no text search yet", () => {
    const html = renderPage();

    expect(html).toContain("暂不支持文字搜索");
    expect(html).toContain("回到明细页筛选");
  });

  it("warns that pending changes stop submitting and conflicts use the server version", () => {
    const html = renderPage();

    expect(html).toContain("清空「待同步」印记");
    expect(html).not.toContain("不会发送任何请求");
    expect(html).toContain("尚未同步的修改和删除将不再提交");
    expect(html).toContain("请求将冲突按服务器版本处理");
    expect(html).toContain("此操作不删除账目");
  });

  it("offers 重新加载应用 as plain page reload, without promising a fix", () => {
    const html = renderPage();

    expect(html).toContain("重新加载应用");
    expect(html).toContain("不会清除本机账目");

    // It is not 下载管理's destructive sibling, and it must not read like it.
    expect(html).not.toContain("清除并重新加载");
    expect(html).not.toContain("清除本机全部数据");
  });
});

describe("RELOAD_CONFIRMATION", () => {
  it("warns about lost form input and an import in flight", () => {
    const joined = RELOAD_CONFIRMATION.consequences.join(" ");

    expect(joined).toContain("未保存的表单内容会丢失");
    expect(joined).toContain("正在进行的导入可能中断");
  });

  it("states that nothing is deleted or cleared", () => {
    const joined = RELOAD_CONFIRMATION.consequences.join(" ");

    expect(joined).toContain("不会清除本机账目");
    expect(joined).toContain("不会删除服务器上的任何数据");
  });

  it("does not promise a cache clear or a database repair", () => {
    const joined = [
      RELOAD_CONFIRMATION.description,
      ...RELOAD_CONFIRMATION.consequences,
    ].join(" ");

    expect(joined).not.toContain("清除缓存");
    expect(joined).not.toContain("修复数据库");
    expect(RELOAD_CONFIRMATION.confirmLabel).toBe("重新加载");
  });

  it("renders as the dialog the button opens", () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog
        open
        title={RELOAD_CONFIRMATION.title}
        description={RELOAD_CONFIRMATION.description}
        consequences={RELOAD_CONFIRMATION.consequences}
        confirmLabel={RELOAD_CONFIRMATION.confirmLabel}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(html).toContain("重新加载应用？");
    expect(html).toContain("未保存的表单内容会丢失");
    expect(html).toContain("重新加载");
  });
});
