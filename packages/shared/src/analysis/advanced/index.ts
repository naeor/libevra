/**
 * Agent C · C-1 草案数学权威层（`@libellum/shared` 内部路径）。
 *
 * 只被 Agent C 自己的代码与测试引用；**未冻结、不得被其他 Agent 依赖**。
 * 正式结果协议以 Agent A 的 S-01 v2 为准；S-01 v2 定稿后本目录的「权威计算」
 * 函数会保留，结果形状会重映射到正式协议。
 *
 * 放置理由（owner 规格 §2 / Lead 2026-10-27）：数学与金额权威在 shared，
 * 几何/绘图在 web；web 层不得重算金额、占比、分位与归因。
 */

export * from "./draftTypes.js";
export * from "./rational.js";
export * from "./quantiles.js";
export * from "./distribution.js";
export * from "./contribution.js";
export * from "./matrix.js";
export * from "./ranking.js";
export * from "./migration.js";
export * from "./scatter.js";
export * from "./bubble.js";
export * from "./dimensions.js";
export * from "./boxplot.js";
export * from "./pivot.js";
export * from "./smallMultiples.js";
export * from "./calendar.js";
export * from "./crossCube.js";
export * from "./hierarchy.js";
export * from "./sankey.js";
export * from "./currencyComposition.js";
export * from "./fxDiagnostics.js";
