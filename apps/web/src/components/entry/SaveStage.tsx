/**
 * **保存成功转场**（1.19.77，所有者 2026-11-14 的规格；见待办文档 §7.4）。
 *
 * 以保存按钮为视觉起点、以成功屏中央的对勾为终点的一段连续动画。**动画进度与真实保存请求分开管理**：
 * 页面在点下保存、通过校验的那一刻挂上这一层并照常发出请求，这里只按页面告诉它的 `status` 决定落地之后做什么——
 *
 * | 落地时（按钮已变成中央圆形） | 做什么 |
 * |---|---|
 * | 已经成功 | 直接画对勾，不出现转圈（最快路径，目标从点击到对勾画完 500ms 以内） |
 * | 还在保存 | 圆形中央才出现轻量转圈，下方继续“保存中…”；成功后转圈淡出，再画对勾；没有人为的最长等待 |
 * | 失败，或需要先确认是否重复 | 不画对勾、不放烟花：圆形沿原路回到按钮的位置和形状，表单淡回，页面再显示错误或询问 |
 *
 * 途中失败也一样：从当前位置收回，不强行走完居中。对勾画完后（`onSettled`）成功屏立即可操作；
 * 之后的微型烟花（`SaveSparks`）是纯装饰层，不阻塞任何操作，离开页面时随之取消。
 *
 * 结构：这一层盖在仍然挂载的表单上面，里面放成功屏（“到场”状态，`EntrySaved intro`）与一个飞行的圆形。成功屏先以
 * `pending` 挂好，标记位不可见、只用来测量落点；圆形落在标记位上，对勾画完时成功屏换成自己的对勾（同一位置、同一材质），
 * 飞行的圆形同时撤掉——前后是同一个标记，不会先出现一个对勾、消失、再出现另一个。
 *
 * 只在 S19 浅色手机外壳里使用（页面判断，见 `saveStageEnabled`）；Original、深色、Pad、电脑版与减少动态效果仍是原来的直接切换。
 * 动画只用 WAAPI（位置与尺寸、透明度），所有动画在卸载时取消，表单的透明度动画也一并撤销。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { S19_PHONE_SELECTOR } from "../../s19/scope.js";
import "../ui/component-motion.css";
import "./save-stage.css";

export type SaveStageStatus = "pending" | "success" | "revert";
export type SaveIntro = "pending" | "success" | "done";
type Phase = "travel" | "wait" | "check" | "done" | "revert";

/** 飞行：变形 + 移动 260ms（最后略过冲再落定）；对勾：短笔画 70ms + 长笔画 120ms。最快路径（保存在飞行途中就已完成）从点击到对勾画完约 480ms。 */
export const SAVE_STAGE_TIMING = { travel: 260, short: 70, long: 120, spinOut: 140, revert: 260, fade: 220 } as const;

/** 这一层只在 S19 浅色手机外壳、没有“减少动态效果”时启用。 */
export function saveStageEnabled(element: Element | null): boolean {
  if (element === null || typeof element.animate !== "function") return false;
  const root = document.documentElement;
  if (root.dataset.visualStyle === undefined || root.dataset.themeMode !== "light") return false;
  if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  return element.closest(S19_PHONE_SELECTOR) !== null;
}

export interface SaveOrigin {
  readonly rect: DOMRect;
  readonly radius: number;
}

/** 量出保存按钮的位置与圆角（点击那一刻）。 */
export function measureOrigin(button: HTMLElement): SaveOrigin {
  return { rect: button.getBoundingClientRect(), radius: Number.parseFloat(getComputedStyle(button).borderTopLeftRadius) || 14 };
}

export function SaveStage({
  origin,
  status,
  formRef,
  label,
  onReverted,
  onSettled,
  render,
}: {
  readonly origin: SaveOrigin;
  readonly status: SaveStageStatus;
  /** 仍在下面的表单（淡出，失败时淡回）。 */
  readonly formRef: RefObject<HTMLElement | null>;
  /** 飞行起点按钮上的文字（“保存中…”）。 */
  readonly label: string;
  /** 收回走完：页面撤掉这一层，表单与保存按钮恢复原样。 */
  readonly onReverted: () => void;
  /** 对勾画完：成功屏可以独立存在了（页面可以卸载下面的表单）。 */
  readonly onSettled: () => void;
  /** 渲染成功屏（到场状态、标记位）。 */
  readonly render: (intro: SaveIntro, markRef: RefObject<HTMLSpanElement | null>) => ReactNode;
}): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>("travel");
  const phaseRef = useRef<Phase>("travel");
  const statusRef = useRef(status);
  statusRef.current = status;
  const markRef = useRef<HTMLSpanElement | null>(null);
  const morphRef = useRef<HTMLDivElement | null>(null);
  const labelRef = useRef<HTMLSpanElement | null>(null);
  const spinRef = useRef<HTMLSpanElement | null>(null);
  const shortRef = useRef<SVGPathElement | null>(null);
  const longRef = useRef<SVGPathElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const running = useRef(new Set<Animation>());
  const formFade = useRef<Animation | null>(null);
  const [sparkAt, setSparkAt] = useState<{ x: number; y: number; size: number } | null>(null);
  const callbacks = useRef({ onReverted, onSettled });
  callbacks.current = { onReverted, onSettled };

  const go = useCallback((next: Phase) => { phaseRef.current = next; setPhase(next); }, []);
  const track = useCallback((animation: Animation): Animation => {
    running.current.add(animation);
    const forget = (): void => { running.current.delete(animation); };
    animation.addEventListener("finish", forget); animation.addEventListener("cancel", forget);
    return animation;
  }, []);

  const target = (): { x: number; y: number; size: number } | null => {
    const mark = markRef.current?.getBoundingClientRect();
    return mark && mark.width > 0 ? { x: mark.left, y: mark.top, size: mark.width } : null;
  };

  // ---- 对勾：短笔画，再长笔画；圆形轻轻一顿（不大幅弹跳）。画完即“完成”，烟花另起一层 ----
  const startCheck = useCallback((): void => {
    go("check");
    const morph = morphRef.current, short = shortRef.current, long = longRef.current;
    if (!morph || !short || !long) { go("done"); callbacks.current.onSettled(); return; }
    track(morph.animate([{ transform: "scale(1)" }, { transform: "scale(1.045)", offset: 0.45 }, { transform: "scale(1)" }], { duration: SAVE_STAGE_TIMING.short + SAVE_STAGE_TIMING.long, easing: "ease-out" }));
    track(short.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: SAVE_STAGE_TIMING.short, easing: "cubic-bezier(.5,0,1,1)", fill: "forwards" }));
    const second = track(long.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: SAVE_STAGE_TIMING.long, delay: SAVE_STAGE_TIMING.short, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" }));
    second.onfinish = () => {
      if (phaseRef.current !== "check") return;
      const at = target();
      go("done");
      if (at) setSparkAt(at);
      callbacks.current.onSettled();
    };
  }, [go, track]);

  // ---- 收回：从圆形当前所在（可能还在路上）回到按钮的位置与形状；表单淡回 ----
  const startRevert = useCallback((): void => {
    if (phaseRef.current === "revert" || phaseRef.current === "done") return;
    const morph = morphRef.current;
    const now = morph?.getBoundingClientRect();
    const radiusNow = morph ? getComputedStyle(morph).borderTopLeftRadius : `${String(origin.radius)}px`;
    for (const animation of [...running.current]) animation.cancel();
    go("revert");
    const form = formRef.current;
    if (form) {
      const from = getComputedStyle(form).opacity;
      formFade.current?.cancel();
      formFade.current = form.animate([{ opacity: from }, { opacity: 1 }], { duration: SAVE_STAGE_TIMING.revert, easing: "ease-out" });
    }
    if (!morph || !now) { callbacks.current.onReverted(); return; }
    const o = origin.rect;
    const back = track(morph.animate([
      { left: `${String(now.left)}px`, top: `${String(now.top)}px`, width: `${String(now.width)}px`, height: `${String(now.height)}px`, borderRadius: radiusNow },
      { left: `${String(o.left)}px`, top: `${String(o.top)}px`, width: `${String(o.width)}px`, height: `${String(o.height)}px`, borderRadius: `${String(origin.radius)}px` },
    ], { duration: SAVE_STAGE_TIMING.revert, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" }));
    if (labelRef.current) track(labelRef.current.animate([{ opacity: 0 }, { opacity: 1 }], { duration: SAVE_STAGE_TIMING.revert, easing: "ease-in", fill: "forwards" }));
    if (layerRef.current) track(layerRef.current.animate([{ opacity: 1 }, { opacity: 0 }], { duration: SAVE_STAGE_TIMING.revert * 0.7, easing: "ease-out", fill: "forwards" }));
    back.onfinish = () => { callbacks.current.onReverted(); };
  }, [formRef, go, origin, track]);

  const arrive = useCallback((): void => {
    if (statusRef.current === "success") startCheck();
    else if (statusRef.current === "revert") startRevert();
    else go("wait");
  }, [go, startCheck, startRevert]);

  // ---- 飞行：挂载那一刻开始（与真实请求同时）。宽度收缩、圆角变圆、移动到标记位，最后略过冲再落定 ----
  useLayoutEffect(() => {
    const morph = morphRef.current;
    const at = target();
    const o = origin.rect;
    if (!morph || !at) { arrive(); return; }
    const d = at.size, over = d * 1.06, shift = (over - d) / 2;
    const travel = track(morph.animate([
      { left: `${String(o.left)}px`, top: `${String(o.top)}px`, width: `${String(o.width)}px`, height: `${String(o.height)}px`, borderRadius: `${String(origin.radius)}px`, easing: "cubic-bezier(.32,.72,.16,1)" },
      { offset: 0.8, left: `${String(at.x - shift)}px`, top: `${String(at.y - shift)}px`, width: `${String(over)}px`, height: `${String(over)}px`, borderRadius: `${String(over / 2)}px`, easing: "ease-in-out" },
      { left: `${String(at.x)}px`, top: `${String(at.y)}px`, width: `${String(d)}px`, height: `${String(d)}px`, borderRadius: `${String(d / 2)}px` },
    ], { duration: SAVE_STAGE_TIMING.travel, easing: "linear", fill: "forwards" }));
    if (labelRef.current) track(labelRef.current.animate([{ opacity: 1 }, { opacity: 0 }], { duration: SAVE_STAGE_TIMING.travel * 0.35, easing: "ease-out", fill: "forwards" }));
    const form = formRef.current;
    if (form) formFade.current = form.animate([{ opacity: 1 }, { opacity: 0 }], { duration: SAVE_STAGE_TIMING.fade, easing: "ease-out", fill: "forwards" });
    travel.onfinish = () => { if (phaseRef.current === "travel") arrive(); };
    // 挂载时只跑一次：起点是点击那一刻的按钮。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 请求结果到达 ----
  useEffect(() => {
    const current = phaseRef.current;
    if (status === "revert") { if (current === "travel" || current === "wait") startRevert(); return; }
    if (status !== "success" || current !== "wait") return;
    const spin = spinRef.current;
    if (!spin) { startCheck(); return; }
    // 转圈先淡出，再画对勾。
    const out = track(spin.animate([{ opacity: getComputedStyle(spin).opacity, transform: "scale(1)" }, { opacity: 0, transform: "scale(.6)" }], { duration: SAVE_STAGE_TIMING.spinOut, easing: "ease-in", fill: "forwards" }));
    out.onfinish = () => { if (phaseRef.current === "wait") startCheck(); };
  }, [status, startCheck, startRevert, track]);

  // ---- 卸载：取消一切动画，表单透明度复原（失败收回途中离开、成功后离开都一样） ----
  useEffect(() => () => {
    for (const animation of [...running.current]) animation.cancel();
    formFade.current?.cancel();
  }, []);

  const intro: SaveIntro = phase === "done" ? "done" : phase === "check" ? "success" : "pending";
  const o = origin.rect;
  return (
    <div ref={layerRef} className="lv-save-stage" data-phase={phase}>
      {render(intro, markRef)}
      {phase === "done" ? null : (
        <div
          ref={morphRef}
          className="lv-save-morph"
          data-phase={phase}
          aria-hidden="true"
          style={{ left: o.left, top: o.top, width: o.width, height: o.height, borderRadius: origin.radius }}
        >
          <span ref={labelRef} className="lv-save-morph-label">{label}</span>
          <span ref={spinRef} className="lv-save-morph-spin lv-loading" />
          <svg className="lv-save-morph-tick" viewBox="0 0 104 104">
            <path ref={shortRef} d="M34 54 L46 66" pathLength={1} />
            <path ref={longRef} d="M46 66 L70 40" pathLength={1} />
          </svg>
        </div>
      )}
      {sparkAt ? <SaveSparks at={sparkAt} onDone={() => { setSparkAt(null); }} /> : null}
    </div>
  );
}

/**
 * **对勾画完后的微型烟花**：十来粒细小的光点与短线从圆形边缘向外轻轻散开、上浮后消散，约 0.9 秒，只放一次。
 * 以主题绿为主（品牌色、深一档、浅一档）加少量白色高光；只散在圆形四周（偏上方），不压正文。
 * 纯装饰：不拦点击（pointer-events: none），不参与任何流程判断；卸载时取消。
 */
const SPARK_COLORS = ["var(--color-brand)", "var(--color-brand-dark)", "var(--color-brand-soft)", "var(--color-brand)", "var(--color-on-brand)"];

export function SaveSparks({ at, onDone }: { readonly at: { x: number; y: number; size: number }; readonly onDone: () => void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    const animations: Animation[] = [];
    const radius = at.size / 2;
    const count = 14;
    for (let i = 0; i < count; i += 1) {
      // 角度集中在上半圈与两侧（-200° 到 20°），下方是标题与金额，不往那里撒。
      const angle = ((-200 + (220 * (i + 0.5)) / count + (Math.random() * 10 - 5)) * Math.PI) / 180;
      const line = i % 3 === 1;
      const spark = document.createElement("span");
      spark.className = line ? "lv-save-spark lv-save-spark-line" : "lv-save-spark";
      spark.style.background = SPARK_COLORS[i % SPARK_COLORS.length]!;
      const startR = radius * 0.92, travel = 22 + Math.random() * 26;
      const sx = Math.cos(angle) * startR, sy = Math.sin(angle) * startR;
      const ex = Math.cos(angle) * (startR + travel), ey = Math.sin(angle) * (startR + travel) - 6;
      const turn = `${String((angle * 180) / Math.PI + 90)}deg`;
      host.append(spark);
      animations.push(spark.animate([
        { transform: `translate(${String(sx)}px, ${String(sy)}px) rotate(${turn}) scale(.4)`, opacity: 0 },
        { transform: `translate(${String(sx + (ex - sx) * 0.55)}px, ${String(sy + (ey - sy) * 0.55)}px) rotate(${turn}) scale(1)`, opacity: 1, offset: 0.3 },
        { transform: `translate(${String(ex)}px, ${String(ey + 4)}px) rotate(${turn}) scale(.5)`, opacity: 0 },
      ], { duration: 780 + Math.random() * 200, delay: Math.random() * 70, easing: "cubic-bezier(.15,.7,.3,1)", fill: "both" }));
    }
    // 一圈很淡的光晕从圆形边缘扩散。
    const ring = document.createElement("span");
    ring.className = "lv-save-spark-ring";
    ring.style.width = ring.style.height = `${String(at.size)}px`;
    host.append(ring);
    animations.push(ring.animate([{ transform: "translate(-50%, -50%) scale(1)", opacity: 0.32 }, { transform: "translate(-50%, -50%) scale(1.55)", opacity: 0 }], { duration: 620, easing: "cubic-bezier(.2,.7,.3,1)", fill: "both" }));
    let finished = 0;
    for (const animation of animations) animation.onfinish = () => { finished += 1; if (finished === animations.length) done.current(); };
    return () => { for (const animation of animations) animation.cancel(); host.replaceChildren(); };
  }, [at]);
  return <div ref={ref} className="lv-save-sparks" aria-hidden="true" style={{ left: at.x + at.size / 2, top: at.y + at.size / 2 }} />;
}
