/**
 * 布局投影 / 跨列迁移（D-1 纯函数骨架，D-0 先行）。
 *
 * 权威口径：所有者《Agent D 完整开发规格》§4–§7、§10–§13，以及
 * `docs/specs/design/S17-工作台布局与格式模板规格.md` §13–§17。
 *
 * 履约要点：
 * - 纯函数：`(权威布局, 目标列数, 尺寸契约) → 投影`，不读视口/时钟/财务数据，
 *   不写回权威布局；同一输入永远同一输出（确定性）。
 * - 单遍优先级贪心：按源位置 `(行, 列, objectId)` 升序依次放置，绝不回退重排。
 * - 先试原编号格；冲突时从编号 1 起找最早合法空位；宽度实在放不下时才降级
 *   （纵向无限，所以“被占”从不触发尺寸降级）。
 * - 每次投影都从权威布局重算，因此链式转换（3→4→2→3）不会累计漂移。
 *
 * 待决（已在文档登记，勿当作已确认）：
 * - OQ-LM-01 行尾/冲突策略：现默认 `size-first`（S），`position-first`（P）为
 *   候选对照；L 同行左移尚未实现。
 * - OQ-LM-03 垂直紧凑：本版不自动紧凑（保持源位置），参数待所有者确认。
 * - OQ-LM-04 Spacer 窄屏降级：现用“夹宽到目标列数”。
 * - OQ-LM-06 自动/主动收缩：`presentation` 视为用户意图字段；自动收缩只存在于
 *   投影结果，不写回。
 * - 卡片 `minSize`/`sizeLadder`/`compatSize` 数值由 W3 卡片声明，本层只执行。
 */

import type {
  AnalysisCardNode,
  ContainerNode,
  DegradeReason,
  DisplayForm,
  GridSize,
  LayoutGeometry,
  LayoutObjectKind,
  ObjectGeometry,
  ObjectSizeContract,
  ProjectOptions,
  ProjectedObject,
  ProjectionIssue,
  ProjectionResult,
  WorkbenchContentDocumentV1,
} from "./types.js";
import {
  MAX_COLUMNS,
  MAX_ROW_SPAN,
  MIN_COLUMNS,
} from "./types.js";
import {
  findEarliestFreeAnchor,
  isPositiveInteger,
  placementCells,
  placementFitsColumns,
  positionToRowCol,
  validateGeometry,
} from "./grid.js";

interface SourceEntry {
  readonly geometry: ObjectGeometry;
  readonly anchorValid: boolean;
  readonly anchor: number;
  readonly size: GridSize;
  readonly reasons: readonly DegradeReason[];
}

interface SizeCandidate {
  readonly size: GridSize;
  readonly form: DisplayForm;
  readonly reasons: readonly DegradeReason[];
}

interface ContentIndex {
  readonly kindByObjectId: ReadonlyMap<string, LayoutObjectKind>;
}

const DEFAULT_SIZE: GridSize = { colSpan: 1, rowSpan: 1 };

function compareStrings(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function sameSize(left: GridSize, right: GridSize): boolean {
  return left.colSpan === right.colSpan && left.rowSpan === right.rowSpan;
}

function dedupeReasons(reasons: readonly DegradeReason[]): readonly DegradeReason[] {
  return [...new Set(reasons)];
}

function sanitizeColumns(columns: number): { readonly columns: number; readonly valid: boolean } {
  if (!isPositiveInteger(columns)) {
    return { columns: 2, valid: false };
  }
  if (columns < MIN_COLUMNS) {
    return { columns: MIN_COLUMNS, valid: false };
  }
  if (columns > MAX_COLUMNS) {
    return { columns: MAX_COLUMNS, valid: false };
  }
  return { columns, valid: true };
}

function buildContentIndex(content: WorkbenchContentDocumentV1): {
  readonly index: ContentIndex;
  readonly issues: readonly ProjectionIssue[];
} {
  const kindByObjectId = new Map<string, LayoutObjectKind>();
  const issues: ProjectionIssue[] = [];

  for (const card of content.cards as readonly AnalysisCardNode[]) {
    if (kindByObjectId.has(card.objectId)) {
      issues.push({
        objectId: card.objectId,
        reason: "duplicate-dropped",
        detail: "内容文档中卡片 objectId 重复，按首次出现处理",
      });
      continue;
    }
    kindByObjectId.set(card.objectId, "analysis-card");
  }

  for (const container of content.containers as readonly ContainerNode[]) {
    if (kindByObjectId.has(container.objectId)) {
      issues.push({
        objectId: container.objectId,
        reason: "duplicate-dropped",
        detail: "内容文档中 objectId 重复（容器与其它对象冲突），按首次出现处理",
      });
      continue;
    }
    kindByObjectId.set(container.objectId, container.type);
  }

  return { index: { kindByObjectId }, issues };
}

function sanitizeEntry(geometry: ObjectGeometry): SourceEntry {
  const reasons: DegradeReason[] = [];
  const anchorValid = isPositiveInteger(geometry.anchor);
  if (!anchorValid) {
    reasons.push("source-invalid");
  }

  const colSpan = isPositiveInteger(geometry.colSpan) ? geometry.colSpan : DEFAULT_SIZE.colSpan;
  let rowSpan = isPositiveInteger(geometry.rowSpan) ? geometry.rowSpan : DEFAULT_SIZE.rowSpan;
  if (!isPositiveInteger(geometry.colSpan) || !isPositiveInteger(geometry.rowSpan)) {
    reasons.push("size-clamped");
  }
  if (rowSpan > MAX_ROW_SPAN) {
    rowSpan = MAX_ROW_SPAN;
    reasons.push("size-clamped");
  }

  return {
    geometry,
    anchorValid,
    anchor: anchorValid ? geometry.anchor : 0,
    size: { colSpan, rowSpan },
    reasons,
  };
}

/** 排序键：源位置 (行, 列, objectId) 升序；无有效位置的排最后（只按 objectId）。 */
function compareEntriesBySourceColumns(
  left: SourceEntry,
  right: SourceEntry,
  sourceColumns: number,
): number {
  if (left.anchorValid && right.anchorValid) {
    const leftPosition = positionToRowCol(left.anchor, sourceColumns);
    const rightPosition = positionToRowCol(right.anchor, sourceColumns);
    if (leftPosition.row !== rightPosition.row) {
      return leftPosition.row - rightPosition.row;
    }
    if (leftPosition.col !== rightPosition.col) {
      return leftPosition.col - rightPosition.col;
    }
    return compareStrings(left.geometry.objectId, right.geometry.objectId);
  }
  if (left.anchorValid !== right.anchorValid) {
    return left.anchorValid ? -1 : 1;
  }
  return compareStrings(left.geometry.objectId, right.geometry.objectId);
}

function buildCandidates(
  entry: SourceEntry,
  contract: ObjectSizeContract | undefined,
  targetColumns: number,
): readonly SizeCandidate[] {
  const { geometry, size: original } = entry;
  const kind = geometry.objectType;
  const candidates: SizeCandidate[] = [];

  const push = (size: GridSize, form: DisplayForm, reasons: readonly DegradeReason[]): void => {
    if (!isPositiveInteger(size.colSpan) || !isPositiveInteger(size.rowSpan)) {
      return;
    }
    if (!placementFitsColumns(1, size, targetColumns)) {
      return;
    }
    if (candidates.some((candidate) => candidate.form === form && sameSize(candidate.size, size))) {
      return;
    }
    candidates.push({ size, form, reasons });
  };

  if (kind === "spacer") {
    // OQ-LM-04 暂用 a：Spacer 夹宽到目标列数，高度保留。
    const clampedCol = Math.min(original.colSpan, targetColumns);
    const reasons: DegradeReason[] = clampedCol < original.colSpan ? ["width-overflow"] : [];
    push({ colSpan: clampedCol, rowSpan: original.rowSpan }, "full", reasons);
    return candidates;
  }

  if (kind === "grid-split" || kind === "carousel") {
    const collapsedSize = contract?.collapsedSize ?? DEFAULT_SIZE;
    if (geometry.presentation === "collapsed") {
      // 用户主动收缩：按用户意图显示 1×1 入口，完整尺寸另存 expandedSize。
      push(collapsedSize, "collapsed", ["user-collapsed"]);
      return candidates;
    }
    const minFullCols = contract?.minFullCols ?? 1;
    if (targetColumns < minFullCols) {
      push(collapsedSize, "collapsed", ["container-narrow"]);
      return candidates;
    }
    const fullSize = geometry.expandedSize ?? original;
    if (fullSize.colSpan <= targetColumns) {
      push(fullSize, "full", []);
    }
    if (contract) {
      for (const ladderSize of contract.sizeLadder) {
        if (ladderSize.colSpan <= targetColumns) {
          push(ladderSize, "compact", []);
        }
      }
    }
    push(collapsedSize, "collapsed", []);
    return candidates;
  }

  // 分析卡片：原始尺寸 → sizeLadder（紧凑）→ compat（1×1 入口）。
  const minSize = contract?.minSize ?? DEFAULT_SIZE;
  const originalFits = original.colSpan <= targetColumns;
  if (originalFits) {
    push(original, "full", []);
  }
  const degradedReasons: DegradeReason[] = originalFits ? [] : ["width-overflow"];
  const minColSpan = minSize.colSpan > targetColumns ? 1 : minSize.colSpan;
  const minRowSpan = minSize.rowSpan > MAX_ROW_SPAN ? MAX_ROW_SPAN : minSize.rowSpan;

  for (const ladderSize of contract?.sizeLadder ?? []) {
    if (ladderSize.colSpan < minColSpan || ladderSize.rowSpan < minRowSpan) {
      continue;
    }
    if (ladderSize.colSpan <= targetColumns) {
      push(ladderSize, "compact", degradedReasons);
    }
  }

  const compatSize = contract?.compatSize ?? DEFAULT_SIZE;
  push(compatSize, "compat", degradedReasons);
  return candidates;
}

function placeCandidates(
  entry: SourceEntry,
  candidates: readonly SizeCandidate[],
  targetColumns: number,
  occupied: ReadonlySet<number>,
  strategy: "size-first" | "position-first",
): { readonly anchor: number; readonly candidate: SizeCandidate } | null {
  const anchorIsFree = (candidate: SizeCandidate): boolean => {
    if (!entry.anchorValid) {
      return false;
    }
    if (!placementFitsColumns(entry.anchor, candidate.size, targetColumns)) {
      return false;
    }
    const cells = placementCells(entry.anchor, candidate.size, targetColumns);
    return cells.every((cell) => !occupied.has(cell));
  };

  if (strategy === "position-first") {
    for (const candidate of candidates) {
      if (anchorIsFree(candidate)) {
        return { anchor: entry.anchor, candidate };
      }
    }
    for (const candidate of candidates) {
      const anchor = findEarliestFreeAnchor(occupied, candidate.size, targetColumns);
      if (anchor !== null) {
        return { anchor, candidate };
      }
    }
    return null;
  }

  for (const candidate of candidates) {
    if (anchorIsFree(candidate)) {
      return { anchor: entry.anchor, candidate };
    }
    const anchor = findEarliestFreeAnchor(occupied, candidate.size, targetColumns);
    if (anchor !== null) {
      return { anchor, candidate };
    }
  }
  return null;
}

/**
 * 把权威布局投影到目标列数。
 *
 * @param layout 权威布局几何（`main` 或某档案）；不修改它。
 * @param content 内容文档（卡片/容器的身份来源）；Spacer 只在 layout 中。
 * @param options 目标列数、尺寸契约、迁移策略。
 */
export function projectLayout(
  layout: LayoutGeometry,
  content: WorkbenchContentDocumentV1,
  options: ProjectOptions,
): ProjectionResult {
  const issues: ProjectionIssue[] = [];
  const contentIndex = buildContentIndex(content);
  issues.push(...contentIndex.issues);

  const sourceColumns = sanitizeColumns(layout.baseCols);
  if (!sourceColumns.valid) {
    issues.push({
      reason: "source-invalid",
      detail: `布局 baseCols 非法，按 ${sourceColumns.columns} 列解释源位置`,
    });
  }
  const target = sanitizeColumns(options.targetColumns);
  if (!target.valid) {
    issues.push({
      reason: "source-invalid",
      detail: `目标列数非法，按 ${target.columns} 列投影`,
    });
  }
  const targetColumns = target.columns;
  const strategy = options.strategy ?? "size-first";

  const seenObjectIds = new Set<string>();
  const entries: SourceEntry[] = [];

  for (const geometry of layout.objects) {
    if (seenObjectIds.has(geometry.objectId)) {
      issues.push({
        objectId: geometry.objectId,
        reason: "duplicate-dropped",
        detail: "布局中 objectId 重复；按损坏数据规则只保留首次出现",
      });
      continue;
    }
    seenObjectIds.add(geometry.objectId);

    if (geometry.objectType === "analysis-card" || geometry.objectType === "grid-split" || geometry.objectType === "carousel") {
      if (contentIndex.index.kindByObjectId.get(geometry.objectId) !== geometry.objectType) {
        issues.push({
          objectId: geometry.objectId,
          reason: "orphan-dropped",
          detail: "布局对象在内容文档中不存在或类型不一致；视为孤儿，不参与投影",
        });
        continue;
      }
    }
    entries.push(sanitizeEntry(geometry));
  }

  entries.sort((left, right) => compareEntriesBySourceColumns(left, right, sourceColumns.columns));

  const occupied = new Set<number>();
  const projected: ProjectedObject[] = [];

  for (const entry of entries) {
    const contract = options.contracts?.[entry.geometry.objectId];
    const candidates = buildCandidates(entry, contract, targetColumns);
    if (candidates.length === 0) {
      issues.push({
        objectId: entry.geometry.objectId,
        reason: "source-invalid",
        detail: "没有可放置的形态（尺寸契约或对象宽度异常）",
      });
      continue;
    }
    const placed = placeCandidates(entry, candidates, targetColumns, occupied, strategy);
    if (placed === null) {
      issues.push({
        objectId: entry.geometry.objectId,
        reason: "source-invalid",
        detail: "在目标列数下无法放置该对象",
      });
      continue;
    }

    const reasons: DegradeReason[] = [...entry.reasons, ...placed.candidate.reasons];
    if (entry.anchorValid && placed.anchor !== entry.anchor) {
      reasons.push("anchor-occupied");
    }
    if (contract === undefined && entry.geometry.objectType !== "spacer") {
      reasons.push("missing-contract");
    }

    for (const cell of placementCells(placed.anchor, placed.candidate.size, targetColumns)) {
      occupied.add(cell);
    }
    projected.push({
      objectId: entry.geometry.objectId,
      objectType: entry.geometry.objectType,
      anchor: placed.anchor,
      colSpan: placed.candidate.size.colSpan,
      rowSpan: placed.candidate.size.rowSpan,
      form: placed.candidate.form,
      sourceAnchor: entry.anchorValid ? entry.anchor : null,
      degradedReasons: dedupeReasons(reasons),
    });
  }

  const validation = validateGeometry(
    projected.map((object) => ({
      objectId: object.objectId,
      objectType: object.objectType,
      anchor: object.anchor,
      colSpan: object.colSpan,
      rowSpan: object.rowSpan,
    })),
    targetColumns,
  );
  for (const problem of validation) {
    issues.push({
      ...(problem.objectId === undefined ? {} : { objectId: problem.objectId }),
      reason: "source-invalid",
      detail: `投影不变量校验失败（${problem.code}）：${problem.detail}`,
    });
  }

  return { columns: targetColumns, objects: projected, issues };
}

/** 把投影结果转回几何（用于“无累计漂移”测试：再次投影必须幂等）。 */
export function projectionToGeometry(result: ProjectionResult): LayoutGeometry {
  return {
    baseCols: result.columns,
    objects: result.objects.map((object) => ({
      objectId: object.objectId,
      objectType: object.objectType,
      anchor: object.anchor,
      colSpan: object.colSpan,
      rowSpan: object.rowSpan,
    })),
  };
}
