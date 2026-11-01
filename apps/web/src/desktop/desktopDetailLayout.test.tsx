import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { DesktopInnerPage } from "./DesktopFrames.js";
import { DesktopSplit } from "./DesktopSplit.js";
import { DesktopSurfaceProvider } from "./surface.js";

vi.mock("../components/OfflineStatus.js", () => ({ OfflineStatus: () => null }));
vi.mock("../components/SyncBanner.js", () => ({ SyncBanner: () => null }));
vi.mock("../components/GuestModeBadge.js", () => ({ GuestModeBadge: () => null }));

describe("桌面详情与批量选择布局", () => {
  it("批量选择保留详情内容和面板宽度，主区可用，详情及分界线不可交互", () => {
    const render = (disabled: boolean) => renderToStaticMarkup(<DesktopSplit panel={<input aria-label="已有草稿" defaultValue="未保存内容" />} panelLabel="详情" panelDisabled={disabled} disabledMessage="详情暂停操作"><button>选择账目</button></DesktopSplit>);
    const normal = render(false);
    const selecting = render(true);
    expect(selecting.match(/<aside[^>]+style="([^"]+)"/)?.[1]).toBe(normal.match(/<aside[^>]+style="([^"]+)"/)?.[1]);
    expect(selecting).toContain('class="lv-desk-panel-content" inert=""');
    expect(selecting).toContain('value="未保存内容"');
    expect(selecting).toContain('role="separator" tabindex="-1" aria-disabled="true"');
    expect(selecting).toContain('<div class="lv-desk-split-main"><button>选择账目</button>');
    expect(selecting).toContain('role="status"');
    expect(normal).not.toContain('inert=""');
  });

  for (const surface of ["main", "panel"] as const) {
    it(`${surface} 详情把操作放在正文后面，保留关闭 / 返回入口`, () => {
      const html = renderToStaticMarkup(<MemoryRouter><DesktopSurfaceProvider surface={surface} onClose={() => {}}><DesktopInnerPage title="详情" desktopActionsAtBottom actions={<button>修改账目</button>}><p>账目正文</p></DesktopInnerPage></DesktopSurfaceProvider></MemoryRouter>);
      expect(html.indexOf("账目正文")).toBeLessThan(html.indexOf("修改账目"));
      expect(html.match(/修改账目/g)).toHaveLength(1);
      expect(html).toContain('class="lv-desk-detail-actions"');
      if (surface === "panel") expect(html).toContain('aria-label="关闭辅助栏"');
    });
  }
});
