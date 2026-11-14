import { useRef } from "react";
import { useMountReveal } from "./ui/ComponentMotion.js";

type Tone = "error" | "info" | "success";

const TONES: Record<Tone, string> = {
  error: "bg-danger-soft text-danger",
  info: "bg-brand-soft text-brand-dark",
  success: "bg-brand-soft text-brand-dark",
};

export function Alert({
  tone = "error",
  children,
}: {
  readonly tone?: Tone;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  // 1.19.76：之后才出现的提示展开到位（页面转场中随页面一起出现的不做），见 ComponentMotion `useMountReveal`。
  useMountReveal(ref);
  return (
    <div ref={ref} role="status" className={`rounded-field px-4 py-3 text-body-relaxed ${TONES[tone]}`}>
      {children}
    </div>
  );
}
