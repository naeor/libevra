/** 页面层级与动效语义分别判断；对象展开还必须有有效来源几何。 */
export type NavigationLevel = "tabRoot" | "enterMode" | "subpage";
const tabs = new Set(["/", "/stats", "/ledger", "/me"]);
const modes = new Set(["/paste", "/record", "/add", "/scan", "/import"]);
export function navigationLevel(pathname: string): NavigationLevel {
  return tabs.has(pathname) ? "tabRoot" : modes.has(pathname) ? "enterMode" : "subpage";
}

/**
 * 记账工作区：五个记账方式页，加上它们自己的识别结果核对页（文本 / 语音核对、批量识别概览）。
 * 从工作区回到主 Tab 是“离开工作区”；工作区内换方式、「再记一笔」是轻切换，不重新升起整个工作区。
 */
const WORKSPACE_STEPS = [/^\/(paste|voice)\/review$/, /^\/ocr\/overview(\/|$)/];
export function inEntryWorkspace(pathname: string): boolean {
  return modes.has(pathname) || WORKSPACE_STEPS.some(rule => rule.test(pathname));
}

/**
 * 挂载时就把焦点交给输入框的记账页（手动记账的金额框 `AmountField autoFocus`）。进入它们的提交必须留在
 * 用户的点击里同步完成：iOS Safari 只在用户手势内的 focus 才弹出键盘，后台提交（transition）会让键盘不再出现。
 */
const FOCUS_ON_ENTRY = new Set(["/add"]);
export function focusesOnEntry(pathname: string): boolean { return FOCUS_ON_ENTRY.has(pathname); }

/** 四个主 Tab 之间是 switchTab（平级横向交换），不是 navigate。 */
export function isTabSwitch(from: string, to: string): boolean {
  return from !== to && tabs.has(from) && tabs.has(to);
}

/**
 * 不使用默认覆盖转场的页面：账本空间（海浪与品牌交接自带出场）、登录/恢复等外壳之外的入口、大屏工作区起始页。
 * 它们保持原有即时切换或自带动效，默认转场不叠加在上面。
 */
const OWN_MOTION = [/^\/start(\/|$)/, /^\/(login|register|recover|recover-archive|guest)$/, /^\/workspace\//];
export function hasDefaultMotion(pathname: string): boolean {
  return !OWN_MOTION.some(rule => rule.test(pathname));
}

/**
 * 默认次级导航（新页从右侧覆盖）：从任一主层级页面或次级页面 PUSH 进入另一个次级页面。
 * 只看真实的入栈方向与目标层级，不把同前缀 URL 当父子关系；返回只回放已经发生过的那一条边。
 * 对象展开、记账模式与主 Tab 交换在协调器里先行判定，不进入这里。
 */
export function isDefaultMotionEdge(from: string, to: string): boolean {
  return from !== to && navigationLevel(to) === "subpage" && hasDefaultMotion(from) && hasDefaultMotion(to);
}

