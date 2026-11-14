import { describe, expect, it, vi } from "vitest";

import { t } from "../i18n/index.js";
import { ToastController } from "../lib/toast/controller.js";
import { undoToastOptions } from "./UndoProvider.js";

/**
 * 删除账目后的撤销（`useUndo()`，1.19.66 起走统一提示条）。
 * 所有者决定第 20 条：恢复失败时补一条错误提示（原来 `void request.onUndo()` 失败时什么也不说）。
 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("useUndo 的提示选项", () => {
  it("信息类型、跨页面、一个“撤销”，并写出常设替代路径", () => {
    const options = undoToastOptions({ message: "已删除这笔记账", onUndo: () => undefined }, t, () => undefined);
    expect(options).toMatchObject({ tone: "info", text: "已删除这笔记账", scope: "app" });
    expect(options.action?.label).toBe("撤销");
    expect(options.action?.alternative).toContain("编辑历史");
  });

  it("恢复成功：不补任何提示", async () => {
    const report = vi.fn();
    const onUndo = vi.fn(() => Promise.resolve());
    const options = undoToastOptions({ message: "已删除这笔记账", onUndo }, t, report);
    await options.action?.run();
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(report).not.toHaveBeenCalled();
  });

  it("恢复失败：补一条常驻错误提示，说明可以稍后从编辑历史恢复", async () => {
    const report = vi.fn();
    const options = undoToastOptions({ message: "已删除这笔记账", onUndo: () => Promise.reject(new Error("offline")) }, t, report);
    await options.action?.run();
    expect(report).toHaveBeenCalledTimes(1);
    const failure = report.mock.calls[0]![0];
    expect(failure).toMatchObject({ tone: "error", text: "撤销没有完成", scope: "app" });
    expect(failure.detail).toContain("编辑历史");
  });

  it("接到队列上：点“撤销”时提示先消失、恢复失败后出现 alert 播报的常驻错误（有 ×）", async () => {
    const controller = new ToastController();
    const options = undoToastOptions({ message: "已删除这笔记账", onUndo: () => Promise.reject(new Error("offline")) }, t, (failure) => {
      controller.show(failure);
    });
    const id = controller.show(options);
    expect(controller.getSnapshot().current?.action?.label).toBe("撤销");
    controller.runAction(id);
    expect(controller.getSnapshot().current).toBeNull();
    await flush();
    const snapshot = controller.getSnapshot();
    expect(snapshot.current).toMatchObject({ tone: "error", text: "撤销没有完成", closable: true });
    expect(snapshot.announcement).toMatchObject({ politeness: "alert", text: "撤销没有完成" });
  });

  it("跨页面保留：发出它的页面（账目详情）卸载后，撤销仍在列表上", () => {
    const controller = new ToastController();
    const detailPage = Symbol("entry-detail");
    controller.show(undoToastOptions({ message: "已删除这笔记账", onUndo: () => undefined }, t, () => undefined), detailPage);
    controller.dismissOwner(detailPage);
    expect(controller.getSnapshot().current?.text).toBe("已删除这笔记账");
  });
});
