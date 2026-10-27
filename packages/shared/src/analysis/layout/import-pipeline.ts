/**
 * D-4 前置：分享快照导入的端到端纯函数管道。
 *
 * 流程（与 S-17 配置与分享方案 §6.5 对齐）：
 * 解析/校验快照 → 重生成所有对象 ID（含容器 child 引用重写）→ 复用 D-1 校验器
 * → 复用 D-3 `repairLayoutGeometry` 修复锚点/尺寸 → 可选投影 dry-run → 待绑定清单。
 *
 * 边界：
 * - **纯函数**：不写数据库、不调服务端、不读时钟/随机数；ID 生成与本机目录解析
 *   均由调用方通过参数注入（测试使用固定种子/确定性工厂）；
 * - 保存前不改当前布局：本函数只返回候选文档与问题，保存动作留给上层；
 * - 引用缺失是**待绑定占位**（Q-15），不是导入失败；导入侧永远重新校验、不信任客户端。
 */

import type {
  AnalysisCardNode,
  AnalysisReference,
  CardTitleSpec,
  ChartPresentation,
  ContainerNode,
  GridSplitNode,
  LayoutDocumentV1,
  LayoutGeometry,
  LayoutObjectKind,
  LayoutProfile,
  ObjectGeometry,
  ObjectSizeContract,
  RangePolicy,
  WorkbenchContentDocumentV1,
} from "./types.js";
import {
  LAYOUT_ALGORITHM_VERSION,
  LAYOUT_SCHEMA_VERSION,
  MAX_COLUMNS,
  MAX_OBJECTS_PER_WORKBENCH,
} from "./types.js";
import type { DocumentValidationIssue } from "./validation.js";
import { validateContentDocumentV1, validateLayoutDocumentV1 } from "./validation.js";
import { projectLayout } from "./projection.js";
import { repairLayoutGeometry } from "./repair.js";
import type { ShareContainerPayload, ShareSnapshotV1 } from "./share-snapshot.js";
import { parseShareSnapshot, parseShareSnapshotJson } from "./share-snapshot.js";

/** ID 生成器：导入时所有实例/容器/Spacer ID 都重新生成（不沿用快照内 ID）。 */
export type ImportObjectIdFactory = (kind: LayoutObjectKind) => string;

export interface ShareImportOptions {
  /** 必填：ID 工厂（生产由上层提供随机 UUID，测试提供确定性工厂）。 */
  readonly generateObjectId: ImportObjectIdFactory;
  /** 可选：导入预览的目标列数（dry-run 投影，不写回）。 */
  readonly targetColumns?: number;
  /** 可选：卡片尺寸契约（W3 后由卡片家族声明；缺失时投影记 missing-contract）。 */
  readonly contracts?: Readonly<Record<string, ObjectSizeContract>>;
  /** 可选：接收者分析目录解析；返回 unknown 的加入待绑定清单。 */
  readonly resolveAnalysis?: (reference: AnalysisReference) => "known" | "unknown";
  /**
   * 可选：分析定义版本解析（S-01 v2 §6.1 / G-12b）。
   * 返回 `newer`/`unknown` 时按**只读占位**处理：保留引用与参数、不自动改版本、
   * 不回写、不删未知字段，只提示用户更新（导入为新副本，不改现有工作台）。
   */
  readonly resolveAnalysisVersion?: (
    reference: AnalysisReference,
  ) => "current" | "newer" | "unknown";
  /** 可选：接收者已知图表家族；缺失/未知时记录提示（降级由投影执行）。 */
  readonly knownChartFamilies?: readonly string[];
}

/** 待绑定占位：引用缺失，需用户重选（Q-15），不自动绑定。 */
export interface ImportRebindRequest {
  readonly objectId: string;
  readonly analysisId: string;
}

/** 导入预览：只用于确认页展示，不参与保存。 */
export interface ImportPreview {
  readonly cards: number;
  readonly containers: number;
  readonly spacers: number;
  readonly rebindRequests: number;
  readonly projectionIssueCount: number;
  readonly targetColumns: number | null;
}

export interface ShareImportResult {
  readonly ok: boolean;
  readonly content?: WorkbenchContentDocumentV1;
  readonly layout?: LayoutDocumentV1;
  readonly issues: readonly DocumentValidationIssue[];
  readonly rebindRequests: readonly ImportRebindRequest[];
  readonly preview?: ImportPreview;
}

function issue(path: string, code: string, detail: string): DocumentValidationIssue {
  return { path, code, detail };
}

interface MutableCard {
  objectId: string;
  type: "analysis-card";
  analysis: AnalysisReference;
  chart: ChartPresentation;
  title?: CardTitleSpec;
  rangePolicy: RangePolicy;
  pinnedRange?: { readonly from: string; readonly to: string };
}

function toRemappedCard(payload: AnalysisCardNode, objectId: string): AnalysisCardNode {
  const card: MutableCard = {
    objectId,
    type: "analysis-card",
    analysis: payload.analysis,
    chart: payload.chart,
    rangePolicy: payload.rangePolicy,
  };
  if (payload.title !== undefined) {
    card.title = payload.title;
  }
  if (payload.pinnedRange !== undefined) {
    card.pinnedRange = { from: payload.pinnedRange.from, to: payload.pinnedRange.to };
  }
  return card;
}

function toRemappedContainer(
  payload: ShareContainerPayload,
  objectId: string,
  idMap: ReadonlyMap<string, string>,
): ContainerNode {
  const children = payload.children.map((child) => idMap.get(child) ?? child);
  if (payload.type === "grid-split") {
    const container: GridSplitNode = {
      objectId,
      type: "grid-split",
      children,
      split: {
        columnSplitPermille: payload.split.columnSplitPermille,
        rowSplitPermille: payload.split.rowSplitPermille,
      },
    };
    return container;
  }
  return { objectId, type: "carousel", children };
}

function toRemappedObject(source: ObjectGeometry, idMap: ReadonlyMap<string, string>): ObjectGeometry {
  const object: {
    objectId: string;
    objectType: ObjectGeometry["objectType"];
    anchor: number;
    colSpan: number;
    rowSpan: number;
    presentation?: "full" | "collapsed";
    expandedSize?: { readonly colSpan: number; readonly rowSpan: number };
  } = {
    objectId: idMap.get(source.objectId) ?? source.objectId,
    objectType: source.objectType,
    anchor: source.anchor,
    colSpan: source.colSpan,
    rowSpan: source.rowSpan,
  };
  if (source.presentation !== undefined) {
    object.presentation = source.presentation;
  }
  if (source.expandedSize !== undefined) {
    object.expandedSize = {
      colSpan: source.expandedSize.colSpan,
      rowSpan: source.expandedSize.rowSpan,
    };
  }
  return object;
}

function remapGeometry(source: LayoutGeometry, idMap: ReadonlyMap<string, string>): LayoutGeometry {
  return { baseCols: source.baseCols, objects: source.objects.map((object) => toRemappedObject(object, idMap)) };
}

interface IdMapBuildResult {
  readonly idMap: ReadonlyMap<string, string>;
  readonly issues: readonly DocumentValidationIssue[];
}

function buildIdMap(snapshot: ShareSnapshotV1, factory: ImportObjectIdFactory): IdMapBuildResult {
  const idMap = new Map<string, string>();
  const used = new Set<string>();
  const issues: DocumentValidationIssue[] = [];

  const assign = (oldId: string, kind: LayoutObjectKind, path: string): void => {
    if (idMap.has(oldId)) {
      return;
    }
    const generated = factory(kind);
    if (typeof generated !== "string" || generated.trim().length === 0) {
      issues.push(issue(path, "invalid-generated-id", "ID 工厂返回了空 ID"));
      return;
    }
    if (used.has(generated)) {
      issues.push(issue(path, "duplicate-object-id", `ID 工厂返回了重复 ID：${generated}`));
      return;
    }
    used.add(generated);
    idMap.set(oldId, generated);
  };

  for (let index = 0; index < snapshot.cards.length; index += 1) {
    assign(snapshot.cards[index]?.objectId ?? "", "analysis-card", `$.cards[${String(index)}]`);
  }
  for (let index = 0; index < snapshot.containers.length; index += 1) {
    assign(snapshot.containers[index]?.objectId ?? "", snapshot.containers[index]?.type ?? "carousel", `$.containers[${String(index)}]`);
  }
  // Spacer 只存在于布局文档：先扫主布局，再扫档案，保证同一旧 ID 只映射一次。
  for (const object of snapshot.layout.main.objects) {
    if (object.objectType === "spacer") {
      assign(object.objectId, "spacer", "$.layout.main.objects");
    }
  }
  if (snapshot.layout.profiles !== undefined) {
    for (const profile of snapshot.layout.profiles) {
      for (const object of profile.geometry.objects) {
        if (object.objectType === "spacer") {
          assign(object.objectId, "spacer", "$.layout.profiles");
        }
      }
    }
  }
  return { idMap, issues };
}

function repairIssues(path: string, repairs: readonly { objectId?: string; code: string; detail: string }[]): readonly DocumentValidationIssue[] {
  return repairs.map((repair) =>
    issue(
      repair.objectId === undefined ? path : `${path}[${repair.objectId}]`,
      `repaired-${repair.code}`,
      repair.detail,
    ),
  );
}

/**
 * 端到端导入准备（纯函数）：快照（对象或 JSON 字符串）→ 候选内容/布局文档 + 问题 + 预览。
 * 调用方确认后才保存；本函数从不修改当前布局，也不写任何存储。
 */
export function prepareShareImport(
  input: string | unknown,
  options: ShareImportOptions,
): ShareImportResult {
  const parsed =
    typeof input === "string" ? parseShareSnapshotJson(input) : parseShareSnapshot(input);
  if (!parsed.ok) {
    return { ok: false, issues: parsed.issues, rebindRequests: [] };
  }
  const snapshot = parsed.value;
  const idMapResult = buildIdMap(snapshot, options.generateObjectId);
  const issues: DocumentValidationIssue[] = [...idMapResult.issues];
  if (issues.length > 0) {
    return { ok: false, issues, rebindRequests: [] };
  }
  const idMap = idMapResult.idMap;

  const cards: AnalysisCardNode[] = snapshot.cards.map((card) =>
    toRemappedCard(card, idMap.get(card.objectId) ?? card.objectId),
  );
  const containers: ContainerNode[] = snapshot.containers.map((container) =>
    toRemappedContainer(container, idMap.get(container.objectId) ?? container.objectId, idMap),
  );

  const mainRepaired = repairLayoutGeometry(remapGeometry(snapshot.layout.main, idMap));
  issues.push(...repairIssues("$.layout.main.objects", mainRepaired.repairs));
  let profiles: readonly LayoutProfile[] | undefined =
    snapshot.layout.profiles === undefined
      ? undefined
      : snapshot.layout.profiles.map((profile) => {
          const repaired = repairLayoutGeometry(remapGeometry(profile.geometry, idMap));
          issues.push(...repairIssues(`$.layout.profiles[${profile.profileKey}]`, repaired.repairs));
          return { profileKey: profile.profileKey, geometry: repaired.geometry };
        });

  const layout: LayoutDocumentV1 = {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    layoutAlgorithmVersion: LAYOUT_ALGORITHM_VERSION,
    mode: snapshot.layout.mode,
    main: mainRepaired.geometry,
  };
  const content: WorkbenchContentDocumentV1 = { schemaVersion: LAYOUT_SCHEMA_VERSION, cards, containers };

  const contentValidated = validateContentDocumentV1(content);
  if (!contentValidated.ok) {
    return { ok: false, issues: [...issues, ...contentValidated.issues], rebindRequests: [] };
  }
  const layoutWithProfiles: LayoutDocumentV1 =
    profiles !== undefined && profiles.length > 0 ? { ...layout, profiles } : layout;
  const layoutValidated = validateLayoutDocumentV1(layoutWithProfiles);
  if (!layoutValidated.ok) {
    return { ok: false, issues: [...issues, ...layoutValidated.issues], rebindRequests: [] };
  }

  // 跨文档一致性：布局对象必须对应内容文档对象（Spacer 除外）。
  const contentIds = new Set<string>([
    ...cards.map((card) => card.objectId),
    ...containers.map((container) => container.objectId),
  ]);
  for (const object of layoutValidated.value.main.objects) {
    if (object.objectType !== "spacer" && !contentIds.has(object.objectId)) {
      issues.push(issue("$.layout.main.objects", "orphan-layout-object", `布局对象在内容文档中不存在：${object.objectId}`));
    }
  }
  if (issues.some((item) => item.code === "orphan-layout-object")) {
    return { ok: false, issues, rebindRequests: [] };
  }

  // 待绑定清单（Q-15）：引用缺失只登记，不移除卡片、不自动绑定。
  const rebindRequests: ImportRebindRequest[] = [];
  if (options.resolveAnalysis !== undefined) {
    for (const card of cards) {
      if (options.resolveAnalysis(card.analysis) === "unknown") {
        rebindRequests.push({ objectId: card.objectId, analysisId: card.analysis.analysisId });
        issues.push(
          issue(
            "$.cards",
            "analysis-needs-rebind",
            `分析引用无法解析，保留待绑定占位：${card.analysis.analysisId}`,
          ),
        );
      }
    }
  }
  // G-12b：未知/较新分析定义版本只读占位——保留引用与参数、不自动改版本、不回写、不删未知字段。
  if (options.resolveAnalysisVersion !== undefined) {
    for (const card of cards) {
      const versionStatus = options.resolveAnalysisVersion(card.analysis);
      if (versionStatus !== "current") {
        issues.push(
          issue(
            "$.cards",
            "analysis-version-readonly",
            versionStatus === "newer"
              ? `分析定义版本较新，按只读占位渲染并提示更新：${card.analysis.analysisId}`
              : `分析定义版本未知，按只读占位渲染并提示更新：${card.analysis.analysisId}`,
          ),
        );
      }
    }
  }

  if (options.knownChartFamilies !== undefined) {
    const known = new Set(options.knownChartFamilies);
    for (const card of cards) {
      if (!known.has(card.chart.chartFamily)) {
        issues.push(
          issue("$.cards", "unknown-chart-family", `图表家族未知，按兼容入口降级：${card.chart.chartFamily}`),
        );
      }
    }
  }

  // 可选 dry-run 投影：只统计降级/冲突，供确认页提示；不写回任何文档。
  let preview: ImportPreview | undefined;
  const targetColumns = options.targetColumns;
  if (targetColumns !== undefined && Number.isInteger(targetColumns) && targetColumns >= 1 && targetColumns <= MAX_COLUMNS) {
    const projection = projectLayout(layoutValidated.value.main, contentValidated.value, {
      targetColumns,
      ...(options.contracts !== undefined ? { contracts: options.contracts } : {}),
    });
    preview = {
      cards: cards.length,
      containers: containers.length,
      spacers: layoutValidated.value.main.objects.filter((object) => object.objectType === "spacer").length,
      rebindRequests: rebindRequests.length,
      projectionIssueCount: projection.issues.length,
      targetColumns,
    };
  } else if (targetColumns !== undefined) {
    issues.push(issue("$.options.targetColumns", "invalid-columns", `预览目标列数非法：${String(targetColumns)}`));
  }

  if (preview === undefined) {
    preview = {
      cards: cards.length,
      containers: containers.length,
      spacers: layoutValidated.value.main.objects.filter((object) => object.objectType === "spacer").length,
      rebindRequests: rebindRequests.length,
      projectionIssueCount: 0,
      targetColumns: null,
    };
  }

  return {
    ok: true,
    content: contentValidated.value,
    layout: layoutValidated.value,
    issues,
    rebindRequests,
    preview,
  };
}

/** 快照对象上界校验（导入前快速拒绝；详细校验仍在 share-snapshot 内）。 */
export function isWithinImportLimits(snapshot: ShareSnapshotV1): boolean {
  const objectCount =
    snapshot.cards.length +
    snapshot.layout.main.objects.length +
    (snapshot.layout.profiles?.reduce((total, profile) => total + profile.geometry.objects.length, 0) ?? 0);
  return objectCount <= MAX_OBJECTS_PER_WORKBENCH;
}
