/**
 * D-4 前置：布局/内容文档的读取、序列化往返与损坏数据容错（local-first 基础）。
 *
 * 复用 `validation.ts` 的结构校验与序列化（D-1），这里只补充：
 * - 读取原始字符串 → 校验 → 成功返回文档、失败**保留原始字符串**并回退到安全默认文档；
 * - 序列化往返自检（序列化 → 解析 → 再序列化逐字节相同）。
 *
 * 纯函数：不读时钟/视口/随机数，不写回权威布局；损坏数据绝不导致抛异常或白屏。
 */

import type { LayoutDocumentV1, WorkbenchContentDocumentV1 } from "./types.js";
import { LAYOUT_ALGORITHM_VERSION, LAYOUT_SCHEMA_VERSION } from "./types.js";
import type { DocumentValidationIssue } from "./validation.js";
import {
  parseContentDocumentV1,
  parseLayoutDocumentV1,
  serializeContentDocumentV1,
  serializeLayoutDocumentV1,
  validateContentDocumentV1,
  validateLayoutDocumentV1,
} from "./validation.js";

/** 读取结果：`raw` 始终保留，便于上层把损坏副本另存为“上一个布局”。 */
export interface DocumentLoadResult<T> {
  readonly ok: boolean;
  /** 校验通过返回原文档；失败返回安全默认文档（绝不抛异常）。 */
  readonly document: T;
  /** 原始字符串原样保留（含非法/损坏内容）。 */
  readonly raw: string;
  readonly issues: readonly DocumentValidationIssue[];
  /** true 表示 `document` 是回退默认值，不是用户数据。 */
  readonly usedFallback: boolean;
}

/** 序列化往返自检结果。 */
export interface DocumentRoundTripResult<T> {
  readonly ok: boolean;
  readonly document?: T;
  readonly issues: readonly DocumentValidationIssue[];
}

/** 安全默认布局文档：手机默认 2 列、空主布局（对应“默认工作台直接可用”）。 */
export function emptyLayoutDocument(): LayoutDocumentV1 {
  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    layoutAlgorithmVersion: LAYOUT_ALGORITHM_VERSION,
    mode: "unified",
    main: { baseCols: 2, objects: [] },
  };
}

/** 安全默认内容文档：无卡片、无容器。 */
export function emptyContentDocument(): WorkbenchContentDocumentV1 {
  return { schemaVersion: LAYOUT_SCHEMA_VERSION, cards: [], containers: [] };
}

/** 读取一份布局文档 JSON；失败时保留 raw 并回退默认布局。 */
export function loadLayoutDocument(raw: string): DocumentLoadResult<LayoutDocumentV1> {
  const parsed = parseLayoutDocumentV1(raw);
  if (parsed.ok) {
    return { ok: true, document: parsed.value, raw, issues: [], usedFallback: false };
  }
  return {
    ok: false,
    document: emptyLayoutDocument(),
    raw,
    issues: parsed.issues,
    usedFallback: true,
  };
}

/** 读取一份内容文档 JSON；失败时保留 raw 并回退空内容文档。 */
export function loadContentDocument(raw: string): DocumentLoadResult<WorkbenchContentDocumentV1> {
  const parsed = parseContentDocumentV1(raw);
  if (parsed.ok) {
    return { ok: true, document: parsed.value, raw, issues: [], usedFallback: false };
  }
  return {
    ok: false,
    document: emptyContentDocument(),
    raw,
    issues: parsed.issues,
    usedFallback: true,
  };
}

/** 布局文档序列化 → 解析往返自检（逐字节一致才算通过）。 */
export function roundTripLayoutDocument(
  document: LayoutDocumentV1,
): DocumentRoundTripResult<LayoutDocumentV1> {
  const validated = validateLayoutDocumentV1(document);
  if (!validated.ok) {
    return { ok: false, issues: validated.issues };
  }
  const first = serializeLayoutDocumentV1(validated.value);
  const reparsed = parseLayoutDocumentV1(first);
  if (!reparsed.ok) {
    return { ok: false, issues: reparsed.issues };
  }
  const again = serializeLayoutDocumentV1(reparsed.value);
  if (again !== first) {
    return {
      ok: false,
      issues: [
        { path: "$", code: "roundtrip-mismatch", detail: "布局文档序列化往返后不一致" },
      ],
    };
  }
  return { ok: true, document: reparsed.value, issues: [] };
}

/** 内容文档序列化 → 解析往返自检（逐字节一致才算通过）。 */
export function roundTripContentDocument(
  document: WorkbenchContentDocumentV1,
): DocumentRoundTripResult<WorkbenchContentDocumentV1> {
  const validated = validateContentDocumentV1(document);
  if (!validated.ok) {
    return { ok: false, issues: validated.issues };
  }
  const first = serializeContentDocumentV1(validated.value);
  const reparsed = parseContentDocumentV1(first);
  if (!reparsed.ok) {
    return { ok: false, issues: reparsed.issues };
  }
  const again = serializeContentDocumentV1(reparsed.value);
  if (again !== first) {
    return {
      ok: false,
      issues: [
        { path: "$", code: "roundtrip-mismatch", detail: "内容文档序列化往返后不一致" },
      ],
    };
  }
  return { ok: true, document: reparsed.value, issues: [] };
}
