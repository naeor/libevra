import { describe, expect, it } from "vitest";
import { PaneHistory, entryFromPath } from "../workspace/paneHistory.js";
import { entryBackTarget, entryReturnState } from "./entryReturn.js";
import { currentLedgerDestination } from "./currentLedgerDestination.js";

function back(history: PaneHistory) {
  const target = entryBackTarget(history.location.state, history.previousLocation);
  if (target.pop) history.go(-1); else history.replace(target.fallback, null);
}
describe("账目详情的明确来源", () => {
  for (const path of ["/ledger/history", "/?month=2026-10&f.tags=a", "/stats/cards/card-a?range=year", "/books/book-a"]) {
    it(`${path} 连续返回消耗详情记录，浏览器前进仍保留来源`, () => {
      const history = new PaneHistory("w2", [entryFromPath("/ledger", "default")]);
      history.push(path);
      const origin = history.location;
      history.push("/transactions/entry-a", entryReturnState(origin));
      back(history);
      expect(history.location).toEqual(origin);
      history.go(1);
      back(history);
      expect(history.location).toEqual(origin);
      history.go(-1);
      expect(history.location.pathname).toBe("/ledger");
    });
  }
  it("深链与非法来源只替换到明细，不增加历史", () => {
    // 1.19.81：账目详情本身（“相关账目”打开的另一笔）是合法来路，见下一条；记账工作区、登录与站外地址仍不是。
    for (const state of [null, { from: "/transactions/b" }, entryReturnState(entryFromPath("/add")), entryReturnState(entryFromPath("/login")), entryReturnState(entryFromPath("//evil.test"))]) {
      const history = new PaneHistory("w2", [entryFromPath("/transactions/a", "default", state)]);
      back(history);
      expect(history.location.pathname).toBe("/");
      expect(history.snapshot.length).toBe(1);
      expect(history.location.state).toBeNull();
    }
  });
  it("刷新或跨工作区来源不匹配时不后退到不相关页面，也不传递来源", () => {
    const source = entryFromPath("/ledger/history?book=a", "source");
    const state = entryReturnState(source);
    expect(entryBackTarget(state, entryFromPath("/stats", "other"))).toEqual({ pop: false, fallback: "/ledger/history?book=a" });
    const refreshed = new PaneHistory("w1", [entryFromPath("/transactions/a", "entry", state)]);
    back(refreshed);
    expect(refreshed.location.pathname).toBe("/ledger/history");
    expect(refreshed.snapshot.length).toBe(1);
    expect(refreshed.location.state).toBeNull();
  });
  it("切换账本清理对象筛选，保留功能页和通用条件", () => {
    expect(currentLedgerDestination("/stats", "?month=2026-10&category=a&categoryBranch=b&tag=c&payment=d&currency=CNY")).toBe("/stats?month=2026-10&currency=CNY");
    expect(currentLedgerDestination("/", "?f.categories=a&f.tags=b&f.payments=c&month=all&f.attachment=has")).toBe("/?month=all&f.attachment=has");
  });
  it("刷新后仅匹配明确来源的浏览器位置才后退", () => {
    const entryOrigin = { ...entryFromPath("/ledger/history", "source"), browserIndex: 2 };
    expect(entryBackTarget({ entryOrigin }, undefined, 2).pop).toBe(true);
    expect(entryBackTarget({ entryOrigin }, undefined, 3).pop).toBe(false);
    expect(entryBackTarget({ entryOrigin }, undefined).pop).toBe(false);
    expect(entryBackTarget({ entryOrigin: { ...entryOrigin, pathname: "/scan" } }, undefined, 2).pop).toBe(false);
  });
  it("1.19.81：重复检查、附件、通知、外币状态、相关账目打开的账目详情，返回回到来源页", () => {
    for (const path of ["/duplicates", "/attachments?book=a", "/transactions/b", "/stats", "/books/a/settings/attachments"]) {
      const source = entryFromPath(path, "source");
      expect(entryBackTarget(entryReturnState(source), source)).toEqual({ pop: true, fallback: path });
    }
  });
});
