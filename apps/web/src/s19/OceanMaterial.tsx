import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useI18n } from "../i18n/index.js";
import { materialTuningStyle } from "./material.js";
import { oceanBrandPresentation } from "./oceanBrand.js";
import { CONTENT_LAG_GAIN, LAYERS, LayerMotion, edgeSamples } from "./oceanLayers.js";
import { OceanPainter, type PainterColors } from "./oceanPainter.js";
import "./ocean-material.css";

/**
 * S19 开始页面的四层海浪（A / B1 / B2 / C，仅浅色）。Original 与深色仍走 OceanBackdrop 的原版绘制。
 *
 * - **左右游动**：仍是 `oceanEdge` 原函数（一字不改）。
 * - **纵向节奏**：每层有自己的进度（LayerMotion）——领头层先走、中途拉开、依次落定、轻微回弹，静止后回到正常层间距。
 *   主进度 `--p` 仍只由 useSpaceTransition 写，列表、头像、提示的行为不变。
 * - **绘制**：一张固定尺寸的 Canvas（不随进度改尺寸），见 oceanPainter.ts；不使用任何滤镜、遮罩或裁切。
 * - **品牌**：A 独立悬浮（自己的节奏）；B1 印在 1 号瓷片上；B2 在玻璃下方，由玻璃逐层显现。
 * - **光照**（B1 / B2）：只有依附在浪沿上的反射，随缓慢左右移动的光照窗口变化；静止片刻后略微增强（dwell）。
 */
export type OceanLook = "a" | "b1" | "b2" | "c";

const COLOR_NAMES = {
  fill: ["--oc-fill-1", "--oc-fill-2", "--oc-fill-3", "--oc-fill-4"],
  deep: ["--oc-deep-1", "--oc-deep-2", "--oc-deep-3", "--oc-deep-4"],
  refract: ["--oc-refract-1", "--oc-refract-2", "--oc-refract-3", "--oc-refract-4"],
} as const;

/** CSS 变量（可能含 color-mix / 相对色）→ 浏览器算好的颜色字符串，Canvas 可直接用。只在挂载与主题变化时读。 */
function resolveColors(probe: HTMLElement): PainterColors {
  const read = (name: string): string => {
    probe.style.color = `var(${name})`;
    return getComputedStyle(probe).color;
  };
  return {
    fill: COLOR_NAMES.fill.map(read),
    deep: COLOR_NAMES.deep.map(read),
    refract: COLOR_NAMES.refract.map(read),
    shadow: read("--oc-shadow"),
    light: read("--oc-light"),
    caustic: read("--oc-caustic"),
    base: read("--oc-base"),
  };
}

export function OceanMaterial({ look, interactive, children }: {
  readonly look: OceanLook;
  readonly interactive: boolean;
  readonly children?: ReactNode;
}): React.JSX.Element {
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const probe = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const node = host.current;
    const root = node?.closest<HTMLElement>(".ledger-space");
    if (!node || !root || !canvas.current || !probe.current) return;
    const brand = node.querySelector<HTMLElement>('[data-ocean-brand="large"]');
    const gauge = node.querySelector<HTMLElement>(".ocean-short-gauge");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const readP = () => Number(root.style.getPropertyValue("--p")) || 0;

    // 尺寸只在挂载时量一次，之后由 ResizeObserver 更新；逐帧不读布局。
    const rect = root.getBoundingClientRect();
    const size = { width: rect.width || innerWidth, height: rect.height || innerHeight, short: gauge?.getBoundingClientRect().height || 116 };
    const brandSize = { width: brand?.offsetWidth ?? 170, height: brand?.offsetHeight ?? 75 };
    const painter = new OceanPainter(canvas.current, look);
    painter.resize(size.width, size.height, devicePixelRatio || 1);
    painter.setColors(resolveColors(probe.current));
    const motion = new LayerMotion(readP(), () => size.short / Math.max(size.height * .8, 1));

    let seconds = 0;
    /**
     * B1 / B2 的停留增强：浪沿反射平时（移动中、刚到达时）略弱；海浪完全展开（主进度为 0）、四层都已静止
     * 约 0.9 秒后，用约 0.7 秒平滑地略微增强（约 1–1.6 秒内完成）；一旦开始拖动或上滑，约 0.25 秒内回到较弱，
     * 并且在走过 2% 行程之前一定已经回落。只是同一组反射的亮度略变（REST_BASE → 1），不会出现或消失。A / C 不使用。
     */
    let dwell = 0, rest = 0;
    const DWELL_DELAY_MS = 900, DWELL_RISE_MS = 700, DWELL_FALL_MS = 250;
    const resting = (p: number) => (look === "b1" || look === "b2") && p <= 5e-4 && motion.settled;
    const updateDwell = (p: number, dt: number) => {
      if (resting(p)) {
        rest += dt;
        if (rest >= DWELL_DELAY_MS) dwell = Math.min(1, dwell + dt / DWELL_RISE_MS);
      } else {
        rest = 0;
        dwell = Math.max(0, dwell - dt / DWELL_FALL_MS);
      }
      dwell = Math.min(dwell, Math.max(0, 1 - p / 0.02));
    };
    const enhancement = () => dwell * dwell * (3 - 2 * dwell);
    let previous = performance.now();
    let frame = 0;
    const written = new Map<string, string>();
    const setVar = (name: string, value: string, on: HTMLElement = node) => {
      const key = on === node ? name : `root:${name}`;
      if (written.get(key) === value) return;
      on.style.setProperty(name, value);
      written.set(key, value);
    };
    // 列表内容的分层落差（见 contentLag）：CSS 用 --p 与 --q4 计算，只在两者不等时启用位移，静止时不留任何 transform。
    const lagScale = () => setVar("--space-lag-k", `${(CONTENT_LAG_GAIN * Math.max(0, size.height * .8 - size.short)).toFixed(2)}px`, root);
    lagScale();

    const draw = (): void => {
      const p = readP();
      const q = motion.layers.map(f => f.q);
      const E = LAYERS.map(k => edgeSamples(k, q[k]!, seconds, size));
      painter.paint(E, q, seconds, enhancement());

      const lagging = Math.abs(p - q[3]!) > 5e-4;
      setVar("--q4", (lagging ? q[3]! : p).toFixed(4), root);
      if (lagging !== root.hasAttribute("data-layer-lag")) root.toggleAttribute("data-layer-lag", lagging);
      const b = oceanBrandPresentation(p, seconds,
        { height: size.height, width: size.width, shortHeight: size.short, brandHeight: brandSize.height, brandWidth: brandSize.width },
        { first: q[0]!, last: q[3]! });
      if (look === "a") setVar("--p-logo", Math.min(1.03, Math.max(-0.03, motion.logo.q)).toFixed(4));
      if (look === "b1") {
        setVar("--ocean-print-y", `${b.printY.toFixed(2)}px`);
        setVar("--ocean-compact", b.porcelainCompact.toFixed(3));
      }
      if (look === "b2") {
        setVar("--ocean-engraving-y", `${b.glassY.toFixed(2)}px`);
        setVar("--ocean-reveal", b.glassReveal.toFixed(3));
        setVar("--ocean-compact", b.glassCompact.toFixed(3));
      }
    };

    const tick = (now: number): void => {
      const dt = Math.min(now - previous, 50);
      previous = now;
      seconds += dt / 1000;
      motion.step(readP(), dt);
      updateDwell(readP(), dt);
      draw();
      frame = requestAnimationFrame(tick);
    };
    const resume = (): void => {
      cancelAnimationFrame(frame);
      motion.reset(readP());
      if (reduced.matches) dwell = resting(readP()) ? 1 : 0;
      draw();
      previous = performance.now();
      if (!document.hidden && !reduced.matches) frame = requestAnimationFrame(tick);
    };
    // 减少动态效果：没有环境游动，也没有分层延迟，四层严格跟随拖动。
    const observer = new MutationObserver(() => { if (reduced.matches) { motion.reset(readP()); dwell = resting(readP()) ? 1 : 0; draw(); } });
    observer.observe(root, { attributes: true, attributeFilter: ["style"] });
    // 换主题色 / 外观档位时重新解析颜色（不逐帧读样式）。
    const theme = new MutationObserver(() => { if (probe.current) { painter.setColors(resolveColors(probe.current)); draw(); } });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme-palette", "data-theme-mode", "style", "class"] });
    const resize = new ResizeObserver(entries => {
      for (const entry of entries) {
        if (entry.target === root) {
          size.width = entry.contentRect.width; size.height = entry.contentRect.height;
          painter.resize(size.width, size.height, devicePixelRatio || 1);
          lagScale();
        } else if (entry.target === brand) { brandSize.width = entry.contentRect.width; brandSize.height = entry.contentRect.height; }
        else if (entry.target === gauge) { size.short = entry.contentRect.height; lagScale(); }
      }
      draw();
    });
    resize.observe(root);
    if (brand) resize.observe(brand);
    if (gauge) resize.observe(gauge);
    document.addEventListener("visibilitychange", resume);
    reduced.addEventListener("change", resume);
    resume();
    return () => {
      cancelAnimationFrame(frame);
      root.removeAttribute("data-layer-lag");
      root.style.removeProperty("--q4");
      root.style.removeProperty("--space-lag-k");
      observer.disconnect();
      theme.disconnect();
      resize.disconnect();
      document.removeEventListener("visibilitychange", resume);
      reduced.removeEventListener("change", resume);
    };
  }, [look]);

  return (
    <div
      ref={host}
      className={`space-ocean${interactive ? " space-ocean-live" : ""}`}
      data-ocean-look={look}
      style={materialTuningStyle()}
      {...(interactive ? {} : { "aria-hidden": true })}
    >
      <canvas ref={canvas} className="ocean-canvas" aria-hidden="true" />
      <div className="space-brand-plane">
        <div className="space-brand" data-ocean-brand="large">
          <p className="space-brand-name">Libevra</p>
          <p className="space-brand-tagline">{t("books.space.slogan")}</p>
        </div>
      </div>
      {(look === "b1" || look === "b2") && (
        <div className="space-brand space-brand-compact" data-ocean-brand="compact" aria-hidden="true">
          <p className="space-brand-name">Libevra</p>
          <p className="space-brand-tagline">{t("books.space.slogan")}</p>
        </div>
      )}
      <span ref={probe} className="ocean-probe" aria-hidden="true" />
      <span className="ocean-short-gauge" aria-hidden="true" />
      {children}
    </div>
  );
}
