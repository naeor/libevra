import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SlidingSelection } from "./SlidingSelection.js";
import { selectionFrames } from "./selectionMotion.js";

describe("横向选中胶囊", () => {
  it("不同宽度双向切换最终精确贴合目标，不拉伸文字", () => {
    for (const [from, to] of [
      [{ x: 4, y: 4, width: 70, height: 44 }, { x: 82, y: 4, width: 98, height: 44 }],
      [{ x: 82, y: 4, width: 98, height: 44 }, { x: 4, y: 4, width: 70, height: 44 }],
    ] as const) {
      const frames = selectionFrames(from, to);
      expect(frames[0]).toMatchObject({ transform: `translate3d(${from.x}px, ${from.y}px, 0)`, width: `${from.width}px` });
      expect(frames.at(-1)).toMatchObject({ transform: `translate3d(${to.x}px, ${to.y}px, 0)`, width: `${to.width}px`, height: "44px" });
      expect(frames.every(frame => !String(frame.transform).includes("scale"))).toBe(true);
    }
  });
  it("连续切换接受途中位置，不强制跳回上一个按钮", () => {
    const current = { x: 40.25, y: 2, width: 92.5, height: 40 };
    expect(selectionFrames(current, { x: 4, y: 2, width: 80, height: 40 })[0]).toMatchObject({ transform: "translate3d(40.25px, 2px, 0)", width: "92.5px" });
  });
  it("无测量时保留原按钮和禁用语义，额外材质不进入辅助技术树", () => {
    const html = renderToStaticMarkup(<SlidingSelection role="tablist" aria-label="切换"><button role="tab" aria-selected disabled>已选</button><button role="tab" aria-selected={false}>另一项</button></SlidingSelection>);
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).toContain('aria-selected="true" disabled=""');
    expect(html).toContain('data-selection-indicator="" aria-hidden="true"');
    expect(html).not.toContain('data-selection-ready');
  });
});
