import { describe, expect, it } from "vitest";

import {
  MAX_BILL_IMPORT_BYTES,
  type BillImportCandidate,
  type BillImportPreview,
} from "@libellum/shared";

import {
  BILL_IMPORT_ACCEPT,
  BILL_IMPORT_FILTERS,
  billAcknowledgementReasons,
  billCommitCheck,
  billDuplicateGroups,
  billFileProblem,
  billFilterCounts,
  billFilterRows,
  billHistoryDuplicates,
  billLocationText,
  billReportView,
  billRowNotes,
  billRowSelected,
  billRowStatus,
  billRowWarnings,
  billSourceRefText,
  billTagsText,
  billTimeText,
  formatBillFileSize,
  parseBillTags,
} from "./billImportUi.js";

/**
 * 账单导入 V2 的判定层。
 *
 * 这一层是“界面说了什么”的依据：数量对不对、哪些要核对、疑似重复怎么分组、
 * 什么情况下不许提交、结果页的失败落在第几行/第几页。页面本身只用静态渲染与源码契约
 * 测试（web 测试跑在 Node 里，没有 DOM），所以数字与措辞的真相必须钉在这里。
 */

let nextId = 0;

function candidate(overrides: Partial<BillImportCandidate> = {}): BillImportCandidate {
  nextId += 1;
  return {
    id: `01990000-0000-7000-8000-${String(nextId).padStart(12, "0")}`,
    selected: true,
    amount: "20.00",
    currency: "CNY",
    kind: "expense",
    date: "2026-10-09",
    time: "12:34:00",
    timezone: "Asia/Shanghai",
    categoryId: null,
    paymentMethodId: null,
    note: "",
    tags: [],
    line: nextId + 1,
    timePrecision: "second",
    merchant: "老王便利店",
    sourceRef: "TX20261009001",
    sourceStatus: "支付成功",
    warnings: [],
    duplicateIds: [],
    identityDuplicate: false,
    ...overrides,
  };
}

function previewOf(
  candidates: readonly BillImportCandidate[],
  overrides: Partial<Pick<BillImportPreview, "warnings" | "reconciliation">> = {},
): Pick<BillImportPreview, "candidates" | "warnings" | "reconciliation"> {
  return {
    candidates: [...candidates],
    warnings: [],
    reconciliation: { ok: true, messages: [] },
    ...overrides,
  };
}

describe("formatBillFileSize", () => {
  it("人话大小：0 字节、KB、MB", () => {
    expect(formatBillFileSize(0)).toBe("0 B");
    expect(formatBillFileSize(512)).toBe("512 B");
    expect(formatBillFileSize(1536)).toBe("1.5 KB");
    expect(formatBillFileSize(MAX_BILL_IMPORT_BYTES)).toBe("10 MB");
  });
});

describe("billFileProblem", () => {
  it("接受三种账单格式与 Libevra CSV", () => {
    expect(billFileProblem({ name: "微信支付账单.xlsx", size: 1024 })).toBeNull();
    expect(billFileProblem({ name: "alipay.csv", size: 1024 })).toBeNull();
    expect(billFileProblem({ name: "boa.pdf", size: 1024 })).toBeNull();
    expect(BILL_IMPORT_ACCEPT).toContain(".xlsx");
  });

  it("扩展名被改坏时，靠 MIME 放行（服务端才是最终裁决）", () => {
    expect(billFileProblem({ name: "statement", size: 1024, type: "application/pdf" })).toBeNull();
    expect(billFileProblem({ name: "账单.txt", size: 1024, type: "text/csv" })).toBeNull();
  });

  it("空文件与超限直接说清楚，不让用户白等一次上传", () => {
    expect(billFileProblem({ name: "a.csv", size: 0 })).toContain("空的");
    const oversized = billFileProblem({ name: "a.csv", size: MAX_BILL_IMPORT_BYTES + 1 });
    expect(oversized).toContain("超过 10 MB 上限");
  });

  it("认不出的格式在选择阶段就拒绝，并说明支持什么", () => {
    const problem = billFileProblem({ name: "notes.txt", size: 1024 });
    expect(problem).toContain("只支持 CSV、XLSX、PDF");
    expect(problem).toContain("微信");
  });
});

describe("billRowStatus", () => {
  it("身份重复优先于一切：来源已存在时即使有重复标记也只显示“来源已存在”", () => {
    const item = candidate({ identityDuplicate: true, duplicateIds: ["x"] });
    expect(billRowStatus(item, null)).toBe("identity");
  });

  it("疑似重复、待核对、可导入、已跳过四档", () => {
    expect(billRowStatus(candidate({ duplicateIds: ["x"] }), null)).toBe("duplicate");
    expect(billRowStatus(candidate(), "请确认交易日期。")).toBe("review");
    expect(billRowStatus(candidate({ warnings: ["分类没认出来"] }), null)).toBe("review");
    expect(billRowStatus(candidate(), null)).toBe("ready");
    expect(billRowStatus(candidate({ selected: false }), null)).toBe("excluded");
  });
});

describe("billRowSelected", () => {
  it("身份重复永远不算“会写入”，与服务端 billCommitRows 的语义一致", () => {
    expect(billRowSelected(candidate({ identityDuplicate: true, selected: true }))).toBe(false);
    expect(billRowSelected(candidate({ selected: false }))).toBe(false);
    expect(billRowSelected(candidate())).toBe(true);
  });
});

describe("billFilterCounts", () => {
  it("一次算清顶部汇总与五个筛选的数量", () => {
    const items = [
      candidate(),
      candidate({ duplicateIds: ["x"] }),
      candidate({ identityDuplicate: true }),
      candidate({ amount: "0", selected: true }),
      candidate({ selected: false }),
    ];

    const counts = billFilterCounts(items);
    expect(counts.all).toBe(5);
    expect(counts.total).toBe(5);
    expect(counts.duplicate).toBe(1);
    expect(counts.review).toBe(1);
    expect(counts.selected).toBe(3);
    expect(counts.excluded).toBe(2);
    expect(counts.identity).toBe(1);
  });

  it("接受外部缓存的逐笔问题查询（页面为几万行缓存结果）", () => {
    const items = [candidate(), candidate()];
    const counts = billFilterCounts(items, () => "请确认交易日期。");
    expect(counts.review).toBe(2);
  });
});

describe("billFilterRows", () => {
  const ready = candidate();
  const duplicate = candidate({ duplicateIds: ["x"] });
  const skipped = candidate({ selected: false });
  const items = [ready, duplicate, skipped];

  it("每个筛选返回它承诺的那一档", () => {
    expect(billFilterRows(items, "all")).toHaveLength(3);
    expect(billFilterRows(items, "review")).toHaveLength(0);
    expect(billFilterRows(items, "duplicate")).toEqual([duplicate]);
    expect(billFilterRows(items, "selected")).toEqual([ready, duplicate]);
    expect(billFilterRows(items, "excluded")).toEqual([skipped]);
  });

  it("字段问题算“待核对”，疑似重复不算（重复不等于填错）", () => {
    const broken = candidate({ amount: "" });
    expect(billFilterRows([broken, duplicate], "review")).toEqual([broken]);
  });

  it("筛选顺序与按钮顺序一致", () => {
    expect(BILL_IMPORT_FILTERS.map((filter) => filter.id)).toEqual([
      "all",
      "review",
      "duplicate",
      "selected",
      "excluded",
    ]);
  });
});

describe("billDuplicateGroups", () => {
  it("文件内部重复按并查集分组，并按出现顺序排列", () => {
    const first = candidate();
    const second = candidate();
    const third = candidate();
    first.duplicateIds = [second.id];
    second.duplicateIds = [first.id, third.id];
    third.duplicateIds = [second.id];

    const groups = billDuplicateGroups([first, second, third]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.ids).toEqual([first.id, second.id, third.id]);
    expect(groups[0]?.reason).toContain("服务端统一判重");
    expect(groups[0]?.groupId).toBe("bill-dup-1");
  });

  it("没有重复时返回空数组，不显示空分组", () => {
    expect(billDuplicateGroups([candidate(), candidate()])).toEqual([]);
  });

  it("指向账本已有账目的编号不是文件内分组，单独进 history", () => {
    const item = candidate({ duplicateIds: ["tx-existing"] });
    expect(billDuplicateGroups([item])).toEqual([]);
    expect(billHistoryDuplicates([item])).toEqual([
      { candidateId: item.id, ids: ["tx-existing"] },
    ]);
  });

  it("⚠ 只分组，不取消勾选", () => {
    const first = candidate({ duplicateIds: [] });
    const second = candidate();
    first.duplicateIds = [second.id];
    billDuplicateGroups([first, second]);
    expect(first.selected).toBe(true);
    expect(second.selected).toBe(true);
  });
});

describe("billCommitCheck", () => {
  function checkOf(
    items: readonly BillImportCandidate[],
    acknowledged = true,
    problems: ReadonlyMap<string, string | null> = new Map(),
    preview = previewOf(items),
  ) {
    return billCommitCheck(items, preview, acknowledged, problems);
  }

  it("全部正常时没有阻塞，可导入数等于选中数", () => {
    const items = [candidate(), candidate()];
    const check = checkOf(items);
    expect(check.blockers).toEqual([]);
    expect(check.selectedCount).toBe(2);
    expect(check.importableCount).toBe(2);
  });

  it("身份重复不算选中、也不算可导入", () => {
    const items = [candidate(), candidate({ identityDuplicate: true })];
    const check = checkOf(items);
    expect(check.selectedCount).toBe(1);
    expect(check.importableCount).toBe(1);
  });

  it("空文件、一个都没选、字段问题、提示未确认，各有一条阻塞理由", () => {
    expect(checkOf([]).blockers[0]).toContain("没有识别到可以导入的交易");

    const none = checkOf([candidate({ selected: false })]);
    expect(none.blockers[0]).toContain("还没有选中");

    const broken = candidate();
    const problem = checkOf([broken], true, new Map([[broken.id, "请确认交易日期。"]]));
    expect(problem.problems).toEqual([{ id: broken.id, message: "请确认交易日期。" }]);
    expect(problem.blockers[0]).toContain("有 1 笔需要先改好");
    expect(problem.importableCount).toBe(0);

    const unacknowledged = checkOf(
      [candidate()],
      false,
      new Map(),
      previewOf([], {
        warnings: ["这份结单的期初与期末对不上"],
        reconciliation: { ok: false, messages: ["期初 + 存入 − 扣款 ≠ 期末"] },
      }),
    );
    expect(unacknowledged.needsAcknowledgement).toBe(true);
    expect(unacknowledged.blockers[0]).toContain("我已了解上面的提示");
  });

  it("文件级提示 + 对账差异 = 需要确认；两者都没有就不需要", () => {
    expect(
      billCommitCheck([candidate()], previewOf([]), true, new Map()).needsAcknowledgement,
    ).toBe(false);

    const reasons = billAcknowledgementReasons(
      previewOf([], {
        warnings: ["有几行被跳过"],
        reconciliation: { ok: false, messages: ["差额 1.00"] },
      }),
    );
    expect(reasons).toEqual(["有几行被跳过", "对账差异：差额 1.00"]);
  });

  it("对账一致时不需要确认差异", () => {
    expect(
      billAcknowledgementReasons(previewOf([], { reconciliation: { ok: true, messages: [] } })),
    ).toEqual([]);
  });
});

describe("billReportView", () => {
  const first = candidate({ line: 12, page: 3 });
  const second = candidate({ line: 13 });

  it("全部成功：状态 success，四个数字对应报告", () => {
    const view = billReportView(
      {
        ok: true,
        rowCount: 2,
        importedCount: 2,
        skippedCount: 0,
        skippedLines: [],
        errors: [],
      },
      previewOf([first, second]),
      2,
    );

    expect(view.status).toBe("success");
    expect(view.read).toBe(2);
    expect(view.selected).toBe(2);
    expect(view.imported).toBe(2);
    expect(view.skipped).toBe(0);
    expect(view.failed).toBe(0);
  });

  it("部分成功：失败项带 PDF 页码、列名与原因", () => {
    const view = billReportView(
      {
        ok: false,
        rowCount: 2,
        importedCount: 1,
        skippedCount: 0,
        skippedLines: [],
        errors: [{ line: 12, column: "金额", message: "金额格式不对" }],
      },
      previewOf([first, second]),
      2,
    );

    expect(view.status).toBe("partial");
    expect(view.failures).toEqual([
      { line: 12, page: 3, where: "第 3 页 · 第 12 行", message: "金额：金额格式不对" },
    ]);
    expect(view.failed).toBe(1);
  });

  it("一条都没写进去：状态 failed，不是“成功但空”", () => {
    const view = billReportView(
      {
        ok: false,
        rowCount: 1,
        importedCount: 0,
        skippedCount: 1,
        skippedLines: [2],
        errors: [],
      },
      previewOf([candidate({ line: 2 })]),
      0,
    );

    expect(view.status).toBe("failed");
    expect(view.skipped).toBe(1);
    expect(view.skippedLines).toEqual([2]);
  });
});

describe("展示文案", () => {
  it("日期-only 明说“时间信息不足”，不编造时分秒", () => {
    expect(billTimeText({ date: "2026-01-05", time: null, timePrecision: "day" })).toBe(
      "2026-01-05 · 时间信息不足",
    );
    expect(
      billTimeText({ date: "2026-01-05", time: "08:00:00", timePrecision: "second" }),
    ).toBe("2026-01-05 08:00:00");
  });

  it("定位到行，PDF 再带页码", () => {
    expect(billLocationText({ line: 12 })).toBe("第 12 行");
    expect(billLocationText({ line: 12, page: 3 })).toBe("第 3 页 · 第 12 行");
  });

  it("来源单号为空时不显示空字段", () => {
    expect(billSourceRefText({ sourceRef: null })).toBeNull();
    expect(billSourceRefText({ sourceRef: "   " })).toBeNull();
    expect(billSourceRefText({ sourceRef: "TX-1" })).toBe("TX-1");
  });

  it("标签按中英文逗号、顿号、空白拆分并去重；空输入是空数组", () => {
    expect(parseBillTags("工作, 出差、报销  工作")).toEqual(["工作", "出差", "报销"]);
    expect(parseBillTags("   ")).toEqual([]);
    expect(parseBillTags("a".repeat(60))).toHaveLength(1);
    expect(parseBillTags("a".repeat(60))[0]).toHaveLength(40);
    expect(billTagsText(["工作", "出差"])).toBe("工作 出差");
  });

  it("逐笔说明：字段问题 + 服务端提醒 + 历史相似 + 身份已存在", () => {
    const item = candidate({ warnings: ["分类没认出来"], identityDuplicate: true });
    const notes = billRowNotes(item, "请确认交易日期。", ["tx-1"]);
    expect(notes).toContain("分类没认出来");
    expect(notes).toContain("请确认交易日期。");
    expect(notes.join(" ")).toContain("与账本里已有的账目相似");
    expect(notes.join(" ")).toContain("来源身份已存在");

    expect(billRowWarnings(candidate(), null)).toEqual([]);
    expect(billRowWarnings(candidate(), "请确认币种。")).toEqual(["请确认币种。"]);
  });
});
