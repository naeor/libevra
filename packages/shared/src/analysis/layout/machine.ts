/**
 * S17 工作台布局编辑模式状态机（D-2 前置，headless 纯逻辑）。
 *
 * 权威依据：布局规格 §3（普通/编辑模式严格分离、完成提交、取消放弃、系统返回=取消、
 * 破坏性操作可撤销、编辑中断不得部分写回）、§10（编辑会话=内存草稿，完成时一次性原子提交）；
 * 所有者规格 §40 D-2（显式编辑入口、保存/取消）。
 *
 * 设计边界：
 * - 这是**交互状态机草案**，不含任何 UI 视觉/动画/手势细节（由 Codex 规范补充）；
 * - 状态机只描述“模式/阶段/脏标记/待确认丢弃”，不持有文档；文档在 `EditorState`；
 * - 进入编辑与退出编辑的入口按钮、二次确认弹层外观，均为 UI 层职责；
 * - 未确认口径：编辑草稿是否落本地（OQ-CF-02，先不落）、切后台/刷新恢复（W5 研究）。
 */

/** 顶层模式：浏览（普通）与布局编辑。 */
export type EditorMode = "browse" | "edit";

/** 编辑会话内的阶段：空闲/拖动中/缩放中/取消二次确认中。 */
export type EditorPhase = "idle" | "dragging" | "resizing" | "confirming-discard";

export interface EditorMachineState {
  readonly mode: EditorMode;
  readonly phase: EditorPhase;
  /** 本次编辑会话是否已产生改动（决定取消是否需要二次确认）。 */
  readonly hasUnsavedChanges: boolean;
  /** 是否正在等待“丢弃改动”的二次确认。 */
  readonly pendingDiscard: boolean;
}

export const INITIAL_EDITOR_MACHINE_STATE: EditorMachineState = {
  mode: "browse",
  phase: "idle",
  hasUnsavedChanges: false,
  pendingDiscard: false,
};

/** 状态机输出给 UI/持久化层的副作用标记（状态机自身不执行副作用）。 */
export type EditorEffect =
  | "commit-layout"
  | "discard-draft"
  | "clear-history"
  | "notify-unsaved-changes"
  | "request-leave-workbench";

export interface EditorMachineTransition {
  readonly state: EditorMachineState;
  readonly effects: readonly EditorEffect[];
  /** 事件在当前状态下是否合法；非法事件返回原状态、无副作用。 */
  readonly accepted: boolean;
}

export type EditorMachineEvent =
  | { readonly type: "enter-edit" }
  | { readonly type: "change-made" }
  | { readonly type: "begin-gesture"; readonly gesture: "move" | "resize" }
  | { readonly type: "end-gesture" }
  | { readonly type: "commit" }
  | { readonly type: "request-cancel" }
  | { readonly type: "system-back" }
  | { readonly type: "confirm-discard" }
  | { readonly type: "dismiss-discard" };

function reject(state: EditorMachineState): EditorMachineTransition {
  return { state, effects: [], accepted: false };
}

function accept(
  state: EditorMachineState,
  effects: readonly EditorEffect[] = [],
): EditorMachineTransition {
  return { state, effects, accepted: true };
}

function leaveEdit(effects: readonly EditorEffect[]): EditorMachineTransition {
  return accept(
    { mode: "browse", phase: "idle", hasUnsavedChanges: false, pendingDiscard: false },
    effects,
  );
}

/**
 * 编辑器状态机转移。
 *
 * 合法迁移摘要：
 * - 浏览 → 编辑：`enter-edit`；
 * - 编辑内：`change-made` 置脏、`begin-gesture`/`end-gesture` 管理拖动/缩放阶段；
 * - 编辑 → 浏览：`commit`（提交，需空闲且无待确认丢弃）、`request-cancel`
 *   （无改动直接放弃；有改动进入 `confirming-discard` 并提示）、`system-back` 等同取消；
 * - `confirming-discard`：`confirm-discard` 丢弃并退出；`dismiss-discard` 返回编辑。
 */
export function transitionEditorMachine(
  state: EditorMachineState,
  event: EditorMachineEvent,
): EditorMachineTransition {
  switch (event.type) {
    case "enter-edit": {
      if (state.mode === "edit") {
        return reject(state);
      }
      return accept({ mode: "edit", phase: "idle", hasUnsavedChanges: false, pendingDiscard: false });
    }

    case "change-made": {
      if (state.mode !== "edit" || state.pendingDiscard) {
        return reject(state);
      }
      if (state.hasUnsavedChanges) {
        return accept(state);
      }
      return accept({ ...state, hasUnsavedChanges: true });
    }

    case "begin-gesture": {
      if (state.mode !== "edit" || state.phase !== "idle" || state.pendingDiscard) {
        return reject(state);
      }
      return accept({ ...state, phase: event.gesture === "move" ? "dragging" : "resizing" });
    }

    case "end-gesture": {
      if (
        state.mode !== "edit" ||
        (state.phase !== "dragging" && state.phase !== "resizing")
      ) {
        return reject(state);
      }
      return accept({ ...state, phase: "idle" });
    }

    case "commit": {
      if (state.mode !== "edit" || state.phase !== "idle" || state.pendingDiscard) {
        return reject(state);
      }
      return leaveEdit(["commit-layout", "clear-history"]);
    }

    case "request-cancel": {
      if (state.mode !== "edit") {
        return reject(state);
      }
      if (state.hasUnsavedChanges) {
        return accept(
          { ...state, phase: "confirming-discard", pendingDiscard: true },
          ["notify-unsaved-changes"],
        );
      }
      return leaveEdit(["discard-draft", "clear-history"]);
    }

    case "system-back": {
      if (state.mode !== "edit") {
        return accept(state, ["request-leave-workbench"]);
      }
      if (state.hasUnsavedChanges) {
        return accept(
          { ...state, phase: "confirming-discard", pendingDiscard: true },
          ["notify-unsaved-changes"],
        );
      }
      return leaveEdit(["discard-draft", "clear-history"]);
    }

    case "confirm-discard": {
      if (state.phase !== "confirming-discard") {
        return reject(state);
      }
      return leaveEdit(["discard-draft", "clear-history"]);
    }

    case "dismiss-discard": {
      if (state.phase !== "confirming-discard") {
        return reject(state);
      }
      return accept({ ...state, phase: "idle", pendingDiscard: false });
    }
  }
}
