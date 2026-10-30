import { describe, expect, it, vi } from "vitest";

import { NavDragController, type DragPayload, type DropTarget } from "./navDrag.js";

const payload: DragPayload = { path: "/transactions/t1", title: "午饭 -¥30.00", ledger: "travel", source: "w1" };

function zone(resolve: (x: number, y: number) => DropTarget | null) {
  const drop = vi.fn<(target: Exclude<DropTarget, "cancel">, payload: DragPayload) => void>();
  return { resolve, drop };
}

describe("在指定工作区打开：落点与松手", () => {
  it("没有工作区外壳（手机界面）时不进入拖动", () => {
    const controller = new NavDragController();
    controller.start(payload, 10, 10);
    expect(controller.get().active).toBe(false);
    expect(controller.end(true)).toBe(false);
  });

  it("按指针位置换算落点；落在主区松手 → 只在主区打开，并带上来源账本", () => {
    const controller = new NavDragController();
    const z = zone((x) => (x < 500 ? "primary" : "secondary"));
    controller.register(z);
    controller.start(payload, 600, 100);
    expect(controller.get().target).toBe("secondary");
    controller.move(200, 100);
    expect(controller.get().target).toBe("primary");
    expect(controller.end(true)).toBe(true);
    expect(z.drop).toHaveBeenCalledWith("primary", payload);
    expect(controller.get().active).toBe(false);
  });

  it("单区时落在预留位 → 新建辅助工作区", () => {
    const controller = new NavDragController();
    const z = zone((x) => (x > 700 ? "create" : "primary"));
    controller.register(z);
    controller.start(payload, 100, 100);
    controller.move(900, 300);
    controller.end(true);
    expect(z.drop).toHaveBeenCalledWith("create", payload);
  });

  it("不在任何落点（分界区、侧栏）松手 = 取消，什么都不打开", () => {
    const controller = new NavDragController();
    const z = zone(() => null);
    controller.register(z);
    controller.start(payload, 10, 10);
    expect(controller.end(true)).toBe(false);
    expect(z.drop).not.toHaveBeenCalled();
  });

  it("落在右上角的取消区域松手：什么都不打开", () => {
    const controller = new NavDragController();
    const z = zone((x, y) => (x > 1080 && y < 80 ? "cancel" : "secondary"));
    controller.register(z);
    controller.start(payload, 600, 300);
    controller.move(1150, 40);
    expect(controller.get().target).toBe("cancel");
    expect(controller.end(true)).toBe(false);
    expect(z.drop).not.toHaveBeenCalled();
  });

  it("Esc / 指针取消（end(false)）一律不打开，状态完全复原", () => {
    const controller = new NavDragController();
    const z = zone(() => "secondary");
    controller.register(z);
    const listener = vi.fn();
    controller.subscribe(listener);
    controller.start(payload, 10, 10);
    expect(controller.end(false)).toBe(false);
    expect(z.drop).not.toHaveBeenCalled();
    expect(controller.get()).toEqual({ active: false, payload: null, x: 0, y: 0, target: null });
    expect(listener).toHaveBeenCalled();
  });

  it("外壳卸载（旋转成手机界面）时进行中的拖动被清掉", () => {
    const controller = new NavDragController();
    const off = controller.register(zone(() => "primary"));
    controller.start(payload, 10, 10);
    off();
    expect(controller.get().active).toBe(false);
    expect(controller.enabled).toBe(false);
  });

  it("菜单「在主 / 辅助工作区打开」走同一条打开路径", () => {
    const controller = new NavDragController();
    const z = zone(() => null);
    controller.register(z);
    expect(controller.open("secondary", payload)).toBe(true);
    expect(z.drop).toHaveBeenCalledWith("secondary", payload);
  });
});
