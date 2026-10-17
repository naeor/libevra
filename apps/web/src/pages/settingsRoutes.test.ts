import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **设置首页的三条分类子路由，以及它们没有挤掉旧地址（S13-E）。**
 *
 * ⚠️ **断言源码而不是渲染，因为这个项目的网页测试跑在没有 DOM 的纯 Node 里**
 * （`vitest.config.ts`），和 `pages/adminConsole.test.ts`、`lib/backNavigation.test.ts`
 * 是同一个选择。这里要证明的也正是"接上了没有"：路由表里没有一条地址，页面组件写得
 * 再对也到不了——通配路由会把它送回首页。
 */
function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

/** 地址 → 页面组件，顺序与路由表一致。 */
const SUB_ROUTES = [
  ["/settings/preferences", "PreferencesPage"],
  ["/settings/appearance", "AppearancePage"],
  ["/settings/security", "SecurityPage"],
] as const;

describe("设置子页面的路由", () => {
  it("每条地址都有一条 Route，并且在 RequireAuth 之内", () => {
    const app = source("../App.tsx");

    for (const [path, page] of SUB_ROUTES) {
      expect(app, path).toContain(
        `<Route path="${path}" element={<RequireAuth><${page} /></RequireAuth>} />`,
      );
    }
  });

  it("排在通配路由之前，否则刷新与深链都会回到首页", () => {
    const app = source("../App.tsx");
    const wildcard = app.indexOf('path="*"');

    expect(wildcard).toBeGreaterThan(-1);

    for (const [path] of SUB_ROUTES) {
      const route = app.indexOf(`path="${path}"`);
      expect(route, path).toBeGreaterThan(-1);
      expect(route, path).toBeLessThan(wildcard);
    }
  });

  it("旧的三个设置地址仍然有效", () => {
    const app = source("../App.tsx");

    for (const path of [
      "/settings/password",
      "/settings/recovery-code",
      "/settings/referral-codes",
    ]) {
      expect(app, path).toContain(`path="${path}"`);
    }
  });
});

describe("子页面的返回与入口", () => {
  const pages = source("./SettingsSubPages.tsx");
  const home = source("./SettingsPage.tsx");

  it("每一页都经过同一个返回兜底 /settings", () => {
    /**
     * ⚠️ **历史优先，`/settings` 只是深链的兜底** —— 这就是 `InnerPage` 的现有规则
     * (`useGoBack`)，这里断言三页共用同一个包装，而不是各自手写一个不同的父级。
     */
    expect(pages.match(/backTo="\/settings"/g) ?? []).toHaveLength(1);
    expect(pages.match(/<SettingsSubPage title=/g) ?? []).toHaveLength(3);
  });

  it("首页的每张卡片都指向真实地址", () => {
    for (const [path] of SUB_ROUTES) expect(home, path).toContain(`to="${path}"`);

    // 系统管理（仅管理员）与关于，同样是能走到的一级地址。
    expect(home).toContain('to="/admin"');
    expect(home).toContain('to="/about"');
  });

  it("账号安全的三行分别指向三个旧地址，原有页面不改", () => {
    /**
     * ⚠️ **三行都不是"后续开放"**：它们背后是已经存在的三页，账号安全只负责把它们列出来。
     */
    for (const path of [
      "/settings/password",
      "/settings/recovery-code",
      "/settings/referral-codes",
    ]) {
      expect(pages, path).toContain(`to: "${path}"`);
    }
  });

  it("三页没有重新放回导出 / 导入", () => {
    /**
     * ⚠️ **它们操作的是当前账本，不是账号设置**（S13-E 的决定）：入口归账本级，
     * `/export`、`/import` 两条旧路由不动。设置页重新列出它们就是又一次"入口放错层"。
     */
    expect(pages).not.toContain('"/export"');
    expect(pages).not.toContain('"/import"');
    expect(pages).not.toContain("/settings/export");
    expect(pages).not.toContain("/settings/import");
  });
});
