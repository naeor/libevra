/** 仅用于当前账本的阅读页；账本内对象标识不能沿用到另一本账。 */
export function currentLedgerDestination(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  for (const key of ["book", "categoryId", "categoryScope", "f.categories", "f.branches", "f.tags", "f.payments", "category", "categoryBranch", "payment", "tag", "card", "cardId"]) params.delete(key);
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}`;
}
