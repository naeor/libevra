import { useLayoutEffect, useRef } from "react";

let releaseExit: (() => void) | undefined;

/** 仅保留最多 200ms 的 inert 呈现副本；真实导航仍立即执行，不拦截事件或追加历史。 */
function retract(capsule: HTMLElement, nav: HTMLElement, shell: HTMLElement): void {
  releaseExit?.();
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || !capsule.animate) return;
  const rect = capsule.getBoundingClientRect(), edge = nav.getBoundingClientRect().top;
  if (!rect.width || edge <= rect.top || getComputedStyle(capsule).visibility !== "visible") return;
  const host = document.createElement("div");
  host.className = "lv-book-capsule-exit";
  host.inert = true;
  host.setAttribute("aria-hidden", "true");
  Object.assign(host.style, { position: "fixed", left: `${rect.left - 8}px`, top: `${rect.top - 8}px`,
    width: `${rect.width + 16}px`, height: `${edge - rect.top + 8}px`, overflow: "hidden", pointerEvents: "none", zIndex: "40" });
  const copy = capsule.cloneNode(true) as HTMLElement;
  copy.removeAttribute("id");
  copy.removeAttribute("aria-haspopup");
  copy.removeAttribute("aria-expanded");
  copy.tabIndex = -1;
  Object.assign(copy.style, { position: "absolute", left: "8px", top: "8px", width: `${rect.width}px`, height: `${rect.height}px`,
    maxWidth: "none", margin: "0", animation: "none", transition: "none", transform: "none", scale: "none", font: getComputedStyle(capsule).font });
  host.append(copy); shell.append(host);
  const animation = copy.animate([{ transform: "translateY(0)", opacity: 1 },
    { transform: `translateY(${edge - rect.top + 4}px)`, opacity: 0 }], { duration: 200, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" });
  const finish = () => {
    animation.cancel(); host.remove(); window.removeEventListener("resize", finish);
    if (releaseExit === finish) releaseExit = undefined;
  };
  releaseExit = finish;
  window.addEventListener("resize", finish, { once: true });
  void animation.finished.then(finish, finish);
}

export function useBookCapsuleMotion(visible: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const caption = ref.current, page = caption?.closest<HTMLElement>(".h-dvh"), shell = caption?.closest<HTMLElement>('.lv-shell[data-shell="contents"]');
    if (!visible || !caption || !page || !shell) return;
    // 快速切回时，旧副本立即退出；新入口自己的 CSS 入场不与 Tab 指示器共享动画。
    releaseExit?.();
    const onClick = (event: MouseEvent) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLElement>('nav [data-main-tab="ledger"]') : null;
      const capsule = caption.querySelector<HTMLElement>(".lv-book-capsule"), nav = button?.closest("nav");
      if (button && capsule && nav) retract(capsule, nav, shell);
    };
    page.addEventListener("click", onClick, true);
    return () => { page.removeEventListener("click", onClick, true); };
  }, [visible]);
  return ref;
}
