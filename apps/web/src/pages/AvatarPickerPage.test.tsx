import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startLanguageRuntime } from "../lib/languageRuntime.js";
import { AvatarPickerPage } from "./AvatarPickerPage.js";
import { avatarLabel, avatarDescription } from "../components/UserAvatar.js";
import { isClassicAvatarId, isSpecialAvatarId, SELECTABLE_AVATAR_IDS } from "@libellum/shared";

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

describe("第二批经典头像", () => {
  const confirmed = [
    ["jade", "玉净", "甘露妙法，杨枝玉净"],
    ["ghost", "幽幽", "呜呜呜……别被吓到哦～"],
    ["ingot", "元宝", "摸摸元宝，招财进宝"],
    ["breakfast-sun", "「太阳」", "吃下一枚“太阳”，一整天都会更温暖"],
  ] as const;
  for (const [id, name, caption] of confirmed) {
    it(`${id} 默认可选，名称题注逐字保留，未归入特典`, () => {
      state.avatarId = id;
      expect(SELECTABLE_AVATAR_IDS).toContain(id);
      expect(isClassicAvatarId(id)).toBe(true);
      expect(isSpecialAvatarId(id)).toBe(false);
      expect(avatarLabel(id)).toBe(name);
      expect(avatarDescription(id)).toBe(caption);
      const html = render();
      const classic = html.split('id="avatars-basic"')[1]!.split('id="avatars-special"')[0]!;
      expect(classic).toContain(`aria-label="${name}"`);
      expect(classic).not.toContain('data-locked="true"');
      expect(html).toContain(caption);
      expect(html).not.toContain("尚未解锁，暂不可使用");
    });
  }
  it("英文名称保留 U+300C/U+300D，旧太阳和特典保持独立", () => {
    runtime.choose("en-US");
    state.avatarId = "breakfast-sun";
    expect(avatarLabel("breakfast-sun")).toBe("「Sun」");
    expect([...avatarLabel("breakfast-sun")].map(c => c.codePointAt(0))).toEqual([0x300c, 0x53, 0x75, 0x6e, 0x300d]);
    expect(avatarLabel("sun")).toBe("Sun");
    expect(isSpecialAvatarId("daoxuan-special")).toBe(true);
    expect(isSpecialAvatarId("descent-special")).toBe(true);
    expect(render()).toContain("A little “sun” for breakfast, and warmth all day");
    expect(render()).not.toMatch(/[\u3400-\u9fff]/u);
  });
});

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
  it("万圣归入特典，题注与万圣节领取条件准确显示", () => {
    state.avatarId = "halloween-special";
    const html = render();
    expect(html).toContain("不给糖就捣蛋！");
    expect(html).toContain("每年 10 月 31 日（万圣节）登录即可领取");
    expect(html).toContain("尚未解锁，暂不可使用");
    expect(html.split('id="avatars-special"')[1]).toContain('aria-label="万圣"');
    runtime.choose("en-US");
    expect(render()).toContain("Trick or treat!");
    expect(render()).toContain("Sign in on October 31 (Halloween) each year to claim");
  });
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

    // 倒悬与万圣仍未解锁。
    expect((html.match(/data-locked="true"/g) ?? []).length).toBe(2);
    expect(html).not.toContain("尚未解锁，暂不可使用");
    expect(html).toContain("已于");
  });
});
