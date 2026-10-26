/**
 * S17 工作台布局层（D-0/D-1/D-2 前置/D-3）：布局对象类型、行优先网格几何、跨列投影、
 * 文档校验与序列化、编辑器命令/焦点/状态机、垂直紧凑与确定性修复。
 *
 * 本目录是布局与配置能力的**纯数据与纯函数**内核：
 * - 不做任何财务计算，不读写账务数据；
 * - 不依赖 React/DOM/视口/时钟/随机数；
 * - 投影结果可缓存但绝不写回权威布局。
 *
 * 对外导出在集成批次由 Lead/S-03 评审后接入 `@libellum/shared` 入口，
 * 本批不修改 `packages/shared/src/index.ts`（避免与其它 Agent 冲突）。
 */

export * from "./types.js";
export * from "./grid.js";
export * from "./projection.js";
export * from "./validation.js";
export * from "./commands.js";
export * from "./focus.js";
export * from "./machine.js";
export * from "./compaction.js";
export * from "./repair.js";
