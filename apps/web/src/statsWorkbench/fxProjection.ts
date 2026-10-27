/**
 * 综合折算的统一适配层（S17 · 综合折算卡片适配）。
 *
 * 一个范围的折算只在这里被「翻译」一次，所有 38 张卡片共用：
 *
 *   S16-D `aggregateFxDetailedAsync`（逐笔 `FxConvertedEntry` + 失败清单）
 *     + 原始账目（带分类 / 支付方式 / 备注等元数据）
 *     → `FxProjection`：以**目标币种**表示的、与原币模式完全同形的账目数组
 *     → 已验收的 Agent A / Agent B 计算入口（不写任何新的财务公式）
 *
 * 不变量（每条都有测试）：
 * - **不重新折算。** 金额只取 `FxConvertedEntry.targetMinor`（S16-D 单笔舍入后的整数最小单位）；
 *   本模块不乘汇率、不二次舍入、不改原账目。
 * - **缺汇率 ≠ 0。** 折算失败的账目不会以 0 的身份进入金额类分析：`converted` 只含成功折算的账目；
 *   `all` 仅供「与金额无关」的计数类分析使用（笔数、天数、分类数），其中未折算账目的金额占位为 0，
 *   这类分析从不读取金额（`fxProjection.test.ts` 用「随机改写金额结果不变」守住这一点）。
 * - **只在能证明时才算完整。** 逐笔条数与失败条数必须恰好守恒到原始账目数，id 必须能一一回连，
 *   折算金额必须是安全整数；任何一条不满足都返回显式失败状态，而不是悄悄少算。
 * - **超过逐笔上限不截断。** `entryLimitExceeded` 时本模块返回 `entry-limit`，由调用方决定是否退回
 *   仅聚合的结果；绝不取前 N 笔冒充完整。
 */
import { fxCurrency, FX_MAX_DETAIL_ENTRIES, type Currency, type FxAggregate, type FxAggregateDetail, type Transaction } from "@libellum/shared";

/** 缺汇率会影响哪一类金额：收入类分析不受缺汇率的支出影响，反之亦然。 */
export type FxKindScope = "expense" | "income" | "both" | "none";

export type FxMissingReason = FxAggregate["failures"][number]["reason"];

export interface FxMissingRecord {
  readonly id: string;
  readonly date: string;
  readonly currency: string;
  readonly reason: FxMissingReason;
  readonly kind: "expense" | "income";
}

export interface FxMissingSummary {
  readonly count: number;
  readonly dates: ReadonlySet<string>;
}

export interface FxProjection {
  readonly target: Currency;
  /** 成功折算的账目，币种 = 目标币种，`amountCents` = 单笔折算后的整数最小单位。 */
  readonly converted: readonly Transaction[];
  /** 全部账目（含未折算），币种 = 目标币种；未折算账目的金额是占位 0，**只许与金额无关的分析使用**。 */
  readonly all: readonly Transaction[];
  readonly missing: readonly FxMissingRecord[];
  /** 按「受影响的金额口径」预先算好的缺汇率账目数与日期集合。 */
  readonly missingByScope: Readonly<Record<FxKindScope, FxMissingSummary>>;
  readonly aggregate: FxAggregate;
  readonly sourceComplete: boolean;
  readonly reviewNeededCount: number;
}

export type FxProjectionFailure =
  | { readonly status: "loading" }
  | { readonly status: "no-permission" }
  | { readonly status: "request-failed"; readonly reason: "capacity" | "read" }
  | { readonly status: "entry-limit"; readonly limit: number }
  | { readonly status: "invalid"; readonly reason: "detail-missing" | "orphan-entry" | "conservation" | "amount-unsafe" | "currency" };

export type FxProjectionState =
  | { readonly status: "ready"; readonly projection: FxProjection }
  | FxProjectionFailure;

/** `useFxRange` 返回值里投影需要的那部分；用结构类型避免本模块依赖 React。 */
export interface FxProjectionInput {
  readonly target: string;
  readonly loading: boolean;
  readonly error?: boolean | undefined;
  readonly reason?: "capacity" | "read" | "permission" | undefined;
  readonly result?: FxAggregate | undefined;
  readonly detail?: FxAggregateDetail | undefined;
  readonly sourceEntries?: readonly (Transaction & { readonly bookId: string })[] | undefined;
  readonly entryLimitExceeded?: boolean | undefined;
  readonly sourceComplete?: boolean | undefined;
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function summarize(records: readonly FxMissingRecord[]): FxMissingSummary {
  return { count: records.length, dates: new Set(records.map((record) => record.date)) };
}

export function emptyMissingSummary(): FxMissingSummary {
  return { count: 0, dates: new Set() };
}

/**
 * 把一次折算投影成与原币模式同形的账目数组。纯函数：同一份输入得到结构相同的输出。
 */
export function projectFx(input: FxProjectionInput): FxProjectionState {
  if (input.reason === "permission") return { status: "no-permission" };
  if (input.error === true) return { status: "request-failed", reason: input.reason === "capacity" ? "capacity" : "read" };
  if (input.loading || input.result === undefined) return { status: "loading" };
  if (input.entryLimitExceeded === true) return { status: "entry-limit", limit: FX_MAX_DETAIL_ENTRIES };
  const { result, detail, sourceEntries } = input;
  if (detail === undefined || detail.entries === null || sourceEntries === undefined) return { status: "invalid", reason: "detail-missing" };
  if (!fxCurrency(input.target)) return { status: "invalid", reason: "currency" };
  const target: Currency = input.target;

  const sourceById = new Map<string, Transaction>();
  for (const entry of sourceEntries) sourceById.set(entry.id, entry);
  // 守恒：逐笔成功 + 失败 = 原始账目；id 唯一。任何一条不成立都不能当作完整的输入。
  if (sourceById.size !== sourceEntries.length) return { status: "invalid", reason: "conservation" };
  if (detail.entries.length + result.failures.length !== sourceEntries.length) return { status: "invalid", reason: "conservation" };

  const convertedById = new Map<string, Transaction>();
  for (const entry of detail.entries) {
    const source = sourceById.get(entry.id);
    if (source === undefined || convertedById.has(entry.id)) return { status: "invalid", reason: "orphan-entry" };
    if (source.occurredLocalDate !== entry.date || source.kind !== entry.kind) return { status: "invalid", reason: "orphan-entry" };
    const minor = BigInt(entry.targetMinor);
    if (minor < 0n || minor > MAX_SAFE) return { status: "invalid", reason: "amount-unsafe" };
    convertedById.set(entry.id, { ...source, currency: target, amountCents: Number(minor) });
  }

  const missing: FxMissingRecord[] = [];
  for (const failure of result.failures) {
    const source = sourceById.get(failure.id);
    if (source === undefined || convertedById.has(failure.id)) return { status: "invalid", reason: "orphan-entry" };
    missing.push({ id: failure.id, date: failure.date, currency: failure.currency, reason: failure.reason, kind: source.kind });
  }

  const converted: Transaction[] = [];
  const all: Transaction[] = [];
  for (const source of sourceEntries) {
    const done = convertedById.get(source.id);
    if (done !== undefined) {
      converted.push(done);
      all.push(done);
    } else {
      // 占位 0：只服务于与金额无关的计数类分析，见文件头说明。
      all.push({ ...source, currency: target, amountCents: 0 });
    }
  }

  const expense = missing.filter((record) => record.kind === "expense");
  const income = missing.filter((record) => record.kind === "income");
  return {
    status: "ready",
    projection: {
      target,
      converted,
      all,
      missing,
      missingByScope: { expense: summarize(expense), income: summarize(income), both: summarize(missing), none: emptyMissingSummary() },
      aggregate: result,
      sourceComplete: input.sourceComplete === true,
      reviewNeededCount: result.reviewNeededCount,
    },
  };
}

/** 同一份折算状态只投影一次：同屏多张卡片共享同一个投影（同一指标不会出现两个数字）。 */
const projections = new WeakMap<object, FxProjectionState>();

export function projectFxCached(input: FxProjectionInput): FxProjectionState {
  // 稳定的引用：折算状态对象在 `useFxRange` 里每次重算才换新；没有逐笔投影时每次重新判断（便宜）。
  const key = input.detail ?? input.result;
  if (key === undefined || input.loading || input.error === true || input.reason === "permission" || input.entryLimitExceeded === true) return projectFx(input);
  const cached = projections.get(key);
  if (cached !== undefined) return cached;
  const state = projectFx(input);
  projections.set(key, state);
  return state;
}
