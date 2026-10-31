import { useEffect, useRef, useState } from "react";

import { readShellOverride, shellKindFor, type ShellKind, type ShellOverride } from "./shellKind.js";

const FINE_POINTER = "(hover: hover) and (pointer: fine)";

function editingText(): boolean {
  const active = typeof document === "undefined" ? null : document.activeElement;
  if (active === null) return false;
  return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || (active as HTMLElement).isContentEditable;
}

function measure(override: ShellOverride, previous: ShellKind | null): ShellKind {
  if (typeof window === "undefined") return "workspace";
  return shellKindFor({
    fine: window.matchMedia(FINE_POINTER).matches,
    width: window.innerWidth,
    height: window.innerHeight,
    override,
    previous,
  });
}

/**
 * 当前应使用的外壳。窗口大小或输入能力变化时重新判断；正在输入文字时不切换（切换外壳会重新挂载整棵
 * 界面，未保存的输入会丢）。
 */
export function useShellKind(): ShellKind {
  const [override] = useState(readShellOverride);
  const [kind, setKind] = useState<ShellKind>(() => measure(override, null));
  const current = useRef(kind);
  current.current = kind;

  useEffect(() => {
    const media = window.matchMedia(FINE_POINTER);
    const update = (): void => {
      const next = measure(override, current.current);
      if (next !== current.current && !editingText()) setKind(next);
    };
    window.addEventListener("resize", update);
    media.addEventListener("change", update);
    return () => {
      window.removeEventListener("resize", update);
      media.removeEventListener("change", update);
    };
  }, [override]);

  return kind;
}
