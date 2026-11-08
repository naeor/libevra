import { EASE, FIRST_EASE, relativeRect, reliableTarget, type Box } from "../../../../../prototype/geometry.mjs";
import { snapshot, restoreSnapshot } from "./abcPresentation.js";
import { runFrameClock, type FrameClock } from "../../lib/frameClock.js";
import { MOTION_CLOCK, OBJECT_EXPAND, easingFunction } from "../../lib/motionTokens.js";
import "./objectExpand.css";

export interface ObjectSource { id: string; slot?: string; rect: Box; width: number; height: number; radius: number; safeTop: number; safeBottom: number }
const ORIGIN = { left: 0, top: 0 } as DOMRect;
export function objectSource(node: HTMLElement): ObjectSource {
  const rect = node.getBoundingClientRect();
  const nav = document.querySelector<HTMLElement>("[data-persistent-nav]:not([hidden]):not([data-motion-copy])");
  const header = node.closest(".lv-pane-scroll")?.querySelector<HTMLElement>(".detail-header-row, .tab-page-header, [data-page-nav]");
  return { id: node.dataset.objectSource!, slot: node.dataset.objectSlot ?? "", rect: relativeRect(rect, ORIGIN), width: innerWidth, height: innerHeight,
    safeTop: header?.getBoundingClientRect().bottom ?? 0, safeBottom: nav?.getBoundingClientRect().top ?? innerHeight,
    radius: parseFloat(getComputedStyle(node).borderRadius) || 16 };
}
export function findObject(root: HTMLElement | null, id: string, slot = ""): HTMLElement | null {
  return [...root?.querySelectorAll<HTMLElement>("[data-object-source]") ?? []].find(node => node.dataset.objectSource === id && (node.dataset.objectSlot ?? "") === slot) ?? null;
}

/** 先写入首帧再交给 WAAPI：静态值保证时钟开始前的那一帧就是起始姿态。 */
export function setPose(node: HTMLElement, frame: Keyframe): void {
  for (const [key, value] of Object.entries(frame)) {
    if (key === "offset" || key === "easing" || key === "composite" || value === undefined || value === null) continue;
    node.style.setProperty(key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`), String(value));
  }
}

const FIRST = easingFunction(FIRST_EASE), MAIN = easingFunction(EASE), GEOMETRY = easingFunction(OBJECT_EXPAND.geometryEasing);
const at = (frames: [number, Keyframe][]): Keyframe[] => frames.map(([offset, frame]) => ({ ...frame, offset }));
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
/** B2 的玻璃直接画在容器本身（见 CSS）：frosted 把模糊放在 ::before，容器淡出时会把自己变成背景根，玻璃后方就什么也读不到。 */
function finishFor(style: string): string { return style === "b1" ? "satin" : "auto"; }

/** 容器姿态：位置与尺寸（布局盒）、绕中心的缩放、圆角。 */
export interface Pose { x: number; y: number; width: number; height: number; scale: number; radius: number }
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const blend = (a: Pose, b: Pose, t: number): Pose => ({ x: mix(a.x, b.x, t), y: mix(a.y, b.y, t), width: mix(a.width, b.width, t), height: mix(a.height, b.height, t), scale: mix(a.scale, b.scale, t), radius: mix(a.radius, b.radius, t) });
/** 屏幕上实际看到的矩形（缩放绕中心）。 */
export function visualRect(pose: Pose): Box & { radius: number } {
  return { x: pose.x + pose.width * (1 - pose.scale) / 2, y: pose.y + pose.height * (1 - pose.scale) / 2, width: pose.width * pose.scale, height: pose.height * pose.scale, radius: pose.radius * pose.scale };
}

/**
 * 展开几何：一条连续曲线（Motion Token `OBJECT_EXPAND.geometryEasing`）在 [0, end] 内从来源长到整屏，
 * 返回 0–1 的展开比例；A 的前移（中段约 1.1 倍）是叠加在上面的一次起伏，起于 0、在 30% 处最大、到 end 回到 1。
 */
export function expansion(p: number, end: number, midScale: number): { fraction: number; scale: number } {
  const x = clamp01(p / end);
  const bump = x < 0.3 ? FIRST(x / 0.3) : 1 - MAIN((x - 0.3) / 0.7);
  return { fraction: GEOMETRY(x), scale: mix(1, midScale, bump) };
}
const SAMPLES = 48;
/** 在同一时钟上密集采样：容器、详情内容与背景响应读同一几何，任何时刻边界一致。 */
const sample = (fn: (p: number) => Keyframe): Keyframe[] => Array.from({ length: SAMPLES + 1 }, (_, i) => ({ ...fn(i / SAMPLES), offset: i / SAMPLES }));
const shellFrame = (pose: Pose): Keyframe => ({ transform: `translate3d(${pose.x}px,${pose.y}px,0) scale(${pose.scale})`, width: `${pose.width}px`, height: `${pose.height}px`, borderRadius: `${pose.radius}px` });
/**
 * 详情内容放在容器里：按容器宽度等比缩放（文字不变形）、顶端对齐，只露出容器高度那一段并按容器圆角裁剪。
 * `page` 是详情页面在不加变换时的位置与尺寸。
 */
export function contentFrame(pose: Pose, page: { left: number; top: number; width: number; height: number }): Keyframe {
  const v = visualRect(pose), s = v.width / page.width;
  return {
    transform: `translate3d(${v.x - page.left}px,${v.y - page.top}px,0) scale(${s})`,
    clipPath: `inset(0px 0px ${Math.max(0, page.height - v.height / s)}px 0px round ${v.radius / s}px)`,
  };
}
/** 背景（原页面）对展开的响应：A 后退压暗，C 轻退，B1 上下两半挤出（返回比例），B2 不动。 */
function backgroundPose(style: string, fraction: number): { scale: number; opacity: number } {
  if (style === "a") return { scale: 1 - .02 * fraction, opacity: 1 - .42 * fraction };
  if (style === "c") return { scale: 1 - .01 * fraction, opacity: 1 - .28 * fraction };
  return { scale: 1, opacity: 1 };
}

interface Held { node: HTMLElement; style: string | null; inert: boolean }
interface Opening { source: ObjectSource; style: string; duration: number; arrived: boolean; pose: (p: number) => Pose; detail: HTMLElement | null }
interface Track { node: HTMLElement; frames: Keyframe[]; animation: Animation }

/**
 * Object Expand（1.19.44）：卡片在原页面上逐渐成为详情页面。
 *
 * - **展开**：点击当帧容器就从来源卡片的实际位置与尺寸开始长大（第一帧透明叠在真实卡片上）。详情页面
 *   用 React transition 在后台提交；到达后被放进容器里——按容器宽度等比缩放、顶端对齐、按容器圆角
 *   裁剪——随容器一起长大并渐显，所以任何时刻容器里都有内容，没有“铺满却还是空的”一段。React 提交
 *   时把原页面移出工作区，同一个节点随即接到背景舞台上继续它的风格响应（A 后退压暗、B1 上下挤出、
 *   B2 不动、C 轻退），不克隆整页；底栏用一份副本留在原处，直到被容器盖住。容器铺满后原页面在其下退场，
 *   容器底色再淡回统一壁纸，详情就停在最终位置。
 * - **等内容**：详情还没提交时，容器最多长到中间帧（约 0.19）并慢速蠕动，到达后立即放开。
 * - **收回**：同步提交列表（恢复滚动）；详情页面节点被移出后放进前景，在收缩的容器里按同一几何缩小并淡出，
 *   容器回到实际来源卡片后淡出露出真实卡片。列表与底栏在容器补满后才出现。
 * - **中途返回**：详情尚未到达时容器沿当前姿态收回、不经过详情；已到达时从当前几何反向收回。
 * - 时间由帧锚定时钟推进；时长与交接比例来自 Motion Token（tokens.ts 的 OBJECT_EXPAND）。
 */
export class ObjectExpandPresentation {
  private front: HTMLElement | null = null;
  private back: HTMLElement | null = null;
  private shell: HTMLElement | null = null;
  private animations: Animation[] = [];
  private held: Held[] = [];
  private clock: FrameClock | null = null;
  private generation = 0;
  private opening: Opening | null = null;
  get active(): boolean { return this.front !== null; }

  /** 结束当前呈现，复原所有被借用的真实节点并移除舞台。 */
  cancel(): void {
    ++this.generation;
    this.clock?.cancel(); this.clock = null;
    for (const animation of this.animations) animation.cancel();
    this.animations = [];
    this.restore();
    this.front?.remove(); this.back?.remove(); this.front = this.back = this.shell = null;
    this.opening = null;
  }

  private restore(): void {
    for (const { node, style, inert } of this.held) {
      if (style === null) node.removeAttribute("style"); else node.setAttribute("style", style);
      node.inert = inert; delete node.dataset.objectLive;
    }
    this.held = [];
  }
  private hold(node: HTMLElement): HTMLElement {
    if (!this.held.some(item => item.node === node)) this.held.push({ node, style: node.getAttribute("style"), inert: node.inert });
    return node;
  }
  private animate(node: HTMLElement, frames: Keyframe[], duration: number, easing = "linear"): Animation {
    setPose(node, frames[0]!);
    const animation = node.animate(frames, { duration, easing, fill: "both" });
    this.animations.push(animation); return animation;
  }

  run({ source, page, commit, commitNow, style, reverse = false }: {
    source: ObjectSource; page: () => HTMLElement | null;
    /** 后台提交（React transition）：展开时详情在后台渲染，不占住点击后的帧。 */
    commit: () => void;
    /** 同步提交：收回与降级路径。 */
    commitNow: () => void;
    style: string; reverse?: boolean;
  }): void {
    const old = page();
    if (!old || matchMedia("(prefers-reduced-motion: reduce)").matches || document.hidden || typeof old.animate !== "function") {
      this.cancel(); commitNow(); return;
    }
    const opening = this.opening;
    if (reverse && opening && !opening.arrived) { this.retract(commitNow); return; }
    if (reverse) {
      // 展开中途返回：从当前几何与内容透明度反向收回。
      const from = opening && this.clock ? opening.pose(this.clock.progress) : null;
      const content = from && opening?.detail ? Number(getComputedStyle(opening.detail).opacity) || 0 : 1;
      this.close(source, old, page, commitNow, style, from, content);
    } else this.open(source, old, page, commit, style);
  }

  private stage(style: string, z: "front" | "back"): HTMLElement {
    const stage = document.createElement("div");
    stage.className = `lv-shell object-stage object-${z}`; stage.dataset.shell = "contents"; stage.dataset.objectStyle = style;
    stage.inert = true; stage.setAttribute("aria-hidden", "true");
    return stage;
  }
  private buildShell(style: string): { shell: HTMLElement; lift: HTMLElement; shade: HTMLElement } {
    const shell = document.createElement("div");
    shell.className = "object-shell lv-material lv-material-effects";
    shell.dataset.materialRole = "display"; shell.dataset.materialFinish = finishFor(style);
    const lift = document.createElement("div"); lift.className = "object-lift"; shell.append(lift);
    const shade = document.createElement("div"); shade.className = "object-shade";
    this.shell = shell;
    return { shell, lift, shade };
  }
  /** B1 下半页：一张副本，夹在页面与固定底栏之间滑出；上半页是真实页面本身。 */
  private lowerHalf(back: HTMLElement, page: HTMLElement, split: number): HTMLElement {
    const plane = snapshot(page);
    // 副本会带上真实页面已写入的“只留上半页”裁剪；下半页副本要完整内容，再由外层只露出下半。
    (plane.firstElementChild as HTMLElement | null)?.style.removeProperty("clip-path");
    const half = document.createElement("div"); half.className = "object-neighborhood";
    half.style.clipPath = `inset(${split}px 0 0 0)`; half.append(plane); back.append(half);
    restoreSnapshot.get(plane)?.();
    return half;
  }
  /** 被 React 移出工作区的真实页面接到舞台上继续动画；滚动位置在离开文档时会丢，接回后一次性还原。 */
  private park(node: HTMLElement, plane: HTMLElement, scrolls: [HTMLElement, number, number][], documentY: number, tracks: Track[]): void {
    for (const track of tracks) this.clock?.remove(track.animation);
    plane.append(node);
    for (const [target, top, left] of scrolls) { target.scrollTop = top; target.scrollLeft = left; }
    plane.scrollTop = documentY;
    for (const track of tracks) {
      const timing = track.animation.effect?.getTiming();
      track.animation = node.animate(track.frames, { duration: Number(timing?.duration) || 0, fill: "both" });
      this.animations.push(track.animation);
      this.clock?.add(track.animation);
    }
  }
  private plane(stage: HTMLElement, className = "s19-abc-plane"): HTMLElement {
    const plane = document.createElement("div"); plane.className = className; stage.append(plane); return plane;
  }

  private open(source: ObjectSource, old: HTMLElement, page: () => HTMLElement | null, commit: () => void, style: string): void {
    this.cancel();
    const token = this.generation, started = performance.now();
    const { duration: D, phases } = OBJECT_EXPAND.open;
    const W = innerWidth, H = innerHeight, rect = source.rect, split = rect.y + rect.height;
    const start: Pose = { ...rect, scale: 1, radius: source.radius };
    const full: Pose = { x: 0, y: 0, width: W, height: H, scale: 1, radius: 0 };
    const midScale = style === "a" ? 1.1 : 1;
    const pose = (p: number): Pose => { const e = expansion(p, phases.geometry, midScale); return { ...blend(start, full, e.fraction), scale: e.scale }; };
    const fraction = (p: number): number => expansion(p, phases.geometry, midScale).fraction;

    // 背景舞台（35）：原页面被 React 移出后接到这里；B1 下半页副本与底栏副本也在这里，都在常驻底栏（40）之下。
    const back = this.stage(style, "back"); const plane = this.plane(back); document.body.append(back); this.back = back;
    // 前景（45）：压暗层与容器；详情页面本身在 46，放在容器之上。
    const front = this.stage(style, "front");
    const { shell, lift, shade } = this.buildShell(style);
    front.append(shade, shell); document.body.append(front); this.front = front;
    const nav = document.querySelector<HTMLElement>("[data-persistent-nav]:not([hidden]):not([data-motion-copy])");
    const navCopy = nav ? nav.cloneNode(true) as HTMLElement : null;
    if (navCopy) { navCopy.dataset.motionCopy = ""; navCopy.removeAttribute("id"); }

    const scrolls: [HTMLElement, number, number][] = [];
    for (const node of [old, ...old.querySelectorAll<HTMLElement>("*")]) if (node.scrollTop || node.scrollLeft) scrolls.push([node, node.scrollTop, node.scrollLeft]);
    const documentY = window.scrollY;
    const real = this.hold(old); real.inert = true;
    if (style !== "b2") real.style.willChange = "transform";

    this.animate(shell, sample(p => shellFrame(pose(p))), D);
    // 第一帧容器透明叠在真实卡片上，cover 内补满；铺满后底色在 surface 段淡回统一壁纸。
    this.animate(shell, at([[0, { opacity: 0 }], [phases.cover[1], { opacity: 1 }], [phases.surface[0], { opacity: 1 }], [phases.surface[1], { opacity: 0 }], [1, { opacity: 0 }]]), D);
    this.animate(lift, style === "a" ? at([[0, { opacity: 0 }], [phases.geometry * .3, { opacity: 1 }], [phases.geometry, { opacity: .45 }], [phases.surface[1], { opacity: 0 }], [1, { opacity: 0 }]]) : [{ opacity: 0 }, { opacity: 0 }], D);
    this.animate(shade, style === "a" ? at([[0, { opacity: 0 }], [phases.geometry * .3, { opacity: .28 }], [phases.background[0], { opacity: .28 }], [phases.background[1], { opacity: 0 }], [1, { opacity: 0 }]]) : [{ opacity: 0 }, { opacity: 0 }], D);

    // 原页面的响应与容器同一几何；铺满后在容器下退场（B2 只在这时才有透明度动画，之前不让它成为背景根）。
    const leave = (p: number): number => p < phases.background[0] ? 1 : 1 - clamp01((p - phases.background[0]) / (phases.background[1] - phases.background[0]));
    const tracks: Track[] = [];
    const track = (node: HTMLElement, frames: Keyframe[]): void => { tracks.push({ node, frames, animation: this.animate(node, frames, D) }); };
    if (style === "b1") {
      // 上半页（含来源卡片）是真实页面，下半页是副本；两半与容器同节奏完整挤出可视区，固定底栏不动。
      const up = -(split + 16), down = H - split + 16;
      real.style.clipPath = `inset(0 0 ${Math.max(0, H - split)}px 0)`;
      const lower = this.lowerHalf(back, old, split);
      track(real, sample(p => ({ transform: `translate3d(0,${up * fraction(p)}px,0)`, opacity: leave(p) })));
      this.animate(lower, sample(p => ({ transform: `translate3d(0,${down * fraction(p)}px,0)`, opacity: leave(p) })), D);
    } else if (style !== "b2") {
      track(real, sample(p => { const b = backgroundPose(style, GEOMETRY(clamp01(p / phases.geometry))); return { transform: `translate3d(0,0px,0) scale(${b.scale})`, opacity: b.opacity * leave(p) }; }));
    }
    let b2Leaving = style !== "b2", parked = false;

    const opening: Opening = { source, style, duration: D, arrived: false, pose, detail: null };
    this.opening = opening;
    const arrive = (target: HTMLElement, p: number): void => {
      opening.arrived = true; opening.detail = target;
      // 底栏副本留在原处直到被容器盖住，随原页面在容器下退场。
      if (navCopy) { back.append(navCopy); this.clock?.add(this.animate(navCopy, sample(q => ({ opacity: leave(q) })), D)); }
      const live = this.hold(target);
      const box = live.getBoundingClientRect(), layout = { left: box.left, top: box.top, width: box.width || W, height: live.offsetHeight || H };
      live.dataset.objectLive = style;
      Object.assign(live.style, { position: "relative", zIndex: "46", transformOrigin: "0 0" });
      const geometry = live.animate(sample(q => contentFrame(pose(q), layout)), { duration: D, fill: "both" });
      // 内容在容器里渐显；来得晚就从到达时开始，不会一出现就是半透明。
      const c0 = Math.max(phases.content[0], p), c1 = Math.min(1, Math.max(phases.content[1], c0 + .18));
      const reveal = live.animate(at([[0, { opacity: 0 }], [c0, { opacity: 0 }], [c1, { opacity: 1 }], [1, { opacity: 1 }]]), { duration: D, fill: "both" });
      this.animations.push(geometry, reveal);
      this.clock?.add(geometry); this.clock?.add(reveal);
      revealDone = c1; revealAnimation = reveal;
    };
    let revealDone = 1, revealAnimation: Animation | null = null;
    this.clock = runFrameClock(this.animations, D, {
      name: "objectExpand", maxStep: MOTION_CLOCK.maxStep,
      // 详情未到：容器最多长到中间帧，再慢速蠕动；到达即放开。
      limit: () => opening.arrived ? D : D * Math.min(OBJECT_EXPAND.waitMax, OBJECT_EXPAND.waitAt + Math.max(0, performance.now() - started - D * OBJECT_EXPAND.waitAt) * OBJECT_EXPAND.waitCreep / D),
      onProgress: progress => {
        if (token !== this.generation) return;
        if (!parked && !old.isConnected) { parked = true; this.park(old, plane, scrolls, documentY, tracks); }
        if (!opening.arrived) {
          const target = page();
          if (target && target !== old && target.isConnected) arrive(target, progress);
          else if (performance.now() - started > OBJECT_EXPAND.giveUpMs) { this.cancel(); return; }
        }
        if (!b2Leaving && progress >= phases.background[0]) { b2Leaving = true; const frames = sample(p => ({ opacity: leave(p) })); track(old, frames); this.clock?.add(tracks.at(-1)!.animation); }
        // 渐显完成后移除详情的透明度动画：页面不再是背景根，B2 玻璃卡片恢复读取壁纸。
        if (revealAnimation && progress >= revealDone) { this.clock?.remove(revealAnimation); opening.detail?.style.removeProperty("opacity"); revealAnimation = null; }
      },
      onDone: () => { if (token !== this.generation) return; this.clock = null; this.cancel(); },
    });
    commit();
  }

  /** 详情尚未到达就返回：容器沿当前姿态收回原卡片，页面回到原位，不经过详情。 */
  private retract(commitNow: () => void): void {
    const { source, duration } = this.opening!;
    const token = ++this.generation;
    this.clock?.cancel(); this.clock = null;
    const shell = this.shell!;
    const poses = new Map<HTMLElement, Keyframe>();
    for (const animation of this.animations) {
      const node = (animation.effect as KeyframeEffect | null)?.target as HTMLElement | null;
      if (!node || poses.has(node)) continue;
      const computed = getComputedStyle(node);
      poses.set(node, { transform: computed.transform === "none" ? "translate3d(0,0px,0)" : computed.transform, opacity: computed.opacity, width: computed.width, height: computed.height, borderRadius: computed.borderRadius });
    }
    for (const animation of this.animations) animation.cancel();
    this.animations = [];
    this.opening = null;
    // 详情从未提交，屏幕上仍是原页面；这次 POP 只是把路由交回同一页（后台那次提交被这次同步更新覆盖）。
    commitNow();
    const back = Math.max(120, Math.round(duration * OBJECT_EXPAND.retractShare));
    const current = poses.get(shell)!;
    this.animate(shell, [{ transform: current.transform!, width: current.width!, height: current.height!, borderRadius: current.borderRadius! }, shellFrame({ ...source.rect, scale: 1, radius: source.radius })], back, EASE);
    const opacity = current.opacity ?? 1;
    // 容器先以实体形态缩回卡片，后半段才淡去，读作“收回卡片”而不是原地溶解。
    this.animate(shell, at([[0, { opacity }], [.5, { opacity }], [1, { opacity: 0 }]]), back);
    for (const [node, pose] of poses) {
      if (node === shell) continue;
      const decor = node.classList.contains("object-shade") || node.classList.contains("object-lift");
      this.animate(node, [decor ? { opacity: pose.opacity! } : { transform: pose.transform!, opacity: pose.opacity! }, decor ? { opacity: 0 } : { transform: "translate3d(0,0px,0)", opacity: 1 }], back, EASE);
    }
    this.clock = runFrameClock(this.animations, back, { name: "objectRetract", maxStep: MOTION_CLOCK.maxStep, onDone: () => { if (token === this.generation) { this.clock = null; this.cancel(); } } });
  }

  private close(source: ObjectSource, old: HTMLElement, page: () => HTMLElement | null, commitNow: () => void, style: string, from: Pose | null, content: number): void {
    this.cancel();
    const token = this.generation;
    const { duration: D, phases } = OBJECT_EXPAND.close;
    const W = innerWidth, H = innerHeight;
    const full: Pose = { x: 0, y: 0, width: W, height: H, scale: 1, radius: 0 };
    const front = this.stage(style, "front");
    const { shell, lift, shade } = this.buildShell(style);
    front.append(shade, shell);
    const plane = this.plane(front, "s19-abc-plane object-content");
    document.body.append(front); this.front = front;
    setPose(shell, { opacity: from ? 1 : 0 }); setPose(shade, { opacity: 0 });
    const scrolls: [HTMLElement, number, number][] = [];
    for (const node of [old, ...old.querySelectorAll<HTMLElement>("*")]) if (node.scrollTop || node.scrollLeft) scrolls.push([node, node.scrollTop, node.scrollLeft]);
    const box = old.getBoundingClientRect(), layout = { left: 0, top: 0, width: box.width || W, height: old.offsetHeight || H };
    // 同步提交列表；React 移出的详情节点放进前景，在收缩的容器里继续显示。
    commitNow();
    const target = page();
    if (!target || target === old || old.isConnected) { this.cancel(); return; }
    plane.append(old);
    for (const [node, top, left] of scrolls) { node.scrollTop = top; node.scrollLeft = left; }
    old.dataset.objectLive = style;
    old.style.transformOrigin = "0 0";

    const sourceNode = findObject(target, source.id, source.slot);
    const now = sourceNode ? relativeRect(sourceNode.getBoundingClientRect(), ORIGIN) : null;
    const reliable = reliableTarget(source.rect, now, { width: W, height: H }, source.width !== W || source.height !== H)
      && !!now && now.y >= source.safeTop - 1 && now.y + now.height <= source.safeBottom + 1;
    const rect = reliable && now ? now : source.rect, split = rect.y + rect.height;
    const to: Pose = { ...rect, scale: 1, radius: source.radius };
    const origin = from ?? full;
    const [g0, g1] = phases.geometry;
    const progressOf = (p: number): number => p <= g0 ? 0 : p >= g1 ? 1 : GEOMETRY((p - g0) / (g1 - g0));
    const pose = (p: number): Pose => blend(origin, to, progressOf(p));
    // 中途返回时容器已不透明、列表已在原处：不再从 0 出现。
    const interrupted = from !== null;
    const backAt = interrupted ? 1 - Math.max(0, Math.min(1, (from.width - to.width) / Math.max(1, W - to.width))) : 1;

    const real = this.hold(target); real.inert = true;
    if (style !== "b2") real.style.willChange = "transform";
    const nav = document.querySelector<HTMLElement>("[data-persistent-nav]:not([hidden]):not([data-motion-copy])");
    const [r0, r1] = phases.reveal;
    const appear = (): Keyframe[] => interrupted ? [{ opacity: 1 }, { opacity: 1 }]
      : !reliable ? at([[0, { opacity: 0 }], [.1, { opacity: 0 }], [.6, { opacity: 1 }], [1, { opacity: 1 }]])
      : at([[0, { opacity: 0 }], [r0, { opacity: 0 }], [r1, { opacity: 1 }], [1, { opacity: 1 }]]);
    // 出现完成后移除透明度动画：页面与底栏不再是背景根，玻璃卡片恢复对壁纸的模糊；同时清掉首帧写入的静态透明度。
    const transient: [Animation, number][] = [];
    const settleAt = interrupted ? 0 : !reliable ? .6 : r1;
    if (nav) transient.push([this.animate(this.hold(nav), appear(), D), settleAt]);
    transient.push([this.animate(real, appear(), D), settleAt]);

    if (reliable) {
      this.animate(shell, sample(p => shellFrame(pose(p))), D);
      this.animate(shell, at([[0, { opacity: interrupted ? 1 : 0 }], [r0, { opacity: 1 }], [phases.surface[0], { opacity: 1 }], [1, { opacity: 0 }]]), D);
      this.animate(old, sample(p => contentFrame(pose(p), layout)), D);
      const [c0, c1] = phases.content;
      this.animate(old, at([[0, { opacity: content }], [c0, { opacity: content }], [c1, { opacity: 0 }], [1, { opacity: 0 }]]), D);
    } else {
      // 来源已删除、移动或不在安全区：不飞向过时坐标，详情原地淡出，列表淡入。
      this.animate(shell, [{ opacity: 0 }, { opacity: 0 }], D);
      this.animate(old, at([[0, { opacity: content }], [.1, { opacity: content }], [.6, { opacity: 0 }], [1, { opacity: 0 }]]), D);
    }
    this.animate(lift, style === "a" && reliable ? at([[0, { opacity: 0 }], [r1, { opacity: .45 }], [1, { opacity: 0 }]]) : [{ opacity: 0 }, { opacity: 0 }], D);
    this.animate(shade, style === "a" ? at([[0, { opacity: 0 }], [r0, { opacity: 0 }], [r1, { opacity: .28 }], [1, { opacity: 0 }]]) : [{ opacity: 0 }, { opacity: 0 }], D);
    if (style === "b1" && reliable) {
      const up = -(split + 16), down = H - split + 16;
      real.style.clipPath = `inset(0 0 ${Math.max(0, H - split)}px 0)`;
      const back = this.stage(style, "back"); document.body.append(back); this.back = back;
      const lower = this.lowerHalf(back, target, split);
      const slide = (dy: number) => sample(p => ({ transform: `translate3d(0,${dy * backAt * (1 - progressOf(p))}px,0)` }));
      this.animate(real, slide(up), D);
      this.animate(lower, slide(down), D);
      transient.push([this.animate(lower, appear(), D), settleAt]);
    } else if ((style === "a" || style === "c") && reliable) {
      this.animate(real, sample(p => { const b = backgroundPose(style, backAt * (1 - progressOf(p))); return { transform: `translate3d(0,0px,0) scale(${b.scale})` }; }), D);
    }
    this.clock = runFrameClock(this.animations, D, { name: "objectCollapse", maxStep: MOTION_CLOCK.maxStep, onProgress: progress => {
      for (let i = transient.length - 1; i >= 0; i--) {
        const [animation, end] = transient[i]!;
        if (progress >= end) {
          // 移除动画后元素会回到 animate() 预先写入的首帧静态值（透明度 0），必须一并清掉，否则列表与底栏整段不可见。
          ((animation.effect as KeyframeEffect | null)?.target as HTMLElement | null)?.style.removeProperty("opacity");
          this.clock?.remove(animation); transient.splice(i, 1);
        }
      }
    }, onDone: () => {
      if (token !== this.generation) return;
      this.clock = null; this.cancel();
      if (reliable && sourceNode?.isConnected) (sourceNode.matches("button,a") ? sourceNode : sourceNode.querySelector<HTMLElement>("button,a"))?.focus({ preventScroll: true });
    } });
  }
}
