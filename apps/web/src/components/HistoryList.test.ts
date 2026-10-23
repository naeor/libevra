import { describe, expect, it } from "vitest";

import { splitSummary } from "./HistoryList.js";

/**
 * **S16-A 只给服务器的句子排版，不改写它。**
 *
 * `splitSummary` 把 `${actor} ${verb} ${subject}`（见 `apps/api/src/ledger/history.ts`）拆成三段，
 * 让名字、动词、对象可以用不同的颜色。这里钉住的是：拆开再拼回去必须**逐字等于原句**；
 * 形状不对的句子不拆，由组件原样显示。
 */
function rejoin(parts: { actor: string; verb: string; subject: string }): string {
  return `${parts.actor} ${parts.verb} ${parts.subject}`;
}

describe("splitSummary", () => {
  it("splits the server's sentence into actor, verb and subject", () => {
    const entry = { actorName: "张三", summary: "张三 修改了 #000012 午饭" };
    const parts = splitSummary(entry);
    expect(parts).toEqual({ actor: "张三", verb: "修改了", subject: "#000012 午饭" });
    expect(parts === null ? null : rejoin(parts)).toBe(entry.summary);
  });

  it("keeps an actor name that itself contains a space in one piece", () => {
    const entry = { actorName: "Zhang San", summary: "Zhang San 删除了 记录 #000003" };
    const parts = splitSummary(entry);
    expect(parts?.actor).toBe("Zhang San");
    expect(parts?.verb).toBe("删除了");
    expect(parts === null ? null : rejoin(parts)).toBe(entry.summary);
  });

  it("uses the server's fallback name when the actor is unknown", () => {
    expect(splitSummary({ actorName: null, summary: "某人 添加了 一笔账目" })).toEqual({
      actor: "某人",
      verb: "添加了",
      subject: "一笔账目",
    });
  });

  it("handles ledger-level events, whose verb has no space inside", () => {
    expect(splitSummary({ actorName: "naeor", summary: "naeor 变更了成员 这本账" })?.subject).toBe("这本账");
  });

  it("refuses to split a sentence of another shape, so it is shown verbatim", () => {
    expect(splitSummary({ actorName: "张三", summary: "账本已迁移" })).toBeNull();
    expect(splitSummary({ actorName: "张三", summary: "张三 修改了" })).toBeNull();
    expect(splitSummary({ actorName: "李四", summary: "张三 修改了 #000001" })).toBeNull();
  });
});
