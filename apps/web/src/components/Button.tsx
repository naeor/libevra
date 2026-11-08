import type { ButtonHTMLAttributes } from "react";
import { materialAttributes, type MaterialAppearance } from "../s19/material.js";
import "../s19/material-components.css";
import "./ui/component-motion.css";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "danger-quiet" | "tool" | "capsule";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand text-on-brand shadow-sm hover:bg-brand-dark",
  secondary: "bg-brand-soft text-brand-dark hover:bg-brand/20",
  ghost: "bg-transparent text-muted hover:text-ink",
  tool: "bg-surface text-ink shadow-sm",
  capsule: "bg-surface text-ink shadow-sm",
  // The muted red from the palette, so it reads as "careful" without shouting.
  danger: "bg-danger text-on-danger shadow-sm hover:bg-danger-dark",
  /**
   * S16-A: a destructive *secondary* choice — red words and a thin red edge, no red fill. Used where
   * a red-filled button would outweigh the page's primary action (e.g. 标记为无效 under 保存). The same
   * look 账本设置 already used by hand for 永久删除这本账; this names it so it is not hand-copied again.
   */
  "danger-quiet": "border border-danger/40 bg-transparent text-danger hover:bg-danger-soft",
};

export function Button({
  variant = "primary",
  fullWidth = true,
  className = "",
  disabledClassName = "",
  appearance,
  motion = false,
  loading = false,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: Variant;
  readonly appearance?: MaterialAppearance;
  /** 既有业务按钮保持原动效；新标准按钮按需启用，避免双重动画。 */
  readonly motion?: boolean;
  readonly loading?: boolean;
  /**
   * Buttons stretch to fill their container by default. Width is a prop rather
   * than a class override because Tailwind resolves `w-full` vs `w-auto` by
   * stylesheet order, not by the order they appear in `className`.
   */
  readonly fullWidth?: boolean;
  /**
   * S16：覆盖禁用态外观（例：深色主按钮整体 45% 透明后文字对比度不足时，改用浅底深字）。
   * 只有传入它、且按钮确实禁用时才替换默认变体样式——不与 `disabled:opacity-45`
   * 这类伪类工具类互相覆盖，两个普通工具类的先后顺序不该被用来决定视觉。
   */
  readonly disabledClassName?: string;
}): React.JSX.Element {
  const disabled = props.disabled === true || loading;
  const disabledLook = disabled && disabledClassName !== "";
  return (
    <button
      {...props}
      {...(!disabledLook ? materialAttributes(variant, appearance) : {})}
      disabled={disabled}
      aria-busy={loading || props["aria-busy"]}
      className={`lv-material lv-material-effects ${motion ? "lv-press" : ""} inline-flex items-center justify-center gap-2 rounded-field px-4 py-3 text-button-lg font-medium transition ${
        disabledLook ? disabledClassName : `${VARIANTS[variant]} disabled:opacity-45`
      } ${disabled ? "cursor-not-allowed" : ""} ${
        fullWidth ? "w-full" : "w-auto"
      } outline-none focus-visible:ring-4 focus-visible:ring-focus-ring ${className}`}
    >
      {appearance?.finish === "glazed" ? <span className="lv-porcelain-window" aria-hidden="true" /> : null}
      {loading ? <span className="lv-loading" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
