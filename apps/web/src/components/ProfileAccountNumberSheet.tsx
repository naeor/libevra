import { useEffect, useRef, useState } from "react";

import { copyText } from "../lib/clipboard.js";
import { Button } from "./Button.js";

/** 账号编号的局部操作面板；原生 dialog 负责焦点约束和背景不可交互。 */
export function ProfileAccountNumberSheet({
  open,
  number,
  onClose,
}: {
  readonly open: boolean;
  readonly number: string;
  readonly onClose: () => void;
}): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const animations = useRef<Animation[]>([]);
  const session = useRef(0);
  const [phase, setPhase] = useState<"idle" | "copying" | "copied" | "manual">("idle");

  useEffect(() => {
    const element = dialog.current;
    if (!open || element === null) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closing.current = false;
    session.current += 1;
    setPhase("idle");
    element.showModal();
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      animations.current = [
        panel.current!.animate([{ transform: "translateY(100%)" }, { transform: "translateY(0)" }], {
          duration: 260, easing: "cubic-bezier(0.32, 0.72, 0, 1)",
        }),
        overlay.current!.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "ease-out" }),
      ];
    }
    return () => {
      session.current += 1;
      animations.current.forEach((animation) => animation.cancel());
      element.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [open]);

  async function close(): Promise<void> {
    if (closing.current) return;
    closing.current = true;
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // 从当前插值位置收回，避免刚打开就关闭时先跳到终点。
      const start = getComputedStyle(panel.current!).transform;
      const opacity = getComputedStyle(overlay.current!).opacity;
      animations.current.forEach((animation) => animation.cancel());
      animations.current = [
        panel.current!.animate([{ transform: start }, { transform: "translateY(100%)" }], {
          duration: 180, easing: "ease-in", fill: "forwards",
        }),
        overlay.current!.animate([{ opacity }, { opacity: 0 }], { duration: 180, fill: "forwards" }),
      ];
      try { await Promise.all(animations.current.map((animation) => animation.finished)); }
      catch { return; } // 路由卸载时取消动画，不再回调旧页面。
    }
    onClose();
  }

  async function copy(): Promise<void> {
    const startedIn = session.current;
    setPhase("copying");
    const outcome = await copyText(number, dialog.current ?? undefined);
    if (startedIn === session.current && dialog.current?.open) {
      setPhase(outcome === "copied" ? "copied" : "manual");
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-label="账号编号"
      aria-modal="true"
      onCancel={(event) => { event.preventDefault(); void close(); }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none border-0 bg-transparent p-0 backdrop:bg-transparent open:flex open:items-end open:justify-center"
    >
      <div ref={overlay} aria-hidden="true" onClick={() => void close()} className="absolute inset-0 bg-overlay-soft" />
      <div ref={panel} className="relative flex max-h-[calc(100dvh-24px)] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-t-sheet border border-line bg-surface px-5 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] shadow-sheet">
        <span aria-hidden="true" className="mx-auto h-1 w-10 shrink-0 rounded-full bg-line" />
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-section-title text-ink">账号编号</h2>
          <button type="button" autoFocus onClick={() => void close()} aria-label="关闭账号编号" className="flex size-11 items-center justify-center rounded-full text-body text-muted transition hover:bg-canvas focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-soft">✕</button>
        </div>
        <p className="select-all py-2 text-center font-mono text-page-title text-ink tabular-nums">{number}</p>
        <Button onClick={() => void copy()} disabled={phase === "copying"}>
          {phase === "copied" ? "已复制" : phase === "copying" ? "正在复制…" : "复制账号编号"}
        </Button>
        <p role="status" aria-live="polite" className="min-h-5 text-center text-helper-relaxed text-muted">
          {phase === "manual" ? "无法自动复制，请长按上方编号复制。" : phase === "copied" ? "账号编号已复制。" : ""}
        </p>
      </div>
    </dialog>
  );
}
