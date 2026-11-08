import type { ButtonHTMLAttributes, HTMLAttributes } from "react";
import { materialAttributes, type MaterialAppearance } from "../s19/material.js";
import "../s19/material-components.css";
import "./ui/component-motion.css";

export function Card({
  children,
  className = "",
  appearance,
  ...props
}: HTMLAttributes<HTMLElement> & {
  readonly appearance?: MaterialAppearance;
}): React.JSX.Element {
  return (
    <section
      {...props}
      {...materialAttributes("display", appearance)}
      className={`lv-material lv-material-effects rounded-card border border-line bg-surface p-6 shadow-card ${className}`}
    >
      {appearance?.finish === "glazed" ? <span className="lv-porcelain-window" aria-hidden="true" /> : null}{children}
    </section>
  );
}

/** 可点击卡片是真按钮。包含输入/编辑按钮的卡片用 Card，不能嵌套按钮。 */
export function ActionCard({ appearance, className = "", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { appearance?: MaterialAppearance }) {
  return <button type="button" {...props} {...materialAttributes("interactive", appearance)} className={`lv-material lv-material-effects lv-press w-full rounded-card border border-line bg-surface p-6 text-start text-ink shadow-card outline-none focus-visible:ring-4 focus-visible:ring-focus-ring disabled:opacity-45 ${className}`}>
    {appearance?.finish === "glazed" ? <span className="lv-porcelain-window" aria-hidden="true" /> : null}{children}
  </button>;
}
