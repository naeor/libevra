// 测量只在开始、反向或视口改变时发生；动画帧不读取布局。
export const EASE = 'cubic-bezier(.2,.72,.2,1)';
export function relativeRect(rect, parent) {
  return { x: rect.left - parent.left, y: rect.top - parent.top, width: rect.width, height: rect.height };
}
export function expandedRect(width, height) { return { x: 8, y: 8, width: width - 16, height: height - 16 }; }
export function reliableTarget(saved, current, viewport, changed = false) {
  if (changed || !current || !Object.values(current).every(Number.isFinite)) return false;
  // 部分被导航裁切也走淡出，不把目标钳到中央或导航上方。
  return current.width > 0 && current.height > 0 && current.x >= -1 && current.y >= -1
    && current.x + current.width <= viewport.width + 1 && current.y + current.height <= viewport.height + 1
    && ['x', 'y', 'width', 'height'].every(key => Math.abs(saved[key] - current[key]) < 2);
}
export function surroundingPose(style, rect, source, strength) {
  const side = rect.y + rect.height / 2 < source.y + source.height / 2 ? -1 : 1;
  const distance = Math.abs(rect.y - source.y);
  if (style === 'b1') {
    const travel = Math.max(12, strength * (1 - Math.min(distance / 850, .45)));
    return { transform: `translate3d(0,${side * travel}px,0)`, opacity: .5 };
  }
  if (style === 'a') return { transform: `translate3d(0,${side * 4}px,0) scale(.98)`, opacity: .58 };
  if (style === 'c') return { transform: `translate3d(0,${side * strength}px,0)`, opacity: .72 };
  return { transform: 'none', opacity: 1 };
}
export function boxFrame(box, radius = 20, scale = 1) {
  return { transform: `translate3d(${box.x}px,${box.y}px,0) scale(${scale})`, width: `${box.width}px`, height: `${box.height}px`, borderRadius: `${radius}px` };
}
