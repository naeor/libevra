import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyLocale } from "../i18n/index.js";
import { queryKeys } from "../lib/queries.js";
import { DashboardMessages } from "./DashboardMessages.js";

vi.mock("../auth/AuthProvider.js", async original => ({ ...await original<typeof import("../auth/AuthProvider.js")>(), useAuth: () => ({ user: { id: "u1" } }) }));
afterEach(() => applyLocale("zh-CN"));

function render(notifications: object[], counts: Record<string, number>, notices: object[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.notifications, { notifications, unreadCount: notifications.length, pendingCount: notifications.length });
  client.setQueryData(["book-notices", "u1", "unread"], { books: counts });
  client.setQueryData(["book-notices", "u1", "a"], { pages: [{ items: notices.map(n => ({ changes: {}, entry: null, ...n })), nextCursor: null }], pageParams: [null] });
  const html = renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter><DashboardMessages books={[{ id: "a", name: "家庭账本" }]} /></MemoryRouter></QueryClientProvider>);
  client.clear();
  return html;
}

describe("Dashboard 消息来源和未读展示", () => {
  it("账户邀请与账本变更分别显示来源、发送者和时间，不混为一条提醒", () => {
    const html = render([{ id: "n1", kind: "book_invite", status: "pending", readAt: null, createdAt: "2026-11-01T08:00:00Z", sender: { displayName: "邀请者" }, book: { name: "旅行账本" } }], { a: 2 }, [{ id: "b1", readAt: null, actorName: "编辑者", transactionSeq: 12, createdAt: "2026-11-01T09:00:00Z" }]);
    for (const text of ["新消息", "账户提醒", "邀请者", "旅行账本", "家庭账本", "编辑者", "000012", "2 条新提醒"]) expect(html).toContain(text);
    expect(html).not.toContain("暂无新消息");
  });
  it("不显示已处理且已读的邀请；已读计数清零后隐藏账本入口而保留详情宿主", () => {
    const html = render([{ id: "read", status: "accepted", readAt: "2026-11-01", kind: "book_invite" }], { a: 0 }, [{ id: "old", actorName: "旧编辑者", transactionSeq: 1, readAt: null, createdAt: "2026-11-01T09:00:00Z" }]);
    expect(html).toContain("暂无新消息");
    expect(html).not.toContain("查看账户提醒");
    expect(html).toMatch(/<button[^>]*hidden=""[^>]*lv-dash-message-link/);
    expect(html).toContain("<dialog");
  });
  it("英文界面使用英文通知摘要，账本名保留原文", () => {
    applyLocale("en-US");
    const html = render([], { a: 1 }, [{ id: "b1", readAt: null, actorName: "Alex", transactionSeq: 7, createdAt: "2026-11-01T09:00:00Z" }]);
    expect(html).toContain("New messages");
    expect(html).toContain("1 new notification");
    expect(html).toContain("家庭账本");
    expect(html).not.toContain("新提醒");
  });
});
