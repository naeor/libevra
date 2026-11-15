/** 页面层级与动效语义分别判断；对象展开还必须有有效来源几何。 */
export type NavigationLevel = "tabRoot" | "enterMode" | "subpage";
const tabs = new Set(["/", "/stats", "/ledger", "/me"]);
const modes = new Set(["/paste", "/record", "/add", "/scan", "/import"]);
export function navigationLevel(pathname: string): NavigationLevel {
  return tabs.has(pathname) ? "tabRoot" : modes.has(pathname) ? "enterMode" : "subpage";
}

/**
 * **常驻底栏在哪些层级显示——全站唯一的判断（1.19.75，审查 T1）。** 主 Tab 显示、次级页面隐藏；记账工作区（enterMode）
 * 1.19.78 起看 `workspaceChrome`：S19 四风格手机端是独立工作区（所有者 2026-11-14：隐藏完整的五项底栏、顶部换成工作区顶栏，
 * 离开时恢复），底栏隐藏；Original仍显示底栏，与原来相同。
 * 调用方用 `useS19WorkspaceChrome()`（lib/useRootVisualStyle.ts）取得 `workspaceChrome`。
 *
 * 手机外壳的常驻底栏（components/Layouts.tsx 的 PaneShell）、记账页为底栏留的尾部空间（MobileInnerPage）都只问这里；
 * 底栏的“向下退出 / 从下方升回”动画（s19/motion/navMotion.ts、B2 的 View Transition 规则在 pilot.css）按“前后两页的
 * 结果是否不同”触发，不认具体层级。所以改这一个函数（例如让记账工作区也隐藏底栏），主 Tab ↔ 记账工作区之间就自动
 * 播放同一套退出 / 升回，不需要改别处。
 */
export function navVisibleAt(level: NavigationLevel, workspaceChrome = false): boolean {
  return level === "tabRoot" || (level === "enterMode" && !workspaceChrome);
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
 *
 * 1.19.75（审查 T6）：账本空间只排除 `/start` 本身。原来的 `/^\/start(\/|$)/` 把账本空间齿轮面板里的「成员」「分享」
 * （`/start/book/:id/members|share`，普通次级页面，没有自带动效）也一起排除了，进出都直接切换。
 */
const OWN_MOTION = [/^\/start$/, /^\/(login|register|recover|recover-archive|guest)$/, /^\/workspace\//];
export function hasDefaultMotion(pathname: string): boolean {
  return !OWN_MOTION.some(rule => rule.test(pathname));
}

/** 账本空间自己的子页面（成员、分享）：从账本空间进出它们走默认次级导航；进出账本空间本身仍是海浪（tide.ts）。 */
const SPACE = "/start";
function spaceChild(from: string, to: string): boolean {
  return from === SPACE && to.startsWith(`${SPACE}/`);
}

/** 两页之间可以播放默认次级导航：两端都没有自带动效，或者是账本空间与它自己的子页面。 */
export function defaultMotionBetween(a: string, b: string): boolean {
  return (hasDefaultMotion(a) && hasDefaultMotion(b)) || spaceChild(a, b) || spaceChild(b, a);
}

/**
 * 默认次级导航（新页从右侧覆盖）：从任一主层级页面或次级页面 PUSH 进入另一个次级页面。
 * 只看真实的入栈方向与目标层级，不把同前缀 URL 当父子关系；返回只回放已经发生过的那一条边。
 * 对象展开、记账模式与主 Tab 交换在协调器里先行判定，不进入这里。
 */
export function isDefaultMotionEdge(from: string, to: string): boolean {
  // 账本空间只作为起点：进入它自己始终是海浪（或深链兜底的即时切换），不会被当成一条默认覆盖边。
  return from !== to && navigationLevel(to) === "subpage" && ((hasDefaultMotion(from) && hasDefaultMotion(to)) || spaceChild(from, to));
}

/**
 * 从次级页面前往主 Tab（PUSH / REPLACE，1.19.75，审查 T4）：分析卡片「查看明细」、保存 / 删除后回明细的兜底、
 * 账目详情没有来源时回明细、深链的返回兜底……落点不变，按返回方向播放（次级页向右退出、主 Tab 从后面回来）。
 * 记账工作区、账本空间与登录等自带动效的页面在协调器里先行判定，不进入这里。
 */
export function isReturnToTab(from: string, to: string): boolean {
  return navigationLevel(to) === "tabRoot" && navigationLevel(from) === "subpage" && defaultMotionBetween(from, to);
}

