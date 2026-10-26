/**
 * D-4 前置：分享快照白名单构建、校验、大小上限与短码纯函数测试。
 *
 * 边界：本测试只验证纯函数行为，不涉及服务端/隐私开关/权限（B-6 门）。
 */

import { describe, expect, it } from "vitest";
import type { AnalysisCardNode } from "./types.js";
import {
  MAX_SHARE_PAYLOAD_BYTES,
  SHARE_CODE_ALPHABET,
  SHARE_CODE_DEFAULT_LENGTH,
  buildShareSnapshot,
  createShareCode,
  exportShareSnapshot,
  findForbiddenKey,
  isValidShareCode,
  normalizeShareCode,
  parseShareSnapshotJson,
  serializeShareSnapshot,
  sharePayloadByteLength,
  validateShareSnapshot,
  type ShareSnapshotV1,
} from "./share-snapshot.js";
import { analysisCard, contentOf, geometry, gridSplit, layoutOf, object } from "./test-support.js";

const PRIVATE_TITLE = "我的私密标题";

function contentWithTitles() {
  const preset: AnalysisCardNode = { ...analysisCard("a"), title: { kind: "preset" } };
  const custom: AnalysisCardNode = { ...analysisCard("b"), title: { kind: "custom", text: PRIVATE_TITLE } };
  return contentOf([preset, custom], [gridSplit("g", ["a", "b"])]);
}

function independentLayout() {
  return layoutOf(
    geometry(2, [
      object("g", "grid-split", 1, 2, 2),
      object("a", "analysis-card", 3, 1, 1),
      object("b", "analysis-card", 4, 1, 1),
    ]),
    {
      mode: "independent",
      profiles: [{ profileKey: "cols-4", geometry: geometry(4, [object("a", "analysis-card", 1, 2, 1)]) }],
      previousMain: geometry(3, [object("a", "analysis-card", 1, 1, 1)]),
    },
  );
}

describe("share-snapshot：白名单构建（默认不导出用户文案）", () => {
  it("自定义标题默认不导出，preset 标题保留", () => {
    const snapshot = buildShareSnapshot(contentWithTitles(), independentLayout());
    const byId = new Map(snapshot.cards.map((card) => [card.objectId, card]));
    expect(byId.get("a")?.title).toEqual({ kind: "preset" });
    expect(byId.get("b")?.title).toBeUndefined();
  });

  it("includeCustomTitles=true 时才导出自定义标题", () => {
    const snapshot = buildShareSnapshot(contentWithTitles(), independentLayout(), { includeCustomTitles: true });
    const custom = snapshot.cards.find((card) => card.objectId === "b");
    expect(custom?.title).toEqual({ kind: "custom", text: PRIVATE_TITLE });
  });

  it("不导出 previousMain；独立模式档案保留", () => {
    const snapshot = buildShareSnapshot(contentWithTitles(), independentLayout());
    expect(snapshot.layout.mode).toBe("independent");
    expect(snapshot.layout.profiles?.map((profile) => profile.profileKey)).toEqual(["cols-4"]);
    expect("previousMain" in snapshot.layout).toBe(false);
  });

  it("模板与语言可选字段按白名单进入快照", () => {
    const snapshot = buildShareSnapshot(contentWithTitles(), independentLayout(), {
      template: { name: "日常总览", description: "示例模板" },
      language: "zh-CN",
    });
    expect(snapshot.template?.name).toBe("日常总览");
    expect(snapshot.language).toBe("zh-CN");
  });
});

describe("share-snapshot：序列化 / 解析 / 大小上限", () => {
  it("导出 → 解析往返成功且 JSON 稳定", () => {
    const exported = exportShareSnapshot(contentWithTitles(), independentLayout());
    expect(exported.ok).toBe(true);
    expect(exported.bytes).toBe(sharePayloadByteLength(exported.json ?? ""));
    const parsed = parseShareSnapshotJson(exported.json ?? "");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(JSON.stringify(parsed.value)).toBe(exported.json);
    }
  });

  it("通过校验时原样返回输入（保留未来版本未知字段）", () => {
    const snapshot = buildShareSnapshot(contentWithTitles(), independentLayout());
    const future = { ...snapshot, futureField: { version: 2 } } as unknown as ShareSnapshotV1;
    const validated = validateShareSnapshot(future);
    expect(validated.ok).toBe(true);
    expect(validated.ok ? validated.value : null).toEqual(future);
  });

  it("模板名/描述超长被拒绝", () => {
    const nameTooLong = exportShareSnapshot(contentWithTitles(), independentLayout(), {
      template: { name: "x".repeat(41) },
    });
    expect(nameTooLong.ok).toBe(false);
    expect(nameTooLong.issues.map((item) => item.code)).toContain("template-name-too-long");

    const descriptionTooLong = exportShareSnapshot(contentWithTitles(), independentLayout(), {
      template: { name: "ok", description: "y".repeat(201) },
    });
    expect(descriptionTooLong.ok).toBe(false);
    expect(descriptionTooLong.issues.map((item) => item.code)).toContain("template-description-too-long");
  });

  it("超字节上限被拒绝（未知字段也计入）", () => {
    const snapshot = buildShareSnapshot(contentWithTitles(), independentLayout());
    const huge = { ...snapshot, blob: "x".repeat(MAX_SHARE_PAYLOAD_BYTES + 1) } as unknown as ShareSnapshotV1;
    const serialized = serializeShareSnapshot(huge);
    expect(serialized.ok).toBe(false);
    expect(serialized.issues.map((item) => item.code)).toContain("payload-too-large");

    const parsed = parseShareSnapshotJson("x".repeat(MAX_SHARE_PAYLOAD_BYTES + 1));
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? [] : parsed.issues.map((item) => item.code)).toContain("payload-too-large");
  });

  it("布局对象缺少内容引用 → child-not-found", () => {
    const snapshot = buildShareSnapshot(contentWithTitles(), independentLayout());
    const broken = {
      ...snapshot,
      layout: {
        ...snapshot.layout,
        main: {
          ...snapshot.layout.main,
          objects: [
            ...snapshot.layout.main.objects,
            { objectId: "ghost", objectType: "analysis-card", anchor: 9, colSpan: 1, rowSpan: 1 },
          ],
        },
      },
    } as unknown as ShareSnapshotV1;
    const validated = validateShareSnapshot(broken);
    expect(validated.ok).toBe(false);
    expect(validated.ok ? [] : validated.issues.map((item) => item.code)).toContain("child-not-found");
  });

  it("危险键（__proto__）被拒绝", () => {
    const base = buildShareSnapshot(contentWithTitles(), independentLayout());
    const pollutedParams = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
    const polluted = {
      ...base,
      cards: base.cards.map((card) =>
        card.objectId === "a"
          ? { ...card, analysis: { ...card.analysis, params: pollutedParams } }
          : card,
      ),
    } as unknown as ShareSnapshotV1;
    const parsed = parseShareSnapshotJson(JSON.stringify(polluted));
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? [] : parsed.issues.map((item) => item.code)).toContain("forbidden-key");
  });

  it("findForbiddenKey 递归命中并返回路径", () => {
    const value = JSON.parse('{"cards":[{"nested":{"__proto__":{"x":1}}}]}') as unknown;
    expect(findForbiddenKey(value)).toBe("$.cards[0].nested.__proto__");
  });
});

describe("share-snapshot：短分享码（随机源注入）", () => {
  const fixedRandom = (byteCount: number): Uint8Array =>
    Uint8Array.from({ length: byteCount }, (_, index) => (index * 7 + 3) % 256);

  it("生成 8 位去歧义码，字符全部在字母表内且可复现", () => {
    const code = createShareCode(fixedRandom);
    expect(code).toHaveLength(SHARE_CODE_DEFAULT_LENGTH);
    for (const character of code) {
      expect(SHARE_CODE_ALPHABET).toContain(character);
    }
    expect(createShareCode(fixedRandom)).toBe(code);
  });

  it("长度 8–10 合法，其他长度返回空串", () => {
    expect(createShareCode(fixedRandom, 8)).toHaveLength(8);
    expect(createShareCode(fixedRandom, 10)).toHaveLength(10);
    expect(createShareCode(fixedRandom, 7)).toBe("");
    expect(createShareCode(fixedRandom, 11)).toBe("");
    expect(createShareCode(fixedRandom, 8.5)).toBe("");
  });

  it("随机源字节不足 → 空串而不是抛异常", () => {
    expect(createShareCode(() => new Uint8Array(2))).toBe("");
  });

  it("格式校验：大小写规范化、去空白、拒绝歧义字符与错长度", () => {
    expect(normalizeShareCode(" abcd2345 ")).toBe("ABCD2345");
    expect(isValidShareCode("ABCD2345")).toBe(true);
    expect(isValidShareCode("abcd2345")).toBe(true);
    expect(isValidShareCode("ABCD234")).toBe(false);
    expect(isValidShareCode("ABCD23456789")).toBe(false);
    expect(isValidShareCode("ABCD0O1I")).toBe(false);
  });
});
