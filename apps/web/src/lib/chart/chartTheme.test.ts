import { describe, expect, it } from "vitest";

import {
  CATEGORICAL_COLORS,
  EXPENSE_COLOR,
  HEAT_COLORS,
  INCOME_COLOR,
  TRANSFER_COLOR,
  categoricalColor,
  heatColor,
} from "./theme.js";

/**
 * S16-B0: chart colours are CSS variables now, not literals. The tests guard the
 * contract that matters to a chart: every slot exists, wrapping is safe, and the
 * semantic financial roles are not the categorical ramp's first slot.
 */
describe("chart colour tokens", () => {
  it("uses token variables for every categorical slot and heat step", () => {
    expect(CATEGORICAL_COLORS).toHaveLength(8);
    for (const [index, color] of CATEGORICAL_COLORS.entries()) {
      expect(color).toBe(`var(--color-chart-${String(index + 1)})`);
    }

    expect(HEAT_COLORS).toEqual([
      "var(--color-chart-heat-0)",
      "var(--color-chart-heat-1)",
      "var(--color-chart-heat-2)",
      "var(--color-chart-heat-3)",
      "var(--color-chart-heat-4)",
    ]);
  });

  it("wraps negative and oversized indices instead of returning undefined", () => {
    expect(categoricalColor(0)).toBe("var(--color-chart-1)");
    expect(categoricalColor(8)).toBe("var(--color-chart-1)");
    expect(categoricalColor(-1)).toBe("var(--color-chart-8)");
    expect(heatColor(-3)).toBe("var(--color-chart-heat-0)");
    expect(heatColor(99)).toBe("var(--color-chart-heat-4)");
  });

  it("keeps financial semantics separate from the categorical palette", () => {
    expect(EXPENSE_COLOR).toBe("var(--color-data-expense)");
    expect(INCOME_COLOR).toBe("var(--color-data-income)");
    expect(TRANSFER_COLOR).toBe("var(--color-data-transfer)");
    expect(CATEGORICAL_COLORS).not.toContain(EXPENSE_COLOR);
    expect(CATEGORICAL_COLORS).not.toContain(INCOME_COLOR);
  });
});
