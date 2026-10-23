import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "danger-quiet";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand text-white shadow-sm hover:bg-brand-dark",
  secondary: "bg-brand-soft text-brand-dark hover:bg-brand-soft/70",
  ghost: "bg-transparent text-muted hover:text-ink",
  // The muted red from the palette, so it reads as "careful" without shouting.
  danger: "bg-danger text-white shadow-sm hover:bg-danger-dark",
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
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: Variant;
  /**
   * Buttons stretch to fill their container by default. Width is a prop rather
   * than a class override because Tailwind resolves `w-full` vs `w-auto` by
   * stylesheet order, not by the order they appear in `className`.
   */
  readonly fullWidth?: boolean;
}): React.JSX.Element {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-field px-4 py-3 text-button-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-45 ${
        fullWidth ? "w-full" : "w-auto"
      } outline-none focus-visible:ring-4 focus-visible:ring-brand-soft ${VARIANTS[variant]} ${className}`}
    />
  );
}
