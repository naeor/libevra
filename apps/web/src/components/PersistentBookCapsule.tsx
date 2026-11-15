import { useContext, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useI18n } from "../i18n/index.js";
import { BookCapsuleContext } from "./bookCapsule.js";
import { CurrentBookPicker } from "./CurrentBookPicker.js";
import { GIVE_WAY_RETURN_RATIO, useToastBottomOccupied, type ToastGiveWayState } from "./toast/bottomSlot.js";
import "./current-book-caption.css";

const EXIT_MS = 200;
const GAP = 4; // 胶囊下缘与底栏上缘之间的留白（与原来说明行的 py-1 相同）
/** 与 current-book-caption.css 的 `lv-book-capsule-enter` 同一组关键帧：从下方弹起、略过冲。 */
const ENTER_FRAMES: Keyframe[] = [
  { transform: "translateY(18px)", opacity: 0 },
  { offset: 0.78, transform: "translateY(-1.5px)", opacity: 1 },
  { transform: "translateY(0)", opacity: 1 },
];
const ENTER_MS = 220;
const ENTER_EASE = "cubic-bezier(.22, .8, .3, 1)";

const reducedMotion = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 向下缩到底栏上缘之后：位移与裁切按同一进度线性对应，先走完 4px 留白（不裁），之后越过底栏上缘的部分逐渐裁掉。 */
function retract(capsule: HTMLElement): Animation | null {
  const height = capsule.getBoundingClientRect().height;
  if (!height || !capsule.animate || reducedMotion()) return null;
  const travel = height + GAP + 2, o = GAP / travel;
  return capsule.animate([
    { transform: "translateY(0)", clipPath: "inset(-24px -24px -24px -24px round 999px)" },
    { offset: o, transform: `translateY(${GAP}px)`, clipPath: "inset(-24px -24px 0px -24px round 999px)" },
    { transform: `translateY(${travel}px)`, clipPath: `inset(-24px -24px ${travel - GAP}px -24px round 999px)` },
  ], { duration: EXIT_MS, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" });
}

/** 提示退场时长（按风格 120–180ms，Original 没有令牌时 180ms）的约八成：胶囊在提示快退完时开始弹回。 */
function returnDelay(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--lv-dismiss-ms");
  const ms = Number.parseFloat(raw);
  return Math.round((Number.isFinite(ms) && ms > 0 ? ms : 180) * GIVE_WAY_RETURN_RATIO);
}

/**
 * 常驻底栏里的当前账本胶囊（见 bookCapsule.ts）。
 * - 目标页需要、原来没有：挂载时按原有入场（从下方弹起，略过冲）。
 * - 原来有、目标页不需要：向下缩到底栏上缘之后（越过上缘的部分被裁掉），然后卸载。
 * - 两页都需要：不动。记账菜单展开时直接隐藏（菜单卡片占这块位置），收起后直接显示。
 * - 1.19.72 给提示让位（components/toast/bottomSlot.ts）：手机底部提示出现时，用同一段“缩到底栏后面”让开（不卸载，
 *   账本切换面板等状态不丢），让开后隐藏（不可点、不可聚焦）；提示退场到约八成时，用同一段“从下方弹起”回到原位。
 */
export function PersistentBookCapsule({ menuOpen }: { readonly menuOpen: boolean }): React.JSX.Element | null {
  const store = useContext(BookCapsuleContext);
  const name = useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.get ?? none, store?.get ?? none);
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const exit = useRef<Animation | null>(null);
  const [shown, setShown] = useState<string | null>(name);
  const [mount, setMount] = useState(0);
  const occupied = useToastBottomOccupied();
  const [giveWay, setGiveWay] = useState<ToastGiveWayState>("shown");
  const yielding = useRef<{ animation: Animation | null; timer: number }>({ animation: null, timer: 0 });

  useLayoutEffect(() => {
    if (name !== null) {
      // 缩回途中又需要它：撤掉缩回，重新弹起。
      if (exit.current) { exit.current.cancel(); exit.current = null; setMount(n => n + 1); }
      setShown(name);
      return;
    }
    if (shown === null || exit.current) return;
    const capsule = host.current?.querySelector<HTMLElement>(".lv-book-capsule");
    const height = capsule?.getBoundingClientRect().height ?? 0;
    if (!capsule || !height || !capsule.animate || reducedMotion()) { setShown(null); return; }
    const animation = retract(capsule);
    if (!animation) { setShown(null); return; }
    exit.current = animation;
    const done = (): void => { if (exit.current !== animation) return; exit.current = null; setShown(null); };
    void animation.finished.then(done, done);
  }, [name, shown]);

  // ---- 给底部提示让位 ----
  useLayoutEffect(() => {
    const state = yielding.current;
    if (occupied) {
      window.clearTimeout(state.timer);
      state.timer = 0;
      if (giveWay !== "shown") return; // 已经让开、正在让开，或者在等提示退场后弹回（那就继续留在后面）
      const capsule = host.current?.querySelector<HTMLElement>(".lv-book-capsule") ?? null;
      // 刚挂载、原有入场还没播完（例如删除后返回列表，撤销提示同时出现）：不先弹出再缩回，直接让开。
      const entering = capsule?.getAnimations?.().some(a => (a as CSSAnimation).animationName === "lv-book-capsule-enter" && a.playState === "running") ?? false;
      const animation = capsule && !entering ? retract(capsule) : null;
      if (!animation) { setGiveWay("away"); return; }
      state.animation = animation;
      setGiveWay("leaving");
      // 播完后保留终点（已藏在底栏后面）直到弹回；被撤掉（弹回提前开始）时 finished 会拒绝，忽略。
      void animation.finished.then(() => { if (state.animation === animation) setGiveWay("away"); }, () => undefined);
      return;
    }
    if (giveWay === "shown" || state.timer !== 0) return;
    state.timer = window.setTimeout(() => {
      state.timer = 0;
      state.animation?.cancel();
      state.animation = null;
      setGiveWay("shown");
      const capsule = host.current?.querySelector<HTMLElement>(".lv-book-capsule");
      if (capsule?.animate && !reducedMotion()) capsule.animate(ENTER_FRAMES, { duration: ENTER_MS, easing: ENTER_EASE });
    }, returnDelay()); // 减少动态效果时也等提示淡出（不位移，直接出现），免得胶囊出现在还没淡完的提示底下
  }, [occupied, giveWay]);

  useLayoutEffect(() => {
    const state = yielding.current;
    return () => { window.clearTimeout(state.timer); state.animation?.cancel(); };
  }, []);

  if (shown === null) return null;
  const caption = t("ledger.caption.currentBook", { name: shown });
  return <div ref={host} key={mount} className="lv-book-capsule-host" data-toast-give-way={giveWay} data-menu-open={menuOpen ? "true" : undefined} inert={menuOpen || name === null} title={caption}>
    {/* 游客多账本：游客也从胶囊切换账本（同一个 CurrentBookPicker，激活写游客库、整页重新载入）。 */}
    <CurrentBookPicker caption={caption} name={shown} />
  </div>;
}

const noopSubscribe = (): (() => void) => () => undefined;
const none = (): null => null;
