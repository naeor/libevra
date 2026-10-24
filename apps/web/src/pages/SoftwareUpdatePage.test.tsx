import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import { APP_VERSION } from "../lib/version.js";
import { SoftwareUpdatePage } from "./SoftwareUpdatePage.js";
import { UpdateAnnouncementDetailPage } from "./UpdateAnnouncementDetailPage.js";
import { UpdateAnnouncementsPage } from "./UpdateAnnouncementsPage.js";

/**
 * The update centre is a normal page, not a consent gate.
 *
 * 1.15.05 deliberately ships as a non-major announcement: the homepage may link to the latest
 * release, but nobody should be forced through a modal merely because they installed the version
 * that the announcement describes.
 */

function renderAt(path: string, node: React.ReactNode): string {
  const queryClient = new QueryClient();
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("software update announcements", () => {
  it("shows the running build and the latest released normal announcement", () => {
    const html = renderAt("/update", <SoftwareUpdatePage />);

    expect(html).toContain(APP_VERSION);
    expect(html).toContain("1.16.08");
    expect(html).toContain("七套主题与深色外观");
    expect(html).toContain("新增七套主题色与浅色、深色及跟随系统模式，并整理设置首页和外观预览。");
    expect(html).toContain("2026年10月24日");
    expect(html).toContain('href="/update/announcements/1.16.08"');
    expect(html.match(/href="\/update\/announcements"/g)).toHaveLength(1);
    expect(html.match(/href="\/update\/announcements\/[^"]+"/g)).toHaveLength(6);
    expect(html).not.toContain("更早");
    expect(html).toContain("新增功能");
    expect(html).toContain("调整及优化");
    expect(html).toContain("注意事项");
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("我知道了");
  });

  it("lists the newest release before the previous release in the archive", () => {
    const html = renderAt("/update/announcements", <UpdateAnnouncementsPage />);

    const current = html.indexOf("七套主题与深色外观");
    const previous = html.indexOf("页面统一与文案优化");
    expect(current).toBeGreaterThanOrEqual(0);
    expect(previous).toBeGreaterThan(current);
    expect(html).toContain('href="/update/announcements/1.16.08"');
    expect(html).toContain('href="/update/announcements/1.16.03"');
    expect(html).toContain('href="/update/announcements/1.15.05"');
  });

  it("renders the full 1.15.05 announcement with version navigation and a back control", () => {
    const html = renderAt(
      "/update/announcements/1.15.05",
      <Routes>
        <Route path="/update/announcements/:version" element={<UpdateAnnouncementDetailPage />} />
      </Routes>,
    );

    expect(html).toContain("新增功能");
    expect(html).toContain("调整及优化");
    expect(html).toContain("注意事项");
    expect(html).toContain("无需重新录音");
    expect(html).toContain("按发布记录整理，原版本号及发布日期不变");
    expect(html).not.toContain("感谢你使用 Libevra。");
    expect(html).toContain("上一版本");
    expect(html).toContain("1.15.04 · 旧版重大更新提示修复");
    expect(html).toContain("data-back-control");
    expect(html).not.toContain('role="dialog"');
  });
});
