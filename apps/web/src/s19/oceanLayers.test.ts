import { describe, expect, it } from "vitest";
import { oceanPath } from "../lib/oceanGeometry.js";
import { SPRING_DAMPING, SPRING_STIFFNESS, clampOvershoot, hasSettled, springStep } from "../lib/transitionPhysics.js";
import { LayerMotion, edgeCurve, edgeSamples, layerTarget, seaHeight } from "./oceanLayers.js";

/** 用与 useSpaceTransition 相同的主弹簧驱动一次转场，逐帧记录四层进度。 */
function run(from: number, to: 0 | 1, hz: number, reverseAt = -1) {
  const motion = new LayerMotion(from);
  motion.reset(from);
  let p = from, v = 0, target: 0 | 1 = to;
  const dt = 1000 / hz;
  const frames: { p: number; q: number[] }[] = [];
  for (let f = 0; f < hz * 2; f++) {
    if (f === reverseAt) target = target === 1 ? 0 : 1;
    const s = springStep(p, v, target, dt / 1000, SPRING_STIFFNESS, SPRING_DAMPING);
    const c = clampOvershoot(s.progress, target);
    p = c; v = c !== s.progress ? 0 : s.velocity;
    if (hasSettled(p, v, target)) { p = target; v = 0; }
    motion.step(p, dt);
    frames.push({ p, q: motion.layers.map(l => l.q) });
  }
  return { frames, motion };
}
const firstMove = (frames: { q: number[] }[], k: number, from: number) => frames.findIndex(f => Math.abs(f.q[k]! - from) > 0.004);

describe("四层海浪：左右游动函数不变，只多了每层的纵向进度", () => {
  it("像素坐标的浪沿与原版 oceanPath 是同一条曲线", () => {
    const size = { width: 100, height: 125, short: 100 }; // seaHeight 恒为 100，像素 = 原版 viewBox 单位
    for (const layer of [0, 1, 2, 3]) for (const [p, t] of [[0, 0], [.4, 3.2], [1, 11]] as const) {
      expect(seaHeight(p, size)).toBeCloseTo(100, 9);
      // 原版以 "L101,y" 进入浪沿（101 是整数），这里以 "M101.00,y" 开头：去掉这个 x 后逐个比较。
      const mine = edgeCurve(edgeSamples(layer, p, t, size), 100).match(/-?\d+\.\d+/g)!.map(Number).slice(1);
      const original = oceanPath(layer, p, t).match(/-?\d+\.\d+/g)!.map(Number);
      expect(mine.length).toBe(24 * 6 + 1);
      expect(original.length).toBe(mine.length);
      mine.forEach((n, i) => expect(Math.abs(n - original[i]!)).toBeLessThan(0.006));
    }
  });

  it("两端的目标恰好等于主进度，静止时四层回到正常层间距", () => {
    for (const dir of [1, -1] as const) for (const [s, a] of [[0, .84], [.15, .96]]) {
      expect(layerTarget(0, dir, s!, a!)).toBe(0);
      expect(layerTarget(1, dir, s!, a!)).toBe(1);
    }
    for (const [from, to] of [[0, 1], [1, 0]] as const) {
      const { motion } = run(from, to, 60);
      expect(motion.settled).toBe(true);
      motion.layers.forEach(l => expect(l.q).toBe(to));
    }
  });

  it("上行（退去）1→2→3→4 依次启动，下行（覆盖）4→3→2→1；中途只拉开、不交叉，回弹克制", () => {
    for (const hz of [60, 120]) {
      const up = run(0, 1, hz).frames;
      const upStart = [0, 1, 2, 3].map(k => firstMove(up, k, 0));
      expect(upStart).toEqual([...upStart].sort((a, b) => a - b));
      expect(upStart[3]! - upStart[0]!).toBeGreaterThan(hz * .05);
      const down = run(1, 0, hz).frames;
      const downStart = [0, 1, 2, 3].map(k => firstMove(down, k, 1));
      expect(downStart).toEqual([...downStart].sort((a, b) => b - a));
      for (const { q } of [...up, ...down]) {
        for (let k = 0; k < 3; k++) expect(q[k + 1]! - q[k]!).toBeLessThan(.03);
        for (const x of q) { expect(x).toBeGreaterThan(-.012); expect(x).toBeLessThan(1.012); }
      }
      const spread = Math.max(...up.map(f => f.q[0]! - f.q[3]!));
      expect(spread).toBeGreaterThan(.08);
      expect(spread).toBeLessThan(.3);
    }
  });

  it("60 / 120 Hz 走出同一条轨迹；中途反向没有跳变", () => {
    const a = run(0, 1, 60).frames, b = run(0, 1, 120).frames;
    for (let i = 0; i < a.length; i++) a[i]!.q.forEach((q, k) => expect(Math.abs(q - b[2 * i + 1]!.q[k]!)).toBeLessThan(.06));
    const flip = run(0, 1, 60, 18).frames;
    for (let i = 1; i < flip.length; i++) flip[i]!.q.forEach((q, k) => expect(Math.abs(q - flip[i - 1]!.q[k]!)).toBeLessThan(.05));
  });
});

describe("列表内容跟随 4 号层的实际进度", () => {
  it("静止时无位移；4 号落后或领先主进度时按落差让出，主进度到端点时归零", async () => {
    const { contentLag } = await import("./oceanLayers.js");
    const size = { height: 844, short: 126.6 };
    expect(contentLag(0, 0, size)).toBe(0);
    expect(contentLag(1, 1, size)).toBe(0);
    expect(contentLag(.6, .4, size)).toBeGreaterThan(0);   // 上行：4 号最后走
    expect(contentLag(.4, .25, size)).toBeGreaterThan(0);  // 下行：4 号领先（更接近欢迎态）
    expect(contentLag(.9, .95, size)).toBe(0);             // 回弹越过主进度：不往上拉内容
    const { frames } = run(0, 1, 60);
    expect(contentLag(frames.at(-1)!.p, frames.at(-1)!.q[3]!, size)).toBe(0);
  });
});
