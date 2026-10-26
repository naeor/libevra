/**
 * 序列化 / 反序列化 / 非法输入测试（D-1）。
 *
 * 目标：往返一致、确定性、不抛异常、损坏配置给出可定位问题而不是白屏，
 * 且通过校验时保留未知字段（供未来版本只读兼容，不静默丢失）。
 */

import { describe, expect, it } from "vitest";
import {
  parseContentDocumentV1,
  parseLayoutDocumentV1,
  serializeContentDocumentV1,
  serializeLayoutDocumentV1,
  validateContentDocumentV1,
  validateLayoutDocumentV1,
} from "./validation.js";
import type { DocumentValidationIssue, DocumentValidationResult } from "./validation.js";
import {
  analysisCard,
  carousel,
  contentOf,
  contract,
  contractsOf,
  geometry,
  gridSplit,
  object,
  pinnedCard,
  size,
} from "./test-support.js";
import type { LayoutDocumentV1, WorkbenchContentDocumentV1 } from "./types.js";

function issueCodes(issues: readonly DocumentValidationIssue[]): readonly string[] {
  return issues.map((issue) => issue.code);
}

function expectInvalid<T>(result: DocumentValidationResult<T>): readonly string[] {
  expect(result.ok).toBe(false);
  return result.ok ? [] : issueCodes(result.issues);
}

const sampleContent = contentOf(
  [analysisCard("c1"), analysisCard("c2"), pinnedCard("c3", "2026-01-01", "2026-01-31"), analysisCard("c4")],
  [gridSplit("g1", ["c1", "c2"]), carousel("q1", ["c3", "c4"])],
);

const sampleLayout: LayoutDocumentV1 = {
  schemaVersion: 1,
  layoutAlgorithmVersion: 1,
  mode: "independent",
  main: geometry(2, [
    object("c1", "analysis-card", 1, 1, 1),
    object("g1", "grid-split", 2, 1, 1),
    object("S1", "spacer", 3, 1, 1),
  ]),
  profiles: [
    { profileKey: "wide", geometry: geometry(4, [object("c1", "analysis-card", 1, 2, 1)]) },
  ],
  previousMain: geometry(2, [object("c1", "analysis-card", 1, 1, 1)]),
};

describe("有效文档的序列化往返", () => {
  it("内容文档 JSON 往返后逐字节相同，重新序列化字符串不变", () => {
    const json = serializeContentDocumentV1(sampleContent);
    const parsed = parseContentDocumentV1(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.value).toEqual(sampleContent);
    expect(serializeContentDocumentV1(parsed.value)).toBe(json);
  });

  it("布局文档 JSON 往返后逐字节相同（含档案与上一个布局）", () => {
    const json = serializeLayoutDocumentV1(sampleLayout);
    const parsed = parseLayoutDocumentV1(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.value).toEqual(sampleLayout);
    expect(serializeLayoutDocumentV1(parsed.value)).toBe(json);
  });

  it("校验通过时原样保留未知字段（未来版本只读兼容，不静默丢弃）", () => {
    const futureContent = {
      ...sampleContent,
      futureField: { note: "来自更新版本的字段" },
      cards: sampleContent.cards.map((card) => ({ ...card, futureCardField: true })),
    };
    const result = validateContentDocumentV1(futureContent);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const record = result.value as unknown as Record<string, unknown>;
    expect(record["futureField"]).toEqual({ note: "来自更新版本的字段" });
  });
});

describe("非法 JSON 与根形状", () => {
  it("解析失败返回 invalid-json 而不是抛异常", () => {
    expect(expectInvalid(parseContentDocumentV1("{not json"))).toContain("invalid-json");
    expect(expectInvalid(parseLayoutDocumentV1(""))).toContain("invalid-json");
    expect(expectInvalid(parseLayoutDocumentV1("null"))).toContain("invalid-document");
  });

  it("非对象根节点被判为 invalid-document", () => {
    expect(expectInvalid(parseContentDocumentV1("[]"))).toContain("invalid-document");
  });
});

describe("布局文档的结构校验", () => {
  function layoutWith(mutate: (draft: Record<string, unknown>) => void): readonly string[] {
    const draft = JSON.parse(JSON.stringify(sampleLayout)) as Record<string, unknown>;
    mutate(draft);
    return expectInvalid(validateLayoutDocumentV1(draft));
  }

  it("列数/版本/模式非法", () => {
    expect(
      layoutWith((draft) => ((draft["main"] as Record<string, unknown>)["baseCols"] = 0)),
    ).toContain("invalid-columns");
    expect(layoutWith((draft) => (draft["schemaVersion"] = "1"))).toContain("invalid-schema-version");
    expect(layoutWith((draft) => (draft["mode"] = "broken"))).toContain("invalid-mode");
  });

  it("对象类型/占格/重复 ID 非法", () => {
    expect(
      layoutWith((draft) => {
        const main = draft["main"] as { objects: Array<Record<string, unknown>> };
        main.objects[0]!["objectType"] = "widget";
      }),
    ).toContain("invalid-object-type");
    expect(
      layoutWith((draft) => {
        const main = draft["main"] as { objects: Array<Record<string, unknown>> };
        main.objects[0]!["colSpan"] = 0;
      }),
    ).toContain("invalid-size");
    expect(
      layoutWith((draft) => {
        const main = draft["main"] as { objects: Array<Record<string, unknown>> };
        main.objects[0]!["rowSpan"] = 99;
      }),
    ).toContain("invalid-size");
    expect(
      layoutWith((draft) => {
        const main = draft["main"] as { objects: Array<Record<string, unknown>> };
        main.objects[1]!["objectId"] = main.objects[0]!["objectId"];
      }),
    ).toContain("duplicate-object-id");
  });
});

describe("内容文档的结构校验", () => {
  function contentWith(mutate: (draft: Record<string, unknown>) => void): readonly string[] {
    const draft = JSON.parse(JSON.stringify(sampleContent)) as Record<string, unknown>;
    mutate(draft);
    return expectInvalid(validateContentDocumentV1(draft));
  }

  it("缺字段与版本非法", () => {
    expect(contentWith((draft) => delete draft["schemaVersion"])).toContain("invalid-schema-version");
    expect(
      contentWith((draft) => {
        const cards = draft["cards"] as Array<Record<string, unknown>>;
        delete (cards[0]!["analysis"] as Record<string, unknown>)["analysisId"];
      }),
    ).toContain("invalid-analysis-id");
  });

  it("pinned 卡片必须给出 pinnedRange", () => {
    expect(
      contentWith((draft) => {
        const cards = draft["cards"] as Array<Record<string, unknown>>;
        delete cards[2]!["pinnedRange"];
      }),
    ).toContain("pinned-range-missing");
  });

  it("容器子对象数量/引用/嵌套非法", () => {
    expect(
      contentWith((draft) => {
        const containers = draft["containers"] as Array<Record<string, unknown>>;
        containers[1]!["children"] = ["c3"];
      }),
    ).toContain("invalid-children-count");
    expect(
      contentWith((draft) => {
        const containers = draft["containers"] as Array<Record<string, unknown>>;
        containers[0]!["children"] = ["c1", "missing-card"];
      }),
    ).toContain("child-not-found");
    expect(
      contentWith((draft) => {
        const containers = draft["containers"] as Array<Record<string, unknown>>;
        containers[0]!["children"] = ["c1", "q1"];
      }),
    ).toContain("container-nesting");
  });

  it("分割比例越界与重复 objectId", () => {
    expect(
      contentWith((draft) => {
        const containers = draft["containers"] as Array<Record<string, unknown>>;
        (containers[0]!["split"] as Record<string, unknown>)["columnSplitPermille"] = 1001;
      }),
    ).toContain("invalid-split-ratio");
    expect(
      contentWith((draft) => {
        const cards = draft["cards"] as Array<Record<string, unknown>>;
        cards[1]!["objectId"] = cards[0]!["objectId"];
      }),
    ).toContain("duplicate-object-id");
  });

  it("超过容器数量上限", () => {
    expect(
      contentWith((draft) => {
        const cards = draft["cards"] as Array<Record<string, unknown>>;
        const containers = draft["containers"] as Array<Record<string, unknown>>;
        for (let index = 0; index < 13; index += 1) {
          containers.push({ objectId: `x${index}`, type: "carousel", children: [cards[0]!["objectId"], cards[1]!["objectId"]] });
        }
      }),
    ).toContain("too-many-containers");
  });
});

describe("解析永不抛异常", () => {
  it("随机损坏字符串与半截 JSON 都返回结果", () => {
    const samples = ["{", "[]", "null", "\"text\"", "{\"schemaVersion\":1}", "{\"main\":{}}", "﻿{}"];
    for (const sample of samples) {
      expect(() => parseContentDocumentV1(sample)).not.toThrow();
      expect(() => parseLayoutDocumentV1(sample)).not.toThrow();
    }
  });
});

describe("契约兼容性", () => {
  it("尺寸契约不影响文档校验（契约在布局层之外按 W3 声明）", () => {
    const contracts = contractsOf(contract("c1", { minSize: size(1, 1), sizeLadder: [] }));
    const result = validateContentDocumentV1({ ...sampleContent, contracts });
    expect(result.ok).toBe(true);
  });
});

// 保留类型引用，避免未使用导入告警（同时明确测试输入类型来源）。
export type { WorkbenchContentDocumentV1 };
