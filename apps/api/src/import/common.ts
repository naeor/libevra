import { createHash } from "node:crypto";

import { decimalsFor, matchCategory } from "@libellum/shared";

import type { CategoryOption, PaymentMethodOption } from "./types.js";

/** 与 `Transaction.sourceRef` 的 VarChar(64) 对齐；超长会导致写入失败。 */
export const MAX_SOURCE_REF_LENGTH = 64;

/**
 * 去掉不可见字符与多余空白。
 *
 * 支付宝订单号尾部有 `\t`（真实样本 48/48 行都有），不清理会把「同一个单号」
 * 变成两个身份，二次导入就重复入账；表格里的 NBSP/零宽字符同理。
 * 注意只压缩空白、不删除普通空格，商户名里的空格有含义。
 */
export function cleanText(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[\u00a0\u3000]/g, " ")
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 表头/方向等短字段：把所有空白都去掉，避免「收 / 支」这种排版差异。 */
export function compactText(value: string | null | undefined): string {
  return cleanText(value).replace(/\s+/g, "");
}

/**
 * 占位符判断。
 *
 * 微信/支付宝导出用 `/` 表示「无」，如果把 `/` 当成商户或单号，
 * 候选会看起来有值、实际却无法去重。只把纯符号串视为占位。
 */
export function isPlaceholder(value: string | null | undefined): boolean {
  const text = cleanText(value);
  return text === "" || /^[-—–/／]+$/.test(text);
}

export function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

/**
 * 把表格金额改成前端约定的十进制字符串（而不是最小单位）。
 *
 * 前端 `parseAmountInput` 会再乘 10^decimals，所以这里必须保留小数位；
 * 多出来的小数位不四舍五入而是返回 null（宁可标待核对，也不改金额）。
 */
export function normalizeAmountText(
  raw: string | null | undefined,
  currency: string,
): string | null {
  let text = cleanText(raw);
  if (!text) return null;

  let negative = false;
  if (text.startsWith("(") && text.endsWith(")")) {
    negative = true;
    text = text.slice(1, -1);
  }
  text = text.replace(/[\s,]/g, "");
  text = text.replace(/^(?:CNY|RMB|USD|HKD|JPY|EUR|GBP)/i, "");
  text = text.replace(/^[¥￥$]/, "");
  text = text.replace(/(?:元|美元)$/, "");
  text = text.replace(/^\+/, "");

  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (match === null) return null;

  const sign = match[1] ?? "";
  const integerRaw = match[2] ?? "0";
  const fractionRaw = match[3] ?? "";
  const decimals = decimalsFor(currency);

  // 只拒绝「有效」小数位超过币种精度的情况：1.00 对 JPY 仍是 1。
  const significantFraction = fractionRaw.replace(/0+$/, "");
  if (significantFraction.length > decimals) return null;

  const integer = integerRaw.replace(/^0+(?=\d)/, "");
  const isZero = /^0+$/.test(integerRaw) && !/[1-9]/.test(fractionRaw);
  const signText = (negative || sign === "-") && !isZero ? "-" : "";

  if (decimals === 0) return `${signText}${integer}`;

  const fraction = `${fractionRaw}${"0".repeat(decimals)}`.slice(0, decimals);
  return `${signText}${integer}.${fraction}`;
}

export interface LocalDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  /** 补零后的 `YYYY-MM-DD`，与 `Transaction.occurredLocalDate` 的语义一致。 */
  readonly iso: string;
}

/**
 * 只接受「年在前」的明确日期。
 *
 * `03/04/26` 这类日期在不同地区含义不同，适配器必须自己知道格式
 * （BOA 是 MM/DD/YY），不能在这里猜，否则会把日期整体错一个月。
 */
export function parseLocalDate(raw: string | null | undefined): LocalDateParts | null {
  const text = cleanText(raw);
  if (!text) return null;

  const match =
    /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text) ??
    /^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(text);
  if (match === null) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2200) return null;

  const stamp = Date.UTC(year, month - 1, day);
  const check = new Date(stamp);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }

  return {
    year,
    month,
    day,
    iso: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

export interface ClockParts {
  /** 补零后的 `HH:mm` 或 `HH:mm:ss`。 */
  readonly time: string;
  readonly precision: "second" | "minute";
}

export function parseClockTime(raw: string | null | undefined): ClockParts | null {
  const text = cleanText(raw);
  if (!text) return null;

  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (match === null) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] === undefined ? null : Number(match[3]);
  if (hour > 23 || minute > 59 || (second !== null && second > 59)) return null;

  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  if (second !== null) {
    return { time: `${hh}:${mm}:${String(second).padStart(2, "0")}`, precision: "second" };
  }
  return { time: `${hh}:${mm}`, precision: "minute" };
}

export interface DateTimeParts {
  readonly date: LocalDateParts;
  readonly time: ClockParts | null;
  readonly precision: "second" | "minute" | "day";
}

/** 拆分 `YYYY-MM-DD HH:mm:ss` / `YYYY-MM-DDTHH:mm` / 纯日期。 */
export function splitDateTime(raw: string | null | undefined): DateTimeParts | null {
  const text = cleanText(raw);
  if (!text) return null;

  const parts = text.split(/[T\s]+/);
  const date = parseLocalDate(parts[0] ?? "");
  if (date === null) return null;

  const timePart = parts.slice(1).join(" ");
  if (!timePart) return { date, time: null, precision: "day" };

  const time = parseClockTime(timePart);
  if (time === null) return null;

  return { date, time, precision: time.precision };
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function zonedFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached !== undefined) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

function offsetAt(utcMs: number, timeZone: string): number {
  const values = new Map<string, string>();
  for (const part of zonedFormatter(timeZone).formatToParts(new Date(utcMs))) {
    if (part.type !== "literal") values.set(part.type, part.value);
  }
  const year = Number(values.get("year") ?? "0");
  const month = Number(values.get("month") ?? "1");
  const day = Number(values.get("day") ?? "1");
  const hour = Number(values.get("hour") ?? "0");
  const minute = Number(values.get("minute") ?? "0");
  const second = Number(values.get("second") ?? "0");
  return Date.UTC(year, month - 1, day, hour, minute, second) - utcMs;
}

/**
 * 把「账本本地时间」换算成带偏移的 ISO 字符串。
 *
 * `Transaction.occurredAt` 是 timestamptz，而候选里只有本地日期时间；
 * 用两轮 offset 修正覆盖夏令时切换（第一次猜测可能落在切换另一侧）。
 * 前端要求 `occurredAt` 带偏移，故这里最后统一转成 UTC `Z` 形式。
 */
export function dateTimeToInstant(
  date: string,
  time: string | null,
  timeZone: string,
): string {
  const local = parseLocalDate(date);
  if (local === null) throw new RangeError("invalid_date");
  const clock = time === null ? "00:00:00" : parseClockTime(time)?.time;
  if (clock === undefined) throw new RangeError("invalid_time");

  const [hour, minute, second] = clock.split(":").map(Number);
  const target = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    hour ?? 0,
    minute ?? 0,
    second ?? 0,
  );

  let offset = offsetAt(target, timeZone);
  let instant = target - offset;
  const corrected = offsetAt(instant, timeZone);
  if (corrected !== offset) {
    offset = corrected;
    instant = target - offset;
  }
  return new Date(instant).toISOString();
}

/**
 * 分类建议只从已有分类里匹配，绝不创建。
 * 匹配是启发式，失败就留空让用户选；不应该因为分类名奇怪而让整份预览报错。
 */
export function suggestCategoryId(
  text: string,
  categories: readonly CategoryOption[],
  kind: "expense" | "income",
): string | null {
  const spoken = cleanText(text);
  if (!spoken) return null;
  try {
    return matchCategory(spoken, categories, kind)?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * 支付方式建议只认账本里已有的名字。
 *
 * 支付宝的「招商银行储蓄卡(1399)&支付宝立减」后半段是优惠说明，
 * 微信也常带卡尾号；先精确匹配，再试去掉 & 后缀和卡尾号，最后按最长名称前缀。
 */
export function suggestPaymentMethodId(
  raw: string,
  methods: readonly PaymentMethodOption[],
): string | null {
  const text = cleanText(raw);
  if (!text) return null;

  const active = methods.filter((method) => !method.isArchived);
  const normalize = (value: string) => cleanText(value).replace(/\s+/g, "");
  const target = normalize(text);

  const exact = active.find((method) => normalize(method.name) === target);
  if (exact !== undefined) return exact.id;

  const candidates = new Set<string>([target]);
  const ampersand = target.indexOf("&");
  if (ampersand > 0) candidates.add(target.slice(0, ampersand));
  const withoutTail = target.replace(/[（(]\d{3,4}[）)]$/, "");
  if (withoutTail !== target) candidates.add(withoutTail);

  for (const candidate of candidates) {
    if (!candidate) continue;
    const hit = active.find((method) => normalize(method.name) === candidate);
    if (hit !== undefined) return hit.id;
  }

  const sorted = [...active].sort(
    (left, right) => normalize(right.name).length - normalize(left.name).length,
  );
  for (const method of sorted) {
    const name = normalize(method.name);
    if (name.length < 2) continue;
    for (const candidate of candidates) {
      if (candidate.startsWith(name) || name.startsWith(candidate)) return method.id;
    }
  }
  return null;
}

function hashKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/**
 * 来源单号：平台前缀 + 原始单号，长度受 `sourceRef` 列限制。
 *
 * 超长时用哈希而不是截断，避免两个不同单号被截成同一个身份；
 * 单号为空则退化为按「文件指纹 + 页 + 行」生成的稳定合成单号，
 * 保证同一文件重复上传仍然命中同一身份，不会重复入账。
 */
export function makeSourceRef(
  prefix: string,
  raw: string,
  fingerprint: string,
  page: number,
  line: number,
): string {
  const key = cleanText(raw).replace(/\s+/g, "");
  if (!key) return syntheticSourceRef(prefix, fingerprint, page, line);
  const value = `${prefix}${key}`;
  if (value.length <= MAX_SOURCE_REF_LENGTH) return value;
  return `${prefix}${hashKey(key).slice(0, Math.max(0, MAX_SOURCE_REF_LENGTH - prefix.length))}`;
}

export function syntheticSourceRef(
  prefix: string,
  fingerprint: string,
  page: number,
  line: number,
): string {
  const digest = hashKey(`${fingerprint}:${page}:${line}`).slice(0, 16);
  return `${prefix}${digest}`;
}

/** 给核对页/对账消息用的金额展示，不用于存储。 */
export function formatAmountText(cents: number, currency: string): string {
  const decimals = decimalsFor(currency);
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const unit = 10 ** decimals;
  const whole = Math.floor(absolute / unit)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (decimals === 0) return `${negative ? "-" : ""}${whole}`;
  const fraction = String(absolute % unit).padStart(decimals, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}
