/** 分类关系的公共约束；旧响应缺少 parentId 时等同根节点。 */
export interface CategoryNode { readonly id: string; readonly name: string; readonly parentId?: string | null | undefined; readonly kind: string; readonly isSystem?: boolean | undefined; readonly isArchived?: boolean | undefined; readonly sortOrder?: number | undefined }
export const MAX_CATEGORY_DEPTH = 64;
export function categoryPath<T extends CategoryNode>(nodes: readonly T[], id: string): T[] {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const path: T[] = [], seen = new Set<string>();
  let current = byId.get(id);
  while (current) {
    if (seen.has(current.id) || path.length >= MAX_CATEGORY_DEPTH) throw new RangeError('category_tree_invalid');
    seen.add(current.id); path.push(current); current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path.reverse();
}
export function categoryBranchIds(nodes: readonly CategoryNode[], ids: readonly string[]): string[] {
  const result = new Set(ids), children = new Map<string, string[]>();
  for (const n of nodes) if (n.parentId) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n.id]);
  const pending = [...ids];
  for (let i = 0; i < pending.length; i++) for (const id of children.get(pending[i]!) ?? []) if (!result.has(id)) { result.add(id); pending.push(id); }
  return [...result];
}
export function validateCategoryTree(nodes: readonly CategoryNode[]): void {
  const byId = new Map(nodes.map(n => [n.id, n]));
  if (byId.size !== nodes.length) throw new RangeError('category_tree_invalid');
  const names = new Set<string>();
  for (const n of nodes) {
    if (!n.id || !n.name.trim() || n.name.length > 20 || !["income","expense"].includes(n.kind)) throw new RangeError('category_tree_invalid');
    if (n.parentId) {
      const p = byId.get(n.parentId);
      if (!p || p.kind !== n.kind || p.isSystem || n.isSystem) throw new RangeError('category_tree_invalid');
    }
    categoryPath(nodes, n.id);
    const key = JSON.stringify([n.kind, n.parentId ?? null, n.name]);
    if (names.has(key)) throw new RangeError('category_exists');
    names.add(key);
  }
}
export function categoryTreeRows<T extends CategoryNode>(nodes: readonly T[]): { node: T; depth: number }[] {
  const children = new Map<string | null, T[]>(), ids = new Set(nodes.map(n => n.id));
  for (const n of nodes) { const parent = n.parentId && ids.has(n.parentId) ? n.parentId : null; children.set(parent, [...(children.get(parent) ?? []), n]); }
  for (const list of children.values()) list.sort((a,b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id.localeCompare(b.id));
  const result: {node:T;depth:number}[] = [], stack = [...(children.get(null) ?? [])].reverse().map(node=>({node,depth:0}));
  const seen = new Set<string>();
  while(stack.length) { const row = stack.pop()!; if(seen.has(row.node.id)) continue; seen.add(row.node.id); result.push(row); for(const node of [...(children.get(row.node.id) ?? [])].reverse()) stack.push({node,depth:row.depth+1}); }
  return result;
}
