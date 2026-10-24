import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import type { Category, PaymentMethod, Tag } from "@libellum/shared";

import { applyLocale } from "../../i18n/index.js";
import { findSuspectedDuplicates } from "../../lib/ocr/duplicates.js";
import { countImportableItems, findImportBlockers, validationBlocker } from "../../lib/ocr/import.js";
import type { OcrImportOutcome } from "../../lib/ocr/import.js";
import type { OcrImportSession } from "../../lib/ocr/importSession.js";
import { batchCandidate } from "../../lib/ocr/testFixtures.js";
import { countBatchItems, type OcrBatch, type OcrBatchCandidate } from "../../lib/ocr/types.js";
import { ImportDoneView } from "./ImportDoneView.js";
import { importToastFor } from "./ImportToast.js";
import { OcrImportBar, OcrOverview, ocrIssueText } from "./OcrOverview.js";

/**
 * S16：英文界面下的批量识别结果。
 *
 * 数据（商户、账户、标签）用英文写，预置分类/支付方式用中文原名（它们在英文界面显示译名），
 * 识别问题带中文原文（英文界面按代码显示英文）——这样输出里出现任何中文，都只可能是漏翻的界面文字。
 */

const CJK = /[㐀-鿿]/;

afterEach(() => {
  applyLocale("zh-CN");
});

const CATEGORIES: readonly Category[] = [
  { id: "c-food", name: "餐饮", kind: "expense", description: null, isSystem: false, isArchived: false, sortOrder: 1 },
];
const METHODS: readonly PaymentMethod[] = [{ id: "m-wechat", name: "微信", isArchived: false, sortOrder: 1 }];
const TAGS: readonly Tag[] = [{ id: "t-work", name: "Work", color: "#888888" }];

const CLEAN: OcrBatchCandidate = batchCandidate({
  candidateId: "img0-1",
  merchant: "Corner Shop",
  account: "Balance",
  categoryId: "c-food",
  categorySource: "inferred",
  paymentMethodId: "m-wechat",
  tagIds: ["t-work"],
  isRefund: true,
  reviewed: true,
});
const TWIN: OcrBatchCandidate = batchCandidate({ ...CLEAN, candidateId: "img1-1", imageIndex: 1 });
const QUESTIONABLE: OcrBatchCandidate = batchCandidate({
  candidateId: "img0-2",
  merchant: null,
  amount: null,
  currency: "CAD",
  direction: "unknown",
  occurredLocalDate: null,
  occurredTime: null,
  sourcePlatform: null,
  account: null,
  issues: [
    { code: "missing_amount", message: "没有读出金额，请填写。", field: "amount" },
    { code: "some_new_code", message: "识别服务的新提示。", field: null },
  ],
});

describe("OCR overview in English", () => {
  it("renders the overview, filters and cards without any Chinese", () => {
    applyLocale("en-US");
    const items = [CLEAN, TWIN, QUESTIONABLE];

    const html = renderToStaticMarkup(
      <OcrOverview
        items={items}
        counts={countBatchItems(items)}
        importableCount={countImportableItems(items)}
        filter="all"
        onFilterChange={() => undefined}
        source="WECHAT"
        onSourceChange={() => undefined}
        direction="expense"
        onDirectionChange={() => undefined}
        filtersOpen
        onToggleFilters={() => undefined}
        sources={["WECHAT", "TAOBAO"]}
        duplicateGroups={findSuspectedDuplicates(items)}
        categories={CATEGORIES}
        paymentMethods={METHODS}
        tags={TAGS}
        onOpenDetail={() => undefined}
        warnings={["One more screenshot couldn’t be classified."]}
        note="Kept in this tab only."
      />,
    );

    expect(html).toContain("Possible duplicates");
    expect(html).toContain("Category: Food &amp; drink (suggested)");
    expect(html).toContain("Payment method: WeChat Pay");
    expect(html).toContain("Couldn’t read the amount. Please fill it in.");
    expect(html).toContain("Something here needs checking.");
    expect(html).toContain("Taobao");
    expect(html).not.toMatch(CJK);
  });

  it("renders the bottom bar, its blockers and the completion summary without any Chinese", () => {
    applyLocale("en-US");
    const batch: OcrBatch = {
      version: 1,
      batchId: "b1",
      createdAt: "2026-10-09T04:00:00.000Z",
      bookId: null,
      pages: [],
      items: [CLEAN, QUESTIONABLE],
      importIds: {},
    };
    const blockers = findImportBlockers(batch);

    const bar = renderToStaticMarkup(
      <OcrImportBar
        importableCount={1}
        blockedReason={null}
        blockers={blockers}
        busy={false}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(bar).toContain("Import 1 entry");
    expect(bar).toContain("<strong class=\"font-semibold\">1</strong> ready to import");
    expect(bar).toContain("Why 1 entry can’t be imported");
    expect(validationBlocker(QUESTIONABLE)).toBe("Amount missing");
    expect(bar).not.toMatch(CJK);

    const outcome: OcrImportOutcome = {
      attempted: 3,
      succeeded: [
        { candidateId: "a", label: "a", pending: false },
        { candidateId: "b", label: "b", pending: true },
      ],
      failed: [{ candidateId: "c", label: "c", reason: "Offline" }],
      blockers: [],
    };
    const session: OcrImportSession = {
      version: 1,
      bookId: null,
      batches: [
        { batchId: "b1", sequence: 1, importedAt: "2026-10-09T04:00:00.000Z", succeeded: 2, failed: 1, pending: 1 },
      ],
    };

    const done = renderToStaticMarkup(
      <ImportDoneView outcome={outcome} session={session} onBackToDetail={() => undefined} onAgain={() => undefined} onRetry={() => undefined} />,
    );
    expect(done).toContain("Partly imported");
    expect(done).toContain("Batch 1");
    expect(done).not.toMatch(CJK);

    const toast = importToastFor(outcome);
    expect(`${toast.title} ${toast.detail}`).not.toMatch(CJK);
  });

  it("keeps the recognizer’s own wording in Chinese", () => {
    expect(ocrIssueText({ code: "missing_amount", message: "没有读出这一笔的金额，请填写。" })).toBe(
      "没有读出这一笔的金额，请填写。",
    );
  });
});
