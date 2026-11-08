import { useRef, type ComponentProps, type HTMLAttributes } from "react";
import { materialAttributes } from "../../s19/material.js";
import { CapsuleButton } from "./PurposeControls.js";
import { useComponentFeedback } from "./ComponentMotion.js";
import "./status-controls.css";

export type StatusTone = "neutral" | "success" | "warning" | "error";
const TONES = {
  neutral: { text: "text-muted", panel: "bg-canvas text-muted", icon: "·" },
  success: { text: "text-brand-dark", panel: "bg-brand-soft text-brand-dark", icon: "✓" },
  warning: { text: "text-warn-dark", panel: "bg-warn-soft text-warn-dark", icon: "!" },
  error: { text: "text-danger", panel: "bg-danger-soft text-danger", icon: "×" },
} as const;

/** 静态状态标签不是按钮，也不主动播报。文字由业务提供，不只靠颜色表达状态。 */
export function Badge({ tone = "neutral", size = "regular", className = "", children, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: StatusTone; size?: "small" | "regular" }) {
  return <span {...props} {...materialAttributes("capsule", { shape: "pill" })} data-size={size} className={`lv-material lv-badge ${className}`}>
    <span className={TONES[tone].text}>{children}</span>
  </span>;
}

/** 独立筛选值的开/关；互斥单选优先 SegmentedControl。不决定查询/路由。 */
export function FilterChip({ selected, onSelectedChange, children, ...props }: Omit<ComponentProps<typeof CapsuleButton>, "onClick" | "aria-pressed"> & { selected: boolean; onSelectedChange: (selected: boolean) => void }) {
  return <CapsuleButton {...props} aria-pressed={selected} onClick={() => onSelectedChange(!selected)}>
    <span className="lv-chip-mark" aria-hidden="true">{selected ? "✓" : "＋"}</span>{children}
  </CapsuleButton>;
}

/** 固定状态槽：默认无入场动画；只有明确完成事件递增 completion 才播放反馈。 */
export function StatusMessage({ tone = "neutral", loading = false, completion = 0, className = "", children, ...props }: Omit<HTMLAttributes<HTMLDivElement>, "role" | "aria-live"> & { tone?: StatusTone; loading?: boolean; completion?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useComponentFeedback(ref, completion);
  return <div {...props} ref={ref} role={tone === "error" ? "alert" : "status"} aria-atomic="true" className={`lv-status-message rounded-field px-4 py-3 text-helper-relaxed ${TONES[tone].panel} ${className}`}>
    <span className="lv-status-symbol" aria-hidden="true">{loading ? <span className="lv-loading" /> : TONES[tone].icon}</span>
    <div className="min-w-0 flex-1">{children}</div>
  </div>;
}
