/**
 * **「在指定工作区打开」的拖动**（S18 第二轮）的共享状态。
 *
 * 拖动可以从任何可导航的入口开始（全局侧栏的目的地、明细里的一笔、分析卡片、设置入口……），落点由
 * 工作区外壳按**两个工作区真实的矩形**判断：落在主区就在主区打开，落在辅助区就在辅助区打开；只有
 * 一个工作区时，落在右侧（横屏）/ 下方（竖屏）的预留区域就新建辅助区并在其中打开。
 *
 * 入口只负责识别长按 / 拖动手势并报告指针位置；判断与预览由外壳负责。二者不在同一棵组件树的同一层，
 * 所以用一个很小的外部仓库连接，而不是把每一帧的指针坐标放进 React 状态层层传递。
 */

/** `cancel`：右上角的「取消」区域（第三轮）——在那里松手什么都不打开。 */
export type DropTarget = "primary" | "secondary" | "create" | "cancel";

/** 拖动的内容：要打开的页面、预览上的名字，以及它属于哪本账。 */
export interface DragPayload {
  readonly path: string;
  readonly title: string;
  /** 来源工作区实际查看的账本 id（`null` = 设备当前账本 / 与账本无关）。 */
  readonly ledger: string | null;
  /** 从哪个工作区拖出来（侧栏 = `null`）。 */
  readonly source: "w1" | "w2" | null;
}

export interface NavDragSnapshot {
  readonly active: boolean;
  readonly payload: DragPayload | null;
  readonly x: number;
  readonly y: number;
  /** 指针当前所在的落点；`null` = 不在任何落点上（松手即取消）。 */
  readonly target: DropTarget | null;
}

const IDLE: NavDragSnapshot = { active: false, payload: null, x: 0, y: 0, target: null };

export interface DropZone {
  /** 指针位置对应的落点。 */
  resolve(x: number, y: number): DropTarget | null;
  /** 在落点上松手：打开（取消区域不会走到这里）。 */
  drop(target: Exclude<DropTarget, "cancel">, payload: DragPayload): void;
}

export class NavDragController {
  private state: NavDragSnapshot = IDLE;
  private readonly listeners = new Set<() => void>();
  private zone: DropZone | null = null;

  get = (): NavDragSnapshot => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** 工作区外壳登记落点判断；外壳不可用（手机界面、未登录）时没有登记，入口不进入拖动。 */
  register(zone: DropZone): () => void {
    this.zone = zone;
    return () => {
      if (this.zone === zone) {
        this.zone = null;
        if (this.state.active) this.set(IDLE);
      }
    };
  }

  get enabled(): boolean {
    return this.zone !== null;
  }

  start(payload: DragPayload, x: number, y: number): void {
    if (this.zone === null) return;
    this.set({ active: true, payload, x, y, target: this.zone.resolve(x, y) });
  }

  move(x: number, y: number): void {
    if (!this.state.active) return;
    const target = this.zone?.resolve(x, y) ?? null;
    if (x === this.state.x && y === this.state.y && target === this.state.target) return;
    this.set({ ...this.state, x, y, target });
  }

  /** 结束拖动；在落点上松手时打开目标并返回 `true`。取消（`drop = false`）一律什么都不改。 */
  end(drop: boolean): boolean {
    const { active, payload, target } = this.state;
    this.set(IDLE);
    if (!active || !drop || target === null || target === "cancel" || payload === null || this.zone === null) return false;
    this.zone.drop(target, payload);
    return true;
  }

  /** 菜单「在主 / 辅助工作区打开」：与拖到那里松手是同一条路径。 */
  open(target: Exclude<DropTarget, "cancel">, payload: DragPayload): boolean {
    if (this.zone === null) return false;
    this.zone.drop(target, payload);
    return true;
  }

  private set(next: NavDragSnapshot): void {
    this.state = next;
    for (const listener of [...this.listeners]) listener();
  }
}

export const navDrag = new NavDragController();
