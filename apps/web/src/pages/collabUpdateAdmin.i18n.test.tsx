import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * **S16 国际化：协作、软件更新、关于、系统管理在英文界面下不残留中文。**
 *
 * ⚠️ 这里只检查**这些页面自己的文字**。外框 `InnerPage`（返回按钮、页面导航）属于别的模块，
 * 由各自的负责人翻译，所以替换成一个只渲染标题 / 副标题 / 内容的壳——否则那里的“返回”会让
 * 本文件失败，而失败的原因与这些页面无关。
 *
 * ⚠️ 用户数据（昵称、用户名、账本名、留言正文）全部用英文假数据，这样输出里出现的任何中文
 * 都只可能来自界面文字；另有一条用中文账本名，证明用户数据**不会**被翻译或改写。
 */

const now = new Date();
const minutesAgo = (minutes: number): string => new Date(now.getTime() - minutes * 60_000).toISOString();

const fakes = vi.hoisted(() => ({ ledgerName: "Family budget" }));

vi.mock("../components/Layouts.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../components/Layouts.js")>()),
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

vi.mock("../lib/queries.js", async (importOriginal) => {
  const idle = { isPending: false, mutateAsync: () => Promise.resolve() };
  return {
    ...(await importOriginal<typeof import("../lib/queries.js")>()),
    useBookMembers: () => ({
      isPending: false,
      isError: false,
      data: {
        myRole: "owner",
        members: [
          {
            userId: "u1",
            displayName: "Alexandria Montgomery-Fairweather",
            username: "alexandria_montgomery",
            accountNumber: "10000001",
            role: "owner",
            isCreator: true,
          },
          {
            userId: "u2",
            displayName: "Sam",
            username: "sam",
            accountNumber: "10000002",
            role: "viewer",
            isCreator: false,
          },
        ],
      },
    }),
    useChangeMemberRole: () => idle,
    useRemoveMember: () => idle,
    useShareLinks: () => ({
      isSuccess: true,
      data: {
        links: [
          {
            id: "l1",
            role: "editor",
            days: 7,
            maxUses: 10,
            createdAt: "2026-10-20T08:00:00.000Z",
            expiresAt: "2099-10-27T08:00:00.000Z",
            revokedAt: null,
            useCount: 1,
            lastUsedAt: null,
            createdBy: "u1",
            active: true,
          },
          {
            id: "l2",
            role: "viewer",
            days: 1,
            maxUses: 1,
            createdAt: "2026-10-01T08:00:00.000Z",
            expiresAt: "2026-10-02T08:00:00.000Z",
            revokedAt: "2026-10-01T09:00:00.000Z",
            useCount: 0,
            lastUsedAt: "2026-10-01T08:30:00.000Z",
            createdBy: "u1",
            active: false,
          },
        ],
      },
    }),
    useCreateShareLink: () => idle,
    useRevokeShareLink: () => idle,
    useNotifications: () => ({
      isPending: false,
      isSuccess: true,
      data: {
        unreadCount: 2,
        pendingCount: 2,
        notifications: [
          {
            id: "n1",
            kind: "book_invite",
            status: "pending",
            message: "Join us for the trip budget",
            createdAt: minutesAgo(5),
            expiresAt: "2099-01-01T00:00:00.000Z",
            readAt: null,
            decidedAt: null,
            sender: { displayName: "Sam", username: "sam", accountNumber: "10000002" },
            book: { id: "b1", name: "Trip", bookNumber: "40000001" },
          },
          {
            id: "n2",
            kind: "referral_reminder",
            status: "pending",
            // 服务器写成中文的固定句子：英文界面必须按类型换成译文。
            message: "你是用 Sam 的邀请码注册的。想一起记账的话，可以把他邀请进你的账本。",
            createdAt: minutesAgo(10),
            expiresAt: "2099-01-01T00:00:00.000Z",
            readAt: null,
            decidedAt: null,
            sender: { displayName: "Sam", username: "sam", accountNumber: "10000002" },
            book: null,
          },
          {
            id: "n3",
            kind: "book_invite",
            status: "accepted",
            message: null,
            createdAt: minutesAgo(60 * 24 * 3),
            expiresAt: "2099-01-01T00:00:00.000Z",
            readAt: null,
            decidedAt: minutesAgo(60 * 24 * 2),
            sender: { displayName: "Sam", username: "sam", accountNumber: "10000002" },
            book: null,
          },
        ],
      },
    }),
    useMarkNotificationsRead: () => idle,
    useDecideNotification: () => idle,
    useBookMessages: () => ({
      isPending: false,
      isError: false,
      isSuccess: true,
      data: {
        messages: [
          { id: "m1", senderId: "u2", senderName: "Sam", body: "Did we log the groceries?", createdAt: minutesAgo(1), mine: false },
          { id: "m2", senderId: "u1", senderName: "Alex", body: "Yes, this morning.", createdAt: "2026-03-08T06:05:00.000Z", mine: true },
        ],
        total: 2,
      },
    }),
    useSendBookMessage: () => idle,
    useLedger: () => ({ isPending: false, isError: false, data: { book: { name: fakes.ledgerName } } }),
    useLookupAccount: () => idle,
    useInviteToBook: () => idle,
  };
});

const { applyLocale } = await import("../i18n/index.js");
const { MemberList } = await import("../components/MemberList.js");
const { ShareSection } = await import("../components/ShareSection.js");
const { NotificationBell, NotificationPanel } = await import("../components/Notifications.js");
const { MessageBoardFull, MessageBoardSection } = await import("../components/MessageBoard.js");
const { MessageBoardPage } = await import("./MessageBoardPage.js");
const { LedgerInvitePage } = await import("./LedgerInvitePage.js");
const { AboutPage } = await import("./AboutPage.js");
const { SoftwareUpdatePage } = await import("./SoftwareUpdatePage.js");
const { UpdateAnnouncementsPage } = await import("./UpdateAnnouncementsPage.js");
const { UpdateRuntimePage } = await import("./UpdateRuntimePage.js");
const { UpdateMoreSheet } = await import("../components/UpdateMoreSheet.js");
const { AdminLifecyclePage } = await import("./AdminLifecyclePage.js");
const { AdminAuditPage, AdminInvitesPage } = await import("./AdminPages.js");
const { formatRuntimeReport } = await import("../lib/runtimeInfo.js");

const CJK = /[㐀-鿿]/u;

function render(node: React.ReactNode): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={["/"]}>
      <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>
    </MemoryRouter>,
  ).replace(/<!-- -->/g, "");
}

/** 找出输出里的中文片段，失败时直接看到是哪一句漏翻。 */
function cjkFragments(html: string): string[] {
  return html
    .replace(/<[^>]+>/g, "\n")
    .split("\n")
    .filter((line) => CJK.test(line));
}

function attributeFragments(html: string): string[] {
  return [...html.matchAll(/(?:aria-label|placeholder|title)="([^"]*)"/g)]
    .map((match) => match[1] ?? "")
    .filter((value) => CJK.test(value));
}

afterEach(() => {
  applyLocale("zh-CN");
  fakes.ledgerName = "Family budget";
});

describe("英文界面：协作", () => {
  it("成员列表、分享链接、提醒、留言没有中文", () => {
    applyLocale("en-US");

    const html = [
      render(<MemberList />),
      render(<ShareSection bookId="b1" />),
      render(<NotificationBell />),
      render(<NotificationPanel />),
      render(<MessageBoardSection bookId="b1" />),
      render(<MessageBoardFull bookName="Family budget" />),
      render(<MessageBoardPage />),
      render(<LedgerInvitePage />),
    ].join("\n");

    expect(cjkFragments(html)).toEqual([]);
    expect(attributeFragments(html)).toEqual([]);
  });

  it("角色、状态、复数与按类型翻译的服务器提醒", () => {
    applyLocale("en-US");

    const members = render(<MemberList />);
    expect(members).toContain("Owner");
    expect(members).toContain("View only");
    expect(members).toContain("Allow editing");
    // 用户数据原样保留
    expect(members).toContain("Alexandria Montgomery-Fairweather");

    const share = render(<ShareSection bookId="b1" />);
    expect(share).toContain("7 days · 1/10 joined · 9 spots left");
    expect(share).toContain("1 day · 0/1 joined");
    expect(share).toContain("Revoked");
    expect(share).toContain("1 link is active.");

    const panel = render(<NotificationPanel />);
    expect(panel).toContain("Invitation to join “Trip”");
    expect(panel).toContain("2 items are waiting for you.");
    expect(panel).toContain("You signed up with Sam’s invite code.");
    expect(panel).toContain("Join us for the trip budget");

    const board = render(<MessageBoardFull bookName="Family budget" />);
    expect(board).toMatch(/Today \d{1,2}:\d{2}\s?[AP]M/);
    expect(board).toMatch(/Mar 8, \d{1,2}:\d{2}\s?[AP]M/);
  });

  it("账本名是用户数据：中文账本名在英文界面原样出现", () => {
    applyLocale("en-US");
    fakes.ledgerName = "家庭账本";

    expect(render(<LedgerInvitePage />)).toContain("Invite people to “家庭账本”");
  });

  it("中文界面保持原来的文字", () => {
    const members = render(<MemberList />);
    expect(members).toContain("创建者");
    expect(members).toContain("仅查看");
    expect(members).toContain("改为可编辑");

    const share = render(<ShareSection bookId="b1" />);
    expect(share).toContain("7 天 · 已加入 1/10 人 · 还剩 9 个名额");
    expect(share).toContain("生效中 1 条。");

    const panel = render(<NotificationPanel />);
    expect(panel).toContain("邀请你加入「Trip」");
    expect(panel).toContain("你是用 Sam 的邀请码注册的。");
    expect(panel).toContain("有 2 条等着你处理。");

    const board = render(<MessageBoardFull bookName="Family budget" />);
    expect(board).toMatch(/今天 \d{2}:\d{2}/);
    expect(board).toMatch(/3 月 8 日 \d{2}:\d{2}/);
  });
});

describe("英文界面：软件更新、关于、系统管理", () => {
  it("关于页、运行信息、更多菜单、管理页没有中文", () => {
    applyLocale("en-US");

    const html = [
      render(<AboutPage />),
      render(<UpdateRuntimePage />),
      render(<UpdateMoreSheet open onClose={() => undefined} />),
      render(<AdminLifecyclePage />),
      render(<AdminAuditPage />),
      render(<AdminInvitesPage />),
    ].join("\n");

    expect(cjkFragments(html)).toEqual([]);
    expect(attributeFragments(html)).toEqual([]);
    expect(html).toContain("About Libevra");
    expect(html).toContain("Ledger recovery requests");
  });

  it("更新中心的页面框架翻译了（公告正文由内容本地化负责）", () => {
    applyLocale("en-US");

    const home = render(<SoftwareUpdatePage />);
    expect(home).toContain("Updates");
    expect(home).toContain("Recent updates");
    expect(home).toContain("All release notes ›");
    for (const chrome of ["软件更新", "近期更新", "全部公告", "阅读完整公告", "版本信息来自当前构建"]) {
      expect(home).not.toContain(chrome);
    }

    const archive = render(<UpdateAnnouncementsPage />);
    expect(archive).toContain("Release notes");
    expect(archive).toMatch(/Version 1\.\d+/);
    expect(archive).not.toContain("这里只列出已经正式发布的版本");
  });

  it("诊断报告：英文标签、值不变；中文报告逐字不变", () => {
    const snapshot = {
      version: "1.16.08",
      buildStamp: "2026-10-18T00:00:00.000Z",
      buildStampLocal: "2026-10-18 08:00:00",
      serviceWorker: "1 registration, controlling this page",
      online: false,
      offlineReason: "unreachable",
      queryCount: 12,
      liveQueryCount: 9,
      cacheBytes: 1024,
      logCount: 3,
      page: "http://localhost/update/runtime",
      capturedAt: "2026-10-18T00:01:00.000Z",
    } as const;

    applyLocale("en-US");
    const report = formatRuntimeReport(snapshot);
    expect(CJK.test(report)).toBe(false);
    expect(report).toContain("Libevra 1.16.08");
    expect(report).toContain("Build time (UTC): 2026-10-18T00:00:00.000Z");
    expect(report).toContain("Network: Offline (server not responding)");
    expect(report).toContain("Cached items: 12 (9 used by this version)");
    expect(report).toContain("Cache size: 1024 bytes");

    applyLocale("zh-CN");
    expect(formatRuntimeReport(snapshot)).toContain("缓存条目：12 条，其中 9 条当前版本会读");
  });
});
