/**
 * 电脑端键鼠输入的两条通用判断（见项目 skill `libevra-desktop-ui`）。
 *
 * ⚠️ **输入法组字时的 Enter 不是提交。** 用拼音输入时按 Enter 是把字母 / 候选词上屏；自写的
 * `onKeyDown` 若不先排除这一下，会把半截内容发出去或提交。Safari 在上屏那次 Enter 上报
 * `isComposing === false`，但 `keyCode` 是 229，所以两者都要看。
 */
export function isImeComposing(event: { readonly isComposing?: boolean; readonly keyCode?: number }): boolean {
  return event.isComposing === true || event.keyCode === 229;
}

/**
 * 浏览器里「在新标签页打开」的点击：中键，或 Ctrl（macOS 为 ⌘）+ 左键。
 * 用在**行为是导航、但元素不是链接**的地方，让电脑用户照常在新标签页打开。
 */
export function wantsNewTab(event: { readonly button: number; readonly ctrlKey: boolean; readonly metaKey: boolean }): boolean {
  return event.button === 1 || (event.button === 0 && (event.ctrlKey || event.metaKey));
}

/** 新标签页里是一份全新的应用状态（设备当前账本、没有工作区上下文），只用于不依赖这些上下文的路径。 */
export function openInNewTab(path: string): void {
  window.open(path, "_blank", "noopener");
}
