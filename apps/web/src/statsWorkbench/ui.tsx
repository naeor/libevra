/**
 * 工作台共用的小部件：图标、精确金额格式化、按真实宽高的密度档。
 *
 * 金额一律从「整数最小单位的十进制字符串」直接格式化（BigInt），**不经过 Number**——
 * 卡片规格 §5.5：大金额不得为了显示损失精度。颜色只用语义 token（currentColor），不写色值。
 */
import { useEffect, useLayoutEffect, useRef, useState, type SVGProps } from "react";
import { decimalsFor, type Ratio } from "@libellum/shared";

import { currencySymbol, numberSeparators } from "../lib/format.js";
import { formalChartFamily } from "./catalog.js";

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

const AMOUNT_STEPS = ["text-2xl", "text-xl", "text-lg", "text-base", "text-sm"] as const;

/**
 * 卡片里的大号金额：**始终一行**，放不下就逐级缩小字号（2xl → sm），仍放不下才省略。
 * 最后一级 sm 只在组合卡片的窄数字列（3–4 个数字并排）里才会用到。
 * 窄屏（320px）的 1×1 卡片里，「¥12,500.00」折成两行会被误读成两个数。
 */
export function FitAmount({
  text,
  start = 0,
  className = "",
}: {
  readonly text: string;
  readonly start?: number;
  readonly className?: string;
}): React.JSX.Element {
  const ref = useRef<HTMLParagraphElement | null>(null);
  const [step, setStep] = useState(start);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect !== undefined) setWidth(Math.round(rect.width));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  // 文字或可用宽度变了：从最大字号重新试。
  useLayoutEffect(() => {
    setStep(start);
  }, [text, width, start]);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    // 严格比较：截断样式下多出 1px 也会出现省略号（1.17.10 浏览器验收发现 ¥14,222.41 被截成「¥14,222....」）。
    if (element.scrollWidth > element.clientWidth && step < AMOUNT_STEPS.length - 1) setStep(step + 1);
  }, [step, text, width]);

  return (
    <p ref={ref} title={text} className={`sw-amount truncate font-semibold tabular-nums ${AMOUNT_STEPS[Math.min(step, AMOUNT_STEPS.length - 1)]} ${className}`}>
      {text}
    </p>
  );
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
  // 先取绝对值再半入（远离零）：BigInt 除法向零截断，直接对负数做「+0.5 再除」会把 −50% 显示成 −49.9%。
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDenominator = denominator < 0n ? -denominator : denominator;
  const abs = (absNumerator * 2000n + absDenominator) / (absDenominator * 2n);
  const negative = (numerator < 0n) !== (denominator < 0n) && abs !== 0n;
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

/** 图标按当前 chartFamily 的正式归属选取；未知家族保留通用只读卡片图标。 */
export function ChartGlyph({ family, ...props }: IconProps & { readonly family: string }): React.JSX.Element {
  const formal = formalChartFamily(family);
  const paths: Readonly<Record<string, string>> = {
    "CF-A01": "M5 5h14v14H5V5Zm3 5h3m-1.5-1.5v3M14 10h3M8 15h3m3 0h3",
    "CF-A02": "M5 19V9h4v10m3 0V4h4v15M3 19h18m-7-15 2-2 2 2",
    "CF-A03": "M12 3v9h9A9 9 0 0 0 12 3Zm-3 1.5A9 9 0 1 0 19.5 15H9V4.5Z",
    "CF-A04": "M4 5h15v3H4V5Zm0 6h11v3H4v-3Zm0 6h7v3H4v-3Z",
    "CF-A05": "M3 8h18v8H3V8Zm6 0v8m6-8v8",
    "CF-A06": "M12 3v18M4 7h8v4H4V7Zm8 6h8v4h-8",
    "CF-A07": "M3 4h18v16H3V4Zm0 5h18M3 14h18M9 4v16",
    "CF-B01": "M3 4v16h18M6 15l4-5 4 3 6-8",
    "CF-B02": "M3 4v16h18M6 18v-3l4-5 4 3 6-8v13H6Z",
    "CF-B03": "M3 20h18M6 17v-5h3v5H6Zm5 0V7h3v10h-3Zm5 0V3h3v14h-3Z",
    "CF-B04": "M3 20h18M5 17V8h3v9H5Zm4 0v-5h3v5H9Zm5 0V4h3v13h-3Zm4 0V9h3v8h-3Z",
    "CF-B05": "M4 20h16M5 18V9h5v9H5Zm0-4h5m4 2V4h5v14h-5Zm0-7h5",
    "CF-B06": "M3 5h18v14H3V5Zm0 6 6-2 6 4 6-2M9 5v14m6-14v14",
    "CF-B08": "M4 5h16v15H4V5Zm3-2v4m10-4v4M4 10h16M8 13h1m4 0h1m-6 4h1m4 0h1m4-4h1",
    "CF-B09": "M3 20h18M5 17V9m3 8V6m3 11V3m3 14v-6m3 6V8m3 9v-4",
    "CF-B10": "M4 6h16v4H4V6Zm0 8h11v4H4v-4m14 0v5m-2-2 2 2 2-2",
    "CF-B11": "M3 4v16h18M5 17h4v-4h5V9h4V4h3",
    // ---- S17-C 专业图形（1.17.10） ----
    "CF-C01": "M4 5h16M4 10h16M4 15h16M4 20h16M8 3v18",
    "CF-C02": "M12 3v18M12 6H6v4h6m0 4h7v4h-7",
    "CF-C03": "M3 20h18M5 20v-8h3v8m2-8V7h3v5m2 0v-3h3v11",
    "CF-C04": "M3 20h18M5 17V6h3v11H5Zm5 0V10h3v7h-3Zm5 0v-4h3v4h-3ZM6 6l5 3 5 2 4 1",
    "CF-C05": "M3 20h18M4 17v-3h3v3m0 0v-8h3v8m0 0V5h3v12m0 0v-6h3v6m0 0v-2h3v2",
    "CF-C06": "M12 3v4m0 10v4M7 7h10v10H7V7Zm0 5h10",
    "CF-C08": "M3 4h18v16H3V4Zm6 0v16m6-16v16M3 9h18M3 15h18",
    "CF-C09": "M3 20h18M6 17v-4h3v4m0-4V8h-3v5m8 4v-6h3v6m0-6V5h-3v6",
    "CF-C11": "M3 4h18v16H3V4Zm9 0v16M3 13h9m3 0v7m0-7h6",
    "CF-C13": "M4 7h4l4 5h4l4-6M4 12h4l4-5h4l4 10M4 17h4l4 0h4",
    "CF-C14": "M3 4v16h18M7 15h.01M10 9h.01M14 13h.01M17 7h.01M12 17h.01",
    "CF-C15": "M3 4v16h18M8 14a2 2 0 1 0 0-.01M15 8a3.5 3.5 0 1 0 0-.01M17 16a1.5 1.5 0 1 0 0-.01",
    "CF-C16": "M3 4h18v16H3V4Zm0 5h18M8 4v16m5-16v16m4-16v16",
    "CF-C17": "M3 3h8v8H3V3Zm10 0h8v8h-8V3ZM3 13h8v8H3v-8Zm10 0h8v8h-8v-8ZM4 9l3-3 3 2m4 1 3-2 3 1M4 19l3-2 3 1m4 1 3-4 3 2",
    "CF-C18": "M3 5h18v15H3V5Zm2 3h2m2 0h2m2 0h2m2 0h2M5 12h2m2 0h2m2 0h2m2 0h2M5 16h2m2 0h2m2 0h2",
    "CF-C20": "M6 4v16m12-16v16M6 8l12 4M6 14l12-6M6 18l12 0",
  };
  const path = paths[formal] ?? (formal === "CF-B07" || formal === "CF-B12" || formal === "CF-B13" || formal === "CF-B14" || formal === "CF-B15" ? paths["CF-B01"] : undefined);
  return path === undefined ? <CardGlyph {...props} /> : <Icon {...props} data-chart-family={formal} d={path} />;
}
export const CarouselGlyph = (props: IconProps) => <Icon {...props} d="M7 5h10v14H7V5ZM3.5 8v8M20.5 8v8" />;
/** 组合卡片：一张卡片里的数字与图表（与「分割卡片组」的贯穿分割线区分）。 */
export const ComposeGlyph = (props: IconProps) => <Icon {...props} d="M4 4h16v16H4V4Zm3 4h4m-4 3h4m3-3h3v6h-3V8ZM7 16l3-2 3 1 4-3" />;
export const SearchGlyph = (props: IconProps) => <Icon {...props} d="M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Zm4.6-1.9L20 20" />;
export const SwapGlyph = (props: IconProps) => <Icon {...props} d="M7 7h12l-3-3m3 3-3 3M17 17H5l3 3m-3-3 3-3" />;
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
