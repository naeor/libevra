import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ⚠️ 通知条与「+」入口菜单同时出现是用户在验收清单里点名要覆盖的冲突（S16-H）。
 * 浏览器里的完整交互由 `tools/e2e/avatar-rewards-verify.mjs`（7 项，含“打开 + 菜单横幅立即让位”）
 * 覆盖；这里守住渲染契约：菜单一开，横幅必须立刻变成不可见且不可点击，而不是等动画结束。
 */
const state = vi.hoisted(() => ({
  menuOpen: false,
  pendingEvents: [{ id: "event-1", avatarId: "descent-special" }] as { id: string; avatarId: string }[],
}));

vi.mock("./Layouts.js", () => ({
  useEntryMenu: () => ({ open: state.menuOpen, toggle: () => {}, close: () => {} }),
}));

vi.mock("../lib/avatarRewards.js", () => ({
  AVATAR_REWARDS_QUERY_KEY: ["avatar-rewards"],
  useAvatarRewards: () => ({ data: { pendingEvents: state.pendingEvents } }),
  confirmAvatarRewardEvents: () => Promise.resolve(),
}));

import { AvatarRewardBanner } from "./AvatarRewardBanner.js";

function render(): string {
  const client = new QueryClient();
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AvatarRewardBanner />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AvatarRewardBanner", () => {
  beforeEach(() => {
    state.menuOpen = false;
    state.pendingEvents = [{ id: "event-1", avatarId: "descent-special" }];
  });

  it("renders nothing when there is no pending event", () => {
    state.pendingEvents = [];
    expect(render()).toBe("");
  });

  it("keeps the banner visible above the bottom nav while the entry menu is closed", () => {
    const html = render();
    expect(html).toContain('aria-hidden="false"');
    expect(html).toContain("opacity-100");
    expect(html).toContain("pointer-events-auto");
  });

  it("gives way immediately when the entry menu opens", () => {
    state.menuOpen = true;
    const html = render();
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("opacity-0");
    expect(html).not.toContain("pointer-events-auto");
  });
});
