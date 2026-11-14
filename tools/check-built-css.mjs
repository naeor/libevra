/**
 * 构建产物 CSS 守卫：同一条规则里，`backdrop-filter` 与 `-webkit-backdrop-filter` 必须成对出现、取值相同。
 *
 * ⚠️ **为 BUG-006（1.19.64 修复）而写。** 生产构建里，凡是源码“先写无前缀、后写带前缀”的规则，
 * Lightning CSS 会把两条当成同一个属性、按“后写的覆盖先写的”只留下 `-webkit-backdrop-filter`。
 * Chromium（安卓 Chrome、电脑 Chrome / Edge）只认无前缀写法，于是 B2 弹出面板等处没有背景模糊。
 * 这件事与浏览器目标无关（目标里本来就有 Chrome 111 / Edge 111），也没有单独关掉它的开关；
 * Tailwind 4 的优化步骤与 Vite 8 的 CSS 压缩用的都是 Lightning CSS，两步都会这样合并。
 * **开发服务器不压缩，开发时完全看不出来**——所以只能查构建产物。
 *
 * 修法是源码一律“先带前缀、后无前缀”（CSS 的通行顺序），Lightning CSS 会合并成一条再按目标浏览器
 * 补出两种写法。这个守卫保证以后漏改或新写的规则不会再悄悄丢掉其中一种：
 *  - 只有带前缀的 → Chromium 没有效果（本 bug）；
 *  - 只有无前缀的 → iPhone Safari 18 以前（目标里有 Safari / iOS 16.4）没有效果；
 *  - 两种取值不同 → 两类浏览器效果不一样。
 *
 * 用法：
 *   node tools/check-built-css.mjs [构建输出目录]   默认 apps/web/dist；`pnpm check:build` 构建后自动调用
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DIST = join(ROOT, "apps", "web", "dist");
const UNPREFIXED = "backdrop-filter";
const PREFIXED = "-webkit-backdrop-filter";

/**
 * 把 CSS 文本拆成声明块：每块是 `{ path: [外层前导…, 选择器], decls: [{ prop, value }] }`。
 *
 * 手写的小分词器，只认结构：注释、字符串、括号（`url(...)`、`@supports (...)` 里的 `;` `{` `}` 不算结构）、
 * `{` `;` `}`。不依赖未声明的解析库；压缩后的产物没有嵌套也能处理，有嵌套也能处理。
 */
export function declarationBlocks(css) {
  const blocks = [];
  const stack = [];
  let buf = "";
  let depth = 0;
  let quote = "";

  const pushDecl = (text) => {
    const segment = text.trim();
    if (!segment || stack.length === 0) return;
    const colon = segment.indexOf(":");
    if (colon <= 0 || segment.startsWith("@")) return;
    const prop = segment.slice(0, colon).trim().toLowerCase();
    if (prop.startsWith("--")) return;
    stack[stack.length - 1].decls.push({ prop, value: segment.slice(colon + 1).trim() });
  };

  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      buf += ch;
      if (ch === "\\" && i + 1 < css.length) buf += css[++i];
      else if (ch === quote) quote = "";
      continue;
    }
    // 字符串外的转义同样不算结构：Tailwind 的类名里有 `.before\:content-\[\'\'\]` 这样的选择器。
    if (ch === "\\" && i + 1 < css.length) { buf += ch + css[++i]; continue; }
    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 1;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === "(") { depth++; buf += ch; continue; }
    if (ch === ")") { depth = Math.max(0, depth - 1); buf += ch; continue; }
    if (depth > 0) { buf += ch; continue; }
    if (ch === "{") {
      stack.push({ prelude: buf.trim().replace(/\s+/g, " "), decls: [] });
      buf = "";
    } else if (ch === ";") {
      pushDecl(buf);
      buf = "";
    } else if (ch === "}") {
      pushDecl(buf);
      buf = "";
      const frame = stack.pop();
      if (frame && frame.decls.length > 0) {
        blocks.push({ path: [...stack.map((f) => f.prelude), frame.prelude], decls: frame.decls });
      }
    } else {
      buf += ch;
    }
  }
  // 解析没有回到顶层（字符串、括号或块没闭合）说明分词器跑偏了，后面的规则全被吞掉——宁可报错也不能静默通过。
  if (quote || depth !== 0 || stack.length !== 0) {
    throw new Error(`CSS 解析没有回到顶层（未闭合：${quote ? "字符串 " : ""}${depth ? "括号 " : ""}${stack.length ? `${stack.length} 个块` : ""}），守卫结果不可信`);
  }
  return blocks;
}

/** 规范化取值以便比较：压缩器可能在函数之间省掉空格（`blur(8px)saturate(.85)`）。 */
const normalize = (value) => value.replace(/\s+/g, " ").replace(/\s*([(),])\s*/g, "$1").replace(/\)\s+/g, ")").trim().toLowerCase();

/** 检查一段 CSS，返回 `{ pairs, problems }`；`pairs` 是两种写法都在且一致的块数。 */
export function checkBackdropFilterPairs(css) {
  const problems = [];
  let pairs = 0;
  for (const block of declarationBlocks(css)) {
    // 同一块里同名属性以最后一条为准（与浏览器层叠一致）。
    const last = (prop) => block.decls.filter((d) => d.prop === prop).at(-1);
    const unprefixed = last(UNPREFIXED);
    const prefixed = last(PREFIXED);
    if (!unprefixed && !prefixed) continue;
    const where = block.path.join(" › ");
    if (!unprefixed) {
      problems.push({ where, reason: `只有 ${PREFIXED}: ${prefixed.value} —— Chromium（安卓 Chrome、电脑 Chrome / Edge）没有效果` });
    } else if (!prefixed) {
      problems.push({ where, reason: `只有 ${UNPREFIXED}: ${unprefixed.value} —— iPhone Safari 18 以前没有效果` });
    } else if (normalize(unprefixed.value) !== normalize(prefixed.value)) {
      problems.push({ where, reason: `两种写法取值不同（${PREFIXED}: ${prefixed.value} / ${UNPREFIXED}: ${unprefixed.value}）` });
    } else {
      pairs++;
    }
  }
  return { pairs, problems };
}

/**
 * 守卫自己的自检：分词器若坏掉、什么都找不到，检查会“永远通过”。先用已知样例确认它还认得出问题。
 * 第一条就是 BUG-006 修复前产物里的真实样子。
 */
function selfTest() {
  const cases = [
    ["a{background:red;-webkit-backdrop-filter:var(--f)}", 0, 1],
    ["a{-webkit-backdrop-filter:blur(8px)saturate(.85);backdrop-filter:blur(8px) saturate(.85)}", 1, 0],
    ["@media (min-width:1px){a::before{content:\"}{;\";backdrop-filter:blur(2px)}}", 0, 1],
    ["@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){a{background:url(data:x;y)}}", 0, 0],
    ["a{-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(4px)}", 0, 1],
    ["a{transition:-webkit-backdrop-filter .2s,backdrop-filter .2s}", 0, 0],
    [".before\\:content-\\[\\'\\'\\]:before{--tw-content:\"\"}b{-webkit-backdrop-filter:none}", 0, 1],
  ];
  for (const [css, wantPairs, wantProblems] of cases) {
    const { pairs, problems } = checkBackdropFilterPairs(css);
    if (pairs !== wantPairs || problems.length !== wantProblems) {
      throw new Error(`守卫自检失败：${css} → 成对 ${pairs}（应为 ${wantPairs}）、问题 ${problems.length}（应为 ${wantProblems}）`);
    }
  }
}

function cssFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...cssFiles(p));
    else if (name.endsWith(".css")) out.push(p);
  }
  return out;
}

/** 扫描整个构建输出目录；返回是否通过。 */
export function checkBuiltCss(distDir = DEFAULT_DIST) {
  selfTest();
  console.log(`check:built-css — 构建产物里 backdrop-filter 两种写法是否成对（BUG-006 守卫）`);
  if (!existsSync(distDir)) {
    console.error(`✗ 找不到构建输出目录：${distDir}`);
    return false;
  }
  const files = cssFiles(distDir);
  let pairs = 0;
  const problems = [];
  for (const file of files) {
    let result;
    try {
      result = checkBackdropFilterPairs(readFileSync(file, "utf8"));
    } catch (error) {
      console.error(`✗ ${relative(distDir, file)}：${error.message}`);
      return false;
    }
    pairs += result.pairs;
    for (const p of result.problems) problems.push({ file: relative(distDir, file).replaceAll("\\", "/"), ...p });
  }
  if (pairs + problems.length === 0) {
    // 应用里一定有背景模糊；一条都没找到说明产物路径或格式变了，守卫已经失效。
    console.error(`✗ 在 ${files.length} 个 CSS 文件里一条 backdrop-filter 都没找到——构建输出位置或格式可能变了，守卫需要更新。`);
    return false;
  }
  if (problems.length > 0) {
    console.error(`\n✗ ${problems.length} 条规则的 backdrop-filter 两种写法不成对（成对的 ${pairs} 条）：`);
    for (const p of problems) {
      const where = p.where.length > 220 ? `${p.where.slice(0, 220)}…` : p.where;
      console.error(`  - [${p.file}] ${where}\n      ${p.reason}`);
    }
    console.error(
      `\n  修法：在源码里把这条规则写成「先 ${PREFIXED}、后 ${UNPREFIXED}」，取值相同。` +
        `\n  反过来写，Lightning CSS（Tailwind 优化与 Vite 压缩）会只留下后写的带前缀那条（BUG-006）。`,
    );
    return false;
  }
  console.log(`✓ ${files.length} 个 CSS 文件，${pairs} 条规则的 backdrop-filter 两种写法都在且一致`);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const dir = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_DIST;
  process.exit(checkBuiltCss(dir) ? 0 : 1);
}
