import { restoreThemeBeforePaint } from "./lib/theme.js";
import { applyVisualStyle, readVisualAppearance } from "./lib/visualStyle.js";

let storage: Storage | null = null;
try { storage = window.localStorage; } catch { /* 不可用时沿用默认浅色。 */ }
const root = document.documentElement;
restoreThemeBeforePaint(root, storage, window.matchMedia("(prefers-color-scheme: dark)").matches);
if (root.dataset.themeMode === "dark") {
  const appearance = readVisualAppearance(storage);
  applyVisualStyle(root, appearance.style);
  root.dataset.wallpaper = appearance.wallpaper;
}
