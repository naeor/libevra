import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startLanguageRuntime } from "../lib/languageRuntime.js";
import { AvatarPickerPage } from "./AvatarPickerPage.js";

/**
 * **S16 头像选择页 UI：特典排序与锁定状态。**
 *
 * 排序必须来自服务端解锁状态（已解锁在前），锁定文案与禁用保存属于同一套可见规则；
 * 这里用静态渲染锁定契约，真实居中/对比度/底部栏遮挡由 `tools/e2e/avatar-picker-ui-verify.mjs` 检查。
 */

const state = vi.hoisted(() => ({
  avatarId: "flower" as string,
  unlocked: [] as { avatarId: string; source: string; unlockedAt: string }[],
}));

vi.mock("../auth/AuthProvider.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../auth/AuthProvider.js")>()),
  useAuth: () => ({
    user: {
      id: "user-1",
      username: "ada",
      displayName: "Ada",
      accountNumber: "100001",
      avatarId: state.avatarId,
      createdAt: "2026-10-01T08:00:00.000Z",
    },
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    sessionRevoked: false,
    sessionEndReason: null,
  }),
}));

vi.mock("../components/Layouts.js", () => ({
  TabPage: ({ children }: { readonly children: React.ReactNode }) => <>{children}</>,
  InnerPage: ({ children }: { readonly children: React.ReactNode }) => <main>{children}</main>,
}));

vi.mock("../lib/avatarRewards.js", () => ({
  useAvatarRewards: () => ({ data: { unlocked: state.unlocked } }),
}));

vi.mock("../lib/profile.js", () => ({
  useSaveProfile: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("../lib/profileDraft.js", () => ({
  useDraftExit: () => undefined,
}));

const runtime = startLanguageRuntime();

function render(): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/profile/avatar"]}>
        <AvatarPickerPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  runtime.choose("zh-CN");
  state.avatarId = "flower";
  state.unlocked = [];
});

afterEach(() => {
  runtime.choose("zh-CN");
});

describe("特典系列排序", () => {
  it("已解锁的特典排在前面，未解锁的在后（顺序来自服务端状态）", () => {
    state.unlocked = [{ avatarId: "descent-special", source: "first_login", unlockedAt: "2026-10-26T00:00:00.000Z" }];
    const html = render();

    expect(html.indexOf("降临")).toBeGreaterThan(-1);
    expect(html.indexOf("倒悬")).toBeGreaterThan(-1);
    expect(html.indexOf("降临")).toBeLessThan(html.indexOf("倒悬"));
  });

  it("解锁另一款后顺序随之调整，不写死固定位置", () => {
    state.unlocked = [
      { avatarId: "daoxuan-special", source: "anniversary", unlockedAt: "2026-11-19T00:00:00.000Z" },
    ];
    const html = render();

    expect(html.indexOf("倒悬")).toBeLessThan(html.indexOf("降临"));
  });
});

describe("未解锁头像的可见状态", () => {
  it("未解锁的头像带锁定标记，保存提示为「尚未解锁，暂不可使用」", () => {
    state.avatarId = "daoxuan-special";
    const html = render();

    expect(html).toContain('data-locked="true"');
    expect(html).toContain("尚未解锁，暂不可使用");
    expect(html).toContain("disabled");
  });

  it("英文界面使用英文锁定提示且不残留中文", () => {
    runtime.choose("en-US");
    state.avatarId = "descent-special";
    const html = render();

    expect(html).toContain("Not unlocked yet — unavailable for now.");
    expect(html).not.toMatch(/[\u3400-\u9fff]/u);
  });

  it("已解锁的特典不显示锁定提示", () => {
    state.avatarId = "descent-special";
    state.unlocked = [{ avatarId: "descent-special", source: "first_login", unlockedAt: "2026-10-26T00:00:00.000Z" }];
    const html = render();

    // 另一款特典仍未解锁，网格里应恰好只剩一个锁定标记。
    expect((html.match(/data-locked="true"/g) ?? []).length).toBe(1);
    expect(html).not.toContain("尚未解锁，暂不可使用");
    expect(html).toContain("已于");
  });
});
