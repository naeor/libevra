/**
 * D-4 前置：文档读取 / 序列化往返 / 损坏容错测试（复用 D-1 校验器）。
 */

import { describe, expect, it } from "vitest";
import {
  emptyContentDocument,
  emptyLayoutDocument,
  loadContentDocument,
  loadLayoutDocument,
  roundTripContentDocument,
  roundTripLayoutDocument,
} from "./document-io.js";
import { analysisCard, contentOf, geometry, gridSplit, layoutOf, object } from "./test-support.js";
import type { LayoutDocumentV1 } from "./types.js";

const CONTENT = contentOf(
  [analysisCard("a"), analysisCard("b")],
  [gridSplit("g", ["a", "b"])],
);

const LAYOUT = layoutOf(
  geometry(2, [
    object("g", "grid-split", 1, 2, 2),
    object("a", "analysis-card", 3, 1, 1),
    object("b", "analysis-card", 4, 1, 1),
  ]),
);

describe("document-io：布局/内容文档往返", () => {
  it("合法布局文档往返逐字节一致", () => {
    const result = roundTripLayoutDocument(LAYOUT);
    expect(result.ok).toBe(true);
    expect(result.document).toEqual(LAYOUT);
    expect(result.issues).toEqual([]);
  });

  it("独立模式档案与上一个布局一起往返", () => {
    const independent = layoutOf(geometry(2, [object("a", "analysis-card", 1, 1, 1)]), {
      mode: "independent",
      profiles: [
        { profileKey: "cols-2", geometry: geometry(2, [object("a", "analysis-card", 1, 1, 1)]) },
        { profileKey: "cols-4", geometry: geometry(4, [object("a", "analysis-card", 1, 2, 1)]) },
      ],
      previousMain: geometry(3, [object("a", "analysis-card", 1, 1, 1)]),
    });
    const result = roundTripLayoutDocument(independent);
    expect(result.ok).toBe(true);
    expect(result.document).toEqual(independent);
  });

  it("未知字段在往返中保留（便于旧客户端只读兼容）", () => {
    const withExtra = {
      ...LAYOUT,
      uiHints: { zoom: 1, note: "未来版本字段" },
    } as unknown as LayoutDocumentV1;
    const result = roundTripLayoutDocument(withExtra);
    expect(result.ok).toBe(true);
    expect(result.document).toEqual(withExtra);
  });

  it("非法布局文档在往返前被校验拒绝", () => {
    const invalid = { ...LAYOUT, main: { baseCols: 0, objects: [] } } as unknown as LayoutDocumentV1;
    const result = roundTripLayoutDocument(invalid);
    expect(result.ok).toBe(false);
    expect(result.issues.map((item) => item.code)).toContain("invalid-columns");
  });

  it("合法内容文档往返逐字节一致", () => {
    const result = roundTripContentDocument(CONTENT);
    expect(result.ok).toBe(true);
    expect(result.document).toEqual(CONTENT);
  });

  it("行为：空文档常量是安全的默认工作台（2 列空布局）", () => {
    expect(emptyLayoutDocument()).toEqual({
      schemaVersion: 1,
      layoutAlgorithmVersion: 1,
      mode: "unified",
      main: { baseCols: 2, objects: [] },
    });
    expect(emptyContentDocument()).toEqual({ schemaVersion: 1, cards: [], containers: [] });
  });
});

describe("document-io：损坏数据容错（不抛异常、保留原始副本）", () => {
  it("非法 JSON → 回退默认布局并保留 raw", () => {
    const raw = "{ not json";
    const result = loadLayoutDocument(raw);
    expect(result.ok).toBe(false);
    expect(result.usedFallback).toBe(true);
    expect(result.raw).toBe(raw);
    expect(result.document).toEqual(emptyLayoutDocument());
    expect(result.issues[0]?.code).toBe("invalid-json");
  });

  it("结构损坏（baseCols=0）→ 回退默认布局并给出问题码", () => {
    const raw = JSON.stringify({ ...LAYOUT, main: { baseCols: 0, objects: [] } });
    const result = loadLayoutDocument(raw);
    expect(result.ok).toBe(false);
    expect(result.usedFallback).toBe(true);
    expect(result.raw).toBe(raw);
    expect(result.issues.map((item) => item.code)).toContain("invalid-columns");
  });

  it("内容文档损坏 → 回退空内容文档", () => {
    const raw = "[1,2,3]";
    const result = loadContentDocument(raw);
    expect(result.ok).toBe(false);
    expect(result.usedFallback).toBe(true);
    expect(result.document).toEqual(emptyContentDocument());
    expect(result.issues.map((item) => item.code)).toContain("invalid-document");
  });

  it("合法 JSON 成功读取且不使用回退", () => {
    const raw = JSON.stringify(LAYOUT);
    const result = loadLayoutDocument(raw);
    expect(result.ok).toBe(true);
    expect(result.usedFallback).toBe(false);
    expect(result.document).toEqual(LAYOUT);
  });
});
