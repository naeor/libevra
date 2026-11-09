import { type ComponentProps, type ReactNode } from "react";
import { Button } from "../Button.js";
import { SlidingSelection } from "./SlidingSelection.js";
import "./purpose-controls.css";

type ControlProps = Omit<ComponentProps<typeof Button>, "variant" | "fullWidth">;
/** 44px 点击区；标签由实际用途提供，不把图标字符当成可访问名称。 */
export function IconButton({ label, appearance, className = "", ...props }: ControlProps & { label: string }) {
  return <Button type="button" {...props} variant="tool" fullWidth={false} motion aria-label={label} appearance={{ ...appearance, shape: "circle" }} className={`lv-icon-button ${className}`} />;
}
/**
 * 导航辅助/筛选胶囊，不读路由、不控制显示时机，也不提供独立背景模糊。
 * 互斥筛选（一组里只有一个生效）用 `aria-pressed`；`compact` 是筛选行的辅助字号（1.19.52）。
 */
export function CapsuleButton({ icon, size = "regular", children, appearance, className = "", ...props }: ControlProps & { icon?: ReactNode; size?: "regular" | "compact" }) {
  return <Button type="button" {...props} variant="capsule" fullWidth={false} motion appearance={{ ...appearance, shape: "pill" }} data-size={size} className={`lv-capsule-button ${className}`}>
    {icon ? <span aria-hidden="true">{icon}</span> : null}<span className="min-w-0 truncate">{children}</span>
  </Button>;
}
/** 原生按钮键盘行为；只由 checked 的变化驱动 Select，不在挂载时播放。 */
export function Switch({ checked, onCheckedChange, children, ...props }: Omit<ControlProps, "onClick" | "role" | "aria-checked"> & { checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return <Button type="button" {...props} variant="ghost" role="switch" aria-checked={checked} fullWidth={false} onClick={() => onCheckedChange(!checked)}>
    <span aria-hidden="true" className="lv-toggle-track" />{children}
  </Button>;
}

/** 固定选项的单选组，复用已确认的滑动胶囊；不额外叠加 Select 动画。 */
export function SegmentedControl<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: readonly { value: T; label: string; disabled?: boolean }[]; onChange: (value: T) => void;
}) {
  return <SlidingSelection role="group" aria-label={label} className="lv-segmented">
    {options.map(option => <button key={option.value} type="button" disabled={option.disabled} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}
  </SlidingSelection>;
}
