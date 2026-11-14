import { describe, expect, it, vi } from "vitest";

import { ToastController, type ToastClock } from "./controller.js";
import type { ToastEndReason } from "./types.js";

/**
 * 1.19.66 统一提示条控制器：计时、暂停与恢复、可见计时、播报、替换与撤销。用手动推进的假时钟。
 */
class FakeClock implements ToastClock {
  time = 0;
  private timers: { at: number; run: () => void; id: number }[] = [];
  private seq = 0;
  now = (): number => this.time;
  setTimeout = (run: () => void, ms: number): unknown => {
    const id = ++this.seq;
    this.timers.push({ at: this.time + ms, run, id });
    return id;
  };
  clearTimeout = (handle: unknown): void => {
    this.timers = this.timers.filter((timer) => timer.id !== handle);
  };
  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      const due = this.timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      this.timers = this.timers.filter((timer) => timer !== due);
      this.time = due.at;
      due.run();
    }
    this.time = end;
  }
}

function setup() {
  const clock = new FakeClock();
  const controller = new ToastController(clock);
  return { clock, controller };
}
const action = (run: () => void | Promise<void> = () => undefined) => ({ label: "撤销", run, alternative: "编辑历史 → 已删除账目 →「恢复」" });

describe("提示条控制器", () => {
  it("普通提示按时长自动消失，结束原因 timeout", () => {
    const { clock, controller } = setup();
    const ended: ToastEndReason[] = [];
    controller.show({ tone: "success", text: "已保存", onEnd: (reason) => ended.push(reason) });
    expect(controller.getSnapshot().current?.text).toBe("已保存");
    clock.advance(3_999);
    expect(controller.getSnapshot().current).not.toBeNull();
    clock.advance(1);
    expect(controller.getSnapshot().current).toBeNull();
    expect(ended).toEqual(["timeout"]);
  });

  it("错误不自动消失，有 ×；关闭后结束原因 closed", () => {
    const { clock, controller } = setup();
    const ended: ToastEndReason[] = [];
    const id = controller.show({ tone: "error", text: "保存失败", onEnd: (reason) => ended.push(reason) });
    clock.advance(60_000);
    expect(controller.getSnapshot().current?.closable).toBe(true);
    controller.close(id);
    expect(controller.getSnapshot().current).toBeNull();
    expect(ended).toEqual(["closed"]);
  });

  it("悬停 / 聚焦时暂停；离开后至少还剩最少时长（带操作 4s）", () => {
    const { clock, controller } = setup();
    controller.show({ text: "已删除这笔记账", action: action() });
    clock.advance(9_000);
    controller.setPause("hover", true);
    clock.advance(30_000);
    expect(controller.getSnapshot().current).not.toBeNull();
    controller.setPause("hover", false);
    expect(controller.remainingMs()).toBe(4_000);
    clock.advance(3_999);
    expect(controller.getSnapshot().current).not.toBeNull();
    clock.advance(1);
    expect(controller.getSnapshot().current).toBeNull();
  });

  it("剩余时间比最少时长多时，恢复后按原剩余时间继续", () => {
    const { clock, controller } = setup();
    controller.show({ text: "已删除这笔记账", action: action() });
    clock.advance(2_000);
    controller.setPause("focus", true);
    clock.advance(5_000);
    controller.setPause("focus", false);
    expect(controller.remainingMs()).toBe(8_000);
  });

  it("页面切到后台与弹层打开（让开）都暂停，且不在屏幕上", () => {
    const { clock, controller } = setup();
    controller.show({ tone: "success", text: "已保存" });
    controller.setPause("yield", true);
    expect(controller.getSnapshot().visible).toBe(false);
    clock.advance(20_000);
    expect(controller.getSnapshot().current).not.toBeNull();
    controller.setPause("yield", false);
    expect(controller.getSnapshot().visible).toBe(true);
    controller.setPause("hidden", true);
    expect(controller.getSnapshot().visible).toBe(false);
    clock.advance(20_000);
    controller.setPause("hidden", false);
    expect(controller.remainingMs()).toBe(4_000);
  });

  it("让开后再出现：出现次数 +1（宿主据此重播入场）；合并不加", () => {
    const { controller } = setup();
    controller.show({ tone: "success", text: "已保存", key: "k" });
    expect(controller.getSnapshot().current?.appearance).toBe(1);
    controller.setPause("yield", true);
    controller.setPause("yield", false);
    expect(controller.getSnapshot().current?.appearance).toBe(2);
    const slot = controller.getSnapshot().current?.slot;
    controller.show({ tone: "success", text: "又保存了一次", key: "k" });
    expect(controller.getSnapshot().current?.slot).toBe(slot);
    expect(controller.getSnapshot().current?.appearance).toBe(2);
    expect(controller.getSnapshot().current?.revision).toBe(1);
  });

  it("弹层打开时新来的提示：先问宿主要不要让开，不会先播报再让开", () => {
    const { controller } = setup();
    controller.setYieldProbe(() => true);
    controller.show({ tone: "success", text: "已应用预设" });
    expect(controller.getSnapshot().visible).toBe(false);
    expect(controller.getSnapshot().announcement).toBeNull();
    controller.setYieldProbe(() => false);
    controller.setPause("yield", false);
    expect(controller.getSnapshot().announcement?.text).toBe("已应用预设");
  });

  it("可见计时（onSeen）：只在屏幕上时累计，悬停照常累计；满了只回调一次", () => {
    const { clock, controller } = setup();
    const seen = vi.fn();
    controller.show({ text: "获得新头像", action: action(), onSeen: { afterMs: 4_000, run: seen } });
    clock.advance(2_000);
    controller.setPause("yield", true);
    clock.advance(10_000);
    expect(seen).not.toHaveBeenCalled();
    controller.setPause("yield", false);
    controller.setPause("hover", true);
    clock.advance(1_999);
    expect(seen).not.toHaveBeenCalled();
    clock.advance(1);
    expect(seen).toHaveBeenCalledTimes(1);
    clock.advance(10_000);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("被替换时没看够 4 秒：不回调 onSeen", () => {
    const { clock, controller } = setup();
    const seen = vi.fn();
    const ended: ToastEndReason[] = [];
    controller.show({ text: "获得新头像", action: action(), onSeen: { afterMs: 4_000, run: seen }, onEnd: (reason) => ended.push(reason) });
    clock.advance(1_000);
    controller.show({ text: "已删除这笔记账", action: action() });
    clock.advance(20_000);
    expect(seen).not.toHaveBeenCalled();
    expect(ended).toEqual(["replaced"]);
  });

  it("点操作：提示先消失，再执行操作（结束原因 action）", () => {
    const { controller } = setup();
    const order: string[] = [];
    const id = controller.show({
      text: "已删除这笔记账",
      action: action(() => {
        order.push(controller.getSnapshot().current === null ? "run-after-dismiss" : "run-while-shown");
      }),
      onEnd: (reason) => order.push(reason),
    });
    controller.runAction(id);
    expect(order).toEqual(["action", "run-after-dismiss"]);
  });

  it("连续删除两笔：第二条的计时从头开始（原撤销条计时不重置的缺陷）", () => {
    const { clock, controller } = setup();
    controller.show({ text: "已删除这笔记账", action: action() });
    clock.advance(8_000);
    const second = controller.show({ text: "已删除这笔记账", action: action() });
    expect(controller.getSnapshot().current?.id).toBe(second);
    clock.advance(9_999);
    expect(controller.getSnapshot().current?.id).toBe(second);
    clock.advance(1);
    expect(controller.getSnapshot().current).toBeNull();
  });

  it("等待中的普通消息在当前结束时补显示；过期则丢弃", () => {
    const { clock, controller } = setup();
    const undo = controller.show({ text: "已删除卡片", action: action() });
    controller.show({ tone: "success", text: "已复制" });
    expect(controller.getSnapshot().current?.id).toBe(undo);
    controller.dismiss(undo);
    expect(controller.getSnapshot().current?.text).toBe("已复制");

    const again = controller.show({ text: "已删除卡片", action: action() });
    const ended: ToastEndReason[] = [];
    controller.show({ tone: "success", text: "已添加", onEnd: (reason) => ended.push(reason) });
    clock.advance(3_000);
    expect(ended).toEqual(["expired"]);
    expect(controller.getSnapshot().current?.id).toBe(again);
  });

  it("播报：错误用 alert，其余用 status；错误回声用 status；announce: false 不播报；同 key 1 秒内只播一次", () => {
    const { clock, controller } = setup();
    controller.show({ tone: "error", text: "保存失败" });
    expect(controller.getSnapshot().announcement).toMatchObject({ politeness: "alert", tone: "error", text: "保存失败" });
    controller.show({ tone: "error", text: "全部失败", echo: true });
    expect(controller.getSnapshot().announcement).toMatchObject({ politeness: "status", text: "全部失败" });
    controller.show({ text: "已删除这笔记账", action: action() });
    expect(controller.getSnapshot().announcement).toMatchObject({ politeness: "status", actionLabel: "撤销" });
    const serial = controller.getSnapshot().announcement?.serial;
    controller.show({ text: "移动中", announce: false });
    expect(controller.getSnapshot().announcement?.serial).toBe(serial);

    // 被替换的错误回到等待位，当前结束后重新出现时再播报一次。
    clock.advance(10_000);
    expect(controller.getSnapshot().current?.text).toBe("保存失败");
    expect(controller.getSnapshot().announcement).toMatchObject({ politeness: "alert", text: "保存失败" });
  });

  it("同 key 1 秒内重复出现只播报一次", () => {
    const { clock, controller } = setup();
    controller.show({ tone: "success", text: "已复制" });
    const first = controller.getSnapshot().announcement?.serial ?? 0;
    controller.show({ tone: "success", text: "已复制" });
    expect(controller.getSnapshot().announcement?.serial).toBe(first);
    clock.advance(1_000);
    controller.show({ tone: "success", text: "已复制" });
    expect(controller.getSnapshot().announcement?.serial).toBe(first + 1);
  });

  it("页面作用域：发出者卸载时撤下，不触发操作；应用作用域跨页面保留", () => {
    const { controller } = setup();
    const page = Symbol("page");
    const run = vi.fn();
    controller.show({ text: "已删除卡片", action: action(run), scope: "page" }, page);
    controller.dismissOwner(page);
    expect(controller.getSnapshot().current).toBeNull();
    expect(run).not.toHaveBeenCalled();

    controller.show({ text: "已删除这笔记账", action: action(run), scope: "app" }, page);
    controller.dismissOwner(page);
    expect(controller.getSnapshot().current?.text).toBe("已删除这笔记账");
  });

  it("快照不变时不通知订阅者", () => {
    const { controller } = setup();
    const listener = vi.fn();
    controller.subscribe(listener);
    controller.show({ tone: "success", text: "已保存" });
    expect(listener).toHaveBeenCalledTimes(1);
    controller.setPause("hover", true);
    controller.setPause("hover", false);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
