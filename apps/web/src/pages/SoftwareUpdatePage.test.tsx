import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import { APP_VERSION, formatAppVersion } from "../lib/version.js";
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

    expect(html).toContain(formatAppVersion(APP_VERSION));
    // 只有补零后与内部版本号不同（如 1.17.9 → 1.17.09）时，才能断言页面不显示内部写法；
    // 两位数补丁号（1.17.10 / 1.17.11）两种写法相同。
    if (formatAppVersion(APP_VERSION) !== APP_VERSION) expect(html).not.toContain(APP_VERSION);
    expect(html).toContain("1.17.15");
    expect(html).toContain("平板双工作区与自适应分析布局");
    expect(html).toContain(
      "平板支持双工作区对照查看不同账本，分析卡片随工作区大小排列；编辑工具栏更轻巧，并改进 iPad 拖拽和自动备份告警。",
    );
    expect(html).toContain("2026年10月30日");
    expect(html).toContain('href="/update/announcements/1.18.02"');
    expect(html.match(/href="\/update\/announcements"/g)).toHaveLength(1);
    expect(html.match(/href="\/update\/announcements\/[^"]+"/g)).toHaveLength(6);
    expect(html).not.toContain("更早");
    expect(html).toContain("两个工作区可分别查看不同账本");
    expect(html).toContain("新增功能");
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
