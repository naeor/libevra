import { describe, expect, it } from "vitest";

import { defaultKey, enqueue, EMPTY_QUEUE, expireWaiting, finish, removeOwner, type QueueEntry, type QueueState } from "./queue.js";
import type { ToastOptions, ToastTone } from "./types.js";

/**
 * 1.19.66 统一提示条的队列规则（方案 §2.3 R1–R7）：一次一条、合并、抢占、等待位、作用域。
 */
let seq = 0;
function entry(options: ToastOptions & { readonly at?: number; readonly owner?: symbol }): QueueEntry {
  seq += 1;
  const tone: ToastTone = options.tone ?? "info";
  return {
    id: seq,
    slot: seq,
    revision: 0,
    createdAt: options.at ?? seq,
    key: defaultKey(seq, tone, options),
    tone,
    scope: options.scope ?? "app",
    owner: options.owner ?? null,
    options,
  };
}
const action = { label: "撤销", run: () => undefined, alternative: "编辑条的撤销按钮" };
const ids = (state: QueueState) => [state.current?.id ?? null, state.waiting?.id ?? null];

describe("提示条队列", () => {
  it("R1 一次一条：普通消息替换普通消息", () => {
    const a = entry({ text: "已复制" });
    const b = entry({ text: "已添加" });
    const first = enqueue(EMPTY_QUEUE, a);
    const second = enqueue(first.state, b);
    expect(ids(second.state)).toEqual([b.id, null]);
    expect(second.ended).toEqual([{ entry: a, reason: "replaced" }]);
  });

  it("R2 合并：同 key 原位更新（槽位不变、合并次数 +1），可以跨类型", () => {
    const failed = entry({ tone: "error", text: "保存失败", key: "stats-save" });
    const saved = entry({ tone: "success", text: "已保存", key: "stats-save" });
    const merged = enqueue(enqueue(EMPTY_QUEUE, failed).state, saved);
    expect(merged.state.current?.id).toBe(saved.id);
    expect(merged.state.current?.slot).toBe(failed.slot);
    expect(merged.state.current?.revision).toBe(1);
    expect(merged.state.waiting).toBeNull();
    expect(merged.ended).toEqual([{ entry: failed, reason: "replaced" }]);
  });

  it("默认 key：普通消息按类型 + 文字合并；带操作的各自唯一", () => {
    expect(defaultKey(1, "success", { text: "已保存" })).toBe(defaultKey(2, "success", { text: "已保存" }));
    expect(defaultKey(1, "info", { text: "已删除这笔记账", action })).not.toBe(defaultKey(2, "info", { text: "已删除这笔记账", action }));
  });

  it("R3 带操作抢占：连续删除两笔，第二条替换第一条，第一条的操作结束（replaced），不再恢复", () => {
    const first = entry({ text: "已删除这笔记账", action });
    const second = entry({ text: "已删除这笔记账", action });
    const result = enqueue(enqueue(EMPTY_QUEUE, first).state, second);
    expect(ids(result.state)).toEqual([second.id, null]);
    expect(result.ended).toEqual([{ entry: first, reason: "replaced" }]);
  });

  it("R3 被替换的未关闭错误回到等待位，不会悄悄消失；当前结束后再提上来", () => {
    const error = entry({ tone: "error", text: "保存失败" });
    const undo = entry({ text: "已删除卡片", action });
    const replaced = enqueue(enqueue(EMPTY_QUEUE, error).state, undo);
    expect(ids(replaced.state)).toEqual([undo.id, error.id]);
    expect(replaced.ended).toEqual([]);
    const after = finish(replaced.state, undo.id, "timeout", 99_999);
    expect(ids(after.state)).toEqual([error.id, null]);
  });

  it("R4 普通消息遇到错误或带操作：进等待位；当前结束时 3 秒内补显示，过期丢弃", () => {
    const undo = entry({ text: "已删除卡片", action, at: 0 });
    const copied = entry({ tone: "success", text: "已复制", at: 1_000 });
    const queued = enqueue(enqueue(EMPTY_QUEUE, undo).state, copied);
    expect(ids(queued.state)).toEqual([undo.id, copied.id]);
    expect(ids(finish(queued.state, undo.id, "action", 3_000).state)).toEqual([copied.id, null]);
    const late = finish(queued.state, undo.id, "timeout", 4_000);
    expect(ids(late.state)).toEqual([null, null]);
    expect(late.ended.map((item) => item.reason)).toEqual(["timeout", "expired"]);
  });

  it("R5 等待位只留一条：错误优先于普通，同级留最新；警告最多等 6 秒", () => {
    const undo = entry({ text: "已删除", action, at: 0 });
    const info = entry({ text: "已切换为跟随模式", at: 10 });
    const warning = entry({ tone: "warning", text: "放不下", at: 20 });
    let state = enqueue(EMPTY_QUEUE, undo).state;
    state = enqueue(state, info).state;
    const swapped = enqueue(state, warning);
    expect(swapped.state.waiting?.id).toBe(warning.id);
    expect(swapped.ended).toEqual([{ entry: info, reason: "expired" }]);
    expect(expireWaiting(swapped.state, 6_019).state.waiting?.id).toBe(warning.id);
    expect(expireWaiting(swapped.state, 6_020).state.waiting).toBeNull();

    const error = entry({ tone: "error", text: "保存失败", at: 30 });
    const withError = enqueue(enqueue(EMPTY_QUEUE, error).state, entry({ text: "撤销", action, at: 40 })).state;
    const normal = enqueue(withError, entry({ tone: "success", text: "已复制", at: 50 }));
    expect(normal.state.waiting?.id).toBe(error.id);
    expect(normal.ended[0]?.reason).toBe("expired");
  });

  it("R5 错误在等待位里不过期", () => {
    const error = entry({ tone: "error", text: "保存失败", at: 0 });
    const undo = entry({ text: "撤销", action, at: 1 });
    const state = enqueue(enqueue(EMPTY_QUEUE, error).state, undo).state;
    expect(expireWaiting(state, 10_000_000).state.waiting?.id).toBe(error.id);
  });

  it("等待中的同 key 消息被新消息顶替", () => {
    const undo = entry({ text: "撤销", action, at: 0 });
    const a = entry({ tone: "success", text: "已复制", at: 1 });
    const b = entry({ tone: "success", text: "已复制", at: 2 });
    const result = enqueue(enqueue(enqueue(EMPTY_QUEUE, undo).state, a).state, b);
    expect(ids(result.state)).toEqual([undo.id, b.id]);
    expect(result.ended).toEqual([{ entry: a, reason: "replaced" }]);
  });

  it("R7 页面作用域：发出者卸载时撤下（unmounted），应用作用域保留", () => {
    const page = Symbol("stats");
    const pageToast = entry({ text: "已添加", scope: "page", owner: page });
    const removed = removeOwner(enqueue(EMPTY_QUEUE, pageToast).state, page, 0);
    expect(removed.state.current).toBeNull();
    expect(removed.ended).toEqual([{ entry: pageToast, reason: "unmounted" }]);

    const appToast = entry({ text: "已删除这笔记账", action, scope: "app", owner: page });
    expect(removeOwner(enqueue(EMPTY_QUEUE, appToast).state, page, 0).state.current?.id).toBe(appToast.id);
  });

  it("结束不存在的 id：原样返回", () => {
    const a = entry({ text: "已复制" });
    const state = enqueue(EMPTY_QUEUE, a).state;
    expect(finish(state, 99_999, "dismissed", 0).state).toBe(state);
  });
});
