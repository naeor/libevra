/**
 * A-1 — chart input protocols.
 *
 * These modules turn exact analysis results into the input a visual card
 * receives. They never draw and never re-aggregate: labels and authoritative
 * amounts come straight from the result, while drawing fractions are derived
 * from exact minor units and are the only numbers a visual layer may use for
 * geometry (owner specification §4.2, ACC-05).
 */

export * from "./numericCard.js";
export * from "./composition.js";
export * from "./ranking.js";
