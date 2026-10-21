/**
 * S15-E2 · 统一的重复交易检测核心。
 *
 * 这里是**唯一**的重复判定规则实现。OCR 批次、账本导入等入口通过适配层把各自的
 * 候选字段翻译成 {@link DuplicateCandidateFields}，再调用本文件的纯函数；规则本身
 * 不再在页面里复制第二份。
 *
 * ⚠️ **只提示，不处理。** 本文件不写库、不删除、不合并、不覆盖，也不产生任何
 * “是否允许写入”的结论。幂等键、唯一约束、权限与离线同步保护都不经过这里；
 * 把提醒关掉只等于“不看提示”，不等于“放弃数据安全机制”。
 *
 * ⚠️ **确定性。** 同样的输入与设置必须得到同样的输出：不读时钟、不读浏览器时区、
 * 不读环境变量、不抛裸异常。时间比较只接受**带时区偏移的 ISO 8601 时间戳**
 * （例如 `2026-10-21T18:03:00+08:00`、`2026-10-21T10:03:00.000Z`），因此跨时区、
 * 跨日、跨分钟的差值都是真实的时间差，而不是 `HH:mm` 字符串比较。
 *
 * ⚠️ **本地日期（`occurredLocalDate`）只在时间戳不可用时作为较弱依据。**
 * 时间精度为 `"day"`（只有日期、没有时分秒）时不把中午 12:00 当作真实时间参与窗口计算。
 *
 * 规则语义（所有者 2026-10-21 定义，详见
 * `docs/specs/features/S15-E2-统一重复检测规则-设计决定.md`）：
 *
 *  1. 只在同一账本内比较（`bookId` 必须相同）；
 *  2. 收支方向必须相同；`unknown` 不参与判定；
 *  3. 金额（整数最小单位）必须完全相等，币种必须相同；不做汇率折算；
 *  4. 时间：双方都有可解析时间 → 真实时间差 ≤ 窗口；一方缺失 → 记为“缺失”，
 *     不因缺失排除（但日期不同或完全没有时间依据时排除，见代码）；
 *  5. 分类默认开启：双方都有有效分类 ID 时必须相同；只有一方有 → 不排除；
 *  6. 支付方式默认开启：同上；
 *  7. 结果同时给出“通过了什么”和“因什么被排除”，并把 `missing`（字段缺失）
 *     与 `mismatch`（字段实际不一致）分开。
 */

/**
 * 收/支方向；`unknown` 表示截图或数据里没有可靠方向。
 *
 * `transfer` 来自 OCR 的页面语义（转账页）；它只是**同方向比较**的一个取值，
 * 本轮不新增业务类型、不改变数据模型，也不把收入与支出视为可互相重复。
 */
export type DuplicateCandidateKind = "expense" | "income" | "transfer" | "unknown";

/**
 * 时间的可信精度。
 *
 * - `second`：带偏移的 ISO 时间戳，可参与真实时间差计算；
 * - `minute`：由 `YYYY-MM-DD` + `HH:mm` 组成的分钟级时间，秒按 0 处理；
 * - `day`：只有日期，**不**参与时间窗口计算（只作为同日弱依据）。
 */
export type DuplicateTimePrecision = "second" | "minute" | "day";

/** 时间窗口下限（秒）。0 会让“同一笔”失去时间约束，负值无意义。 */
export const DUPLICATE_TIME_WINDOW_MIN_SECONDS = 1;

/**
 * 时间窗口上限（秒）——30 天。
 *
 * 上限存在的目的不是业务精度，而是防止“整本账”被一次窗口覆盖：更大的范围应当由
 * E5 的全账本审查（按天分桶、用户主动触发）处理，而不是把日常提醒的窗口调到无限大。
 */
export const DUPLICATE_TIME_WINDOW_MAX_SECONDS = 2_592_000;

/** 设置页提供的固定档位（秒）；自定义值仍以秒存储。 */
export const DUPLICATE_TIME_WINDOW_PRESETS_SECONDS = [60, 300, 1_800, 3_600, 86_400] as const;

/**
 * 用户可管理的重复检测设置。
 *
 * ⚠️ `enabled` 是**业务层提醒开关**，不是数据安全开关。关闭后：不提示、不分组，
 * 但幂等、来源身份去重、权限、离线同步与唯一约束全部照常工作。
 */
export interface DuplicateDetectionSettings {
  /** 是否启用重复提醒。默认 `true`。 */
  readonly enabled: boolean;
  /** 时间窗口（秒）。默认 60；范围 1 秒–30 天，必须是整数。 */
  readonly timeWindowSeconds: number;
  /** 双方都有分类时是否要求相同。默认 `true`。 */
  readonly matchCategory: boolean;
  /** 双方都有支付方式时是否要求相同。默认 `true`。 */
  readonly matchPaymentMethod: boolean;
}

/** 所有设置都回到默认值：开启提醒、60 秒、比较分类与支付方式。 */
export const DEFAULT_DUPLICATE_DETECTION_SETTINGS: DuplicateDetectionSettings = Object.freeze({
  enabled: true,
  timeWindowSeconds: 60,
  matchCategory: true,
  matchPaymentMethod: true,
});

export type DuplicateSettingsField =
  | "enabled"
  | "timeWindowSeconds"
  | "matchCategory"
  | "matchPaymentMethod";

const DUPLICATE_SETTINGS_FIELDS: readonly DuplicateSettingsField[] = [
  "enabled",
  "timeWindowSeconds",
  "matchCategory",
  "matchPaymentMethod",
];

export type DuplicateSettingsIssueCode =
  | "not_object"
  | "unknown_field"
  | "missing"
  | "not_boolean"
  | "not_integer"
  | "below_minimum"
  | "above_maximum";

/** 一条结构化错误；调用方可以按 `field` / `code` 显示或记录，不需要解析字符串。 */
export interface DuplicateSettingsIssue {
  /** 出问题的字段；整个对象不可读时是 `"settings"`。 */
  readonly field: string;
  readonly code: DuplicateSettingsIssueCode;
  readonly message: string;
}

export type DuplicateSettingsValidation =
  | {
      readonly ok: true;
      readonly settings: DuplicateDetectionSettings;
      /** 严格校验不接受未知字段，成功时恒为空数组（保留字段便于统一调用）。 */
      readonly unknownFields: readonly string[];
    }
  | { readonly ok: false; readonly issues: readonly DuplicateSettingsIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSettingsField(value: string): value is DuplicateSettingsField {
  return (DUPLICATE_SETTINGS_FIELDS as readonly string[]).includes(value);
}

function readBooleanField(
  source: Record<string, unknown>,
  field: "enabled" | "matchCategory" | "matchPaymentMethod",
  issues: DuplicateSettingsIssue[],
): boolean | undefined {
  const value = source[field];

  if (value === undefined) {
    issues.push({ field, code: "missing", message: `缺少设置项：${field}。` });
    return undefined;
  }
  if (typeof value !== "boolean") {
    issues.push({ field, code: "not_boolean", message: `${field} 必须是 true 或 false。` });
    return undefined;
  }

  return value;
}

function readTimeWindow(
  source: Record<string, unknown>,
  issues: DuplicateSettingsIssue[],
): number | undefined {
  const value = source["timeWindowSeconds"];

  if (value === undefined) {
    issues.push({ field: "timeWindowSeconds", code: "missing", message: "缺少设置项：timeWindowSeconds。" });
    return undefined;
  }
  /**
   * `Number.isInteger` 同时挡住 `NaN`、`Infinity` 与小数——三者都不能成为窗口。
   */
  if (typeof value !== "number" || !Number.isInteger(value)) {
    issues.push({
      field: "timeWindowSeconds",
      code: "not_integer",
      message: "时间窗口必须是整数秒（不能是小数、NaN 或 Infinity）。",
    });
    return undefined;
  }
  if (value < DUPLICATE_TIME_WINDOW_MIN_SECONDS) {
    issues.push({
      field: "timeWindowSeconds",
      code: "below_minimum",
      message: `时间窗口不能小于 ${String(DUPLICATE_TIME_WINDOW_MIN_SECONDS)} 秒。`,
    });
    return undefined;
  }
  if (value > DUPLICATE_TIME_WINDOW_MAX_SECONDS) {
    issues.push({
      field: "timeWindowSeconds",
      code: "above_maximum",
      message: `时间窗口不能大于 ${String(DUPLICATE_TIME_WINDOW_MAX_SECONDS)} 秒（30 天）。`,
    });
    return undefined;
  }

  return value;
}

/**
 * **严格校验**：四个字段都必须存在且合法，未知字段直接报错。
 *
 * 用途是“写之前再确认一次”（例如本地存储的保存路径），不是读旧数据。
 * 读取旧数据/手改过的存储请用 {@link recoverDuplicateDetectionSettings}。
 */
export function validateDuplicateDetectionSettings(input: unknown): DuplicateSettingsValidation {
  if (!isRecord(input)) {
    return {
      ok: false,
      issues: [{ field: "settings", code: "not_object", message: "重复检测设置必须是一个对象。" }],
    };
  }

  const issues: DuplicateSettingsIssue[] = [];

  for (const key of Object.keys(input)) {
    if (!isSettingsField(key)) {
      /**
       * ⚠️ **未知字段在严格校验里是错误，不是静默忽略。**
       * 存储层用宽松的恢复函数读取旧数据；但“保存”必须拒绝拼错的键，
       * 否则用户以为设置生效了，实际写入的是一个没人读的字段。
       */
      issues.push({ field: key, code: "unknown_field", message: `未知设置项：${key}。` });
    }
  }

  const enabled = readBooleanField(input, "enabled", issues);
  const matchCategory = readBooleanField(input, "matchCategory", issues);
  const matchPaymentMethod = readBooleanField(input, "matchPaymentMethod", issues);
  const timeWindowSeconds = readTimeWindow(input, issues);

  const settings: DuplicateDetectionSettings = {
    enabled: enabled ?? DEFAULT_DUPLICATE_DETECTION_SETTINGS.enabled,
    timeWindowSeconds: timeWindowSeconds ?? DEFAULT_DUPLICATE_DETECTION_SETTINGS.timeWindowSeconds,
    matchCategory: matchCategory ?? DEFAULT_DUPLICATE_DETECTION_SETTINGS.matchCategory,
    matchPaymentMethod: matchPaymentMethod ?? DEFAULT_DUPLICATE_DETECTION_SETTINGS.matchPaymentMethod,
  };

  if (issues.length > 0) return { ok: false, issues };

  return { ok: true, settings, unknownFields: [] };
}

export interface DuplicateSettingsRecovery {
  readonly settings: DuplicateDetectionSettings;
  /** 所有问题；未知字段也在这里报告，但**不会**让恢复失败。 */
  readonly issues: readonly DuplicateSettingsIssue[];
  /** 被忽略的未知字段名（同一份问题也在 `issues` 里）。 */
  readonly unknownFields: readonly string[];
  /** 因为缺失/非法而回落到默认值的字段。 */
  readonly usedDefaults: readonly DuplicateSettingsField[];
}

/**
 * **宽松恢复**：读取本地存储或旧版本数据时使用，永不抛异常。
 *
 * - 已知字段合法 → 保留；
 * - 缺失或非法 → 该字段回落到默认值，并记入 `usedDefaults`；
 * - 未知字段 → 忽略并报告（便于日后发现“新版本写过、旧版本在读”）；
 * - 整个对象不可读 → 全部默认值。
 */
export function recoverDuplicateDetectionSettings(input: unknown): DuplicateSettingsRecovery {
  const issues: DuplicateSettingsIssue[] = [];
  const usedDefaults: DuplicateSettingsField[] = [];

  if (!isRecord(input)) {
    issues.push({ field: "settings", code: "not_object", message: "重复检测设置不是对象，已使用默认值。" });
    usedDefaults.push(...DUPLICATE_SETTINGS_FIELDS);

    return {
      settings: { ...DEFAULT_DUPLICATE_DETECTION_SETTINGS },
      issues,
      unknownFields: [],
      usedDefaults,
    };
  }

  const unknownFields = Object.keys(input).filter((key) => !isSettingsField(key));
  for (const field of unknownFields) {
    issues.push({ field, code: "unknown_field", message: `未知设置项：${field}，已忽略。` });
  }

  const enabled = readBooleanField(input, "enabled", issues);
  const matchCategory = readBooleanField(input, "matchCategory", issues);
  const matchPaymentMethod = readBooleanField(input, "matchPaymentMethod", issues);
  const timeWindowSeconds = readTimeWindow(input, issues);

  if (enabled === undefined) usedDefaults.push("enabled");
  if (matchCategory === undefined) usedDefaults.push("matchCategory");
  if (matchPaymentMethod === undefined) usedDefaults.push("matchPaymentMethod");
  if (timeWindowSeconds === undefined) usedDefaults.push("timeWindowSeconds");

  return {
    settings: {
      enabled: enabled ?? DEFAULT_DUPLICATE_DETECTION_SETTINGS.enabled,
      timeWindowSeconds: timeWindowSeconds ?? DEFAULT_DUPLICATE_DETECTION_SETTINGS.timeWindowSeconds,
      matchCategory: matchCategory ?? DEFAULT_DUPLICATE_DETECTION_SETTINGS.matchCategory,
      matchPaymentMethod: matchPaymentMethod ?? DEFAULT_DUPLICATE_DETECTION_SETTINGS.matchPaymentMethod,
    },
    issues,
    unknownFields,
    usedDefaults,
  };
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

/**
 * 参与重复判断的最小字段集。
 *
 * 适配层负责把各自的记录翻译成这个形状；**比较只使用这里的值**，不读数据库、
 * 不比较显示名称（分类、支付方式都只比较账本内的 ID）。
 */
export interface DuplicateCandidateFields {
  /** 入口内稳定 ID（交易 ID / OCR 候选项 ID）。批量判断时同一 ID 只保留第一条。 */
  readonly id: string;
  /** 所属账本；不同账本永不构成重复。 */
  readonly bookId: string;
  readonly kind: DuplicateCandidateKind;
  /** 整数最小单位；`null` 表示金额缺失。禁止用浮点元。 */
  readonly amountCents: number | null;
  /** ISO 4217 代码；`null` 表示缺失。 */
  readonly currency: string | null;
  /** 带时区偏移的 ISO 8601 时间戳；`null` 表示缺失/不可解析。 */
  readonly occurredAt: string | null;
  /** 时间戳精度；缺省视为 `"second"`。 */
  readonly occurredAtPrecision?: DuplicateTimePrecision;
  /** 本地日历日 `YYYY-MM-DD`；时间戳不可用时作为较弱依据。 */
  readonly occurredLocalDate: string | null;
  /** 账本内分类 ID；`null` 表示没有分类。**不传分类名称。** */
  readonly categoryId: string | null;
  /** 账本内支付方式 ID；`null` 表示没有支付方式。 */
  readonly paymentMethodId: string | null;
}

export type DuplicateField =
  | "bookId"
  | "kind"
  | "amountCents"
  | "currency"
  | "occurredAt"
  | "occurredLocalDate"
  | "categoryId"
  | "paymentMethodId";

export type DuplicateRule =
  | "reminders"
  | "book"
  | "kind"
  | "amount"
  | "currency"
  | "time"
  | "category"
  | "paymentMethod";

/**
 * `passed` 通过 / `excluded` 排除 / `missing` 字段缺失但不排除 / `skipped` 设置关闭。
 *
 * ⚠️ `missing` 与 `excluded` 是两件事：前者是“没有证据”，后者是“有证据说明不是同一笔”。
 * 只有 `excluded` 会影响 `matched`。
 */
export type DuplicateRuleOutcome = "passed" | "excluded" | "missing" | "skipped";

export type DuplicateExclusionCode =
  | "reminders_disabled"
  | "book_missing"
  | "book_mismatch"
  | "kind_unknown"
  | "kind_mismatch"
  | "amount_missing"
  | "amount_invalid"
  | "amount_mismatch"
  | "currency_missing"
  | "currency_mismatch"
  | "time_outside_window"
  | "date_mismatch"
  | "time_missing"
  | "category_mismatch"
  | "payment_method_mismatch";

export interface DuplicateRuleEvaluation {
  readonly rule: DuplicateRule;
  readonly outcome: DuplicateRuleOutcome;
  /** 仅 `excluded` 时非空。 */
  readonly code: DuplicateExclusionCode | null;
  /** 这条规则涉及的字段。 */
  readonly fields: readonly DuplicateField[];
  /** 给人看的短句；界面可直接展示，也可只用 code。 */
  readonly detail: string;
}

/**
 * 为 E3 预留的扩展位：来源交易 ID 与用户已确认的关系。
 *
 * ⚠️ **本轮不实现 E3**：`sourceTransactionIds` 恒为空，`userConfirmedRelation` 恒为 `null`；
 * 它们不出现在判定逻辑里，也不改变结果。
 */
export interface DuplicateResultExtensions {
  readonly sourceTransactionIds: readonly string[];
  readonly userConfirmedRelation: "not_duplicate" | null;
}

export interface DuplicatePairResult {
  /** 与左右顺序无关的稳定键（两个 id 排序后用 `\u0000` 连接）。 */
  readonly pairKey: string;
  readonly leftId: string;
  readonly rightId: string;
  /** 全部规则都没有排除 → `true`。缺失字段不会让它变成 `false`。 */
  readonly matched: boolean;
  /** 因总开关关闭而没有检测；此时 `matched` 恒为 `false`。 */
  readonly suppressed: boolean;
  readonly rules: readonly DuplicateRuleEvaluation[];
  /** 所有排除码；`matched` 为真时为空数组。 */
  readonly exclusionCodes: readonly DuplicateExclusionCode[];
  /** 参与判定但缺失的字段（去重、保持规则顺序）。 */
  readonly missingFields: readonly DuplicateField[];
  /** 双方实际不一致的字段（去重、保持规则顺序）。 */
  readonly mismatchedFields: readonly DuplicateField[];
  /** 双方真实时间差（秒，可能含小数）；无法计算时为 `null`。 */
  readonly timeDifferenceSeconds: number | null;
  /**
   * **不是概率**：`strong` 表示没有缺失字段；`weak` 表示有缺失字段但未被排除；
   * `none` 表示未命中。
   */
  readonly evidence: "strong" | "weak" | "none";
  readonly reason: string;
  /** 本次判定实际使用的设置副本。 */
  readonly settings: DuplicateDetectionSettings;
  readonly extensions: DuplicateResultExtensions;
}

// ---------------------------------------------------------------------------
// Time parsing
// ---------------------------------------------------------------------------

/**
 * 只接受**带显式偏移**的 ISO 8601 时间戳。
 *
 * `2026-10-21T10:00:00`（无偏移）在浏览器里会被按本地时区解释，在 Node 里又是另一个
 * 结果——把它当“可解析”会让同一条数据在不同运行环境得到不同答案。因此无偏移的字符串
 * 一律视为缺失，走本地日期的弱依据。
 */
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseInstant(value: string | null): number | null {
  if (value === null) return null;

  const trimmed = value.trim();
  if (!ISO_INSTANT_PATTERN.test(trimmed)) return null;

  const parsed = Date.parse(trimmed);

  return Number.isFinite(parsed) ? parsed : null;
}

function parseLocalDate(value: string | null): string | null {
  if (value === null) return null;

  const trimmed = value.trim();
  const match = LOCAL_DATE_PATTERN.exec(trimmed);
  if (match === null) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return trimmed;
}

function instantOf(candidate: DuplicateCandidateFields): number | null {
  if ((candidate.occurredAtPrecision ?? "second") === "day") return null;

  return parseInstant(candidate.occurredAt);
}

// ---------------------------------------------------------------------------
// Pair evaluation
// ---------------------------------------------------------------------------

function evaluation(
  rule: DuplicateRule,
  outcome: DuplicateRuleOutcome,
  fields: readonly DuplicateField[],
  detail: string,
  code: DuplicateExclusionCode | null = null,
): DuplicateRuleEvaluation {
  return { rule, outcome, code, fields, detail };
}

function normalizeCurrency(value: string | null): string | null {
  if (value === null) return null;

  const trimmed = value.trim().toUpperCase();

  return trimmed === "" ? null : trimmed;
}

function nonEmptyId(value: string | null): string | null {
  if (value === null) return null;

  const trimmed = value.trim();

  return trimmed === "" ? null : trimmed;
}

function validAmount(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value > 0;
}

function uniqueFields(fields: readonly DuplicateField[]): readonly DuplicateField[] {
  return [...new Set(fields)];
}

/** 与左右顺序无关的稳定键；供去重、分组和测试断言使用。 */
export function duplicatePairKey(leftId: string, rightId: string): string {
  return leftId <= rightId ? `${leftId}\u0000${rightId}` : `${rightId}\u0000${leftId}`;
}

function suppressedResult(
  left: DuplicateCandidateFields,
  right: DuplicateCandidateFields,
  settings: DuplicateDetectionSettings,
): DuplicatePairResult {
  return {
    pairKey: duplicatePairKey(left.id, right.id),
    leftId: left.id,
    rightId: right.id,
    matched: false,
    suppressed: true,
    rules: [
      evaluation(
        "reminders",
        "skipped",
        [],
        "重复提醒已关闭，本次不进行检测。",
        "reminders_disabled",
      ),
    ],
    exclusionCodes: ["reminders_disabled"],
    missingFields: [],
    mismatchedFields: [],
    timeDifferenceSeconds: null,
    evidence: "none",
    reason: "重复提醒已关闭，本次不进行检测。",
    settings: { ...settings },
    extensions: { sourceTransactionIds: [], userConfirmedRelation: null },
  };
}

/**
 * 判断两笔记录是否构成“疑似重复”。
 *
 * 纯函数：不读时钟、不写存储、不抛异常；顺序无关（`left`/`right` 交换结果一致，
 * 只有 `leftId`/`rightId` 会跟着交换）。
 */
export function evaluateDuplicatePair(
  left: DuplicateCandidateFields,
  right: DuplicateCandidateFields,
  settings: DuplicateDetectionSettings = DEFAULT_DUPLICATE_DETECTION_SETTINGS,
): DuplicatePairResult {
  if (!settings.enabled) return suppressedResult(left, right, settings);

  const rules: DuplicateRuleEvaluation[] = [];

  // 1. 账本
  const leftBook = nonEmptyId(left.bookId);
  const rightBook = nonEmptyId(right.bookId);
  if (leftBook === null || rightBook === null) {
    rules.push(evaluation("book", "excluded", ["bookId"], "缺少账本信息，无法判断是否同一本账。", "book_missing"));
  } else if (leftBook !== rightBook) {
    rules.push(evaluation("book", "excluded", ["bookId"], "两笔记录属于不同账本，不比较。", "book_mismatch"));
  } else {
    rules.push(evaluation("book", "passed", ["bookId"], "同一账本。"));
  }

  // 2. 收支方向
  if (left.kind === "unknown" || right.kind === "unknown") {
    rules.push(evaluation("kind", "excluded", ["kind"], "收支方向未知，不能判断为同一笔。", "kind_unknown"));
  } else if (left.kind !== right.kind) {
    rules.push(evaluation("kind", "excluded", ["kind"], "收支方向不同（收入与支出不会互为重复）。", "kind_mismatch"));
  } else {
    rules.push(evaluation("kind", "passed", ["kind"], "收支方向相同。"));
  }

  // 3. 金额（整数最小单位，完全相等）
  if (left.amountCents === null || right.amountCents === null) {
    rules.push(evaluation("amount", "excluded", ["amountCents"], "缺少金额，无法判断。", "amount_missing"));
  } else if (!validAmount(left.amountCents) || !validAmount(right.amountCents)) {
    rules.push(
      evaluation("amount", "excluded", ["amountCents"], "金额不是合法的正整数最小单位。", "amount_invalid"),
    );
  } else if (left.amountCents !== right.amountCents) {
    rules.push(evaluation("amount", "excluded", ["amountCents"], "金额不同。", "amount_mismatch"));
  } else {
    rules.push(evaluation("amount", "passed", ["amountCents"], "金额完全相等。"));
  }

  // 4. 币种
  const leftCurrency = normalizeCurrency(left.currency);
  const rightCurrency = normalizeCurrency(right.currency);
  if (leftCurrency === null || rightCurrency === null) {
    rules.push(evaluation("currency", "excluded", ["currency"], "缺少币种，无法判断。", "currency_missing"));
  } else if (leftCurrency !== rightCurrency) {
    rules.push(evaluation("currency", "excluded", ["currency"], "币种不同（不做汇率折算）。", "currency_mismatch"));
  } else {
    rules.push(evaluation("currency", "passed", ["currency"], "币种相同。"));
  }

  // 5. 时间
  const leftInstant = instantOf(left);
  const rightInstant = instantOf(right);
  let timeDifferenceSeconds: number | null = null;

  if (leftInstant !== null && rightInstant !== null) {
    const differenceSeconds = Math.abs(leftInstant - rightInstant) / 1000;
    timeDifferenceSeconds = differenceSeconds;

    if (differenceSeconds <= settings.timeWindowSeconds) {
      rules.push(
        evaluation(
          "time",
          "passed",
          ["occurredAt"],
          `实际时间相差 ${String(differenceSeconds)} 秒，在 ${String(settings.timeWindowSeconds)} 秒窗口内。`,
        ),
      );
    } else {
      rules.push(
        evaluation(
          "time",
          "excluded",
          ["occurredAt"],
          `实际时间相差 ${String(differenceSeconds)} 秒，超过 ${String(settings.timeWindowSeconds)} 秒窗口。`,
          "time_outside_window",
        ),
      );
    }
  } else {
    const leftDate = parseLocalDate(left.occurredLocalDate);
    const rightDate = parseLocalDate(right.occurredLocalDate);

    if (leftDate !== null && rightDate !== null) {
      if (leftDate === rightDate) {
        rules.push(
          evaluation(
            "time",
            "missing",
            ["occurredAt"],
            "缺少可解析的准确时间，但本地日期相同；按较弱依据比较。",
          ),
        );
      } else {
        rules.push(
          evaluation(
            "time",
            "excluded",
            ["occurredAt", "occurredLocalDate"],
            "本地日期不同，且缺少可比较的准确时间。",
            "date_mismatch",
          ),
        );
      }
    } else {
      rules.push(
        evaluation(
          "time",
          "excluded",
          ["occurredAt"],
          "缺少可解析的交易时间（也没有可用本地日期），无法核对时间窗口。",
          "time_missing",
        ),
      );
    }
  }

  // 6. 分类（只在双方都有有效 ID 时要求相同）
  if (!settings.matchCategory) {
    rules.push(evaluation("category", "skipped", ["categoryId"], "分类匹配已关闭。"));
  } else {
    const leftCategory = nonEmptyId(left.categoryId);
    const rightCategory = nonEmptyId(right.categoryId);

    if (leftCategory === null || rightCategory === null) {
      rules.push(
        evaluation("category", "missing", ["categoryId"], "至少一方没有分类，不因缺失排除。"),
      );
    } else if (leftCategory !== rightCategory) {
      rules.push(
        evaluation("category", "excluded", ["categoryId"], "分类不同。", "category_mismatch"),
      );
    } else {
      rules.push(evaluation("category", "passed", ["categoryId"], "分类相同。"));
    }
  }

  // 7. 支付方式（同上）
  if (!settings.matchPaymentMethod) {
    rules.push(evaluation("paymentMethod", "skipped", ["paymentMethodId"], "支付方式匹配已关闭。"));
  } else {
    const leftPayment = nonEmptyId(left.paymentMethodId);
    const rightPayment = nonEmptyId(right.paymentMethodId);

    if (leftPayment === null || rightPayment === null) {
      rules.push(
        evaluation("paymentMethod", "missing", ["paymentMethodId"], "至少一方没有支付方式，不因缺失排除。"),
      );
    } else if (leftPayment !== rightPayment) {
      rules.push(
        evaluation(
          "paymentMethod",
          "excluded",
          ["paymentMethodId"],
          "支付方式不同。",
          "payment_method_mismatch",
        ),
      );
    } else {
      rules.push(evaluation("paymentMethod", "passed", ["paymentMethodId"], "支付方式相同。"));
    }
  }

  const excluded = rules.filter((rule) => rule.outcome === "excluded");
  const missingRules = rules.filter((rule) => rule.outcome === "missing");
  const exclusionCodes = excluded
    .map((rule) => rule.code)
    .filter((code): code is DuplicateExclusionCode => code !== null);
  /**
   * `time_missing` 是“缺失导致的排除”：它既在 `exclusionCodes` 里，也要出现在
   * `missingFields` 里，调用方才能区分“缺字段”和“值不一致”。
   */
  const missingFields = uniqueFields([
    ...missingRules.flatMap((rule) => rule.fields),
    ...excluded.filter((rule) => rule.code === "time_missing").flatMap((rule) => rule.fields),
    ...excluded
      .filter((rule) => rule.code === "amount_missing" || rule.code === "currency_missing")
      .flatMap((rule) => rule.fields),
  ]);
  const mismatchedFields = uniqueFields(
    excluded
      .filter((rule) => rule.code !== "time_missing" && rule.code !== "amount_missing" && rule.code !== "currency_missing")
      .flatMap((rule) => rule.fields),
  );

  const matched = excluded.length === 0;
  const evidence: DuplicatePairResult["evidence"] = matched
    ? missingFields.length === 0
      ? "strong"
      : "weak"
    : "none";

  let reason: string;
  if (!matched) {
    reason = excluded[0]?.detail ?? "存在排除条件。";
  } else if (missingFields.length === 0) {
    reason = "金额、币种、收支方向、时间、分类与支付方式都符合重复提示条件。";
  } else {
    reason = `金额、币种、收支方向与时间符合条件；以下字段缺失，按较弱依据提示：${missingFields.join("、")}。`;
  }

  return {
    pairKey: duplicatePairKey(left.id, right.id),
    leftId: left.id,
    rightId: right.id,
    matched,
    suppressed: false,
    rules,
    exclusionCodes,
    missingFields,
    mismatchedFields,
    timeDifferenceSeconds,
    evidence,
    reason,
    settings: { ...settings },
    extensions: { sourceTransactionIds: [], userConfirmedRelation: null },
  };
}

// ---------------------------------------------------------------------------
// Batch evaluation
// ---------------------------------------------------------------------------

export interface DuplicateBatchResult {
  readonly settings: DuplicateDetectionSettings;
  /** 总开关关闭时为 `true`，`pairs` 恒为空。 */
  readonly suppressed: boolean;
  /** 命中的组合，按 `pairKey` 稳定排序。 */
  readonly pairs: readonly DuplicatePairResult[];
  /** 实际执行过单对判断的次数（用于性能观察，不是候选总数）。 */
  readonly evaluatedPairs: number;
}

/**
 * 批量候选判断：**每个组合都走 {@link evaluateDuplicatePair}**，不复制规则。
 *
 * 先用“账本 + 方向 + 金额 + 币种”分桶——这四项是任何设置下都必须相同的条件；
 * 桶内再执行完整规则。因此不会对所有记录做无条件两两比较，也没有把分类/支付方式
 * 写进分桶键（它们可以被用户关闭）。
 *
 * ⚠️ 同一 `id` 只保留第一条；空 `id` 被忽略（无法稳定标识一对记录）。
 */
export function evaluateDuplicateCandidates(
  candidates: readonly DuplicateCandidateFields[],
  settings: DuplicateDetectionSettings = DEFAULT_DUPLICATE_DETECTION_SETTINGS,
): DuplicateBatchResult {
  if (!settings.enabled) {
    return {
      settings: { ...settings },
      suppressed: true,
      pairs: [],
      evaluatedPairs: 0,
    };
  }

  const unique = new Map<string, DuplicateCandidateFields>();
  for (const candidate of candidates) {
    if (candidate.id.trim() === "") continue;
    if (!unique.has(candidate.id)) unique.set(candidate.id, candidate);
  }

  const buckets = new Map<string, DuplicateCandidateFields[]>();
  for (const candidate of unique.values()) {
    const key = batchBucketKey(candidate);
    if (key === null) continue;

    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [candidate]);
    else bucket.push(candidate);
  }

  const pairs: DuplicatePairResult[] = [];
  let evaluatedPairs = 0;

  for (const bucket of buckets.values()) {
    for (let leftIndex = 0; leftIndex < bucket.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < bucket.length; rightIndex += 1) {
        const left = bucket[leftIndex];
        const right = bucket[rightIndex];
        if (left === undefined || right === undefined) continue;

        evaluatedPairs += 1;
        const result = evaluateDuplicatePair(left, right, settings);
        if (result.matched) pairs.push(result);
      }
    }
  }

  pairs.sort((left, right) => left.pairKey.localeCompare(right.pairKey));

  return {
    settings: { ...settings },
    suppressed: false,
    pairs,
    evaluatedPairs,
  };
}

/**
 * 批量分桶键：只包含任何设置下都必须相同的维度。
 *
 * 金额/币种/方向/账本任一缺失或非法 → 返回 `null`：这些组合不可能命中，
 * 不必进入逐对判断（单对函数仍会给出明确的排除码）。
 */
function batchBucketKey(candidate: DuplicateCandidateFields): string | null {
  if (candidate.bookId.trim() === "") return null;
  if (candidate.kind === "unknown") return null;
  if (!validAmount(candidate.amountCents)) return null;

  const currency = normalizeCurrency(candidate.currency);
  if (currency === null) return null;

  return `${candidate.bookId}\u0000${candidate.kind}\u0000${String(candidate.amountCents)}\u0000${currency}`;
}
