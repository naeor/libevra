/**
 * S17 · I-1a：布局数据链路纯函数（Agent D · 集成胶水层）。
 *
 * 链路：`AnalysisReference` → `validateAnalysisParams`（G-12a v1.1）
 *      → `projectLayout`（跨列确定性迁移）
 *      → 文档 serialize / parse / validate / roundTrip（D-1/D-4 纯函数）。
 *
 * 约束（Lead m02598 批准范围）：
 * - 纯函数：无 I/O、无 DOM、无时钟、无随机、不读视口、不写回权威布局；
 * - 不接页面/路由/API、不加迁移、不改 S-01/S-03 契约；
 * - 不修改输入对象（校验/投影/序列化全部只读消费）；
 * - 未知字段保留（校验通过时原样返回输入，序列化只做 JSON 化）。
 *
 * 本文件属于 D 的 `workbench/` 集成胶水目录，刻意不放进 `analysis/layout/`，
 * 也不并入 `packages/shared/src/index.ts` 的顶层公开面（待 Lead 批准集成批次）。
 */

import type {
  LayoutDocumentV1,
  ProjectionResult,
  WorkbenchContentDocumentV1,
} from "../analysis/layout/types.js";
import type { ProjectOptions, MigrationStrategy } from "../analysis/layout/types.js";
import { projectLayout } from "../analysis/layout/projection.js";
import type { AnalysisParamsValidationOptions } from "../analysis/layout/params-validation.js";
import { validateAnalysisParams } from "../analysis/layout/params-validation.js";
import {
  parseContentDocumentV1,
  parseLayoutDocumentV1,
  serializeContentDocumentV1,
  serializeLayoutDocumentV1,
  validateContentDocumentV1,
  validateLayoutDocumentV1,
} from "../analysis/layout/validation.js";
import {
  roundTripContentDocument,
  roundTripLayoutDocument,
} from "../analysis/layout/document-io.js";
import type { DocumentValidationIssue } from "../analysis/layout/validation.js";

/** I-1a 输出文档对（已通过校验与序列化往返自检）。 */
export interface LayoutPipelineDocuments {
  /** 内容文档 JSON（账号共有：卡片身份/分析引用/图表配置/容器树）。 */
  readonly contentJson: string;
  /** 布局文档 JSON（主布局+档案；Spacer 只在这里）。 */
  readonly layoutJson: string;
}

/** 统一问题条目：`severity="error"` 表示 `ok=false`；`warning` 只提示不阻断。 */
export interface LayoutPipelineIssue {
  readonly path: string;
  readonly code: string;
  readonly detail: string;
  readonly severity: "error" | "warning";
}

export interface LayoutPipelineOptions {
  /** 目标列数（投影列数；1–12，非法时返回 error 并按安全默认 2 列投影）。 */
  readonly targetColumns: number;
  /** 卡片/容器尺寸契约（W3 由卡片家族声明；缺省按 1×1 占位并记录 missing-contract）。 */
  readonly contracts?: ProjectOptions["contracts"];
  /** 迁移策略：默认 `size-first`（OQ-LM-01 已锁定）；`position-first` 仅作对照。 */
  readonly strategy?: MigrationStrategy;
  /** 垂直紧凑开关（OQ-LM-03 未决，默认 false）。 */
  readonly verticalCompact?: boolean;
  /** 当前分析目录版本串（G-12a：`analysisVersion` 非等值 → 只读占位）。 */
  readonly currentAnalysisVersion?: string;
  /** 覆盖已知 analysisId 集合（默认内置 G-12a 26 项）。 */
  readonly knownAnalysisIds?: readonly string[];
}

export interface LayoutPipelineResult {
  /** 无 error 级问题时为 true（warning 不影响）。 */
  readonly ok: boolean;
  /** 校验通过的内容文档（原样返回；失败时不提供）。 */
  readonly content?: WorkbenchContentDocumentV1;
  /** 校验通过的布局文档（原样返回；失败时不提供）。 */
  readonly layout?: LayoutDocumentV1;
  /** 主布局投影结果（目标列数；仍可能含 warning 级投影问题）。 */
  readonly projection?: ProjectionResult;
  /** 两个文档的序列化结果（序列化往返自检通过后提供）。 */
  readonly documents?: LayoutPipelineDocuments;
  readonly issues: readonly LayoutPipelineIssue[];
}

/** 管线输入：两条文档都可以是已解析对象或 JSON 字符串（损坏时返回 issues，不抛异常）。 */
export interface LayoutPipelineInput {
  readonly content: unknown;
  readonly layout: unknown;
}

interface LoadedDocument<T> {
  readonly ok: boolean;
  readonly document?: T;
  readonly issues: readonly DocumentValidationIssue[];
}

function loadDocument<T>(
  raw: unknown,
  kind: "content" | "layout",
): LoadedDocument<T> {
  const root = kind === "content" ? "content" : "layout";
  if (typeof raw === "string") {
    const parsed =
      kind === "content"
        ? (parseContentDocumentV1(raw) as
            | { ok: true; value: T }
            | { ok: false; issues: readonly DocumentValidationIssue[] })
        : (parseLayoutDocumentV1(raw) as
            | { ok: true; value: T }
            | { ok: false; issues: readonly DocumentValidationIssue[] });
    if (parsed.ok) {
      return { ok: true, document: parsed.value, issues: [] };
    }
    return {
      ok: false,
      issues: parsed.issues.map((issue) => ({
        path: prefixPath(root, issue.path),
        code: issue.code,
        detail: issue.detail,
      })),
    };
  }
  const validated =
    kind === "content"
      ? (validateContentDocumentV1(raw) as
          | { ok: true; value: T }
          | { ok: false; issues: readonly DocumentValidationIssue[] })
      : (validateLayoutDocumentV1(raw) as
          | { ok: true; value: T }
          | { ok: false; issues: readonly DocumentValidationIssue[] });
  if (validated.ok) {
    return { ok: true, document: validated.value, issues: [] };
  }
  return {
    ok: false,
    issues: validated.issues.map((issue) => ({
      path: prefixPath(root, issue.path),
      code: issue.code,
      detail: issue.detail,
    })),
  };
}

/** `$` → `content`；`$.cards[0]` → `content.cards[0]`。 */
function prefixPath(prefix: string, path: string): string {
  if (path.length === 0 || path === "$") {
    return prefix;
  }
  const trimmed = path.startsWith("$.") ? path.slice(2) : path.replace(/^\$/, "");
  return `${prefix}.${trimmed}`;
}

function asDocumentIssue(
  path: string,
  code: string,
  detail: string,
  severity: "error" | "warning",
): LayoutPipelineIssue {
  return { path, code, detail, severity };
}

/** 内容对象身份集合（卡片+容器，不含 Spacer —— Spacer 只在布局文档）。 */
function contentObjectIds(content: WorkbenchContentDocumentV1): {
  readonly ids: ReadonlySet<string>;
  readonly typeById: ReadonlyMap<string, string>;
} {
  const typeById = new Map<string, string>();
  for (const card of content.cards) {
    typeById.set(card.objectId, card.type);
  }
  for (const container of content.containers) {
    typeById.set(container.objectId, container.type);
    for (const childId of container.children) {
      // 子对象仍是卡片身份；不单独注册为新对象。
      void childId;
    }
  }
  return { ids: new Set(typeById.keys()), typeById };
}

/** 校验单卡片上的 `AnalysisReference`（G-12a v1.1）；返回 error/warning 级问题。 */
function validateCardReferences(
  content: WorkbenchContentDocumentV1,
  options: LayoutPipelineOptions,
): readonly LayoutPipelineIssue[] {
  const issues: LayoutPipelineIssue[] = [];
  const paramsOptions: AnalysisParamsValidationOptions = {
    ...(options.currentAnalysisVersion !== undefined
      ? { currentAnalysisVersion: options.currentAnalysisVersion }
      : {}),
    ...(options.knownAnalysisIds !== undefined
      ? { knownAnalysisIds: options.knownAnalysisIds }
      : {}),
  };
  for (let index = 0; index < content.cards.length; index += 1) {
    const card = content.cards[index];
    if (card === undefined) {
      continue;
    }
    const result = validateAnalysisParams(card.analysis, paramsOptions);
    const basePath = `content.cards[${index}].analysis`;
    for (const issue of result.issues) {
      const path = issue.path.length === 0 ? basePath : `${basePath}.${issue.path}`;
      issues.push(
        asDocumentIssue(
          path,
          issue.code,
          issue.detail,
          result.status === "invalid" ? "error" : "warning",
        ),
      );
    }
    if (result.status === "readonly") {
      issues.push(
        asDocumentIssue(
          basePath,
          "pipeline-readonly-analysis",
          `分析引用只读占位（${String(result.readonlyReason ?? "unknown")}）：保留原配置，不回写、不自动改参数`,
          "warning",
        ),
      );
    }
  }
  return issues;
}

/** 跨文档身份一致性（布局对象必须来自内容文档；Spacer 除外）。 */
function checkCrossDocumentIntegrity(
  content: WorkbenchContentDocumentV1,
  layout: LayoutDocumentV1,
): readonly LayoutPipelineIssue[] {
  const issues: LayoutPipelineIssue[] = [];
  const { ids: contentIds, typeById } = contentObjectIds(content);
  const layoutIds = new Set<string>();

  for (const geometry of layout.main.objects) {
    if (layoutIds.has(geometry.objectId)) {
      issues.push(
        asDocumentIssue(
          `layout.main.objects`,
          "pipeline-duplicate-layout-object",
          `布局对象 ID 重复：${geometry.objectId}`,
          "error",
        ),
      );
    }
    layoutIds.add(geometry.objectId);

    const contentType = typeById.get(geometry.objectId);
    if (geometry.objectType === "spacer") {
      if (contentIds.has(geometry.objectId)) {
        issues.push(
          asDocumentIssue(
            `layout.main.objects`,
            "pipeline-spacer-shadowing-content",
            `Spacer 与内容对象共用 objectId：${geometry.objectId}`,
            "error",
          ),
        );
      }
      continue;
    }
    if (contentType === undefined) {
      issues.push(
        asDocumentIssue(
          `layout.main.objects`,
          "pipeline-orphan-layout-object",
          `布局对象在内容文档中不存在：${geometry.objectId}`,
          "error",
        ),
      );
      continue;
    }
    if (contentType !== geometry.objectType) {
      issues.push(
        asDocumentIssue(
          `layout.main.objects`,
          "pipeline-object-type-mismatch",
          `布局对象类型（${geometry.objectType}）与内容对象类型（${contentType}）不一致：${geometry.objectId}`,
          "error",
        ),
      );
    }
  }

  for (const objectId of contentIds) {
    if (!layoutIds.has(objectId)) {
      issues.push(
        asDocumentIssue(
          "content",
          "pipeline-unplaced-content-object",
          `内容对象尚未在布局中定位（投影不会自动补位，需用户在编辑态放置）：${objectId}`,
          "warning",
        ),
      );
    }
  }
  return issues;
}

/** 运行 I-1a 纯数据链路。纯函数：不修改输入、不写回、不抛异常。 */
export function runLayoutPipeline(
  input: LayoutPipelineInput,
  options: LayoutPipelineOptions,
): LayoutPipelineResult {
  const issues: LayoutPipelineIssue[] = [];

  const contentLoaded = loadDocument<WorkbenchContentDocumentV1>(
    input.content,
    "content",
  );
  const layoutLoaded = loadDocument<LayoutDocumentV1>(input.layout, "layout");
  for (const issue of contentLoaded.issues) {
    issues.push(
      asDocumentIssue(issue.path, issue.code, issue.detail, "error"),
    );
  }
  for (const issue of layoutLoaded.issues) {
    issues.push(
      asDocumentIssue(issue.path, issue.code, issue.detail, "error"),
    );
  }
  const content = contentLoaded.document;
  const layout = layoutLoaded.document;
  if (!contentLoaded.ok || !layoutLoaded.ok || content === undefined || layout === undefined) {
    return { ok: false, issues };
  }

  // 1) 卡片引用校验（G-12a v1.1）：invalid → error；readonly → warning。
  issues.push(...validateCardReferences(content, options));

  // 2) 跨文档身份一致性（孤儿/类型不一致/未定位）。
  issues.push(...checkCrossDocumentIntegrity(content, layout));

  // 3) 目标列数校验；非法时仍按安全默认投影但整条链路 ok=false。
  const targetColumnsValid =
    Number.isInteger(options.targetColumns) &&
    options.targetColumns >= 1 &&
    options.targetColumns <= 12;
  if (!targetColumnsValid) {
    issues.push(
      asDocumentIssue(
        "options.targetColumns",
        "pipeline-invalid-target-columns",
        `目标列数非法（${String(options.targetColumns)}）：应为 1–12 的整数`,
        "error",
      ),
    );
  }

  // 4) 投影（只读消费主布局；档案留给独立模式批次）。
  const projection = projectLayout(layout.main, content, {
    targetColumns: options.targetColumns,
    ...(options.contracts !== undefined ? { contracts: options.contracts } : {}),
    ...(options.strategy !== undefined ? { strategy: options.strategy } : {}),
    ...(options.verticalCompact !== undefined
      ? { verticalCompact: options.verticalCompact }
      : {}),
  });
  for (const issue of projection.issues) {
    issues.push(
      asDocumentIssue(
        issue.objectId === undefined ? "projection" : `projection.${issue.objectId}`,
        `pipeline-projection-${issue.reason}`,
        issue.detail,
        "warning",
      ),
    );
  }

  // 5) 序列化 + 序列化往返自检（逐字节一致）。
  let contentJson: string;
  let layoutJson: string;
  try {
    contentJson = serializeContentDocumentV1(content);
    layoutJson = serializeLayoutDocumentV1(layout);
  } catch (error: unknown) {
    issues.push(
      asDocumentIssue(
        "$",
        "pipeline-serialize-failed",
        `文档序列化失败：${error instanceof Error ? error.message : String(error)}`,
        "error",
      ),
    );
    return { ok: false, content, layout, projection, issues };
  }

  const contentRoundTrip = roundTripContentDocument(content);
  const layoutRoundTrip = roundTripLayoutDocument(layout);
  for (const issue of contentRoundTrip.issues) {
    issues.push(
      asDocumentIssue(
        prefixPath("content.roundtrip", issue.path),
        issue.code,
        issue.detail,
        "error",
      ),
    );
  }
  for (const issue of layoutRoundTrip.issues) {
    issues.push(
      asDocumentIssue(
        prefixPath("layout.roundtrip", issue.path),
        issue.code,
        issue.detail,
        "error",
      ),
    );
  }

  const documents: LayoutPipelineDocuments = { contentJson, layoutJson };
  const ok = issues.every((issue) => issue.severity !== "error");
  return { ok, content, layout, projection, documents, issues };
}
