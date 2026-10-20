import type { Category, PaymentMethod, Tag, Transaction } from "@libellum/shared";
import { describe, expect, it } from "vitest";

import {
  EMPTY_BATCH_DRAFT,
  allLoadedSelected,
  batchDeleteConfirmation,
  batchPermission,
  buildBatchEdit,
  draftTouchesAnything,
  entryTapAction,
  selectAllLoaded,
  selectedLoadedIds,
  summarizeBatch,
  toggleSelection,
  type BatchEditDraft,
  type BatchItemResult,
} from "./batch.js";

/**
 * The rules of the ledger's batch mode.
 *
 * ⚠️ **These are the assertions that must never be allowed to drift**, because each one is a way a
 * batch operation could destroy data rather than a way it could look wrong: which fields a run
 * touches, whether "select all" can reach entries outside the screen, whether a partial failure is
 * reported, and whether the button is offered to somebody who cannot write.
 *
 * The workspace has no DOM (see `vitest.config.ts`), which is exactly why every one of those rules
 * was put in a plain function instead of in an event handler.
 */

function tag(id: string, name = id): Tag {
  return { id, name, color: "#123456" };
}

function category(overrides: Partial<Category> & { id: string }): Category {
  return {
    name: overrides.id,
    kind: "expense",
    description: null,
    isSystem: false,
    isArchived: false,
    sortOrder: 0,
    ...overrides,
  };
}

function paymentMethod(id: string, overrides: Partial<PaymentMethod> = {}): PaymentMethod {
  return { name: id, isArchived: false, sortOrder: 0, id, ...overrides };
}

function entry(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "e1",
    kind: "expense",
    amountCents: 1234,
    currency: "CNY",
    categoryId: "c-food",
    categoryName: "吃饭",
    categoryIsSystem: false,
    paymentMethodId: "p-cash",
    paymentMethodName: "现金",
    occurredAt: "2026-10-10T09:12:00+08:00",
    occurredLocalDate: "2026-10-10",
    occurredTz: "Asia/Shanghai",
    note: "午饭",
    tags: [tag("t-a")],
    version: 3,
    ...overrides,
  };
}

const LEDGER = {
  categories: [
    category({ id: "c-food" }),
    category({ id: "c-travel", name: "出行" }),
    category({ id: "c-salary", name: "工资", kind: "income" }),
    category({ id: "c-old", name: "旧分类", isArchived: true }),
  ],
  paymentMethods: [paymentMethod("p-cash"), paymentMethod("p-card", { name: "银行卡" })],
  tags: [tag("t-a"), tag("t-b")],
};

describe("selection", () => {
  it("toggles one id and back", () => {
    const once = toggleSelection(new Set<string>(), "e1");
    expect([...once]).toEqual(["e1"]);

    const twice = toggleSelection(once, "e1");
    expect(twice.size).toBe(0);
  });

  it("selects exactly the loaded entries, never more", () => {
    const selected = selectAllLoaded(["e1", "e2"], new Set<string>());

    expect([...selected].sort()).toEqual(["e1", "e2"]);
    expect(allLoadedSelected(["e1", "e2"], selected)).toBe(true);
  });

  it("clears the selection when everything loaded is already selected", () => {
    const selected = selectAllLoaded(["e1"], new Set(["e1"]));

    expect(selected.size).toBe(0);
  });

  it("never counts an id that is no longer loaded", () => {
    // The selection is filtered through the loaded list before anything is acted on, so a filter
    // change can never leave an invisible tick waiting to be deleted.
    expect(selectedLoadedIds(["e2"], new Set(["e1", "e2"]))).toEqual(["e2"]);
  });

  it("reports an empty list as 'nothing selected' rather than 'all selected'", () => {
    expect(allLoadedSelected([], new Set(["e1"]))).toBe(false);
  });
});

describe("entryTapAction", () => {
  it("toggles instead of navigating while selecting — even on a conflicted row", () => {
    expect(entryTapAction({ selecting: true, conflicted: true })).toBe("toggle-selection");
    expect(entryTapAction({ selecting: true, conflicted: false })).toBe("toggle-selection");
  });

  it("keeps the existing conflict-before-editor rule outside batch mode", () => {
    expect(entryTapAction({ selecting: false, conflicted: true })).toBe("settle-conflict");
    expect(entryTapAction({ selecting: false, conflicted: false })).toBe("open-entry");
  });
});

describe("batchPermission", () => {
  it("refuses a guest, who has no batch entry point either", () => {
    const permission = batchPermission({
      guest: true,
      shared: false,
      sharedOfflineReadOnly: false,
      role: { status: "idle" },
    });

    expect(permission.allowed).toBe(false);
    expect(permission.reason).toContain("游客");
  });

  it("refuses a shared ledger while offline, using the existing read-only rule", () => {
    const permission = batchPermission({
      guest: false,
      shared: true,
      sharedOfflineReadOnly: true,
      role: { status: "ready", role: "editor" },
    });

    expect(permission.allowed).toBe(false);
    expect(permission.reason).toContain("当前离线");
  });

  it("allows a personal ledger without asking for a role", () => {
    // One member, who is its owner: an extra request per visit would buy nothing.
    const permission = batchPermission({
      guest: false,
      shared: false,
      sharedOfflineReadOnly: false,
      role: { status: "idle" },
    });

    expect(permission).toEqual({ allowed: true, reason: null });
  });

  it("refuses a viewer in a shared ledger", () => {
    const permission = batchPermission({
      guest: false,
      shared: true,
      sharedOfflineReadOnly: false,
      role: { status: "ready", role: "viewer" },
    });

    expect(permission.allowed).toBe(false);
    expect(permission.reason).toContain("仅查看");
  });

  it("allows an editor and an owner in a shared ledger", () => {
    for (const role of ["editor", "owner"]) {
      expect(
        batchPermission({
          guest: false,
          shared: true,
          sharedOfflineReadOnly: false,
          role: { status: "ready", role },
        }).allowed,
      ).toBe(true);
    }
  });

  it("refuses while the role is unknown, rather than guessing it", () => {
    for (const state of [{ status: "loading" }, { status: "error" }] as const) {
      const permission = batchPermission({
        guest: false,
        shared: true,
        sharedOfflineReadOnly: false,
        role: state,
      });

      expect(permission.allowed).toBe(false);
      expect(permission.reason).not.toBeNull();
    }
  });
});

describe("buildBatchEdit", () => {
  const base = entry();

  it("blocks a draft that ticks nothing", () => {
    const plan = buildBatchEdit(base, EMPTY_BATCH_DRAFT, LEDGER);

    expect(plan.kind).toBe("blocked");
    expect(draftTouchesAnything(EMPTY_BATCH_DRAFT)).toBe(false);
  });

  it("changes only the ticked field and leaves every other value alone", () => {
    const draft: BatchEditDraft = {
      ...EMPTY_BATCH_DRAFT,
      setPaymentMethod: true,
      paymentMethodId: "p-card",
    };

    const plan = buildBatchEdit(base, draft, LEDGER);
    expect(plan.kind).toBe("patch");
    if (plan.kind !== "patch") return;

    const next = plan.apply(base);

    expect(plan.fields).toEqual(["paymentMethod"]);
    expect(next.paymentMethodId).toBe("p-card");
    expect(next.paymentMethodName).toBe("银行卡");

    // The safety property, stated explicitly: a batch edit cannot move money, direction, currency,
    // date or the note — not because it refuses to, but because it has no branch that writes them.
    expect(next.amountCents).toBe(base.amountCents);
    expect(next.kind).toBe(base.kind);
    expect(next.currency).toBe(base.currency);
    expect(next.occurredAt).toBe(base.occurredAt);
    expect(next.occurredLocalDate).toBe(base.occurredLocalDate);
    expect(next.occurredTz).toBe(base.occurredTz);
    expect(next.note).toBe(base.note);

    // Fields that were not ticked keep their original values.
    expect(next.categoryId).toBe(base.categoryId);
    expect(next.tags).toEqual(base.tags);
  });

  it("sets a category, including its denormalised name", () => {
    const draft: BatchEditDraft = { ...EMPTY_BATCH_DRAFT, setCategory: true, categoryId: "c-travel" };
    const plan = buildBatchEdit(base, draft, LEDGER);

    expect(plan.kind).toBe("patch");
    if (plan.kind !== "patch") return;

    const next = plan.apply(base);
    expect(next.categoryId).toBe("c-travel");
    expect(next.categoryName).toBe("出行");
    expect(next.categoryIsSystem).toBe(false);
    expect(next.paymentMethodId).toBe(base.paymentMethodId);
  });

  it("refuses a category whose direction differs from the entry's", () => {
    const draft: BatchEditDraft = { ...EMPTY_BATCH_DRAFT, setCategory: true, categoryId: "c-salary" };
    const plan = buildBatchEdit(base, draft, LEDGER);

    expect(plan.kind).toBe("blocked");
    if (plan.kind !== "blocked") return;

    expect(plan.reason).toContain("方向不同");
  });

  it("refuses an archived category or payment method", () => {
    const archivedCategory = buildBatchEdit(
      base,
      { ...EMPTY_BATCH_DRAFT, setCategory: true, categoryId: "c-old" },
      LEDGER,
    );
    expect(archivedCategory.kind).toBe("blocked");

    const archivedMethod = buildBatchEdit(
      base,
      { ...EMPTY_BATCH_DRAFT, setPaymentMethod: true, paymentMethodId: "p-gone" },
      { ...LEDGER, paymentMethods: [paymentMethod("p-gone", { isArchived: true })] },
    );
    expect(archivedMethod.kind).toBe("blocked");
  });

  it("adds a tag without dropping the existing ones", () => {
    const draft: BatchEditDraft = {
      ...EMPTY_BATCH_DRAFT,
      setTags: true,
      tagMode: "add",
      tagIds: ["t-b"],
    };

    const plan = buildBatchEdit(base, draft, LEDGER);
    expect(plan.kind).toBe("patch");
    if (plan.kind !== "patch") return;

    expect(plan.fields).toEqual(["tags"]);
    expect(plan.apply(base).tags.map((item) => item.id)).toEqual(["t-a", "t-b"]);
    expect(plan.input.tagIds).toEqual(["t-a", "t-b"]);
  });

  it("removes a tag and leaves the rest", () => {
    const draft: BatchEditDraft = {
      ...EMPTY_BATCH_DRAFT,
      setTags: true,
      tagMode: "remove",
      tagIds: ["t-a"],
    };

    const plan = buildBatchEdit(entry({ tags: [tag("t-a"), tag("t-b")] }), draft, LEDGER);
    expect(plan.kind).toBe("patch");
    if (plan.kind !== "patch") return;

    expect(plan.apply(entry({ tags: [tag("t-a"), tag("t-b")] })).tags.map((item) => item.id)).toEqual([
      "t-b",
    ]);
  });

  it("reports 'unchanged' instead of writing a no-op", () => {
    const samePayment: BatchEditDraft = {
      ...EMPTY_BATCH_DRAFT,
      setPaymentMethod: true,
      paymentMethodId: "p-cash",
    };
    expect(buildBatchEdit(base, samePayment, LEDGER).kind).toBe("unchanged");

    const sameCategory: BatchEditDraft = {
      ...EMPTY_BATCH_DRAFT,
      setCategory: true,
      categoryId: "c-food",
    };
    expect(buildBatchEdit(base, sameCategory, LEDGER).kind).toBe("unchanged");
  });

  it("blocks an incomplete field rather than guessing a value", () => {
    expect(buildBatchEdit(base, { ...EMPTY_BATCH_DRAFT, setCategory: true }, LEDGER).kind).toBe(
      "blocked",
    );
    expect(
      buildBatchEdit(base, { ...EMPTY_BATCH_DRAFT, setTags: true, tagIds: [] }, LEDGER).kind,
    ).toBe("blocked");
  });

  it("blocks adding past the per-entry tag limit", () => {
    const nine = Array.from({ length: 9 }, (_, index) => tag(`t-${String(index)}`));
    const draft: BatchEditDraft = {
      ...EMPTY_BATCH_DRAFT,
      setTags: true,
      tagMode: "add",
      tagIds: ["t-b"],
    };

    const plan = buildBatchEdit(
      entry({ tags: [...nine, tag("t-x")] }),
      draft,
      { ...LEDGER, tags: [...nine, tag("t-x"), tag("t-b")] },
    );

    expect(plan.kind).toBe("blocked");
    if (plan.kind !== "blocked") return;

    expect(plan.reason).toContain("上限");
  });
});

describe("batchDeleteConfirmation", () => {
  it("names the number of entries in the title", () => {
    expect(batchDeleteConfirmation(7).title).toContain("7");
    expect(batchDeleteConfirmation(1).title).toContain("1");
  });

  it("does not promise an undo, and says so in words", () => {
    const confirmation = batchDeleteConfirmation(7);

    expect(confirmation.consequences.join(" ")).toContain("无法在应用里自行恢复");
    expect(confirmation.consequences.join(" ")).not.toContain("撤销");
  });

  it("mentions the recalculation and the offline queue", () => {
    const joined = batchDeleteConfirmation(2).consequences.join(" ");

    expect(joined).toContain("本月总额");
    expect(joined).toContain("离线时会先在本机排队");
  });
});

describe("summarizeBatch", () => {
  const failed: BatchItemResult = { id: "e2", status: "failed", reason: "分类已归档" };

  it("counts a partial success out loud, with the failure reason", () => {
    const summary = summarizeBatch(
      [
        { id: "e1", status: "ok", pending: false },
        failed,
      ],
      "edit",
    );

    expect(summary).toMatchObject({ ok: 1, failed: 1, unchanged: 0, queued: 0 });
    expect(summary.message).toContain("已修改 1 笔");
    expect(summary.message).toContain("有 1 笔失败");
    expect(summary.message).toContain("分类已归档");
    expect(summary.failures).toEqual([{ id: "e2", reason: "分类已归档" }]);
  });

  it("never calls a queued write a cloud success", () => {
    const summary = summarizeBatch([{ id: "e1", status: "ok", pending: true }], "delete");

    expect(summary.message).toContain("本机");
    expect(summary.message).toContain("联网后");
    expect(summary.message).not.toContain("云端删除");
    expect(summary.queued).toBe(1);
  });

  it("reports a total failure as a failure", () => {
    const summary = summarizeBatch([failed], "edit");

    expect(summary.ok).toBe(0);
    expect(summary.message).toContain("没有修改成功任何一笔");
  });

  it("separates 'nothing to change' from 'failed'", () => {
    const summary = summarizeBatch([{ id: "e1", status: "unchanged" }], "edit");

    expect(summary).toMatchObject({ ok: 0, failed: 0, unchanged: 1 });
    expect(summary.message).toContain("没有需要改动的地方");
    expect(summary.failures).toHaveLength(0);
  });

  it("summarises a delete with the delete wording", () => {
    const summary = summarizeBatch(
      [
        { id: "e1", status: "ok", pending: false },
        { id: "e2", status: "ok", pending: false },
      ],
      "delete",
    );

    expect(summary.message).toContain("已删除 2 笔");
  });
});
