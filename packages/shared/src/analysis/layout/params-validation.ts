/**
 * D-6 前置：G-12a v1 params 白名单校验（headless，纯函数）。
 *
 * 依据：A 的《G-12a 正式发布物：params 白名单发布形态 v1》（2026-10-27，draft 随
 * S-01 v2，未冻结；供 D 实施准备）与 S-03 布局侧接口草案（AnalysisReference 只存
 * 引用与参数，不解释财务语义）。
 *
 * 边界：
 * - **纯函数**：不读时钟/随机数/网络/存储；不查账本权限、不查分类是否存在
 *   （那属于查询层 requireBook），只做结构/范围/互斥/隐私黑名单校验；
 * - **失败即拒绝**：不静默补默认、不猜测、不做容错合并；调用方保留已存配置，
 *   展示错误占位；
 * - 未知 `analysisId` / 较新（非当前）`analysisVersion`：**只读占位**，保留配置，
 *   不迁移、不删除、不回写、不自动改参数（S-01 v2 §6.1 G-12b）；
 * - `shareImportAllowed=false` 期间分享导入路径直接拒绝（`share_import_closed`）。
 *
 * 待决占位（不阻塞本批）：
 * - `analysisVersion` 为字符串版本串，S-01 v2 的 G-15 精确命名/排序未冻结；本实现
 *   只做**等值比较**：提供 `currentAnalysisVersion` 时，非等值即按“较新/未知”只读
 *   占位（保守策略，不猜测版本顺序）；
 * - `timeFixed` 的绝对区间语义按 G-12a v1 实现；Lead 已裁定（T-8）绝对区间应走
 *   卡片级 `pinnedRange`、`timeFixed` 仅保留相对/预设语义，待 A r7 微调发布物后
 *   只改表/语义说明，不改校验结构。
 */

import type { AnalysisReference } from "./types.js";

/** G-12a 发布物版本（`paramsSchemaVersion` 字面量）。 */
export const ANALYSIS_PARAMS_SCHEMA_VERSION = "1";

/** params 键总数上限（G-12a §5-1）。 */
export const MAX_ANALYSIS_PARAMS_KEYS = 12;

/** id 数组（categoryIds/paymentMethodIds/tagIds）去重后数量上限（G-12a §2）。 */
export const MAX_ANALYSIS_PARAMS_ID_ITEMS = 50;

/** 相对/固定区间默认天数上限（超过须显式 allowLongRange）。 */
export const MAX_RELATIVE_DAYS = 400;

/** 绝对区间默认天数上限（与 MAX_RELATIVE_DAYS 同值，语义分开登记）。 */
export const MAX_ABSOLUTE_RANGE_DAYS = 400;

/** 显式 allowLongRange 后的天数上限（性能保护 C-1 #2）。 */
export const MAX_LONG_RANGE_DAYS = 3660;

export const TIME_PRESETS = ["7d", "30d", "90d", "365d"] as const;
export type TimePreset = (typeof TIME_PRESETS)[number];

export const COMPARISON_POLICIES = ["same-day-index", "equal-length-window"] as const;
export type ComparisonPolicy = (typeof COMPARISON_POLICIES)[number];

export const ANALYSIS_KINDS = ["income", "expense", "both"] as const;
export type AnalysisKind = (typeof ANALYSIS_KINDS)[number];

/** G-12a §6 的 9 个稳定错误码（含分享导入门）。 */
export type AnalysisParamsErrorCode =
  | "params_invalid"
  | "params_unknown_key"
  | "params_type"
  | "params_out_of_range"
  | "params_conflict"
  | "params_private_data"
  | "params_unknown_analysis"
  | "params_newer_version"
  | "share_import_closed";

export const ANALYSIS_PARAMS_ERROR_CODES: readonly AnalysisParamsErrorCode[] = [
  "params_invalid",
  "params_unknown_key",
  "params_type",
  "params_out_of_range",
  "params_conflict",
  "params_private_data",
  "params_unknown_analysis",
  "params_newer_version",
  "share_import_closed",
];

export interface AnalysisParamsIssue {
  readonly code: AnalysisParamsErrorCode;
  readonly path: string;
  readonly detail: string;
}

export type AnalysisParamsStatus = "valid" | "readonly" | "invalid";

export type AnalysisParamsReadonlyReason = "analysis-unknown" | "analysis-version-newer";

export interface AnalysisParamsValidationResult {
  readonly status: AnalysisParamsStatus;
  /** 通过的参数原样返回（不归一化、不补默认）；只读占位时同样保留原配置。 */
  readonly value?: Readonly<Record<string, unknown>>;
  readonly issues: readonly AnalysisParamsIssue[];
  readonly readonlyReason?: AnalysisParamsReadonlyReason;
}

export interface AnalysisParamsValidationOptions {
  /**
   * 当前目录版本串（可选）。提供时：`analysisVersion` 非等值即按“较新/未知”
   * 只读占位（G-15 版本排序未冻结，保守策略）。
   */
  readonly currentAnalysisVersion?: string;
  /** 可选：覆盖已知 analysisId 集合（默认内置 G-12a 26 项）。 */
  readonly knownAnalysisIds?: readonly string[];
}

export type ShareImportGateResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly issues: readonly AnalysisParamsIssue[] };

interface AnalysisParamSpec {
  readonly analysisId: string;
  readonly kinds: readonly AnalysisKind[];
  readonly extraKeys: readonly string[];
}

/** 通用参数键（G-12a §2；所有 26 项可用，单独限制见逐分析表）。 */
const GENERIC_PARAM_KEYS: readonly string[] = [
  "paramsSchemaVersion",
  "kind",
  "categoryIds",
  "paymentMethodIds",
  "tagIds",
  "timePreset",
  "timeRelativeDays",
  "timeFixed",
  "allowLongRange",
];

/** 隐私黑名单键（G-12a §4；大小写不敏感）。 */
const PRIVATE_PARAM_KEYS: readonly string[] = [
  "bookid",
  "ledgerid",
  "accountid",
  "userid",
  "memberid",
  "ownerid",
  "categoryname",
  "tagname",
  "paymentmethodname",
  "amount",
  "amountminor",
  "amountcents",
  "amounts",
  "result",
  "results",
  "value",
  "values",
  "totals",
  "title",
  "subtitle",
  "customtitle",
  "note",
  "notes",
  "email",
  "username",
  "displayname",
  "color",
  "chartfamily",
  "width",
  "height",
  "size",
  "density",
  "x",
  "y",
  "w",
  "h",
];

const PRIVATE_KEY_SET: ReadonlySet<string> = new Set(PRIVATE_PARAM_KEYS);

/** G-12a §3：逐分析白名单（26 项；`—` 表示无额外键）。 */
const ANALYSIS_PARAM_SPECS: readonly AnalysisParamSpec[] = [
  { analysisId: "AN-B01", kinds: ["expense"], extraKeys: [] },
  { analysisId: "AN-B02", kinds: ["income"], extraKeys: [] },
  { analysisId: "AN-B03", kinds: ["both"], extraKeys: ["comparisonPolicy"] },
  { analysisId: "AN-B04", kinds: ["expense"], extraKeys: [] },
  { analysisId: "AN-B05", kinds: ["income"], extraKeys: [] },
  { analysisId: "AN-B06", kinds: ["expense"], extraKeys: [] },
  { analysisId: "AN-B07", kinds: ["expense"], extraKeys: [] },
  { analysisId: "AN-B08", kinds: ["expense"], extraKeys: [] },
  { analysisId: "AN-B09", kinds: ["expense"], extraKeys: [] },
  { analysisId: "AN-B10", kinds: ["expense"], extraKeys: [] },
  { analysisId: "AN-B11", kinds: ["expense"], extraKeys: [] },
  { analysisId: "AN-B12", kinds: ["income"], extraKeys: [] },
  { analysisId: "AN-B13", kinds: ["expense"], extraKeys: [] },
  { analysisId: "AN-B14", kinds: ["expense"], extraKeys: [] },
  { analysisId: "AN-B15", kinds: ["expense"], extraKeys: [] },
  { analysisId: "AN-B16", kinds: ["expense", "both", "income"], extraKeys: ["includeSystemCategories"] },
  { analysisId: "AN-B17", kinds: ["income"], extraKeys: [] },
  { analysisId: "AN-B18", kinds: ["both"], extraKeys: [] },
  { analysisId: "AN-B19", kinds: ["both"], extraKeys: [] },
  { analysisId: "AN-B20", kinds: ["both"], extraKeys: [] },
  { analysisId: "AN-I01", kinds: ["expense"], extraKeys: ["maxParts"] },
  { analysisId: "AN-I02", kinds: ["income"], extraKeys: ["maxParts"] },
  { analysisId: "AN-I03", kinds: ["expense"], extraKeys: ["topN"] },
  { analysisId: "AN-I04", kinds: ["income"], extraKeys: ["topN"] },
  { analysisId: "AN-I05", kinds: ["expense", "income"], extraKeys: ["topN"] },
  { analysisId: "AN-I17", kinds: ["expense", "income"], extraKeys: ["metric", "maxParts"] },
];

const ANALYSIS_PARAM_SPEC_BY_ID: ReadonlyMap<string, AnalysisParamSpec> = new Map(
  ANALYSIS_PARAM_SPECS.map((spec) => [spec.analysisId, spec]),
);

/** G-12a §2：三个区间参数互斥（最多出现一个）。 */
const INTERVAL_KEYS: readonly string[] = ["timePreset", "timeRelativeDays", "timeFixed"];

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isParamsErrorCode(value: string): value is AnalysisParamsErrorCode {
  return (ANALYSIS_PARAMS_ERROR_CODES as readonly string[]).includes(value);
}

/** 稳定错误码判定（供调用方类型收窄）。 */
export function isAnalysisParamsErrorCode(value: string): value is AnalysisParamsErrorCode {
  return isParamsErrorCode(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(path: string, code: AnalysisParamsErrorCode, detail: string): AnalysisParamsIssue {
  return { code, path, detail };
}

function isAnalysisKind(value: string): value is AnalysisKind {
  return (ANALYSIS_KINDS as readonly string[]).includes(value);
}

function isTimePreset(value: string): value is TimePreset {
  return (TIME_PRESETS as readonly string[]).includes(value);
}

function isComparisonPolicy(value: string): value is ComparisonPolicy {
  return (COMPARISON_POLICIES as readonly string[]).includes(value);
}

/** 真实日历日期（拒绝 2026-02-30 等）。 */
function isValidCalendarDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** 闭区间天数（含首尾；日期已通过 isValidCalendarDate）。 */
function inclusiveDayCount(from: string, to: string): number {
  const fromMatch = DATE_PATTERN.exec(from);
  const toMatch = DATE_PATTERN.exec(to);
  if (fromMatch === null || toMatch === null) {
    return Number.POSITIVE_INFINITY;
  }
  const fromMs = Date.UTC(Number(fromMatch[1]), Number(fromMatch[2]) - 1, Number(fromMatch[3]));
  const toMs = Date.UTC(Number(toMatch[1]), Number(toMatch[2]) - 1, Number(toMatch[3]));
  return Math.floor((toMs - fromMs) / 86_400_000) + 1;
}

/** 已知 analysisId（默认 G-12a v1 的 26 项）。 */
export function isKnownAnalysisId(
  analysisId: string,
  knownAnalysisIds?: readonly string[],
): boolean {
  if (knownAnalysisIds !== undefined) {
    return knownAnalysisIds.includes(analysisId);
  }
  return ANALYSIS_PARAM_SPEC_BY_ID.has(analysisId);
}

/** 某个分析允许的键（通用键 + 该分析额外键；未知分析只返回通用键）。 */
export function analysisParamsKeys(analysisId: string): readonly string[] {
  const spec = ANALYSIS_PARAM_SPEC_BY_ID.get(analysisId);
  const extra = spec === undefined ? [] : spec.extraKeys;
  return [...GENERIC_PARAM_KEYS, ...extra];
}

function validateIdArray(
  value: unknown,
  key: string,
): { readonly ok: true; readonly ids: readonly string[] } | { readonly ok: false; readonly issues: readonly AnalysisParamsIssue[] } {
  const path = `$params.${key}`;
  if (!Array.isArray(value)) {
    return { ok: false, issues: [fail(path, "params_type", `${key} 必须是数组`)] };
  }
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !UUID_V4_PATTERN.test(item)) {
      return { ok: false, issues: [fail(path, "params_type", `${key} 只允许 uuid v4 字符串`)] };
    }
    if (!ids.includes(item)) {
      ids.push(item);
    }
  }
  if (ids.length < 1 || ids.length > MAX_ANALYSIS_PARAMS_ID_ITEMS) {
    return {
      ok: false,
      issues: [
        fail(
          path,
          "params_out_of_range",
          `${key} 去重后数量须在 1..${String(MAX_ANALYSIS_PARAMS_ID_ITEMS)} 之间（当前 ${String(ids.length)}）`,
        ),
      ],
    };
  }
  return { ok: true, ids };
}

interface ParamValueChecks {
  relativeDays?: number;
  fixedDays?: number;
  allowLongRange?: boolean;
  intervalCount: number;
}

function validateParamValues(
  params: Record<string, unknown>,
  spec: AnalysisParamSpec,
): { readonly issues: readonly AnalysisParamsIssue[]; readonly checks: ParamValueChecks } {
  const issues: AnalysisParamsIssue[] = [];
  const checks: ParamValueChecks = { intervalCount: 0 };

  for (const key of INTERVAL_KEYS) {
    if (params[key] !== undefined) {
      checks.intervalCount += 1;
    }
  }

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) {
      continue;
    }
    const path = `$params.${key}`;
    if (PRIVATE_KEY_SET.has(key.toLowerCase())) {
      issues.push(fail(path, "params_private_data", `${key} 属于隐私黑名单，params 不允许携带账务/身份数据`));
      continue;
    }
    const allowed = new Set([...GENERIC_PARAM_KEYS, ...spec.extraKeys]);
    if (!allowed.has(key)) {
      issues.push(fail(path, "params_unknown_key", `${spec.analysisId} 不支持参数 ${key}`));
      continue;
    }
    if (isRecord(value) && key !== "timeFixed") {
      issues.push(fail(path, "params_private_data", `${key} 不允许嵌套对象（仅 timeFixed 例外）`));
      continue;
    }
    switch (key) {
      case "paramsSchemaVersion": {
        if (value !== ANALYSIS_PARAMS_SCHEMA_VERSION) {
          issues.push(
            fail(path, "params_invalid", `paramsSchemaVersion 未知，仅接受 "${ANALYSIS_PARAMS_SCHEMA_VERSION}"`),
          );
        }
        break;
      }
      case "kind": {
        if (typeof value !== "string" || !isAnalysisKind(value)) {
          issues.push(fail(path, "params_type", "kind 只允许 income/expense/both"));
        } else if (!spec.kinds.includes(value)) {
          issues.push(
            fail(
              path,
              "params_type",
              `${spec.analysisId} 的 kind 只允许 ${spec.kinds.join("/")}`,
            ),
          );
        }
        break;
      }
      case "categoryIds":
      case "paymentMethodIds":
      case "tagIds": {
        const result = validateIdArray(value, key);
        if (!result.ok) {
          issues.push(...result.issues);
        }
        break;
      }
      case "timePreset": {
        if (typeof value !== "string" || !isTimePreset(value)) {
          issues.push(fail(path, "params_type", "timePreset 只允许 7d/30d/90d/365d"));
        }
        break;
      }
      case "timeRelativeDays": {
        if (typeof value !== "number" || !Number.isInteger(value)) {
          issues.push(fail(path, "params_type", "timeRelativeDays 必须是整数"));
        } else {
          checks.relativeDays = value;
          if (value < 1 || value > MAX_LONG_RANGE_DAYS) {
            issues.push(
              fail(path, "params_out_of_range", `timeRelativeDays 须在 1..${String(MAX_LONG_RANGE_DAYS)} 之间`),
            );
          }
        }
        break;
      }
      case "timeFixed": {
        const fixed = validateTimeFixed(value, issues);
        if (fixed !== undefined) {
          checks.fixedDays = fixed;
        }
        break;
      }
      case "allowLongRange": {
        if (typeof value !== "boolean") {
          issues.push(fail(path, "params_type", "allowLongRange 必须是布尔值"));
        } else {
          checks.allowLongRange = value;
        }
        break;
      }
      case "comparisonPolicy": {
        if (typeof value !== "string" || !isComparisonPolicy(value)) {
          issues.push(
            fail(path, "params_type", "comparisonPolicy 只允许 same-day-index/equal-length-window"),
          );
        }
        break;
      }
      case "includeSystemCategories": {
        if (typeof value !== "boolean") {
          issues.push(fail(path, "params_type", "includeSystemCategories 必须是布尔值"));
        }
        break;
      }
      case "maxParts": {
        if (typeof value !== "number" || !Number.isInteger(value)) {
          issues.push(fail(path, "params_type", "maxParts 必须是整数"));
        } else if (value < 1 || value > 30) {
          issues.push(fail(path, "params_out_of_range", "maxParts 须在 1..30 之间"));
        }
        break;
      }
      case "topN": {
        if (typeof value !== "number" || !Number.isInteger(value)) {
          issues.push(fail(path, "params_type", "topN 必须是整数"));
        } else if (value < 1 || value > 30) {
          issues.push(fail(path, "params_out_of_range", "topN 须在 1..30 之间"));
        }
        break;
      }
      case "metric": {
        if (value !== "amount" && value !== "count") {
          issues.push(fail(path, "params_type", "metric 只允许 amount/count"));
        }
        break;
      }
      default: {
        // 已由白名单/隐私检查覆盖；此处只防御未来键名漂移。
        break;
      }
    }
  }

  if (checks.intervalCount > 1) {
    issues.push(
      fail("$params", "params_conflict", "timePreset/timeRelativeDays/timeFixed 最多只能出现一个"),
    );
  }

  const effectiveLongRange =
    (checks.relativeDays !== undefined && checks.relativeDays > MAX_ABSOLUTE_RANGE_DAYS) ||
    (checks.fixedDays !== undefined && checks.fixedDays > MAX_ABSOLUTE_RANGE_DAYS);

  if (checks.allowLongRange === true && !effectiveLongRange) {
    issues.push(
      fail("$params.allowLongRange", "params_out_of_range", "allowLongRange 仅在区间超过 400 天时允许为 true"),
    );
  }
  if (effectiveLongRange && checks.allowLongRange !== true) {
    issues.push(
      fail(
        "$params",
        "params_out_of_range",
        "区间超过 400 天必须显式 allowLongRange=true（默认按 400 天拒绝）",
      ),
    );
  }

  return { issues, checks };
}

function validateTimeFixed(
  value: unknown,
  issues: AnalysisParamsIssue[],
): number | undefined {
  if (!isRecord(value)) {
    issues.push(fail("$params.timeFixed", "params_type", "timeFixed 必须是 {from,to} 对象"));
    return undefined;
  }
  for (const key of Object.keys(value)) {
    if (key !== "from" && key !== "to") {
      issues.push(
        fail(`$params.timeFixed.${key}`, "params_unknown_key", "timeFixed 只允许 from/to 两个键"),
      );
    }
  }
  const from = value["from"];
  const to = value["to"];
  if (typeof from !== "string" || typeof to !== "string") {
    issues.push(fail("$params.timeFixed", "params_type", "timeFixed.from/to 必须是 YYYY-MM-DD 字符串"));
    return undefined;
  }
  if (!isValidCalendarDate(from) || !isValidCalendarDate(to)) {
    issues.push(fail("$params.timeFixed", "params_out_of_range", "timeFixed 含非法日历日期"));
    return undefined;
  }
  if (from > to) {
    issues.push(fail("$params.timeFixed", "params_out_of_range", "timeFixed.from 不能晚于 to"));
    return undefined;
  }
  const days = inclusiveDayCount(from, to);
  if (days > MAX_LONG_RANGE_DAYS) {
    issues.push(
      fail(
        "$params.timeFixed",
        "params_out_of_range",
        `timeFixed 天数超过上限 ${String(MAX_LONG_RANGE_DAYS)}`,
      ),
    );
    return undefined;
  }
  return days;
}

/**
 * 校验一个 `AnalysisReference` 的 params（G-12a v1）。
 *
 * @param reference 任意输入（`{analysisId, analysisVersion?, params}`）；形状非法时 status="invalid"。
 */
export function validateAnalysisParams(
  reference: unknown,
  options: AnalysisParamsValidationOptions = {},
): AnalysisParamsValidationResult {
  if (!isRecord(reference)) {
    return {
      status: "invalid",
      issues: [fail("$", "params_invalid", "分析引用必须是对象")],
    };
  }
  const analysisId = reference["analysisId"];
  if (typeof analysisId !== "string" || analysisId.trim().length === 0) {
    return {
      status: "invalid",
      issues: [fail("$", "params_invalid", "analysisId 必须是非空字符串")],
    };
  }
  const rawParams = reference["params"];
  if (!isRecord(rawParams)) {
    return {
      status: "invalid",
      issues: [fail("$params", "params_invalid", "params 必须是普通对象（非数组/null）")],
    };
  }
  const params: Readonly<Record<string, unknown>> = rawParams;

  if (!isKnownAnalysisId(analysisId, options.knownAnalysisIds)) {
    return {
      status: "readonly",
      issues: [
        fail(
          "$",
          "params_unknown_analysis",
          `未知 analysisId：${analysisId}（只读占位，保留原配置，不迁移/不删除/不回写）`,
        ),
      ],
      value: params,
      readonlyReason: "analysis-unknown",
    };
  }

  const analysisVersion = reference["analysisVersion"];
  if (analysisVersion !== undefined) {
    if (typeof analysisVersion !== "string" || analysisVersion.trim().length === 0) {
      return {
        status: "invalid",
        issues: [fail("$", "params_invalid", "analysisVersion 必须是非空字符串或省略")],
      };
    }
    if (
      options.currentAnalysisVersion !== undefined &&
      analysisVersion !== options.currentAnalysisVersion
    ) {
      return {
        status: "readonly",
        issues: [
          fail(
            "$",
            "params_newer_version",
            `分析定义版本较新（${analysisVersion} ≠ 当前 ${options.currentAnalysisVersion}），只读占位：保留配置、不迁移、不回写、不自动改参数`,
          ),
        ],
        value: params,
        readonlyReason: "analysis-version-newer",
      };
    }
  }

  if (Object.keys(params).length > MAX_ANALYSIS_PARAMS_KEYS) {
    return {
      status: "invalid",
      issues: [
        fail(
          "$params",
          "params_invalid",
          `params 键总数不得超过 ${String(MAX_ANALYSIS_PARAMS_KEYS)}`,
        ),
      ],
    };
  }

  const spec = ANALYSIS_PARAM_SPEC_BY_ID.get(analysisId);
  if (spec === undefined) {
    // isKnownAnalysisId 与表不一致时按未知分析只读占位（防御）。
    return {
      status: "readonly",
      issues: [fail("$", "params_unknown_analysis", `未知 analysisId：${analysisId}`)],
      value: params,
      readonlyReason: "analysis-unknown",
    };
  }

  const { issues } = validateParamValues(params, spec);
  if (issues.length > 0) {
    return { status: "invalid", issues };
  }
  return { status: "valid", issues: [], value: params };
}

/** 分享导入门：默认关闭；只有显式 `shareImportAllowed === true` 才放行。 */
export function checkShareImportGate(
  options: { readonly shareImportAllowed?: boolean } = {},
): ShareImportGateResult {
  if (options.shareImportAllowed === true) {
    return { ok: true };
  }
  return {
    ok: false,
    issues: [
      fail(
        "$",
        "share_import_closed",
        "分享导入尚未开放（shareImportAllowed=false，待 G-12a 校验与测试放行）",
      ),
    ],
  };
}

/** 便捷判定：引用本身是否可被布局层安全消费（不触发财务读取）。 */
export function isAcceptableAnalysisReference(
  reference: unknown,
  options: AnalysisParamsValidationOptions = {},
): boolean {
  const result = validateAnalysisParams(reference, options);
  return result.status !== "invalid";
}

/** 类型守卫辅助：引用是否符合 `AnalysisReference` 的基本形状（不做白名单校验）。 */
export function isAnalysisReferenceShape(value: unknown): value is AnalysisReference {
  if (!isRecord(value)) {
    return false;
  }
  const analysisId = value["analysisId"];
  const params = value["params"];
  return typeof analysisId === "string" && analysisId.length > 0 && isRecord(params);
}
