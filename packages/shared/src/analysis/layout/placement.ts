/** D 的交互落位规划：固定目标矩形，优先交换，按原阅读顺序局部顺延。纯函数、不缩放、不改内容。 */
import type { LayoutGeometry, LayoutValidationIssue, ObjectGeometry } from "./types.js";
import { placementCells, placementFitsColumns, validateGeometry } from "./grid.js";

export type PlacementPlan =
  | { readonly ok: true; readonly geometry: LayoutGeometry; readonly affectedIds: readonly string[] }
  | { readonly ok: false; readonly issues: readonly LayoutValidationIssue[] };

/** candidate 可以是新对象，也可以是已有对象的新锚点。数组顺序保持，阅读顺序按锚点稳定排序。 */
export function planSmartPlacement(geometry: LayoutGeometry, candidate: ObjectGeometry): PlacementPlan {
  const columns = geometry.baseCols;
  const invalid = validateGeometry([candidate], columns);
  if (invalid.length > 0) return { ok: false, issues: invalid };
  const original = geometry.objects.find((item) => item.objectId === candidate.objectId);
  const others = geometry.objects.filter((item) => item.objectId !== candidate.objectId);
  const reserved = new Set(placementCells(candidate.anchor, candidate, columns));
  const collisions = others.filter((item) => placementCells(item.anchor, item, columns).some((cell) => reserved.has(cell)));
  let placed = others;
  const target = collisions[0];
  if (original !== undefined && collisions.length === 1 && target !== undefined &&
      target.anchor === candidate.anchor && target.colSpan === candidate.colSpan && target.rowSpan === candidate.rowSpan) {
    placed = others.map((item) => item.objectId === target.objectId ? { ...item, anchor: original.anchor } : item);
  } else if (collisions.length > 0) {
    const ordered = [...others].sort((a, b) => a.anchor - b.anchor);
    const collisionIds = new Set(collisions.map((item) => item.objectId));
    const first = ordered.findIndex((item) => collisionIds.has(item.objectId));
    const occupied = new Set(reserved);
    const replacements = new Map<string, ObjectGeometry>();
    let cursor = 1;
    for (let index = 0; index < ordered.length; index += 1) {
      const item = ordered[index]!;
      let anchor = item.anchor;
      if (index >= first) {
        anchor = Math.max(anchor, cursor);
        // 当前占格有限，合法宽度保证后面的空行终有位置；不改变对象尺寸。
        while (!placementFitsColumns(anchor, item, columns) ||
          placementCells(anchor, item, columns).some((cell) => occupied.has(cell))) anchor += 1;
        cursor = anchor + 1;
      }
      for (const cell of placementCells(anchor, item, columns)) occupied.add(cell);
      replacements.set(item.objectId, anchor === item.anchor ? item : { ...item, anchor });
    }
    placed = others.map((item) => replacements.get(item.objectId)!);
  }
  const byId = new Map(placed.map((item) => [item.objectId, item] as const));
  const objects = original === undefined
    ? [...placed, candidate]
    : geometry.objects.map((item) => item.objectId === candidate.objectId ? candidate : byId.get(item.objectId)!);
  const issues = validateGeometry(objects, columns);
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    geometry: { ...geometry, objects },
    affectedIds: objects.filter((item) => geometry.objects.find((old) => old.objectId === item.objectId)?.anchor !== item.anchor).map((item) => item.objectId),
  };
}
