/**
 * 结果 → 图表输入适配器（C-3，web 侧，DRAFT）。
 *
 * 覆盖 P05 分类层级（层级表 / 旭日图）、P06 分类矩形树图、P07 层级桑基图。
 * 与前几批相同的约束：
 * - 输入是 shared 草案结果（结构镜像见 `sharedTypes.ts`），输出是 `types.ts` 的图表输入；
 * - 只做取字段、格式化文本、把 bigint 比例换成「仅用于坐标」的 number；
 * - **不做金额/占比/守恒的重算**：需要新统计量应回 shared 加权威函数；
 * - 数据模型没有分类父子关系（QC-03/QC-27）：无真实层级时，旭日图与桑基图显式
 *   拒绝并给可展示原因，层级表照实显示「当前无分类层级」，矩形树图退化为平面
 *   分类图（`flattened=true`），绝不按分类名称猜层级。
 */

import type { AdapterOptions } from "./adapters.js";
import {
  formatCountText,
  formatMinorText,
  formatRatioPercent,
  ratioToDisplayNumber,
} from "./format.js";
import type {
  ChartSource,
  HierarchyTableInput,
  HierarchyTableRow,
  SankeyAdapterResult,
  SankeyInput,
  SankeyLinkDatum,
  SankeyNodeDatum,
  SunburstAdapterResult,
  SunburstArcDatum,
  SunburstInput,
  TreemapAdapterResult,
  TreemapInput,
  TreemapNodeDatum,
} from "./types.js";
import type {
  RatioLike,
  SharedHierarchyNode,
  SharedHierarchyResult,
  SharedSankeyResult,
} from "./sharedTypes.js";

/** 「直接金额」虚拟节点的标签后缀（与 shared sankey.ts 的语义一致，仅展示用）。 */
const DIRECT_LABEL_SUFFIX = " · 直接";

/** 层级表最多显示的行数；超出时显式标记截断（不得静默丢行）。 */
export const HIERARCHY_TABLE_MAX_ROWS = 500;

function sourceOf(options: AdapterOptions, complete: boolean): ChartSource {
  return {
    analysisId: options.analysisId,
    title: options.title,
    currency: options.currency,
    complete,
  };
}

function fractionOf(value: bigint, denominator: bigint): number | null {
  if (denominator === 0n) return null;
  return ratioToDisplayNumber({ numerator: value, denominator });
}

function percentTextOf(numerator: bigint, denominator: bigint): string | null {
  if (denominator === 0n) return null;
  return formatRatioPercent({ numerator, denominator }, 1);
}

function shareTextOf(ratio: RatioLike | null): string | null {
  if (ratio === null) return null;
  return formatRatioPercent(ratio, 1);
}

function nodeMapOf(result: SharedHierarchyResult): ReadonlyMap<string, SharedHierarchyNode> {
  return new Map(result.nodes.map((node) => [node.nodeId, node]));
}

/** 层级状态说明：无真实层级时必须显式说明，界面不得省略。 */
function nestingTextOf(result: SharedHierarchyResult): string {
  if (!result.isRealHierarchy) {
    return "当前无真实分类层级（依赖分类父子关系的数据模型扩展），不得作为业务层级展示";
  }
  if (result.hasUnknownCategories) {
    return "存在未声明分类，层级可能不完整，未声明部分不得画成层级";
  }
  if (result.orphanRelationCategoryIds.length > 0) {
    return "有分类的父级引用未声明，已按顶层处理并登记，层级可能不完整";
  }
  return "按真实分类父子关系展示";
}

function unavailableReasonOf(result: SharedHierarchyResult): string | null {
  switch (result.completeness) {
    case "unavailable":
      return "结果不可用（取数失败或离线覆盖不完整）";
    case "no-transactions":
      return "所选范围没有交易";
    case "complete":
      return null;
  }
}

/**
 * P05 层级表：最保守、最可访问的 P05 形态。
 *
 * 无真实层级时照实显示平面分类 + `nestingText` 说明，不画假嵌套、不猜父子关系。
 * 行顺序沿用 shared 结果（深度升序 → 金额降序 → id），保证不同图种一致。
 */
export function toHierarchyTableInput(
  result: SharedHierarchyResult,
  options: AdapterOptions,
): HierarchyTableInput {
  const reason = unavailableReasonOf(result);
  const byId = nodeMapOf(result);
  const rows: HierarchyTableRow[] = [];

  for (const node of result.nodes) {
    if (node.kind !== "category") continue;
    if (rows.length >= HIERARCHY_TABLE_MAX_ROWS) break;

    const parent =
      node.parentId === null ? undefined : (byId.get(node.parentId) ?? undefined);
    const parentDenominator =
      parent === undefined ? result.totalAmountMinor : parent.subtreeAmountMinor;

    rows.push({
      nodeId: node.nodeId,
      depth: Math.max(1, node.depth),
      label: node.label,
      subtreeAmountMinor: node.subtreeAmountMinor,
      subtreeAmountText: formatMinorText(node.subtreeAmountMinor, options.decimals),
      directAmountMinor: node.directAmountMinor,
      directAmountText: formatMinorText(node.directAmountMinor, options.decimals),
      countText: `${formatCountText(node.subtreeCount)} 笔`,
      shareOfParentText: percentTextOf(node.subtreeAmountMinor, parentDenominator),
      shareOfTotalText: percentTextOf(node.subtreeAmountMinor, result.totalAmountMinor),
      isLeaf: node.isLeaf,
      hasMissingRelation: node.hasMissingRelation,
    });
  }

  return {
    source: sourceOf(options, result.completeness === "complete"),
    available: reason === null,
    unavailableReason: reason,
    rows,
    totalText: formatMinorText(result.totalAmountMinor, options.decimals),
    rowsTruncated: rows.length < result.nodes.filter((node) => node.kind === "category").length,
    nestingText: nestingTextOf(result),
  };
}

/**
 * P05 旭日图：只有真实层级才允许画（没有真实父子关系时拒绝，不画假层级）。
 *
 * 父节点既有直接交易又有子级时，补一个「· 直接」终端节点，使每层扇区份额
 * 可加总为父级 100%（与 shared 桑基的守恒口径一致）。
 */
export function toSunburstInput(
  result: SharedHierarchyResult,
  options: AdapterOptions,
): SunburstAdapterResult {
  const reason = unavailableReasonOf(result);
  if (reason !== null) {
    return {
      ok: false,
      reason: result.completeness === "no-transactions" ? "no-transactions" : "incomplete-range",
      reasonText: reason,
    };
  }
  if (!result.isRealHierarchy) {
    return {
      ok: false,
      reason: "no-real-hierarchy",
      reasonText:
        "无真实分类层级（数据模型依赖）：不能把平面分类冒充父子层级。等待分类父子关系模型扩展后再启用旭日图。",
    };
  }
  if (result.hasUnknownCategories) {
    return {
      ok: false,
      reason: "unknown-categories",
      reasonText: "存在未声明分类，层级不完整；未声明部分不得画成层级。",
    };
  }

  const byId = nodeMapOf(result);
  const datums: SunburstArcDatum[] = [];
  const rootNode = result.nodes.find((node) => node.kind === "root");

  datums.push({
    nodeId: result.rootId,
    parentId: null,
    depth: 0,
    kind: "root",
    label: "全部",
    subtreeAmountMinor: result.totalAmountMinor,
    subtreeAmountText: formatMinorText(result.totalAmountMinor, options.decimals),
    fractionOfParent: null,
    isLeaf: (rootNode?.childCount ?? 0) === 0,
    hasMissingRelation: false,
  });

  for (const node of result.nodes) {
    if (node.kind !== "category") continue;

    const parent = node.parentId === null ? undefined : (byId.get(node.parentId) ?? undefined);
    const parentAmount =
      parent === undefined ? result.totalAmountMinor : parent.subtreeAmountMinor;

    datums.push({
      nodeId: node.nodeId,
      parentId: node.parentId,
      depth: node.depth,
      kind: "category",
      label: node.label,
      subtreeAmountMinor: node.subtreeAmountMinor,
      subtreeAmountText: formatMinorText(node.subtreeAmountMinor, options.decimals),
      fractionOfParent: fractionOf(node.subtreeAmountMinor, parentAmount),
      isLeaf: node.isLeaf,
      hasMissingRelation: node.hasMissingRelation,
    });

    if (node.childCount > 0 && node.directAmountMinor > 0n) {
      datums.push({
        nodeId: `${node.nodeId}::direct`,
        parentId: node.nodeId,
        depth: node.depth + 1,
        kind: "direct",
        label: `${node.label}${DIRECT_LABEL_SUFFIX}`,
        subtreeAmountMinor: node.directAmountMinor,
        subtreeAmountText: formatMinorText(node.directAmountMinor, options.decimals),
        fractionOfParent: fractionOf(node.directAmountMinor, node.subtreeAmountMinor),
        isLeaf: true,
        hasMissingRelation: node.hasMissingRelation,
      });
    }
  }

  const maxDepth = datums.reduce((max, datum) => (datum.depth > max ? datum.depth : max), 0);

  const input: SunburstInput = {
    source: sourceOf(options, true),
    available: true,
    unavailableReason: null,
    nodes: datums,
    totalText: formatMinorText(result.totalAmountMinor, options.decimals),
    maxDepth,
    nestingText: nestingTextOf(result),
  };

  return { ok: true, input };
}

/**
 * P06 分类矩形树图。
 *
 * 有真实层级时返回全部节点（嵌套面积可由布局层按 parentId 递归；C-3 只提供平面
 * 布局原语）；无真实层级时只返回顶层分类（`flattened=true`），绝不暗示父子关系。
 * 全零/不可用范围拒绝画图（避免「看起来完整」的假图）。
 */
export function toTreemapInput(
  result: SharedHierarchyResult,
  options: AdapterOptions,
): TreemapAdapterResult {
  const reason = unavailableReasonOf(result);
  if (reason !== null) {
    return {
      ok: false,
      reason: result.completeness === "no-transactions" ? "no-transactions" : "incomplete-range",
      reasonText: reason,
    };
  }

  const flattened = !result.isRealHierarchy;
  const candidates = result.nodes.filter((node) => {
    if (node.kind !== "category") return false;
    if (!flattened) return true;
    return node.parentId === null || node.parentId === result.rootId;
  });

  const nodes: TreemapNodeDatum[] = candidates.map((node) => ({
    nodeId: node.nodeId,
    parentId: node.parentId,
    depth: node.depth,
    label: node.label,
    amountMinor: node.subtreeAmountMinor,
    amountText: formatMinorText(node.subtreeAmountMinor, options.decimals),
    fractionOfTotal: fractionOf(node.subtreeAmountMinor, result.totalAmountMinor),
    isLeaf: node.isLeaf,
    hasMissingRelation: node.hasMissingRelation,
  }));

  if (nodes.length === 0) {
    return {
      ok: false,
      reason: "no-drawable-nodes",
      reasonText: "没有可画的分类节点（全零或都不可用），不渲染虚假的完整图。",
    };
  }

  if (result.totalAmountMinor === 0n) {
    return {
      ok: false,
      reason: "zero-total",
      reasonText: "分类总额为 0，面积无意义，不渲染虚假的完整图。",
    };
  }

  const input: TreemapInput = {
    source: sourceOf(options, true),
    available: true,
    unavailableReason: null,
    nodes,
    totalText: formatMinorText(result.totalAmountMinor, options.decimals),
    flattened,
    nestingText: nestingTextOf(result),
  };

  return { ok: true, input };
}

/**
 * P07 层级桑基图：只在「真实层级 + 无未声明分类 + 范围完整」时启用。
 *
 * owner 规格 §23：桑基图只表示真实分类层级的金额归属，不允许把
 * 「收入来源 → 支付方式 → 消费分类」随意连起来冒充资金流向。
 */
export function toSankeyInput(
  result: SharedSankeyResult,
  options: AdapterOptions,
): SankeyAdapterResult {
  if (result.completeness === "unavailable") {
    return {
      ok: false,
      reason: "incomplete-range",
      reasonText: "结果不可用（取数失败或离线覆盖不完整），不能画桑基图。",
    };
  }
  if (result.completeness === "no-transactions") {
    return { ok: false, reason: "no-transactions", reasonText: "所选范围没有交易。" };
  }
  if (!result.isRealHierarchy) {
    return {
      ok: false,
      reason: "no-real-hierarchy",
      reasonText:
        "无真实分类层级（数据模型依赖）：层级桑基图不得启用，也不得用支付方式/分类连线冒充资金流（owner 规格 §23）。",
    };
  }
  if (result.hasUnknownCategories) {
    return {
      ok: false,
      reason: "unknown-categories",
      reasonText: "存在未声明分类，层级归属不完整，不能画桑基图。",
    };
  }

  const total = result.totalMinor;

  const nodes: SankeyNodeDatum[] = result.nodes.map((node) => ({
    nodeId: node.nodeId,
    label: node.label,
    depth: node.depth,
    kind: node.kind,
    inflowMinor: node.inflowMinor,
    inflowText: formatMinorText(node.inflowMinor, options.decimals),
    outflowMinor: node.outflowMinor,
    outflowText: formatMinorText(node.outflowMinor, options.decimals),
    valueFraction:
      total === 0n
        ? 0
        : ratioToDisplayNumber({
            numerator:
              node.inflowMinor > node.outflowMinor ? node.inflowMinor : node.outflowMinor,
            denominator: total,
          }),
    isTerminal: node.isTerminal,
  }));

  const links: SankeyLinkDatum[] = result.links.map((link) => ({
    fromId: link.fromId,
    toId: link.toId,
    amountMinor: link.amountMinor,
    amountText: formatMinorText(link.amountMinor, options.decimals),
    fractionOfTotal:
      total === 0n ? 0 : ratioToDisplayNumber({ numerator: link.amountMinor, denominator: total }),
    shareOfSource: link.shareOfSource === null ? null : ratioToDisplayNumber(link.shareOfSource),
  }));

  const input: SankeyInput = {
    source: sourceOf(options, true),
    available: true,
    unavailableReason: null,
    nodes,
    links,
    totalText: formatMinorText(total, options.decimals),
  };

  return { ok: true, input };
}

/** 供测试与调用方复用：比例 → 百分比文本（保留 1 位小数）。 */
export function hierarchyShareText(value: bigint, denominator: bigint): string | null {
  return percentTextOf(value, denominator);
}

/** 供测试与调用方复用：shareOfSource 的文本（null 保持 null，不写 0%）。 */
export function sankeyShareText(ratio: RatioLike | null): string | null {
  return shareTextOf(ratio);
}
