import { afterEach, describe, expect, it } from "vitest";

import { applyLocale } from "../i18n/index.js";
import type { LedgerHistoryEntry } from "../lib/queries.js";
import { historyChangeText, historySentenceText, splitSummary } from "./HistoryList.js";

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

/**
 * **S16：服务器只给中文句子，英文界面在浏览器端按结构化字段重组。**
 *
 * 中文界面必须逐字显示服务器原文；英文界面用 `kind` / `actorName` / `transactionSeq` 说同一件事，
 * 句子里的名字（备注或分类名）是用户数据，原样保留；认不出的句子原样显示。
 */
describe("history wording by language", () => {
  afterEach(() => {
    applyLocale("zh-CN");
  });

  function event(overrides: Partial<LedgerHistoryEntry>): LedgerHistoryEntry {
    return {
      id: "ev-1",
      kind: "updated",
      occurredAt: "2026-10-20T08:00:00.000Z",
      actorName: "naeor",
      transactionId: "tx-1",
      transactionSeq: 12,
      summary: "naeor 修改了 #000012 午饭",
      changes: [],
      ...overrides,
    };
  }

  it("shows the server's sentence verbatim in Chinese", () => {
    expect(historySentenceText(event({}))).toBe("naeor 修改了 #000012 午饭");
    expect(historyChangeText({ label: "金额", from: "3500", to: "3800" })).toBe("金额：3500 → 3800");
  });

  it("rebuilds the sentence in English and keeps the user's own words", () => {
    applyLocale("en-US");

    expect(historySentenceText(event({}))).toBe("naeor edited #000012 午饭");
    expect(
      historySentenceText(event({ kind: "deleted", actorName: null, summary: "某人 删除了 记录 #000003", transactionSeq: 3 })),
    ).toBe("Someone deleted entry #000003");
    expect(
      historySentenceText(event({ kind: "created", transactionSeq: null, transactionId: null, summary: "naeor 添加了 一笔账目" })),
    ).toBe("naeor added an entry");
    expect(
      historySentenceText(event({ kind: "member_changed", transactionSeq: null, summary: "naeor 变更了这本账的成员" })),
    ).toBe("naeor changed this ledger’s members");
  });

  it("translates the server's field names and fixed values only where the server writes them", () => {
    applyLocale("en-US");

    expect(historyChangeText({ label: "金额", from: "3500", to: "3800" })).toBe("Amount: 3500 → 3800");
    expect(historyChangeText({ label: "成员权限", from: "仅查看", to: "可编辑" })).toBe("Member access: View only → Can edit");
    expect(historyChangeText({ label: "备注", from: "（空）", to: "收入" })).toBe("Note: (empty) → 收入");
    /** 不认识的字段名原样显示，宁可是中文也不编造。 */
    expect(historyChangeText({ label: "新字段", from: "a", to: "b" })).toBe("新字段: a → b");
  });
});
