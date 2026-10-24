/**
 * Colours and markers for charts.
 *
 * Two rules, both from the accessibility requirement:
 *  * **the palette is low-saturation**, matching the rest of the application —
 *    these are family accounts, not a trading terminal
 *  * **colour is never the only signal** — every series also gets a marker
 *    shape, so a legend and a chart stay readable for someone who cannot
 *    separate the hues, or is looking at a washed-out screen in daylight.
 *
 * Charts now read the same CSS variables as the rest of the app (S16-B0), so a
 * future dark theme can supply its own ramp without touching this module. The
 * exports are CSS `var(--…)` strings; SVG accepts them directly. Tests must use
 * `var(--color-chart-…)` in expectations, not a resolved hex.
 *
 * Financial data colours are a separate axis from the categorical palette:
 * expense and income have stable meanings regardless of the user's accent
 * palette. They point at `--color-data-*`, not `--color-chart-*`.
 */

/** Eight categorical hues, kept low-saturation and distinct in both hue and lightness. */
export const CATEGORICAL_COLORS: readonly string[] = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-chart-6)",
  "var(--color-chart-7)",
  "var(--color-chart-8)",
];

export function categoricalColor(index: number): string {
  const size = CATEGORICAL_COLORS.length;
  // Negative indices are a caller bug, but wrapping is friendlier than
  // undefined and keeps a chart drawing instead of vanishing.
  const safe = ((index % size) + size) % size;

  return CATEGORICAL_COLORS[safe] ?? CATEGORICAL_COLORS[0]!;
}

/**
 * Heat ramp for the calendar, lightest first.
 *
 * Index 0 means "nothing recorded" and is a neutral grey rather than the
 * lightest green — an empty day and a very cheap day are different facts and
 * should not look the same.
 *
 * This is a **ramp**: five steps of one hue, chosen so adjacent steps stay
 * distinguishable. It is not "several greens that happen to differ", and it must
 * not be collapsed into one token.
 */
export const HEAT_COLORS: readonly string[] = [
  "var(--color-chart-heat-0)",
  "var(--color-chart-heat-1)",
  "var(--color-chart-heat-2)",
  "var(--color-chart-heat-3)",
  "var(--color-chart-heat-4)",
];

export function heatColor(level: number): string {
  const clamped = Math.min(Math.max(Math.trunc(level), 0), HEAT_COLORS.length - 1);

  return HEAT_COLORS[clamped] ?? HEAT_COLORS[0]!;
}

/** Financial-meaning colours; these do not follow the accent palette. */
export const EXPENSE_COLOR = "var(--color-data-expense)";
export const INCOME_COLOR = "var(--color-data-income)";
export const TRANSFER_COLOR = "var(--color-data-transfer)";

export type MarkerShape = "circle" | "square" | "triangle" | "diamond";

const MARKER_SHAPES: readonly MarkerShape[] = ["circle", "square", "triangle", "diamond"];

export function markerShape(index: number): MarkerShape {
  const size = MARKER_SHAPES.length;
  const safe = ((index % size) + size) % size;

  return MARKER_SHAPES[safe] ?? "circle";
}

/**
 * Points of a marker shape, centred on the origin at a given radius.
 *
 * A circle is drawn with `<circle>`; the rest are polygons whose points come
 * from here, so a legend and a chart marker are guaranteed to match.
 */
export function markerPoints(shape: MarkerShape, radius: number): string {
  switch (shape) {
    case "square":
      return [
        [-radius, -radius],
        [radius, -radius],
        [radius, radius],
        [-radius, radius],
      ]
        .map(([x, y]) => `${String(x)},${String(y)}`)
        .join(" ");

    case "triangle":
      return [
        [0, -radius * 1.15],
        [radius, radius * 0.85],
        [-radius, radius * 0.85],
      ]
        .map(([x, y]) => `${String(x)},${String(y)}`)
        .join(" ");

    case "diamond":
      return [
        [0, -radius * 1.2],
        [radius * 1.2, 0],
        [0, radius * 1.2],
        [-radius * 1.2, 0],
      ]
        .map(([x, y]) => `${String(x)},${String(y)}`)
        .join(" ");

    case "circle":
    default:
      return "";
  }
}
