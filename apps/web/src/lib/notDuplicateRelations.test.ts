import { notDuplicatePairKey } from "@libellum/shared";
import { describe, expect, it } from "vitest";

import { notDuplicateConfirmationForEntry } from "./notDuplicateRelations.js";

/**
 * S15-E3 · 拍照记账「确认不是同一笔」时提交的 pairs。
 *
 * 这里检查的是**只配对新账与对话框里列出的那几笔**：用户这次只对"新这笔和它们"表态，
 * 没有对那几笔旧记录彼此表态，所以不能顺手把它们两两配对。
 */

const NEW = "01980000-0000-7000-8000-000000000003";
const A = "01980000-0000-7000-8000-000000000001";
const B = "01980000-0000-7000-8000-000000000002";

describe("notDuplicateConfirmationForEntry", () => {
  it("一笔重复候选 → 一条规范化配对", () => {
    expect(notDuplicateConfirmationForEntry([A], NEW)).toEqual({
      pairs: [{ transactionIdA: A, transactionIdB: NEW }],
      decisionSource: "manual",
    });
  });

  it("交易 id 的顺序不影响规范化结果", () => {
    const input = notDuplicateConfirmationForEntry([B], A);
    expect(input?.pairs).toEqual([{ transactionIdA: A, transactionIdB: B }]);
  });

  it("多笔重复候选 → 每条都与新账配对，不把旧记录彼此配对", () => {
    const input = notDuplicateConfirmationForEntry([B, A], NEW);

    expect(input?.pairs).toHaveLength(2);
    expect(input?.pairs).toEqual([
      { transactionIdA: A, transactionIdB: NEW },
      { transactionIdA: B, transactionIdB: NEW },
    ]);
    expect(
      input?.pairs?.some(
        (pair) =>
          notDuplicatePairKey(pair.transactionIdA, pair.transactionIdB) === notDuplicatePairKey(A, B),
      ),
    ).toBe(false);
    expect(input?.decisionSource).toBe("review_group");
  });

  it("重复列出同一笔时只保留一条", () => {
    const input = notDuplicateConfirmationForEntry([A, A], NEW);
    expect(input?.pairs).toHaveLength(1);
  });

  it("没有候选、或候选就是新账本身 → null（不提交空请求）", () => {
    expect(notDuplicateConfirmationForEntry([], NEW)).toBeNull();
    expect(notDuplicateConfirmationForEntry([NEW], NEW)).toBeNull();
  });
});
