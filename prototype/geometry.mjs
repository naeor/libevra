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
export function surroundingPose(style, rect, source, strength, viewport = { height: 0 }) {
  const side = rect.y + rect.height / 2 < source.y + source.height / 2 ? -1 : 1;
  if (style === 'b1') {
    // 同侧内容整体移动，保留彼此间距；最近一项也必须越过舞台边界。
    const travel = side < 0 ? source.y + 12 : viewport.height - source.y - source.height + 12;
    return { transform: `translate3d(0,${side * Math.max(0, travel)}px,0)`, opacity: 1 };
  }
  if (style === 'a') return { transform: `translate3d(0,${side * 4}px,0) scale(.98)`, opacity: .58 };
  if (style === 'c') return { transform: `translate3d(0,${side * strength}px,0)`, opacity: .72 };
  return { transform: 'none', opacity: 1 };
}
export const EXPANSION_MIDDLE = .18;
export const EXPANSION_END = .6;
export const FIRST_EASE = 'cubic-bezier(.25,.6,.4,1)';
export function expansionFrames(first, middle, last) {
  return [{ ...first, offset: 0, easing: FIRST_EASE }, { ...middle, offset: .19, easing: EASE },
    { ...last, offset: EXPANSION_END }, { ...last, offset: 1 }];
}
export function pushFrames(rect, source, viewport) {
  const last = surroundingPose('b1', rect, source, 0, viewport);
  const dy = Number(last.transform.match(/,([^p]+)px/)[1]);
  return expansionFrames({ transform: 'translate3d(0,0px,0)', opacity: 1 },
    { transform: `translate3d(0,${dy * EXPANSION_MIDDLE}px,0)`, opacity: 1 }, last);
}
export function boxFrame(box, radius = 20, scale = 1) {
  return { transform: `translate3d(${box.x}px,${box.y}px,0) scale(${scale})`, width: `${box.width}px`, height: `${box.height}px`, borderRadius: `${radius}px` };
}
