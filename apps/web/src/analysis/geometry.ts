/**
 * 纯几何布局（C-1 草案，web 侧）。
 *
 * 只接收**已归一化的 number**（0..1 / -1..1）与像素尺寸，返回 SVG 坐标。
 * 不做任何财务计算：金额 → 归一化在适配层完成（bigint 有理数 → number 仅用于坐标），
 * 这里只负责「摆在哪里、多宽多高」。这样几何层可脱离 DOM 单测，也不会把
 * 「金额权威」偷偷搬到 web。
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface LayoutBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface BarLayoutOptions {
  readonly width: number;
  readonly height: number;
  /** 间隙占每个槽位的比例；0 表示无间隙。 */
  readonly gapRatio?: number;
}

export interface BarSegment {
  readonly index: number;
  readonly box: LayoutBox;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function assertPositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number, received: ${String(value)}`);
  }
}

/**
 * 纵向柱状布局：第 i 个柱的高度 = fraction × height，从左到右排列。
 *
 * fractions 已由适配层归一化到 0..1（0 表示无值，画零高柱，不画成缺失）。
 */
export function computeBarLayout(
  fractions: readonly number[],
  options: BarLayoutOptions,
): readonly BarSegment[] {
  assertPositive(options.width, "width");
  assertPositive(options.height, "height");

  const gapRatio = options.gapRatio ?? 0.2;
  const count = fractions.length;
  if (count === 0) return [];

  const slot = options.width / count;
  const gap = slot * gapRatio;
  const barWidth = Math.max(0, slot - gap);

  return fractions.map((rawFraction, index) => {
    const fraction = clamp01(rawFraction);
    const barHeight = fraction * options.height;

    return {
      index,
      box: {
        x: index * slot + gap / 2,
        y: options.height - barHeight,
        width: barWidth,
        height: barHeight,
      },
    };
  });
}

export interface DivergingLayoutOptions extends BarLayoutOptions {
  /** 零轴线在宽度上的位置比例（默认 0.5，即居中）。 */
  readonly pivotRatio?: number;
}

/**
 * 发散条布局：fraction ∈ [-1,1]，0 在零轴上，正数向右、负数向左。
 *
 * 只有「比例」参与几何；符号方向来自适配层给出的权威 delta 符号。
 */
export function computeDivergingLayout(
  fractions: readonly number[],
  options: DivergingLayoutOptions,
): readonly BarSegment[] {
  assertPositive(options.width, "width");
  assertPositive(options.height, "height");

  const gapRatio = options.gapRatio ?? 0.2;
  const pivotRatio = options.pivotRatio ?? 0.5;
  if (pivotRatio <= 0 || pivotRatio >= 1) {
    throw new RangeError(`pivotRatio must be between 0 and 1, received: ${String(pivotRatio)}`);
  }

  const count = fractions.length;
  if (count === 0) return [];

  const pivotX = options.width * pivotRatio;
  const slot = options.height / count;
  const gap = slot * gapRatio;
  const barHeight = Math.max(0, slot - gap);
  const halfWidth = Math.min(pivotX, options.width - pivotX);

  return fractions.map((rawFraction, index) => {
    const fraction = Number.isFinite(rawFraction) ? Math.max(-1, Math.min(1, rawFraction)) : 0;
    const barWidth = Math.abs(fraction) * halfWidth;

    return {
      index,
      box: {
        x: fraction >= 0 ? pivotX : pivotX - barWidth,
        y: index * slot + gap / 2,
        width: barWidth,
        height: barHeight,
      },
    };
  });
}

export interface WaterfallStepLayout {
  readonly index: number;
  readonly box: LayoutBox;
  /** 该步相对零轴的方向（由适配层的权威 delta 决定）。 */
  readonly direction: "increase" | "decrease" | "flat";
}

export interface WaterfallLayoutOptions {
  readonly width: number;
  readonly height: number;
  readonly gapRatio?: number;
}

/**
 * 瀑布图布局：每一步给出 `startFraction` / `endFraction`（相对同一缩放轴）。
 *
 * 注意：这里不判断「增加还是减少」，direction 由调用方从权威 delta 传入。
 */
export function computeWaterfallLayout(
  steps: readonly {
    readonly startFraction: number;
    readonly endFraction: number;
    readonly direction: "increase" | "decrease" | "flat";
  }[],
  options: WaterfallLayoutOptions,
): readonly WaterfallStepLayout[] {
  assertPositive(options.width, "width");
  assertPositive(options.height, "height");

  const gapRatio = options.gapRatio ?? 0.24;
  const count = steps.length;
  if (count === 0) return [];

  const slot = options.width / count;
  const gap = slot * gapRatio;
  const barWidth = Math.max(0, slot - gap);

  return steps.map((step, index) => {
    const start = clamp01(step.startFraction);
    const end = clamp01(step.endFraction);
    const topFraction = Math.max(start, end);
    const bottomFraction = Math.min(start, end);
    const topY = options.height * (1 - topFraction);
    const bottomY = options.height * (1 - bottomFraction);

    return {
      index,
      box: {
        x: index * slot + gap / 2,
        y: topY,
        width: barWidth,
        height: Math.max(0, bottomY - topY),
      },
      direction: step.direction,
    };
  });
}

export interface HistogramLayoutOptions {
  readonly width: number;
  readonly height: number;
  readonly gapRatio?: number;
}

/** 直方图：高度 = count/maxCount；相邻柱通常无间隙（gapRatio 默认 0.08）。 */
export function computeHistogramLayout(
  countFractions: readonly number[],
  options: HistogramLayoutOptions,
): readonly BarSegment[] {
  return computeBarLayout(countFractions, { ...options, gapRatio: options.gapRatio ?? 0.08 });
}

export interface ParetoPointLayout {
  readonly points: readonly Point[];
}

/**
 * 帕累托累计曲线：x 轴按分类数量均分，y 轴 = 累计占比。
 *
 * 单点时返回水平线段（避免空折线不可见）。
 */
export function computeParetoPoints(
  cumulativeFractions: readonly number[],
  options: { readonly width: number; readonly height: number },
): readonly Point[] {
  assertPositive(options.width, "width");
  assertPositive(options.height, "height");

  const fractions = cumulativeFractions.map(clamp01);
  if (fractions.length === 0) return [];
  if (fractions.length === 1) {
    const only = fractions[0] as number;
    return [
      { x: 0, y: options.height * (1 - only) },
      { x: options.width, y: options.height * (1 - only) },
    ];
  }

  const step = options.width / (fractions.length - 1);

  return fractions.map((fraction, index) => ({
    x: step * index,
    y: options.height * (1 - fraction),
  }));
}

export interface BoxplotGeometryInput {
  readonly min: number;
  readonly q1: number;
  readonly median: number;
  readonly q3: number;
  readonly max: number;
  readonly lowerFence: number;
  readonly upperFence: number;
  readonly outliers: readonly number[];
}

export interface BoxplotLayout {
  /** 数值 → y 坐标的换算（domain 已含围栏与异常值，保证所有元素都在画布内）。 */
  readonly domainMin: number;
  readonly domainMax: number;
  readonly axis: {
    readonly minY: number;
    readonly q1Y: number;
    readonly medianY: number;
    readonly q3Y: number;
    readonly maxY: number;
    readonly lowerWhiskerY: number;
    readonly upperWhiskerY: number;
  };
  readonly outlierYs: readonly number[];
  readonly bodyX: number;
  readonly bodyWidth: number;
  readonly centerX: number;
}

/**
 * 箱线图几何：以 min/max/围栏/异常值确定 domain，输出线/箱的像素坐标。
 *
 * 须线端点取「围栏内最远值」：这里是 min/max 与围栏的交集，由调用方传入
 * （shared 的 fences 已给出围栏；语义由数学层决定，几何只摆位置）。
 */
export function computeBoxplotLayout(
  input: BoxplotGeometryInput,
  options: { readonly width: number; readonly height: number; readonly padding?: number; readonly bodyRatio?: number },
): BoxplotLayout {
  assertPositive(options.width, "width");
  assertPositive(options.height, "height");

  const padding = options.padding ?? 12;
  const bodyRatio = options.bodyRatio ?? 0.5;
  if (bodyRatio <= 0 || bodyRatio > 1) {
    throw new RangeError(`bodyRatio must be between 0 and 1, received: ${String(bodyRatio)}`);
  }

  const candidates = [input.min, input.max, input.lowerFence, input.upperFence, ...input.outliers];
  const domainMin = Math.min(...candidates);
  const domainMax = Math.max(...candidates);
  const span = domainMax - domainMin;
  const drawableHeight = Math.max(1, options.height - padding * 2);

  const toY = (value: number): number => {
    if (span === 0) return options.height / 2;
    const fraction = (value - domainMin) / span;
    return padding + (1 - fraction) * drawableHeight;
  };

  const bodyWidth = options.width * bodyRatio;

  return {
    domainMin,
    domainMax,
    axis: {
      minY: toY(input.min),
      q1Y: toY(input.q1),
      medianY: toY(input.median),
      q3Y: toY(input.q3),
      maxY: toY(input.max),
      lowerWhiskerY: toY(Math.min(input.lowerFence, input.min)),
      upperWhiskerY: toY(Math.max(input.upperFence, input.max)),
    },
    outlierYs: input.outliers.map(toY),
    bodyX: (options.width - bodyWidth) / 2,
    bodyWidth,
    centerX: options.width / 2,
  };
}
