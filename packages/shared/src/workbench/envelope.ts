/**
 * S17 · Agent D · I-1b：`s01-v2` 信封组装（headless，纯函数）
 *
 * 把「一张卡片的分析结果元数据 + 形状载荷」组装成 S-01 v2 冻结信封，
 * 供后续布局/卡片层（Claude 工作台 UI）消费。本文件只做组装与一致性校验：
 * - **不计算任何财务数值**、不重算、不补默认值、不猜完整性；
 * - **不定义 B 的形状专有字段**：载荷通过泛型 `TPayload` 原样携带（pass-through）；
 * - 纯函数、无 I/O / DOM / 时钟 / 随机依赖；不改输入对象。
 *
 * 公共类型与常量直接来自 Agent A 的冻结协议，不保留集成前的镜像类型。
 *
 * 契约口径（见 `S17-Agent-D-D2-集成前检查清单` 与 I-1 映射文档）：
 * - `shape` 逐字使用 B 协议已登记的形状名（移动平均 = `moving-average`）；
 * - `completeness` 9 态由调用方传入，本模块只做一致性校验；
 * - `computation` 可含 v2.0.3 的 `method? / sampling? / coverageEnd? / analysisLimit?`。
 */

import { ANALYSIS_PROTOCOL_VERSION, ANALYSIS_ROUNDING_POLICY } from "../analysis/types.js";
import type {
  AnalysisResultBase, AnalysisCompleteness, ResolvedCurrency, ResolvedPeriod,
  ResolvedFilters, ComputationMetadata, SourceDescriptor,
} from "../analysis/types.js";
export { ANALYSIS_PROTOCOL_VERSION, ANALYSIS_ROUNDING_POLICY } from "../analysis/types.js";
export type {
  AnalysisResultBase, AnalysisCompleteness, ResolvedCurrency, ResolvedPeriod,
  ResolvedFilters, SamplingMetadata, AnalysisLimitMetadata, ComputationMetadata,
  SourceDescriptor,
} from "../analysis/types.js";

// ---------------------------------------------------------------------------
// I-1b 信封
// ---------------------------------------------------------------------------

/**
 * `s01-v2` 信封：A 的公共基础字段 + 形状名 + **载荷引用**。
 *
 * 载荷结构由形状所属 Agent（如 B 的 `MovingAverageResult`）定义，D 不在此声明；
 * 集成批次由 Claude/页面层用 B 的类型消费。
 */
export type S01V2Envelope<TPayload> = AnalysisResultBase & {
  readonly shape: string;
  readonly payload: TPayload;
};

/** 信封组装问题（稳定 code + 字段路径，便于 UI/测试定位）。 */
export interface EnvelopeIssue {
  readonly path: string;
  readonly code: string;
  readonly detail: string;
}

/** 信封组装输入：公共元数据 + 形状名 + 载荷（载荷原样 pass-through）。 */
export interface EnvelopeBuildInput<TPayload> {
  readonly analysisId: string;
  readonly analysisType: string;
  readonly metric: string;
  readonly resolvedFilters: ResolvedFilters;
  readonly resolvedPeriod: ResolvedPeriod;
  readonly resolvedCurrency: ResolvedCurrency;
  readonly completeness: AnalysisCompleteness;
  readonly unavailableReason?: string | undefined;
  readonly dataVersion: string | null;
  readonly computation: ComputationMetadata;
  readonly source: SourceDescriptor;
  readonly shape: string;
  readonly payload: TPayload;
}

/** 组装选项（可选；不传则只做基础校验）。 */
export interface EnvelopeBuildOptions<TPayload> {
  /** 允许的 shape 白名单；不传=只要求非空字符串（不硬编码任何形状）。 */
  readonly allowedShapes?: readonly string[] | undefined;
  /**
   * 载荷是否为空的可选判定（由形状所有方提供）。
   *
   * 只用于**一致性校验**：空载荷但 `completeness !== "no-transactions"`、
   * 或非空载荷但 `completeness === "no-transactions"` 时报错；
   * 本模块**不会**根据载荷推断或改写 completeness。
   */
  readonly isEmptyPayload?: ((payload: TPayload) => boolean) | undefined;
}

/** 组装结果：成功返回不可变信封，失败返回全部问题。 */
export type EnvelopeBuildResult<TPayload> =
  | { readonly ok: true; readonly envelope: S01V2Envelope<TPayload> }
  | { readonly ok: false; readonly issues: readonly EnvelopeIssue[] };

const COMPLETENESS_VALUES: readonly AnalysisCompleteness[] = [
  "complete",
  "no-transactions",
  "partial",
  "fx-incomplete",
  "offline-incomplete",
  "loading",
  "request-failed",
  "no-permission",
  "not-applicable",
];

/** `completeness` 不能说明数值可用、必须带 `unavailableReason` 的态。 */
const REASON_REQUIRED_COMPLETENESS: readonly AnalysisCompleteness[] = [
  "partial",
  "fx-incomplete",
  "offline-incomplete",
  "loading",
  "request-failed",
  "no-permission",
  "not-applicable",
];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const QUERY_KINDS: readonly SourceDescriptor["query"]["kind"][] = ["stats", "transactions"];
const FILTER_KINDS: readonly ResolvedFilters["kind"][] = ["expense", "income", "both"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStringArrayOrNull(value: unknown): boolean {
  return value === null || (Array.isArray(value) && value.every((item) => typeof item === "string"));
}

/** 是否为合法的 S-01 v2 完整性 9 态。 */
export function isAnalysisCompleteness(value: unknown): value is AnalysisCompleteness {
  return typeof value === "string" && (COMPLETENESS_VALUES as readonly string[]).includes(value);
}

function issue(path: string, code: string, detail: string): EnvelopeIssue {
  return { path, code, detail };
}

function checkRequiredString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: EnvelopeIssue[],
): void {
  if (!isNonEmptyString(record[key])) {
    issues.push(issue(path, "envelope-invalid-field", `${key} 必须是非空字符串`));
  }
}

function checkResolvedPeriod(value: unknown, path: string, issues: EnvelopeIssue[]): void {
  if (!isRecord(value)) {
    issues.push(issue(path, "envelope-invalid-resolved-period", "resolvedPeriod 必须是对象"));
    return;
  }
  const from = value["from"];
  const to = value["to"];
  const dayCount = value["dayCount"];
  if (typeof from !== "string" || !DATE_PATTERN.test(from)) {
    issues.push(issue(`${path}.from`, "envelope-invalid-resolved-period", "from 必须是 YYYY-MM-DD"));
  }
  if (typeof to !== "string" || !DATE_PATTERN.test(to)) {
    issues.push(issue(`${path}.to`, "envelope-invalid-resolved-period", "to 必须是 YYYY-MM-DD"));
  }
  if (typeof from === "string" && typeof to === "string" && from > to) {
    issues.push(issue(path, "envelope-invalid-resolved-period", "from 不能晚于 to"));
  }
  if (typeof dayCount !== "number" || !Number.isInteger(dayCount) || dayCount <= 0) {
    issues.push(issue(`${path}.dayCount`, "envelope-invalid-resolved-period", "dayCount 必须是正整数"));
  }
}

function checkResolvedFilters(value: unknown, path: string, issues: EnvelopeIssue[]): void {
  if (!isRecord(value)) {
    issues.push(issue(path, "envelope-invalid-resolved-filters", "resolvedFilters 必须是对象"));
    return;
  }
  const kind = value["kind"];
  if (typeof kind !== "string" || !(FILTER_KINDS as readonly string[]).includes(kind)) {
    issues.push(issue(`${path}.kind`, "envelope-invalid-resolved-filters", "kind 必须是 expense/income/both"));
  }
  for (const key of ["categoryIds", "paymentMethodIds", "tagIds"] as const) {
    if (!isStringArrayOrNull(value[key])) {
      issues.push(issue(`${path}.${key}`, "envelope-invalid-resolved-filters", `${key} 必须是 string[] 或 null`));
    }
  }
  const currency = value["currency"];
  if (!(currency === null || typeof currency === "string")) {
    issues.push(issue(`${path}.currency`, "envelope-invalid-resolved-filters", "currency 必须是 string 或 null"));
  }
}

function checkResolvedCurrency(value: unknown, path: string, issues: EnvelopeIssue[]): void {
  if (!isRecord(value)) {
    issues.push(issue(path, "envelope-invalid-resolved-currency", "resolvedCurrency 必须是对象"));
    return;
  }
  const mode = value["mode"];
  if (mode === "original") {
    if (!isNonEmptyString(value["currency"])) {
      issues.push(issue(`${path}.currency`, "envelope-invalid-resolved-currency", "original 模式需非空 currency"));
    }
    return;
  }
  if (mode === "aggregate") {
    if (!isNonEmptyString(value["targetCurrency"])) {
      issues.push(issue(`${path}.targetCurrency`, "envelope-invalid-resolved-currency", "aggregate 模式需非空 targetCurrency"));
    }
    return;
  }
  issues.push(issue(`${path}.mode`, "envelope-invalid-resolved-currency", "mode 必须是 original 或 aggregate"));
}

function checkComputation(value: unknown, path: string, issues: EnvelopeIssue[]): void {
  if (!isRecord(value)) {
    issues.push(issue(path, "envelope-invalid-computation", "computation 必须是对象"));
    return;
  }
  if (value["rounding"] !== ANALYSIS_ROUNDING_POLICY) {
    issues.push(
      issue(`${path}.rounding`, "envelope-invalid-computation", `rounding 必须是 ${ANALYSIS_ROUNDING_POLICY}`),
    );
  }
  if (value["method"] !== undefined && typeof value["method"] !== "string") {
    issues.push(issue(`${path}.method`, "envelope-invalid-computation", "method 必须是字符串"));
  }
  if (value["coverageEnd"] !== undefined && typeof value["coverageEnd"] !== "string") {
    issues.push(issue(`${path}.coverageEnd`, "envelope-invalid-computation", "coverageEnd 必须是字符串"));
  }
  if (value["sampling"] !== undefined) {
    const sampling = value["sampling"];
    if (!isRecord(sampling) || sampling["isVisualOnly"] !== true) {
      issues.push(issue(`${path}.sampling`, "envelope-invalid-computation", "sampling 必须是 isVisualOnly:true 的对象"));
    }
  }
  if (value["analysisLimit"] !== undefined) {
    const limit = value["analysisLimit"];
    if (!isRecord(limit) || !isNonEmptyString(limit["limit"]) || typeof limit["value"] !== "number") {
      issues.push(issue(`${path}.analysisLimit`, "envelope-invalid-computation", "analysisLimit 需 limit:string + value:number"));
    }
  }
}

function checkSource(value: unknown, path: string, issues: EnvelopeIssue[]): void {
  if (!isRecord(value)) {
    issues.push(issue(path, "envelope-invalid-source", "source 必须是对象"));
    return;
  }
  if (!isNonEmptyString(value["analysisId"])) {
    issues.push(issue(`${path}.analysisId`, "envelope-invalid-source", "source.analysisId 必须非空"));
  }
  if (!(value["groupBy"] === null || typeof value["groupBy"] === "string")) {
    issues.push(issue(`${path}.groupBy`, "envelope-invalid-source", "groupBy 必须是 string 或 null"));
  }
  checkResolvedPeriod(value["period"], `${path}.period`, issues);
  checkResolvedFilters(value["filters"], `${path}.filters`, issues);
  const query = value["query"];
  if (!isRecord(query)) {
    issues.push(issue(`${path}.query`, "envelope-invalid-source", "query 必须是对象"));
  } else {
    if (typeof query["kind"] !== "string" || !(QUERY_KINDS as readonly string[]).includes(query["kind"])) {
      issues.push(issue(`${path}.query.kind`, "envelope-invalid-source", "query.kind 必须是 stats/transactions"));
    }
    for (const key of ["from", "to"] as const) {
      if (typeof query[key] !== "string" || !DATE_PATTERN.test(query[key])) {
        issues.push(issue(`${path}.query.${key}`, "envelope-invalid-source", `${key} 必须是 YYYY-MM-DD`));
      }
    }
    const currency = query["currency"];
    if (!(currency === null || typeof currency === "string")) {
      issues.push(issue(`${path}.query.currency`, "envelope-invalid-source", "query.currency 必须是 string 或 null"));
    }
  }
  if (value["transactionIds"] !== undefined && !isStringArrayOrNull(value["transactionIds"])) {
    issues.push(issue(`${path}.transactionIds`, "envelope-invalid-source", "transactionIds 必须是 string[]（可选）"));
  }
  if (!(value["dataVersion"] === null || typeof value["dataVersion"] === "string")) {
    issues.push(issue(`${path}.dataVersion`, "envelope-invalid-source", "dataVersion 必须是 string 或 null"));
  }
}

function validateInput<TPayload>(
  input: unknown,
  options: EnvelopeBuildOptions<TPayload>,
): readonly EnvelopeIssue[] {
  const issues: EnvelopeIssue[] = [];
  if (!isRecord(input)) {
    return [issue("input", "envelope-invalid-input", "输入必须是对象")];
  }

  checkRequiredString(input, "analysisId", "input.analysisId", issues);
  checkRequiredString(input, "analysisType", "input.analysisType", issues);
  checkRequiredString(input, "metric", "input.metric", issues);
  checkRequiredString(input, "shape", "input.shape", issues);

  checkResolvedFilters(input["resolvedFilters"], "input.resolvedFilters", issues);
  checkResolvedPeriod(input["resolvedPeriod"], "input.resolvedPeriod", issues);
  checkResolvedCurrency(input["resolvedCurrency"], "input.resolvedCurrency", issues);
  checkComputation(input["computation"], "input.computation", issues);
  checkSource(input["source"], "input.source", issues);

  const completeness = input["completeness"];
  if (!isAnalysisCompleteness(completeness)) {
    issues.push(issue("input.completeness", "envelope-invalid-completeness", "completeness 必须是 9 态之一"));
  } else {
    const reason = input["unavailableReason"];
    if (reason !== undefined && typeof reason !== "string") {
      issues.push(issue("input.unavailableReason", "envelope-invalid-field", "unavailableReason 必须是字符串"));
    }
    const hasReason = isNonEmptyString(reason);
    if (REASON_REQUIRED_COMPLETENESS.includes(completeness) && !hasReason) {
      issues.push(
        issue(
          "input.unavailableReason",
          "envelope-unavailable-reason-required",
          `completeness=${completeness} 时必须提供 unavailableReason（不得静默当 0）`,
        ),
      );
    }
    if ((completeness === "complete" || completeness === "no-transactions") && hasReason) {
      issues.push(
        issue(
          "input.unavailableReason",
          "envelope-unavailable-reason-unexpected",
          `completeness=${completeness} 时不应携带 unavailableReason`,
        ),
      );
    }
  }

  const dataVersion = input["dataVersion"];
  if (!(dataVersion === null || typeof dataVersion === "string")) {
    issues.push(issue("input.dataVersion", "envelope-invalid-field", "dataVersion 必须是 string 或 null"));
  }

  if (!Object.prototype.hasOwnProperty.call(input, "payload")) {
    issues.push(issue("input.payload", "envelope-missing-payload", "payload 必须提供（可为任意形状）"));
  }

  const shape = input["shape"];
  if (isNonEmptyString(shape)) {
    const allowed = options.allowedShapes;
    if (allowed !== undefined && !allowed.includes(shape)) {
      issues.push(
        issue("input.shape", "envelope-shape-not-allowed", `shape=${shape} 不在允许集合 [${allowed.join(", ")}] 内`),
      );
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, "payload") && options.isEmptyPayload !== undefined) {
    const payload = input["payload"] as TPayload;
    const empty = options.isEmptyPayload(payload);
    const completeness = input["completeness"];
    if (empty && completeness !== "no-transactions") {
      issues.push(
        issue(
          "input.payload",
          "envelope-payload-completeness-mismatch",
          "载荷为空但 completeness 不是 no-transactions（completeness 由调用方提供，本模块不改写）",
        ),
      );
    }
    if (!empty && completeness === "no-transactions") {
      issues.push(
        issue(
          "input.payload",
          "envelope-payload-completeness-mismatch",
          "载荷非空但 completeness=no-transactions（completeness 由调用方提供，本模块不改写）",
        ),
      );
    }
  }

  return issues;
}

/**
 * 组装 `s01-v2` 信封（纯函数、输入不修改）。
 *
 * 只做组装与一致性校验：不计算金额、不推断 completeness、不定义载荷形状。
 */
export function buildAnalysisEnvelope<TPayload>(
  input: EnvelopeBuildInput<TPayload>,
  options: EnvelopeBuildOptions<TPayload> = {},
): EnvelopeBuildResult<TPayload> {
  const issues = validateInput(input as unknown, options);
  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const envelope: S01V2Envelope<TPayload> = {
    version: ANALYSIS_PROTOCOL_VERSION,
    analysisId: input.analysisId,
    analysisType: input.analysisType,
    metric: input.metric,
    resolvedFilters: input.resolvedFilters,
    resolvedPeriod: input.resolvedPeriod,
    resolvedCurrency: input.resolvedCurrency,
    completeness: input.completeness,
    ...(input.unavailableReason !== undefined ? { unavailableReason: input.unavailableReason } : {}),
    dataVersion: input.dataVersion,
    computation: input.computation,
    source: input.source,
    shape: input.shape,
    payload: input.payload,
  };
  return { ok: true, envelope };
}
