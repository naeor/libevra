/**
 * S14-D D1 · 分类 / 支付方式 / 标签的映射规则。
 *
 * ⚠️ **先做逻辑映射，再做重复检测。** 两个账本的内部 id 不同，语义相同的分类不能因此被当成不同；
 * 这里把每个来源对象映射成“复用目标对象”或“在目标账本新建”，重复检测只比较映射后的键。
 *
 * ⚠️ **不静默覆盖目标对象。** 同名但归档状态/标签颜色/系统属性不同，产出 `TaxonomyConflict`；
 * D1 预览会把它们列出来，D3 在写入前让用户决定。这里的 targetId 只是暂定复用，不是最终决定。
 */
import type { Category, PaymentMethod, Tag } from "@libellum/shared";

import type {
  TaxonomyConflict,
  TaxonomyConflictReason,
  TaxonomyMapping,
  TaxonomyMappingPlan,
  TaxonomyObjectKind,
} from "./types.js";

const MAX_OBJECT_NAME = 20;

/** 名称比较用：全半角统一、去掉首尾空白、连续空白压成一个。大小写保留，中文名称不受影响。 */
export function normalizeObjectName(raw: string): string {
  const normalized = typeof raw.normalize === "function" ? raw.normalize("NFKC") : raw;
  return normalized.replace(/\s+/g, " ").trim();
}

export function categoryMatchKey(kind: Category["kind"], name: string): string {
  return `${kind}\u0000${normalizeObjectName(name)}`;
}

function uniqueName(base: string, reserved: Set<string>): string {
  const clean = base.trim() === "" ? "未命名" : base.trim();
  let candidate = clean.slice(0, MAX_OBJECT_NAME);
  let index = 2;
  while (reserved.has(normalizeObjectName(candidate))) {
    const suffix = `（${String(index)}）`;
    candidate = `${clean.slice(0, Math.max(1, MAX_OBJECT_NAME - suffix.length))}${suffix}`;
    index += 1;
  }
  reserved.add(normalizeObjectName(candidate));
  return candidate;
}

function conflict(
  type: TaxonomyObjectKind,
  source: { readonly id: string; readonly name: string },
  target: { readonly id: string; readonly name: string },
  reason: TaxonomyConflictReason,
  message: string,
): TaxonomyConflict {
  return {
    type,
    sourceId: source.id,
    sourceName: source.name,
    targetId: target.id,
    targetName: target.name,
    reason,
    message,
  };
}

/**
 * 一个来源分类的映射。
 *
 * 系统分类按目标账本的系统分类匹配，而不是按名称：系统分类的名称/存在方式由服务器管理，名称不是
 * 用户语义的一部分。自定义分类先按 `(kind, 名称)` 找同名目标分类，再看归档状态。
 */
function mapCategory(
  source: Category,
  targetCategories: readonly Category[],
  reservedNames: Set<string>,
): { mapping: TaxonomyMapping<Category, Category>; conflicts: TaxonomyConflict[] } {
  const conflicts: TaxonomyConflict[] = [];
  const sameName = targetCategories.find(
    (target) => target.kind === source.kind && normalizeObjectName(target.name) === normalizeObjectName(source.name),
  );

  if (source.isSystem) {
    const targetSystem = targetCategories.find((target) => target.kind === source.kind && target.isSystem);
    if (targetSystem !== undefined) {
      return {
        mapping: {
          source,
          targetId: targetSystem.id,
          createName: null,
          createArchived: false,
          createColor: null,
          conflict: null,
          matchKey: `target:${targetSystem.id}`,
        },
        conflicts,
      };
    }
    // A target book always has system categories; this branch is a corrupted-target guard,
    // not something the UI should normally display. Create it rather than dropping the entries.
    return {
      mapping: {
        source,
        targetId: null,
        createName: uniqueName(source.name, reservedNames),
        createArchived: false,
        createColor: null,
        conflict: null,
        matchKey: `new:${source.id}`,
      },
      conflicts,
    };
  }

  if (sameName === undefined) {
    return {
      mapping: {
        source,
        targetId: null,
        createName: uniqueName(source.name, reservedNames),
        createArchived: source.isArchived,
        createColor: null,
        conflict: null,
        matchKey: `new:${source.id}`,
      },
      conflicts,
    };
  }

  if (sameName.isSystem) {
    const item = conflict(
      "category",
      source,
      sameName,
      "category_system_mismatch",
      `来源里的自定义分类「${source.name}」与目标的系统分类同名，不能在目标里直接复用。`,
    );
    conflicts.push(item);
    return {
      mapping: {
        source,
        targetId: sameName.id,
        createName: uniqueName(source.name, reservedNames),
        createArchived: source.isArchived,
        createColor: null,
        conflict: item,
        matchKey: `target:${sameName.id}`, // provisional; D3 must resolve before writing
      },
      conflicts,
    };
  }

  if (source.isArchived !== sameName.isArchived) {
    const item = conflict(
      "category",
      source,
      sameName,
      "category_archive_mismatch",
      `来源分类「${source.name}」${source.isArchived ? "已归档" : "未归档"}，目标同名分类${sameName.isArchived ? "已归档" : "未归档"}。`,
    );
    conflicts.push(item);
    return {
      mapping: {
        source,
        targetId: sameName.id,
        createName: uniqueName(source.name, reservedNames),
        createArchived: source.isArchived,
        createColor: null,
        conflict: item,
        matchKey: `target:${sameName.id}`,
      },
      conflicts,
    };
  }

  return {
    mapping: {
      source,
      targetId: sameName.id,
      createName: null,
      createArchived: false,
      createColor: null,
      conflict: null,
      matchKey: `target:${sameName.id}`,
    },
    conflicts,
  };
}

function mapPaymentMethod(
  source: PaymentMethod,
  targetMethods: readonly PaymentMethod[],
  reservedNames: Set<string>,
): { mapping: TaxonomyMapping<PaymentMethod, PaymentMethod>; conflicts: TaxonomyConflict[] } {
  const sameName = targetMethods.find(
    (target) => normalizeObjectName(target.name) === normalizeObjectName(source.name),
  );

  if (sameName === undefined) {
    return {
      mapping: {
        source,
        targetId: null,
        createName: uniqueName(source.name, reservedNames),
        createArchived: source.isArchived,
        createColor: null,
        conflict: null,
        matchKey: `new:${source.id}`,
      },
      conflicts: [],
    };
  }

  if (source.isArchived !== sameName.isArchived) {
    const item = conflict(
      "paymentMethod",
      source,
      sameName,
      "payment_method_archive_mismatch",
      `来源支付方式「${source.name}」${source.isArchived ? "已归档" : "未归档"}，目标同名支付方式${sameName.isArchived ? "已归档" : "未归档"}。`,
    );
    return {
      mapping: {
        source,
        targetId: sameName.id,
        createName: uniqueName(source.name, reservedNames),
        createArchived: source.isArchived,
        createColor: null,
        conflict: item,
        matchKey: `target:${sameName.id}`,
      },
      conflicts: [item],
    };
  }

  return {
    mapping: {
      source,
      targetId: sameName.id,
      createName: null,
      createArchived: false,
      createColor: null,
      conflict: null,
      matchKey: `target:${sameName.id}`,
    },
    conflicts: [],
  };
}

function mapTag(
  source: Tag,
  targetTags: readonly Tag[],
  reservedNames: Set<string>,
): { mapping: TaxonomyMapping<Tag, Tag>; conflicts: TaxonomyConflict[] } {
  const sameName = targetTags.find(
    (target) => normalizeObjectName(target.name) === normalizeObjectName(source.name),
  );

  if (sameName === undefined) {
    return {
      mapping: {
        source,
        targetId: null,
        createName: uniqueName(source.name, reservedNames),
        createArchived: false,
        createColor: source.color,
        conflict: null,
        matchKey: `new:${source.id}`,
      },
      conflicts: [],
    };
  }

  if (normalizeObjectName(source.color) !== normalizeObjectName(sameName.color)) {
    const item = conflict(
      "tag",
      source,
      sameName,
      "tag_color_mismatch",
      `来源标签「${source.name}」颜色为 ${source.color}，目标同名标签颜色为 ${sameName.color}；复用会丢失来源颜色。`,
    );
    return {
      mapping: {
        source,
        targetId: sameName.id,
        createName: uniqueName(source.name, reservedNames),
        createArchived: false,
        createColor: source.color,
        conflict: item,
        matchKey: `target:${sameName.id}`,
      },
      conflicts: [item],
    };
  }

  return {
    mapping: {
      source,
      targetId: sameName.id,
      createName: null,
      createArchived: false,
      createColor: null,
      conflict: null,
      matchKey: `target:${sameName.id}`,
    },
    conflicts: [],
  };
}

/**
 * 生成整份映射计划。
 *
 * 冲突项暂定“复用目标对象”，这样 D1 能立刻给出重复检测的预览；**D3 必须在真正写入前让用户对每个
 * 冲突作出选择，并重新计算受影响的重复检测组**。
 */
export function buildTaxonomyMappingPlan(
  source: {
    readonly categories: readonly Category[];
    readonly paymentMethods: readonly PaymentMethod[];
    readonly tags: readonly Tag[];
  },
  target: {
    readonly categories: readonly Category[];
    readonly paymentMethods: readonly PaymentMethod[];
    readonly tags: readonly Tag[];
  },
): TaxonomyMappingPlan {
  const reservedCategoryNames = new Set(
    target.categories.filter((item) => item.kind === "expense").map((item) => normalizeObjectName(item.name)),
  );
  const reservedIncomeNames = new Set(
    target.categories.filter((item) => item.kind === "income").map((item) => normalizeObjectName(item.name)),
  );
  const reservedPaymentNames = new Set(target.paymentMethods.map((item) => normalizeObjectName(item.name)));
  const reservedTagNames = new Set(target.tags.map((item) => normalizeObjectName(item.name)));

  const categories: TaxonomyMapping<Category, Category>[] = [];
  const conflicts: TaxonomyConflict[] = [];
  for (const item of source.categories) {
    const result = mapCategory(
      item,
      target.categories,
      item.kind === "income" ? reservedIncomeNames : reservedCategoryNames,
    );
    categories.push(result.mapping);
    conflicts.push(...result.conflicts);
  }

  const paymentMethods: TaxonomyMapping<PaymentMethod, PaymentMethod>[] = [];
  for (const item of source.paymentMethods) {
    const result = mapPaymentMethod(item, target.paymentMethods, reservedPaymentNames);
    paymentMethods.push(result.mapping);
    conflicts.push(...result.conflicts);
  }

  const tags: TaxonomyMapping<Tag, Tag>[] = [];
  for (const item of source.tags) {
    const result = mapTag(item, target.tags, reservedTagNames);
    tags.push(result.mapping);
    conflicts.push(...result.conflicts);
  }

  const count = <T,>(items: readonly TaxonomyMapping<T, unknown>[]) => ({
    reuse: items.filter((item) => item.targetId !== null && item.conflict === null).length,
    create: items.filter((item) => item.targetId === null).length,
    conflict: items.filter((item) => item.conflict !== null).length,
  });

  return {
    categories,
    paymentMethods,
    tags,
    conflicts,
    counts: {
      categories: count(categories),
      paymentMethods: count(paymentMethods),
      tags: count(tags),
    },
  };
}

