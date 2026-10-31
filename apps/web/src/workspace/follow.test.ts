import { describe, expect, it } from "vitest";
import { followTargetFor, isFollowDetail } from "./follow.js";
import { entryFromPath, PaneHistory } from "./paneHistory.js";
import { INITIAL_WORKSPACE, workspaceReducer } from "./model.js";

const single = { canSplit: true, splitVisible: false, secondaryOpen: false, mode: "follow" as const };
const details = [["/", "/transactions/t1"], ["/stats", "/stats/cards/c1"], ["/ledger", "/books/b1"], ["/update/announcements", "/update/announcements/1.18.02"]] as const;

const subpages = [
  "/profile", "/profile/avatar", "/books/b1", "/books/b1/settings", "/books/b1/settings/categories",
  "/books/b1/settings/tags", "/books/b1/settings/payment-methods", "/books/b1/settings/export", "/books/b1/settings/duplicates",
  "/start", "/books", "/start/book/b1", "/start/book/b1/members", "/start/book/b1/share",
  "/settings", "/settings/preferences", "/settings/appearance", "/settings/appearance/theme", "/settings/appearance/language",
  "/settings/security", "/settings/account-data", "/settings/password", "/settings/referral-codes", "/settings/recovery-code",
  "/downloads", "/downloads/more", "/downloads/2026-10", "/update", "/update/runtime", "/update/announcements", "/update/announcements/1.18.08",
  "/ledger/more", "/ledger/history", "/ledger/info", "/ledger/members", "/ledger/invite", "/ledger/messages",
  "/categories", "/tags", "/payment-methods", "/export", "/about", "/legal/privacy", "/legal/terms",
  "/admin", "/admin/invites", "/admin/admins", "/admin/users", "/admin/audit", "/admin/lifecycle",
  "/transactions/t1", "/stats/cards/c1",
];

describe("双区跟随的页面覆盖审查", () => {
  const dual = { ...single, splitVisible: true, secondaryOpen: true };
  it.each(subpages)("主区打开 %s 进入辅助区，独立模式保持本区", (to) => {
    expect(followTargetFor(dual, "/me", to)).toBe("secondary");
    expect(isFollowDetail(to)).toBe(true);
    expect(followTargetFor({ ...dual, mode: "independent" }, "/me", to)).toBeNull();
  });
  it.each(["/", "/stats", "/stats/", "/ledger", "/me", "/workspace/start", "/login", "/register", "/guest", "/recover", "/recover-archive", "/join/token", "/legal/document-id", "/lab/charts", "/add", "/scan", "/record", "/paste", "/paste/review", "/voice/review", "/ocr/overview", "/ocr/overview/c1", "/import", "/import-ledger", "/books/b1/settings/import"])("主导航、公开页与临时流程 %s 不被搬移", (to) => {
    expect(followTargetFor(dual, "/profile", to)).toBeNull();
  });
  it("同页筛选不分流；后续新增的普通子页面默认参与跟随", () => {
    expect(followTargetFor(dual, "/profile", "/profile")).toBeNull();
    expect(followTargetFor(dual, "/me", "/settings/new-page")).toBe("secondary");
  });
  it("通过实际 PaneHistory 拦截保留主区路径、账本来源状态与辅助区独立返回栈", () => {
    const main = new PaneHistory("w1", [entryFromPath("/me")]);
    const aux = new PaneHistory("w2", [entryFromPath("/workspace/start")]);
    main.setInterceptor(({ from, to }) => {
      if (followTargetFor(dual, from.pathname, to.pathname) === null) return false;
      aux.open(to.pathname + to.search, { replace: isFollowDetail(aux.location.pathname), state: to.state });
      return true;
    });
    main.push("/profile?edit=1", { from: "/me", marker: "source-state" });
    expect(main.location.pathname).toBe("/me");
    expect(main.snapshot.length).toBe(1);
    expect(aux.location).toMatchObject({ pathname: "/profile", search: "?edit=1", state: { from: "/me", marker: "source-state" } });
    main.push("/books/book-a");
    expect(main.location.pathname).toBe("/me");
    expect(aux.location.pathname).toBe("/books/book-a");
    expect(aux.snapshot.length).toBe(2);
    aux.go(-1);
    expect(aux.location.pathname).toBe("/workspace/start");
  });
});

describe("单工作区的详情自动展开", () => {
  it.each(details)("%s → %s 自动打开辅助区", (from, to) => {
    expect(followTargetFor(single, from, to)).toBe("open-secondary");
    expect(followTargetFor({ ...single, mode: "independent" }, from, to)).toBe("open-secondary");
  });

  it("手机、空间不足和暂隐的已打开双区不被强行展开", () => {
    expect(followTargetFor({ ...single, canSplit: false }, "/", "/transactions/t1")).toBeNull();
    expect(followTargetFor({ ...single, secondaryOpen: true }, "/", "/transactions/t1")).toBeNull();
  });

  it("双区跟随继续替换详情，双区独立保留原来的导航行为", () => {
    const dual = { ...single, splitVisible: true, secondaryOpen: true };
    expect(followTargetFor(dual, "/stats", "/stats/cards/c1")).toBe("secondary");
    expect(followTargetFor({ ...dual, mode: "independent" }, "/stats", "/stats/cards/c1")).toBeNull();
  });

  it.each([["/", "/stats"], ["/me", "/settings"], ["/", "/add"], ["/transactions/t1", "/transactions/t2"], ["/stats/cards/c1", "/stats/cards/c1"]])("普通导航 %s → %s 不自动分区", (from, to) => {
    expect(followTargetFor(single, from, to)).toBeNull();
  });

  it("晋升过的主区重新展开仍跟随，不交换实例、账本或比例", () => {
    const dual = workspaceReducer(INITIAL_WORKSPACE, { type: "openSecondary", independent: true });
    const books = { ...dual, ledgers: { w1: "book-a", w2: "book-b" }, ratio: 0.7 };
    const collapsed = workspaceReducer(books, { type: "collapse", side: "primary" });
    expect(followTargetFor({ ...single, mode: collapsed.mode }, "/", "/transactions/t1")).toBe("open-secondary");
    const opened = workspaceReducer(workspaceReducer(collapsed, { type: "openSecondary", independent: false }), { type: "setMode", mode: "follow" });
    expect(opened).toMatchObject({ primary: "w2", secondary: "w1", secondaryOpen: true, mode: "follow", ratio: 0.7, ledgers: books.ledgers });
    expect(collapsed.secondaryOpen).toBe(false);
  });
});
