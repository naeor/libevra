/**
 * D-3.1：统一布局 / 独立布局档案的模式迁移引擎（纯函数，headless）。
 *
 * 权威来源：
 * - `docs/specs/design/S17-工作台布局与格式模板规格.md` §18.1–§18.5
 *   （统一/独立模式、档案首次进入以主布局投影为初值、第一次保存才物化、
 *   档案互不覆盖、切换模式保留数据但不用、以当前档案作为统一主布局）。
 * - `docs/specs/product/S17-工作台个人配置与布局分享-方案草案.md` §4.5、§5
 *   （内容与几何分离、布局文档随 devices/档案分份、本地优先）。
 * - `docs/specs/product/s17-agents/S17-Agent-D-完整开发规格-所有者-20261027.md`
 *   §21–§28（统一模式默认、独立模式开关、档案按真实可用宽度档而非设备名）。
 *
 * 边界：
 * - 本模块只处理**几何/模式**，不读财务数据、不触发查询、不做 UI；
 * - 投影结果永不写回权威布局；`materializeProfile` 是唯一“生成档案条目”的纯函数，
 *   调用方只在用户明确保存时调用（写时复制）；
 * - 需要所有者裁定的口径（OQ-LM-07 统一模式写回、OQ-LM-08 档案键粒度/阈值）
 *   以占位常量与显式待决 issue 表达，不自行拍板、不虚构数值。
 */

import type {
  LayoutDocumentV1,
  LayoutGeometry,
  LayoutMode,
  LayoutProfile,
  ObjectSizeContract,
  ProjectionResult,
  WorkbenchContentDocumentV1,
} from "./types.js";
import { MAX_COLUMNS, MIN_COLUMNS } from "./types.js";
import type { DocumentValidationIssue } from "./validation.js";
import { validateLayoutDocumentV1 } from "./validation.js";
import { projectLayout, projectionToGeometry } from "./projection.js";

/**
 * 档案键策略占位（**OQ-LM-08 未决**）。
 *
 * 布局规格 §18.4 的推荐起点是「按真实可用宽度推出的宽度档」，但档位阈值需原型定；
 * 本批先用「精确列数」键 `cols-<n>` 作为占位（与既有 D-0/D-4 夹具与文档一致）。
 * 该常量不是所有者裁定：OQ-LM-08 关闭时再替换键格式与阈值。
 */
export const PROFILE_KEY_STRATEGY_PLACEHOLDER = "exact-columns" as const;

/** 宽度档阈值占位：空数组 = 阈值未定（按宽度派生会返回 null 并登记待决，不猜数值）。 */
export const PROFILE_WIDTH_BUCKETS_PLACEHOLDER: readonly number[] = [];

/** 独立模式项目投影策略占位（OQ-LM-07 未决：统一模式跨列编辑写回 M1/M2/M3 未定）。 */
export const UNIFIED_EDIT_WRITEBACK_PLACEHOLDER = "read-only-until-OQ-LM-07" as const;

export function isValidProfileKey(profileKey: string): boolean {
  return profileKey.trim().length > 0;
}

/** 精确列数档案键（占位策略）：`cols-2`、`cols-4` 等；列数非法返回 null。 */
export function profileKeyForColumns(columns: number): string | null {
  if (!Number.isInteger(columns) || columns < MIN_COLUMNS || columns > MAX_COLUMNS) {
    return null;
  }
  return `cols-${String(columns)}`;
}

/**
 * 宽度档档案键（OQ-LM-08 候选策略）：阈值数组为空时返回 null，**不虚构档位**。
 * 键格式为占位（`width-<upperPx>` / `width-over-<lastUpperPx>`），待 OQ-LM-08 冻结后替换。
 */
export function profileKeyForWidth(
  width: number,
  bucketWidths: readonly number[] = PROFILE_WIDTH_BUCKETS_PLACEHOLDER,
): string | null {
  if (!Number.isFinite(width) || width <= 0 || bucketWidths.length === 0) {
    return null;
  }
  for (const upper of bucketWidths) {
    if (Number.isFinite(upper) && upper > 0 && width <= upper) {
      return `width-${String(upper)}`;
    }
  }
  const last = bucketWidths[bucketWidths.length - 1];
  if (last !== undefined && Number.isFinite(last) && last > 0) {
    return `width-over-${String(last)}`;
  }
  return null;
}

export function findProfile(
  layout: LayoutDocumentV1,
  profileKey: string,
): LayoutProfile | undefined {
  return (layout.profiles ?? []).find((profile) => profile.profileKey === profileKey);
}

export function isProfileMaterialized(layout: LayoutDocumentV1, profileKey: string): boolean {
  return findProfile(layout, profileKey) !== undefined;
}

/** 已物化档案键列表（排序保证确定性，便于测试与集成断言）。 */
export function listProfileKeys(layout: LayoutDocumentV1): readonly string[] {
  return (layout.profiles ?? []).map((profile) => profile.profileKey).sort();
}

export interface ProfileProjectionOptions {
  /** 目标列数（由真实可用 CSS 宽度推导，见布局规格 §5；1–12）。 */
  readonly targetColumns: number;
  /** 档案键；缺省按占位策略从列数派生（`cols-<n>`）。 */
  readonly profileKey?: string;
  /** 卡片/容器尺寸契约（W3 后由卡片家族声明；缺失记 missing-contract）。 */
  readonly contracts?: Readonly<Record<string, ObjectSizeContract>>;
  /** 投影后垂直紧凑（OQ-LM-03 未决，默认 false）。 */
  readonly verticalCompact?: boolean;
}

export interface ProfileResolution {
  readonly targetColumns: number;
  /** 实际使用的档案键；无法派生时为 null（不猜策略）。 */
  readonly profileKey: string | null;
  readonly projection: ProjectionResult;
  /** 投影结果转回的几何（baseCols = targetColumns）；**不持久化**。 */
  readonly geometry: LayoutGeometry;
  /** 档案已物化→profile；否则由主布局投影（写时复制前）→main-projection。 */
  readonly source: "profile" | "main-projection";
  readonly issues: readonly DocumentValidationIssue[];
}

function projectionIssues(projection: ProjectionResult): readonly DocumentValidationIssue[] {
  return projection.issues.map((issue) => ({
    ...(issue.objectId === undefined ? {} : { objectId: issue.objectId }),
    path: "$.projection",
    code: `projection-${issue.reason}`,
    detail: issue.detail,
  }));
}

/**
 * 解析独立模式当前宽度应使用的几何：
 * - 有对应档案 → 投影该档案的几何（档案 baseCols 与目标列数不同也能确定性迁移）；
 * - 无档案 → 投影主布局（仅展示，**不物化**，首次保存才写档案）；
 * - 统一模式 → 永远投影主布局（profiles 即使存在也不参与）。
 */
export function resolveProfile(
  layout: LayoutDocumentV1,
  content: WorkbenchContentDocumentV1,
  options: ProfileProjectionOptions,
): ProfileResolution {
  const issues: DocumentValidationIssue[] = [];
  let targetColumns = options.targetColumns;
  if (!Number.isInteger(targetColumns) || targetColumns < 1 || targetColumns > MAX_COLUMNS) {
    issues.push({
      path: "$.options.targetColumns",
      code: "invalid-columns",
      detail: `目标列数非法：${String(options.targetColumns)}（按 2 列安全降级）`,
    });
    targetColumns = 2;
  }

  let profileKey: string | null = null;
  if (options.profileKey !== undefined) {
    if (isValidProfileKey(options.profileKey)) {
      profileKey = options.profileKey;
    } else {
      issues.push({
        path: "$.options.profileKey",
        code: "invalid-profile-key",
        detail: "档案键为空，按列数派生占位键",
      });
    }
  }
  profileKey ??= profileKeyForColumns(targetColumns);

  const projectionOptions = {
    targetColumns,
    ...(options.contracts === undefined ? {} : { contracts: options.contracts }),
    ...(options.verticalCompact === undefined ? {} : { verticalCompact: options.verticalCompact }),
  };

  const profile =
    layout.mode === "independent" && profileKey !== null
      ? findProfile(layout, profileKey)
      : undefined;
  const projection =
    profile === undefined
      ? projectLayout(layout.main, content, projectionOptions)
      : projectLayout(profile.geometry, content, projectionOptions);

  issues.push(...projectionIssues(projection));

  return {
    targetColumns,
    profileKey,
    projection,
    geometry: projectionToGeometry(projection),
    source: profile === undefined ? "main-projection" : "profile",
    issues,
  };
}

export interface MaterializeProfileResult {
  readonly layout: LayoutDocumentV1;
  readonly created: boolean;
  readonly issues: readonly DocumentValidationIssue[];
}

/**
 * 写时复制：用户**明确保存**时，把当前投影结果物化为独立模式档案条目。
 * - 已物化 → 原样返回（created=false），保证幂等；
 * - 密钥策略未就绪（如宽度档阈值未定）→ 不物化，登记 `profile-key-unavailable`；
 * - 不修改输入布局；新文档通过 D-1 校验才返回。
 */
export function materializeProfile(
  layout: LayoutDocumentV1,
  content: WorkbenchContentDocumentV1,
  options: ProfileProjectionOptions,
): MaterializeProfileResult {
  const resolved = resolveProfile(layout, content, options);
  if (resolved.profileKey === null) {
    return {
      layout,
      created: false,
      issues: [
        ...resolved.issues,
        {
          path: "$.profiles",
          code: "profile-key-unavailable",
          detail: "档案键策略占位未就绪（OQ-LM-08 待决），不物化档案",
        },
      ],
    };
  }
  if (findProfile(layout, resolved.profileKey) !== undefined) {
    return { layout, created: false, issues: resolved.issues };
  }
  const candidate: LayoutDocumentV1 = {
    ...layout,
    profiles: [...(layout.profiles ?? []), { profileKey: resolved.profileKey, geometry: resolved.geometry }],
  };
  const validated = validateLayoutDocumentV1(candidate);
  if (!validated.ok) {
    return { layout, created: false, issues: [...resolved.issues, ...validated.issues] };
  }
  return { layout: validated.value, created: true, issues: resolved.issues };
}

export interface ModeSwitchResult {
  readonly layout: LayoutDocumentV1;
  readonly changed: boolean;
  readonly issues: readonly DocumentValidationIssue[];
}

/**
 * 切换统一/独立模式（纯配置切换，不物化、不删除数据）：
 * - 统一 → 独立：主布局保留，各档案保持 undefined（首次进入投影显示，保存才物化）；
 * - 独立 → 统一：profiles **保留但不再使用**（规格 §18.4），需要“以当前档案作为统一主布局”
 *   时由用户显式调用 `adoptProfileAsMain`。
 */
export function switchLayoutMode(layout: LayoutDocumentV1, mode: LayoutMode): ModeSwitchResult {
  if (mode !== "unified" && mode !== "independent") {
    return {
      layout,
      changed: false,
      issues: [{ path: "$.mode", code: "invalid-mode", detail: `未知布局模式：${String(mode)}` }],
    };
  }
  if (layout.mode === mode) {
    return { layout, changed: false, issues: [] };
  }
  const candidate: LayoutDocumentV1 = { ...layout, mode };
  const validated = validateLayoutDocumentV1(candidate);
  if (!validated.ok) {
    return { layout, changed: false, issues: validated.issues };
  }
  return { layout: validated.value, changed: true, issues: [] };
}

export interface AdoptProfileResult {
  readonly ok: boolean;
  readonly layout?: LayoutDocumentV1;
  readonly issues: readonly DocumentValidationIssue[];
}

/**
 * “以当前档案作为统一主布局”（规格 §18.4）：显式用户动作。
 * 主布局被替换为该档案几何（baseCols 保持档案自身列数），旧主布局进 `previousMain`
 * 以供恢复；profiles 保留；模式切回统一。
 */
export function adoptProfileAsMain(
  layout: LayoutDocumentV1,
  profileKey: string,
): AdoptProfileResult {
  const profile = findProfile(layout, profileKey);
  if (profile === undefined) {
    return {
      ok: false,
      issues: [{ path: "$.profiles", code: "missing-profile", detail: `独立档案不存在：${profileKey}` }],
    };
  }
  const candidate: LayoutDocumentV1 = {
    ...layout,
    mode: "unified",
    main: {
      baseCols: profile.geometry.baseCols,
      objects: profile.geometry.objects.map((object) => ({ ...object })),
    },
    previousMain: layout.main,
  };
  const validated = validateLayoutDocumentV1(candidate);
  if (!validated.ok) {
    return { ok: false, issues: validated.issues };
  }
  return { ok: true, layout: validated.value, issues: [] };
}

/**
 * 内容文档新增、但主布局与所有档案都还没有几何条目的对象（诊断用，排序保证确定性）。
 *
 * 规格 §18.5 要求“新增卡片写内容文档，投影按未定位补位”；补位算法依赖 W3/W5 的
 * 默认尺寸口径（OQ-LM-02 占位），本批只提供检测函数供集成批次决定展示/补位，
 * 不擅自改写权威布局。
 */
export function findUnplacedContentObjects(
  content: WorkbenchContentDocumentV1,
  layout: LayoutDocumentV1,
): readonly string[] {
  const placed = new Set<string>();
  for (const object of layout.main.objects) {
    placed.add(object.objectId);
  }
  for (const profile of layout.profiles ?? []) {
    for (const object of profile.geometry.objects) {
      placed.add(object.objectId);
    }
  }
  const unplaced: string[] = [];
  for (const card of content.cards) {
    if (!placed.has(card.objectId)) {
      unplaced.push(card.objectId);
    }
  }
  for (const container of content.containers) {
    if (!placed.has(container.objectId)) {
      unplaced.push(container.objectId);
    }
  }
  return unplaced.sort();
}
