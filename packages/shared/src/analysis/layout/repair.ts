/**
 * 布局几何的确定性修复（导入/损坏数据路径；D-3 headless）。
 *
 * 修复顺序**固定**（同输入同输出，便于测试与日志断言）：
 *   1. `invalid-columns`：baseCols 非法（非正整数/超范围）→ 按 2 列解释；
 *   2. `duplicate-object-id`：重复 objectId 只保留首次出现，其余丢弃；
 *   3. `invalid-anchor`：位置编号非正整数 → 标记为未定位（anchor 置 0，投影会重新补位）；
 *   4. `invalid-size`：colSpan/rowSpan 非正整数 → 置 1；
 *   5. `row-span-too-large`：rowSpan 超过 `MAX_ROW_SPAN` → 夹到上限。
 *
 * 修复只用于“读取/导入后构造修复副本”，**不得写回权威布局**；投影本身仍会
 * 再做一次防御性处理（两层都保持确定性）。锚点越界/重叠/同锚点冲突**不在**
 * 修复阶段解决，而是交给投影的单遍优先级贪心（保持 `anchor-occupied` 原因可见）。
 *
 * 与 OQ-LM-12（损坏修复细节）一致：未定细节以本文件导出顺序为暂定口径，待 W2 冻结。
 */

import type {
  LayoutGeometry,
  ObjectGeometry,
} from "./types.js";
import {
  MAX_COLUMNS,
  MAX_ROW_SPAN,
  MIN_COLUMNS,
} from "./types.js";
import { isPositiveInteger } from "./grid.js";

/** 修复代码顺序（文档与测试可依赖该顺序）。 */
export const GEOMETRY_REPAIR_ORDER = [
  "invalid-columns",
  "duplicate-object-id",
  "invalid-anchor",
  "invalid-size",
  "row-span-too-large",
] as const;

export type GeometryRepairCode = (typeof GEOMETRY_REPAIR_ORDER)[number];

export interface GeometryRepair {
  readonly objectId?: string;
  readonly code: GeometryRepairCode;
  readonly detail: string;
}

export interface GeometryRepairResult {
  /** 修复后的几何副本（不修改输入）。 */
  readonly geometry: LayoutGeometry;
  readonly repairs: readonly GeometryRepair[];
}

const DEFAULT_COLUMNS = 2;

function sanitizeColumns(baseCols: number): { readonly columns: number; readonly repaired: boolean } {
  if (!isPositiveInteger(baseCols) || baseCols < MIN_COLUMNS || baseCols > MAX_COLUMNS) {
    return { columns: DEFAULT_COLUMNS, repaired: true };
  }
  return { columns: baseCols, repaired: false };
}

/** 对一份布局几何执行固定顺序的修复，返回修复副本与修复记录。 */
export function repairLayoutGeometry(layout: LayoutGeometry): GeometryRepairResult {
  const repairs: GeometryRepair[] = [];

  const sourceColumns = sanitizeColumns(layout.baseCols);
  if (sourceColumns.repaired) {
    repairs.push({
      code: "invalid-columns",
      detail: `baseCols=${String(layout.baseCols)} 非法，按 ${sourceColumns.columns} 列修复`,
    });
  }

  const seenObjectIds = new Set<string>();
  const objects: ObjectGeometry[] = [];

  for (const object of layout.objects) {
    if (seenObjectIds.has(object.objectId)) {
      repairs.push({
        objectId: object.objectId,
        code: "duplicate-object-id",
        detail: "重复 objectId，保留首次出现，其余丢弃",
      });
      continue;
    }
    seenObjectIds.add(object.objectId);

    let anchor = object.anchor;
    if (!isPositiveInteger(anchor)) {
      anchor = 0;
      repairs.push({
        objectId: object.objectId,
        code: "invalid-anchor",
        detail: "位置编号必须为正整数；标记为未定位，由投影重新补位",
      });
    }

    let colSpan = object.colSpan;
    if (!isPositiveInteger(colSpan)) {
      colSpan = 1;
      repairs.push({
        objectId: object.objectId,
        code: "invalid-size",
        detail: "列跨度必须为正整数；按 1 修复",
      });
    }

    let rowSpan = object.rowSpan;
    if (!isPositiveInteger(rowSpan)) {
      rowSpan = 1;
      repairs.push({
        objectId: object.objectId,
        code: "invalid-size",
        detail: "行跨度必须为正整数；按 1 修复",
      });
    }
    if (rowSpan > MAX_ROW_SPAN) {
      const original = rowSpan;
      rowSpan = MAX_ROW_SPAN;
      repairs.push({
        objectId: object.objectId,
        code: "row-span-too-large",
        detail: `行跨度 ${original} 超过上限 ${MAX_ROW_SPAN}；夹到上限`,
      });
    }

    objects.push({
      ...object,
      anchor,
      colSpan,
      rowSpan,
    });
  }

  return {
    geometry: { baseCols: sourceColumns.columns, objects },
    repairs,
  };
}
