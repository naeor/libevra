/**
 * **S18 多工作区的状态模型（纯函数）。**
 *
 * ⚠️ **角色与内容实例分开建模。** `w1` / `w2` 是两个**内容实例**（各自的页面、历史、筛选、滚动与草稿），
 * `primary` / `secondary` 是它们**当前担任的角色**。拖动分界线收起原主区时，只是把角色交换：
 * 原辅助区的实例成为主区（页面、账本、筛选原样保留），原主区的实例被**保留**为可恢复的辅助区。
 * 「主工作区永远等于最初的左侧页面」这种写死的关系在这里不存在。
 *
 * ⚠️ **收起 ≠ 删除。** 任何动作都不会丢弃一个实例：关闭、收起、空间不足时的临时隐藏，都只改
 * `secondaryOpen`；实例本身（以及其中尚未保存的表单）一直挂载，恢复时原样出现。
 *
 * ⚠️ **账本属于实例，不属于角色**（第二轮）。`ledgers[w1]` / `ledgers[w2]` 是两个实例各自查看的账本
 * （`null` = 设备当前账本）。晋升、交换、收起只换角色，账本跟着实例走；一侧换账本不会改另一侧。
 */

export type InstanceId = "w1" | "w2";
export type FollowMode = "follow" | "independent";
export type RailPreference = "auto" | "expanded" | "collapsed";
/** 每个实例查看的账本 id；`null` = 跟随设备当前账本。 */
export type PaneLedgers = Readonly<Record<InstanceId, string | null>>;

export interface WorkspaceState {
  /** 当前担任主工作区的实例：全局侧栏与地址栏属于它。 */
  readonly primary: InstanceId;
  /** 已创建的辅助实例（`null` = 从未打开过辅助区）。 */
  readonly secondary: InstanceId | null;
  /** 辅助区是否处于打开状态（空间不足时仍可为 `true`，只是暂时不显示）。 */
  readonly secondaryOpen: boolean;
  readonly mode: FollowMode;
  /** 主工作区占双工作区可用空间的比例（横屏为宽度、竖屏为高度）。 */
  readonly ratio: number;
  /** 侧栏：自动（单区完整、双区紧凑）或用户指定。 */
  readonly rail: RailPreference;
  readonly ledgers: PaneLedgers;
}

export const DEFAULT_RATIO = 0.55;

export const INITIAL_WORKSPACE: WorkspaceState = {
  primary: "w1",
  secondary: null,
  secondaryOpen: false,
  mode: "follow",
  ratio: DEFAULT_RATIO,
  rail: "auto",
  ledgers: { w1: null, w2: null },
};

export type WorkspaceAction =
  /** 创建（若无）并打开辅助区；`independent` 表示用户明确让辅助区承担某项任务。 */
  | { readonly type: "openSecondary"; readonly independent: boolean }
  /** 恢复已保留的辅助区（不指定新页面）。 */
  | { readonly type: "restoreSecondary" }
  /** 关闭 / 收起辅助区：实例保留。 */
  | { readonly type: "closeSecondary" }
  /** 分界线越界松手：收起被压缩的一侧。收起主区 = 辅助区晋升为主区。 */
  | { readonly type: "collapse"; readonly side: "primary" | "secondary" }
  /** 两区都在时交换角色（「设为主工作区」）。 */
  | { readonly type: "swapRoles" }
  | { readonly type: "setMode"; readonly mode: FollowMode }
  | { readonly type: "setRatio"; readonly ratio: number }
  | { readonly type: "setRail"; readonly rail: RailPreference }
  /** 一个实例改看另一本账（`null` = 设备当前账本）；另一个实例不变。 */
  | { readonly type: "setLedger"; readonly instance: InstanceId; readonly ledger: string | null }
  /**
   * 设备当前账本将从 `previous` 换成 `next`（整页重新载入）：`keep` 实例跟着换（回到 `null`），
   * 其余**跟随当前账本**的实例钉在 `previous` 上——所以主区换账本时，辅助区仍然显示它原来那本账。
   */
  | { readonly type: "pinLedgers"; readonly keep: InstanceId; readonly previous: string; readonly next: string }
  /** 退出登录 / 换了身份：丢掉辅助区实例（它属于上一个身份），主区与侧栏偏好保留。 */
  | { readonly type: "resetForIdentity" };

export function otherInstance(id: InstanceId): InstanceId {
  return id === "w1" ? "w2" : "w1";
}

export function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_RATIO;
  return Math.min(0.7, Math.max(0.3, ratio));
}

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "openSecondary": {
      const secondary = state.secondary ?? otherInstance(state.primary);
      return {
        ...state,
        secondary,
        secondaryOpen: true,
        mode: action.independent ? "independent" : state.mode,
        // 新建的辅助区从设备当前账本开始，不沿用以前会话里那个实例的账本。
        ledgers: state.secondary === null ? { ...state.ledgers, [secondary]: null } : state.ledgers,
      };
    }
    case "restoreSecondary":
      if (state.secondary === null) return state;
      return { ...state, secondaryOpen: true };
    case "closeSecondary":
      return state.secondaryOpen ? { ...state, secondaryOpen: false } : state;
    case "collapse": {
      if (state.secondary === null || !state.secondaryOpen) return state;
      if (action.side === "secondary") return { ...state, secondaryOpen: false };
      // 原主区被收起：原辅助区晋升为唯一主区，原主区实例保留为可恢复的辅助区。
      return { ...state, primary: state.secondary, secondary: state.primary, secondaryOpen: false };
    }
    case "swapRoles":
      if (state.secondary === null || !state.secondaryOpen) return state;
      return { ...state, primary: state.secondary, secondary: state.primary, ratio: clampRatio(1 - state.ratio) };
    case "setMode":
      return state.mode === action.mode ? state : { ...state, mode: action.mode };
    case "setRatio": {
      const ratio = clampRatio(action.ratio);
      return ratio === state.ratio ? state : { ...state, ratio };
    }
    case "setRail":
      return state.rail === action.rail ? state : { ...state, rail: action.rail };
    case "setLedger": {
      const ledger = action.ledger === "" ? null : action.ledger;
      if (state.ledgers[action.instance] === ledger) return state;
      return { ...state, ledgers: { ...state.ledgers, [action.instance]: ledger } };
    }
    case "pinLedgers": {
      const pin = (id: InstanceId): string | null => {
        if (id === action.keep) return null;
        const chosen = state.ledgers[id];
        if (chosen === null) return action.previous;
        return chosen === action.next ? null : chosen;
      };
      return { ...state, ledgers: { w1: pin("w1"), w2: pin("w2") } };
    }
    case "resetForIdentity":
      return { ...state, secondary: null, secondaryOpen: false, mode: "follow", ratio: DEFAULT_RATIO, ledgers: { w1: null, w2: null } };
  }
}

/** 会话内恢复：只接受形状正确的值，其余回到初始状态。 */
export function parseWorkspaceState(value: unknown): WorkspaceState {
  if (value === null || typeof value !== "object") return INITIAL_WORKSPACE;
  const record = value as Record<string, unknown>;
  const isInstance = (candidate: unknown): candidate is InstanceId => candidate === "w1" || candidate === "w2";
  const primary = isInstance(record["primary"]) ? record["primary"] : "w1";
  const secondaryRaw = record["secondary"];
  const secondary = isInstance(secondaryRaw) && secondaryRaw !== primary ? secondaryRaw : null;
  const mode: FollowMode = record["mode"] === "independent" ? "independent" : "follow";
  const rail: RailPreference =
    record["rail"] === "expanded" || record["rail"] === "collapsed" ? record["rail"] : "auto";
  const ratio = typeof record["ratio"] === "number" ? clampRatio(record["ratio"]) : DEFAULT_RATIO;
  const ledgersRaw = record["ledgers"];
  const ledgerOf = (id: InstanceId): string | null => {
    if (ledgersRaw === null || typeof ledgersRaw !== "object") return null;
    const value = (ledgersRaw as Record<string, unknown>)[id];
    return typeof value === "string" && value !== "" ? value : null;
  };
  return {
    primary,
    secondary,
    secondaryOpen: secondary !== null && record["secondaryOpen"] === true,
    mode,
    ratio,
    rail,
    ledgers: { w1: ledgerOf("w1"), w2: ledgerOf("w2") },
  };
}
