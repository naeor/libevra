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
  it("shows the running 1.15.05 and its latest normal announcement", () => {
    const html = renderAt("/update", <SoftwareUpdatePage />);

    expect(APP_VERSION).toBe("1.15.05");
    expect(html).toContain("1.15.05");
    expect(html).toContain("Libevra 1.15.05");
    expect(html).toContain("粘贴也能记账，语音和快捷菜单更好用。");
    expect(html).toContain("2026年10月23日");
    expect(html).toContain('href="/update/announcements/1.15.05"');
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("我知道了");
  });

  it("lists 1.15.05 before the previous release in the archive", () => {
    const html = renderAt("/update/announcements", <UpdateAnnouncementsPage />);

    const current = html.indexOf("Libevra 1.15.05");
    const previous = html.indexOf("Libevra 1.15.04");
    expect(current).toBeGreaterThanOrEqual(0);
    expect(previous).toBeGreaterThan(current);
    expect(html).toContain('href="/update/announcements/1.15.05"');
    expect(html).toContain('href="/update/announcements/1.15.04"');
  });

  it("renders the full 1.15.05 announcement with version navigation and a back control", () => {
    const html = renderAt(
      "/update/announcements/1.15.05",
      <Routes>
        <Route path="/update/announcements/:version" element={<UpdateAnnouncementDetailPage />} />
      </Routes>,
    );

    expect(html).toContain("粘贴文字，识别记账");
    expect(html).toContain("语音记账，更好修改");
    expect(html).toContain("快捷菜单，五种方式");
    expect(html).toContain("不需要重新录音");
    expect(html).toContain("感谢你使用 Libevra。");
    expect(html).toContain("上一版本");
    expect(html).toContain("1.15.04 · Libevra 1.15.04");
    expect(html).toContain("data-back-control");
    expect(html).not.toContain('role="dialog"');
  });
});
