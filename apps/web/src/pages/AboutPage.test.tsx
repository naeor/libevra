import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { AboutPage } from "./AboutPage.js";

/**
 * The About page makes two factual promises about where data lives and how
 * amounts are displayed. Both used to be wider than the implementation:
 * guest/offline data is stored on the device, and JPY has no minor unit.
 * These assertions keep the page from drifting back to a convenient but false
 * statement; they are not an assertion about every sentence on the page.
 */
function renderAbout(): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={["/about"]}>
      <AboutPage />
    </MemoryRouter>,
  ).replace(/\s+/g, " ");
}

describe("about page factual statements", () => {
  it("does not claim all data always lives on the server", () => {
    const html = renderAbout();

    expect(html).toContain("游客账本只保存在这台设备，不会自动上传");
    expect(html).toContain("离线期间的修改会暂存在本机");
    expect(html).not.toContain("账目只保存在你自己部署的服务器上");
  });

  it("does not claim every currency uses two decimal places", () => {
    const html = renderAbout();

    expect(html).toContain("日元没有小数位");
    expect(html).not.toContain("所有币种目前统一按两位小数记录");
  });
});
