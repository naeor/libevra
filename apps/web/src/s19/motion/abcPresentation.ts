import { NAVIGATION } from "../../lib/motionTokens.js";
import { ABCMotion, type ABCStyle, type AVariant } from "../../../../../experiments/abc-motion/controller.js";
import type { ABCPresentation } from "./abcBridge.js";

let cloneSequence = 0;
/** 短暂、inert 的呈现副本：没有 React、事件或业务历史，完成/取消即释放。 */
export function snapshot(page: HTMLElement): HTMLElement {
  const plane = document.createElement("div");
  plane.className = "s19-abc-plane";
  const copy = page.cloneNode(true) as HTMLElement;
  copy.style.opacity = "";
  copy.style.viewTransitionName = "none";
  delete copy.dataset.b2MotionPage;
  const originals = [page, ...page.querySelectorAll<HTMLElement>("*")];
  const copies = [copy, ...copy.querySelectorAll<HTMLElement>("*")];
  const scrolls = originals.map(node => ({ top: node.scrollTop, left: node.scrollLeft }));
  const documentY = window.scrollY;
  const prefix = `abc-${++cloneSequence}-`;
  const ids = new Map<string, string>();
  copies.forEach(node => { if (node.id) { ids.set(node.id, prefix + node.id); node.id = prefix + node.id; } });
  for (const node of copies) for (const attribute of [...node.attributes]) {
    let value = attribute.value;
    for (const [oldId, newId] of ids) {
      value = value.replaceAll(`url(#${oldId})`, `url(#${newId})`);
      if ((attribute.name === "href" || attribute.name === "xlink:href") && value === `#${oldId}`) value = `#${newId}`;
    }
    if (value !== attribute.value) node.setAttribute(attribute.name, value);
  }
  plane.append(copy);
  // cloneNode 不复制画布像素（海浪、录音波形）；只读一次当前位图，副本不再绘制。
  originals.forEach((node, i) => {
    const target = copies[i];
    if (!(node instanceof HTMLCanvasElement) || !(target instanceof HTMLCanvasElement) || !node.width || !node.height) return;
    try { target.getContext("2d")?.drawImage(node, 0, 0); } catch { /* WebGL / 受限画布保持空白，不影响转场 */ }
  });
  // 滚动状态不属于 cloneNode；挂载后一次性同步，副本不订阅滚动或异步数据。
  const restore = () => {
    scrolls.forEach((point, i) => { const target = copies[i]; if (target) { target.scrollTop = point.top; target.scrollLeft = point.left; } });
    plane.scrollTop = documentY;
  };
  restoreSnapshot.set(plane, restore);
  const header = copy.querySelector<HTMLElement>(".tab-page-header, [data-page-nav]");
  if (header) { header.dataset.motionHeader = ""; header.dataset.motionChrome = ""; }
  const tabs = copy.querySelector<HTMLElement>("nav.shrink-0.border-t");
  if (tabs) { tabs.dataset.motionTabs = ""; tabs.dataset.motionChrome = ""; }
  const main = copy.querySelector<HTMLElement>("main");
  if (main) {
    main.dataset.motionBody = "";
    const title = main.querySelector<HTMLElement>(":scope > header");
    if (title) title.dataset.motionChrome = "";
  }
  else if (header?.classList.contains("tab-page-header") && header.parentElement) {
    // 只在副本中把标题之后的连续正文标为一个轨道，真实页面的结构完全不变。
    const body = document.createElement("div"); body.dataset.motionBody = "";
    const siblings: Element[] = [];
    for (let node = header.nextElementSibling; node; node = node.nextElementSibling) siblings.push(node);
    header.after(body); body.append(...siblings);
  }
  const groups = [...copy.querySelectorAll<HTMLElement>(".rounded-card.bg-surface, .lv-settings-body.bg-surface")];
  groups.filter(node => !groups.some(other => other !== node && other.contains(node))).forEach(node => {
    node.dataset.motionGroup = "";
    // 实验的 .group 仅用于阴影退远；不加载实验页面的排版规则。
    node.classList.add("group");
  });
  // “我的”的独立操作也随正文退场，避免退出按钮在两张卡片之间停留。
  for (const node of copy.querySelectorAll<HTMLElement>('[data-motion-body] > div:has(> button.bg-danger)')) node.dataset.motionGroup = "";
  return plane;
}
export const restoreSnapshot = new WeakMap<HTMLElement, () => void>();

/** 只接收协调器已经决定的方向和提交函数；不调用 navigate、pushState 或 back。 */
export class ABCPagePresentation implements ABCPresentation {
  constructor(private syncChrome: () => void = () => undefined) {}
  private stage: HTMLDivElement | null = null;
  private engine: ABCMotion | null = null;
  private from: { key: string; plane: HTMLElement } | null = null;
  private to: { key: string; plane: HTMLElement } | null = null;
  private real: { page: HTMLElement; opacity: string } | null = null;
  generation = 0;
  get active(): boolean { return this.engine?.active !== null && this.engine !== null; }

  private restoreReal(): void { if (this.real) this.real.page.style.opacity = this.real.opacity; this.real = null; }
  cancel(): void {
    this.generation++; this.engine?.dispose(); this.engine = null;
    this.restoreReal(); this.stage?.remove(); this.stage = null; this.from = this.to = null;
  }
  dispose(): void { this.cancel(); }

  run({ fromKey, toKey, page, commit, style, variant, direction }: {
    fromKey: string; toKey: string; page: () => HTMLElement | null; commit: () => void;
    style: ABCStyle; variant: AVariant | null; direction: "push" | "pop";
  }): void {
    const source = page();
    if (!source || (style === "a" && variant === null) || matchMedia("(prefers-reduced-motion: reduce)").matches || document.hidden) {
      this.cancel(); commit(); return;
    }
    const token = ++this.generation;
    // 反向与连续返回复用当前两张呈现平面，原控制器按当前姿态接续，不重置到起点。
    const from = this.to?.key === fromKey ? this.to.plane : snapshot(source);
    const retainedTarget = this.from?.key === toKey ? this.from.plane : null;
    this.restoreReal();
    commit();
    this.syncChrome();
    const target = page();
    if (!target) { this.cancel(); return; }
    if (!this.stage) {
      this.stage = document.createElement("div");
      this.stage.className = "lv-shell s19-abc-stage";
      this.stage.dataset.shell = "contents";
      this.stage.dataset.abcSnapshot = "";
      this.stage.inert = true; this.stage.setAttribute("aria-hidden", "true");
      document.body.append(this.stage);
      this.engine = new ABCMotion(this.stage);
    }
    this.stage.dataset.abcStyle = style;
    const to = retainedTarget ?? snapshot(target);
    const coverPop = direction === "pop" && (style === "c" || (style === "a" && variant === "pure-cover"));
    from.style.zIndex = coverPop ? "2" : "1";
    to.style.zIndex = coverPop ? "1" : "2";
    for (const child of [...this.stage.children]) if (child !== from && child !== to) child.remove();
    // append 仅用于新平面；中断反向时不能把正在播放的节点拆下再挂回。
    if (from.parentElement !== this.stage) { this.stage.append(from); restoreSnapshot.get(from)?.(); }
    if (to.parentElement !== this.stage) { this.stage.append(to); restoreSnapshot.get(to)?.(); }
    this.from = { key: fromKey, plane: from }; this.to = { key: toKey, plane: to };
    this.real = { page: target, opacity: target.style.opacity }; target.style.opacity = "0";
    const duration = style === "a" ? NAVIGATION.a[variant ?? "depth"] : NAVIGATION[style].duration;
    const handle = this.engine!.run({ from, to, style, ...(variant ? { variant } : {}), direction, duration });
    void handle.finished.then(() => { if (token === this.generation) this.cancel(); });
  }
}
