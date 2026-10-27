/**
 * S17 工作台布局数据模型（D-0 数据结构与接口准备）。
 *
 * 权威来源：
 * - `docs/specs/product/s17-agents/S17-Agent-D-完整开发规格-所有者-20261027.md`
 *   §3（对象类型）、§4（行优先编号）、§5–§6（迁移）、§9（Spacer）、
 *   §10–§13（容器）、§21–§28（统一/独立模式、配置版本）。
 * - `docs/specs/product/S17-工作台个人配置与布局分享-方案草案.md` §2–§4.5
 *   （内容文档与布局文档分离、版本、合并）。
 * - `docs/specs/design/S17-工作台布局与格式模板规格.md` §12–§18
 *   （编号、投影、降级、Spacer、容器收缩、统一/独立模式）。
 *
 * 本文件只放**类型与常量**，不含任何财务计算、不读写账务数据。
 * 未决口径（OQ-LM-01/03/04/05/06/07 等）以 `待决` 标注，不得在本层虚构。
 */

/** 内容/布局文档共用的整数 schema 版本；结构变化时递增并由迁移函数处理。 */
export const LAYOUT_SCHEMA_VERSION = 1;

/** 布局迁移/投影算法版本；算法行为变化时递增（缓存键的一部分）。 */
export const LAYOUT_ALGORITHM_VERSION = 1;

/** 目标列数合法范围（手机默认 2 列，按真实 CSS 宽度开放更多列）。 */
export const MIN_COLUMNS = 1;
export const MAX_COLUMNS = 12;

/**
 * 行跨度上限。纵向本身无限（可滚动），这里限制的是**单个对象**的高度，
 * 防止损坏配置或恶意导入撑出极端页面。候选值，随 W5 原型校准。
 */
export const MAX_ROW_SPAN = 8;

/** 导入/单工作台的对象数量上限（候选值，见配置与分享方案 §7）。 */
export const MAX_OBJECTS_PER_WORKBENCH = 40;
export const MAX_CONTAINERS_PER_WORKBENCH = 12;

/** 滑动抽屉容器的页数范围（所有者规格 §12）。 */
export const MIN_CAROUSEL_PAGES = 2;
export const MAX_CAROUSEL_PAGES = 6;

/** 自由分割容器的槽位数量上限（首期对齐式，候选值；内部几何 W5 定）。 */
export const MAX_GRID_SPLIT_CHILDREN = 4;

/** 容器最大嵌套深度：首版工作台 → 卡片/Spacer/容器 → 卡片，容器内不再放容器。 */
export const CONTAINER_MAX_DEPTH = 1;

/** 占格尺寸，记法 `宽×高`（列跨度 × 行跨度）；`1×1` 不是正方形像素。 */
export interface GridSize {
  readonly colSpan: number;
  readonly rowSpan: number;
}

/** 展示形态：完整 / 紧凑（尺寸档）/ 收缩（容器 1×1）/ 兼容入口（卡片 1×1）。 */
export type DisplayForm = "full" | "compact" | "collapsed" | "compat";

/** 布局对象类型；Spacer 只存在于布局文档，卡片/容器同时存在于内容文档。 */
export type LayoutObjectKind = "analysis-card" | "grid-split" | "carousel" | "spacer";

/** 统一布局（默认）与独立布局档案（可选开关）。 */
export type LayoutMode = "unified" | "independent";

/** 卡片时间区间策略：默认继承工作台全局筛选；pinned 表示卡片固定自己的区间。 */
export type RangePolicy = "inherit" | "pinned";

/** 卡片标题来源；自定义标题默认不随分享导出。 */
export type TitleKind = "preset" | "custom";

/**
 * 分析定义引用。布局层只保存**引用**，不保存分析结果；`analysisId` 来自
 * 分析能力目录，`params` 是分析定义自身的参数（不含金额）。
 * 与 S-01 `AnalysisDefinition` 的对接由 `docs/specs/design/S17-布局数据模型与接口-v1.md`
 * 登记，接口未冻结前不复制其内部字段。
 */
export interface AnalysisReference {
  readonly analysisId: string;
  /** 分析定义版本（若目录提供）；缺省表示“跟随当前目录版本”。 */
  readonly analysisVersion?: string;
  readonly params: Readonly<Record<string, unknown>>;
}

/** 图表展示配置：只描述“画什么”，不描述尺寸；尺寸由布局层按真实宽高给。 */
export interface ChartPresentation {
  readonly chartFamily: string;
  readonly options?: Readonly<Record<string, unknown>>;
}

export interface CardTitleSpec {
  readonly kind: TitleKind;
  readonly text?: string;
}

/** 分析卡片实例（内容文档）。`objectId` 同时是布局稳定对象 ID，永不复用。 */
export interface AnalysisCardNode {
  readonly objectId: string;
  readonly type: "analysis-card";
  readonly analysis: AnalysisReference;
  readonly chart: ChartPresentation;
  readonly title?: CardTitleSpec;
  readonly rangePolicy: RangePolicy;
  /** `rangePolicy === "pinned"` 时必须给出，且必须在卡片标题可见标明。 */
  readonly pinnedRange?: { readonly from: string; readonly to: string };
}

/**
 * GridSplit 容器配置：两条贯穿分割线以千分比保存（0–1000，0 表示该方向不分割）。
 * 比例不保存像素，因此不随容器实际宽度漂移。
 */
export interface GridSplitConfig {
  /** 竖向分割线位置（相对容器宽度的千分比）；0 表示只有横向分割。 */
  readonly columnSplitPermille: number;
  /** 横向分割线位置（相对容器高度的千分比）；0 表示只有纵向分割。 */
  readonly rowSplitPermille: number;
}

/** 自由分割容器（首版对齐式 GridSplit，深度 1）。children 顺序即槽位顺序。 */
export interface GridSplitNode {
  readonly objectId: string;
  readonly type: "grid-split";
  readonly children: readonly string[];
  readonly split: GridSplitConfig;
}

/** 滑动抽屉容器（每页一张卡片，2–6 张，顺序稳定）。 */
export interface CarouselNode {
  readonly objectId: string;
  readonly type: "carousel";
  readonly children: readonly string[];
}

export type ContainerNode = GridSplitNode | CarouselNode;

/** Spacer 节点（只存在于布局文档）：用户有意留白，不是卡片，不请求数据。 */
export interface SpacerNode {
  readonly objectId: string;
  readonly type: "spacer";
}

export type WorkbenchNode = AnalysisCardNode | ContainerNode | SpacerNode;

/**
 * 内容文档（账号共有）：卡片身份/分析定义引用/图表配置/容器树。
 * 不包含几何位置（几何只在布局文档），也不包含任何账务数据或计算结果。
 */
export interface WorkbenchContentDocumentV1 {
  readonly schemaVersion: number;
  readonly cards: readonly AnalysisCardNode[];
  readonly containers: readonly ContainerNode[];
}

/**
 * 一个布局对象的几何数据（布局文档）。
 *
 * 位置只保存行优先编号 `anchor`（配合所在几何的 `baseCols` 才能还原行列），
 * 尺寸用 `colSpan × rowSpan`；不保存互相矛盾的权威行列字段。
 */
export interface ObjectGeometry {
  readonly objectId: string;
  readonly objectType: LayoutObjectKind;
  /** 行优先位置编号（1 起，相对本几何的 `baseCols`）。 */
  readonly anchor: number;
  readonly colSpan: number;
  readonly rowSpan: number;
  /**
   * 容器用户意图：collapsed 表示用户主动收缩；自动收缩只存在于投影结果，
   * 永不写回这里（OQ-LM-06 暂定口径）。
   */
  readonly presentation?: "full" | "collapsed";
  /** 用户主动收缩前记录的完整尺寸，用于恢复；只在 presentation=collapsed 时有意义。 */
  readonly expandedSize?: GridSize;
}

/** 一份权威几何（主布局，或独立模式下的某个宽度档案）。 */
export interface LayoutGeometry {
  /** 该几何的基准列数；`anchor` 只有配合它才有意义。 */
  readonly baseCols: number;
  readonly objects: readonly ObjectGeometry[];
}

/** 独立布局档案：按“真实可用 CSS 宽度推出的列数/宽度档”分开保存几何。 */
export interface LayoutProfile {
  /** 档案键（OQ-LM-08：暂定宽度档，具体格式 W5/W6 冻结）。 */
  readonly profileKey: string;
  readonly geometry: LayoutGeometry;
}

/**
 * 布局文档（每用户一套，账号级；与内容文档分开保存、各自带版本）。
 * `main` 是统一模式/独立模式的初始权威几何；`profiles` 只在独立模式使用。
 */
export interface LayoutDocumentV1 {
  readonly schemaVersion: number;
  readonly layoutAlgorithmVersion: number;
  readonly mode: LayoutMode;
  readonly main: LayoutGeometry;
  /** 统一模式为 undefined；独立模式首次保存后才物化（写时复制）。 */
  readonly profiles?: readonly LayoutProfile[];
  /** “上一个布局”副本，用于套用模板/导入后恢复（数量与期限 OQ-CF-03 待决）。 */
  readonly previousMain?: LayoutGeometry;
}

/**
 * 卡片对布局层声明的尺寸契约（W3 由 A/B/C 随卡片家族声明；数值 OQ-LM-02 待决）。
 * 布局层只执行声明，不替卡片决定内容。
 */
export interface ObjectSizeContract {
  readonly objectId: string;
  /** 可读的最小占格，投影绝不低于它。 */
  readonly minSize: GridSize;
  /** 尺寸档序列（由大到小，家族声明）；布局层只按顺序尝试。 */
  readonly sizeLadder: readonly GridSize[];
  /** 卡片 1×1 兼容入口尺寸（卡片专属）。 */
  readonly compatSize?: GridSize;
  /** 容器 1×1 收缩尺寸（容器专属，通常 1×1）。 */
  readonly collapsedSize?: GridSize;
  /**
   * 容器“完整形态”所需的最小列数（容器专属）。目标列数小于它时，
   * 容器只能收缩为 1×1 入口（所有者规格 §10–§13）。
   */
  readonly minFullCols?: number;
}

/** 迁移策略：尺寸优先（默认，**OQ-LM-01 已由 Lead 锁定 size-first**）或位置优先（仅对照策略保留）。 */
export type MigrationStrategy = "size-first" | "position-first";

/** 投影/降级的可观察原因，只用于 UI 提示与测试断言，不参与财务语义。 */
export type DegradeReason =
  | "source-invalid"
  | "duplicate-dropped"
  | "orphan-dropped"
  | "width-overflow"
  | "size-clamped"
  | "anchor-occupied"
  | "container-narrow"
  | "user-collapsed"
  | "missing-contract";

export interface ProjectedObject {
  readonly objectId: string;
  readonly objectType: LayoutObjectKind;
  /** 投影后的行优先位置编号（相对 `ProjectionResult.columns`）。 */
  readonly anchor: number;
  readonly colSpan: number;
  readonly rowSpan: number;
  readonly form: DisplayForm;
  /** 源布局中的位置编号；源数据无有效位置时为 null。 */
  readonly sourceAnchor: number | null;
  readonly degradedReasons: readonly DegradeReason[];
}

export interface ProjectionIssue {
  readonly objectId?: string;
  readonly reason: DegradeReason;
  readonly detail: string;
}

/** 投影结果：纯函数输出，可缓存但绝不写回权威布局。 */
export interface ProjectionResult {
  readonly columns: number;
  readonly objects: readonly ProjectedObject[];
  readonly issues: readonly ProjectionIssue[];
}

export interface LayoutValidationIssue {
  readonly objectId?: string;
  readonly code: string;
  readonly detail: string;
}

export interface ProjectOptions {
  readonly targetColumns: number;
  /** 尺寸契约表；缺失的卡片按 1×1 占位处理并记录 missing-contract。 */
  readonly contracts?: Readonly<Record<string, ObjectSizeContract>>;
  /** 默认且已锁定 `size-first`（OQ-LM-01 由 Lead 裁定）；`position-first` 仅作对照，不用于生产。 */
  readonly strategy?: MigrationStrategy;
  /**
   * 是否在投影后执行垂直紧凑（OQ-LM-03 未决，**默认 false**）。
   *
   * 开启时：对象只向上平移、列不变、不改宽高/形态，Spacer 锚定不上浮、不得被穿过，
   * 容器整体平移（内部结构不变）。默认关闭以保持源位置，待所有者确认后再定默认值。
   */
  readonly verticalCompact?: boolean;
}
