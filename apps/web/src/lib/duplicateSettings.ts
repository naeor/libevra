/**
 * 重复交易检测设置的浏览器本地持久化（S15-E2 第一轮）。
 *
 * ⚠️ **这是设备本地设置，不跨设备同步。** 本轮没有新增数据库迁移，服务端
 * `PATCH /api/v1/auth/me` 只承载 `defaultCurrency`，没有用户级偏好的 JSON 字段。
 * 所以设置按**用户 ID 隔离**存在 `localStorage`：
 *
 *   libellum.duplicate-detection.v1.account.<encodeURIComponent(userId)>
 *   libellum.duplicate-detection.v1.guest
 *
 * 局限与迁移方式写在 `docs/specs/features/S15-E2-统一重复检测规则-设计决定.md`：
 * 未来 E3+ 若增加服务端偏好，一次性迁移只需读取本模块的记录并写入服务端，
 * 键名与版本号已经预留。
 *
 * 三条边界：
 *  - **按用户隔离**：A 账号的设置永远不会被 B 账号读到（键里带用户 ID）；
 *  - **带版本号**：记录是 `{ version: 1, settings, updatedAt }`，版本不认识时用默认值，
 *    不猜测旧格式；
 *  - **损坏可恢复**：存储被手改/旧版本写坏时使用默认值并报告，不抛异常。
 *
 * 不在这里读写任何账目；也不影响幂等、权限与离线同步。
 */

import {
  DEFAULT_DUPLICATE_DETECTION_SETTINGS,
  DUPLICATE_TIME_WINDOW_MAX_SECONDS,
  recoverDuplicateDetectionSettings,
  validateDuplicateDetectionSettings,
  type DuplicateDetectionSettings,
  type DuplicateSettingsIssue,
} from "@libellum/shared";

import { t } from "../i18n/index.js";

/** 键前缀同时是清理范围：`clearAllDeviceData` 会删除所有以 `libellum` 开头的键。 */
export const DUPLICATE_SETTINGS_STORAGE_PREFIX = "libellum.duplicate-detection.v1";

/** 记录本身的版本号；改变字段语义时必须升版本并写迁移，不能静默复用。 */
export const DUPLICATE_SETTINGS_SCHEMA_VERSION = 1;

/** 设置所属的身份：正式账号按用户 ID 隔离，游客只有一个本地槽位。 */
export type DuplicateSettingsScope =
  | { readonly kind: "account"; readonly userId: string }
  | { readonly kind: "guest" };

/** 只依赖这三个方法；测试注入内存实现，不碰真实 localStorage。 */
export interface DuplicateSettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 浏览器里的默认存储；不可用（隐私模式/服务端渲染）时返回 null。 */
export function duplicateSettingsStorage(): DuplicateSettingsStorage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 存储键；账号 ID 编码后不会与分隔符冲突，也不会把特殊字符带进键名。 */
export function duplicateSettingsStorageKey(scope: DuplicateSettingsScope): string {
  return scope.kind === "guest"
    ? `${DUPLICATE_SETTINGS_STORAGE_PREFIX}.guest`
    : `${DUPLICATE_SETTINGS_STORAGE_PREFIX}.account.${encodeURIComponent(scope.userId)}`;
}

export interface DuplicateSettingsRecord {
  readonly version: typeof DUPLICATE_SETTINGS_SCHEMA_VERSION;
  readonly settings: DuplicateDetectionSettings;
  readonly updatedAt: string;
}

export type DuplicateSettingsStorageProblem = "unavailable" | "unreadable" | "version_mismatch";

export interface DuplicateSettingsLoadResult {
  readonly settings: DuplicateDetectionSettings;
  /** `stored` 完整命中；`recovered` 部分字段用了默认值；`default` 没有可用记录。 */
  readonly source: "stored" | "default" | "recovered";
  readonly issues: readonly DuplicateSettingsIssue[];
  readonly unknownFields: readonly string[];
  /** 存储层面的问题；与字段级 `issues` 分开，便于界面给出不同提示。 */
  readonly storageProblem: DuplicateSettingsStorageProblem | null;
}

function defaultResult(
  storageProblem: DuplicateSettingsStorageProblem | null,
): DuplicateSettingsLoadResult {
  return {
    settings: { ...DEFAULT_DUPLICATE_DETECTION_SETTINGS },
    source: "default",
    issues: [],
    unknownFields: [],
    storageProblem,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 读取某个身份的设置。
 *
 * 没有记录、存储不可用、JSON 损坏或版本不认识 → 默认值；记录里的部分字段非法 →
 * 该字段回落到默认值（`source: "recovered"`），并在 `issues` 里报告。
 */
export function loadDuplicateSettings(
  scope: DuplicateSettingsScope,
  storage: DuplicateSettingsStorage | null = duplicateSettingsStorage(),
): DuplicateSettingsLoadResult {
  if (storage === null) return defaultResult("unavailable");

  let text: string | null;
  try {
    text = storage.getItem(duplicateSettingsStorageKey(scope));
  } catch {
    return defaultResult("unreadable");
  }

  if (text === null) return defaultResult(null);

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return defaultResult("unreadable");
  }

  if (!isRecord(raw)) return defaultResult("unreadable");
  if (raw["version"] !== DUPLICATE_SETTINGS_SCHEMA_VERSION) {
    return defaultResult("version_mismatch");
  }

  const recovered = recoverDuplicateDetectionSettings(raw["settings"]);
  const source = recovered.issues.length === 0 && recovered.usedDefaults.length === 0
    ? "stored"
    : "recovered";

  return {
    settings: recovered.settings,
    source,
    issues: recovered.issues,
    unknownFields: recovered.unknownFields,
    storageProblem: null,
  };
}

export interface DuplicateSettingsSaveResult {
  readonly ok: boolean;
  /** 已经是一句可直接展示的话（调用时的界面语言）；成功时为 `null`。 */
  readonly error: string | null;
}

/**
 * 保存某个身份的设置。
 *
 * **写之前再严格校验一次**：未知字段、非整数窗口、负数等在这里被拒绝，不会把
 * “看起来保存了但没人读”的数据写进浏览器存储。
 */
export function saveDuplicateSettings(
  scope: DuplicateSettingsScope,
  settings: DuplicateDetectionSettings,
  storage: DuplicateSettingsStorage | null = duplicateSettingsStorage(),
): DuplicateSettingsSaveResult {
  if (storage === null) {
    return { ok: false, error: t("duplicates.settings.saveUnavailable") };
  }

  const validation = validateDuplicateDetectionSettings(settings);
  if (!validation.ok) {
    return { ok: false, error: t("duplicates.settings.saveInvalid") };
  }

  const record: DuplicateSettingsRecord = {
    version: DUPLICATE_SETTINGS_SCHEMA_VERSION,
    settings: validation.settings,
    updatedAt: new Date().toISOString(),
  };

  try {
    storage.setItem(duplicateSettingsStorageKey(scope), JSON.stringify(record));
    return { ok: true, error: null };
  } catch {
    return {
      ok: false,
      error: t("duplicates.settings.saveFailed"),
    };
  }
}

/** 删除某个身份的设置；返回是否真的执行了删除。 */
export function clearDuplicateSettings(
  scope: DuplicateSettingsScope,
  storage: DuplicateSettingsStorage | null = duplicateSettingsStorage(),
): boolean {
  if (storage === null) return false;

  try {
    storage.removeItem(duplicateSettingsStorageKey(scope));
    return true;
  } catch {
    return false;
  }
}

/**
 * 游客数据清理时调用：**只删游客槽位**，不碰任何正式账号的键。
 *
 * 与 `lib/guest/cleanup.ts` 的既有边界一致：清游客数据不能损坏同一浏览器里
 * 正式账号的离线副本或偏好。
 */
export function clearGuestDuplicateSettings(
  storage: DuplicateSettingsStorage | null = duplicateSettingsStorage(),
): boolean {
  return clearDuplicateSettings({ kind: "guest" }, storage);
}

// ---------------------------------------------------------------------------
// 时间窗口的界面换算
// ---------------------------------------------------------------------------

/** 自定义输入以“分钟”为单位，避免让用户面对 86400 这样的秒数。 */
export const DUPLICATE_TIME_WINDOW_CUSTOM_MIN_MINUTES = 1;

/** 30 天 = 43200 分钟，与核心上限一致。 */
export const DUPLICATE_TIME_WINDOW_CUSTOM_MAX_MINUTES =
  DUPLICATE_TIME_WINDOW_MAX_SECONDS / 60;

export type CustomTimeWindowParseResult =
  | { readonly ok: true; readonly seconds: number }
  | { readonly ok: false; readonly message: string };

/**
 * 解析“自定义时间窗口（分钟）”。
 *
 * 只接受正整数分钟：负数、小数、NaN、Infinity、空值、科学计数法都返回结构化错误，
 * 不抛异常。范围与核心一致（1 分钟–30 天）。
 */
export function parseCustomTimeWindowMinutes(input: string): CustomTimeWindowParseResult {
  const trimmed = input.trim();

  if (trimmed === "") {
    return { ok: false, message: t("duplicates.settings.customError.empty") };
  }
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, message: t("duplicates.settings.customError.notInteger") };
  }

  const minutes = Number(trimmed);
  if (!Number.isSafeInteger(minutes)) {
    return {
      ok: false,
      message: t("duplicates.settings.customError.tooLarge", {
        min: String(DUPLICATE_TIME_WINDOW_CUSTOM_MIN_MINUTES),
        max: String(DUPLICATE_TIME_WINDOW_CUSTOM_MAX_MINUTES),
      }),
    };
  }

  const seconds = minutes * 60;
  if (seconds < 60) {
    return { ok: false, message: t("duplicates.settings.customError.tooSmall") };
  }
  if (seconds > DUPLICATE_TIME_WINDOW_MAX_SECONDS) {
    return {
      ok: false,
      message: t("duplicates.settings.customError.overMax", {
        max: String(DUPLICATE_TIME_WINDOW_CUSTOM_MAX_MINUTES),
      }),
    };
  }

  return { ok: true, seconds };
}

/**
 * 把秒数说成人话：整天的说天、整小时的说小时、整分钟的说分钟，其余说秒。
 *
 * 调用时取文案（界面语言），不要在模块顶层调用后缓存结果。
 */
export function describeTimeWindowSeconds(seconds: number): string {
  if (seconds % 86_400 === 0) return t("duplicates.settings.window.days", { count: seconds / 86_400 });
  if (seconds % 3_600 === 0) return t("duplicates.settings.window.hours", { count: seconds / 3_600 });
  if (seconds % 60 === 0) return t("duplicates.settings.window.minutes", { count: seconds / 60 });

  return t("duplicates.settings.window.seconds", { count: seconds });
}
