/**
 * The palette offered for user tags.
 *
 * ⚠️ **These stay literals, and they are not the chart palette.** A tag colour
 * is saved in the database as `#RRGGBB` (`packages/shared/src/ledger.ts`'s
 * `tagColorSchema`), so it must be a value, not `var(--color-chart-1)` — the API
 * and older clients cannot store a CSS variable. Charts, meanwhile, are drawn
 * from `--color-chart-*` tokens so a dark theme can supply its own ramp.
 *
 * The two lists intentionally start from similar low-saturation hues, but they
 * are different responsibilities: one is user-owned data that must never change
 * under a theme; the other is a visual encoding. Coupling them would mean a
 * palette change silently rewrites the meaning of existing tags.
 */
export const TAG_COLORS: readonly string[] = [
  "#3f7a5f",
  "#4a7fb5",
  "#c08a3e",
  "#b8574f",
  "#7a6bb0",
  "#5d8c8c",
  "#8a8f5c",
  "#a86f9a",
];

/** A new tag starts on the first swatch; that is a product choice, not a token. */
export const DEFAULT_TAG_COLOR = TAG_COLORS[0] as string;
