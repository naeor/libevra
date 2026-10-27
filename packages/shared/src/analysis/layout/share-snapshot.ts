/**
 * D-4 前置：分享快照的**纯函数**编码/解码、白名单序列化、校验与短分享码工具。
 *
 * 边界（Lead 批准范围 D-4-②）：
 * - 只做纯函数：快照构建、JSON 序列化/解析、结构校验、大小上限、短码生成与格式校验；
 * - **不做**公开分享服务端、不做隐私开关/审核（B-6 门，W6 另行批准）；
 * - 不做权限/鉴权判断；导入侧必须重新校验，绝不信任客户端快照。
 *
 * 白名单来源：`S17-工作台个人配置与布局分享-方案草案.md` §6.2；
 * 大小上限与模板长度均为 §7 候选值（OQ-CF 未决，默认值集中在本文件常量，便于评审调整）。
 */

import type {
  AnalysisCardNode,
  AnalysisReference,
  CardTitleSpec,
  CarouselNode,
  ChartPresentation,
  ContainerNode,
  GridSplitConfig,
  GridSplitNode,
  LayoutDocumentV1,
  LayoutMode,
  ObjectGeometry,
  RangePolicy,
  WorkbenchContentDocumentV1,
} from "./types.js";
import {
  MAX_CAROUSEL_PAGES,
  MAX_COLUMNS,
  MAX_CONTAINERS_PER_WORKBENCH,
  MAX_GRID_SPLIT_CHILDREN,
  MAX_OBJECTS_PER_WORKBENCH,
  MAX_ROW_SPAN,
  MIN_CAROUSEL_PAGES,
  MIN_COLUMNS,
} from "./types.js";
import type { DocumentValidationIssue, DocumentValidationResult } from "./validation.js";
import { validateContentDocumentV1, validateLayoutDocumentV1 } from "./validation.js";

/** 分享快照自己的结构版本（与工作台文档 schemaVersion 独立演进）。 */
export const SHARE_SNAPSHOT_SCHEMA_VERSION = 1;

/** 快照 payload 字节上限（§7 候选值；字节按 UTF-8 计算，不是字符数）。 */
export const MAX_SHARE_PAYLOAD_BYTES = 64 * 1024;

/** 模板名/描述长度上限（§7 候选值）。 */
export const MAX_SHARE_TEMPLATE_NAME_LENGTH = 40;
export const MAX_SHARE_TEMPLATE_DESCRIPTION_LENGTH = 200;

/** 语言提示上限（可选字段，自由文本只作提示）。 */
export const MAX_SHARE_LANGUAGE_LENGTH = 16;

/** 短分享码：候选去歧义 base32（无 0/O/1/I），长度候选 8–10（OQ-CF-10 未决）。 */
export const SHARE_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const SHARE_CODE_MIN_LENGTH = 8;
export const SHARE_CODE_MAX_LENGTH = 10;
export const SHARE_CODE_DEFAULT_LENGTH = 8;

/** 模板信息：名称 + 可选描述（只作展示文本，不解释 HTML/Markdown）。 */
export interface ShareTemplateInfo {
  readonly name: string;
  readonly description?: string;
}

/** 快照内卡片：白名单字段（不含金额/账本/成员/设备级偏好）。 */
export interface ShareCardPayload {
  readonly objectId: string;
  readonly type: "analysis-card";
  readonly analysis: AnalysisReference;
  readonly chart: ChartPresentation;
  /** 自定义标题默认不导出；仅 `includeCustomTitles` 或 preset 标题保留。 */
  readonly title?: CardTitleSpec;
  readonly rangePolicy: RangePolicy;
  readonly pinnedRange?: { readonly from: string; readonly to: string };
}

export interface ShareGridSplitPayload {
  readonly objectId: string;
  readonly type: "grid-split";
  readonly children: readonly string[];
  readonly split: GridSplitConfig;
}

export interface ShareCarouselPayload {
  readonly objectId: string;
  readonly type: "carousel";
  readonly children: readonly string[];
}

export type ShareContainerPayload = ShareGridSplitPayload | ShareCarouselPayload;

/** 快照内几何：只保留白名单字段（位置/尺寸/用户收缩意图）。 */
export interface ShareGeometryPayload {
  readonly baseCols: number;
  readonly objects: readonly ObjectGeometry[];
}

export interface ShareProfilePayload {
  readonly profileKey: string;
  readonly geometry: ShareGeometryPayload;
}

/** 快照内布局：主布局 + 独立模式档案；不导出 `previousMain`（恢复副本留在本机）。 */
export interface ShareLayoutPayload {
  readonly mode: LayoutMode;
  readonly main: ShareGeometryPayload;
  readonly profiles?: readonly ShareProfilePayload[];
}

/** 完整分享快照（校验通过时原样返回输入，保留未来版本未知字段）。 */
export interface ShareSnapshotV1 {
  readonly schemaVersion: number;
  readonly language?: string;
  readonly template?: ShareTemplateInfo;
  readonly cards: readonly ShareCardPayload[];
  readonly containers: readonly ShareContainerPayload[];
  readonly layout: ShareLayoutPayload;
}

export interface ShareExportOptions {
  readonly template?: ShareTemplateInfo;
  readonly language?: string;
  /** 默认 false：自定义标题属于用户文本，默认不导出（§6.2 黑名单）。 */
  readonly includeCustomTitles?: boolean;
}

export interface ShareSerializeResult {
  readonly ok: boolean;
  readonly json?: string;
  readonly bytes: number;
  readonly issues: readonly DocumentValidationIssue[];
}

function issue(path: string, code: string, detail: string): DocumentValidationIssue {
  return { path, code, detail };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

const FORBIDDEN_KEYS: readonly string[] = ["__proto__", "constructor", "prototype"];

/** 递归扫描危险键（原型污染）；命中返回路径，未命中返回 null。 */
export function findForbiddenKey(value: unknown, path = "$"): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findForbiddenKey(value[index], `${path}[${String(index)}]`);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }
  if (!isRecord(value)) {
    return null;
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.includes(key)) {
      return `${path}.${key}`;
    }
    const found = findForbiddenKey(value[key], `${path}.${key}`);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** 计算快照 JSON 的 UTF-8 字节数（与导入大小上限同一口径）。 */
export function sharePayloadByteLength(json: string): number {
  return utf8ByteLength(json);
}

// ---------------------------------------------------------------------------
// 白名单构建（只构造允许字段，禁止“复制整份再删字段”）
// ---------------------------------------------------------------------------

function toShareAnalysis(source: AnalysisReference): AnalysisReference {
  const analysis: {
    analysisId: string;
    params: Readonly<Record<string, unknown>>;
    analysisVersion?: string;
  } = { analysisId: source.analysisId, params: source.params };
  if (source.analysisVersion !== undefined) {
    analysis.analysisVersion = source.analysisVersion;
  }
  return analysis;
}

function toShareChart(source: ChartPresentation): ChartPresentation {
  const chart: { chartFamily: string; options?: Readonly<Record<string, unknown>> } = {
    chartFamily: source.chartFamily,
  };
  if (source.options !== undefined) {
    chart.options = source.options;
  }
  return chart;
}

function toShareTitle(
  source: CardTitleSpec | undefined,
  includeCustomTitles: boolean,
): CardTitleSpec | undefined {
  if (source === undefined) {
    return undefined;
  }
  if (source.kind === "custom" && !includeCustomTitles) {
    return undefined;
  }
  const title: { kind: CardTitleSpec["kind"]; text?: string } = { kind: source.kind };
  if (source.text !== undefined) {
    title.text = source.text;
  }
  return title;
}

function toShareCard(card: AnalysisCardNode, includeCustomTitles: boolean): ShareCardPayload {
  const payload: {
    objectId: string;
    type: "analysis-card";
    analysis: AnalysisReference;
    chart: ChartPresentation;
    title?: CardTitleSpec;
    rangePolicy: RangePolicy;
    pinnedRange?: { readonly from: string; readonly to: string };
  } = {
    objectId: card.objectId,
    type: "analysis-card",
    analysis: toShareAnalysis(card.analysis),
    chart: toShareChart(card.chart),
    rangePolicy: card.rangePolicy,
  };
  const title = toShareTitle(card.title, includeCustomTitles);
  if (title !== undefined) {
    payload.title = title;
  }
  if (card.pinnedRange !== undefined) {
    payload.pinnedRange = { from: card.pinnedRange.from, to: card.pinnedRange.to };
  }
  return payload;
}

function toShareContainer(container: ContainerNode): ShareContainerPayload {
  if (container.type === "grid-split") {
    const split: GridSplitConfig = {
      columnSplitPermille: container.split.columnSplitPermille,
      rowSplitPermille: container.split.rowSplitPermille,
    };
    return {
      objectId: container.objectId,
      type: "grid-split",
      children: [...container.children],
      split,
    };
  }
  return { objectId: container.objectId, type: "carousel", children: [...container.children] };
}

function toShareObject(source: ObjectGeometry): ObjectGeometry {
  const object: {
    objectId: string;
    objectType: ObjectGeometry["objectType"];
    anchor: number;
    colSpan: number;
    rowSpan: number;
    presentation?: "full" | "collapsed";
    expandedSize?: { readonly colSpan: number; readonly rowSpan: number };
  } = {
    objectId: source.objectId,
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

/** 由内容文档 + 布局文档构建白名单快照（纯函数，不做 I/O）。 */
export function buildShareSnapshot(
  content: WorkbenchContentDocumentV1,
  layout: LayoutDocumentV1,
  options: ShareExportOptions = {},
): ShareSnapshotV1 {
  const includeCustomTitles = options.includeCustomTitles === true;
  const snapshot: {
    schemaVersion: number;
    language?: string;
    template?: ShareTemplateInfo;
    cards: readonly ShareCardPayload[];
    containers: readonly ShareContainerPayload[];
    layout: ShareLayoutPayload;
  } = {
    schemaVersion: SHARE_SNAPSHOT_SCHEMA_VERSION,
    cards: content.cards.map((card) => toShareCard(card, includeCustomTitles)),
    containers: content.containers.map((container) => toShareContainer(container)),
    layout: { mode: layout.mode, main: toShareGeometry(layout.main) },
  };
  if (options.template !== undefined) {
    snapshot.template = toShareTemplate(options.template);
  }
  if (options.language !== undefined) {
    snapshot.language = options.language;
  }
  if (layout.profiles !== undefined && layout.mode === "independent") {
    snapshot.layout = {
      mode: layout.mode,
      main: toShareGeometry(layout.main),
      profiles: layout.profiles.map((profile) => ({
        profileKey: profile.profileKey,
        geometry: toShareGeometry(profile.geometry),
      })),
    };
  }
  return snapshot;
}

function toShareGeometry(geometry: LayoutDocumentV1["main"]): ShareGeometryPayload {
  return {
    baseCols: geometry.baseCols,
    objects: geometry.objects.map((object) => toShareObject(object)),
  };
}

function toShareTemplate(template: ShareTemplateInfo): ShareTemplateInfo {
  const result: { name: string; description?: string } = { name: template.name };
  if (template.description !== undefined) {
    result.description = template.description;
  }
  return result;
}

// ---------------------------------------------------------------------------
// 校验（严格白名单；通过时原样返回输入以保留未来版本未知字段）
// ---------------------------------------------------------------------------

function validateShareCard(
  value: unknown,
  path: string,
  seen: Set<string>,
): readonly DocumentValidationIssue[] {
  const issues: DocumentValidationIssue[] = [];
  if (!isRecord(value)) {
    return [issue(path, "invalid-share-card", "卡片必须是对象")];
  }
  const objectId = value["objectId"];
  if (!isNonEmptyString(objectId)) {
    issues.push(issue(`${path}.objectId`, "invalid-object-id", "objectId 必须是非空字符串"));
  } else if (seen.has(objectId)) {
    issues.push(issue(`${path}.objectId`, "duplicate-object-id", `objectId 重复：${objectId}`));
  } else {
    seen.add(objectId);
  }
  if (value["type"] !== "analysis-card") {
    issues.push(issue(`${path}.type`, "invalid-share-card", '卡片 type 必须是 "analysis-card"'));
  }
  const analysis = value["analysis"];
  if (!isRecord(analysis) || !isNonEmptyString(analysis["analysisId"])) {
    issues.push(issue(`${path}.analysis`, "invalid-analysis-id", "analysis.analysisId 必须是非空字符串"));
  } else {
    if (analysis["analysisVersion"] !== undefined && !isNonEmptyString(analysis["analysisVersion"])) {
      issues.push(issue(`${path}.analysis.analysisVersion`, "invalid-analysis-version", "analysisVersion 必须是非空字符串"));
    }
    if (!isRecord(analysis["params"])) {
      issues.push(issue(`${path}.analysis.params`, "invalid-analysis-params", "analysis.params 必须是对象"));
    }
  }
  const chart = value["chart"];
  if (!isRecord(chart) || !isNonEmptyString(chart["chartFamily"])) {
    issues.push(issue(`${path}.chart`, "invalid-chart-family", "chart.chartFamily 必须是非空字符串"));
  } else if (chart["options"] !== undefined && !isRecord(chart["options"])) {
    issues.push(issue(`${path}.chart.options`, "invalid-chart-options", "chart.options 必须是对象"));
  }
  const rangePolicy = value["rangePolicy"];
  if (rangePolicy !== "inherit" && rangePolicy !== "pinned") {
    issues.push(issue(`${path}.rangePolicy`, "invalid-range-policy", 'rangePolicy 必须是 "inherit" 或 "pinned"'));
  }
  const pinnedRange = value["pinnedRange"];
  if (rangePolicy === "pinned") {
    if (
      !isRecord(pinnedRange) ||
      !isNonEmptyString(pinnedRange["from"]) ||
      !isNonEmptyString(pinnedRange["to"])
    ) {
      issues.push(issue(`${path}.pinnedRange`, "pinned-range-missing", "pinned 卡片必须提供 pinnedRange{from,to}"));
    }
  } else if (pinnedRange !== undefined) {
    issues.push(issue(`${path}.pinnedRange`, "invalid-pinned-range", '只有 rangePolicy="pinned" 才允许 pinnedRange'));
  }
  const title = value["title"];
  if (title !== undefined) {
    if (!isRecord(title) || (title["kind"] !== "preset" && title["kind"] !== "custom")) {
      issues.push(issue(`${path}.title`, "invalid-title", 'title.kind 必须是 "preset" 或 "custom"'));
    } else if (title["text"] !== undefined && !isNonEmptyString(title["text"])) {
      issues.push(issue(`${path}.title.text`, "invalid-title-text", "title.text 必须是非空字符串"));
    }
  }
  return issues;
}

function validateShareContainer(
  value: unknown,
  path: string,
  cardIds: ReadonlySet<string>,
  seen: Set<string>,
): readonly DocumentValidationIssue[] {
  const issues: DocumentValidationIssue[] = [];
  if (!isRecord(value)) {
    return [issue(path, "invalid-share-container", "容器必须是对象")];
  }
  const objectId = value["objectId"];
  if (!isNonEmptyString(objectId)) {
    issues.push(issue(`${path}.objectId`, "invalid-object-id", "objectId 必须是非空字符串"));
  } else if (seen.has(objectId)) {
    issues.push(issue(`${path}.objectId`, "duplicate-object-id", `objectId 重复：${objectId}`));
  } else {
    seen.add(objectId);
  }
  const type = value["type"];
  if (type !== "grid-split" && type !== "carousel") {
    issues.push(issue(`${path}.type`, "invalid-container-type", '容器 type 必须是 "grid-split" 或 "carousel"'));
    return issues;
  }
  const children = value["children"];
  if (!Array.isArray(children)) {
    issues.push(issue(`${path}.children`, "invalid-children", "children 必须是数组"));
    return issues;
  }
  const minimum = type === "grid-split" ? 2 : MIN_CAROUSEL_PAGES;
  const maximum = type === "grid-split" ? MAX_GRID_SPLIT_CHILDREN : MAX_CAROUSEL_PAGES;
  if (children.length < minimum || children.length > maximum) {
    issues.push(issue(`${path}.children`, "invalid-children-count", `children 数量必须在 ${String(minimum)}–${String(maximum)} 之间`));
  }
  const childSeen = new Set<string>();
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (!isNonEmptyString(child)) {
      issues.push(issue(`${path}.children[${String(index)}]`, "invalid-child", "child 必须是 objectId 字符串"));
      continue;
    }
    if (childSeen.has(child)) {
      issues.push(issue(`${path}.children[${String(index)}]`, "duplicate-child", `child 重复：${child}`));
    } else {
      childSeen.add(child);
    }
    if (!cardIds.has(child)) {
      issues.push(issue(`${path}.children[${String(index)}]`, "child-not-found", `child 不在卡片列表中：${child}`));
    }
  }
  if (type === "grid-split") {
    const split = value["split"];
    if (!isRecord(split)) {
      issues.push(issue(`${path}.split`, "invalid-split", "grid-split 必须提供 split{columnSplitPermille,rowSplitPermille}"));
    } else {
      const column = split["columnSplitPermille"];
      const row = split["rowSplitPermille"];
      const valid = (candidate: unknown): boolean => isIntegerInRange(candidate, 0, 1000);
      if (!valid(column) || !valid(row)) {
        issues.push(issue(`${path}.split`, "invalid-split-ratio", "分割比例必须是 0–1000 的整数千分比"));
      } else if (column === 0 && row === 0) {
        issues.push(issue(`${path}.split`, "split-empty", "分割比例不能同时为 0（否则没有分割线）"));
      }
    }
  }
  return issues;
}

function validateShareGeometry(
  value: unknown,
  path: string,
  contentObjectIds: ReadonlySet<string>,
): readonly DocumentValidationIssue[] {
  const issues: DocumentValidationIssue[] = [];
  if (!isRecord(value)) {
    return [issue(path, "invalid-share-geometry", "几何必须是对象")];
  }
  if (!isIntegerInRange(value["baseCols"], MIN_COLUMNS, MAX_COLUMNS)) {
    issues.push(issue(`${path}.baseCols`, "invalid-columns", `baseCols 必须在 ${String(MIN_COLUMNS)}–${String(MAX_COLUMNS)} 之间`));
  }
  const objects = value["objects"];
  if (!Array.isArray(objects)) {
    issues.push(issue(`${path}.objects`, "invalid-objects", "objects 必须是数组"));
    return issues;
  }
  if (objects.length > MAX_OBJECTS_PER_WORKBENCH) {
    issues.push(issue(`${path}.objects`, "too-many-objects", `objects 超过上限 ${String(MAX_OBJECTS_PER_WORKBENCH)}`));
  }
  const seen = new Set<string>();
  for (let index = 0; index < objects.length; index += 1) {
    const raw = objects[index];
    const objectPath = `${path}.objects[${String(index)}]`;
    if (!isRecord(raw)) {
      issues.push(issue(objectPath, "invalid-object", "布局对象必须是对象"));
      continue;
    }
    const objectId = raw["objectId"];
    if (!isNonEmptyString(objectId)) {
      issues.push(issue(`${objectPath}.objectId`, "invalid-object-id", "objectId 必须是非空字符串"));
    } else if (seen.has(objectId)) {
      issues.push(issue(`${objectPath}.objectId`, "duplicate-object-id", `objectId 重复：${objectId}`));
    } else {
      seen.add(objectId);
    }
    const objectType = raw["objectType"];
    if (objectType !== "analysis-card" && objectType !== "grid-split" && objectType !== "carousel" && objectType !== "spacer") {
      issues.push(issue(`${objectPath}.objectType`, "invalid-object-type", "objectType 不在已知集合"));
    } else if (objectType !== "spacer" && isNonEmptyString(objectId) && !contentObjectIds.has(objectId)) {
      issues.push(issue(`${objectPath}.objectId`, "child-not-found", `布局对象在内容文档中不存在：${objectId}`));
    }
    if (!Number.isInteger(raw["anchor"]) || (raw["anchor"] as number) < 1) {
      issues.push(issue(`${objectPath}.anchor`, "invalid-anchor", "anchor 必须是正整数编号"));
    }
    if (!isIntegerInRange(raw["colSpan"], 1, MAX_COLUMNS)) {
      issues.push(issue(`${objectPath}.colSpan`, "invalid-size", `colSpan 必须在 1–${String(MAX_COLUMNS)} 之间`));
    }
    if (!isIntegerInRange(raw["rowSpan"], 1, MAX_ROW_SPAN)) {
      issues.push(issue(`${objectPath}.rowSpan`, "invalid-size", `rowSpan 必须在 1–${String(MAX_ROW_SPAN)} 之间`));
    }
    const presentation = raw["presentation"];
    if (presentation !== undefined && presentation !== "full" && presentation !== "collapsed") {
      issues.push(issue(`${objectPath}.presentation`, "invalid-presentation", 'presentation 必须是 "full" 或 "collapsed"'));
    }
    const expandedSize = raw["expandedSize"];
    if (expandedSize !== undefined) {
      if (!isRecord(expandedSize)) {
        issues.push(issue(`${objectPath}.expandedSize`, "invalid-size", "expandedSize 必须是 {colSpan,rowSpan}"));
      } else if (
        !isIntegerInRange(expandedSize["colSpan"], 1, MAX_COLUMNS) ||
        !isIntegerInRange(expandedSize["rowSpan"], 1, MAX_ROW_SPAN)
      ) {
        issues.push(issue(`${objectPath}.expandedSize`, "invalid-size", "expandedSize 跨度过大或非法"));
      }
    }
  }
  return issues;
}

function validateShareLayout(
  value: unknown,
  contentObjectIds: ReadonlySet<string>,
): readonly DocumentValidationIssue[] {
  const issues: DocumentValidationIssue[] = [];
  if (!isRecord(value)) {
    return [issue("$.layout", "invalid-share-layout", "layout 必须是对象")];
  }
  const mode = value["mode"];
  if (mode !== "unified" && mode !== "independent") {
    issues.push(issue("$.layout.mode", "invalid-mode", 'mode 必须是 "unified" 或 "independent"'));
  }
  const main = value["main"];
  issues.push(...validateShareGeometry(main, "$.layout.main", contentObjectIds));
  const profiles = value["profiles"];
  if (profiles !== undefined) {
    if (!Array.isArray(profiles)) {
      issues.push(issue("$.layout.profiles", "invalid-profiles", "profiles 必须是数组"));
      return issues;
    }
    const keys = new Set<string>();
    for (let index = 0; index < profiles.length; index += 1) {
      const profile = profiles[index];
      const profilePath = `$.layout.profiles[${String(index)}]`;
      if (!isRecord(profile) || !isNonEmptyString(profile["profileKey"])) {
        issues.push(issue(profilePath, "invalid-profile", "档案必须提供非空 profileKey"));
        continue;
      }
      const profileKey = profile["profileKey"];
      if (keys.has(profileKey)) {
        issues.push(issue(`${profilePath}.profileKey`, "duplicate-profile-key", `profileKey 重复：${profileKey}`));
      } else {
        keys.add(profileKey);
      }
      issues.push(...validateShareGeometry(profile["geometry"], `${profilePath}.geometry`, contentObjectIds));
    }
  }
  return issues;
}

/**
 * 校验分享快照结构（严格白名单，未知字段保留：通过时**原样返回输入**）。
 * 不检查 analysisId 是否存在于接收者目录（由导入管道的 resolveAnalysis 处理）。
 */
export function validateShareSnapshot(value: unknown): DocumentValidationResult<ShareSnapshotV1> {
  const issues: DocumentValidationIssue[] = [];
  if (!isRecord(value)) {
    return { ok: false, issues: [issue("$", "invalid-share-document", "分享快照必须是对象")] };
  }
  const forbidden = findForbiddenKey(value);
  if (forbidden !== null) {
    issues.push(issue(forbidden, "forbidden-key", "快照含被禁止的危险键（原型污染防护）"));
  }
  if (value["schemaVersion"] !== SHARE_SNAPSHOT_SCHEMA_VERSION) {
    issues.push(issue("$.schemaVersion", "unsupported-share-schema-version", `只支持分享快照 schemaVersion=${String(SHARE_SNAPSHOT_SCHEMA_VERSION)}`));
  }
  const language = value["language"];
  if (language !== undefined && (!isNonEmptyString(language) || language.length > MAX_SHARE_LANGUAGE_LENGTH)) {
    issues.push(issue("$.language", "invalid-share-language", `language 必须是非空且不超过 ${String(MAX_SHARE_LANGUAGE_LENGTH)} 字符的字符串`));
  }
  const template = value["template"];
  if (template !== undefined) {
    if (!isRecord(template) || !isNonEmptyString(template["name"])) {
      issues.push(issue("$.template", "invalid-share-template", "template 必须提供非空 name"));
    } else {
      if (template["name"].length > MAX_SHARE_TEMPLATE_NAME_LENGTH) {
        issues.push(issue("$.template.name", "template-name-too-long", `模板名超过 ${String(MAX_SHARE_TEMPLATE_NAME_LENGTH)} 字符`));
      }
      const description = template["description"];
      if (description !== undefined && (!isNonEmptyString(description) || description.length > MAX_SHARE_TEMPLATE_DESCRIPTION_LENGTH)) {
        issues.push(issue("$.template.description", "template-description-too-long", `模板描述必须非空且不超过 ${String(MAX_SHARE_TEMPLATE_DESCRIPTION_LENGTH)} 字符`));
      }
    }
  }
  const cards = value["cards"];
  const cardIds = new Set<string>();
  if (!Array.isArray(cards)) {
    issues.push(issue("$.cards", "invalid-share-cards", "cards 必须是数组"));
  } else {
    if (cards.length > MAX_OBJECTS_PER_WORKBENCH) {
      issues.push(issue("$.cards", "too-many-objects", `卡片超过上限 ${String(MAX_OBJECTS_PER_WORKBENCH)}`));
    }
    for (let index = 0; index < cards.length; index += 1) {
      const card = cards[index];
      issues.push(...validateShareCard(card, `$.cards[${String(index)}]`, cardIds));
    }
  }
  const containers = value["containers"];
  const containerIds = new Set<string>();
  if (!Array.isArray(containers)) {
    issues.push(issue("$.containers", "invalid-share-containers", "containers 必须是数组"));
  } else {
    if (containers.length > MAX_CONTAINERS_PER_WORKBENCH) {
      issues.push(issue("$.containers", "too-many-objects", `容器超过上限 ${String(MAX_CONTAINERS_PER_WORKBENCH)}`));
    }
    for (let index = 0; index < containers.length; index += 1) {
      const container = containers[index];
      issues.push(...validateShareContainer(container, `$.containers[${String(index)}]`, cardIds, containerIds));
    }
  }
  const contentObjectIds = new Set<string>([...cardIds, ...containerIds]);
  issues.push(...validateShareLayout(value["layout"], contentObjectIds));
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, value: value as unknown as ShareSnapshotV1 };
}

/** 解析内存中的分享快照（对象形态）：复用同一严格校验。 */
export function parseShareSnapshot(value: unknown): DocumentValidationResult<ShareSnapshotV1> {
  return validateShareSnapshot(value);
}

/** 解析分享快照 JSON：先查字节上限，再 JSON 解析 + 结构校验。 */
export function parseShareSnapshotJson(json: string): DocumentValidationResult<ShareSnapshotV1> {
  const bytes = utf8ByteLength(json);
  if (bytes > MAX_SHARE_PAYLOAD_BYTES) {
    return {
      ok: false,
      issues: [issue("$", "payload-too-large", `快照 ${String(bytes)} 字节，超过上限 ${String(MAX_SHARE_PAYLOAD_BYTES)}`)],
    };
  }
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    return { ok: false, issues: [issue("$", "invalid-json", "不是合法 JSON 字符串")] };
  }
  return validateShareSnapshot(value);
}

/** 序列化分享快照：结构校验 → JSON 字符串 → 字节上限。 */
export function serializeShareSnapshot(snapshot: ShareSnapshotV1): ShareSerializeResult {
  const validated = validateShareSnapshot(snapshot);
  if (!validated.ok) {
    return { ok: false, bytes: 0, issues: validated.issues };
  }
  const json = JSON.stringify(validated.value);
  const bytes = utf8ByteLength(json);
  if (bytes > MAX_SHARE_PAYLOAD_BYTES) {
    return {
      ok: false,
      bytes,
      issues: [issue("$", "payload-too-large", `快照 ${String(bytes)} 字节，超过上限 ${String(MAX_SHARE_PAYLOAD_BYTES)}`)],
    };
  }
  return { ok: true, json, bytes, issues: [] };
}

/**
 * 从内容文档 + 布局文档导出分享快照 JSON（白名单构建；**不做服务端存储**）。
 * 内容/布局文档先复用 D-1 校验器做严格校验，避免把损坏配置导出成分享内容。
 */
export function exportShareSnapshot(
  content: WorkbenchContentDocumentV1,
  layout: LayoutDocumentV1,
  options: ShareExportOptions = {},
): ShareSerializeResult {
  const contentValidated = validateContentDocumentV1(content);
  if (!contentValidated.ok) {
    return { ok: false, bytes: 0, issues: contentValidated.issues };
  }
  const layoutValidated = validateLayoutDocumentV1(layout);
  if (!layoutValidated.ok) {
    return { ok: false, bytes: 0, issues: layoutValidated.issues };
  }
  return serializeShareSnapshot(buildShareSnapshot(contentValidated.value, layoutValidated.value, options));
}

// ---------------------------------------------------------------------------
// 短分享码（纯函数；生成需要随机字节，由调用方注入随机源，生产代码不读全局随机）
// ---------------------------------------------------------------------------

/** 随机字节提供者：返回至少 `byteCount` 个字节；测试用固定种子 PRNG。 */
export type ShareCodeRandomSource = (byteCount: number) => Uint8Array;

/** 规范化分享码：去首尾空白并转大写（输入分享码只在传输层使用，不代表布局内容）。 */
export function normalizeShareCode(code: string): string {
  return code.trim().toUpperCase();
}

/** 校验分享码格式：去歧义 base32、长度 8–10、字符集严格。 */
export function isValidShareCode(code: string): boolean {
  const normalized = normalizeShareCode(code);
  if (normalized.length < SHARE_CODE_MIN_LENGTH || normalized.length > SHARE_CODE_MAX_LENGTH) {
    return false;
  }
  for (const character of normalized) {
    if (!SHARE_CODE_ALPHABET.includes(character)) {
      return false;
    }
  }
  return true;
}

/**
 * 由注入的随机源生成分享码（长度默认 8，候选值；OQ-CF-10 未决）。
 * 参数非法返回空字符串而不是抛异常（纯函数容错）。
 */
export function createShareCode(
  random: ShareCodeRandomSource,
  length: number = SHARE_CODE_DEFAULT_LENGTH,
): string {
  if (!Number.isInteger(length) || length < SHARE_CODE_MIN_LENGTH || length > SHARE_CODE_MAX_LENGTH) {
    return "";
  }
  const bytes = random(length);
  if (bytes.length < length) {
    return "";
  }
  let code = "";
  for (let index = 0; index < length; index += 1) {
    const byte = bytes[index] ?? 0;
    // 字母表长度 32 且字节 0–255 整除 32，因此取模无偏。
    code += SHARE_CODE_ALPHABET[byte % SHARE_CODE_ALPHABET.length] ?? "";
  }
  return code;
}
