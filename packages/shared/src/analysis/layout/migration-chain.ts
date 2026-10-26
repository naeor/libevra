/**
 * D-4 前置：配置版本迁移链（vN → vN+1）与投影缓存键派生。
 *
 * 口径来源：S-03 布局侧接口草案 §4（Lead 裁定：迁移函数签名纳入版本契约，
 * 纯函数、逐版本节点降级；缓存键派生仅作实现约定、不进冻结契约）。
 *
 * 本文件只提供**迁移链基础设施**与 S-03 契约签名：
 * - 当前最新 schemaVersion = 1，注册表为空（v1 即最新，尚无 v2）；
 * - 首次出现 v2 时只需向 `LAYOUT_MIGRATION_STEPS` / `CONTENT_MIGRATION_STEPS`
 *   追加一步纯函数，链式执行、失败降级、只读新版本等语义已就绪并有测试。
 *
 * 纯函数：不读时钟/随机/视口；迁移失败不抛异常，返回降级结果与问题码。
 */

import type { LayoutDocumentV1, MigrationStrategy, WorkbenchContentDocumentV1 } from "./types.js";
import { LAYOUT_SCHEMA_VERSION } from "./types.js";
import type { DocumentValidationIssue, DocumentValidationResult } from "./validation.js";
import { validateContentDocumentV1, validateLayoutDocumentV1 } from "./validation.js";

/** 迁移链执行后的状态。 */
export type MigrationStatus =
  | "identity"
  | "migrated"
  | "degraded"
  | "failed"
  | "read-only-newer";

/** 一步迁移：`from` 版本 → `to` 版本的纯函数；失败返回问题列表，由链降级。 */
export interface MigrationStep<T> {
  readonly from: number;
  readonly to: number;
  readonly migrate: (value: unknown) => DocumentValidationResult<T>;
}

/** 迁移链结果：`value` 只在 ok 时提供；`issues` 记录失败/降级原因。 */
export interface MigrationChainResult<T> {
  readonly ok: boolean;
  readonly status: MigrationStatus;
  readonly value?: T;
  readonly issues: readonly DocumentValidationIssue[];
  /** 实际执行的步骤，例如 `["v1->v2"]`；identity/失败时可为空。 */
  readonly appliedSteps: readonly string[];
}

export interface MigrationChainOptions<T> {
  /** 按 from 版本索引的步骤表（可空；v1 为最新时为空）。 */
  readonly steps: readonly MigrationStep<T>[];
  /** 当前代码支持的版本（本仓为 `LAYOUT_SCHEMA_VERSION`）。 */
  readonly targetVersion: number;
  /** 最终结构校验器（复用 D-1 validation）。 */
  readonly validate: (value: unknown) => DocumentValidationResult<T>;
}

/** 布局文档迁移步骤注册表。v1 是当前最新版本，因此为空；v2 出现时在此追加。 */
export const LAYOUT_MIGRATION_STEPS: readonly MigrationStep<LayoutDocumentV1>[] = [];

/** 内容文档迁移步骤注册表（与布局文档各自独立版本）。 */
export const CONTENT_MIGRATION_STEPS: readonly MigrationStep<WorkbenchContentDocumentV1>[] = [];

/** 读取值自带的 `schemaVersion`（整数）；缺失/非对象返回 null。 */
export function readDeclaredSchemaVersion(value: unknown): number | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const version = (value as Readonly<Record<string, unknown>>)["schemaVersion"];
  return typeof version === "number" && Number.isInteger(version) ? version : null;
}

function issue(path: string, code: string, detail: string): DocumentValidationIssue {
  return { path, code, detail };
}

/**
 * 执行迁移链。
 *
 * 规则（与 S-03 §4 对齐）：
 * - 声明版本 = 目标版本：严格校验后原样返回（identity）；
 * - 声明版本 < 目标版本：按 from 版本逐步执行；缺失步骤 → failed；
 *   某一步失败 → **保留迁移前最后一份合法文档**并标记 degraded（逐节点降级的基础形态，
 *   节点级拆分在首个真实 v2 迁移时随步骤实现）；
 * - 声明版本 > 目标版本：只读尽力（read-only-newer），绝不回写、不删未知字段。
 */
export function runMigrationChain<T>(
  value: unknown,
  options: MigrationChainOptions<T>,
): MigrationChainResult<T> {
  const declared = readDeclaredSchemaVersion(value);
  if (declared === null) {
    const validated = options.validate(value);
    return {
      ok: false,
      status: "failed",
      issues: validated.ok
        ? [issue("$.schemaVersion", "invalid-schema-version", "缺少整数 schemaVersion，无法选择迁移链")]
        : validated.issues,
      appliedSteps: [],
    };
  }

  if (declared > options.targetVersion) {
    const validated = options.validate(value);
    const readonlyIssue = issue(
      "$.schemaVersion",
      "schema-newer-readonly",
      `文档版本 v${declared} 高于当前支持的 v${options.targetVersion}，只读尽力渲染、不回写`,
    );
    return {
      ok: validated.ok,
      status: "read-only-newer",
      ...(validated.ok ? { value: validated.value } : {}),
      issues: validated.ok ? [readonlyIssue] : [...validated.issues, readonlyIssue],
      appliedSteps: [],
    };
  }

  if (declared === options.targetVersion) {
    const validated = options.validate(value);
    if (!validated.ok) {
      return { ok: false, status: "identity", issues: validated.issues, appliedSteps: [] };
    }
    return { ok: true, status: "identity", value: validated.value, issues: [], appliedSteps: [] };
  }

  let currentVersion = declared;
  let currentValue: unknown = value;
  const appliedSteps: string[] = [];

  while (currentVersion < options.targetVersion) {
    const step = options.steps.find((candidate) => candidate.from === currentVersion);
    if (step === undefined) {
      return {
        ok: false,
        status: "failed",
        issues: [
          issue(
            "$.schemaVersion",
            "missing-migration-step",
            `缺少 v${currentVersion} 的迁移步骤，无法升级到 v${options.targetVersion}`,
          ),
        ],
        appliedSteps,
      };
    }
    const migrated = step.migrate(currentValue);
    if (!migrated.ok) {
      const validated = options.validate(currentValue);
      const degradedIssues: DocumentValidationIssue[] = [
        issue(
          "$",
          "migration-failed",
          `v${step.from}→v${step.to} 迁移失败，保留迁移前文档并标记待修复`,
        ),
        ...migrated.issues,
      ];
      return {
        ok: validated.ok,
        status: "degraded",
        ...(validated.ok ? { value: validated.value } : {}),
        issues: degradedIssues,
        appliedSteps,
      };
    }
    currentValue = migrated.value;
    currentVersion = step.to;
    appliedSteps.push(`v${step.from}->v${step.to}`);
  }

  const finalValidated = options.validate(currentValue);
  if (!finalValidated.ok) {
    return {
      ok: false,
      status: "migrated",
      issues: finalValidated.issues,
      appliedSteps,
    };
  }
  return {
    ok: true,
    status: "migrated",
    value: finalValidated.value,
    issues: [],
    appliedSteps,
  };
}

/** 布局文档迁移入口：当前 v1 即最新，等价于 identity + 严格校验。 */
export function migrateLayoutDocument(value: unknown): MigrationChainResult<LayoutDocumentV1> {
  return runMigrationChain(value, {
    steps: LAYOUT_MIGRATION_STEPS,
    targetVersion: LAYOUT_SCHEMA_VERSION,
    validate: validateLayoutDocumentV1,
  });
}

/** 内容文档迁移入口（与布局文档各自独立版本链）。 */
export function migrateContentDocument(
  value: unknown,
): MigrationChainResult<WorkbenchContentDocumentV1> {
  return runMigrationChain(value, {
    steps: CONTENT_MIGRATION_STEPS,
    targetVersion: LAYOUT_SCHEMA_VERSION,
    validate: validateContentDocumentV1,
  });
}

/**
 * 投影缓存键输入：只有这些值变化才允许复用缓存（布局规格 §14：
 * 缓存键 = 权威布局版本 + 目标列数 + 约束版本 + 策略版本；内容版本一并纳入，
 * 因为卡片/容器身份变化会影响投影对象集合）。
 */
export interface ProjectionCacheKeyInput {
  readonly layoutVersion: number | string;
  readonly contentVersion: number | string;
  readonly layoutAlgorithmVersion: number;
  readonly targetColumns: number;
  readonly constraintsVersion: string;
  readonly strategy?: MigrationStrategy;
}

/**
 * 派生投影缓存键（确定性字符串）。
 *
 * 注意：这是**实现约定**（S-03 §4 裁定缓存键派生不进冻结契约），
 * 变更键格式只影响缓存命中率，不影响投影/迁移语义。
 */
export function deriveProjectionCacheKey(input: ProjectionCacheKeyInput): string {
  const strategy = input.strategy ?? "size-first";
  return [
    `layout=${String(input.layoutVersion)}`,
    `content=${String(input.contentVersion)}`,
    `algo=${String(input.layoutAlgorithmVersion)}`,
    `cols=${String(input.targetColumns)}`,
    `constraints=${input.constraintsVersion}`,
    `strategy=${strategy}`,
  ].join("|");
}
