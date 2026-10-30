import { describe, expect, it } from "vitest";
import { followTargetFor } from "./follow.js";
import { INITIAL_WORKSPACE, workspaceReducer } from "./model.js";

const single = { canSplit: true, splitVisible: false, secondaryOpen: false, mode: "follow" as const };
const details = [["/", "/transactions/t1"], ["/stats", "/stats/cards/c1"], ["/ledger", "/books/b1"], ["/update/announcements", "/update/announcements/1.18.02"]] as const;

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
