/** 工具面板呈现参数，不参与网格投影或配置持久化。宽高均为所属工作区 CSS px。 */
export type DrawerMode = "narrow" | "medium" | "wide";

export function drawerModeFor(width: number, previous?: DrawerMode): DrawerMode {
  if (previous === "narrow" && width < 436) return "narrow";
  if (previous === "wide" && width >= 684) return "wide";
  if (previous === "medium" && width >= 404 && width < 716) return "medium";
  return width < 420 ? "narrow" : width < 700 ? "medium" : "wide";
}

export function drawerGeometry(width: number, height: number): { width: number; expanded: number; collapsed: number } {
  const expanded = Math.min(Math.max(0, height - 80), Math.max(184, Math.min(448, height * 0.56)));
  // 44px 点击区 + 上下各 4px 内边距 + 上下各 1px 边框，胶囊内外保持同心。
  return { width: Math.max(0, Math.min(440, width - 24)), expanded, collapsed: Math.min(54, expanded) };
}
