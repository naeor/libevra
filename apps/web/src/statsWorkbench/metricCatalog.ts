/**
 * **面向用户的统计指标目录**（1.17.10，自定义卡片编辑器的内容选择器）。
 *
 * 技术等级（Basic / Insight / Advanced / Professional，`catalog.ts` 的 `group`）保留在内部规格里；用户在这里
 * 按「想看什么」浏览：数字指标 / 趋势与时间 / 构成与排行 / 分布与关系 / 其他专业分析（1.17.12 起改名，原「高级与综合」）。
 *
 * ⚠️ **这里只排顺序、不定义指标。** 每一项都是 `CARD_TYPES` 里同一份分析定义的引用；同一个指标可以出现在
 * 几个分类里（例如「分类占比变化」既是趋势也是构成），但底层仍是同一个 ID、同一份计算，不复制逻辑。
 * 目录里登记了、却还没有正式实现的编号**不会显示**（`directorySections` 只列 `CARD_TYPES` 里存在的项）。
 */
import { CARD_TYPES, cardType, type CardType } from "./catalog.js";

export type DirectorySectionId = "numbers" | "trends" | "composition" | "distribution" | "advanced";

export interface DirectorySubgroup {
  readonly id: string;
  readonly ids: readonly string[];
}

export interface DirectorySection {
  readonly id: DirectorySectionId;
  readonly subgroups: readonly DirectorySubgroup[];
}

/** 用户可见的目录结构（按 84 项规划的真实语义归类）。 */
export const DIRECTORY: readonly DirectorySection[] = [
  {
    id: "numbers",
    subgroups: [
      { id: "totals", ids: ["AN-B01", "AN-B02"] },
      { id: "net", ids: ["AN-B03"] },
      { id: "counts", ids: ["AN-B04", "AN-B05", "AN-B13", "AN-B14", "AN-A15", "AN-B16", "AN-B20"] },
      { id: "averages", ids: ["AN-B06", "AN-B07", "AN-B08", "AN-A10", "AN-A11"] },
      { id: "extremes", ids: ["AN-B09", "AN-B10", "AN-B17", "AN-B11", "AN-B12", "AN-B15"] },
      { id: "ratios", ids: ["AN-B18", "AN-B19", "AN-A02", "AN-A03", "AN-A05", "AN-A08", "AN-A16"] },
      { id: "otherNumbers", ids: ["AN-A20"] },
    ],
  },
  {
    id: "trends",
    subgroups: [
      { id: "periodic", ids: ["AN-I06", "AN-I07", "AN-I08", "AN-I09", "AN-I10", "AN-I19"] },
      { id: "flow", ids: ["AN-I11", "AN-A01", "AN-A04"] },
      { id: "smoothing", ids: ["AN-I20", "AN-A13", "AN-A14", "AN-A12"] },
      { id: "cycles", ids: ["AN-I13", "AN-A18", "AN-I12", "AN-P15"] },
      { id: "peaks", ids: ["AN-A19"] },
      { id: "categoryTime", ids: ["AN-I14", "AN-I15", "AN-I16", "AN-P14", "AN-P04", "AN-P09"] },
    ],
  },
  {
    id: "composition",
    subgroups: [
      { id: "categories", ids: ["AN-I01", "AN-I02", "AN-P05", "AN-P06", "AN-P07", "AN-I16"] },
      { id: "rankings", ids: ["AN-I03", "AN-I04", "AN-I05", "AN-I18", "AN-A17", "AN-B15"] },
      { id: "methods", ids: ["AN-I17", "AN-P03", "AN-P04", "AN-P16"] },
      { id: "concentration", ids: ["AN-A08", "AN-P08", "AN-A16"] },
      { id: "change", ids: ["AN-A06", "AN-A07", "AN-P22", "AN-P24"] },
    ],
  },
  {
    id: "distribution",
    subgroups: [
      { id: "amounts", ids: ["AN-A09", "AN-A10", "AN-A11", "AN-P12", "AN-P23"] },
      { id: "relations", ids: ["AN-P10", "AN-P11"] },
      { id: "matrices", ids: ["AN-P01", "AN-P02", "AN-P03"] },
      { id: "outliers", ids: ["AN-A19", "AN-I18"] },
    ],
  },
  {
    id: "advanced",
    subgroups: [
      { id: "pivot", ids: ["AN-P13", "AN-P21"] },
      { id: "periodCompare", ids: ["AN-A01", "AN-A06", "AN-P22", "AN-P24", "AN-A02", "AN-A03", "AN-A05"] },
      { id: "fx", ids: ["AN-P16", "AN-P17", "AN-P18", "AN-P19", "AN-P20"] },
    ],
  },
];

/** 目录里实际可选的部分：只留已正式实现（在 `CARD_TYPES` 里）的指标，空的小组不显示。 */
export function directorySections(): readonly DirectorySection[] {
  return DIRECTORY.map((section) => ({
    id: section.id,
    subgroups: section.subgroups
      .map((group) => ({ id: group.id, ids: group.ids.filter((id) => cardType(id) !== null) }))
      .filter((group) => group.ids.length > 0),
  })).filter((section) => section.subgroups.length > 0);
}

/** 某个指标第一次出现的分类（搜索结果里标注「属于哪一类」）。 */
export function primarySectionOf(id: string): DirectorySectionId | null {
  for (const section of DIRECTORY) {
    if (section.subgroups.some((group) => group.ids.includes(id))) return section.id;
  }
  return null;
}

/** 目录覆盖到的全部指标编号（去重）。 */
export function directoryIds(): readonly string[] {
  const ids = new Set<string>();
  for (const section of DIRECTORY) for (const group of section.subgroups) for (const id of group.ids) ids.add(id);
  return [...ids];
}

type Translate = (key: string) => string;

/**
 * 搜索：名称、简短说明、分类名与编号都能命中（不区分大小写、忽略空格）。结果按目录顺序、每项只出现一次。
 */
export function searchDirectory(query: string, t: Translate): readonly CardType[] {
  const needle = query.trim().toLocaleLowerCase().replace(/\s+/g, "");
  if (needle === "") return [];
  const seen = new Set<string>();
  const results: CardType[] = [];
  for (const section of directorySections()) {
    const sectionName = t(`statsWorkbench.directory.sections.${section.id}`);
    for (const group of section.subgroups) {
      const groupName = t(`statsWorkbench.directory.subgroups.${group.id}`);
      for (const id of group.ids) {
        if (seen.has(id)) continue;
        const haystack = [
          id,
          t(`statsWorkbench.cards.${id}.title`),
          t(`statsWorkbench.cards.${id}.desc`),
          sectionName,
          groupName,
        ].join(" ").toLocaleLowerCase().replace(/\s+/g, "");
        if (!haystack.includes(needle)) continue;
        const type = cardType(id);
        if (type === null) continue;
        seen.add(id);
        results.push(type);
      }
    }
  }
  return results;
}

/** 目录完整性自检：可选指标都在目录里、目录里没有重复或无效项（供测试与开发期断言使用）。 */
export function directoryProblems(selectable: readonly string[] = CARD_TYPES.map((type) => type.id)): readonly string[] {
  const problems: string[] = [];
  const listed = new Set(directoryIds());
  for (const id of selectable) if (!listed.has(id)) problems.push(`missing:${id}`);
  for (const section of DIRECTORY) {
    for (const group of section.subgroups) {
      const seen = new Set<string>();
      for (const id of group.ids) {
        if (seen.has(id)) problems.push(`duplicate:${section.id}/${group.id}/${id}`);
        seen.add(id);
      }
    }
  }
  return problems;
}
