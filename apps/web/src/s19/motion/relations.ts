import { BackdropStore, type BackdropContext, type VisualScope } from "./backdrop.js";
import type { AmbientLayout } from "./ambientLayout.js";
import type { ObjectSource } from "./objectExpand.js";
import { onContinuityReset } from "../../lib/continuity.js";

export interface ScrollPoint { documentY: number; inner: number[] }
export interface ObjectEntry { source: ObjectSource; sourceKey: string }

/**
 * **一条工作区历史上的转场关系**（1.19.75，审查 T2）：每条记录是从哪一页进来的（默认次级导航）、哪张卡片展开成了它
 * （对象展开）、从哪一页进入的记账工作区，以及离开时的滚动位置。
 *
 * 这些都是历史事实，跟着历史走，不跟着外观走。原来它们是协调器实例自己的变量：改风格时协调器整个重建（风格是它的
 * effect 依赖），改明暗 / 配色时 MutationObserver 把它们全部清空，作用域里也带着风格名——改完外观再返回，当前页和它
 * 下面每一页的来源都没了，返回一路直接切换。现在按工作区历史保存在这里，协调器重建时接着用同一份；只有换账号、换账本
 * （作用域变了）才重新开始。
 */
export interface MotionRelations {
  readonly scopeKey: string;
  readonly store: BackdropStore;
  readonly objectEntries: Map<string, ObjectEntry>;
  readonly modeEntries: Map<string, string>;
  readonly scrolls: Map<string, ScrollPoint>;
  /** 主 Tab 的最后滚动位置按 Tab 记，点击底栏重新入栈（新 key）回来时也能接上。 */
  readonly tabScrolls: Map<string, ScrollPoint>;
  readonly layouts: Map<string, AmbientLayout>;
}

const byHistory = new WeakMap<object, MotionRelations>();
/**
 * 1.19.82：应用离开屏幕超过 30 分钟（“不连续使用”，lib/continuity.ts）回来时，记住的滚动位置全部重新开始；
 * 来源、对象展开这些返回关系不动（返回仍按原来的方向播放）。
 */
const live = new Set<MotionRelations>();
onContinuityReset(() => { for (const relations of live) { relations.scrolls.clear(); relations.tabScrolls.clear(); } });

/** 取这条历史的关系；作用域（工作区 / 账号 / 账本）变了就换一份新的。`history` 只用作身份。 */
export function motionRelations(history: object, scope: VisualScope): MotionRelations {
  const scopeKey = JSON.stringify(scope);
  const known = byHistory.get(history);
  if (known?.scopeKey === scopeKey) return known;
  const fresh: MotionRelations = {
    scopeKey, store: new BackdropStore(), objectEntries: new Map(), modeEntries: new Map(),
    scrolls: new Map(), tabScrolls: new Map(), layouts: new Map(),
  };
  if (known) live.delete(known);
  byHistory.set(history, fresh);
  live.add(fresh);
  return fresh;
}

/**
 * REPLACE 换出来的新记录接过被替换记录的关系（1.19.75，审查 T3）。个人资料「编辑 / 完成」、账本设置重命名、导入账本换步骤
 * 这类同一页用 replace 改查询参数，以及账本详情 / 设置里「切换账本」（同一个历史位置换成另一本账），之后返回照常播放。
 *
 * - 默认次级导航的来源：任何 REPLACE 都接（`BackdropStore.replace`）；返回时仍要求那条边本身合法。
 * - 对象展开（收回到哪张卡片）与记账工作区（离开到哪一页）：只在同一路径时接——换了页面，原来那张卡片已经不是它的来源。
 */
export function inheritReplace(relations: MotionRelations, from: BackdropContext, key: string, page: string, scope: VisualScope): BackdropContext {
  const next = relations.store.replace(from, key, page, scope);
  // B2 环境描述记的是“这条记录进来之前那一页”的版面，来源没变，跟着接过来。
  const layout = relations.layouts.get(from.entryKey);
  if (layout) relations.layouts.set(key, layout);
  if (from.page === page) {
    const object = relations.objectEntries.get(from.entryKey);
    if (object) relations.objectEntries.set(key, object);
    const mode = relations.modeEntries.get(from.entryKey);
    if (mode !== undefined) relations.modeEntries.set(key, mode);
    // 以被替换记录为来源的记录（前进栈里的页面）改指新记录。
    for (const [entry, value] of relations.objectEntries) if (value.sourceKey === from.entryKey) relations.objectEntries.set(entry, { ...value, sourceKey: key });
    for (const [entry, value] of relations.modeEntries) if (value === from.entryKey) relations.modeEntries.set(entry, key);
  }
  return next;
}
