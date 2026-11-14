/**
 * **分析工作台“撤销”提示只撤它说的那一步**（1.19.66，所有者决定第 20 条，只在界面层）。
 *
 * 带“撤销”的提示（删除卡片、恢复自动排列、应用预设、恢复默认）记下那一步提交后的撤销历史
 * （`EditorState.history.past`：每次提交、撤销、重做都会换成新数组，只改选中时保持同一个）。
 * 之后又有提交、撤销 / 重做，或离开编辑，提示收起；点“撤销”时历史已经不是那一步了，就什么也不做。
 *
 * 原来的缺陷：删除卡片后 5 秒内拖动另一张卡（移动不发提示，撤销提示还在），点“撤销”撤回的是那次移动。
 * 撤销逻辑本身（D 的 `applyCommand` 撤销历史）不变。
 */
import type { EditorState } from "./session.js";

export interface UndoToastBinding {
  /** 提示条 id。 */
  readonly id: number;
  /** 那一步提交后的撤销历史。 */
  readonly past: EditorState["history"]["past"];
}

/** 提示里的“撤销”现在还指着它说的那一步吗。 */
export function undoStillApplies(binding: Pick<UndoToastBinding, "past"> | null, session: EditorState | null): boolean {
  return binding !== null && session !== null && session.history.past === binding.past;
}
