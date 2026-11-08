/** 沿用底栏的“前缘拉伸、轻微越过、回到目标”节奏；文字不参与形变。 */
export const SELECTION_DURATION = 200;
export interface SelectionBox { x: number; y: number; width: number; height: number }
export function selectionFrames(from: SelectionBox, to: SelectionBox): Keyframe[] {
  const distance = to.x + to.width / 2 - from.x - from.width / 2;
  const direction = Math.sign(distance);
  const stretch = Math.min(to.width * .12, Math.abs(distance) * .18);
  const overshoot = Math.min(2.5, Math.abs(distance) * .025);
  const frame = (box: SelectionBox): Keyframe => ({ transform: `translate3d(${box.x}px, ${box.y}px, 0)`, width: `${box.width}px`, height: `${box.height}px` });
  return [
    { ...frame(from), offset: 0, easing: "cubic-bezier(.2,.65,.3,1)" },
    { ...frame({ ...to, x: from.x + (to.x - from.x) * .65 - (direction > 0 ? stretch * .3 : stretch * .7), width: to.width + stretch }), offset: .55, easing: "ease-out" },
    { ...frame({ ...to, x: to.x + direction * overshoot }), offset: .8, easing: "ease-in-out" },
    { ...frame(to), offset: 1 },
  ];
}
