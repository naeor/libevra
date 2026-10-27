/**
 * 默认工作台（布局规格 §9「日常总览」）与对象 ID。
 *
 * ⚠️ **第一次打开分析页不需要任何配置**（总需求规格 §7）：没有保存过布局的账号直接看到这一套。
 * 默认模板只是「内容文档 + 布局文档」两份普通数据，交给 Agent D 的校验器检查；用户编辑后保存的是
 * 自己的副本，「恢复默认」不会覆盖除工作台以外的任何设置。
 */
import type {
  AnalysisCardNode,
  CarouselNode,
  LayoutDocumentV1,
  ObjectGeometry,
  WorkbenchContentDocumentV1,
} from "@libellum/shared/analysis/layout";

import { cardType, type ChartFamily } from "./catalog.js";

/**
 * 新对象的稳定 ID。用 `getRandomValues` 而不是 `randomUUID`：后者只在安全上下文存在，局域网
 * http 调试时会是 `undefined`（vite.config.ts 里记录过同一个坑）。
 */
export function newObjectId(prefix: "card" | "box" | "gap"): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return `${prefix}-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** 某种分析的一张新卡片（默认展示方式、跟随顶部筛选、预置标题）。 */
export function newCard(analysisId: string, objectId: string = newObjectId("card")): AnalysisCardNode {
  const type = cardType(analysisId);
  const family: ChartFamily = type?.families[0] ?? "number";
  return {
    objectId,
    type: "analysis-card",
    analysis: { analysisId, params: {} },
    chart: { chartFamily: family },
    title: { kind: "preset" },
    rangePolicy: "inherit",
  };
}

function place(objectId: string, objectType: ObjectGeometry["objectType"], anchor: number, colSpan: number, rowSpan: number): ObjectGeometry {
  return { objectId, objectType, anchor, colSpan, rowSpan };
}

/**
 * 「日常总览」：先看收入、支出、差额，再看趋势与构成，最后是一个滑动卡片组（演示容器：
 * 同一位置左右切换三张极值卡）、上期比较与日历热力。两列、行优先编号。
 */
export function defaultWorkbench(): { readonly content: WorkbenchContentDocumentV1; readonly layout: LayoutDocumentV1 } {
  const cards: AnalysisCardNode[] = [
    newCard("AN-B01", "default-b01"),
    newCard("AN-B02", "default-b02"),
    newCard("AN-B03", "default-b03"),
    newCard("AN-B06", "default-b06"),
    newCard("AN-I11", "default-i11"),
    newCard("AN-I01", "default-i01"),
    newCard("AN-B09", "default-b09"),
    newCard("AN-B11", "default-b11"),
    newCard("AN-B15", "default-b15"),
    newCard("AN-A01", "default-a01"),
    newCard("AN-I12", "default-i12"),
  ];
  const carousel: CarouselNode = {
    objectId: "default-extremes",
    type: "carousel",
    children: ["default-b09", "default-b11", "default-b15"],
  };
  return {
    content: { schemaVersion: 1, cards, containers: [carousel] },
    layout: {
      schemaVersion: 1,
      layoutAlgorithmVersion: 1,
      mode: "unified",
      main: {
        baseCols: 2,
        objects: [
          place("default-b01", "analysis-card", 1, 1, 1),
          place("default-b02", "analysis-card", 2, 1, 1),
          place("default-b03", "analysis-card", 3, 1, 1),
          place("default-b06", "analysis-card", 4, 1, 1),
          place("default-i11", "analysis-card", 5, 2, 2),
          place("default-i01", "analysis-card", 9, 2, 3),
          place("default-extremes", "carousel", 15, 2, 1),
          place("default-a01", "analysis-card", 17, 2, 2),
          place("default-i12", "analysis-card", 21, 2, 3),
        ],
      },
    },
  };
}
