/**
 * 内容文档 / 布局文档的运行时校验与序列化（D-1）。
 *
 * 用途：本地保存（W5）与导入分享快照（W6）前的结构校验。目标是**损坏数据
 * 安全降级而不是白屏**（所有者规格 §28、配置与分享方案 §4/§7）：
 * - 纯函数：不读时钟/视口/网络，不执行配置中的任何代码，不修改输入；
 * - 校验只检查结构（类型/范围/枚举/引用），不检查“分析 ID 是否存在”等业务语义；
 * - 通过校验时**原样返回输入对象**（保留未知字段，供未来版本只读兼容），
 *   不做归一化/裁剪，避免旧客户端回写破坏新版本配置；
 * - `parse*` 永不抛异常：JSON 解析失败返回 `invalid-json` 问题。
 *
 * 注意：锚点越界、重叠、同锚点冲突等“布局损坏”不在这里拒绝，而由投影
 * (`projectLayout`) 按确定性规则修复；这里只拒绝结构上无法解释的文档。
 */

import type {
  GridSize,
  LayoutDocumentV1,
  LayoutGeometry,
  LayoutMode,
  LayoutObjectKind,
  RangePolicy,
  TitleKind,
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

/** 一条文档校验问题；`path` 便于定位（如 `$.main.objects[2].anchor`）。 */
export interface DocumentValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly detail: string;
}

/** 校验结果：成功时给出（原样保留的）文档；失败时给出全部问题。 */
export type DocumentValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly DocumentValidationIssue[] };

const OBJECT_TYPES: readonly LayoutObjectKind[] = ["analysis-card", "grid-split", "carousel", "spacer"];
const LAYOUT_MODES: readonly LayoutMode[] = ["unified", "independent"];
const RANGE_POLICIES: readonly RangePolicy[] = ["inherit", "pinned"];
const TITLE_KINDS: readonly TitleKind[] = ["preset", "custom"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function fail(
  issues: DocumentValidationIssue[],
  path: string,
  code: string,
  detail: string,
): false {
  issues.push({ path, code, detail });
  return false;
}

function validateGridSizeField(
  value: unknown,
  path: string,
  issues: DocumentValidationIssue[],
  maxColSpan: number = MAX_COLUMNS,
): value is GridSize {
  if (!isRecord(value)) {
    return fail(issues, path, "invalid-size", "占格必须是对象 { colSpan, rowSpan }");
  }
  let valid = true;
  if (!isIntegerInRange(value["colSpan"], 1, maxColSpan)) {
    valid = fail(issues, `${path}.colSpan`, "invalid-size", `列跨度必须是 1–${maxColSpan} 的整数`);
  }
  if (!isIntegerInRange(value["rowSpan"], 1, MAX_ROW_SPAN)) {
    valid = fail(issues, `${path}.rowSpan`, "invalid-size", `行跨度必须是 1–${MAX_ROW_SPAN} 的整数`);
  }
  return valid;
}

function validateObjectGeometry(
  value: unknown,
  path: string,
  issues: DocumentValidationIssue[],
  seenObjectIds: Set<string>,
): boolean {
  if (!isRecord(value)) {
    return fail(issues, path, "invalid-object", "布局对象必须是对象");
  }
  let valid = true;

  const objectId = value["objectId"];
  if (!isNonEmptyString(objectId)) {
    valid = fail(issues, `${path}.objectId`, "invalid-object-id", "objectId 必须是非空字符串");
  } else if (seenObjectIds.has(objectId)) {
    valid = fail(issues, `${path}.objectId`, "duplicate-object-id", `objectId 重复：${objectId}`);
  } else {
    seenObjectIds.add(objectId);
  }

  if (!OBJECT_TYPES.includes(value["objectType"] as LayoutObjectKind)) {
    valid = fail(issues, `${path}.objectType`, "invalid-object-type", "未知布局对象类型");
  }

  if (!isPositiveInteger(value["anchor"])) {
    valid = fail(issues, `${path}.anchor`, "invalid-anchor", "位置编号必须是正整数");
  }
  if (!isIntegerInRange(value["colSpan"], 1, MAX_COLUMNS)) {
    valid = fail(issues, `${path}.colSpan`, "invalid-size", `列跨度必须是 1–${MAX_COLUMNS} 的整数`);
  }
  if (!isIntegerInRange(value["rowSpan"], 1, MAX_ROW_SPAN)) {
    valid = fail(issues, `${path}.rowSpan`, "invalid-size", `行跨度必须是 1–${MAX_ROW_SPAN} 的整数`);
  }

  const presentation = value["presentation"];
  if (presentation !== undefined && presentation !== "full" && presentation !== "collapsed") {
    valid = fail(issues, `${path}.presentation`, "invalid-presentation", "presentation 只能是 full 或 collapsed");
  }
  const expandedSize = value["expandedSize"];
  if (expandedSize !== undefined && !validateGridSizeField(expandedSize, `${path}.expandedSize`, issues)) {
    valid = false;
  }

  return valid;
}

/** 校验一份权威几何（主布局或某个档案）。 */
function validateLayoutGeometry(
  value: unknown,
  path: string,
  issues: DocumentValidationIssue[],
): value is LayoutGeometry {
  if (!isRecord(value)) {
    return fail(issues, path, "invalid-geometry", "几何必须是对象");
  }
  let valid = true;
  if (!isIntegerInRange(value["baseCols"], MIN_COLUMNS, MAX_COLUMNS)) {
    valid = fail(
      issues,
      `${path}.baseCols`,
      "invalid-columns",
      `基准列数必须是 ${MIN_COLUMNS}–${MAX_COLUMNS} 的整数`,
    );
  }
  const objects = value["objects"];
  if (!Array.isArray(objects)) {
    return fail(issues, `${path}.objects`, "invalid-objects", "objects 必须是数组");
  }
  if (objects.length > MAX_OBJECTS_PER_WORKBENCH) {
    valid = fail(
      issues,
      `${path}.objects`,
      "too-many-objects",
      `单工作台对象数不得超过 ${MAX_OBJECTS_PER_WORKBENCH}`,
    );
  }
  const seenObjectIds = new Set<string>();
  objects.forEach((object, index) => {
    if (!validateObjectGeometry(object, `${path}.objects[${index}]`, issues, seenObjectIds)) {
      valid = false;
    }
  });
  return valid;
}

function validateLayoutProfile(
  value: unknown,
  path: string,
  issues: DocumentValidationIssue[],
): boolean {
  if (!isRecord(value)) {
    return fail(issues, path, "invalid-profile", "档案必须是对象");
  }
  let valid = true;
  if (!isNonEmptyString(value["profileKey"])) {
    valid = fail(issues, `${path}.profileKey`, "invalid-profile-key", "档案键必须是非空字符串");
  }
  if (!validateLayoutGeometry(value["geometry"], `${path}.geometry`, issues)) {
    valid = false;
  }
  return valid;
}

/** 校验布局文档（统一模式主布局 + 独立模式档案 + 上一个布局）。 */
export function validateLayoutDocumentV1(value: unknown): DocumentValidationResult<LayoutDocumentV1> {
  const issues: DocumentValidationIssue[] = [];
  if (!isRecord(value)) {
    return { ok: false, issues: [{ path: "$", code: "invalid-document", detail: "布局文档必须是对象" }] };
  }
  let valid = true;

  if (!isPositiveInteger(value["schemaVersion"])) {
    valid = fail(issues, "$.schemaVersion", "invalid-schema-version", "schemaVersion 必须是正整数");
  }
  if (!isPositiveInteger(value["layoutAlgorithmVersion"])) {
    valid = fail(
      issues,
      "$.layoutAlgorithmVersion",
      "invalid-algorithm-version",
      "layoutAlgorithmVersion 必须是正整数",
    );
  }
  if (!LAYOUT_MODES.includes(value["mode"] as LayoutMode)) {
    valid = fail(issues, "$.mode", "invalid-mode", "mode 只能是 unified 或 independent");
  }
  if (!validateLayoutGeometry(value["main"], "$.main", issues)) {
    valid = false;
  }

  const profiles = value["profiles"];
  if (profiles !== undefined) {
    if (!Array.isArray(profiles)) {
      valid = fail(issues, "$.profiles", "invalid-profiles", "profiles 必须是数组");
    } else {
      const seenProfileKeys = new Set<string>();
      profiles.forEach((profile, index) => {
        const path = `$.profiles[${index}]`;
        const profileKey = isRecord(profile) ? profile["profileKey"] : undefined;
        if (isNonEmptyString(profileKey)) {
          if (seenProfileKeys.has(profileKey)) {
            valid = fail(issues, `${path}.profileKey`, "duplicate-profile-key", `档案键重复：${profileKey}`);
          }
          seenProfileKeys.add(profileKey);
        }
        if (!validateLayoutProfile(profile, path, issues)) {
          valid = false;
        }
      });
    }
  }

  const previousMain = value["previousMain"];
  if (previousMain !== undefined && !validateLayoutGeometry(previousMain, "$.previousMain", issues)) {
    valid = false;
  }

  return valid ? { ok: true, value: value as unknown as LayoutDocumentV1 } : { ok: false, issues };
}

function validateAnalysisCard(
  value: unknown,
  path: string,
  issues: DocumentValidationIssue[],
): boolean {
  if (!isRecord(value)) {
    return fail(issues, path, "invalid-card", "卡片必须是对象");
  }
  let valid = true;

  if (!isNonEmptyString(value["objectId"])) {
    valid = fail(issues, `${path}.objectId`, "invalid-object-id", "objectId 必须是非空字符串");
  }
  if (value["type"] !== "analysis-card") {
    valid = fail(issues, `${path}.type`, "invalid-card-type", "卡片 type 必须是 analysis-card");
  }

  const analysis = value["analysis"];
  if (!isRecord(analysis)) {
    valid = fail(issues, `${path}.analysis`, "invalid-analysis", "analysis 必须是对象");
  } else {
    if (!isNonEmptyString(analysis["analysisId"])) {
      valid = fail(issues, `${path}.analysis.analysisId`, "invalid-analysis-id", "analysisId 必须是非空字符串");
    }
    if (!isRecord(analysis["params"])) {
      valid = fail(issues, `${path}.analysis.params`, "invalid-analysis-params", "params 必须是对象");
    }
    if (analysis["analysisVersion"] !== undefined && !isNonEmptyString(analysis["analysisVersion"])) {
      valid = fail(issues, `${path}.analysis.analysisVersion`, "invalid-analysis-version", "analysisVersion 必须是非空字符串");
    }
  }

  const chart = value["chart"];
  if (!isRecord(chart)) {
    valid = fail(issues, `${path}.chart`, "invalid-chart", "chart 必须是对象");
  } else {
    if (!isNonEmptyString(chart["chartFamily"])) {
      valid = fail(issues, `${path}.chart.chartFamily`, "invalid-chart-family", "chartFamily 必须是非空字符串");
    }
    if (chart["options"] !== undefined && !isRecord(chart["options"])) {
      valid = fail(issues, `${path}.chart.options`, "invalid-chart-options", "options 必须是对象");
    }
  }

  const title = value["title"];
  if (title !== undefined) {
    if (!isRecord(title)) {
      valid = fail(issues, `${path}.title`, "invalid-title", "title 必须是对象");
    } else {
      if (!TITLE_KINDS.includes(title["kind"] as TitleKind)) {
        valid = fail(issues, `${path}.title.kind`, "invalid-title-kind", "title.kind 只能是 preset 或 custom");
      }
      if (title["text"] !== undefined && typeof title["text"] !== "string") {
        valid = fail(issues, `${path}.title.text`, "invalid-title-text", "title.text 必须是字符串");
      }
    }
  }

  const rangePolicy = value["rangePolicy"];
  if (!RANGE_POLICIES.includes(rangePolicy as RangePolicy)) {
    valid = fail(issues, `${path}.rangePolicy`, "invalid-range-policy", "rangePolicy 只能是 inherit 或 pinned");
  }
  const pinnedRange = value["pinnedRange"];
  if (pinnedRange === undefined) {
    if (rangePolicy === "pinned") {
      valid = fail(issues, `${path}.pinnedRange`, "pinned-range-missing", "pinned 卡片必须给出 pinnedRange");
    }
  } else if (!isRecord(pinnedRange)) {
    valid = fail(issues, `${path}.pinnedRange`, "invalid-pinned-range", "pinnedRange 必须是对象");
  } else {
    if (!isNonEmptyString(pinnedRange["from"])) {
      valid = fail(issues, `${path}.pinnedRange.from`, "invalid-pinned-range", "from 必须是非空字符串");
    }
    if (!isNonEmptyString(pinnedRange["to"])) {
      valid = fail(issues, `${path}.pinnedRange.to`, "invalid-pinned-range", "to 必须是非空字符串");
    }
  }

  return valid;
}

function validateContainerChildren(
  value: unknown,
  path: string,
  issues: DocumentValidationIssue[],
  minimum: number,
  maximum: number,
): boolean {
  if (!Array.isArray(value)) {
    return fail(issues, `${path}.children`, "invalid-children", "children 必须是数组");
  }
  if (value.length < minimum || value.length > maximum) {
    return fail(
      issues,
      `${path}.children`,
      "invalid-children-count",
      `子对象数量必须是 ${minimum}–${maximum}`,
    );
  }
  const seen = new Set<string>();
  let valid = true;
  value.forEach((child, index) => {
    if (!isNonEmptyString(child)) {
      valid = fail(issues, `${path}.children[${index}]`, "invalid-child", "子对象必须是非空 objectId 字符串");
    } else if (seen.has(child)) {
      valid = fail(issues, `${path}.children[${index}]`, "duplicate-child", `子对象重复：${child}`);
    } else {
      seen.add(child);
    }
  });
  return valid;
}

function validateContainer(
  value: unknown,
  path: string,
  issues: DocumentValidationIssue[],
): boolean {
  if (!isRecord(value)) {
    return fail(issues, path, "invalid-container", "容器必须是对象");
  }
  let valid = true;
  if (!isNonEmptyString(value["objectId"])) {
    valid = fail(issues, `${path}.objectId`, "invalid-object-id", "objectId 必须是非空字符串");
  }

  const type = value["type"];
  if (type === "grid-split") {
    if (
      !validateContainerChildren(
        value["children"],
        path,
        issues,
        2,
        MAX_GRID_SPLIT_CHILDREN,
      )
    ) {
      valid = false;
    }
    const split = value["split"];
    if (!isRecord(split)) {
      valid = fail(issues, `${path}.split`, "invalid-split", "split 必须是对象");
    } else {
      const columnPermille = split["columnSplitPermille"];
      const rowPermille = split["rowSplitPermille"];
      if (!isIntegerInRange(columnPermille, 0, 1000)) {
        valid = fail(
          issues,
          `${path}.split.columnSplitPermille`,
          "invalid-split-ratio",
          "columnSplitPermille 必须是 0–1000 的整数",
        );
      }
      if (!isIntegerInRange(rowPermille, 0, 1000)) {
        valid = fail(
          issues,
          `${path}.split.rowSplitPermille`,
          "invalid-split-ratio",
          "rowSplitPermille 必须是 0–1000 的整数",
        );
      }
      if (columnPermille === 0 && rowPermille === 0) {
        valid = fail(issues, `${path}.split`, "split-empty", "两条分割线不能同时为 0");
      }
    }
  } else if (type === "carousel") {
    if (
      !validateContainerChildren(
        value["children"],
        path,
        issues,
        MIN_CAROUSEL_PAGES,
        MAX_CAROUSEL_PAGES,
      )
    ) {
      valid = false;
    }
  } else {
    valid = fail(issues, `${path}.type`, "invalid-container-type", "容器 type 只能是 grid-split 或 carousel");
  }

  return valid;
}

/** 校验内容文档（卡片 + 容器树；不含几何与任何账务数据）。 */
export function validateContentDocumentV1(value: unknown): DocumentValidationResult<WorkbenchContentDocumentV1> {
  const issues: DocumentValidationIssue[] = [];
  if (!isRecord(value)) {
    return { ok: false, issues: [{ path: "$", code: "invalid-document", detail: "内容文档必须是对象" }] };
  }
  let valid = true;

  if (!isPositiveInteger(value["schemaVersion"])) {
    valid = fail(issues, "$.schemaVersion", "invalid-schema-version", "schemaVersion 必须是正整数");
  }

  const cards = value["cards"];
  const containers = value["containers"];
  if (!Array.isArray(cards)) {
    valid = fail(issues, "$.cards", "invalid-cards", "cards 必须是数组");
  }
  if (!Array.isArray(containers)) {
    valid = fail(issues, "$.containers", "invalid-containers", "containers 必须是数组");
  }
  if (!Array.isArray(cards) || !Array.isArray(containers)) {
    return { ok: false, issues };
  }

  if (containers.length > MAX_CONTAINERS_PER_WORKBENCH) {
    valid = fail(
      issues,
      "$.containers",
      "too-many-containers",
      `每工作台容器数不得超过 ${MAX_CONTAINERS_PER_WORKBENCH}`,
    );
  }
  if (cards.length + containers.length > MAX_OBJECTS_PER_WORKBENCH) {
    valid = fail(
      issues,
      "$",
      "too-many-objects",
      `卡片+容器数量不得超过 ${MAX_OBJECTS_PER_WORKBENCH}`,
    );
  }

  const seenObjectIds = new Set<string>();
  cards.forEach((card, index) => {
    const objectId = isRecord(card) ? card["objectId"] : undefined;
    if (isNonEmptyString(objectId)) {
      if (seenObjectIds.has(objectId)) {
        valid = fail(issues, `$.cards[${index}].objectId`, "duplicate-object-id", `objectId 重复：${objectId}`);
      }
      seenObjectIds.add(objectId);
    }
    if (!validateAnalysisCard(card, `$.cards[${index}]`, issues)) {
      valid = false;
    }
  });

  const containerObjectIds = new Set<string>();
  containers.forEach((container, index) => {
    const objectId = isRecord(container) ? container["objectId"] : undefined;
    if (isNonEmptyString(objectId)) {
      if (seenObjectIds.has(objectId)) {
        valid = fail(
          issues,
          `$.containers[${index}].objectId`,
          "duplicate-object-id",
          `objectId 重复：${objectId}`,
        );
      }
      seenObjectIds.add(objectId);
      containerObjectIds.add(objectId);
    }
    if (!validateContainer(container, `$.containers[${index}]`, issues)) {
      valid = false;
    }
  });

  // 引用检查：容器子对象必须存在、必须是卡片（首版容器深度 1，不允许嵌套容器）。
  const cardIds = new Set<string>();
  cards.forEach((card) => {
    const objectId = isRecord(card) ? card["objectId"] : undefined;
    if (isNonEmptyString(objectId)) {
      cardIds.add(objectId);
    }
  });
  containers.forEach((container, index) => {
    if (!isRecord(container) || !Array.isArray(container["children"])) {
      return;
    }
    const children = container["children"];
    children.forEach((child, childIndex) => {
      if (!isNonEmptyString(child)) {
        return;
      }
      if (containerObjectIds.has(child)) {
        valid = fail(
          issues,
          `$.containers[${index}].children[${childIndex}]`,
          "container-nesting",
          "首版容器内不允许再放容器（深度 1）",
        );
      } else if (!cardIds.has(child)) {
        valid = fail(
          issues,
          `$.containers[${index}].children[${childIndex}]`,
          "child-not-found",
          `子对象不存在于内容文档：${child}`,
        );
      }
    });
  });

  return valid ? { ok: true, value: value as unknown as WorkbenchContentDocumentV1 } : { ok: false, issues };
}

/** 序列化内容文档（确定性：同一对象同一字符串）。 */
export function serializeContentDocumentV1(document: WorkbenchContentDocumentV1): string {
  return JSON.stringify(document);
}

/** 序列化布局文档（确定性：同一对象同一字符串）。 */
export function serializeLayoutDocumentV1(document: LayoutDocumentV1): string {
  return JSON.stringify(document);
}

function parseJson(json: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return undefined;
  }
}

/** 解析并校验内容文档；永不抛异常。 */
export function parseContentDocumentV1(json: string): DocumentValidationResult<WorkbenchContentDocumentV1> {
  const parsed = parseJson(json);
  if (parsed === undefined) {
    return { ok: false, issues: [{ path: "$", code: "invalid-json", detail: "不是合法 JSON 字符串" }] };
  }
  return validateContentDocumentV1(parsed);
}

/** 解析并校验布局文档；永不抛异常。 */
export function parseLayoutDocumentV1(json: string): DocumentValidationResult<LayoutDocumentV1> {
  const parsed = parseJson(json);
  if (parsed === undefined) {
    return { ok: false, issues: [{ path: "$", code: "invalid-json", detail: "不是合法 JSON 字符串" }] };
  }
  return validateLayoutDocumentV1(parsed);
}
