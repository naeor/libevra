import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useContext } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ViewLedgerContext } from "../lib/workspaceLedger.js";
import { DesktopBookPage } from "./DesktopBookPage.js";
import { DesktopCollabPage } from "./DesktopCollabPage.js";

const state = vi.hoisted(() => ({ members: 1, metadataIds: [] as string[], historyScopes: [] as (string | null)[] }));
vi.mock("../auth/AuthProvider.js", async (original) => ({ ...await original<typeof import("../auth/AuthProvider.js")>(), useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("../lib/queries.js", async (original) => ({
  ...await original<typeof import("../lib/queries.js")>(),
  useBooks: () => ({ data: { books: [{ id: "target", name: "目标账本", memberCount: state.members }] } }),
  useLedgerMeta: (id: string) => {
    state.metadataIds.push(id);
    return { isSuccess: true, data: { book: { id, name: "目标账本", memberCount: state.members, bookNumber: "40000001" }, stats: { createdAt: "2026-10-01", transactionCount: 50, eventCount: 3 } } };
  },
  useLedger: () => ({ isSuccess: true, data: { book: { id: "target", name: "目标账本", memberCount: state.members } } }),
  useBookMembers: () => ({ data: { members: [{ userId: "u1", displayName: "成员甲", role: "owner", isCreator: true }, { userId: "u2", displayName: "成员乙", role: "viewer" }] } }),
  useLedgerHistory: () => {
    state.historyScopes.push(useContext(ViewLedgerContext));
    return { isSuccess: true, data: { total: 1, entries: [{ id: "h1", actorName: "成员甲", kind: "created", summary: "成员甲 添加了一笔测试账目", occurredAt: "2026-10-31T10:00:00Z", transactionId: null, transactionSeq: null, changes: [] }] } };
  },
}));
vi.mock("../components/MemberList.js", () => ({ MemberList: () => <div>完整成员列表</div> }));
vi.mock("../components/MessageBoard.js", () => ({ MessageBoardFull: () => <div data-message-scope={useContext(ViewLedgerContext)}>唯一留言模块</div> }));
vi.mock("../pages/BookSettingsPage.js", () => ({ BookSettingsPage: ({ targetBookId }: { targetBookId: string }) => <div data-settings-target={targetBookId}>设置</div> }));
vi.mock("../pages/LedgerInvitePage.js", () => ({ LedgerInvitePage: () => <div data-invite-scope={useContext(ViewLedgerContext)}>邀请表单</div> }));

function book(path: string): string {
  return renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[path]}><DesktopBookPage bookId="target"><div data-child-editor>分类管理</div></DesktopBookPage></MemoryRouter></QueryClientProvider>);
}

describe("桌面详情和协作的账本上下文", () => {
  it("查看详情明确读取 URL 目标，设置与单人历史使用同一本账", () => {
    state.members = 1; state.metadataIds = []; state.historyScopes = [];
    const html = book("/books/target");
    expect(state.metadataIds).toEqual(["target"]);
    expect(state.historyScopes).toEqual(["target"]);
    expect(html).toContain('data-settings-target="target"');
    expect(html).toContain("成员甲 添加了一笔测试账目");
    expect(html).not.toContain("唯一留言模块");
  });
  it("邀请和设置子页展开时资料仍显示，邀请继承目标账本", () => {
    const invite = book("/books/target?section=invite");
    expect(invite).toContain('data-invite-scope="target"');
    expect(invite).toContain("目标账本");
    const editor = book("/books/target/settings/categories");
    expect(editor).toContain("分类管理");
    expect(editor).toContain("目标账本");
    expect(editor).not.toContain('data-settings-target');
  });
  it("共享详情保留协作链接；协作页历史与留言只出现一份且同属目标账本", () => {
    state.members = 2; state.historyScopes = [];
    expect(book("/books/target")).toContain('href="/ledger?book=target"');
    const html = renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={["/ledger?book=target"]}><DesktopCollabPage /></MemoryRouter></QueryClientProvider>);
    expect(state.historyScopes).toEqual(["target"]);
    expect(html.match(/唯一留言模块/g)).toHaveLength(1);
    expect(html.match(/成员甲 添加了一笔测试账目/g)).toHaveLength(1);
    expect(html).toContain('data-message-scope="target"');
    expect(html).toContain("成员乙");
  });
});
