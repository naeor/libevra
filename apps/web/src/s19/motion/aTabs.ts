import { DepthGlide } from "../../../../../experiments/abc-motion/tab-glide.js";

/** “＋”后面的停靠位（1.19.52）：在记账方式页时没有当前 Tab，胶囊滑到“＋”后面、被“＋”挡住并淡出。 */
const PLUS = "plus";

/** 路由拥有选中状态；实验控制器只画胶囊，不监听输入，也不写 aria-current。 */
class ControlledGlide extends DepthGlide {
  /** 只为让控制器接受“plus”这个目标：隐藏的占位节点，不参与测量，颜色动画落在它身上无影响。 */
  plusMarker: HTMLElement | null = null;
  private fade: Animation | null = null;
  override mark(): void { /* 由 BottomNav 渲染 */ }
  override measure(): void {
    const all = this.buttons, marker = this.plusMarker;
    if (marker) this.buttons = all.filter(button => button !== marker);
    super.measure();
    this.buttons = all;
    const plus = this.track.querySelector<HTMLElement>(".a-plus-slot");
    if (plus && this.targets && this.width > 0) {
      this.targets.set(PLUS, plus.offsetLeft + (plus.offsetWidth - this.width) / 2);
      if (this.selected === PLUS) this.snap();
    }
  }
  override snap(): void {
    super.snap();
    this.fade?.cancel(); this.fade = null;
    this.indicator.style.opacity = this.selected === PLUS ? "0" : "";
  }
  override select(key: string, options?: { animate?: boolean }) {
    const from = this.selected;
    const handle = super.select(key, options);
    const timing = this.active?.animations[0]?.effect?.getTiming();
    if (key !== from && (key === PLUS || from === PLUS) && timing && typeof timing.duration === "number") {
      this.fade?.cancel();
      const fade = this.indicator.animate(key === PLUS
        ? [{ opacity: 1 }, { opacity: 1, offset: .4 }, { opacity: 0, offset: .75 }, { opacity: 0 }]
        : [{ opacity: 0 }, { opacity: 1, offset: .4 }, { opacity: 1 }], { duration: timing.duration, fill: "forwards" });
      this.fade = fade;
      fade.onfinish = () => {
        if (this.fade !== fade) return;
        this.indicator.style.opacity = key === PLUS ? "0" : "";
        fade.cancel(); this.fade = null;
      };
    }
    return handle;
  }
}
interface Frame { selected: string; x: string; shape: string; width: string; face: string; colors: string[]; at: number }
let controller: ControlledGlide | null = null;
let previous: Frame | null = null;
let started = false;

export function captureATabs(): void {
  if (!controller?.nav.isConnected) return;
  previous = {
    selected: controller.selected, x: getComputedStyle(controller.indicator).transform,
    shape: getComputedStyle(controller.body).transform, width: getComputedStyle(controller.body).width,
    face: getComputedStyle(controller.face).opacity, colors: controller.buttons.map(button => getComputedStyle(button).color), at: performance.now(),
  };
}
function release(): void {
  if (!controller) return;
  controller.dispose(); controller.indicator.remove();
  controller.nav.removeAttribute("data-a-glide"); controller.track.classList.remove("a-tab-track");
  controller.track.querySelector(".a-plus-slot")?.classList.remove("a-plus-slot");
  controller.plusMarker?.remove();
  controller.indicator.style.removeProperty("opacity");
  controller.buttons.forEach(button => { delete button.dataset.tab; button.style.removeProperty("color"); });
  controller = null;
}
export function syncATabs(): void {
  const data = document.documentElement.dataset;
  if (data.visualStyle !== "a" || data.themeMode !== "light") { release(); previous = null; return; }
  const nav = document.querySelector<HTMLElement>('#root .lv-shell[data-shell="contents"] nav.shrink-0.border-t');
  const track = nav?.querySelector<HTMLElement>(":scope > ul");
  const buttons = track ? [...track.querySelectorAll<HTMLElement>(":scope > li > button:not(.size-16)")] : [];
  const selected = buttons.findIndex(button => button.getAttribute("aria-current") === "page");
  const atPlus = selected < 0 && track?.querySelector(":scope > li[data-entry-current]") != null;
  if (!nav || !track || !nav.getClientRects().length || buttons.length !== 4 || (selected < 0 && !atPlus)) { release(); return; }
  const key = atPlus ? PLUS : String(selected);
  if (controller?.nav === nav) { controller.select(key); return; }
  release();
  nav.dataset.aGlide = ""; track.classList.add("a-tab-track");
  track.querySelector("button.size-16")?.parentElement?.classList.add("a-plus-slot");
  buttons.forEach((button, i) => { button.dataset.tab = String(i); });
  const capsule = document.createElement("span"); capsule.className = "a-capsule"; capsule.setAttribute("aria-hidden", "true");
  const body = document.createElement("span"); body.className = "a-capsule-body";
  const face = document.createElement("span"); face.className = "a-capsule-face"; body.append(face); capsule.append(body); track.append(capsule);
  const frame = previous && performance.now() - previous.at < 800 ? previous : null;
  controller = new ControlledGlide(nav, { selected: frame?.selected ?? key });
  nav.removeEventListener("click", controller.click); nav.removeEventListener("keydown", controller.key);
  const marker = document.createElement("span"); marker.hidden = true; marker.dataset.tab = PLUS;
  track.querySelector(".a-plus-slot")?.append(marker);
  controller.plusMarker = marker; controller.buttons.push(marker); controller.measure();
  if (frame && frame.selected !== key) {
    controller.indicator.style.transform = frame.x; controller.body.style.transform = frame.shape;
    controller.body.style.width = frame.width; controller.face.style.opacity = frame.face;
    controller.buttons.forEach((button, i) => { button.style.color = frame.colors[i] ?? ""; });
    controller.select(key);
  }
  previous = null;
}
export function startATabs(): void {
  if (started) return; started = true;
  let queued = false;
  const queue = (): void => {
    if (queued) return; queued = true;
    queueMicrotask(() => { queued = false; syncATabs(); });
  };
  new MutationObserver(queue).observe(document.getElementById("root") ?? document.body,
    { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-current"] });
  new MutationObserver(queue).observe(document.documentElement,
    { attributes: true, attributeFilter: ["data-visual-style", "data-theme-mode"] });
  window.addEventListener("resize", queue);
  queue();
}
