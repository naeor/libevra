/**
 * The ledger's batch mode, as decisions rather than as markup.
 *
 * ⚠️ **Every rule that decides what a batch operation touches lives here, in plain functions.**
 *
 * The reason is not tidiness: this workspace's tests run in Node with no DOM (see `vitest.config.ts`),
 * so a rule that only exists inside a component's event handler cannot be checked at all. **The rules
 * that must never be wrong — which fields a batch edit changes, whether the user may write at all,
 * and what the report says afterwards — are the ones worth checking.**
 *
 * The three promises this module exists to keep:
 *
 *  1. **A batch edit only changes fields the user ticked.** Nothing else in the entry is rewritten,
 *     so an amount, a direction, a currency or a date cannot move by accident.
 *  2. **"All selected" means the entries that are loaded and visible**, never the whole ledger.
 *  3. **A partly failed run says so**, with the count and the reasons — never a quiet "done".
 */
import {
  MAX_TAGS_PER_TRANSACTION,
  type Category,
  type PaymentMethod,
  type Tag,
  type Transaction,
  type TransactionKind,
  type UpdateTransactionInput,
} from "@libellum/shared";

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * ⚠️ **Selected ids are always read through the loaded list**, so an id that is no longer visible can
 * never be acted on. The user's instruction was explicit: leaving a filter clears the selection, and
 * the screen then must not carry an invisible choice into a delete.
 */
export function selectedLoadedIds(
  loadedIds: readonly string[],
  selected: ReadonlySet<string>,
): readonly string[] {
  return loadedIds.filter((id) => selected.has(id));
}

export function toggleSelection(
  selected: ReadonlySet<string>,
  id: string,
): ReadonlySet<string> {
  const next = new Set(selected);

  if (next.has(id)) next.delete(id);
  else next.add(id);

  return next;
}

export function allLoadedSelected(
  loadedIds: readonly string[],
  selected: ReadonlySet<string>,
): boolean {
  return loadedIds.length > 0 && loadedIds.every((id) => selected.has(id));
}

/**
 * Select every entry that is loaded, or clear the selection when they already all are.
 *
 * ⚠️ **Deliberately limited to `loadedIds`.** The list is paginated and filtered, so "select all" can
 * only honestly mean "everything on this screen". The caller passes exactly what it drew.
 */
export function selectAllLoaded(
  loadedIds: readonly string[],
  selected: ReadonlySet<string>,
): ReadonlySet<string> {
  return allLoadedSelected(loadedIds, selected) ? new Set<string>() : new Set(loadedIds);
}

// ---------------------------------------------------------------------------
// What a tap on a row does
// ---------------------------------------------------------------------------

export type EntryTapAction = "toggle-selection" | "settle-conflict" | "open-entry";

/**
 * ⚠️ **One place decides, so "selection mode" cannot half-apply.**
 *
 * The owner asked for "点击卡片=切换选择，不再进入详情" — so in batch mode a tap must never navigate,
 * including on a conflicted row. Outside batch mode the existing rule stands: a conflicted entry opens
 * the choice before the editor, because opening the editor would create a third version.
 */
export function entryTapAction(input: {
  readonly selecting: boolean;
  readonly conflicted: boolean;
}): EntryTapAction {
  if (input.selecting) return "toggle-selection";

  return input.conflicted ? "settle-conflict" : "open-entry";
}

// ---------------------------------------------------------------------------
// Permission
// ---------------------------------------------------------------------------

export type BatchRoleState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly role: string }
  | { readonly status: "error" };

export interface BatchPermission {
  readonly allowed: boolean;
  /** Why not, in words the reader can act on. `null` when allowed. */
  readonly reason: string | null;
}

/**
 * ⚠️ **Write permission is the existing rule plus one new lookup — never a replacement for a server check.**
 *
 * The ledger screen's only existing write gate is `useSharedLedgerOfflineReadOnly`: shared ledger +
 * offline = read-only. That is reused as-is (the project's rule is that existing permission decisions
 * may only be added to, never moved or rewritten).
 *
 * The one thing added: a shared ledger also asks *this account's* role, because a 查看者's write is
 * refused by the server for ever — and the offline write path would happily queue it and paint the row
 * green. **A batch of rows that can never be delivered is worse than a disabled button.**
 *
 * While the role is still unknown, a shared ledger is treated as not writable yet. Personal ledgers
 * (one member) skip the lookup entirely — only an owner can be in one.
 */
export function batchPermission(input: {
  readonly guest: boolean;
  readonly shared: boolean;
  readonly sharedOfflineReadOnly: boolean;
  readonly role: BatchRoleState;
}): BatchPermission {
  if (input.guest) {
    return { allowed: false, reason: "游客账本请逐笔修改；批量操作暂未开放。" };
  }

  if (input.sharedOfflineReadOnly) {
    return {
      allowed: false,
      reason: "当前离线，共享账本只能查看。联网后可以批量修改或删除。",
    };
  }

  if (!input.shared) return { allowed: true, reason: null };

  if (input.role.status === "ready") {
    if (input.role.role === "viewer") {
      return { allowed: false, reason: "你在这本账里是「仅查看」，不能修改或删除账目。" };
    }

    return { allowed: true, reason: null };
  }

  if (input.role.status === "error") {
    return { allowed: false, reason: "没能确认你在这本账的权限，暂时不能批量修改。联网后重试。" };
  }

  return { allowed: false, reason: "正在确认你在这本账的权限…" };
}

// ---------------------------------------------------------------------------
// The edit itself: a patch, never a whole object
// ---------------------------------------------------------------------------

export type BatchTagMode = "add" | "remove";

export interface BatchEditDraft {
  readonly setCategory: boolean;
  readonly categoryId: string | null;
  readonly setPaymentMethod: boolean;
  readonly paymentMethodId: string | null;
  readonly setTags: boolean;
  readonly tagMode: BatchTagMode;
  readonly tagIds: readonly string[];
}

export const EMPTY_BATCH_DRAFT: BatchEditDraft = {
  setCategory: false,
  categoryId: null,
  setPaymentMethod: false,
  paymentMethodId: null,
  setTags: false,
  tagMode: "add",
  tagIds: [],
};

export function draftTouchesAnything(draft: BatchEditDraft): boolean {
  return draft.setCategory || draft.setPaymentMethod || draft.setTags;
}

export interface BatchLedgerIndex {
  readonly categories: readonly Category[];
  readonly paymentMethods: readonly PaymentMethod[];
  readonly tags: readonly Tag[];
}

export type BatchField = "category" | "paymentMethod" | "tags";

export interface BatchPatch {
  readonly kind: "patch";
  /** Which fields this run will actually change, for the report and for tests. */
  readonly fields: readonly BatchField[];
  /** Only the changed fields — the offline writer derives the request body from the entry itself. */
  readonly input: UpdateTransactionInput;
  /** The device's copy after the change. Fields this run does not touch are carried over untouched. */
  readonly apply: (current: Transaction) => Transaction;
}

export type BatchEditPlan =
  | BatchPatch
  | { readonly kind: "unchanged" }
  | { readonly kind: "blocked"; readonly reason: string };

function sameTagList(left: readonly Tag[], right: readonly Tag[]): boolean {
  if (left.length !== right.length) return false;

  return left.every((tag, index) => tag.id === right[index]?.id);
}

function tagsAfter(base: readonly Tag[], draft: BatchEditDraft, chosen: readonly Tag[]): Tag[] {
  if (draft.tagMode === "add") {
    const next = [...base];

    for (const tag of chosen) {
      if (!next.some((existing) => existing.id === tag.id)) next.push({ ...tag });
    }

    return next;
  }

  return base.filter((existing) => !chosen.some((tag) => tag.id === existing.id));
}

function kindWord(kind: TransactionKind): string {
  return kind === "expense" ? "支出" : "收入";
}

/**
 * Turn a draft into the patch for **one** entry.
 *
 * ⚠️ **Amount, `kind`, currency, date, note and time zone are not in this function's vocabulary at
 * all.** That is the safety property, stated as an absence rather than as a check: a rule that says
 * "do not touch the amount" can be forgotten in an edit; a field that has no code path cannot be.
 *
 * `entry` is what the user sees and is used to decide "nothing to change"; `apply` recomputes from the
 * device's own copy so the local write stays consistent with what is actually stored.
 */
export function buildBatchEdit(
  entry: Transaction,
  draft: BatchEditDraft,
  ledger: BatchLedgerIndex,
): BatchEditPlan {
  if (!draftTouchesAnything(draft)) {
    return { kind: "blocked", reason: "还没有勾选要修改的字段。" };
  }

  let category: Category | null = null;
  if (draft.setCategory) {
    if (draft.categoryId === null) return { kind: "blocked", reason: "请先选择要统一使用的分类。" };

    const found = ledger.categories.find((candidate) => candidate.id === draft.categoryId);
    if (found === undefined) return { kind: "blocked", reason: "选中的分类不在这本账里。" };
    if (found.isArchived) return { kind: "blocked", reason: `「${found.name}」已归档，不能再使用。` };
    if (found.kind !== entry.kind) {
      return {
        kind: "blocked",
        reason: `「${found.name}」不是${kindWord(entry.kind)}分类，和这笔账的方向不同。`,
      };
    }

    category = found;
  }

  let method: PaymentMethod | null = null;
  if (draft.setPaymentMethod) {
    if (draft.paymentMethodId === null) {
      return { kind: "blocked", reason: "请先选择要统一使用的支付方式。" };
    }

    const found = ledger.paymentMethods.find((candidate) => candidate.id === draft.paymentMethodId);
    if (found === undefined) return { kind: "blocked", reason: "选中的支付方式不在这本账里。" };
    if (found.isArchived) return { kind: "blocked", reason: `「${found.name}」已归档，不能再使用。` };

    method = found;
  }

  const chosenTags: Tag[] = [];
  if (draft.setTags) {
    if (draft.tagIds.length === 0) {
      return {
        kind: "blocked",
        reason: draft.tagMode === "add" ? "请先选择要添加的标签。" : "请先选择要移除的标签。",
      };
    }

    for (const id of draft.tagIds) {
      const found = ledger.tags.find((candidate) => candidate.id === id);
      if (found === undefined) return { kind: "blocked", reason: "选中的标签不在这本账里。" };

      chosenTags.push(found);
    }

    if (draft.tagMode === "add" && tagsAfter(entry.tags, draft, chosenTags).length > MAX_TAGS_PER_TRANSACTION) {
      return {
        kind: "blocked",
        reason: `加上这些标签会超过每笔 ${String(MAX_TAGS_PER_TRANSACTION)} 个的上限。`,
      };
    }
  }

  const categoryChanged = category !== null && category.id !== entry.categoryId;
  const methodChanged = method !== null && method.id !== entry.paymentMethodId;
  const tagsChanged =
    draft.setTags && !sameTagList(tagsAfter(entry.tags, draft, chosenTags), entry.tags);

  const fields: BatchField[] = [];
  if (categoryChanged) fields.push("category");
  if (methodChanged) fields.push("paymentMethod");
  if (tagsChanged) fields.push("tags");

  if (fields.length === 0) return { kind: "unchanged" };

  const input: UpdateTransactionInput = {
    /**
     * ⚠️ **The version is passed for the guest path, which applies `input` directly.** The account
     * path derives both the body and the base version from the device's own copy inside `updateEntry`.
     */
    version: entry.version,
    /**
     * ⚠️ **Untouched fields carry their current value, they do not carry "unset".** The guest writer
     * treats a `null` category as "file this under 暂无分类", so omitting a field is not the same
     * thing as leaving it alone there. Passing the entry's own value makes the two paths agree, and
     * the account path uses `apply` rather than this object anyway.
     */
    categoryId: categoryChanged && category !== null ? category.id : entry.categoryId,
    paymentMethodId: methodChanged && method !== null ? method.id : entry.paymentMethodId,
    tagIds: draft.setTags
      ? tagsAfter(entry.tags, draft, chosenTags).map((tag) => tag.id)
      : entry.tags.map((tag) => tag.id),
  };

  const apply = (current: Transaction): Transaction => {
    let next: Transaction = { ...current };

    if (categoryChanged && category !== null) {
      next = {
        ...next,
        categoryId: category.id,
        categoryName: category.name,
        categoryIsSystem: category.isSystem,
      };
    }

    if (methodChanged && method !== null) {
      next = { ...next, paymentMethodId: method.id, paymentMethodName: method.name };
    }

    if (draft.setTags) {
      /**
       * ⚠️ **The local copy must carry `tags`, not `tagIds`.** The stored entry's tags are what the
       * sync layer sends (`tagIds: entry.tags.map(...)`) and what the conflict chain compares, so an
       * edit that only remembered ids would look like "no change" and never reach the server.
       */
      next = {
        ...next,
        tags: tagsAfter(current.tags, draft, chosenTags).map((tag) => ({
          id: tag.id,
          name: tag.name,
          color: tag.color,
        })),
      };
    }

    return next;
  };

  return { kind: "patch", fields, input, apply };
}

/**
 * The confirmation before a batch delete.
 *
 * ⚠️ **The count is in the title, and the consequences say what cannot be undone.** Deleting one
 * entry already asks first; deleting thirty must say *thirty*, or the dialog is describing a
 * different action from the one about to happen.
 *
 * ⚠️ **No undo is offered, and that is stated rather than implied.** The single-entry screen offers
 * 撤销 for a few seconds because it restores from the server; a batch has no such path, and a dialog
 * that stayed silent about it would be promising one by omission.
 */
export function batchDeleteConfirmation(count: number): {
  readonly title: string;
  readonly description: string;
  readonly consequences: readonly string[];
  readonly confirmLabel: string;
} {
  return {
    title: `删除选中的 ${String(count)} 笔账目？`,
    description: "每笔都会走和单笔删除相同的删除路径。",
    consequences: [
      "删除后，你无法在应用里自行恢复这些记录",
      "本月总额、笔数与结余会立即重新计算",
      "离线时会先在本机排队，联网后投递",
    ],
    confirmLabel: "确认删除",
  };
}

// ---------------------------------------------------------------------------
// The report afterwards
// ---------------------------------------------------------------------------

export type BatchItemResult =
  | { readonly id: string; readonly status: "ok"; readonly pending: boolean }
  | { readonly id: string; readonly status: "unchanged" }
  | { readonly id: string; readonly status: "failed"; readonly reason: string };

export interface BatchSummary {
  readonly ok: number;
  readonly unchanged: number;
  readonly failed: number;
  /** How many of `ok` are only on this device — queued, not yet on the server. */
  readonly queued: number;
  readonly message: string;
  readonly failures: readonly { readonly id: string; readonly reason: string }[];
}

/**
 * ⚠️ **A partial success is never reported as a success.**
 *
 * Every failed entry contributes its own reason, the count is always in the sentence, and a queued
 * change is described as queued — "已在本机…，联网后投递" — never as "已同步到云端".
 */
export function summarizeBatch(
  results: readonly BatchItemResult[],
  action: "edit" | "delete",
): BatchSummary {
  let ok = 0;
  let unchanged = 0;
  let failed = 0;
  let queued = 0;
  const failures: { readonly id: string; readonly reason: string }[] = [];

  for (const result of results) {
    if (result.status === "ok") {
      ok += 1;
      if (result.pending) queued += 1;
      continue;
    }

    if (result.status === "unchanged") {
      unchanged += 1;
      continue;
    }

    failed += 1;
    failures.push({ id: result.id, reason: result.reason });
  }

  const verb = action === "edit" ? "修改" : "删除";
  const parts: string[] = [];

  if (ok === 0 && failed === 0) {
    parts.push(unchanged > 0 ? "没有需要改动的地方。" : "没有可处理的账目。");
  } else if (ok === 0) {
    parts.push(`没有${verb}成功任何一笔，${String(failed)} 笔失败。`);
  } else if (queued === ok) {
    parts.push(`已在本机${verb} ${String(ok)} 笔，还没有投递到云端；联网后会自动投递。`);
  } else {
    parts.push(`已${verb} ${String(ok)} 笔。`);
    if (queued > 0) {
      parts.push(`其中 ${String(queued)} 笔还在本机排队，联网后投递。`);
    }
  }

  if (ok > 0 && unchanged > 0) {
    parts.push(`另有 ${String(unchanged)} 笔本来就是这个值，没有改动。`);
  }

  if (failed > 0) {
    const shown = failures.slice(0, 2).map((failure) => failure.reason).join("；");
    parts.push(`有 ${String(failed)} 笔失败：${shown}${failures.length > 2 ? "…" : ""}`);
  }

  return { ok, unchanged, failed, queued, message: parts.join(""), failures };
}
