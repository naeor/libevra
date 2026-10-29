/**
 * 用户可见的指标目录（1.17.10）：已实现的指标全部能找到，没实现的不出现，同一指标在多个分类里引用同一定义。
 */
import { describe, expect, it } from "vitest";

import { applyLocale, i18n } from "../i18n/index.js";
import { CARD_TYPES } from "./catalog.js";
import { CUSTOM_CARD_TYPES } from "./customCards.js";
import { directoryIds, directoryProblems, directorySections, primarySectionOf, searchDirectory } from "./metricCatalog.js";

applyLocale("zh-CN");
const t = (key: string): string => i18n.t(key as never);

describe("目录完整性", () => {
  it("可选指标 83 项全部在目录里，目录里没有重复与无效项", () => {
    expect(CUSTOM_CARD_TYPES).toHaveLength(83);
    expect(directoryProblems()).toEqual([]);
  });

  it("目录开放 P05/P07，P21 仍不出现；每项都指向已实现指标", () => {
    const shown = new Set(directorySections().flatMap((section) => section.subgroups.flatMap((group) => group.ids)));
    expect(shown.has("AN-P21")).toBe(false);
    expect(shown.has("AN-P05")).toBe(true);
    expect(shown.has("AN-P07")).toBe(true);
    for (const id of shown) expect(CARD_TYPES.some((type) => type.id === id), id).toBe(true);
    expect(shown.size).toBe(83);
  });

  it("五个用户分类都有内容；同一指标可在多个分类出现但只有一个主分类", () => {
    expect(directorySections().map((section) => section.id)).toEqual(["numbers", "trends", "composition", "distribution", "advanced"]);
    // A08 分类集中度同时在「数字指标 · 比率」与「构成 · 集中度」
    const places = directorySections().flatMap((section) => section.subgroups.filter((group) => group.ids.includes("AN-A08")).map((group) => `${section.id}/${group.id}`));
    expect(places).toEqual(["numbers/ratios", "composition/concentration"]);
    expect(primarySectionOf("AN-A08")).toBe("numbers");
    expect(directoryIds().filter((id) => id === "AN-A08")).toHaveLength(1);
  });
});

describe("名称", () => {
  it("每项指标的名称在中英文里都唯一（目录与搜索里不会混淆两项）", () => {
    for (const locale of ["zh-CN", "en-US"] as const) {
      applyLocale(locale);
      const titles = CARD_TYPES.map((type) => i18n.t(`statsWorkbench.cards.${type.id}.title` as never) as string);
      expect(new Set(titles).size, locale).toBe(titles.length);
    }
    applyLocale("zh-CN");
  });
});

describe("搜索", () => {
  it("按名称、说明、分类名与编号都能找到，结果不重复", () => {
    expect(searchDirectory("帕累托", t).map((type) => type.id)).toEqual(["AN-P08"]);
    expect(searchDirectory("an-p13", t).map((type) => type.id)).toEqual(["AN-P13"]);
    const fx = searchDirectory("汇率", t).map((type) => type.id);
    for (const id of ["AN-P18", "AN-P19", "AN-P20"]) expect(fx).toContain(id);
    expect(new Set(fx).size).toBe(fx.length);
    expect(searchDirectory("   ", t)).toEqual([]);
  });
});
