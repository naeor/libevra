import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import type {
  Category,
  ImportJobStatus,
  IncrementalPreviewResponse,
  IncrementalSourceStatus,
  LedgerImportRequest,
  LedgerImportResult,
  PaymentMethod,
  Tag,
  Transaction,
} from "@libellum/shared";

import { applyLocale, clearMissingTranslationKeys, missingTranslationKeys } from "../i18n/index.js";
import { presetDecision } from "../lib/ledgerImport/decisions.js";
import { buildImportPreview } from "../lib/ledgerImport/preview.js";
import type { ImportBookOption, ImportPreview, ImportSource, ImportTarget } from "../lib/ledgerImport/types.js";
import {
  BatchJobPanel,
  ConfirmStep,
  DraftRecoveryNotice,
  IncrementalReview,
  PendingTaskBanner,
  PreviewStep,
  ReviewStep,
  SelectionStep,
  SourceRetentionCard,
  StepRail,
} from "./LedgerImportPage.js";

/**
 * S16 · 账本导入页的英文渲染。
 *
 * 用户数据（账本名、备注、自建标签）在夹具里全部用英文，所以英文界面渲染出来**不应再有任何中文**；
 * 分类 / 支付方式故意用预置中文名（餐饮、购物、微信），顺带验证显示名按语言翻译。
 * 同时检查渲染过程中没有缺失的 `ledgerImport.*` 键。
 */
const CJK = /[㐀-鿿]/u;

afterEach(() => {
  applyLocale("zh-CN");
  clearMissingTranslationKeys();
});

function category(id: string, name: string, options: { isSystem?: boolean; isArchived?: boolean } = {}): Category {
  return {
    id,
    name,
    kind: "expense",
    description: null,
    isSystem: options.isSystem ?? false,
    isArchived: options.isArchived ?? false,
    sortOrder: 0,
  };
}

function payment(id: string, name: string, isArchived = false): PaymentMethod {
  return { id, name, isArchived, sortOrder: 0 };
}

function tag(id: string, name: string, color: string): Tag {
  return { id, name, color };
}

function transaction(id: string, overrides: Partial<Transaction> = {}): Transaction {
  return {
    id,
    kind: "expense",
    amountCents: 1000,
    currency: "CNY",
    categoryId: "s-food",
    categoryName: "餐饮",
    categoryIsSystem: false,
    paymentMethodId: "s-wechat",
    paymentMethodName: "微信",
    occurredAt: "2026-10-18T10:00:00+08:00",
    occurredLocalDate: "2026-10-18",
    occurredTz: "Asia/Shanghai",
    note: "Lunch",
    tags: [],
    version: 1,
    ...overrides,
  };
}

function fixtures(kind: "guest" | "book" = "guest"): { source: ImportSource; target: ImportTarget } {
  const source: ImportSource = {
    kind,
    bookId: kind === "guest" ? "guest-book-1" : "11111111-1111-4111-8111-111111111111",
    identity: { name: "Weekend trips", bookNumber: kind === "guest" ? null : "10000001" },
    categories: [category("s-sys", "暂无分类", { isSystem: true }), category("s-food", "餐饮"), category("s-shop", "购物")],
    paymentMethods: [payment("s-wechat", "微信", true)],
    tags: [tag("s-work", "Work", "#111111")],
    transactions: [
      transaction("s1"),
      transaction("s2", { occurredAt: "2026-10-18T10:00:30+08:00", note: "Dinner" }),
      transaction("s3", { amountCents: 500, currency: "USD", categoryId: "s-shop", categoryName: "购物", note: null }),
    ],
    hiddenDeletedCount: 2,
  };
  const target: ImportTarget = {
    bookId: "22222222-2222-4222-8222-222222222222",
    identity: { name: "Household", bookNumber: "10000008" },
    categories: [
      category("t-sys", "暂无分类", { isSystem: true }),
      category("t-food", "餐饮"),
      category("t-shop", "购物", { isArchived: true }),
    ],
    paymentMethods: [payment("t-wechat", "微信")],
    tags: [tag("t-work", "Work", "#222222")],
    transactions: [
      transaction("t1", {
        categoryId: "t-food",
        paymentMethodId: "t-wechat",
        occurredAt: "2026-10-18T10:00:10+08:00",
        note: "Lunch at work",
      }),
    ],
    hiddenDeletedCount: 0,
  };
  return { source, target };
}

function preview(kind: "guest" | "book" = "guest"): ImportPreview {
  const { source, target } = fixtures(kind);
  return buildImportPreview(source, target);
}

const BOOKS: readonly ImportBookOption[] = [
  { id: "book-1", name: "Household", bookNumber: "10000008", role: "owner", isCreator: true, memberCount: 1 },
  { id: "book-2", name: "Side project", bookNumber: null, role: "owner", isCreator: true, memberCount: 1 },
];

function job(status: ImportJobStatus["status"], overrides: Partial<ImportJobStatus> = {}): ImportJobStatus {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    status,
    phase: 4,
    timeoutSeconds: 600,
    activityAt: null,
    confirmationDeadline: new Date(Date.now() + 9 * 60_000).toISOString(),
    undoAttempts: 0,
    canConfirm: status === "awaiting_confirmation",
    canUndo: true,
    sourceKind: "guest",
    sourceBookId: null,
    targetBookId: "22222222-2222-4222-8222-222222222222",
    batchSize: 200,
    nextBatch: 1,
    totalBatches: 3,
    sourceCount: 401,
    importedCount: 180,
    updatedCount: 1,
    skippedCount: 19,
    removedCount: 0,
    batches: [],
    targetBaselineCount: 10,
    targetExpectedCount: 400,
    createdAt: "2026-10-18T10:00:00.000Z",
    updatedAt: "2026-10-18T10:00:00.000Z",
    lastErrorCode: null,
    lastErrorMessage: null,
    result: null,
    ...overrides,
  };
}

function result(overrides: Partial<LedgerImportResult> = {}): LedgerImportResult {
  return {
    importId: "44444444-4444-4444-8444-444444444444",
    targetBook: { id: "22222222-2222-4222-8222-222222222222", name: "Household", bookNumber: "10000008", created: false },
    sourceCount: 3,
    importedCount: 2,
    updatedCount: 1,
    skippedCount: 1,
    removedCount: 1,
    targetExistingBefore: 1,
    targetCountAfter: 2,
    removedTargets: [],
    totals: [{ currency: "CNY", expenseCents: 2000, incomeCents: 0, count: 2 }],
    imported: [],
    updated: [],
    taxonomy: {
      categoriesCreated: 0,
      paymentMethodsCreated: 0,
      tagsCreated: 0,
      categoriesReused: 2,
      paymentMethodsReused: 1,
      tagsReused: 0,
    },
    reconciled: true,
    ...overrides,
  };
}

const sha = "a".repeat(64);
const REQUEST: LedgerImportRequest = {
  importId: "55555555-5555-4555-8555-555555555555",
  target: { kind: "existing", bookId: "22222222-2222-4222-8222-222222222222", expectedTargetFingerprint: sha },
  sourceBookId: "11111111-1111-4111-8111-111111111111",
  sourceFingerprint: sha,
  taxonomy: [],
  duplicateGroups: [],
  incrementalDecisions: [],
};

function incrementalStatus(
  id: string,
  status: IncrementalSourceStatus["status"],
  overrides: Partial<IncrementalSourceStatus> = {},
): IncrementalSourceStatus {
  return {
    sourceTransactionId: id,
    status,
    previousDecision: null,
    targetTransactionId: "t1",
    targetVersion: 1,
    targetChanged: false,
    legacy: false,
    sourceFingerprint: sha,
    previousSourceFingerprint: null,
    ...overrides,
  };
}

const noop = (): void => undefined;

function renderAll(): string[] {
  const guest = preview("guest");
  const formal = preview("book");
  const group = guest.duplicateGroups[0];
  const decisions = new Map(group === undefined ? [] : [[group.id, presetDecision(group, "keep_neither")]]);
  // 只有前三条能在来源快照里找到对应账目；其余用来覆盖“无对应账目”等分支。
  const statuses: IncrementalSourceStatus[] = [
    incrementalStatus("s1", "modified", { targetChanged: true }),
    incrementalStatus("s2", "modified", { legacy: true }),
    incrementalStatus("s3", "previously_skipped_modified"),
    incrementalStatus("x4", "needs_review", { targetTransactionId: null }),
    incrementalStatus("x5", "target_changed"),
    incrementalStatus("x6", "target_deleted"),
  ];
  const summary: IncrementalPreviewResponse["summary"] = {
    newCount: 1,
    unchangedCount: 2,
    modifiedCount: 1,
    targetChangedCount: 1,
    targetDeletedCount: 1,
    previouslySkippedCount: 1,
    needsReviewCount: 1,
  };
  const confirmProps = {
    preview: guest,
    targetIsNew: false,
    decisions,
    canConfirm: true,
    onStart: noop,
    onRetry: noop,
    onBack: noop,
    onFinish: noop,
    onOpenTarget: noop,
  } as const;
  const jobProps = { busy: false, onResume: noop, onConfirm: noop, onUndo: noop, onKeepWaiting: noop, onRefresh: noop };

  return [
    ...(["select", "preview", "review", "confirm"] as const).map((step) => renderToStaticMarkup(<StepRail step={step} />)),
    renderToStaticMarkup(
      <SelectionStep
        targetId="book-1"
        target={BOOKS[0] ?? null}
        targetIsNew={false}
        newName=""
        soloBooks={BOOKS}
        sourceBooks={BOOKS.slice(1)}
        sourceBook={null}
        guestAvailable
        sourceKey="guest"
        accountLabel="alex"
        onChangeTarget={noop}
        onChangeSource={noop}
        onChangeNewName={noop}
        onContinue={noop}
      />,
    ),
    renderToStaticMarkup(
      <SelectionStep
        targetId="book-1"
        target={BOOKS[0] ?? null}
        targetIsNew={false}
        newName=""
        soloBooks={BOOKS}
        sourceBooks={BOOKS.slice(1)}
        sourceBook={BOOKS[1] ?? null}
        guestAvailable={false}
        sourceKey="book-2"
        accountLabel="alex"
        onChangeTarget={noop}
        onChangeSource={noop}
        onChangeNewName={noop}
        onContinue={noop}
      />,
    ),
    renderToStaticMarkup(
      <PreviewStep
        preview={guest}
        conflictCount={guest.mapping.conflicts.length}
        resolutions={new Map()}
        onResolve={noop}
        onBack={noop}
        onReview={noop}
        onConfirm={noop}
        needsIncrementalReview={false}
      />,
    ),
    renderToStaticMarkup(
      <PreviewStep
        preview={formal}
        conflictCount={0}
        resolutions={new Map()}
        onResolve={noop}
        onBack={noop}
        onReview={noop}
        onConfirm={noop}
        needsIncrementalReview
      />,
    ),
    // 预览里的冲突说明与提示是在当前语言下生成的。
    guest.mapping.conflicts.map((conflict) => conflict.message).join("\n"),
    guest.warnings.join("\n"),
    renderToStaticMarkup(
      <ReviewStep
        preview={guest}
        groupIndex={0}
        decisions={new Map()}
        onPreset={noop}
        onSource={noop}
        onTarget={noop}
        onPrevious={noop}
        onNext={noop}
        onBack={noop}
        onConfirm={noop}
        canConfirm={false}
        needsReviewGroupIds={group === undefined ? [] : [group.id]}
      />,
    ),
    renderToStaticMarkup(
      <ReviewStep
        preview={guest}
        groupIndex={0}
        decisions={decisions}
        onPreset={noop}
        onSource={noop}
        onTarget={noop}
        onPrevious={noop}
        onNext={noop}
        onBack={noop}
        onConfirm={noop}
        canConfirm
        needsReviewGroupIds={[]}
      />,
    ),
    renderToStaticMarkup(
      <IncrementalReview
        statuses={statuses}
        summary={summary}
        source={guest.source}
        target={guest.target}
        decisions={new Map()}
        onDecision={noop}
      />,
    ),
    ...(["idle", "submitting", "paused", "error"] as const).map((submitState) =>
      renderToStaticMarkup(<ConfirmStep {...confirmProps} submitState={submitState} result={null} />),
    ),
    renderToStaticMarkup(<ConfirmStep {...confirmProps} submitState="success" result={result()} />),
    renderToStaticMarkup(
      <ConfirmStep
        {...confirmProps}
        decisions={new Map()}
        submitState="success"
        result={result({ updatedCount: 0, removedCount: 0, skippedCount: 0, targetBook: { ...result().targetBook, bookNumber: null, created: true } })}
      />,
    ),
    ...(
      [
        "queued",
        "running",
        "finalizing",
        "awaiting_confirmation",
        "confirming",
        "confirmed",
        "undoing",
        "undone",
        "undo_failed",
        "paused",
        "failed",
        "completed",
        "cancelled",
        "expired",
      ] as const
    ).map((status) => renderToStaticMarkup(<BatchJobPanel job={job(status)} {...jobProps} />)),
    // 服务器任务表里的中文原文：按错误码换成英文；不认识的错误码给通用说明，不把中文塞进英文界面。
    renderToStaticMarkup(
      <BatchJobPanel
        job={job("paused", {
          lastErrorCode: "import_stalled",
          lastErrorMessage: "导入长时间没有进展，已暂停；超时后会自动安全撤销。",
        })}
        {...jobProps}
      />,
    ),
    renderToStaticMarkup(
      <BatchJobPanel
        job={job("failed", { lastErrorCode: "something_new", lastErrorMessage: "服务器新加的一句中文说明。" })}
        {...jobProps}
      />,
    ),
    renderToStaticMarkup(
      <PendingTaskBanner
        tasks={[{ userId: "u1", request: REQUEST, sourceLabel: "Weekend trips", targetLabel: "Household", createdAt: "" }]}
        busy={false}
        onResume={noop}
        onDrop={noop}
      />,
    ),
    renderToStaticMarkup(
      <DraftRecoveryNotice
        summary={{
          restoredGroups: 2,
          resetGroups: 1,
          restoredConflicts: 1,
          resetConflicts: 3,
          needsReviewGroupIds: ["g1"],
          messageId: "partial",
        }}
      />,
    ),
    renderToStaticMarkup(<SourceRetentionCard result={result()} preview={guest} jobId={null} onError={noop} />),
    renderToStaticMarkup(
      <SourceRetentionCard
        result={result({ sourceBookId: "11111111-1111-4111-8111-111111111111" })}
        preview={formal}
        jobId={null}
        onError={noop}
      />,
    ),
  ];
}

describe("账本导入页 · 英文界面", () => {
  it("预览夹具确实覆盖了冲突、重复组和提示（否则下面的检查没有意义）", () => {
    const guest = preview("guest");
    expect(guest.mapping.conflicts.map((conflict) => conflict.reason).sort()).toEqual([
      "category_archive_mismatch",
      "payment_method_archive_mismatch",
      "tag_color_mismatch",
    ]);
    expect(guest.duplicateGroups.length).toBeGreaterThan(0);
    expect(guest.warnings.length).toBe(5);
  });

  it("所有主要视图在英文下不含中文，也没有缺失的文案键", () => {
    applyLocale("en-US");
    clearMissingTranslationKeys();
    const outputs = renderAll();
    const leaked = outputs.filter((html) => CJK.test(html)).map((html) => html.match(/.{0,60}[㐀-鿿].{0,60}/u)?.[0]);
    expect(leaked).toEqual([]);
    expect(missingTranslationKeys().filter((key) => key.includes("ledgerImport."))).toEqual([]);

    const all = outputs.join("\n");
    // 预置分类 / 支付方式按语言显示，用户自建的标签名原样显示。
    expect(all).toContain("Food &amp; drink");
    expect(all).toContain("WeChat Pay");
    expect(all).toContain("Work");
    // 英文按数量选择单复数，后果与时限写明。
    expect(all).toContain("The source ledger has 2 deleted entries, which won’t be imported.");
    expect(all).toMatch(/Finish or undo within \d+ min \d+ sec\. If time runs out, the import is safely undone automatically\./);
    expect(all).toMatch(/about \d+ seconds left/);
    expect(all).toContain("The import made no progress for too long and was paused.");
    expect(all).toContain("Something went wrong with this import.");
    expect(all).toContain("Imported 2 entries");
    expect(all).toContain("Deleted 1 target entry, as you chose.");
    expect(all).toContain("Into “Household” (created for this import)");
  });

  it("切回中文后仍是原来的中文原文", () => {
    applyLocale("en-US");
    applyLocale("zh-CN");
    const guest = preview("guest");
    expect(renderToStaticMarkup(<StepRail step="review" />)).toContain("核对");
    expect(guest.warnings).toContain("来源账本有 2 条已删除记录，不会导入。");
    expect(guest.mapping.conflicts.map((conflict) => conflict.message)).toContain(
      "来源分类「购物」未归档，目标同名分类已归档。",
    );
    const panel = renderToStaticMarkup(
      <BatchJobPanel
        job={job("running")}
        busy={false}
        onResume={noop}
        onConfirm={noop}
        onUndo={noop}
        onKeepWaiting={noop}
        onRefresh={noop}
      />,
    );
    expect(panel).toContain("1 / 3 批");
    expect(panel).toContain("已处理 1 / 3 批； 新增 180 笔 · 更新 1 笔 · 跳过 19 笔。 总来源 401 笔。");
    // 中文界面显示服务器原文（与以前一致）。
    const paused = renderToStaticMarkup(
      <BatchJobPanel
        job={job("paused", { lastErrorCode: "something_new", lastErrorMessage: "服务器新加的一句中文说明。" })}
        busy={false}
        onResume={noop}
        onConfirm={noop}
        onUndo={noop}
        onKeepWaiting={noop}
        onRefresh={noop}
      />,
    );
    expect(paused).toContain("服务器新加的一句中文说明。");
    const recovery = renderToStaticMarkup(
      <DraftRecoveryNotice
        summary={{
          restoredGroups: 2,
          resetGroups: 1,
          restoredConflicts: 1,
          resetConflicts: 0,
          needsReviewGroupIds: [],
          messageId: "partial",
        }}
      />,
    );
    expect(recovery).toContain("部分选择已恢复，变化的记录需要重新核对。");
    expect(recovery).toContain("已恢复 2 组重复决定，1 组需要重新核对；已恢复 1 个映射选择。");
  });
});
