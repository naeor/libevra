import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyLocale, type Locale } from "../i18n/index.js";
import { fetchExport, fetchTemplate } from "../lib/queries.js";

/**
 * S16：**导出文件不随界面语言变化。**
 *
 * 导出页翻译的只是界面；文件本身——服务器生成的 CSV / XLSX 字节、客户端按固定规则起的文件名、
 * 请求里的筛选参数与请求头——在中文和英文界面下必须完全相同，否则切换语言后导出的文件
 * 再导入时会按另一套表头解析（见 `docs/specs/design/国际化与本地化规范.md` §3）。
 *
 * 这里用最小的 `fetch` 桩代替服务器：同一份字节原样返回，比较两种语言下“发出去的请求”和
 * “交给用户的文件”是否逐字节一致。
 */

/** 服务器返回的内容（表头是中文原文——它是数据，不是界面文字）。 */
const SERVER_CSV = new TextEncoder().encode("日期,时间,收支,金额,币种\n2026-10-01,12:30,支出,12.50,CNY\n");

interface Captured {
  readonly url: string;
  readonly headers: Record<string, string>;
}

let requests: Captured[] = [];

function stubServer(): void {
  vi.stubGlobal("window", {
    setTimeout: (handler: () => void, timeout?: number) => setTimeout(handler, timeout),
    clearTimeout: (id: number) => clearTimeout(id),
  });
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, headers: { ...(init.headers as Record<string, string>) } });
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => SERVER_CSV.slice().buffer,
        headers: new Headers({ "x-libellum-file-ref": "Out-20261025-0001", "x-libellum-row-count": "1" }),
      };
    }),
  );
}

interface ExportRun {
  readonly requests: readonly Captured[];
  readonly files: readonly { readonly fileName: string; readonly mimeType: string; readonly bytes: readonly number[] }[];
}

async function exportUnder(locale: Locale): Promise<ExportRun> {
  applyLocale(locale);
  requests = [];

  const files = [
    await fetchExport({ format: "csv" }, "book-1"),
    await fetchExport({ format: "xlsx", monthFrom: "2026-08", monthTo: "2026-10", kind: "expense" }, "book-1"),
    await fetchExport({ format: "csv", monthFrom: "2026-10", currency: "USD" }),
    await fetchTemplate("book-1"),
  ];

  return {
    requests: [...requests],
    files: files.map((file) => ({ fileName: file.fileName, mimeType: file.mimeType, bytes: [...file.bytes] })),
  };
}

beforeEach(() => {
  // 文件名里带当天日期：两次导出必须落在同一天，比较才有意义。
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 25, 10, 0, 0));
  stubServer();
});

afterEach(() => {
  applyLocale("zh-CN");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("导出文件与界面语言无关", () => {
  it("中文与英文界面下，请求与得到的文件逐字节一致", async () => {
    const zh = await exportUnder("zh-CN");
    const en = await exportUnder("en-US");

    expect(en.requests).toEqual(zh.requests);
    expect(en.files).toEqual(zh.files);
    // 服务器给什么，用户就拿到什么：客户端不改写内容。
    expect(en.files[0]?.bytes).toEqual([...SERVER_CSV]);
  });

  it("请求里不带界面语言（服务器无从按语言改变文件）", async () => {
    const en = await exportUnder("en-US");

    for (const request of en.requests) {
      expect(Object.keys(request.headers).map((name) => name.toLowerCase())).not.toContain("accept-language");
      expect(request.url).not.toMatch(/[?&](lang|locale|language)=/i);
    }
  });

  it("文件名沿用原来的固定规则（后续再导入或对照时按名字找得到）", async () => {
    const en = await exportUnder("en-US");

    expect(en.files.map((file) => file.fileName)).toEqual([
      "账目-全部-20261025.csv",
      "账目-2026-08-2026-10-20261025.xlsx",
      "账目-2026-10-至今-20261025.csv",
      "记账导入模板.csv",
    ]);
  });
});
