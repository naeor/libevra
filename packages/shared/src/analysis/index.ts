/**
 * S-01 draft — the analysis protocol and its calculation/assembly layers.
 *
 * `types.ts`      — analysis definition, result envelope, four result shapes.
 * `rational.ts`   — exact fractions and exact minor-unit formatting.
 * `primitives.ts` — pure grouping/summing over already-authorised records.
 * `context.ts`    — definition resolution, filtering and result assembly.
 * `analyses/`     — one assembler per owner-specification analysis (B01–B07,
 *                   B15/B16, I01–I05, I17).
 * `charts/`       — chart input protocols (no drawing, no re-calculation).
 *
 * Fixtures (`fixtures.ts`) deliberately stay out of this barrel: test samples
 * must never be part of the app bundle.
 */

export * from "./types.js";
export * from "./rational.js";
export * from "./primitives.js";
export * from "./context.js";
export * from "./analyses/basic.js";
export * from "./analyses/category.js";
export * from "./charts/index.js";
