import { describe, expect, it } from "vitest";

import {
  compareRatio,
  formatMinorExact,
  ratioOf,
  ratioToDecimalText,
  ratioToNumber,
  ratioToPercentText,
} from "./rational.js";

describe("ratioOf", () => {
  it("reduces a fraction", () => {
    expect(ratioOf(6n, 4n)).toEqual({ numerator: 3n, denominator: 2n });
  });

  it("keeps the sign in the numerator", () => {
    expect(ratioOf(-6n, 4n)).toEqual({ numerator: -3n, denominator: 2n });
    expect(ratioOf(1n, -2n)).toEqual({ numerator: -1n, denominator: 2n });
    expect(ratioOf(-1n, -2n)).toEqual({ numerator: 1n, denominator: 2n });
  });

  it("reduces zero to 0/1", () => {
    expect(ratioOf(0n, 5n)).toEqual({ numerator: 0n, denominator: 1n });
  });

  it("returns null for a zero denominator instead of zero", () => {
    expect(ratioOf(1n, 0n)).toBeNull();
    expect(ratioOf(0n, 0n)).toBeNull();
  });
});

describe("compareRatio", () => {
  it("orders exact fractions without floating point", () => {
    const oneThird = ratioOf(1n, 3n);
    const twoFifths = ratioOf(2n, 5n);

    expect(oneThird).not.toBeNull();
    expect(twoFifths).not.toBeNull();
    if (oneThird === null || twoFifths === null) return;

    expect(compareRatio(oneThird, twoFifths)).toBe(-1);
    expect(compareRatio(twoFifths, oneThird)).toBe(1);
  });

  it("treats unreduced equal fractions as equal", () => {
    const half = ratioOf(1n, 2n);
    const twoQuarters = ratioOf(2n, 4n);

    if (half === null || twoQuarters === null) throw new Error("unexpected_null");

    expect(compareRatio(half, twoQuarters)).toBe(0);
  });

  it("orders negative fractions", () => {
    const minusHalf = ratioOf(-1n, 2n);
    const minusThird = ratioOf(-1n, 3n);

    if (minusHalf === null || minusThird === null) throw new Error("unexpected_null");

    expect(compareRatio(minusHalf, minusThird)).toBe(-1);
  });
});

describe("ratioToNumber", () => {
  it("is a display helper", () => {
    const third = ratioOf(1n, 3n);

    if (third === null) throw new Error("unexpected_null");

    expect(ratioToNumber(third)).toBeCloseTo(1 / 3, 12);
  });
});

describe("ratioToDecimalText", () => {
  it("rounds half away from zero once", () => {
    const half = ratioOf(1n, 2n);
    const threeQuarters = ratioOf(3n, 4n);

    if (half === null || threeQuarters === null) throw new Error("unexpected_null");

    expect(ratioToDecimalText(half, 0)).toBe("1");
    expect(ratioToDecimalText(threeQuarters, 1)).toBe("0.8");
  });

  it("rounds negative values away from zero", () => {
    const minusTwoThirds = ratioOf(-2n, 3n);

    if (minusTwoThirds === null) throw new Error("unexpected_null");

    expect(ratioToDecimalText(minusTwoThirds, 2)).toBe("-0.67");
    expect(ratioToDecimalText(minusTwoThirds, 0)).toBe("-1");
  });

  it("keeps small values exact", () => {
    const oneQuarter = ratioOf(1n, 4n);

    if (oneQuarter === null) throw new Error("unexpected_null");

    expect(ratioToDecimalText(oneQuarter, 2)).toBe("0.25");
    expect(ratioToDecimalText(oneQuarter, 3)).toBe("0.250");
  });

  it("rejects an invalid digit count", () => {
    const one = ratioOf(1n, 1n);

    if (one === null) throw new Error("unexpected_null");

    expect(() => ratioToDecimalText(one, -1)).toThrow(RangeError);
    expect(() => ratioToDecimalText(one, 1.5)).toThrow(RangeError);
  });
});

describe("ratioToPercentText", () => {
  it("renders a rounded percentage label", () => {
    const third = ratioOf(1n, 3n);
    const half = ratioOf(1n, 2n);

    if (third === null || half === null) throw new Error("unexpected_null");

    expect(ratioToPercentText(third)).toBe("33.3%");
    expect(ratioToPercentText(half, 0)).toBe("50%");
  });

  it("allows more than one hundred percent", () => {
    const two = ratioOf(2n, 1n);

    if (two === null) throw new Error("unexpected_null");

    expect(ratioToPercentText(two)).toBe("200.0%");
  });

  it("renders negative and zero percentages", () => {
    const minusQuarter = ratioOf(-1n, 4n);
    const zero = ratioOf(0n, 7n);

    if (minusQuarter === null || zero === null) throw new Error("unexpected_null");

    expect(ratioToPercentText(minusQuarter)).toBe("-25.0%");
    expect(ratioToPercentText(zero)).toBe("0.0%");
  });
});

describe("formatMinorExact", () => {
  it("formats a positive amount with the currency scale", () => {
    expect(formatMinorExact(12_345n, 2)).toBe("123.45");
    expect(formatMinorExact(1_000n, 2)).toBe("10.00");
    expect(formatMinorExact(1n, 2)).toBe("0.01");
    expect(formatMinorExact(0n, 2)).toBe("0.00");
  });

  it("formats zero-decimal currencies", () => {
    expect(formatMinorExact(1_000n, 0)).toBe("1000");
  });

  it("formats negative amounts", () => {
    expect(formatMinorExact(-12_345n, 2)).toBe("-123.45");
    expect(formatMinorExact(-1n, 2)).toBe("-0.01");
  });

  it("stays exact above Number.MAX_SAFE_INTEGER", () => {
    expect(formatMinorExact(9_007_199_254_740_997n, 2)).toBe("90071992547409.97");
  });

  it("rejects an invalid scale", () => {
    expect(() => formatMinorExact(1n, -1)).toThrow(RangeError);
  });
});
