import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../src/db.js";
import { readHistory } from "../src/ledger/history.js";

describe("历史记录展示文案", () => {
  it("成员事件使用完整中文句子和字段名称，不改变原事件或原始值", async () => {
    const row = {
      id: "event", kind: "member_changed", occurredAt: new Date("2026-10-23T00:00:00Z"),
      actorName: "小林", transactionId: null, transactionSeq: null, transaction: null,
      changes: { joined: { from: null, to: "小王" }, role: { from: "viewer", to: "可编辑" },
        removed: { from: "小李", to: null }, left: { from: "小张", to: null },
        futureField: { from: "原值", to: "新值" } },
    };
    const findMany = vi.fn().mockResolvedValue([row]);
    const prisma = { transactionEvent: { findMany } } as unknown as PrismaClient;
    const before = JSON.stringify(row);
    const entries = await readHistory(prisma, "book", 20);
    expect(entries[0]?.summary).toBe("小林 变更了这本账的成员");
    expect(entries[0]?.changes.map((change) => change.label)).toEqual([
      "加入账本", "成员权限", "移除成员", "退出账本", "其他变更",
    ]);
    expect(entries[0]?.changes[1]).toEqual({ label: "成员权限", from: "仅查看", to: "可编辑" });
    expect(JSON.stringify(row)).toBe(before);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { bookId: "book" }, take: 20 }));
  });
});
