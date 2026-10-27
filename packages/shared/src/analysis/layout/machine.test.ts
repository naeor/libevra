import { describe, expect, it } from "vitest";
import {
  INITIAL_EDITOR_MACHINE_STATE,
  transitionEditorMachine,
} from "./machine.js";
import type { EditorMachineEvent, EditorMachineState } from "./machine.js";

function run(
  state: EditorMachineState,
  events: readonly EditorMachineEvent[],
): EditorMachineState {
  let current = state;
  for (const event of events) {
    current = transitionEditorMachine(current, event).state;
  }
  return current;
}

describe("进入/退出编辑模式", () => {
  it("初始为浏览态；enter-edit 进入编辑空闲态", () => {
    expect(INITIAL_EDITOR_MACHINE_STATE.mode).toBe("browse");
    const transition = transitionEditorMachine(INITIAL_EDITOR_MACHINE_STATE, {
      type: "enter-edit",
    });
    expect(transition.accepted).toBe(true);
    expect(transition.state).toEqual({
      mode: "edit",
      phase: "idle",
      hasUnsavedChanges: false,
      pendingDiscard: false,
    });
  });

  it("无改动的 commit 退出并产出提交副作用", () => {
    const editing = run(INITIAL_EDITOR_MACHINE_STATE, [{ type: "enter-edit" }]);
    const transition = transitionEditorMachine(editing, { type: "commit" });
    expect(transition.accepted).toBe(true);
    expect(transition.state.mode).toBe("browse");
    expect(transition.effects).toEqual(["commit-layout", "clear-history"]);
  });

  it("重复 enter-edit 被拒绝", () => {
    const editing = run(INITIAL_EDITOR_MACHINE_STATE, [{ type: "enter-edit" }]);
    const transition = transitionEditorMachine(editing, { type: "enter-edit" });
    expect(transition.accepted).toBe(false);
    expect(transition.state).toBe(editing);
  });
});

describe("脏标记与取消", () => {
  it("change-made 置脏且只置一次", () => {
    const editing = run(INITIAL_EDITOR_MACHINE_STATE, [{ type: "enter-edit" }]);
    const dirty = transitionEditorMachine(editing, { type: "change-made" });
    expect(dirty.state.hasUnsavedChanges).toBe(true);
    expect(transitionEditorMachine(dirty.state, { type: "change-made" }).state).toBe(dirty.state);
  });

  it("有改动时 request-cancel 进入二次确认，dismiss 返回编辑", () => {
    const dirty = run(INITIAL_EDITOR_MACHINE_STATE, [
      { type: "enter-edit" },
      { type: "change-made" },
    ]);
    const confirming = transitionEditorMachine(dirty, { type: "request-cancel" });
    expect(confirming.state.phase).toBe("confirming-discard");
    expect(confirming.state.pendingDiscard).toBe(true);
    expect(confirming.effects).toEqual(["notify-unsaved-changes"]);

    const dismissed = transitionEditorMachine(confirming.state, {
      type: "dismiss-discard",
    });
    expect(dismissed.accepted).toBe(true);
    expect(dismissed.state.mode).toBe("edit");
    expect(dismissed.state.phase).toBe("idle");
    expect(dismissed.state.pendingDiscard).toBe(false);
  });

  it("无改动时 request-cancel 直接退出丢弃草稿", () => {
    const editing = run(INITIAL_EDITOR_MACHINE_STATE, [{ type: "enter-edit" }]);
    const transition = transitionEditorMachine(editing, { type: "request-cancel" });
    expect(transition.state.mode).toBe("browse");
    expect(transition.effects).toEqual(["discard-draft", "clear-history"]);
  });

  it("confirm-discard 退出并丢弃；commit 在待确认时被拒绝", () => {
    const confirming = run(INITIAL_EDITOR_MACHINE_STATE, [
      { type: "enter-edit" },
      { type: "change-made" },
      { type: "request-cancel" },
    ]);
    const commit = transitionEditorMachine(confirming, { type: "commit" });
    expect(commit.accepted).toBe(false);

    const discarded = transitionEditorMachine(confirming, { type: "confirm-discard" });
    expect(discarded.state.mode).toBe("browse");
    expect(discarded.state.hasUnsavedChanges).toBe(false);
    expect(discarded.effects).toEqual(["discard-draft", "clear-history"]);
  });
});

describe("手势阶段与系统返回", () => {
  it("begin-gesture / end-gesture 切换拖动缩放阶段", () => {
    const editing = run(INITIAL_EDITOR_MACHINE_STATE, [{ type: "enter-edit" }]);
    const dragging = transitionEditorMachine(editing, {
      type: "begin-gesture",
      gesture: "move",
    });
    expect(dragging.state.phase).toBe("dragging");
    const resizing = transitionEditorMachine(editing, {
      type: "begin-gesture",
      gesture: "resize",
    });
    expect(resizing.state.phase).toBe("resizing");

    const ended = transitionEditorMachine(dragging.state, { type: "end-gesture" });
    expect(ended.state.phase).toBe("idle");
    // 非手势阶段 end-gesture 被拒绝。
    expect(transitionEditorMachine(editing, { type: "end-gesture" }).accepted).toBe(false);
  });

  it("system-back：浏览态请求离开；编辑态等同取消", () => {
    const browse = transitionEditorMachine(INITIAL_EDITOR_MACHINE_STATE, {
      type: "system-back",
    });
    expect(browse.effects).toEqual(["request-leave-workbench"]);

    const editing = run(INITIAL_EDITOR_MACHINE_STATE, [{ type: "enter-edit" }]);
    const back = transitionEditorMachine(editing, { type: "system-back" });
    expect(back.state.mode).toBe("browse");
  });

  it("浏览态下的编辑事件被拒绝", () => {
    for (const event of [
      { type: "change-made" },
      { type: "begin-gesture", gesture: "move" },
      { type: "end-gesture" },
      { type: "commit" },
      { type: "request-cancel" },
      { type: "confirm-discard" },
      { type: "dismiss-discard" },
    ] satisfies readonly EditorMachineEvent[]) {
      expect(transitionEditorMachine(INITIAL_EDITOR_MACHINE_STATE, event).accepted).toBe(false);
    }
  });
});
