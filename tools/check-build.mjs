/**
 * The check that catches what typecheck and tests cannot.
 *
 * ⚠️ **Written after a CSS rule inside `@theme` broke the entire application while every test passed.**
 *
 * The evidence: `pnpm typecheck` was clean, `pnpm -r test` was 650 passing, and **the owner could not even reach
 * the login page** — because Vite replaces the whole app with an error overlay when Tailwind fails to compile.
 *
 * **Every check in this repository looked at TypeScript and at behaviour. None of them looked at whether the
 * application builds.**
 *
 * ⚠️ **So this runs the real build**, which is the only thing that compiles the CSS, resolves every import the
 * bundler has to resolve, and fails on a plugin error. **It takes a second and it would have caught this in one.**
 *
 * ⚠️ **构建成功之后还要看产物（1.19.64，BUG-006）。** 压缩会改写 CSS：先写无前缀、后写带前缀的
 * `backdrop-filter` 被合并成只剩带前缀的一条，Chromium 上没有背景模糊——构建照样“成功”，开发服务器也看不出来。
 * 所以构建通过后接着跑 `check-built-css.mjs` 扫描 `apps/web/dist` 的 CSS。
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { checkBuiltCss } from "./check-built-css.mjs";
import { checkColorClasses } from "./check-color-classes.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

console.log("check:build — 真实构建（CSS 与打包期错误只有它能拦住）");

// BUG-005：颜色类用了主题里不存在的颜色名，Tailwind 不报错也不生成 CSS，所以构建前先查。
if (!checkColorClasses()) process.exit(1);


const result = spawnSync("pnpm", ["--filter", "@libellum/web", "build"], {
  cwd: root,
  stdio: "inherit",
  shell: true,
});

if (result.status !== 0) {
  console.error("\n✗ 构建失败。上面的信息就是原因 —— **而这一类错误 typecheck 与 test 都看不到。**");
  process.exit(1);
}

console.log("✓ 构建通过");

if (!checkBuiltCss(resolve(root, "apps", "web", "dist"))) {
  console.error("\n✗ 构建产物检查失败。构建本身成功，但产物里的 CSS 会在部分浏览器上失效（见上）。");
  process.exit(1);
}