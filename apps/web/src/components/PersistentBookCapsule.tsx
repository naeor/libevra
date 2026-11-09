import { useContext, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useI18n } from "../i18n/index.js";
import { useGuestMode } from "../lib/guest/session.js";
import { BookCapsuleContext } from "./bookCapsule.js";
import { BookCapsuleContents, CurrentBookPicker } from "./CurrentBookPicker.js";
import "./current-book-caption.css";

const EXIT_MS = 200;
const GAP = 4; // 胶囊下缘与底栏上缘之间的留白（与原来说明行的 py-1 相同）

/**
 * 常驻底栏里的当前账本胶囊（见 bookCapsule.ts）。
 * - 目标页需要、原来没有：挂载时按原有入场（从下方弹起，略过冲）。
 * - 原来有、目标页不需要：向下缩到底栏上缘之后（越过上缘的部分被裁掉），然后卸载。
 * - 两页都需要：不动。记账菜单展开时直接隐藏（菜单卡片占这块位置），收起后直接显示。
 */
export function PersistentBookCapsule({ menuOpen }: { readonly menuOpen: boolean }): React.JSX.Element | null {
  const store = useContext(BookCapsuleContext);
  const name = useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.get ?? none, store?.get ?? none);
  const guest = useGuestMode();
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const exit = useRef<Animation | null>(null);
  const [shown, setShown] = useState<string | null>(name);
  const [mount, setMount] = useState(0);

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
    if (!capsule || !height || !capsule.animate || matchMedia("(prefers-reduced-motion: reduce)").matches) { setShown(null); return; }
    // 位移与裁切按同一进度线性对应：先走完 4px 留白（不裁），之后越过底栏上缘的部分逐渐裁掉。
    const travel = height + GAP + 2, o = GAP / travel;
    const animation = capsule.animate([
      { transform: "translateY(0)", clipPath: "inset(-24px -24px -24px -24px round 999px)" },
      { offset: o, transform: `translateY(${GAP}px)`, clipPath: "inset(-24px -24px 0px -24px round 999px)" },
      { transform: `translateY(${travel}px)`, clipPath: `inset(-24px -24px ${travel - GAP}px -24px round 999px)` },
    ], { duration: EXIT_MS, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" });
    exit.current = animation;
    const done = (): void => { if (exit.current !== animation) return; exit.current = null; setShown(null); };
    void animation.finished.then(done, done);
  }, [name, shown]);

  if (shown === null) return null;
  const caption = t("ledger.caption.currentBook", { name: shown });
  return <div ref={host} key={mount} className="lv-book-capsule-host" data-menu-open={menuOpen ? "true" : undefined} inert={menuOpen || name === null} title={caption}>
    {guest ? <span className="lv-book-capsule"><BookCapsuleContents name={shown} disclosure={false} /></span> : <CurrentBookPicker caption={caption} name={shown} />}
  </div>;
}

const noopSubscribe = (): (() => void) => () => undefined;
const none = (): null => null;
