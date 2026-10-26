/**
 * S-01 draft — the analysis protocol and its calculation primitives.
 *
 * `types.ts`   — analysis definition, result envelope, four result shapes.
 * `rational.ts`— exact fractions and exact minor-unit formatting.
 * `primitives.ts` — pure grouping/summing over already-authorised records.
 *
 * Fixtures (`fixtures.ts`) deliberately stay out of this barrel: test samples
 * must never be part of the app bundle.
 */

export * from "./types.js";
export * from "./rational.js";
export * from "./primitives.js";
