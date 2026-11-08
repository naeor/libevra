import { afterEach, describe, expect, it, vi } from "vitest";
import { describePlane, layoutBackground, MAX_AMBIENT_SHAPES } from "../../../../../experiments/motion-lab/ambient.js";

const rect = (x: number, y: number, width: number, height: number): DOMRect =>
  ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON: () => ({}) });
function fixture(boxes: DOMRect[]): HTMLElement {
  const nodes = boxes.map(box => ({
    getBoundingClientRect: () => box, closest: () => ({}), matches: () => true,
    textContent: "不应保存的旧页文字",
  }));
  vi.stubGlobal("getComputedStyle", () => ({ backgroundColor: "rgb(240, 245, 240)", borderRadius: "20px" }));
  return {
    getBoundingClientRect: () => rect(100, 50, 390, 844),
    querySelector: () => ({ getBoundingClientRect: () => rect(100, 108, 390, 700) }),
    querySelectorAll: () => nodes,
  } as unknown as HTMLElement;
}
afterEach(() => vi.unstubAllGlobals());

describe("Motion Lab 无文字来源环境", () => {
  it("只收集滚动视口可见形状，裁剪遮挡区且不保留文本/DOM", () => {
    const plane = fixture([rect(124, 90, 342, 200), rect(124, 900, 342, 200)]);
    const layout = describePlane(plane);
    expect(layout.shapes).toHaveLength(1);
    expect(layout.shapes[0]).toMatchObject({ x: 24, y: 58, width: 342, height: 182, radius: 20 });
    expect(JSON.stringify(layout)).not.toMatch(/旧页文字|textContent|querySelector/);
    const svg = decodeURIComponent(layoutBackground(layout, 80, 9.1, true)!);
    expect(svg).not.toMatch(/<text|foreignObject/);
    expect(svg).toContain('translate(-58.5 0)');
  });

  it("长期描述与生成图形有固定上限，零透出不生成来源图层", () => {
    const plane = fixture(Array.from({ length: 100 }, () => rect(124, 120, 100, 100)));
    const layout = describePlane(plane);
    expect(layout.shapes).toHaveLength(MAX_AMBIENT_SHAPES);
    expect(layoutBackground(layout, 0, 9.1, false)).toBeNull();
    expect(layoutBackground(undefined, 80, 9.1, false)).toBeNull();
    const oversize = { ...layout, shapes: [...layout.shapes, ...layout.shapes] };
    const svg = decodeURIComponent(layoutBackground(oversize, 100, 9.1, false)!);
    expect(svg.match(/<rect /g)).toHaveLength(MAX_AMBIENT_SHAPES);
  });
});
