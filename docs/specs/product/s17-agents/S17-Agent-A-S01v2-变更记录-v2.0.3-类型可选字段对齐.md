# S17-Agent-A · S-01 v2 变更记录 v2.0.3 —— `ComputationMetadata` 协议可选字段类型对齐（Additive）

- 状态：**冻结后澄清（additive 类型补齐；不新增契约、不改字段语义、不改 JSON 透传行为）**
- 日期：2026-10-27（Asia/Shanghai）
- 依据：协议 §2 冻结口径（`computation` 行：`method?`/`sampling?`/`coverageEnd?`/`analysisLimit?`）、`s01-v2` 冻结基线（r7.2 + G-12a v1.1，冻结记录 `2b6a869`/`0aee9d8`）、Lead m04374（批准本次 additive 对齐）
- 范围：`packages/shared/src/analysis/types.ts` 类型声明 + `packages/shared/src/analysis/context.test.ts` 类型测试 + 本记录；**不改冻结件 v2 §2/§3/§16.5 文本、不改任何既有字段/结构/枚举、不 push**

## 1. 背景与结论

协议 §2 已冻结 `computation` 的四个可选扩展位：`method?`、`sampling?`、`coverageEnd?`、`analysisLimit?`（登记于 `s01-v2`）。A 的实现类型 `ComputationMetadata`（`packages/shared/src/analysis/types.ts`）此前只声明了实现自用字段（`rounding`/`numeratorMinor?`/`denominator?`/`denominatorDays?`/`sampleCount?`/`tieCount?`/`convertedWithFx?`/`fxPolicy?`/`notes?`），未声明这四个协议字段。

本次为 **additive 类型对齐**：

- 在 `ComputationMetadata` 上**只新增可选字段**（`?:`），不改任何既有字段的名称、类型、必填性或语义；
- 新增两个辅助接口 `SamplingMetadata`、`AnalysisLimitMetadata`，为可选字段提供结构化形状与语义注释；
- 序列化/反序列化行为不变：字段缺省时不输出键、存在时原样透传，不做任何转换或重算。

结论：这不是新增契约，而是把已冻结的协议字段在 A 类型中补齐，消除「协议已登记、实现类型未声明」的不一致。

## 2. 变更内容（`packages/shared/src/analysis/types.ts`）

### 2.1 新增辅助接口

```ts
export interface SamplingMetadata {
  readonly strategy?: string | undefined;
  readonly omittedCount?: number | undefined;
  readonly isVisualOnly: true;
}

export interface AnalysisLimitMetadata {
  readonly limit: string;
  readonly value: number;
  readonly requested?: number | undefined;
}
```

### 2.2 `ComputationMetadata` 新增字段

```ts
export interface ComputationMetadata {
  // ……既有字段不变……
  readonly method?: string | undefined;
  readonly sampling?: SamplingMetadata | undefined;
  readonly coverageEnd?: string | undefined;
  readonly analysisLimit?: AnalysisLimitMetadata | undefined;
}
```

## 3. 语义口径（逐字段）

| 字段 | 类型 | 语义与约束 | 依据 |
|---|---|---|---|
| `method?` | `string` | 派生统计的算法名（开放字符串）。已登记值必须逐字使用冻结值（`quantile-type7`/`population-stddev`/`sample-cv-fixedpoint` 等，见 v2.0.1 裁定）；未登记值原样透传、不重算、不宣称已支持 | 协议 §2；v2.0.1 记录 |
| `sampling?` | `SamplingMetadata` | **仅视觉层**采样标注，不可回算；`isVisualOnly: true` 恒为真以标记该语义。权威采样字段在结果层（`strategy`/`omittedCount`/`sampleCount`/`complete`），本字段不得覆盖或与之冲突 | 协议 §2（XC-08/XC-35） |
| `coverageEnd?` | `string` | 离线数据覆盖终点，业务日期 `YYYY-MM-DD`；用于与 `dataVersion`、`unknown→offline-incomplete` 配合解释覆盖不足 | 协议 §2；G-10 |
| `analysisLimit?` | `AnalysisLimitMetadata` | 触发/约束本次分析的上限（如 `maxAnalysisDays`/`maxMonths`/C 的 `MAX_*`），用于可追溯的截断说明；`requested` 为被请求但超限的值（未知时可省略） | 协议 §2；G-18/XC-09 |

说明：

- `SamplingMetadata`/`AnalysisLimitMetadata` 的**内层键名**属 A 实现细节；协议要求是「可承载对应语义」（视觉采样标注 / 上限可追溯），不是新增命名合法性约束。
- 四个字段全部可选：不携带时 `computation` 仍为合法对象（`{ rounding }` 最小形状）。

## 4. 为什么不是新增契约

- 协议 §2 的 `computation` 行在 `s01-v2` 冻结时**已经登记**这四个可选字段（含 `method` 取值口径引用 v2.0.1、`sampling` 仅视觉层、`coverageEnd`/`analysisLimit` 可追溯）；
- 冻结信封字段清单（§2 表后）也明确写 `computation{rounding, method?, sampling?, coverageEnd?, analysisLimit?}`；
- 本次只改 A 侧**类型声明**与注释，使其与已冻结文本一致；未改协议文本、未改任何共享结构或枚举。

## 5. 兼容性与序列化（不变）

- 既有 `computationOf({...})` 调用无需修改；不传新字段时输出与之前完全相同；
- `makeBase`/`makeScalar` 等装配函数原样透传 `computation` 对象，不增删键、不做转换；
- `JSON.stringify` 输出只在显式传入对应字段时包含该键，键序按对象字面量顺序（不影响结构）；读取方必须容忍未知可选字段（Open-string 透传原则不变）；
- 旧版 `s01-draft`/`s01-v2-draft` 数据仍按 §16.5 兼容读取。

## 6. 验证（提交前执行）

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `pnpm typecheck`（`tsc -b`：shared/api/web） | exit 0（shared/api/web 均 Done） |
| shared 全量测试 | `pnpm --filter @libellum/shared test` | exit 0，**31 files / 692 tests passed**（原 690 + 新增 2） |
| 链接检查 | `node tools/check-links.mjs` | exit 0（215 份 Markdown / 976 相对链接，无失效） |
| 状态检查 | `node tools/check-status.mjs` | exit 0（路由 75、版本 1.16.23、迁移 60） |

新增测试（`packages/shared/src/analysis/context.test.ts`）：

1. `carries method/sampling/coverageEnd/analysisLimit through the envelope and JSON`：四个字段经 `makeScalar` 信封原样承载，且 `JSON.parse(JSON.stringify(result))` 后逐字段一致（证明透传行为不变）；
2. `keeps the four fields optional so legacy computations stay valid`：不传四字段时 `computation` 仍为 `{ rounding: "minor-half-away-v1" }`，`version === "s01-v2"`。

## 7. 影响文件清单

| 文件 | 变更 |
|---|---|
| `packages/shared/src/analysis/types.ts` | 新增 `SamplingMetadata`、`AnalysisLimitMetadata`；`ComputationMetadata` 增 4 个可选字段 + 注释 |
| `packages/shared/src/analysis/context.test.ts` | 新增 2 条测试（导入 `computationOf`/`makeScalar`） |
| `docs/specs/product/s17-agents/S17-Agent-A-S01v2-结构草案.md` | §16.10 追加 v2.0.3 变更条目（仅变更记录，不改 §2/§3/§16.5） |
| `docs/specs/product/s17-agents/S17-Agent-A-基础与分类分析.md` | §6.2 追加交接记录行 |
| `docs/specs/product/s17-agents/S17-Agent-A-S01v2-信封示例与字段说明-20261027.md` | §6 附注更新：四字段已由 v2.0.3 在类型层补齐 |
| 本文件 | 新增 |

## 8. 冻结记录行（供 Lead 补入 orchestrator 冻结记录 §5；A 只读，不代填）

> **v2.0.3（2026-10-27，additive 类型对齐）**：A 的 `ComputationMetadata` 补齐协议 §2 已冻结的可选字段 `method?`/`sampling?`/`coverageEnd?`/`analysisLimit?` 与辅助接口 `SamplingMetadata`/`AnalysisLimitMetadata`；不新增契约、不改字段语义/序列化/既有结构；验证 typecheck 0、shared 全量测试通过、check-links/check-status 0；提交 `<A 提交号>`（记录文件 `S17-Agent-A-S01v2-变更记录-v2.0.3-类型可选字段对齐.md`）。

## 9. 边界

- 只改本工作区文档与 `packages/shared/src/analysis/**` 类型/测试；不改页面/API/迁移/其他工作区；
- 不 push、不合并、不部署、不改版本号（1.16.23/1.17.x 由 Lead 维护）；
- 不重新定义 A/B/C 已冻结协议：字段语义以 `s01-v2` 冻结文本为准，本记录仅作实现-类型对齐说明。

---

变更记录：v2.0.3（2026-10-27）首个版本，由 A 按 Lead m04374 指令建立。
