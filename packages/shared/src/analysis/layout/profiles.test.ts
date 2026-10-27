/**
 * D-3.1：独立布局档案与模式迁移引擎测试。
 *
 * 覆盖：档案键占位派生、档案解析（profile / main-projection）、写时复制物化、
 * 模式切换（数据保留）、以档案作为主布局、内容变更诊断、孤儿丢弃、
 * 确定性/无漂移属性测试。
 */

import { describe, expect, it } from "vitest";
import type { LayoutDocumentV1 } from "./types.js";
import {
  adoptProfileAsMain,
  findProfile,
  findUnplacedContentObjects,
  isProfileMaterialized,
  listProfileKeys,
  materializeProfile,
  profileKeyForColumns,
  profileKeyForWidth,
  resolveProfile,
  switchLayoutMode,
} from "./profiles.js";
import { validateGeometry } from "./grid.js";
import { createTestPrng } from "./test-prng.js";
import {
  analysisCard,
  contentOf,
  geometry,
  gridSplit,
  layoutOf,
  object,
} from "./test-support.js";

const CONTENT = contentOf(
  [analysisCard("a"), analysisCard("b"), analysisCard("c")],
  [gridSplit("g", ["a", "b"])],
);

const MAIN = geometry(2, [
  object("g", "grid-split", 1, 2, 2),
  object("a", "analysis-card", 3, 1, 1),
  object("b", "analysis-card", 4, 1, 1),
  object("c", "analysis-card", 5, 1, 1),
]);

const PROFILE_4 = {
  profileKey: "cols-4",
  geometry: geometry(4, [
    object("a", "analysis-card", 1, 1, 1),
    object("b", "analysis-card", 2, 1, 1),
    object("c", "analysis-card", 3, 1, 1),
    object("g", "grid-split", 5, 2, 2),
  ]),
};

function anchors(resolution: ReturnType<typeof resolveProfile>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const projected of resolution.projection.objects) {
    result[projected.objectId] = projected.anchor;
  }
  return result;
}

function independentLayout(): LayoutDocumentV1 {
  return layoutOf(MAIN, { mode: "independent", profiles: [PROFILE_4] });
}

describe("profiles：档案键占位派生（OQ-LM-08 未决，不猜数值）", () => {
  it("精确列数键", () => {
    expect(profileKeyForColumns(2)).toBe("cols-2");
    expect(profileKeyForColumns(12)).toBe("cols-12");
    expect(profileKeyForColumns(0)).toBeNull();
    expect(profileKeyForColumns(13)).toBeNull();
    expect(profileKeyForColumns(2.5)).toBeNull();
  });

  it("宽度档键：阈值为空返回 null（不虚构档位）", () => {
    expect(profileKeyForWidth(390)).toBeNull();
    expect(profileKeyForWidth(390, [400, 700])).toBe("width-400");
    expect(profileKeyForWidth(700, [400, 700])).toBe("width-700");
    expect(profileKeyForWidth(1024, [400, 700])).toBe("width-over-700");
    expect(profileKeyForWidth(0, [400])).toBeNull();
  });

  it("档案列表排序与查找", () => {
    const layout = layoutOf(MAIN, {
      mode: "independent",
      profiles: [
        PROFILE_4,
        { profileKey: "cols-2", geometry: MAIN },
      ],
    });
    expect(listProfileKeys(layout)).toEqual(["cols-2", "cols-4"]);
    expect(findProfile(layout, "cols-4")).toEqual(PROFILE_4);
    expect(isProfileMaterialized(layout, "cols-2")).toBe(true);
    expect(isProfileMaterialized(layout, "cols-6")).toBe(false);
  });
});

describe("profiles：统一/独立模式解析", () => {
  it("统一模式即使有 profiles 也只投影主布局", () => {
    const layout = layoutOf(MAIN, { mode: "unified", profiles: [PROFILE_4] });
    const resolution = resolveProfile(layout, CONTENT, { targetColumns: 4 });
    expect(resolution.source).toBe("main-projection");
    // 主布局 baseCols=2 → 投影到 4 列时 c 被顺延，不会用到 cols-4 档案里的位置。
    expect(anchors(resolution)).toEqual({ g: 1, a: 3, b: 4, c: 7 });
  });

  it("独立模式有对应档案 → 使用档案几何（不与主布局混合）", () => {
    const resolution = resolveProfile(independentLayout(), CONTENT, { targetColumns: 4 });
    expect(resolution.source).toBe("profile");
    expect(resolution.profileKey).toBe("cols-4");
    expect(anchors(resolution)).toEqual({ a: 1, b: 2, c: 3, g: 5 });
    expect(resolution.geometry.baseCols).toBe(4);
  });

  it("独立模式无档案 → 从主布局投影（写时复制前，不物化）", () => {
    const layout: LayoutDocumentV1 = { ...independentLayout(), profiles: [] };
    const resolution = resolveProfile(layout, CONTENT, { targetColumns: 2 });
    expect(resolution.source).toBe("main-projection");
    expect(resolution.profileKey).toBe("cols-2");
    expect(layout.profiles).toEqual([]);
  });

  it("档案键显式指定且存在 → 使用该档案（即使列数不同也确定性迁移）", () => {
    const resolution = resolveProfile(independentLayout(), CONTENT, {
      targetColumns: 2,
      profileKey: "cols-4",
    });
    expect(resolution.source).toBe("profile");
    // cols-4 档案 baseCols=4 投影到 2 列：a/b/c 均在 g 的 2×2 之外，保持靠前位置。
    expect(resolution.geometry.baseCols).toBe(2);
    expect(Object.keys(anchors(resolution)).sort()).toEqual(["a", "b", "c", "g"]);
  });

  it("非法列数安全降级为 2 列并登记问题；空档案键回退占位键", () => {
    const resolution = resolveProfile(independentLayout(), CONTENT, {
      targetColumns: 0,
      profileKey: "  ",
    });
    expect(resolution.targetColumns).toBe(2);
    expect(resolution.profileKey).toBe("cols-2");
    expect(resolution.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining(["invalid-columns", "invalid-profile-key"]),
    );
  });

  it("不修改输入布局（投影/解析是纯函数）", () => {
    const layout = independentLayout();
    const before = JSON.stringify(layout);
    resolveProfile(layout, CONTENT, { targetColumns: 4 });
    resolveProfile(layout, CONTENT, { targetColumns: 2 });
    expect(JSON.stringify(layout)).toBe(before);
  });

  it("内容删除后档案中的孤儿几何被投影丢弃（不写回）", () => {
    const content = contentOf([analysisCard("a"), analysisCard("b")], [gridSplit("g", ["a", "b"])]);
    const resolution = resolveProfile(independentLayout(), content, { targetColumns: 4 });
    expect(resolution.projection.objects.map((item) => item.objectId)).not.toContain("c");
    expect(resolution.issues.map((item) => item.code)).toContain("projection-orphan-dropped");
  });
});

describe("profiles：写时复制物化", () => {
  it("首次保存生成档案条目，几何为目标列数投影结果", () => {
    const layout: LayoutDocumentV1 = { ...independentLayout(), profiles: [] };
    const result = materializeProfile(layout, CONTENT, { targetColumns: 4 });
    expect(result.created).toBe(true);
    expect(listProfileKeys(result.layout)).toEqual(["cols-4"]);
    const profile = findProfile(result.layout, "cols-4");
    expect(profile?.geometry.baseCols).toBe(4);
    expect(profile?.geometry.objects.map((item) => item.objectId).sort()).toEqual(["a", "b", "c", "g"]);
  });

  it("已物化时幂等：created=false 且布局不变", () => {
    const layout = independentLayout();
    const result = materializeProfile(layout, CONTENT, { targetColumns: 4 });
    expect(result.created).toBe(false);
    expect(result.layout).toBe(layout);
  });

  it("物化不修改输入布局", () => {
    const layout: LayoutDocumentV1 = { ...independentLayout(), profiles: [] };
    const before = JSON.stringify(layout);
    materializeProfile(layout, CONTENT, { targetColumns: 2 });
    expect(JSON.stringify(layout)).toBe(before);
  });

  it("物化与解析结果一致（渲染与保存同一几何）", () => {
    const layout: LayoutDocumentV1 = { ...independentLayout(), profiles: [] };
    const resolution = resolveProfile(layout, CONTENT, { targetColumns: 2 });
    const materialized = materializeProfile(layout, CONTENT, { targetColumns: 2 });
    const profile = findProfile(materialized.layout, "cols-2");
    expect(profile?.geometry).toEqual(resolution.geometry);
  });
});

describe("profiles：模式切换与采纳档案", () => {
  it("统一 → 独立：主布局保留，档案保持未物化", () => {
    const result = switchLayoutMode(layoutOf(MAIN), "independent");
    expect(result.changed).toBe(true);
    expect(result.layout.mode).toBe("independent");
    expect(result.layout.profiles).toBeUndefined();
    expect(result.layout.main).toEqual(MAIN);
  });

  it("独立 → 统一：profile 数据保留但不再使用", () => {
    const result = switchLayoutMode(independentLayout(), "unified");
    expect(result.changed).toBe(true);
    expect(result.layout.mode).toBe("unified");
    expect(listProfileKeys(result.layout)).toEqual(["cols-4"]);
    expect(result.layout.main).toEqual(MAIN);
  });

  it("同模式切换 changed=false；非法模式登记问题", () => {
    const layout = layoutOf(MAIN);
    expect(switchLayoutMode(layout, "unified").changed).toBe(false);
    const invalid = switchLayoutMode(layout, "bogus" as never);
    expect(invalid.changed).toBe(false);
    expect(invalid.issues.map((item) => item.code)).toContain("invalid-mode");
  });

  it("以档案作为统一主布局：main 替换、旧布局进 previousMain、profiles 保留", () => {
    const result = adoptProfileAsMain(independentLayout(), "cols-4");
    expect(result.ok).toBe(true);
    const layout = result.layout;
    expect(layout?.mode).toBe("unified");
    expect(layout?.main.baseCols).toBe(4);
    expect(layout?.main.objects.map((item) => item.objectId).sort()).toEqual(["a", "b", "c", "g"]);
    expect(layout?.previousMain).toEqual(MAIN);
    expect(listProfileKeys(layout as LayoutDocumentV1)).toEqual(["cols-4"]);
  });

  it("档案不存在 → ok=false + missing-profile", () => {
    const result = adoptProfileAsMain(independentLayout(), "cols-6");
    expect(result.ok).toBe(false);
    expect(result.issues.map((item) => item.code)).toContain("missing-profile");
  });
});

describe("profiles：内容新增诊断（不擅自补位）", () => {
  it("检测内容文档中还没有几何条目的对象（排序）", () => {
    const content = contentOf(
      [analysisCard("a"), analysisCard("b"), analysisCard("d")],
      [gridSplit("g", ["a", "b"])],
    );
    expect(findUnplacedContentObjects(content, independentLayout())).toEqual(["d"]);
  });

  it("全部已放置 → 空数组", () => {
    expect(findUnplacedContentObjects(CONTENT, independentLayout())).toEqual([]);
  });
});

describe("profiles：确定性属性测试", () => {
  it("随机布局下解析确定、几何合法、布局不被修改（300 场景）", () => {
    const prng = createTestPrng(0x5f17d1a1);
    let checked = 0;
    let profileHits = 0;
    for (let scenario = 0; scenario < 300; scenario += 1) {
      const objectCount = prng.nextInt(1, 4);
      const objectIds = Array.from({ length: objectCount }, (_, index) => `o${String(index)}`);
      const baseCols = prng.nextInt(1, 4);
      const targetColumns = prng.nextInt(1, 6);

      const mainObjects = objectIds.map((objectId, index) => {
        const anchor = prng.nextInt(1, Math.max(1, baseCols * 3));
        const colSpan = prng.nextInt(1, baseCols);
        return object(objectId, "analysis-card", anchor, colSpan, prng.nextInt(1, 2));
      });
      const profileObjects = objectIds.map((objectId) => {
        const anchor = prng.nextInt(1, Math.max(1, 4 * 3));
        return object(objectId, "analysis-card", anchor, prng.nextInt(1, 4), prng.nextInt(1, 2));
      });

      const layout: LayoutDocumentV1 = prng.chance(0.6)
        ? layoutOf(geometry(baseCols, mainObjects), {
            mode: "independent",
            profiles: [{ profileKey: "cols-4", geometry: geometry(4, profileObjects) }],
          })
        : layoutOf(geometry(baseCols, mainObjects));

      const content = contentOf(objectIds.map((objectId) => analysisCard(objectId)));
      const before = JSON.stringify(layout);

      const options = prng.chance(0.4)
        ? { targetColumns, profileKey: "cols-4" }
        : { targetColumns };
      const first = resolveProfile(layout, content, options);
      const second = resolveProfile(layout, content, options);

      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      expect(JSON.stringify(layout)).toBe(before);
      expect(first.targetColumns).toBeGreaterThanOrEqual(1);
      expect(first.targetColumns).toBeLessThanOrEqual(12);
      expect(validateGeometry(first.geometry.objects, first.geometry.baseCols)).toEqual([]);
      if (first.source === "profile") {
        profileHits += 1;
      }
      checked += 1;
    }
    expect(checked).toBe(300);
    expect(profileHits).toBeGreaterThan(100);
  });
});
