/**
 * S14-D · 账本导入 —— 统一的导入预览模型。
 *
 * ⚠️ **这里是 D1 的唯一模型**：游客账本与正式单人账本共用同一套来源快照、分类/支付方式/标签映射、
 * 重复检测与预览结构。后续 D2/D3 的可靠提交必须基于同一套语义，不允许在页面里另写一套判断。
 *
 * 本文件只有类型，没有读写副作用。
 */
import type { Category, PaymentMethod, Tag, Transaction, TransactionKind } from "@libellum/shared";

/** 来源类型：本机游客账本，或同一账号下的另一本正式账本。 */
export type ImportSourceKind = "guest" | "book";

/** 来源账本的识别信息；游客账本没有服务器编号。 */
export interface ImportBookIdentity {
  readonly name: string;
  readonly bookNumber: string | null;
}

/** 一份已经读入内存、可直接参与预览的账本快照。 */
export interface ImportSnapshot {
  readonly categories: readonly Category[];
  readonly paymentMethods: readonly PaymentMethod[];
  readonly tags: readonly Tag[];
  /** 只包含可导入的账目：游客墓碑不在这里，正式账本的墓碑不会被 API 返回。 */
  readonly transactions: readonly Transaction[];
  /** 游客本地已删除的条数；正式账本拿不到墓碑数量，所以是 0。 */
  readonly hiddenDeletedCount: number;
}

export interface ImportSource extends ImportSnapshot {
  readonly kind: ImportSourceKind;
  /** 正式账本是服务器 bookId；游客是本地 guest-book-… id（仅用于显示，不上传）。 */
  readonly bookId: string;
  readonly identity: ImportBookIdentity;
}

export interface ImportTarget extends ImportSnapshot {
  readonly bookId: string;
  readonly identity: ImportBookIdentity;
}

/** 同名对象在来源与目标之间存在属性差异时，预览必须明确指出来，不得静默取一边。 */
export type TaxonomyObjectKind = "category" | "paymentMethod" | "tag";

export type TaxonomyConflictReason =
  | "category_archive_mismatch"
  | "category_system_mismatch"
  | "payment_method_archive_mismatch"
  | "tag_color_mismatch";

export interface TaxonomyConflict {
  readonly type: TaxonomyObjectKind;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly targetId: string;
  readonly targetName: string;
  readonly reason: TaxonomyConflictReason;
  readonly message: string;
}

/** 一个来源分类/支付方式/标签在目标账本里的对应方案。冲突项先给出暂定复用目标对象。 */
export interface TaxonomyMapping<TSource, TTarget> {
  readonly source: TSource;
  /** 复用目标对象时的目标 id；需要新建时为 null。 */
  readonly targetId: string | null;
  /** 需要新建时的建议名称；复用时为 null。 */
  readonly createName: string | null;
  /** 新建时是否保持来源归档状态（标签没有归档）。 */
  readonly createArchived: boolean;
  /** 新建标签时保留的来源颜色。 */
  readonly createColor: string | null;
  /** 冲突存在时，这里指向对应的冲突；此时 targetId 是暂定复用目标，不是最终决定。 */
  readonly conflict: TaxonomyConflict | null;
  /**
   * 在导入语义里代表这个对象的稳定键：
   * - 复用目标：`target:<id>`
   * - 新建：`new:<sourceId>`
   *
   * 重复检测比较的是这个键，而不是两个账本的内部 id。
   */
  readonly matchKey: string;
}

export interface TaxonomyMappingPlan {
  readonly categories: readonly TaxonomyMapping<Category, Category>[];
  readonly paymentMethods: readonly TaxonomyMapping<PaymentMethod, PaymentMethod>[];
  readonly tags: readonly TaxonomyMapping<Tag, Tag>[];
  readonly conflicts: readonly TaxonomyConflict[];
  readonly counts: {
    readonly categories: { readonly reuse: number; readonly create: number; readonly conflict: number };
    readonly paymentMethods: { readonly reuse: number; readonly create: number; readonly conflict: number };
    readonly tags: { readonly reuse: number; readonly create: number; readonly conflict: number };
  };
}

export type DuplicateSide = "source" | "target";

export interface DuplicateRecord {
  readonly side: DuplicateSide;
  readonly transaction: Transaction;
  /** 映射后（目标侧为原始）分类显示名，供核对页展示。 */
  readonly categoryLabel: string;
  /** 映射后标签显示名，按名称排序，供核对页展示。 */
  readonly tagLabels: readonly string[];
}

/**
 * 一个冲突组 = 重复检测图的连通分量。
 *
 * ⚠️ 这里允许一对多、多对一、多对多，因为“一个来源记录匹配多个目标记录”时把它拆成多组会让同一笔
 * 记录在多个组里得到矛盾决定。组内所有记录必须由界面一次性决定，D3 的决策模型按组保存。
 */
export interface DuplicateGroup {
  /** 稳定 id，用于决策映射与测试；由组内最早已排序的来源记录派生。 */
  readonly id: string;
  readonly records: readonly DuplicateRecord[];
  /** 只做展示与核对；决策在 D3 增加，不在 D1 写入。 */
  readonly sourceCount: number;
  readonly targetCount: number;
}

export interface ImportTotals {
  readonly currency: string;
  readonly expenseCents: number;
  readonly incomeCents: number;
  readonly count: number;
}

export interface ImportPreview {
  readonly source: ImportSource;
  readonly target: ImportTarget;
  readonly mapping: TaxonomyMappingPlan;
  readonly duplicateGroups: readonly DuplicateGroup[];
  readonly totals: readonly ImportTotals[];
  readonly dateRange: { readonly from: string | null; readonly to: string | null };
  readonly counts: {
    readonly sourceTransactions: number;
    readonly sourceSkippedDeleted: number;
    /** 不在任何冲突组里的来源记录，默认进入待导入列表。 */
    readonly importableWithoutConflict: number;
    /** 参与冲突组的来源记录数。 */
    readonly duplicateSourceRecords: number;
    /** 参与冲突组的目标记录数；只用于摘要，不代表删除。 */
    readonly duplicateTargetRecords: number;
    readonly duplicateGroups: number;
    readonly targetTransactions: number;
    readonly targetExisting: number;
  };
  readonly warnings: readonly string[];
}

/** 读取预览所需的库清单项（只依赖 `/books` 返回的最小字段）。 */
export interface ImportBookOption {
  readonly id: string;
  readonly name: string;
  readonly bookNumber: string | null;
  readonly role: "owner" | "editor" | "viewer";
  readonly isCreator: boolean;
  readonly memberCount: number;
}

/** 账户身份中需要显示给用户的部分；不把任何 token 写入预览模型。 */
export interface ImportAccountLabel {
  readonly username: string;
  readonly displayName: string;
}

export interface ImportPreviewSourceLabel {
  readonly kind: ImportSourceKind;
  readonly bookId: string;
  readonly name: string;
  readonly bookNumber: string | null;
}

/** 供 UI 与测试使用的分类对象形状（与共享包 Category 一致）。 */
export type ImportCategory = Category;
export type ImportPaymentMethod = PaymentMethod;
export type ImportTag = Tag;
export type ImportKind = TransactionKind;
