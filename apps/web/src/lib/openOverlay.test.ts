import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { hasOpenOverlay, OPEN_OVERLAY_SELECTOR, type OverlayQueryRoot } from "./openOverlay.js";

/**
 * 转场协调器的“有没有弹窗打开”（1.19.58）。本仓库测试没有 DOM，用只认选择器的假节点验证判断：
 * 选择器覆盖模板标记、原生 dialog、对话框与确认框；位于正在收起的弹层里的节点不算打开。
 */
function fakeRoot(nodes: readonly { readonly closing: boolean; readonly hidden?: boolean }[]): OverlayQueryRoot & { last: string } {
  const root = {
    last: "",
    querySelectorAll(selector: string) {
      root.last = selector;
      return nodes.map((node) => ({
        closest: (query: string) => ((query === '[data-overlay-state="closing"]' && node.closing) || (query === '[inert], [hidden]' && node.hidden) ? {} : null),
      }));
    },
  };
  return root;
}

describe("转场协调器识别弹层", () => {
  it("选择器包含模板标记、原生 dialog、对话框，以及原来漏掉的确认框（alertdialog）", () => {
    expect(OPEN_OVERLAY_SELECTOR).toContain('[data-overlay-root][data-overlay-state="open"]');
    expect(OPEN_OVERLAY_SELECTOR).toContain("dialog[open]");
    expect(OPEN_OVERLAY_SELECTOR).toContain('[role="dialog"][aria-modal="true"]');
    expect(OPEN_OVERLAY_SELECTOR).toContain('[role="alertdialog"][aria-modal="true"]');
  });

  it("没有弹层时不算打开", () => {
    expect(hasOpenOverlay(fakeRoot([]))).toBe(false);
    expect(hasOpenOverlay(null)).toBe(false);
  });

  it("打开着的弹层算打开", () => {
    const root = fakeRoot([{ closing: false }]);
    expect(hasOpenOverlay(root)).toBe(true);
    expect(root.last).toBe(OPEN_OVERLAY_SELECTOR);
  });

  it("正在收起的弹层不算打开：从面板里发起导航不再丢转场", () => {
    expect(hasOpenOverlay(fakeRoot([{ closing: true }, { closing: false, hidden: true }]))).toBe(false);
    // 一个在收起、另一个仍打开：仍算打开。
    expect(hasOpenOverlay(fakeRoot([{ closing: true }, { closing: false }]))).toBe(true);
  });

  it("协调器读这一个判断，不再自己写选择器", () => {
    // 源码断言：pilot.tsx 不再保留旧的只认 dialog 的选择器。
    const source = readFileSync(fileURLToPath(new URL("../s19/motion/pilot.tsx", import.meta.url)), "utf8");
    expect(source).toContain("hasOpenOverlay()");
    expect(source).not.toContain("dialog[open], [role=dialog][aria-modal=true]");
  });
});
