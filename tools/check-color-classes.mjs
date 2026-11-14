/**
 * 颜色类守卫：源码里用到的 Tailwind 颜色类，颜色名必须来自 `index.css` `@theme` 里定义的 `--color-*` 令牌。
 *
 * ⚠️ **为 BUG-005（1.19.71 修复）而写。** 账本导入页、OCR 核对详情页与异常标记图用了 `text-warning-dark`、
 * `bg-warning/10`、`text-ink-3`——主题里没有 `warning`、`ink-3` 这两个颜色名（只有 `warn*`、`ink`）。
 * Tailwind 4 遇到不认识的类不会报错也不生成任何 CSS，于是警告文字和标签悄悄失去了颜色，构建、类型检查与测试全都通过。
 * 原有的颜色守卫（`colors.test.ts`）只检查写死的颜色值，不检查颜色名是否存在。
 *
 * 检查方法：
 *  1. 从 `apps/web/src/index.css` 收集所有 `--color-<名>:` 定义（`@theme` 与各主题覆盖块里的同名令牌合并成一个集合）；
 *  2. 扫描 `apps/web` 下的 `.ts` / `.tsx` / `.html`（跳过测试文件、`node_modules`、`dist`、`i18n/`），
 *     先去掉注释，再找 `[变体:]前缀-颜色名[/透明度]` 形式的类（前缀：text、bg、border 及各方向、ring、ring-offset、
 *     fill、stroke、outline、divide、from、via、to、shadow、decoration、accent、caret、placeholder、inset-ring、inset-shadow）；
 *  3. 前缀后面如果是 Tailwind 自带的非颜色取值（`text-sm`、`text-left`、`border-dashed`、`shadow-lg`、
 *     `text-helper` 等 `@theme` 里 `--text-*` / `--shadow-*` 定义的字号与阴影令牌……）就跳过；
 *  4. 剩下的当作颜色名：属于令牌、或属于 Tailwind 特殊值（transparent / current / inherit / white / black）就通过，
 *     否则报错并列出文件、行号与类名。
 *  Tailwind 默认色板（`red-500` 这类）目前没有被主题关掉，类本身能生成 CSS，但项目规定颜色一律走语义令牌，所以也算违规。
 *
 * 只检查“前缀 + 字母开头的名字”：数字取值（`border-2`、`ring-offset-2`）、任意值（`bg-[url(...)]`、`text-[11px]`）、
 * CSS 变量写法（`bg-(--x)`）都不是颜色名，不会被误报。CSS 文件里没有 `@apply`，所以不扫 `.css`（里面的 `border-color:` 之类是属性名）。
 *
 * 豁免：`ALLOWLIST`，每一项都要写理由；暂无。
 *
 * 用法：
 *   node tools/check-color-classes.mjs      `pnpm check:build` 在构建之前自动调用；`colorClasses.test.ts` 也调用同一个函数
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 显式豁免：`"相对仓库根的文件路径": ["类名（不含变体与透明度）", …]`，必须写理由。
 * - PeriodComparisonCard 的 `text-caption`：它不是颜色，是一个 `@theme` 里不存在的字号令牌（元素没有该字号，继承父级）。
 *   守卫把它当颜色名误报；它属于字号问题，不在 BUG-005（颜色）范围，已在 BUG 记录里另行登记，修字号时一并去掉这条豁免。
 */
export const ALLOWLIST = {
  "apps/web/src/components/charts/PeriodComparisonCard.tsx": ["text-caption"],
};

/** Tailwind 的特殊颜色值，不需要令牌。 */
const SPECIAL_COLORS = new Set(["transparent", "current", "inherit", "white", "black"]);

/** 跳过的目录名（文件名里带 `.test.` 的也跳过：测试里会断言“不含某个类”）。 */
const SKIP_DIRS = new Set(["node_modules", "dist", "i18n"]);

/** 前缀必须长的在前，`border-t` 要先于 `border`。 */
const PREFIXES = [
  "ring-offset",
  "inset-ring",
  "inset-shadow",
  "border-[xytrblse]",
  "text",
  "bg",
  "border",
  "ring",
  "fill",
  "stroke",
  "outline",
  "divide",
  "from",
  "via",
  "to",
  "shadow",
  "decoration",
  "accent",
  "caret",
  "placeholder",
];

const SIZE = "(?:2xs|xs|sm|md|lg|xl|[2-9]xl)";
/** 各前缀下 Tailwind 自带的“非颜色”取值（整个名字都匹配才算）。 */
const NON_COLOR = {
  text: new RegExp(`^(?:${SIZE}|base|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip|shadow(?:-.*)?|underline-offset.*|align|decoration|overflow|transform|indent)$`),
  bg: /^(?:fixed|local|scroll|top|bottom|left|right|center|(?:top|bottom)-(?:left|right)|(?:left|right)-(?:top|bottom)|repeat(?:-x|-y|-round|-space)?|no-repeat|auto|cover|contain|none|clip-.*|origin-.*|gradient-.*|linear-.*|radial.*|conic.*|blend-.*|size.*|position.*|image.*|attachment|color|repeat)$/,
  border: /^(?:solid|dashed|dotted|double|hidden|none|collapse|separate|spacing.*|style|color|width|radius|box|block|inline|top|bottom|left|right|x|y|t|r|b|l|s|e|[a-z]+-(?:radius|width|color|style|left|right|top|bottom)|[xytrblse]-[0-9]+)$/,
  ring: /^(?:inset|offset-.*)$/,
  "ring-offset": /^$/,
  "inset-ring": /^$/,
  "inset-shadow": new RegExp(`^(?:${SIZE}|none)$`),
  fill: /^(?:none|opacity|rule)$/,
  stroke: /^(?:none|opacity|width|dasharray|dashoffset|linecap|linejoin|miterlimit)$/,
  outline: /^(?:none|hidden|solid|dashed|dotted|double|offset.*|color|style|width)$/,
  divide: /^(?:x|y|solid|dashed|dotted|double|none|reverse|x-reverse|y-reverse)$/,
  from: /^(?:font)$/,
  via: /^$/,
  to: /^$/,
  shadow: new RegExp(`^(?:${SIZE}|none|inner|color)$`),
  decoration: /^(?:solid|double|dotted|dashed|wavy|auto|from-font|clone|slice|none)$/,
  accent: /^(?:auto|color)$/,
  caret: /^(?:color)$/,
  placeholder: /^(?:shown)$/,
};

/** 从 CSS 文本里收集 `--<kind>-<名>:` 定义的名字（`--text-body--line-height` 这类副属性并入 `body`）。 */
function collectTokens(css, kind) {
  const re = new RegExp(`--${kind}-([a-z0-9]+(?:-[a-z0-9]+)*?)(?:--[a-z-]+)?\\s*:`, "g");
  return new Set([...css.matchAll(re)].map((m) => m[1]));
}

/** 读 `index.css`，返回颜色令牌集合，以及同样会被前缀占用的 `--text-*` / `--shadow-*` 非颜色令牌集合。 */
export function collectThemeTokens(css) {
  return { colors: collectTokens(css, "color"), texts: collectTokens(css, "text"), shadows: collectTokens(css, "shadow") };
}

/** 去掉注释：块注释、整行 `//`、以及代码后面的 ` // …`（要求前面有空白，避免伤到 `https://`）。 */
export function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

const CLASS_RE = new RegExp(
  `(?<![\\w-])((?:[a-z0-9\\[\\]&>*=_%-]+:)*)(${PREFIXES.join("|")})-([a-z][a-z0-9]*(?:-[a-z0-9]+)*)(\\/[0-9a-z.\\[\\]%]+)?(?![\\w:/-])`,
  "g",
);

/** 扫描一段源码文本，返回其中不存在的颜色类：`[{ line, cls }]`。 */
export function findUnknownColorClasses(text, tokens) {
  const found = [];
  const clean = stripComments(text);
  for (const m of clean.matchAll(CLASS_RE)) {
    const [, , prefix, rest] = m;
    const key = prefix.startsWith("border-") ? "border" : prefix;
    if (NON_COLOR[key]?.test(rest)) continue;
    if (key === "text" && (tokens.texts.has(rest) || [...tokens.texts].some((t) => rest === t))) continue;
    if (key === "shadow" && tokens.shadows.has(rest)) continue;
    if (tokens.colors.has(rest) || SPECIAL_COLORS.has(rest)) continue;
    const line = clean.slice(0, m.index).split("\n").length;
    found.push({ line, cls: `${prefix}-${rest}` });
  }
  return found;
}

function* sourceFiles(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* sourceFiles(join(dir, e.name));
    } else if (/\.(?:tsx?|html)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) {
      yield join(dir, e.name);
    }
  }
}

/** 扫描整个 web 应用，返回 `[{ file, line, cls }]`（已应用白名单）。 */
export function scanColorClasses(root = ROOT) {
  const webDir = join(root, "apps", "web");
  const tokens = collectThemeTokens(readFileSync(join(webDir, "src", "index.css"), "utf8"));
  const out = [];
  for (const file of sourceFiles(webDir)) {
    const rel = relative(root, file).replaceAll("\\", "/");
    const allowed = new Set(ALLOWLIST[rel] ?? []);
    for (const hit of findUnknownColorClasses(readFileSync(file, "utf8"), tokens)) {
      if (!allowed.has(hit.cls)) out.push({ file: rel, ...hit });
    }
  }
  return { tokenCount: tokens.colors.size, problems: out };
}

/** 命令行 / `check:build` 入口：有问题返回 false 并列出文件、行号与类名。 */
export function checkColorClasses(root = ROOT) {
  const { tokenCount, problems } = scanColorClasses(root);
  if (tokenCount === 0) {
    console.error("✗ 没有在 index.css 里找到任何 --color-* 令牌——守卫读不到主题，需要更新。");
    return false;
  }
  if (problems.length > 0) {
    console.error(`\n✗ ${problems.length} 处使用了主题里不存在的颜色名（Tailwind 不会生成任何 CSS，元素会悄悄没有颜色，BUG-005）：`);
    for (const p of problems) console.error(`  - ${p.file}:${p.line}  ${p.cls}`);
    console.error("\n  修法：改成 index.css @theme 里已定义的颜色令牌（警告用 warn / warn-dark / warn-soft，文字用 ink / muted 等，见《颜色语义与配色规范》）。");
    console.error("  确实需要例外时写进 tools/check-color-classes.mjs 的 ALLOWLIST 并注明理由。");
    return false;
  }
  console.log(`✓ 源码里的颜色类都能在主题里找到（${tokenCount} 个颜色令牌）`);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(checkColorClasses() ? 0 : 1);
}
