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
  ];
  for (const path of open) {
    it(`${path} 用 RequireSession`, () => {
      const line = app.split("\n").find((row) => row.includes(`<Route path="${path}"`));
      expect(line, path).toBeDefined();
      expect(line).toContain("<RequireSession>");
      expect(line).not.toContain("<RequireAuth>");
    });
  }

  it("语音、拍照、导入账单、账号类页面仍需要正式账号", () => {
    for (const path of ["/record", "/scan", "/import", "/profile", "/settings/security"]) {
      const line = app.split("\n").find((row) => row.includes(`<Route path="${path}"`));
      expect(line, path).toContain("<RequireAuth>");
    }
  });
});

describe("游客“我的”页入口", () => {
  it("有偏好、外观、导出、展示卡片、更新与关于的行", () => {
    const page = source("./GuestMePage.tsx");
    for (const id of ["guest-preferences-row", "guest-appearance-row", "guest-export-row", "guest-cards-row", "guest-updates-row", "guest-about-row"]) {
      expect(page).toContain(id);
    }
  });
});
