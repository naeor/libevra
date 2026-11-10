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
    /** 1.19.56：角色名改为 只读 / 记账 / 编辑全部；原事件里已经写成文字的值照原样显示。 */
    expect(entries[0]?.changes[1]).toEqual({ label: "成员权限", from: "只读", to: "可编辑" });
    expect(JSON.stringify(row)).toBe(before);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { bookId: "book" }, take: 20 }));
  });

  it("角色与邀请设置的值按 1.19.56 的名称显示", async () => {
    const row = {
      id: "event2", kind: "book_changed", occurredAt: new Date("2026-11-10T00:00:00Z"),
      actorName: "小林", transactionId: null, transactionSeq: null, transaction: null,
      changes: { role: { from: "recorder", to: "editor" }, invitePolicy: { from: false, to: true } },
    };
    const prisma = { transactionEvent: { findMany: vi.fn().mockResolvedValue([row]) } } as unknown as PrismaClient;
    const entries = await readHistory(prisma, "book", 20);
    expect(entries[0]?.changes).toEqual([
      { label: "成员权限", from: "记账", to: "编辑全部" },
      { label: "邀请", from: "所有成员都能邀请", to: "只有管理员能邀请" },
    ]);
  });
});
