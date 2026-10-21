import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_DUPLICATE_DETECTION_SETTINGS,
  type BillImportCandidate,
  type BillImportPreview,
} from "@libellum/shared";

import { BILL_SOURCE_LABELS, billCommitRows, commitBill, previewBill, recheckBill } from "./billImport.js";

/**
 * 客户端契约：请求打到哪里、带什么、如何解析响应。
 *
 * 纯 Node 环境没有浏览器，这里像 `notDuplicateRelationsApi.test.ts` 一样把
 * `window`（超时定时器）、`navigator.onLine` 与 `fetch` 换成最小 stub，
 * 只验证形状；真正的导入行为由 API 集成测试覆盖。
 */

let requested: { url: string; init: RequestInit }[] = [];

function stubBrowser(responseBody: unknown, status = 200): void {
  vi.stubGlobal("window", {
    setTimeout: (handler: () => void, timeout?: number) => setTimeout(handler, timeout),
    clearTimeout: (id: number) => clearTimeout(id),
  });
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      requested.push({ url, init });
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(responseBody),
      };
    }),
  );
}

function candidate(overrides: Partial<BillImportCandidate> = {}): BillImportCandidate {
  return {
    id: "01990000-0000-7000-8000-000000000001",
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
    line: 2,
    timePrecision: "second",
    merchant: "老王便利店",
    sourceRef: "TX-1",
    sourceStatus: "支付成功",
    warnings: [],
    duplicateIds: [],
    identityDuplicate: false,
    ...overrides,
  };
}

function previewOf(candidates: readonly BillImportCandidate[]): BillImportPreview {
  return {
    previewId: "01990000-0000-7000-8000-0000000000ff",
    expiresAt: "2026-10-21T13:00:00.000Z",
    source: "wechat",
    format: "xlsx",
    candidates: [...candidates],
    warnings: [],
    reconciliation: { ok: null, messages: [] },
  };
}

function xlsxFile(): File {
  return new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "微信支付账单.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

const REPORT = {
  ok: true,
  rowCount: 2,
  importedCount: 1,
  skippedCount: 1,
  skippedLines: [3],
  errors: [],
};

afterEach(() => {
  requested = [];
  vi.unstubAllGlobals();
});

describe("来源名称", () => {
  it("四种来源都有中文名，界面不直接显示 libevra/wechat 这种内部值", () => {
    expect(BILL_SOURCE_LABELS).toEqual({
      libevra: "Libevra 账单",
      wechat: "微信支付账单",
      alipay: "支付宝交易明细",
      boa: "Bank of America 结单",
    });
  });
});

describe("previewBill", () => {
  it("multipart 上传：settings/timezone/file 三个字段，不带 content-type", async () => {
    stubBrowser(previewOf([candidate()]));

    const file = xlsxFile();
    const preview = await previewBill(
      file,
      "book-1",
      DEFAULT_DUPLICATE_DETECTION_SETTINGS,
      "Asia/Shanghai",
    );

    expect(preview.source).toBe("wechat");
    expect(requested).toHaveLength(1);

    const [call] = requested;
    expect(call!.url).toBe("/api/v1/import/preview");
    expect(call!.init.method).toBe("POST");
    expect((call!.init.headers as Record<string, string>)["x-libellum-book"]).toBe("book-1");
    // 浏览器自己生成 boundary，手写 content-type 会让服务端解析失败。
    expect((call!.init.headers as Record<string, string>)["content-type"]).toBeUndefined();

    const form = call!.init.body as FormData;
    expect(form.get("timezone")).toBe("Asia/Shanghai");
    expect(JSON.parse(String(form.get("settings")))).toEqual(DEFAULT_DUPLICATE_DETECTION_SETTINGS);
    const sent = form.get("file");
    expect(sent).toBeInstanceOf(File);
    expect((sent as File).name).toBe("微信支付账单.xlsx");
  });

  it("响应不符合契约时拒绝，而不是把半成品交给界面", async () => {
    stubBrowser({ previewId: "not-a-uuid", candidates: [] });

    await expect(
      previewBill(xlsxFile(), "book-1", DEFAULT_DUPLICATE_DETECTION_SETTINGS, "Asia/Shanghai"),
    ).rejects.toThrow();
  });
});

describe("recheckBill / commitBill 的请求行", () => {
  it("重新检查只送可编辑字段，身份重复强制 selected=false", async () => {
    stubBrowser(previewOf([candidate()]));

    const identity = candidate({
      id: "01990000-0000-7000-8000-000000000002",
      identityDuplicate: true,
      selected: true,
      duplicateIds: ["tx-existing"],
    });
    await recheckBill(
      previewOf([candidate(), identity]),
      "book-2",
      DEFAULT_DUPLICATE_DETECTION_SETTINGS,
    );

    const [call] = requested;
    expect(call!.url).toBe("/api/v1/import/recheck");
    const body = JSON.parse(String(call!.init.body)) as {
      previewId: string;
      rows: Record<string, unknown>[];
      settings: unknown;
    };

    expect(body.previewId).toBe("01990000-0000-7000-8000-0000000000ff");
    expect(body.settings).toEqual(DEFAULT_DUPLICATE_DETECTION_SETTINGS);
    expect(body.rows).toHaveLength(2);
    // ⚠️ 这些字段属于“预览”，提交时由服务端自己按 previewId 取，不接受浏览器回传。
    expect(Object.keys(body.rows[0]!).sort()).toEqual([
      "amount",
      "categoryId",
      "currency",
      "date",
      "id",
      "kind",
      "note",
      "paymentMethodId",
      "selected",
      "tags",
      "time",
      "timezone",
    ]);
    expect(body.rows[1]?.selected).toBe(false);
  });

  it("提交把 acknowledgeWarnings 一起带上，并解析出导入报告", async () => {
    stubBrowser(REPORT);

    const report = await commitBill(previewOf([candidate(), candidate()]), "book-1", true);

    expect(report.importedCount).toBe(1);
    expect(report.skippedCount).toBe(1);
    const body = JSON.parse(String(requested[0]!.init.body)) as {
      previewId: string;
      acknowledgeWarnings: boolean;
      rows: unknown[];
    };
    expect(body.acknowledgeWarnings).toBe(true);
    expect(body.rows).toHaveLength(2);
  });

  it("提交的响应缺字段时抛出，界面不会显示编造的数字", async () => {
    stubBrowser({ ok: true, importedCount: 1 });

    await expect(commitBill(previewOf([candidate()]), "book-1", false)).rejects.toThrow();
  });
});

describe("billCommitRows", () => {
  it("只保留契约里的可编辑字段，provenance 留在服务端预览里", () => {
    const rows = billCommitRows([
      candidate({ note: "备注", tags: ["工作"], categoryId: null, paymentMethodId: null }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: "01990000-0000-7000-8000-000000000001",
      selected: true,
      amount: "20.00",
      currency: "CNY",
      kind: "expense",
      date: "2026-10-09",
      time: "12:34:00",
      timezone: "Asia/Shanghai",
      categoryId: null,
      paymentMethodId: null,
      note: "备注",
      tags: ["工作"],
    });
    expect(rows[0]).not.toHaveProperty("duplicateIds");
    expect(rows[0]).not.toHaveProperty("merchant");
  });

  it("身份重复永远以 selected=false 发出（服务端唯一约束之外的第二道保险）", () => {
    const [row] = billCommitRows([candidate({ identityDuplicate: true, selected: true })]);
    expect(row?.selected).toBe(false);
  });
});
