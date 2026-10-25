import { describe, expect, it } from "vitest";

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { parentBackAction } from "./connectivity.js";

/**
 * ⚠️ **The owner reported this as a live bug** (2026-10-13):
 *
 * > *"点击关于 libellum 时会出现那个经典的老 bug：从关于退出会进到设置，从设置退出又会回到关于界面；
 * >  记录一下：从开始界面直接进入关于界面时，点击返回是返回开始界面."*
 *
 * ⚠️ **It is a history loop, and no single screen is wrong.** 关于's `backTo` is `/settings`; the start
 * page's footer is a third way in. Preferring history means the answer depends on how the reader
 * arrived — so 关于 and 设置 can point at each other and pressing back walks a circle.
 *
 * ⚠️ **The fix is a declared origin (`location.state.from`) that beats history**, and it lives in two
 * places that have to agree: `useGoBack` reads it, and every footer link has to set it. **A test that
 * only checked one of them would pass while the bug was still there**, which is why both are asserted.
 *
 * ⚠️ Asserted against source rather than by rendering, because this project's web tests run in plain
 * Node with no DOM (`vitest.config.ts`) — the same choice the copy tests make.
 */
function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

/** The whole `src` tree, so "nobody else opted in" can be asserted rather than assumed. */
const SRC = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(directory: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "generated" || entry === "node_modules") continue;
      found.push(...sourceFiles(path));
      continue;
    }
    if (!/\.(tsx|ts)$/.test(entry)) continue;
    found.push(path);
  }

  return found;
}

describe("退出一个二级页面时去哪里", () => {
  it("prefers a declared origin over history", () => {
    const connectivity = source("./connectivity.ts");

    /**
      * ⚠️ **The order is the fix**: `from` is checked before `location.key`, so a screen reached from
      * two different places can say which one it was opened from.
      */
    const fromIndex = connectivity.indexOf("if (from !== null)");
    const historyIndex = connectivity.indexOf('if (location.key !== "default")');

    expect(fromIndex).toBeGreaterThan(-1);
    expect(historyIndex).toBeGreaterThan(-1);
    expect(fromIndex).toBeLessThan(historyIndex);
  });

  it("深链的新会话用父级 replace 自己，而不是 push", () => {
    /**
      * ⚠️ **push 会与父级自己的 `-1` 形成一个两屏循环**（2026-10-25 由
      * `tools/e2e/navigation-back-verify.mjs` 在真实浏览器里复现）：
      * 偏好（会话第一条）返回 → push 设置；设置返回 `-1` → 落回偏好；偏好又 push 设置……
      * 会话第一条没有可回的历史，正确答案是 replace：不留影子。
      */
    const connectivity = source("./connectivity.ts");

    expect(connectivity).not.toContain("void navigate(fallback);");
    expect(connectivity).toContain("void navigate(fallback, { replace: true });");
  });

  it("reads the state defensively", () => {
    /**
      * ⚠️ **`state` is `unknown` at runtime.** A screen that crashed because somebody passed a number
      * as `from` would be a worse bug than the one being fixed, so the type is checked rather than
      * asserted.
      */
    expect(source("./connectivity.ts")).toContain('typeof declared === "string"');
  });

  it("has the start page's footer declaring where it came from", () => {
    /**
      * ⚠️ **All three footer links, not just 关于.** 隐私政策 and 使用条款 sit in the same footer and
      * would inherit the identical bounce — **the owner reported it for 关于 because that is the one he
      * tapped.**
      */
    const start = source("../pages/LedgerSpacePage.tsx");

    const declared = start.match(/state=\{\{ from: "\/start" \}\}/g) ?? [];
    expect(declared).toHaveLength(3);

    /**
      * ⚠️ **And they are `Link`, not `<a>`.** A raw anchor is a full page load: it resets history, so
      * the declared origin would never be delivered and the fallback would win — **the bug, restored
      * silently.**
      */
    expect(start).not.toContain('href="/about"');
    expect(start).not.toContain('href="/legal/');
  });

  it("falls back to where a deep link should land", () => {
    /**
      * ⚠️ **The fallback is for a deep link, which is the only case it was ever for.** Somebody opening
      * `/about` directly has no origin to honour, and 设置 is still the sensible parent there.
      */
    expect(source("../pages/AboutPage.tsx")).toContain('backTo={from ?? "/settings"}');
    expect(source("../pages/LegalPage.tsx")).toContain('backTo={from ?? "/settings"}');
  });
});

/**
 * ⚠️ **The second loop, reported by the owner on 2026-10-20** (S15-C): *"在导出账本页点返回 → 回到
 * 账本设置；在账本设置点返回 → 又回到导出账本，来回循环."*
 *
 * ⚠️ **The fix is an opt-in mode, and the opt-in matters as much as the mode.** `parent` means "my
 * parent never changes", which is true for 账本设置 (→ 账本详情). 账本详情 itself is reachable from
 * several places (明细「详情」、我的→账本管理、旧地址重定向), so it keeps history-based back; 导出 is
 * a leaf pushed from 设置, so plain history (-1) already returns there and consumes its entry.
 *
 * ⚠️ **`parent` 不再用 `replace` 把自己换掉，而是 pop**（第四轮，2026-10-21，账本导入报告的循环）.
 * `replace` 不缩短历史：设置 →push 导入 → 导入返回 push 设置 → 设置返回 replace 成详情，
 * 详情脚下那条仍是导入，`-1` 就落回导入。所以有上一条历史时 pop（连同自己的记录一起消耗），
 * 只有会话第一条（深链）才 replace 到声明的父级。
 */
describe("返回模式：默认历史，按需声明父级", () => {
  const connectivity = source("./connectivity.ts");
  const layouts = source("../components/Layouts.tsx");

  it("默认仍是 history，谁都不传就和以前一样", () => {
    expect(connectivity).toContain('mode: BackMode = "history"');
    expect(layouts).toContain('backMode = "history"');
    expect(layouts).toContain("useGoBack(backTo, backMode)");
  });

  it("parent 分支：有历史就 pop 掉自己，深链才用声明的父级 replace，且不被 state.from 改写", () => {
    const start = connectivity.indexOf('if (mode === "parent")');
    const end = connectivity.indexOf("if (from !== null)");

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const branch = connectivity.slice(start, end);
    /** ⚠️ pop 是"离开并把这一页的记录消耗掉"——正常入口下前一条就是父级。 */
    expect(branch).toContain("parentBackAction(location.key)");
    expect(branch).toContain("void navigate(-1);");
    /** ⚠️ 深链（会话第一条）没有上一条可回，才用声明的父级替掉自己。 */
    expect(branch).toContain("void navigate(fallback, { replace: true });");
    expect(branch).not.toContain("navigate(from)");
  });

  it("pop 还是 replace 由纯函数决定（没有 DOM 也能测）", () => {
    expect(parentBackAction("default")).toBe("replace");
    expect(parentBackAction("k3f9a1")).toBe("pop");
  });

  it("只有账本设置声明了固定的父级（导出保持历史返回）", () => {
    const found = sourceFiles(SRC)
      .filter((path) => !/\.test\.(ts|tsx)$/.test(path))
      .filter((path) => readFileSync(path, "utf8").includes("backMode"))
      .map((path) => relative(SRC, path).replace(/\\/g, "/"))
      .sort();

    /**
      * ⚠️ **The list is the guard**: 账本设置 is the only screen whose parent is fixed. A third
      * file appearing here is either a new loop being fixed (fine — update this list) or a screen
      * that just lost history-based back (not fine).
      */
    expect(found).toEqual([
      "components/Layouts.tsx",
      "lib/connectivity.ts",
      "pages/BookSettingsPage.tsx",
    ]);

    /**
      * ⚠️ **账本导入也走 `parent`，但它是直接调 `useGoBack`，不是 `InnerPage` 的 prop**——
      * 它的返回按钮要先处理"退出未完成导入"的守卫，再离开。第四轮加入。
      */
    expect(source("../pages/LedgerImportPage.tsx")).toContain('useGoBack(backTo, "parent")');
  });

  it("设置的返回是账本详情；导出的返回仍交给历史（它是设置的叶子页）", () => {
    const settings = source("../pages/BookSettingsPage.tsx");
    const exportPage = source("../pages/ExportPage.tsx");

    expect(settings).toContain("backTo={`/books/${bookId}`}");
    expect(settings).toContain('backMode="parent"');

    expect(exportPage).toContain('backTo="/"');
    expect(exportPage).toContain("backTo={`/books/${bookId}/settings`}");
    expect(exportPage).not.toContain("backMode");
  });
});
