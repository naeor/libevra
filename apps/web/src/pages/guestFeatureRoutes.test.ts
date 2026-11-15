import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** 1.19.94：游客可用的页面都在 RequireSession 之内（断言源码，和 settingsRoutes.test.ts 同一个做法）。 */
function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("游客可进入的路由", () => {
  const app = source("../App.tsx");
  const open = [
    "/paste", "/paste/review", "/ledger/cards", "/ledger/more", "/export", "/update", "/update/announcements",
    "/update/announcements/:version", "/update/runtime", "/about", "/legal/privacy", "/legal/terms",
    "/settings/preferences", "/settings/appearance", "/settings/appearance/theme",
    "/books/:bookId/settings/export", "/books/:bookId/settings/duplicates",
    // 游客多账本（第二批）：账本详情与账本设置。
    "/books/:bookId", "/books/:bookId/settings", "/books/:bookId/attachments",
    // 1.19.96：导入账单在本机完成（当前账本入口与账本设置里的目标账本入口）。
    "/import", "/books/:bookId/settings/import",
  ];
  for (const path of open) {
    it(`${path} 用 RequireSession`, () => {
      const line = app.split("\n").find((row) => row.includes(`<Route path="${path}"`));
      expect(line, path).toBeDefined();
      expect(line).toContain("<RequireSession>");
      expect(line).not.toContain("<RequireAuth>");
    });
  }

  it("语音、拍照、账号类页面与账本导入（转正式账号）仍需要正式账号", () => {
    for (const path of ["/record", "/scan", "/profile", "/settings/security", "/import-ledger"]) {
      const line = app.split("\n").find((row) => row.includes(`<Route path="${path}"`));
      expect(line, path).toContain("<RequireAuth>");
    }
  });
});

describe("游客“我的”页入口", () => {
  it("有偏好、外观、导出、展示卡片、更新与关于的行", () => {
    const page = source("./GuestMePage.tsx");
    for (const id of ["guest-book-settings-row", "guest-preferences-row", "guest-appearance-row", "guest-export-row", "guest-cards-row", "guest-updates-row", "guest-about-row"]) {
      expect(page).toContain(id);
    }
  });
});
