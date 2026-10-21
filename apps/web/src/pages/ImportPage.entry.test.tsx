import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { dirname } from "node:path";

/**
 * 中央 `+` → 导入账单 的来源语义（S15-UI-1 复核补丁）。
 *
 * 这页没有 DOM 渲染测试所需的登录态/查询 mock；与仓库里其它"导航字段必须一致"的测试一样，
 * 这里检查的是**源码里的契约**：入口带 `?from=nav`，`ImportPage` 据此隐藏旧的「← 返回导出」，
 * 并且深链回退从 `/export` 变成明细 `/`。旧 `/export → /import` 的上下文保持 `/export`。
 *
 * ⚠️ 若未来重构这段逻辑，请优先保留这些契约并改用渲染测试；不要删掉测试来让重构通过。
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string): string => readFileSync(`${here}/${name}`, "utf8");

describe("中央 + 的导入账单来源", () => {
  it("opens /import with the nav origin hint", () => {
    const bottomNav = read("../components/BottomNav.tsx");

    expect(bottomNav).toContain('to: "/import?from=nav"');
    // 菜单里绝不能出现账本导入的地址（注释里可以讨论它，`to:` 不可以）。
    expect(bottomNav).not.toMatch(/to:\s*["'`]\/import-ledger/);
  });

  it("ImportPage hides the legacy export link and falls back to 明细 only for the nav origin", () => {
    const importPage = read("./ImportPage.tsx");

    expect(importPage).toContain('searchParams.get("from") === "nav"');
    expect(importPage).toContain('fromMenu ? "/" : "/export"');
    expect(importPage).toContain("hideExportLink={fromMenu}");
    // 旧 /export → /import 上下文必须保留原来的回退。
    expect(importPage).toContain('exportTo="/export"');
  });
});
