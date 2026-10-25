import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearMissingTranslationKeys, missingTranslationKeys, t } from "../i18n/index.js";
import { zhCN } from "../i18n/resources/index.js";
import { startLanguageRuntime } from "../lib/languageRuntime.js";
import { ArchiveRecoveryPage } from "./ArchiveRecoveryPage.js";
import { AccountDataPage, blockedReasonText, confirmationAccepted } from "./AccountDataPage.js";
import { GuestMePage } from "./GuestMePage.js";
import { JoinPage } from "./JoinPage.js";
import { LegalDocumentPage } from "./LegalDocumentPage.js";
import { LegalPage } from "./LegalPage.js";
import { LoginPage } from "./LoginPage.js";
import { MePage } from "./MePage.js";
import { ProfilePage } from "./ProfilePage.js";
import { AvatarPickerPage } from "./AvatarPickerPage.js";
import { RecoverPage } from "./RecoverPage.js";
import { RegisterPage } from "./RegisterPage.js";

/**
 * **S16 国际化：登录 / 账号 / 法律 / 游客 / 「我的」在英文界面下不残留中文。**
 *
 * 用静态渲染（本仓库没有 DOM 测试环境）：切到英文 → 渲染页面 → 断言输出里没有中文字符，且没有缺键。
 * 例外都是刻意的：登录页右上角的语言切换显示**另一种语言的自称**（英文界面显示「中文」），
 * 协议文件的标题与正文是用户要同意的中文原文。
 */

const state = vi.hoisted(() => ({
  user: null as null | {
    id: string;
    username: string;
    displayName: string;
    accountNumber: string;
    createdAt: string;
  },
  sessionRevoked: false,
  sessionEndReason: null as null | string,
}));

vi.mock("../auth/AuthProvider.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../auth/AuthProvider.js")>()),
  useAuth: () => ({
    user: state.user,
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    sessionRevoked: state.sessionRevoked,
    sessionEndReason: state.sessionEndReason,
  }),
  // 游客判断读这个；`null` = 没有正式账号的上下文（浏览器里也没有游客身份）。
  useAuthOptional: () => null,
}));

/** 只替换这些页面用到的查询；数据用英文，避免把「数据里的中文」误判为漏翻。 */
vi.mock("../lib/queries.js", () => ({
  useLedger: () => ({ data: undefined }),
  useBooks: () => ({ data: { books: [{ id: "book-1", name: "Family" }] } }),
  useCurrentBookId: () => "book-1",
  useShareLinkPreview: () => ({
    isPending: false,
    isError: false,
    data: { alreadyMember: false, bookName: "Trip", bookNumber: null, createdByName: "Ada", role: "editor" },
  }),
  useJoinViaShareLink: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

/**
 * 页面框架（底栏、返回按钮、离线状态条）属于别的模块，需要整套应用上下文；这里只检查页面**自己的**
 * 文字，所以把框架换成只输出标题与内容的替身。
 */
vi.mock("../components/Layouts.js", () => ({
  TabPage: ({ children }: { readonly children: React.ReactNode }) => <>{children}</>,
  InnerPage: ({
    title,
    subtitle,
    children,
  }: {
    readonly title: string;
    readonly subtitle?: string;
    readonly children: React.ReactNode;
  }) => (
    <main>
      <h1>{title}</h1>
      {subtitle === undefined ? null : <p>{subtitle}</p>}
      {children}
    </main>
  ),
}));

const CJK = /[㐀-鿿]/u;

/** 去掉语言切换按钮（它在英文界面显示「中文」，是刻意的）。 */
function withoutLanguageSwitch(html: string): string {
  return html.replace(/<button[^>]*data-testid="language-switch"[\s\S]*?<\/button>/, "");
}

function render(node: React.ReactElement, path = "/"): string {
  return renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[path]}>{node}</MemoryRouter></QueryClientProvider>);
}

function expectNoChinese(html: string): void {
  const match = CJK.exec(html);
  expect(match === null ? null : html.slice(Math.max(0, match.index - 60), match.index + 60)).toBeNull();
}

const runtime = startLanguageRuntime();

beforeEach(() => {
  state.user = null;
  state.sessionRevoked = false;
  state.sessionEndReason = null;
  clearMissingTranslationKeys();
});

afterEach(() => {
  runtime.choose("zh-CN");
});

describe("英文界面：登录前的页面", () => {
  beforeEach(() => {
    runtime.choose("en-US");
  });

  it("登录页（含账号已注销提示）没有中文", () => {
    state.sessionRevoked = true;
    state.sessionEndReason = "account_closed";
    const html = render(<LoginPage />, "/login");

    expect(html).toContain("Sign in");
    expect(html).toContain("This account has been closed");
    expect(html).toContain("Continue as guest");
    expect(html).toContain("the free, open ledger");
    expect(html).toContain('aria-label="Show password"');
    expectNoChinese(withoutLanguageSwitch(html));
    expect(missingTranslationKeys()).toEqual([]);
  });

  it("创建账号（确认注册方式中）、找回密码、恢复归档账本没有中文", () => {
    for (const [node, path] of [
      [<RegisterPage key="register" />, "/register"],
      [<RecoverPage key="recover" />, "/recover"],
      [<ArchiveRecoveryPage key="archive" />, "/recover-archive"],
    ] as const) {
      expectNoChinese(withoutLanguageSwitch(render(node, path)));
    }
    expect(missingTranslationKeys()).toEqual([]);
  });
});

describe("英文界面：账号页面", () => {
  beforeEach(() => {
    runtime.choose("en-US");
    state.user = {
      id: "user-1",
      username: "ada",
      displayName: "Ada",
      accountNumber: "100001",
      createdAt: "2026-10-01T08:00:00.000Z",
    };
  });

  it("「我的」、个人资料、账号与数据没有中文", () => {
    const me = render(<MePage />, "/me");
    expect(me).toContain("Sign out");
    expect(me).toContain("Profile");
    expectNoChinese(me);

    const profile = render(<ProfilePage />, "/profile");
    expect(profile).toContain("Never share your recovery code");
    expectNoChinese(profile);
    expectNoChinese(render(<ProfilePage />, "/profile?edit=1"));
    const avatars = render(<AvatarPickerPage />, "/profile/avatar");
    expectNoChinese(avatars);
    expect(avatars).toContain("Classic Collection");
    expect(avatars).toContain("Special Collection");
    expect(avatars).toContain("First Bloom");
    expect(avatars).toContain("Let a little flower bloom, and add a touch of beauty.");
    expect(avatars).not.toContain("Tap to preview");

    expectNoChinese(render(<AccountDataPage />, "/settings/account-data"));
    expect(missingTranslationKeys()).toEqual([]);
  });

  it("加入账本确认页没有中文", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/join/token-1"]}>
        <Routes>
          <Route path="/join/:token" element={<JoinPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(html).toContain("Join ledger");
    expect(html).toContain("Can edit");
    expectNoChinese(html);
  });
});

describe("游客「我的」页", () => {
  it("英文界面没有中文，并有语言入口", () => {
    runtime.choose("en-US");
    const html = render(<GuestMePage />, "/me");

    expect(html).toContain('data-testid="guest-language-row"');
    expect(html).toContain(">Language<");
    expect(html).toContain("English");
    expectNoChinese(html);
    expect(missingTranslationKeys()).toEqual([]);
  });

  it("中文界面的语言入口写着「语言 / Language」，切到看不懂的语言也能找回", () => {
    const html = render(<GuestMePage />, "/me");

    expect(html).toContain("语言 / Language");
    expect(html).toContain("简体中文");
    expect(html).toContain("清除游客数据");
  });
});

describe("法律页面", () => {
  it("隐私政策 / 使用条款占位页在英文界面没有中文", () => {
    runtime.choose("en-US");
    for (const kind of ["privacy", "terms"] as const) {
      const html = render(<LegalPage kind={kind} />, `/${kind}`);
      expect(html).toContain("it is not");
      expectNoChinese(html);
    }
    expect(missingTranslationKeys()).toEqual([]);
  });

  function renderDocument(): string {
    return renderToStaticMarkup(
      <MemoryRouter initialEntries={["/legal/local-test-terms"]}>
        <Routes>
          <Route path="/legal/:documentId" element={<LegalDocumentPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("协议正文保持中文原文；英文界面说明以中文版本为准", () => {
    runtime.choose("en-US");
    const html = renderDocument();

    if (html.includes("<article")) {
      // 开发 / 测试构建能看到本地测试协议：正文是中文原文，并标注语言。
      expect(html).toContain('lang="zh-CN"');
      expect(html).toContain("available in Chinese only");
    } else {
      expectNoChinese(html);
    }
  });

  it("中文界面不显示「只有中文版本」的说明", () => {
    expect(renderDocument()).not.toContain(t("legal.chineseOnly"));
  });
});

describe("注销 / 删除数据的确认短语", () => {
  const SERVER = "删除服务器数据";

  it("中文界面：只认服务器原文，判断与以前相同", () => {
    expect(confirmationAccepted(SERVER, SERVER, SERVER)).toBe(true);
    expect(confirmationAccepted(` ${SERVER}`, SERVER, SERVER)).toBe(false);
    expect(confirmationAccepted("Delete server data", SERVER, SERVER)).toBe(false);
  });

  it("英文界面：接受英文短语（忽略大小写与首尾空格），也仍然接受服务器原文", () => {
    expect(confirmationAccepted("Delete server data", SERVER, "Delete server data")).toBe(true);
    expect(confirmationAccepted(" delete server data ", SERVER, "Delete server data")).toBe(true);
    expect(confirmationAccepted(SERVER, SERVER, "Delete server data")).toBe(true);
    expect(confirmationAccepted("Delete", SERVER, "Delete server data")).toBe(false);
    expect(confirmationAccepted("", SERVER, "Delete server data")).toBe(false);
  });

  it("中文短语与服务器要求的原文逐字一致", () => {
    expect(zhCN.account.data.deletePhrase).toBe("删除服务器数据");
    expect(zhCN.account.data.closePhrase).toBe("注销账号");
  });
});

describe("服务器给的「暂时不能处理」原因", () => {
  const purging = "这本账正在清理。";

  it("中文界面原样显示", () => {
    expect(blockedReasonText(purging)).toBe(purging);
  });

  it("英文界面按原文查到译文，查不到就原样显示", () => {
    runtime.choose("en-US");
    expect(blockedReasonText(purging)).toBe("This ledger is being cleaned up.");
    expect(blockedReasonText("未知的新原因")).toBe("未知的新原因");
  });
});

describe("文案语气（与 copy.test.ts 的 register 规则相同）", () => {
  it("「我的」与个人资料的中文文案没有口语化说法", () => {
    const text = JSON.stringify([zhCN.account.me, zhCN.account.profile]);
    for (const colloquial of ["都是 0", "还没有", "没什么", "搞定", "挺好的"]) {
      expect(text).not.toContain(colloquial);
    }
  });
});
