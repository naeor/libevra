/**
 * 横向滑动抽屉（Carousel）的左右滑动手势（1.17.12）：**跟手、松手吸附到相邻一页或回到原页。**
 *
 * ⚠️ **不另造手势框架**：速度按整次触摸的平均值算（`transitionPhysics.flickFromDrag`，与账本页两态切换、
 * 编辑抽屉同一规则——手指抬起前最后几毫秒的漂移不会把方向翻过来），「一甩」的门槛也是同一个
 * `FLICK_VELOCITY`。只是「拖过多少算翻页」用 30%：横向滑卡片的习惯是不必拖到一半。
 *
 * ⚠️ **先判方向再认领**：横向位移明显大于纵向才算翻页，否则交给页面纵向滚动（容器设 `touch-action: pan-y`，
 * 纵向滚动由浏览器处理、不经过这里）。卡片里自带横向滚动的图表（全年日历、矩阵）会自己滚，不触发翻页。
 */
import { FLICK_VELOCITY, flickFromDrag } from "../lib/transitionPhysics.js";

/** 手指移动超过这么多像素才判断方向；更短的按下-抬起仍是点击（点卡片进详情）。 */
export const SWIPE_SLOP = 8;

/** 横向位移至少是纵向的这么多倍才算翻页。 */
export const SWIPE_AXIS_RATIO = 1.2;

/** 慢慢拖时，拖过这么多（占容器宽度）就翻页。 */
export const SWIPE_COMMIT = 0.3;

export type SwipeAxis = "x" | "y" | null;

/** 按下后的位移决定这次手势是横向翻页（x）、纵向滚动（y），还是还看不出来（null）。 */
export function swipeAxis(dx: number, dy: number): SwipeAxis {
  if (Math.abs(dx) < SWIPE_SLOP && Math.abs(dy) < SWIPE_SLOP) return null;
  return Math.abs(dx) > Math.abs(dy) * SWIPE_AXIS_RATIO ? "x" : "y";
}

/** 第一页再往右拉、最后一页再往左拉：阻力变成三分之一，提示「到头了」，松手弹回。 */
export function resistedOffset(dx: number, index: number, count: number): number {
  const pastStart = index <= 0 && dx > 0;
  const pastEnd = index >= count - 1 && dx < 0;
  return pastStart || pastEnd ? dx / 3 : dx;
}

/** 松手后停在哪一页（纯函数，供测试）：快速一甩看方向，否则看拖过 30% 没有；越界时留在原页。 */
export function swipeTarget(index: number, count: number, dx: number, elapsedMs: number, width: number): number {
  if (count <= 1 || width <= 0 || dx === 0) return index;
  const next = index + (dx < 0 ? 1 : -1);
  if (next < 0 || next >= count) return index;
  const progress = Math.abs(dx) / width;
  const flick = flickFromDrag(Math.abs(dx), elapsedMs, width);
  return flick > FLICK_VELOCITY || progress > SWIPE_COMMIT ? next : index;
}
