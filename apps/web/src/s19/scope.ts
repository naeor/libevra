/**
 * S19 作用域标记（所有者称“总闸”）：外壳元素上的 `data-s19-scope`。
 *
 * - 通用层：`.lv-shell[data-s19-scope]`，只认标记存在。S19 材质、组件动效、弹层与转场舞台的规则都写在这一层；
 * - 手机专属层：`.lv-shell[data-s19-scope="phone"]`，只放依赖手机底栏结构的规则（底栏、加号、Tab 玻璃与选中指示、
 *   记一笔菜单、底栏上的账本胶囊、底栏让位与软键盘隐藏），以及按视口计算、只在手机外壳运行的转场协调器。
 *
 * 现在只有手机外壳（`data-shell="contents"`）设为 "phone"；Pad 宽屏与电脑版不设，外观不变。
 * 将来 Pad 设为自己的值（例如 "pad"）就自动继承通用层，Pad 的差异写在 `[data-s19-scope="pad"]` 下单独管理。
 * 浅色与风格条件（`data-theme-mode="light"`、`data-visual-style`）不并入标记，规则里照旧各自写。
 * 规格：docs/specs/design/S19-材质组件与动效设计系统.md §1「作用域标记」；守卫见 scope.test.ts。
 */
export type S19Scope = "phone";

const PHONE: S19Scope = "phone";
/** 通用层：任何设了标记的外壳（及转场舞台）。 */
export const S19_SCOPE_SELECTOR = ".lv-shell[data-s19-scope]";
/** 手机专属层。 */
export const S19_PHONE_SELECTOR = `.lv-shell[data-s19-scope="${PHONE}"]`;

/** 外壳布局（WorkspaceShell 的 `data-shell`）→ S19 作用域；返回 undefined 时不写标记（Pad 宽屏）。 */
export function s19ScopeForShell(shell: "contents" | "wide"): S19Scope | undefined {
  return shell === "contents" ? PHONE : undefined;
}

/**
 * 转场舞台挂在 body 上、不在外壳里：写上与手机外壳相同的两个属性，舞台里的页面副本照常命中材质规则。
 * `data-shell` 继续服务外壳布局规则（workspace.css 的 `display: contents`，舞台自己的规则再覆盖为 block）。
 */
export function markS19Stage(stage: HTMLElement): void {
  stage.dataset.shell = "contents";
  stage.dataset.s19Scope = PHONE;
}
