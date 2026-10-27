/**
 * Agent C · C-2 第二批（P12–P15 / P21）共用记录与维度工具（DRAFT，未冻结）。
 *
 * 维度键与标签规则集中在本文件：展示层不得自行拼接月份 / ISO 周 / 星期 /
 * 支付方式键，否则会出现「同一分类两个键」这类口径漂移（owner 规格 §5 可比性）。
 *
 * 时间维度只覆盖「月 / ISO 周 / 星期」这些交叉分析需要的桶，不复刻 Agent B 的
 * 完整时间轴（B 在 `packages/shared/src/timeCalendar.ts`，C 分支上没有该文件）。
 * 待 S-01 v2 定稿后，时间桶键应改为复用 B 的 timeCalendar；该映射登记为 QC-26/27。
 *
 * 记录形状是 C 的**内部输入**（不是公共协议）：只含计算必需字段，金额为币种最小
 * 单位的 `bigint`，方向由 `kind` 表达（金额本身不得为负）。
 */

export interface AdvancedRecord {
  readonly id: string;
  readonly kind: "expense" | "income";
  readonly amountMinor: bigint;
  readonly currency: string;
  /** 业务日期（首次记账时记录的本地日期），格式 `YYYY-MM-DD`。 */
  readonly occurredLocalDate: string;
  readonly categoryId: string;
  readonly categoryLabel: string;
  readonly paymentMethodId: string | null;
  readonly paymentMethodLabel: string | null;
}

export type AdvancedDimension =
  | "category"
  | "paymentMethod"
  | "kind"
  | "currency"
  | "month"
  | "week"
  | "weekday";

export const ADVANCED_DIMENSIONS: readonly AdvancedDimension[] = [
  "category",
  "paymentMethod",
  "kind",
  "currency",
  "month",
  "week",
  "weekday",
];

/** 支付方式缺失的显式键；不得与真实支付方式键冲突（真实键是 UUID）。 */
export const UNSPECIFIED_PAYMENT_METHOD_KEY = "__unspecified__";
export const UNSPECIFIED_PAYMENT_METHOD_LABEL = "未指定";

/** 周一起始（owner 2026-10-27 决定 Q-07）；索引 0 = 周一。 */
export const WEEKDAY_LABELS: readonly string[] = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MILLISECONDS_PER_DAY = 86_400_000;

export function isAdvancedDimension(value: string): value is AdvancedDimension {
  return (ADVANCED_DIMENSIONS as readonly string[]).includes(value);
}

/** @throws {RangeError} 非 `YYYY-MM-DD` 或不是真实存在的日历日期。 */
export function parseCalendarDate(date: string): { year: number; month: number; day: number } {
  const match = CALENDAR_DATE_PATTERN.exec(date);
  if (match === null) {
    throw new RangeError(`occurredLocalDate must be YYYY-MM-DD, received: ${date}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));

  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new RangeError(`occurredLocalDate is not a real calendar date: ${date}`);
  }

  return { year, month, day };
}

export function utcDateOf(date: string): Date {
  const { year, month, day } = parseCalendarDate(date);
  return new Date(Date.UTC(year, month - 1, day));
}

/** ISO 星期：周一 = 1 … 周日 = 7。 */
export function isoWeekday(date: string): number {
  const day = utcDateOf(date).getUTCDay();
  return day === 0 ? 7 : day;
}

/** ISO 周键 `YYYY-Www`（周一起始；跨年周归属按 ISO 规则）。 */
export function isoWeekKey(date: string): string {
  const probe = utcDateOf(date);
  const isoDay = probe.getUTCDay() === 0 ? 7 : probe.getUTCDay();
  probe.setUTCDate(probe.getUTCDate() + 4 - isoDay);

  const isoYear = probe.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const week = Math.ceil(((probe.getTime() - yearStart) / MILLISECONDS_PER_DAY + 1) / 7);
  return `${String(isoYear)}-W${String(week).padStart(2, "0")}`;
}

export function monthKeyOf(date: string): string {
  parseCalendarDate(date);
  return date.slice(0, 7);
}

/** 维度键：唯一且稳定（同键必须同语义）。 */
export function dimensionKeyOf(record: AdvancedRecord, dimension: AdvancedDimension): string {
  switch (dimension) {
    case "category":
      return record.categoryId;
    case "paymentMethod":
      return record.paymentMethodId ?? UNSPECIFIED_PAYMENT_METHOD_KEY;
    case "kind":
      return record.kind;
    case "currency":
      return record.currency;
    case "month":
      return monthKeyOf(record.occurredLocalDate);
    case "week":
      return isoWeekKey(record.occurredLocalDate);
    case "weekday":
      return String(isoWeekday(record.occurredLocalDate));
    default:
      throw new RangeError(`unsupported dimension: ${String(dimension)}`);
  }
}

/** 维度键 → 展示标签；缺失支付方式落「未指定」，不得写成空串。 */
export function dimensionLabelOf(record: AdvancedRecord, dimension: AdvancedDimension): string {
  switch (dimension) {
    case "category":
      return record.categoryLabel;
    case "paymentMethod":
      return record.paymentMethodLabel ?? UNSPECIFIED_PAYMENT_METHOD_LABEL;
    case "kind":
      return record.kind === "expense" ? "支出" : "收入";
    case "currency":
      return record.currency;
    case "month": {
      const month = Number(record.occurredLocalDate.slice(5, 7));
      return `${String(month)}月`;
    }
    case "week":
      return isoWeekKey(record.occurredLocalDate);
    case "weekday": {
      const weekday = isoWeekday(record.occurredLocalDate);
      return WEEKDAY_LABELS[weekday - 1] ?? `星期${String(weekday)}`;
    }
    default:
      throw new RangeError(`unsupported dimension: ${String(dimension)}`);
  }
}

/** 确定性的键排序：时间升序 → 星期 1..7 → 其余按标签、键升序。 */
export function sortDimensionKeys(
  dimension: AdvancedDimension,
  keys: readonly string[],
  labels: ReadonlyMap<string, string>,
): string[] {
  const sorted = [...keys];

  sorted.sort((left, right) => {
    if (dimension === "weekday") {
      return Number(left) - Number(right);
    }
    if (dimension === "month" || dimension === "week") {
      return left < right ? -1 : left > right ? 1 : 0;
    }
    if (dimension === "kind") {
      const order = (key: string): number => (key === "expense" ? 0 : 1);
      return order(left) - order(right);
    }

    const leftLabel = labels.get(left) ?? left;
    const rightLabel = labels.get(right) ?? right;
    if (leftLabel !== rightLabel) return leftLabel < rightLabel ? -1 : 1;
    return left < right ? -1 : left > right ? 1 : 0;
  });

  return sorted;
}

export interface CollectedDimension {
  readonly values: readonly string[];
  readonly labels: ReadonlyMap<string, string>;
}

/** 从记录中收集某维度的全部键与标签（不依赖记录顺序）。 */
export function collectDimensionValues(
  records: readonly AdvancedRecord[],
  dimension: AdvancedDimension,
): CollectedDimension {
  const labels = new Map<string, string>();

  for (const record of records) {
    const key = dimensionKeyOf(record, dimension);
    if (!labels.has(key)) labels.set(key, dimensionLabelOf(record, dimension));
  }

  return { values: sortDimensionKeys(dimension, [...labels.keys()], labels), labels };
}

/** 币种集合；用于「不同原币不得混加」的守卫。 */
export function currenciesOf(records: readonly AdvancedRecord[]): readonly string[] {
  return [...new Set(records.map((record) => record.currency))].sort();
}

/**
 * 金额类指标的原币守卫：跨币种且币种不在维度里 → 直接拒绝（不得先加再说明）。
 *
 * @throws {RangeError} 涉及金额的统计里出现多个原币。
 */
export function assertSingleCurrencyUnlessDimension(
  records: readonly AdvancedRecord[],
  dimensions: readonly AdvancedDimension[],
  metricNeedsMoney: boolean,
): void {
  if (!metricNeedsMoney) return;
  const currencies = currenciesOf(records);
  if (currencies.length <= 1) return;
  if (dimensions.includes("currency")) return;
  throw new RangeError(
    `mixed original currencies (${currencies.join(", ")}) cannot be summed; add the currency dimension or filter to one currency`,
  );
}

/** 非负金额 + 合法日期的记录守卫（跨模块复用）。 */
export function assertRecordShape(record: AdvancedRecord): void {
  if (record.amountMinor < 0n) {
    throw new RangeError(`amountMinor must be non-negative (use kind to express direction): ${record.id}`);
  }
  parseCalendarDate(record.occurredLocalDate);
}
