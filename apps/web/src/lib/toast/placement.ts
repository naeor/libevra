/**
 * **提示条放在哪里**（1.19.66，方案 §3.1）。纯函数：输入各矩形，输出离视口底边（或顶边）的距离；DOM 测量在宿主里。
 *
 * 手机：水平居中；垂直默认在“底部障碍物”最高上缘之上 8px，没有障碍物时在底部安全区之上 16px。障碍物：
 * - 常驻底栏、抬高 32px 的“+”（标 `data-toast-avoid`）；底栏上方的账本胶囊给提示让位、不算障碍物（1.19.72，components/toast/bottomSlot.ts）；
 * - 所有底部操作栏 `[data-lv-bottom-bar]`（保存栏、核对确认条、批量操作栏、留言输入区、分析编辑抽屉、导入完成页按钮栏……）。
 * 软键盘打开时底栏与操作栏原位隐藏（`visibility: hidden`，宿主测量时跳过），提示改在键盘上方 8px。
 * 唯一的顶部例外：页面声明了顶部锚点（`[data-toast-anchor="top"]`，分析工作台编辑态的编辑条），放在它下方 8px。
 *
 * 电脑版同一个算法，只是间距不同：底部操作栏之上 16px，没有则离窗口底 24px。
 * Pad 宽屏这一阶段不测量（外壳底部居中，与原 Pad 外壳提示同一位置，所有者 2026-11-14 决定）。
 */

export interface Box {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

export interface BottomInput {
  /** 布局视口高度（`innerHeight`）。 */
  readonly viewportHeight: number;
  /** 底部安全区（`env(safe-area-inset-bottom)`）。 */
  readonly safeBottom: number;
  /** 提示条水平方向占据的范围：只避开横向重叠的障碍物。 */
  readonly span: { readonly left: number; readonly right: number };
  /** 可见的障碍物矩形（宿主已经跳过隐藏、零尺寸的元素）。 */
  readonly obstacles: readonly Box[];
  /** 软键盘挡住的高度（布局视口底边 − 可视区底边）；没有键盘时 0。 */
  readonly keyboardCover: number;
  /** 与障碍物、键盘的间距。手机 8，电脑版 16。 */
  readonly gap: number;
  /** 没有障碍物时离底边（安全区之上）的距离。手机 16，电脑版 24。 */
  readonly edge: number;
}

/** 只认屏幕下半部分的障碍物：列表中间偶然出现的吸底元素（内容很短时）也算，但顶部的不算。 */
function isBottomObstacle(box: Box, viewportHeight: number): boolean {
  return box.bottom > viewportHeight / 2 && box.top < viewportHeight && box.bottom > box.top;
}

/** 提示条底边离布局视口底边的距离（px）。 */
export function bottomOffset(input: BottomInput): number {
  let offset = input.safeBottom + input.edge;
  if (input.keyboardCover > 0) offset = Math.max(offset, input.keyboardCover + input.gap);
  for (const box of input.obstacles) {
    if (box.right <= input.span.left || box.left >= input.span.right) continue;
    if (!isBottomObstacle(box, input.viewportHeight)) continue;
    offset = Math.max(offset, input.viewportHeight - box.top + input.gap);
  }
  return Math.round(offset);
}

export interface TopInput {
  /** 顶部锚点（编辑条）的下缘。 */
  readonly anchorBottom: number;
  readonly safeTop: number;
  readonly gap: number;
}

/** 提示条顶边离布局视口顶边的距离（px）。 */
export function topOffset(input: TopInput): number {
  return Math.round(Math.max(input.safeTop + input.gap, input.anchorBottom + input.gap));
}

/** 手机提示条的水平范围：居中，`min(视口宽 − 32px, 28rem)`。 */
export function centeredSpan(viewportWidth: number, maxWidth = 448, inset = 16): { readonly left: number; readonly right: number } {
  const width = Math.min(Math.max(0, viewportWidth - inset * 2), maxWidth);
  const left = (viewportWidth - width) / 2;
  return { left, right: left + width };
}
