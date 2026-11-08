import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTROL_MORPH, FEEDBACK_CSS, OBJECT_EXPAND, TAB_SWITCH, easingFunction } from "./motionTokens.js";

/** 60Hz 下每帧的进度。 */
const perFrame = (duration: number, easing: string): number[] => {
  const ease = easingFunction(easing), out: number[] = [];
  for (let t = 0; t <= duration + 16.7; t += 1000 / 60) out.push(ease(Math.min(1, t / duration)));
  return out;
};

describe("Motion Token", () => {
  it("缓动求值与 CSS 定义一致", () => {
    const ease = easingFunction("cubic-bezier(.25,.1,.25,1)");
    expect(ease(0)).toBe(0); expect(ease(1)).toBe(1); expect(ease(0.5)).toBeCloseTo(0.8024, 3);
  });
  it("主 Tab：起步有响应但不过冲，主要位移持续足够多帧", () => {
    const p = perFrame(TAB_SWITCH.duration, TAB_SWITCH.easing);
    // 第一帧有可见位移（≥ 2%），但前两帧合计不超过 20%（1.19.43 曲线前两帧已走完 67%）。
    expect(p[1]).toBeGreaterThan(0.02); expect(p[2]).toBeLessThan(0.2);
    const t10 = p.findIndex(v => v >= 0.1), t90 = p.findIndex(v => v >= 0.9);
    expect((t90 - t10) * 1000 / 60).toBeGreaterThanOrEqual(110);
    expect(TAB_SWITCH.duration).toBeLessThanOrEqual(300);
  });
  it("对象展开与收回的交接比例有序：内容先于容器淡出出现，原页面在容器淡出前退场", () => {
    const { phases } = OBJECT_EXPAND.open;
    expect(phases.content[0]).toBeLessThan(phases.cover[1]);
    expect(phases.background[1]).toBeLessThanOrEqual(phases.surface[0] + 0.02);
    expect(phases.geometry).toBeLessThanOrEqual(phases.background[1]);
    const close = OBJECT_EXPAND.close.phases;
    expect(close.reveal[1]).toBeLessThanOrEqual(close.geometry[0]);
    expect(close.content[1]).toBeLessThanOrEqual(close.geometry[1]);
    expect(OBJECT_EXPAND.open.duration).toBeLessThanOrEqual(400);
  });
  it("高频反馈登记的 CSS 变量在四种风格里都有定义", () => {
    const css = readFileSync(new URL("../components/ui/component-motion.css", import.meta.url), "utf8");
    for (const style of ["a", "b1", "b2", "c"]) {
      const rule = css.match(new RegExp(`:root\\[data-visual-style="${style}"\\] \\{([^}]*)\\}`))?.[1] ?? "";
      for (const name of Object.values(FEEDBACK_CSS)) expect(rule, `${style} ${name}`).toContain(`${name}:`);
    }
    expect(CONTROL_MORPH.duration).toBeGreaterThan(0);
  });
});
