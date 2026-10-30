/**
 * S18 · 分析工作台响应式布局（1.18.01）：基础权威布局 + 列数专属布局 + 响应式投影。
 *
 * 三个概念（所有者 2026-10-30「分析工作台响应式布局引擎重构」§3）：
 *
 * | 概念 | 存在哪里 | 谁写 |
 * |---|---|---|
 * | **基础权威布局** | 布局文档 `main`（`baseCols` + 逻辑网格位置与跨度） | 在基础列数下保存排列，或新增 / 删除卡片后保存 |
 * | **列数专属布局** | 布局文档 `profiles`，键 `cols-<N>`，`mode = "independent"` | 在非基础列数下只调整排列并保存 |
 * | **临时显示布局** | 不存储；每次由本文件从上面两者算出 | 永不写回 |
 *
 * 解析顺序（§4，`resolveDisplayLayout`）：
 * - A：目标列数有**有效**的专属布局 → 用它（不再从基础布局推）；
 * - B：目标列数等于基础列数 → 原样用基础布局（不重排）；
 * - C：其它 → `reflowLayout(基础布局, 目标列数)`。**永远从基础布局算**，不从屏幕上的结果、也不从别的列数的
 *   专属布局再算，所以 3 → 6 → 5 → 3 不会累计漂移。
 *
 * ⚠️ **为什么不再用 S17 的 `projectLayout` 跨列**：它保留的是行优先**编号**（规格 §4「先试原编号格」）。
 * 编号只在同一列数下有意义——三列里的第 7 格（第 3 行第 1 列）到五列里就成了第 2 行第 2 列，于是卡片
 * 错位、整片空白。这里改为按**阅读顺序**重新排：保持先后，允许有限回填，再用卡片自己声明的尺寸填掉
 * 被包围的空洞。`projectLayout` 仍用于同一列数下的原样显示与损坏数据修复（它在同列数下是恒等的）。
 *
 * 本文件是纯函数：不读视口、时钟、随机数与财务数据。像素只以参数形式进来（容器宽度、间距）。
 */

import type {
  AnalysisCardNode,
  ContainerNode,
  DegradeReason,
  DisplayForm,
  GridSize,
  LayoutDocumentV1,
  LayoutGeometry,
  LayoutObjectKind,
  ObjectGeometry,
  ObjectSizeContract,
  ProjectedObject,
  ProjectionIssue,
  ProjectionResult,
  WorkbenchContentDocumentV1,
} from "./types.js";
import { MAX_COLUMNS, MAX_ROW_SPAN, MIN_COLUMNS } from "./types.js";
import { isPositiveInteger, positionToRowCol, validateGeometry } from "./grid.js";
import { projectLayout } from "./projection.js";

// ---------------------------------------------------------------------------
// 列数专属布局
// ---------------------------------------------------------------------------

/** 列数专属布局的档案键前缀（沿用 S17 档案的占位键格式 `cols-<N>`，不改存储 schema）。 */
export const COLUMN_OVERRIDE_PREFIX = "cols-";

/** 显示与编辑允许的最多列数（schema 允许 12；超过 8 列时每格太窄，分析卡片不再可读）。 */
export const RESPONSIVE_MAX_COLUMNS = 8;

export function columnOverrideKey(columns: number): string {
  return `${COLUMN_OVERRIDE_PREFIX}${String(columns)}`;
}

function overrideColumnsOf(profileKey: string): number | null {
  if (!profileKey.startsWith(COLUMN_OVERRIDE_PREFIX)) return null;
  const text = profileKey.slice(COLUMN_OVERRIDE_PREFIX.length);
  if (!/^[1-9]\d*$/.test(text)) return null;
  const columns = Number(text);
  return columns >= MIN_COLUMNS && columns <= MAX_COLUMNS ? columns : null;
}

/**
 * 网格根上应当出现的对象：不在任何容器里的卡片 + 容器。Spacer 只属于某一份几何，不算。
 * 专属布局的对象集合必须与它完全一致才有效（卡片集合变了，旧的专属布局就不再适用）。
 */
export function layoutRootObjectIds(content: WorkbenchContentDocumentV1): ReadonlySet<string> {
  const nested = new Set<string>();
  for (const container of content.containers) for (const child of container.children) nested.add(child);
  const ids = new Set<string>();
  for (const card of content.cards) if (!nested.has(card.objectId)) ids.add(card.objectId);
  for (const container of content.containers) ids.add(container.objectId);
  return ids;
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const item of left) if (!right.has(item)) return false;
  return true;
}

function nonSpacerIds(geometry: LayoutGeometry): ReadonlySet<string> {
  return new Set(geometry.objects.filter((object) => object.objectType !== "spacer").map((object) => object.objectId));
}

/**
 * 专属布局应当包含的对象：基础布局里实际会显示的根对象（在内容文档里存在、且不在容器里的卡片与容器）。
 * 内容里有、基础布局里却没有位置的对象（管线只给警告的「未定位」对象）本来就不显示，不要求专属布局包含它。
 */
function expectedOverrideIds(layout: LayoutDocumentV1, content: WorkbenchContentDocumentV1): ReadonlySet<string> {
  const roots = layoutRootObjectIds(content);
  return new Set([...nonSpacerIds(layout.main)].filter((id) => roots.has(id)));
}

/** 这一份专属布局对当前卡片集合是否仍然有效（列数一致、几何合法、对象集合一致）。 */
function overrideIsValid(geometry: LayoutGeometry, columns: number, expected: ReadonlySet<string>): boolean {
  if (geometry.baseCols !== columns) return false;
  if (validateGeometry(geometry.objects, columns).length > 0) return false;
  return sameSet(nonSpacerIds(geometry), expected);
}

/**
 * 目标列数的有效专属布局；没有、模式不是 independent、或已经与卡片集合不符（例如旧版本客户端在别处
 * 新增了卡片）时返回 null——此时按规则 B / C 显示，旧数据不删除，等下一次保存时清理。
 */
export function columnOverrideFor(
  layout: LayoutDocumentV1,
  content: WorkbenchContentDocumentV1,
  columns: number,
): LayoutGeometry | null {
  if (layout.mode !== "independent") return null;
  const profile = (layout.profiles ?? []).find((item) => item.profileKey === columnOverrideKey(columns));
  if (profile === undefined) return null;
  return overrideIsValid(profile.geometry, columns, expectedOverrideIds(layout, content)) ? profile.geometry : null;
}

/** 已保存且仍然有效的专属布局对应的列数（升序）。 */
export function columnOverrideList(layout: LayoutDocumentV1, content: WorkbenchContentDocumentV1): readonly number[] {
  if (layout.mode !== "independent") return [];
  const expected = expectedOverrideIds(layout, content);
  const list: number[] = [];
  for (const profile of layout.profiles ?? []) {
    const columns = overrideColumnsOf(profile.profileKey);
    if (columns !== null && overrideIsValid(profile.geometry, columns, expected)) list.push(columns);
  }
  return list.sort((left, right) => left - right);
}

/** 有专属布局 ⇔ `mode = "independent"`；没有时去掉 `profiles` 字段并回到 unified。 */
function withProfiles(layout: LayoutDocumentV1, profiles: LayoutDocumentV1["profiles"]): LayoutDocumentV1 {
  const base = {
    schemaVersion: layout.schemaVersion,
    layoutAlgorithmVersion: layout.layoutAlgorithmVersion,
    main: layout.main,
    ...(layout.previousMain === undefined ? {} : { previousMain: layout.previousMain }),
  };
  if (profiles === undefined || profiles.length === 0) return { ...base, mode: "unified" };
  return { ...base, mode: "independent", profiles };
}

/**
 * 写入（或替换）一个列数的专属布局。从 unified 切到 independent 时，原先**未启用**的旧档案不带过来
 * （它们在 unified 模式下本来就不参与显示，带过来会突然生效）。
 */
export function withColumnOverride(layout: LayoutDocumentV1, columns: number, geometry: LayoutGeometry): LayoutDocumentV1 {
  const key = columnOverrideKey(columns);
  const kept = layout.mode === "independent" ? (layout.profiles ?? []).filter((profile) => profile.profileKey !== key) : [];
  return withProfiles(layout, [...kept, { profileKey: key, geometry: { baseCols: columns, objects: geometry.objects } }]);
}

/**
 * 删除一个列数的专属布局（「恢复此列数的自动排列」）；其它列数的专属布局不动。
 * unified 模式下档案本来就不生效：原样返回，不能因为删了一份就把剩下的旧档案「激活」。
 */
export function withoutColumnOverride(layout: LayoutDocumentV1, columns: number): LayoutDocumentV1 {
  if (layout.mode !== "independent" || layout.profiles === undefined) return layout;
  const key = columnOverrideKey(columns);
  if (!layout.profiles.some((profile) => profile.profileKey === key)) return layout;
  return withProfiles(layout, layout.profiles.filter((profile) => profile.profileKey !== key));
}

/** 去掉全部专属布局（卡片集合变化后，基础布局换成新的那一份）。 */
export function withoutColumnOverrides(layout: LayoutDocumentV1): LayoutDocumentV1 {
  return withProfiles(layout, undefined);
}

/** 去掉已经与卡片集合不符的 `cols-N` 专属布局；看不懂的其它档案原样保留。 */
function withoutStaleOverrides(layout: LayoutDocumentV1, content: WorkbenchContentDocumentV1): LayoutDocumentV1 {
  if (layout.mode !== "independent" || layout.profiles === undefined) return layout;
  const expected = expectedOverrideIds(layout, content);
  const kept = layout.profiles.filter((profile) => {
    const columns = overrideColumnsOf(profile.profileKey);
    return columns === null || overrideIsValid(profile.geometry, columns, expected);
  });
  return kept.length === layout.profiles.length ? layout : withProfiles(layout, kept);
}

// ---------------------------------------------------------------------------
// 响应式投影（规则 C）
// ---------------------------------------------------------------------------

export interface ReflowOptions {
  readonly targetColumns: number;
  /** 卡片 / 容器的尺寸契约（最小尺寸、可选尺寸档）；缺失时按 1×1 处理并记 missing-contract。 */
  readonly contracts?: Readonly<Record<string, ObjectSizeContract>>;
}

interface ReflowEntry {
  readonly geometry: ObjectGeometry;
  readonly row: number;
  readonly col: number;
  readonly size: GridSize;
  readonly reasons: readonly DegradeReason[];
}

interface ReflowCandidate {
  readonly size: GridSize;
  readonly form: DisplayForm;
  readonly reasons: readonly DegradeReason[];
}

const UNIT: GridSize = { colSpan: 1, rowSpan: 1 };

function clampColumns(columns: number, fallback: number): { readonly columns: number; readonly valid: boolean } {
  if (!isPositiveInteger(columns)) return { columns: fallback, valid: false };
  if (columns < MIN_COLUMNS) return { columns: MIN_COLUMNS, valid: false };
  if (columns > MAX_COLUMNS) return { columns: MAX_COLUMNS, valid: false };
  return { columns, valid: true };
}

function compareIds(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function fitsMinimum(size: GridSize, minimum: GridSize, columns: number): boolean {
  // 目标列数比最小宽度还窄时（例如 1 列），最小宽度按目标列数算，否则整张卡片都放不下。
  return size.colSpan >= Math.min(minimum.colSpan, columns) && size.rowSpan >= Math.min(minimum.rowSpan, MAX_ROW_SPAN);
}

/**
 * 一个对象在目标列数下的候选尺寸，按优先顺序：
 * - 卡片：原尺寸（放得下且不小于最小尺寸）→ 尺寸档里与原尺寸面积最接近的 → 1×1 兼容入口；
 * - 容器：用户主动收起 → 收起；列数不足以完整显示 → 收起；否则原尺寸 → 尺寸档 → 收起。
 * 纵向无限，所以「被占」从不导致缩小——只有宽度放不下才降级。
 */
function reflowCandidates(entry: ReflowEntry, contract: ObjectSizeContract | undefined, columns: number): readonly ReflowCandidate[] {
  const list: ReflowCandidate[] = [];
  const push = (size: GridSize, form: DisplayForm, reasons: readonly DegradeReason[]): void => {
    if (!isPositiveInteger(size.colSpan) || !isPositiveInteger(size.rowSpan) || size.colSpan > columns || size.rowSpan > MAX_ROW_SPAN) return;
    if (list.some((item) => item.form === form && item.size.colSpan === size.colSpan && item.size.rowSpan === size.rowSpan)) return;
    list.push({ size, form, reasons });
  };
  const original = entry.size;
  const kind = entry.geometry.objectType;
  if (kind === "grid-split" || kind === "carousel") {
    const collapsed = contract?.collapsedSize ?? UNIT;
    if (entry.geometry.presentation === "collapsed") {
      push(collapsed, "collapsed", ["user-collapsed"]);
      return list;
    }
    if (columns < (contract?.minFullCols ?? 1)) {
      push(collapsed, "collapsed", ["container-narrow"]);
      return list;
    }
    push(entry.geometry.expandedSize ?? original, "full", []);
    for (const size of byCloseness(contract?.sizeLadder ?? [], original)) push(size, "compact", ["width-overflow"]);
    push(collapsed, "collapsed", ["width-overflow"]);
    return list;
  }
  const minimum = contract?.minSize ?? UNIT;
  if (original.colSpan <= columns && fitsMinimum(original, minimum, columns)) push(original, "full", []);
  const reasons: DegradeReason[] = original.colSpan <= columns ? ["size-clamped"] : ["width-overflow"];
  for (const size of byCloseness(contract?.sizeLadder ?? [], original)) {
    if (fitsMinimum(size, minimum, columns)) push(size, "compact", reasons);
  }
  push(contract?.compatSize ?? UNIT, "compat", reasons);
  return list;
}

/** 尺寸档按「与原尺寸面积差」升序，其次更宽、更高优先（确定性排序）。 */
function byCloseness(sizes: readonly GridSize[], original: GridSize): readonly GridSize[] {
  const area = original.colSpan * original.rowSpan;
  return [...sizes].sort((left, right) =>
    Math.abs(left.colSpan * left.rowSpan - area) - Math.abs(right.colSpan * right.rowSpan - area) ||
    right.colSpan - left.colSpan ||
    right.rowSpan - left.rowSpan,
  );
}

/** 行列 → 0 起的格子下标（`(row-1) * columns + (col-1)`），只在本文件内部使用。 */
function cellIndex(row: number, col: number, columns: number): number {
  return (row - 1) * columns + (col - 1);
}

class Occupancy {
  private readonly owners = new Map<number, string>();
  bottom = 0;
  constructor(readonly columns: number) {}
  owner(row: number, col: number): string | undefined {
    if (row < 1 || col < 1 || col > this.columns) return undefined;
    return this.owners.get(cellIndex(row, col, this.columns));
  }
  free(row: number, col: number, size: GridSize): boolean {
    if (col + size.colSpan - 1 > this.columns) return false;
    for (let r = row; r < row + size.rowSpan; r += 1) {
      for (let c = col; c < col + size.colSpan; c += 1) if (this.owners.has(cellIndex(r, c, this.columns))) return false;
    }
    return true;
  }
  take(row: number, col: number, size: GridSize, id: string): void {
    for (let r = row; r < row + size.rowSpan; r += 1) {
      for (let c = col; c < col + size.colSpan; c += 1) this.owners.set(cellIndex(r, c, this.columns), id);
    }
    this.bottom = Math.max(this.bottom, row + size.rowSpan - 1);
  }
  /** 第 `col` 列在 `row` 行**以下**是否还有对象（有 = 这一格是被包围的空洞，不是页面末尾的自然留白）。 */
  coveredBelow(row: number, col: number): boolean {
    for (let r = row + 1; r <= this.bottom; r += 1) if (this.owners.has(cellIndex(r, col, this.columns))) return true;
    return false;
  }
}

/**
 * 回填范围：下一张卡片最早可以放到「最近放下的这几张卡片里最靠上的那一行」。后面的小卡片因此能补进
 * 前一两张卡片旁边的空位，但不会跳到很靠前的位置打乱阅读顺序（位置最多比顺序提前一两张）。
 */
const BACKFILL_WINDOW = 2;

/**
 * 把一份几何（基础布局）响应式地排到目标列数。确定性：同一输入永远同一输出；不写回输入。
 *
 * 1. 按源布局的阅读顺序（行、列、ID）排序；Spacer 不参与（留白是相对于它所在列数的意图，换了列数就
 *    没有对应的意义，只会制造空洞）。
 * 2. 尺寸：原尺寸放得下就保持（格数不变——自动列数把每格宽度控制在相近范围，卡片的实际大小因此接近），
 *    放不下按尺寸档降级。
 * 3. 位置：依次放到「最近放下的两张卡片里最靠上的那一行」起最早的空位——保持先后，又能让后面的小卡片
 *    补进前一两张卡片旁边的空缺（`BACKFILL_WINDOW`）。
 * 4. 填空洞：某张卡片右侧是被包围的空洞（下面还有内容）时，在它自己的尺寸档里横向加宽补上。
 *    只横向加宽：数字卡片不会因此变成无意义的高卡片。
 */
export function reflowLayout(
  geometry: LayoutGeometry,
  content: WorkbenchContentDocumentV1,
  options: ReflowOptions,
): ProjectionResult {
  const issues: ProjectionIssue[] = [];
  const kinds = new Map<string, LayoutObjectKind>();
  for (const card of content.cards as readonly AnalysisCardNode[]) {
    if (kinds.has(card.objectId)) issues.push({ objectId: card.objectId, reason: "duplicate-dropped", detail: "内容文档中卡片 objectId 重复" });
    else kinds.set(card.objectId, "analysis-card");
  }
  for (const container of content.containers as readonly ContainerNode[]) {
    if (kinds.has(container.objectId)) issues.push({ objectId: container.objectId, reason: "duplicate-dropped", detail: "内容文档中 objectId 重复" });
    else kinds.set(container.objectId, container.type);
  }
  const source = clampColumns(geometry.baseCols, 2);
  const target = clampColumns(options.targetColumns, 2);
  if (!source.valid) issues.push({ reason: "source-invalid", detail: `布局 baseCols 非法，按 ${String(source.columns)} 列解释` });
  if (!target.valid) issues.push({ reason: "source-invalid", detail: `目标列数非法，按 ${String(target.columns)} 列排布` });
  const columns = target.columns;

  const seen = new Set<string>();
  const entries: ReflowEntry[] = [];
  for (const object of geometry.objects) {
    if (seen.has(object.objectId)) {
      issues.push({ objectId: object.objectId, reason: "duplicate-dropped", detail: "布局中 objectId 重复，只保留首次出现" });
      continue;
    }
    seen.add(object.objectId);
    if (object.objectType === "spacer") continue;
    if (kinds.get(object.objectId) !== object.objectType) {
      issues.push({ objectId: object.objectId, reason: "orphan-dropped", detail: "布局对象在内容文档中不存在或类型不一致" });
      continue;
    }
    const reasons: DegradeReason[] = [];
    const anchorValid = isPositiveInteger(object.anchor);
    if (!anchorValid) reasons.push("source-invalid");
    const sizeValid = isPositiveInteger(object.colSpan) && isPositiveInteger(object.rowSpan);
    if (!sizeValid) reasons.push("size-clamped");
    const position = anchorValid ? positionToRowCol(object.anchor, source.columns) : { row: Number.MAX_SAFE_INTEGER, col: 1 };
    entries.push({
      geometry: object,
      row: position.row,
      col: position.col,
      size: sizeValid ? { colSpan: object.colSpan, rowSpan: Math.min(object.rowSpan, MAX_ROW_SPAN) } : UNIT,
      reasons,
    });
  }
  entries.sort((left, right) => left.row - right.row || left.col - right.col || compareIds(left.geometry.objectId, right.geometry.objectId));

  interface Placed {
    readonly entry: ReflowEntry;
    readonly row: number;
    readonly col: number;
    size: GridSize;
    readonly form: DisplayForm;
    readonly reasons: readonly DegradeReason[];
    readonly ladder: readonly GridSize[];
  }
  const grid = new Occupancy(columns);
  const placed: Placed[] = [];
  for (const entry of entries) {
    const contract = options.contracts?.[entry.geometry.objectId];
    const chosen = reflowCandidates(entry, contract, columns)[0];
    if (chosen === undefined) {
      issues.push({ objectId: entry.geometry.objectId, reason: "source-invalid", detail: "没有可放置的形态" });
      continue;
    }
    const recent = placed.slice(-BACKFILL_WINDOW);
    let row = recent.length === 0 ? 1 : Math.min(...recent.map((item) => item.row));
    let col = 1;
    while (!grid.free(row, col, chosen.size)) {
      col += 1;
      if (col + chosen.size.colSpan - 1 > columns) {
        col = 1;
        row += 1;
      }
    }
    grid.take(row, col, chosen.size, entry.geometry.objectId);
    const reasons = [...entry.reasons, ...chosen.reasons];
    if (contract === undefined) reasons.push("missing-contract");
    placed.push({
      entry,
      row,
      col,
      size: chosen.size,
      form: chosen.form,
      reasons: [...new Set(reasons)],
      ladder: chosen.form === "full" || chosen.form === "compact" ? contract?.sizeLadder ?? [] : [],
    });
  }

  // 填空洞：只横向、只用对象自己声明过的尺寸、只填下面还有内容的空洞（页面末尾的留白不算）。
  for (const item of placed) {
    if (item.ladder.length === 0) continue;
    const startCol = item.col + item.size.colSpan;
    let run = 0;
    for (let c = startCol; c <= columns; c += 1) {
      let empty = true;
      for (let r = item.row; r < item.row + item.size.rowSpan; r += 1) {
        if (grid.owner(r, c) !== undefined) {
          empty = false;
          break;
        }
      }
      if (!empty || !grid.coveredBelow(item.row + item.size.rowSpan - 1, c)) break;
      run += 1;
    }
    if (run === 0) continue;
    const grown = item.ladder
      .filter((size) => size.rowSpan === item.size.rowSpan && size.colSpan > item.size.colSpan && size.colSpan <= item.size.colSpan + run)
      .sort((left, right) => right.colSpan - left.colSpan)[0];
    if (grown === undefined) continue;
    grid.take(item.row, item.col, grown, item.entry.geometry.objectId);
    item.size = grown;
  }

  const objects: ProjectedObject[] = placed.map((item) => ({
    objectId: item.entry.geometry.objectId,
    objectType: item.entry.geometry.objectType,
    anchor: cellIndex(item.row, item.col, columns) + 1,
    colSpan: item.size.colSpan,
    rowSpan: item.size.rowSpan,
    form: item.form,
    sourceAnchor: isPositiveInteger(item.entry.geometry.anchor) ? item.entry.geometry.anchor : null,
    degradedReasons: item.reasons,
  }));
  for (const problem of validateGeometry(objects, columns)) {
    issues.push({
      ...(problem.objectId === undefined ? {} : { objectId: problem.objectId }),
      reason: "source-invalid",
      detail: `投影不变量校验失败（${problem.code}）：${problem.detail}`,
    });
  }
  return { columns, objects, issues };
}

// ---------------------------------------------------------------------------
// 统一解析入口
// ---------------------------------------------------------------------------

export type DisplayLayoutSource = "override" | "canonical" | "projection";

export interface DisplayLayout {
  readonly columns: number;
  /** override = 这一列数的专属布局；canonical = 基础布局原样；projection = 从基础布局响应式排出。 */
  readonly source: DisplayLayoutSource;
  readonly projection: ProjectionResult;
}

export interface DisplayLayoutOptions {
  readonly targetColumns: number;
  readonly contracts?: Readonly<Record<string, ObjectSizeContract>>;
}

/** 规则 A → B → C（见文件头）。纯函数：同一份文档 + 同一列数 → 同一结果；不写回。 */
export function resolveDisplayLayout(
  layout: LayoutDocumentV1,
  content: WorkbenchContentDocumentV1,
  options: DisplayLayoutOptions,
): DisplayLayout {
  const columns = clampColumns(options.targetColumns, 2).columns;
  const contracts = options.contracts === undefined ? {} : { contracts: options.contracts };
  const override = columnOverrideFor(layout, content, columns);
  if (override !== null) {
    return { columns, source: "override", projection: projectLayout(override, content, { targetColumns: columns, ...contracts }) };
  }
  if (columns === layout.main.baseCols) {
    return { columns, source: "canonical", projection: projectLayout(layout.main, content, { targetColumns: columns, ...contracts }) };
  }
  return { columns, source: "projection", projection: reflowLayout(layout.main, content, { targetColumns: columns, ...contracts }) };
}

/**
 * 显示结果转成可编辑的几何（编辑器从**看到的那一份**开始，§11）。用户主动收起的容器保留
 * `presentation` 与展开尺寸；自动收起只是显示形态，不带进几何。
 */
export function displayGeometry(display: DisplayLayout, layout: LayoutDocumentV1, content: WorkbenchContentDocumentV1): LayoutGeometry {
  const sourceGeometry = display.source === "override" ? columnOverrideFor(layout, content, display.columns) ?? layout.main : layout.main;
  const sourceById = new Map(sourceGeometry.objects.map((object) => [object.objectId, object] as const));
  return {
    baseCols: display.columns,
    objects: display.projection.objects.map((object) => {
      const before = sourceById.get(object.objectId);
      const base: ObjectGeometry = { objectId: object.objectId, objectType: object.objectType, anchor: object.anchor, colSpan: object.colSpan, rowSpan: object.rowSpan };
      if (before?.presentation === "collapsed" && object.form === "collapsed") {
        return { ...base, presentation: "collapsed", ...(before.expandedSize === undefined ? {} : { expandedSize: before.expandedSize }) };
      }
      return base;
    }),
  };
}

/**
 * 编辑会话用的布局文档：`main` 就是编辑列数下的那一份几何，**不带**专属布局（编辑命令只操作 `main`；
 * 保存时由 `commitLayoutEdit` 决定写回基础布局还是某个列数的专属布局）。
 */
export function editingLayout(layout: LayoutDocumentV1, geometry: LayoutGeometry): LayoutDocumentV1 {
  return { schemaVersion: layout.schemaVersion, layoutAlgorithmVersion: layout.layoutAlgorithmVersion, mode: "unified", main: geometry };
}

// ---------------------------------------------------------------------------
// 网格尺寸、排布质量与自动列数（§7、§9）
// ---------------------------------------------------------------------------

/** 每格最窄（px）：手机原有的下限，再窄数字与图表就读不清了。手动列数的上限按它算。 */
export const GRID_MIN_CELL_WIDTH = 104;
/** 自动列数瞄准的每格宽度（px）：手机两列约 160、iPad 横屏约 170–190，卡片在不同设备上大小相近。 */
export const GRID_IDEAL_CELL_WIDTH = 172;
/** 基础布局 / 专属布局在每格不宽于它时被自动模式优先采用（保持用户亲手排的样子）。 */
export const GRID_COMFORT_CELL_WIDTH = 280;
/** 行高下限（px）：与 1.17 的固定行高相同，手机上的卡片高度因此不变。 */
export const GRID_MIN_ROW_HEIGHT = 116;
/** 行高上限（px）：列很宽时行高不随之无限增长（数字卡片不需要很高）。 */
export const GRID_MAX_ROW_HEIGHT = 168;
/** 格宽超过这个值后行高才开始增加（手机两列的格宽 157–185px，因此手机上行高不变）。 */
export const GRID_ROW_GROWTH_FROM = 190;
/** 格宽每多 1px，行高多这么多：比按固定宽高比放大平缓，宽格子里的卡片不会被拉得又高又空。 */
export const GRID_ROW_GROWTH = 0.35;

export function gridCellWidth(width: number, columns: number, gap: number): number {
  if (!(width > 0) || !isPositiveInteger(columns)) return 0;
  return Math.max(0, (width - gap * (columns - 1)) / columns);
}

/**
 * 行高随格宽变化（§9）：`116 + 0.35 × (格宽 − 190)`，夹在 116–168 之间。
 * 手机与 iPad 六列（格宽 ≤ 190）不变；四列约 125、两列（格宽约 264）约 142；手动把很宽的工作区设成两列时封顶 168，
 * 此时数字卡片会很扁——由编辑器给出「较宽松」提示，而不是把行高一起放大。
 */
export function gridRowHeight(cellWidth: number): number {
  if (!(cellWidth > 0)) return GRID_MIN_ROW_HEIGHT;
  const grown = GRID_MIN_ROW_HEIGHT + GRID_ROW_GROWTH * Math.max(0, cellWidth - GRID_ROW_GROWTH_FROM);
  return Math.round(Math.min(GRID_MAX_ROW_HEIGHT, grown));
}

/** 这个宽度最多能放几列（每格不窄于 `GRID_MIN_CELL_WIDTH`，最多 `RESPONSIVE_MAX_COLUMNS`；至少 1 列）。 */
export function gridColumnLimit(width: number, gap: number): number {
  if (!(width > 0)) return 1;
  return Math.max(1, Math.min(RESPONSIVE_MAX_COLUMNS, Math.floor((width + gap) / (GRID_MIN_CELL_WIDTH + gap))));
}

export interface LayoutQuality {
  /** 占用到的最后一行。 */
  readonly rows: number;
  /** 被包围的空洞格数（下面还有内容的空格；页面末尾的自然留白不算）。 */
  readonly holes: number;
  /** 空洞占「列数 × 行数」的比例。 */
  readonly holeRatio: number;
  /**
   * 某一列在它最后一个对象下面的空格数（例如三列里全是两格宽的卡片时，右边整列空着）。
   * 最后一行不算：页面末尾参差不齐是正常的。
   */
  readonly tail: number;
  readonly tailRatio: number;
  /** 最后一行的空格（页尾参差）。 */
  readonly end: number;
  readonly endRatio: number;
  /** 被迫缩小（放不下原尺寸）的对象数。 */
  readonly degraded: number;
  readonly objects: number;
}

/** 一份几何（例如编辑中的排列）的排布质量；Spacer 是有意留白，按占用计。 */
export function geometryQuality(geometry: LayoutGeometry): LayoutQuality {
  return layoutQuality({
    columns: geometry.baseCols,
    objects: geometry.objects.map((object) => ({ ...object, form: "full", sourceAnchor: null, degradedReasons: [] })),
    issues: [],
  });
}

export function layoutQuality(projection: ProjectionResult): LayoutQuality {
  const grid = new Occupancy(projection.columns);
  let degraded = 0;
  for (const object of projection.objects) {
    const { row, col } = positionToRowCol(object.anchor, projection.columns);
    grid.take(row, col, object, object.objectId);
    if (object.degradedReasons.includes("width-overflow")) degraded += 1;
  }
  let holes = 0;
  let tail = 0;
  let end = 0;
  for (let row = 1; row <= grid.bottom; row += 1) {
    for (let col = 1; col <= projection.columns; col += 1) {
      if (grid.owner(row, col) !== undefined) continue;
      if (grid.coveredBelow(row, col)) holes += 1;
      else if (row < grid.bottom) tail += 1;
      else end += 1;
    }
  }
  const area = grid.bottom * projection.columns;
  const ratio = (count: number) => (area === 0 ? 0 : count / area);
  return {
    rows: grid.bottom,
    holes,
    holeRatio: ratio(holes),
    tail,
    tailRatio: ratio(tail),
    end,
    endRatio: ratio(end),
    degraded,
    objects: projection.objects.length,
  };
}

export interface AutoColumnsOptions {
  /** 网格内容区的实际宽度（px，容器测量值，不是窗口宽度）。 */
  readonly width: number;
  readonly gap: number;
  readonly contracts?: Readonly<Record<string, ObjectSizeContract>>;
  /** 上一次自动选的列数：分数接近时保持不变，避免在阈值附近来回跳。 */
  readonly previous?: number | null;
}

export interface ColumnScore {
  readonly columns: number;
  readonly cellWidth: number;
  readonly score: number;
  readonly source: DisplayLayoutSource;
}

/** 分数越低越好（导出给测试与诊断用）。 */
export function scoreColumns(
  layout: LayoutDocumentV1,
  content: WorkbenchContentDocumentV1,
  options: AutoColumnsOptions,
): readonly ColumnScore[] {
  const limit = gridColumnLimit(options.width, options.gap);
  const scores: ColumnScore[] = [];
  for (let columns = 1; columns <= limit; columns += 1) {
    const cellWidth = gridCellWidth(options.width, columns, options.gap);
    const display = resolveDisplayLayout(layout, content, { targetColumns: columns, ...(options.contracts === undefined ? {} : { contracts: options.contracts }) });
    // 宽度：离理想格宽越远越差（对数距离：宽一倍与窄一半一样差）。
    let score = Math.abs(Math.log(cellWidth / GRID_IDEAL_CELL_WIDTH));
    if (display.source === "projection") {
      const quality = layoutQuality(display.projection);
      // 空白：被包围的空洞与整列空着一样难看，比格子略宽略窄更显眼；页尾参差是自然的，只轻微计入。
      score += 3 * (quality.holeRatio + quality.tailRatio) + 0.5 * quality.endRatio;
      // 原尺寸放不下而被迫缩小的卡片。
      if (quality.objects > 0) score += 0.6 * (quality.degraded / quality.objects);
    } else if (cellWidth >= GRID_MIN_CELL_WIDTH && cellWidth <= GRID_COMFORT_CELL_WIDTH) {
      // 用户亲手排过的（基础布局原列数 / 专属布局）：里面的空位是用户自己留的，不算排布缺陷；格宽舒适时优先，
      // 自动模式不轻易改掉用户看惯的样子（刚在某个列数下保存的排列，回到浏览时也仍然是它）。
      score -= 0.5;
    }
    scores.push({ columns, cellWidth, score, source: display.source });
  }
  return scores;
}

/** 自动列数：不是「能放几列就放几列」，而是按格宽、空洞、降级与用户排过的布局综合评分。 */
export function chooseAutoColumns(
  layout: LayoutDocumentV1,
  content: WorkbenchContentDocumentV1,
  options: AutoColumnsOptions,
): number {
  if (!(options.width > 0)) return Math.max(1, Math.min(layout.main.baseCols, 2));
  const scores = scoreColumns(layout, content, options);
  let best = scores[0];
  for (const item of scores) {
    if (best === undefined || item.score < best.score - 1e-9) best = item;
  }
  if (best === undefined) return 1;
  const previous = options.previous === undefined || options.previous === null ? undefined : scores.find((item) => item.columns === options.previous);
  if (previous !== undefined && previous.score <= best.score + 0.08) return previous.columns;
  return best.columns;
}

// ---------------------------------------------------------------------------
// 保存：按编辑行为决定写到哪里（§5）
// ---------------------------------------------------------------------------

export interface LayoutDocuments {
  readonly content: WorkbenchContentDocumentV1;
  readonly layout: LayoutDocumentV1;
}

export interface EditOrigin {
  /** 编辑开始时（或套用模板后）的完整文档：基础布局 + 专属布局。 */
  readonly documents: LayoutDocuments;
  /** 编辑开始时在编辑列数下看到的那一份几何（`displayGeometry` 的结果）。 */
  readonly start: LayoutGeometry;
}

export type LayoutEditTarget =
  /** 卡片集合没变、排列也没变（可能只改了卡片内容）。 */
  | "none"
  /** 在基础列数下调整了排列：更新基础布局，其它列数的专属布局保留。 */
  | "canonical"
  /** 在其它列数下调整了排列：写入这个列数的专属布局。 */
  | "override"
  /** 这个列数的排列与自动排列完全相同：删除这个列数的专属布局。 */
  | "override-cleared"
  /** 新增 / 删除了卡片：编辑结果成为新的基础布局（基础列数 = 编辑列数），旧的专属布局全部失效。 */
  | "rebased";

export interface LayoutEditCommit {
  readonly documents: LayoutDocuments;
  readonly target: LayoutEditTarget;
}

/** 卡片集合（含容器里的卡片）、容器集合与每个容器的成员是否相同；顺序、内容配置不算。 */
export function sameCardStructure(left: WorkbenchContentDocumentV1, right: WorkbenchContentDocumentV1): boolean {
  const ids = (content: WorkbenchContentDocumentV1) => new Set(content.cards.map((card) => card.objectId));
  if (!sameSet(ids(left), ids(right))) return false;
  const containers = (content: WorkbenchContentDocumentV1) => new Map(content.containers.map((item) => [item.objectId, new Set(item.children)] as const));
  const a = containers(left);
  const b = containers(right);
  if (a.size !== b.size) return false;
  for (const [id, children] of a) {
    const other = b.get(id);
    if (other === undefined || !sameSet(children, other)) return false;
  }
  return true;
}

/** 两份几何是否完全相同（列数、对象、位置、跨度、收起状态；对象顺序不计）。 */
export function sameLayoutGeometry(left: LayoutGeometry, right: LayoutGeometry): boolean {
  if (left.baseCols !== right.baseCols || left.objects.length !== right.objects.length) return false;
  const key = (object: ObjectGeometry) =>
    [object.objectId, object.objectType, object.anchor, object.colSpan, object.rowSpan, object.presentation ?? "full",
      object.expandedSize === undefined ? "" : `${String(object.expandedSize.colSpan)}x${String(object.expandedSize.rowSpan)}`].join("|");
  const a = left.objects.map(key).sort();
  const b = right.objects.map(key).sort();
  return a.every((item, index) => item === b[index]);
}

export interface CommitLayoutEditInput {
  /** 编辑会话固定的列数。 */
  readonly columns: number;
  /**
   * 这一份编辑结果所基于的起点：编辑开始时的已保存文档，或会话里套用的模板 / 恢复默认（整份替换）。
   * 由调用方随编辑历史记录（撤销 / 重做后仍对应正确的起点），这里不按卡片集合去猜——系统默认的卡片 ID 固定，
   * 「恢复默认」后的卡片集合可能与已保存的完全相同。
   */
  readonly origin: EditOrigin;
  /** 编辑结果：内容文档 + 编辑列数下的几何（`layout.main`）。 */
  readonly edited: LayoutDocuments;
  readonly contracts?: Readonly<Record<string, ObjectSizeContract>>;
}

/**
 * 把一次编辑结果写成要保存的文档（§5、§12）：
 * - 卡片集合与起点不同（新增 / 删除 / 移入移出容器）→ **rebased**：编辑结果成为新的基础布局，专属布局全部清除；
 * - 卡片集合相同：排列没变 → 布局取起点原样（起点是模板时就是模板自己的基础布局与专属布局）；在基础列数下改了 →
 *   改基础布局（并去掉同列数的专属布局，否则它会挡住修改）；在其它列数下改了 → 写这个列数的专属布局；
 *   改完正好等于自动排列 → 删掉这个列数的专属布局。
 * 内容文档总是取编辑结果（卡片内容修改在所有列数下都生效）。一次返回整份文档，由调用方一次写入（不存在
 * 「基础布局写成功、专属布局清理失败」的中间状态）。
 */
export function commitLayoutEdit(input: CommitLayoutEditInput): LayoutEditCommit {
  const columns = clampColumns(input.columns, 2).columns;
  const edited = input.edited.layout.main;
  const content = input.edited.content;
  const origin = input.origin;
  if (!sameCardStructure(origin.documents.content, content)) {
    const base = withoutColumnOverrides(origin.documents.layout);
    return { documents: { content, layout: { ...base, main: { baseCols: columns, objects: edited.objects } } }, target: "rebased" };
  }
  const layout = withoutStaleOverrides(origin.documents.layout, content);
  if (sameLayoutGeometry(edited, origin.start)) return { documents: { content, layout }, target: "none" };
  if (columns === layout.main.baseCols) {
    return { documents: { content, layout: { ...withoutColumnOverride(layout, columns), main: { baseCols: columns, objects: edited.objects } } }, target: "canonical" };
  }
  const automatic = reflowLayout(layout.main, content, { targetColumns: columns, ...(input.contracts === undefined ? {} : { contracts: input.contracts }) });
  const automaticGeometry = displayGeometry({ columns, source: "projection", projection: automatic }, layout, content);
  if (sameLayoutGeometry(edited, automaticGeometry)) return { documents: { content, layout: withoutColumnOverride(layout, columns) }, target: "override-cleared" };
  return { documents: { content, layout: withColumnOverride(layout, columns, edited) }, target: "override" };
}
