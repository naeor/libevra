/**
 * **一条提示条的外观**（1.19.66）：图标（或前置图）＋正文＋可选第二行＋可选一个操作＋可选 ×。
 *
 * 状态不只靠颜色（WCAG 1.4.1）：四种类型的字形不同（i / ✓ / ! / ×）、读屏前缀不同（宿主负责），
 * 错误另有一圈危险色细描边。实心圆自带对比，与背后是什么无关（B2 玻璃尤其需要）。
 *
 * 外观分两层：基础外观（Original、深色、Pad、电脑版）在 `toast.css`；S19 四风格的语义材质在 `s19/toast.css`
 * ——Original / C 简洁实心面、A 用 A3 悬浮档、B1 瓷片、B2 达到操作玻璃下限的磨砂。这里只给结构与钩子
 * （`data-toast-surface`、`data-tone`、`data-phase`），不写颜色。
 */
import { useRef, type ReactNode } from "react";

import { CapsuleButton, IconButton } from "../ui/PurposeControls.js";
import { useComponentFeedback } from "../ui/ComponentMotion.js";
import type { ToastTone, ToastView } from "../../lib/toast/types.js";
import "./toast.css";
import "../../s19/toast.css";

/** 字形路径（24×24 视框）：沿用原拍照导入提示的 ✓、!、×，新增信息 i。 */
const GLYPHS: Record<ToastTone, string> = {
  info: "M12 10.8 V16.8 M12 7.3 V7.4",
  success: "M7 12.4 L10.4 15.8 L17 8.6",
  warning: "M12 6.6 V13.6 M12 17.2 V17.3",
  error: "M8.5 8.5 L15.5 15.5 M15.5 8.5 L8.5 15.5",
};

export function ToastGlyph({ tone }: { readonly tone: ToastTone }): React.JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" className="lv-toast-glyph" data-tone={tone}>
      <circle cx="12" cy="12" r="11" className="lv-toast-glyph-disc" />
      <path d={GLYPHS[tone]} className="lv-toast-glyph-mark" fill="none" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4" aria-hidden="true">
      <path d="M6 6 18 18M18 6 6 18" strokeLinecap="round" />
    </svg>
  );
}

export type ToastPhase = "enter" | "exit";

export function ToastCard({
  view,
  phase,
  closeLabel,
  onAction,
  onClose,
  onExited,
}: {
  readonly view: ToastView<ReactNode>;
  readonly phase: ToastPhase;
  readonly closeLabel: string;
  readonly onAction?: () => void;
  readonly onClose?: () => void;
  readonly onExited?: () => void;
}): React.JSX.Element {
  const body = useRef<HTMLDivElement | null>(null);
  // R2 合并（同 key 原位更新）：不重播入场，只在文字上播放一次组件“反馈”轻动效（S19 §5 Feedback）。
  // 放在正文而不是面板上：B2 面板的背景模糊在伪元素上，面板本身做透明度动画会让模糊读不到后方。
  useComponentFeedback(body, view.revision);
  const leading = view.leading !== undefined && view.leading !== null;
  const controls = view.action !== undefined || view.closable;
  return (
    <div
      className="lv-toast shadow-lg"
      data-toast-surface=""
      data-tone={view.tone}
      data-phase={phase}
      data-echo={view.echo ? "" : undefined}
      data-controls={controls ? "" : undefined}
      inert={phase === "exit" || undefined}
      onAnimationEnd={(event) => {
        if (phase === "exit" && event.target === event.currentTarget) onExited?.();
      }}
    >
      <span className="lv-toast-mark" data-leading={leading ? "" : undefined} aria-hidden="true">
        {leading ? view.leading : <ToastGlyph tone={view.tone} />}
      </span>
      <div ref={body} className="lv-toast-body">
        <p className="lv-toast-text">{view.text}</p>
        {view.detail === undefined || view.detail === "" ? null : <p className="lv-toast-detail">{view.detail}</p>}
      </div>
      {view.action === undefined ? null : (
        <CapsuleButton className="lv-toast-action" onClick={onAction}>
          {view.action.label}
        </CapsuleButton>
      )}
      {view.closable ? (
        <IconButton label={closeLabel} className="lv-toast-close" appearance={{ elevation: "flat" }} onClick={onClose}>
          <CloseGlyph />
        </IconButton>
      ) : null}
    </div>
  );
}
