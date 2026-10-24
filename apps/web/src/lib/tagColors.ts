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
import type { CSSProperties } from "react";

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

/** 用户数据原色不变；黑/白是任意背景最大对比前景，限深色 CSS 消费。 */
export function tagForeground(color: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return "#ffffff";
  const channels = [1, 3, 5].map(offset => {
    const value = parseInt(color.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  return luminance > Math.sqrt(0.0525) - 0.05 ? "#000000" : "#ffffff";
}

export function tagFillStyle(color: string): CSSProperties {
  return { backgroundColor: color, borderColor: color, "--tag-foreground": tagForeground(color) } as CSSProperties;
}
