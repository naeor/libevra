/**
 * 工作台共用的小部件：图标、精确金额格式化、按真实宽高的密度档。
 *
 * 金额一律从「整数最小单位的十进制字符串」直接格式化（BigInt），**不经过 Number**——
 * 卡片规格 §5.5：大金额不得为了显示损失精度。颜色只用语义 token（currentColor），不写色值。
 */
import { useEffect, useRef, useState, type SVGProps } from "react";
import { decimalsFor, type Ratio } from "@libellum/shared";

import { currencySymbol, numberSeparators } from "../lib/format.js";

/** 按卡片**自身内容盒**的宽高定档（卡片规格 §5.1：不按屏幕或列数）。阈值是原型候选。 */
export type Density = "compact" | "medium" | "expanded";

export function densityFor(width: number, height: number): Density {
  if (width >= 300 && height >= 200) return "expanded";
  if (width >= 200 && height >= 120) return "medium";
  return "compact";
}

export function useElementSize<T extends HTMLElement>(): {
  readonly ref: React.RefObject<T | null>;
  readonly width: number;
  readonly height: number;
} {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect !== undefined) setSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  return { ref, ...size };
}

function groupThousands(digits: string, group: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, group);
}

/** `"123456"` 分 + CNY → `¥1,234.56`（负数带 `−`）。不认识的输入显示 `—`，不猜。 */
export function moneyText(amountMinor: string, currency: string, options: { readonly withCode?: boolean } = {}): string {
  if (!/^-?\d+$/.test(amountMinor)) return "—";
  const decimals = decimalsFor(currency);
  const negative = amountMinor.startsWith("-");
  const digits = amountMinor.replace(/^-/, "").padStart(decimals + 1, "0");
  const whole = decimals === 0 ? digits : digits.slice(0, -decimals);
  const fraction = decimals === 0 ? "" : digits.slice(-decimals);
  const { group, decimal } = numberSeparators();
  const body = `${currencySymbol(currency)}${groupThousands(whole.replace(/^0+(?=\d)/, ""), group)}${fraction ? decimal + fraction : ""}`;
  return `${negative ? "−" : ""}${body}${options.withCode === true ? ` ${currency}` : ""}`;
}

/**
 * 精确平均值（分子/分母，单位为最小单位）四舍五入到最小单位后显示——**只在显示层取整**
 * （S-01 §16：结果本身保持精确）。
 */
export function exactMoneyText(numeratorMinor: string, denominator: string, currency: string): string {
  const numerator = BigInt(numeratorMinor);
  const divisor = BigInt(denominator);
  if (divisor === 0n) return "—";
  const negative = numerator < 0n !== divisor < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = divisor < 0n ? -divisor : divisor;
  const rounded = (n * 2n + d) / (d * 2n);
  return moneyText(`${negative && rounded !== 0n ? "-" : ""}${rounded.toString()}`, currency);
}

/** 精确比例 → 百分数文本（显示取一位小数）。 */
export function ratioPercentText(ratio: Ratio): string {
  const numerator = BigInt(ratio.numerator);
  const denominator = BigInt(ratio.denominator);
  if (denominator === 0n) return "—";
  const tenths = (numerator * 2000n + denominator) / (denominator * 2n);
  const negative = tenths < 0n;
  const abs = negative ? -tenths : tenths;
  const { decimal } = numberSeparators();
  return `${negative ? "−" : ""}${(abs / 10n).toString()}${decimal}${(abs % 10n).toString()}%`;
}

/** 0–1 的比例，只用于绘图（ACC-05：比例才允许转成 number）。 */
export function ratioFraction(ratio: Ratio | null): number {
  if (ratio === null) return 0;
  const denominator = Number(ratio.denominator);
  return denominator === 0 ? 0 : Number(ratio.numerator) / denominator;
}

/** 图表纵轴的简短刻度（同一数量级，只用于轴，不用于读数）。 */
export function axisMoney(value: number, currency: string): string {
  const units = value / 10 ** decimalsFor(currency);
  const abs = Math.abs(units);
  if (abs >= 1_000_000) return `${(units / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${(units / 1_000).toFixed(0)}k`;
  if (abs >= 1_000) return `${(units / 1_000).toFixed(1)}k`;
  return units.toFixed(0);
}

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ d, ...props }: IconProps & { readonly d: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d={d} />
    </svg>
  );
}

export const FunnelIcon = (props: IconProps) => <Icon {...props} d="M4 5h16l-6.2 7.2V18l-3.6 1.8v-7.6L4 5Z" />;
export const PencilIcon = (props: IconProps) => <Icon {...props} d="m4.5 15.5-.9 4.9 4.9-.9L19 9l-4-4L4.5 15.5ZM13.5 6.5l4 4" />;
export const UndoIcon = (props: IconProps) => <Icon {...props} d="M9 7 4.5 11.5 9 16M5 11.5h9.5a5 5 0 0 1 0 10H12" />;
export const RedoIcon = (props: IconProps) => <Icon {...props} d="m15 7 4.5 4.5L15 16m4-4.5H9.5a5 5 0 0 0 0 10H12" />;
export const CardGlyph = (props: IconProps) => <Icon {...props} d="M4 5h16v14H4V5Zm4 10v1m4-5v5m4-8v8" />;
export const CarouselGlyph = (props: IconProps) => <Icon {...props} d="M7 5h10v14H7V5ZM3.5 8v8M20.5 8v8" />;
export const SplitGlyph = (props: IconProps) => <Icon {...props} d="M4 4h16v16H4V4Zm8 0v16M4 12h16" />;
export const SpacerGlyph = (props: IconProps) => <Icon {...props} d="M4 8V4h4m8 0h4v4m0 8v4h-4m-8 0H4v-4" />;
export const GridGlyph = (props: IconProps) => <Icon {...props} d="M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z" />;
export const MoveGlyph = (props: IconProps) => <Icon {...props} d="M12 3v18M3 12h18M12 3 9.5 5.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5" />;
export const ResizeGlyph = (props: IconProps) => <Icon {...props} d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />;
export const TrashGlyph = (props: IconProps) => <Icon {...props} d="M5 7h14M10 7V4.5h4V7m-7.5 0 1 13h9l1-13M10 11v6m4-6v6" />;
export const DuplicateGlyph = (props: IconProps) => <Icon {...props} d="M8 8h11v12H8V8Zm-3 8V4h11" />;
export const SlidersGlyph = (props: IconProps) => <Icon {...props} d="M5 7h9m4 0h1M5 17h3m4 0h7M16 5v4M10 15v4" />;
export const EnterGlyph = (props: IconProps) => <Icon {...props} d="M10 7H5v12h12v-5M13 4h7v7M20 4l-9 9" />;
export const ChevronUp = (props: IconProps) => <Icon {...props} d="m6 15 6-6 6 6" />;
export const ChevronDown = (props: IconProps) => <Icon {...props} d="m6 9 6 6 6-6" />;
export const ChevronLeft = (props: IconProps) => <Icon {...props} d="m15 6-6 6 6 6" />;
export const ChevronRight = (props: IconProps) => <Icon {...props} d="m9 6 6 6-6 6" />;
export const PlusGlyph = (props: IconProps) => <Icon {...props} d="M12 5v14M5 12h14" />;
export const XGlyph = (props: IconProps) => <Icon {...props} d="M6 6l12 12M18 6 6 18" />;
