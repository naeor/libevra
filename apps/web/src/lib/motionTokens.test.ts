import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTROL_MORPH, FEEDBACK_CSS, OBJECT_EXPAND, SELECTION_CSS, TAB_SWITCH, TRANSITION_INTERRUPT, cssDurationMs, easingFunction, interruptsTransition, padMotionMs } from "./motionTokens.js";

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
  it("转场打断规则：宽度变化，或高度变化超过 150px 才打断", () => {
    const phone = { width: 390, height: 664 };
    expect(TRANSITION_INTERRUPT.heightPx).toBe(150);
    expect(interruptsTransition(phone, phone)).toBe(false);
    // iPhone Safari 工具栏伸缩、前进按钮出现 / 消失：几十像素，不打断（1.19.42 的“闪到终点”）。
    expect(interruptsTransition(phone, { width: 390, height: 664 + 83 })).toBe(false);
    expect(interruptsTransition(phone, { width: 390, height: 664 - 150 })).toBe(false);
    // 软键盘、窗口大幅改变：打断。
    expect(interruptsTransition(phone, { width: 390, height: 664 - 151 })).toBe(true);
    expect(interruptsTransition(phone, { width: 390, height: 664 + 300 })).toBe(true);
    // 宽度任何变化（转屏、分屏、缩放）都打断。
    expect(interruptsTransition(phone, { width: 391, height: 664 })).toBe(true);
    expect(interruptsTransition(phone, { width: 844, height: 390 })).toBe(true);
  });
  it("协调器与各呈现器从同一处读取打断规则，不各自写阈值或监听视口", () => {
    const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
    const pilot = read("../s19/motion/pilot.tsx");
    expect(pilot).toContain("interruptsTransition(");
    expect(pilot).not.toMatch(/>\s*150\b/);
    expect(read("../s19/motion/abcPresentation.ts")).toContain("interrupts: interruptsTransition");
    expect(read("../s19/motion/objectExpand.ts")).toContain("interruptsTransition(source");
    const controller = read("../../../../experiments/abc-motion/controller.js");
    expect(controller).not.toContain("visualViewport");
    expect(controller).toContain("this.interrupts(");
  });
  it("高频反馈登记的 CSS 变量在四种风格里都有定义", () => {
    const css = readFileSync(new URL("../components/ui/component-motion.css", import.meta.url), "utf8");
    for (const style of ["a", "b1", "b2", "c"]) {
      const rule = css.match(new RegExp(`:root\\[data-visual-style="${style}"\\] \\{([^}]*)\\}`))?.[1] ?? "";
      for (const name of Object.values(FEEDBACK_CSS)) expect(rule, `${style} ${name}`).toContain(`${name}:`);
    }
    expect(CONTROL_MORPH.duration).toBeGreaterThan(0);
  });
  it("选中指示与条件标签登记的 CSS 变量有定义：A 有浮起的升起 / 落下 / 环境影，四种风格都有标签起始缩放", () => {
    const css = readFileSync(new URL("../components/ui/component-motion.css", import.meta.url), "utf8");
    const rule = (style: string): string => css.match(new RegExp(`:root\\[data-visual-style="${style}"\\] \\{([^}]*)\\}`))?.[1] ?? "";
    for (const name of Object.values(SELECTION_CSS)) expect(rule("a"), `a ${name}`).toContain(`${name}:`);
    for (const style of ["b1", "b2", "c"]) for (const name of [SELECTION_CSS.select, SELECTION_CSS.reveal, SELECTION_CSS.dismiss, SELECTION_CSS.tagFrom]) expect(rule(style), `${style} ${name}`).toContain(`${name}:`);
  });
});

describe("Pad 动效时长（1.19.107）", () => {
  it("短动画 × 1.5、最低 250ms，长动画与 0 不变", () => {
    expect(padMotionMs(100)).toBe(250);
    expect(padMotionMs(160)).toBe(250);
    expect(padMotionMs(200)).toBe(300);
    expect(padMotionMs(280)).toBe(420);
    expect(padMotionMs(320)).toBe(480);
    expect(padMotionMs(400)).toBe(600);
    expect(padMotionMs(900)).toBe(900);
    expect(padMotionMs(0)).toBe(0);
  });

  it("pad-motion.css 里按风格覆盖的组件变量 = padMotionMs(component-motion.css 的原值)，按下反馈不放大", () => {
    const base = readFileSync(new URL("../components/ui/component-motion.css", import.meta.url), "utf8");
    const pad = readFileSync(new URL("../s19/pad-motion.css", import.meta.url), "utf8");
    const value = (block: string, name: string): number | null => {
      const hit = block.match(new RegExp(`${name}:\\s*(\\d+)ms`));
      return hit ? Number(hit[1]) : null;
    };
    for (const style of ["a", "b1", "b2", "c"]) {
      const from = base.match(new RegExp(`:root\\[data-visual-style="${style}"\\] \\{([^}]*)\\}`))?.[1] ?? "";
      const to = pad.match(new RegExp(`:root\\[data-visual-style="${style}"\\] \\.lv-shell\\[data-s19-scope="pad"\\] \\{([^}]*)\\}`))?.[1] ?? "";
      expect(to, style).not.toBe("");
      expect(to, `${style} press`).not.toContain("--lv-press-ms");
      for (const name of ["--lv-select-ms", "--lv-reveal-ms", "--lv-dismiss-ms", "--lv-feedback-ms", "--lv-lift-rise-ms", "--lv-lift-fall-ms", "--lv-lift-shadow-in-ms", "--lv-lift-shadow-out-ms"]) {
        const original = value(from, name);
        if (original === null) continue;
        expect(value(to, name), `${style} ${name}`).toBe(padMotionMs(original));
      }
    }
  });

  it("cssDurationMs 读得懂压缩后的写法", () => {
    expect(cssDurationMs("200ms")).toBe(200);
    expect(cssDurationMs(" .22s")).toBeCloseTo(220);
    expect(cssDurationMs("1.1s")).toBeCloseTo(1100);
    expect(cssDurationMs("")).toBeNaN();
  });
});
