import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NAV_YIELD } from "../../lib/motionTokens.js";
import { remainingShare, translateYOf } from "./navMotion.js";

const css = (file: string): string => readFileSync(join(import.meta.dirname, file), "utf8");

describe("常驻底栏的退出 / 升回（1.19.75，审查 T1）", () => {
  it("读出计算样式里的纵向位移：没有变换为 0，2D 与 3D 矩阵都认", () => {
    expect(translateYOf("none")).toBe(0);
    expect(translateYOf("matrix(1, 0, 0, 1, 0, 42.5)")).toBe(42.5);
    expect(translateYOf("matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 71.5, 0, 1)")).toBe(71.5);
    expect(translateYOf("translateY(10px)")).toBe(0);
  });

  it("中途反向只走剩下的距离：退出走完一半再升回，只用一半的路程", () => {
    expect(remainingShare("exit", null, 77)).toBe(1);
    expect(remainingShare("rise", null, 77)).toBe(1);
    // 升回到一半（还差 38.5px）又要离开：退出还剩一半。
    expect(remainingShare("exit", 38.5, 77)).toBeCloseTo(0.5);
    // 退出走了 1/4 又要回来：升回只走这 1/4。
    expect(remainingShare("rise", 19.25, 77)).toBeCloseTo(0.25);
    expect(remainingShare("rise", 200, 77)).toBe(1);
    expect(remainingShare("exit", -4, 77)).toBe(1);
    expect(remainingShare("exit", 10, 0)).toBe(1);
  });

  it("B2 的 View Transition 用同一套时长与曲线（pilot.css 与 NAV_YIELD 一致），组不裁切、没有环境底色", () => {
    const pilot = css("pilot.css");
    expect(pilot).toContain(`animation: lv-nav-leave ${NAV_YIELD.exit.duration}ms ${NAV_YIELD.exit.easing} both`);
    expect(pilot).toContain(`animation: lv-nav-return ${NAV_YIELD.enter.duration}ms ${NAV_YIELD.enter.easing} both`);
    expect(pilot).toContain(`translateY(${NAV_YIELD.offset})`);
    expect(pilot).toMatch(/::view-transition-group\(lv-persistent-nav\) \{ background: none; overflow: visible; animation: none; \}/);
    expect(pilot).toContain('.lv-shell[data-s19-scope="phone"] [data-persistent-nav] {\n  view-transition-name: lv-persistent-nav;');
  });

  it("A / B1 / C 的转场舞台存在时底栏压在舞台之上（舞台 80、底栏 81、提示条 85）", () => {
    expect(css("abc.css")).toMatch(/\.lv-shell\.s19-abc-stage\[data-s19-scope\] \{[^}]*z-index: 80;/);
    expect(css("navigation.css")).toContain("body:has(> .s19-abc-stage) .persistent-nav { z-index: 81; }");
  });
});
