import { restoreThemeBeforePaint } from "./lib/theme.js";

let storage: Storage | null = null;
try { storage = window.localStorage; } catch { /* 不可用时沿用默认浅色。 */ }
restoreThemeBeforePaint(document.documentElement, storage, window.matchMedia("(prefers-color-scheme: dark)").matches);
