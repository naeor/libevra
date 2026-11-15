import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  BillParseError,
  parseBoaPdf,
  parseWechatXlsx,
  type ExtractedDocument,
  type ParseContext,
} from "@libellum/shared/billParsers";

import { extractBillDocument } from "./index.js";
import { linesOfPage, round2, type PdfOpener } from "./pdf.js";
import { BOA_DETAIL, BOA_SUMMARY, FIXTURES, boaDetailWithTj, wechatWorkbook } from "./fixtures.js";
import { makePdf, parseXmlForTests, runsContent } from "./testSupport.js";

/**
 * 浏览器端抽取（`lib/billExtract`）与服务器 Python 抽取（`apps/api/src/import/extract_document.py`）的一致性。
 *
 * 夹具在 `fixtures.ts`（仓库里没有真实 XLSX / PDF 样本，按 Python 测试的 `make_xlsx` / `make_pdf` 用代码生成）。
 *
 * 每个夹具同时交给两边：
 * 1. **服务器**：直接运行 `extract_document.py`（本机有 Python 时现场跑；没有时用上次现场跑的结果
 *    `pythonOutputs.json`。`LIBEVRA_WRITE_PY_FIXTURES=1 npx vitest run src/lib/billExtract` 重新生成）；
 * 2. **浏览器**：`extractBillDocument`（Node 没有 DOMParser，用 `parseXmlForTests`；pdf.js 用 legacy 构建）。
 *
 * XLSX 与按绝对位置写字的 PDF 要求**输出逐字相同**；用 `TJ` 拆字的 PDF 两边的 span 切法不同（见 `pdf.ts` 头注释），
 * 要求的是交给 BOA 解析器后**候选账目相同**。另外在 5173 开发服务器的真实浏览器里用 `DOMParser` /
 * `DecompressionStream` / 打包的 pdf.js 跑过同一批夹具（交付报告里记录），这里的 Node 测试防回归。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../../..");
const script = path.join(repo, "apps/api/src/import/extract_document.py");
const storedPath = path.join(here, "pythonOutputs.json");
const require = createRequire(import.meta.url);

const nodePdfOpener: PdfOpener = async (data) => {
  const pdf = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdf.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs")).href;
  // pdf.js 要求以 "/" 结尾；Node 里按文件路径读字体数据。
  const fonts = `${path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts").split(path.sep).join("/")}/`;
  const task = pdf.getDocument({ data, useWasm: false, disableFontFace: true, standardFontDataUrl: fonts, verbosity: 0 });
  return { document: await task.promise, close: () => task.destroy() };
};

const options = { xmlParser: parseXmlForTests, openPdf: nodePdfOpener };

type Outcome = { readonly error: string } | ExtractedDocument;

async function browserOutcome(bytes: Uint8Array): Promise<Outcome> {
  try {
    return await extractBillDocument(bytes, options);
  } catch (error) {
    if (error instanceof BillParseError) return { error: error.code };
    throw error;
  }
}

function pythonExecutable(): string | null {
  const candidates = [
    process.env["LIBELLUM_IMPORT_PYTHON"],
    path.join(repo, "apps/ocr/.venv/Scripts/python.exe"),
    "python",
    "python3",
  ].filter((value): value is string => typeof value === "string" && value !== "");
  for (const candidate of candidates) {
    if (candidate.includes(path.sep) && !existsSync(candidate)) continue;
    const probe = spawnSync(candidate, ["-c", "import zipfile, zlib, json"], { windowsHide: true });
    if (probe.status === 0) return candidate;
  }
  return null;
}

/** 与 `apps/api/src/import/extractor.ts` 的 `normalizeDocument` 相同的补齐。 */
function pythonOutcome(python: string, bytes: Uint8Array): Outcome {
  const result = spawnSync(python, [script], {
    input: bytes,
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
    maxBuffer: 64 * 1024 * 1024,
  });
  const parsed = JSON.parse(result.stdout.toString("utf8")) as Record<string, unknown>;
  if (typeof parsed["error"] === "string") return { error: parsed["error"] };
  return {
    format: parsed["format"] as "pdf" | "xlsx",
    sheets: (parsed["sheets"] as ExtractedDocument["sheets"] | undefined) ?? [],
    pages: (parsed["pages"] as ExtractedDocument["pages"] | undefined) ?? [],
  };
}

const CONTEXT: ParseContext = {
  fingerprint: "e".repeat(64),
  timezone: "Asia/Shanghai",
  categories: [{ id: "11111111-1111-4111-8111-111111111111", name: "餐饮", kind: "expense", isArchived: false }],
  paymentMethods: [{ id: "33333333-3333-4333-8333-333333333333", name: "零钱", isArchived: false }],
};

/** 候选去掉随机 id 后比较。 */
function parsedWithoutIds(document: ExtractedDocument): unknown {
  const bill = document.format === "pdf" ? parseBoaPdf(document.pages, CONTEXT) : parseWechatXlsx(document.sheets, CONTEXT);
  return { ...bill, candidates: bill.candidates.map(({ id: _id, ...rest }) => rest) };
}

describe("浏览器抽取与服务器 Python 抽取一致", () => {
  const python = pythonExecutable();
  let stored: Record<string, Outcome> = {};
  const fresh: Record<string, Outcome> = {};

  beforeAll(() => {
    if (existsSync(storedPath)) stored = JSON.parse(readFileSync(storedPath, "utf8")) as Record<string, Outcome>;
  });

  for (const fixture of FIXTURES) {
    it(fixture.name, async () => {
      const bytes = await fixture.bytes();
      const browser = await browserOutcome(bytes);
      const server = python === null ? stored[fixture.name] : pythonOutcome(python, bytes);
      expect(server, `没有 Python，也没有 ${fixture.name} 的存档结果`).toBeDefined();
      fresh[fixture.name] = server!;
      if (python !== null && stored[fixture.name] !== undefined && process.env["LIBEVRA_WRITE_PY_FIXTURES"] !== "1") {
        // 存档要与现场跑的结果一致，否则没有 Python 的机器会拿旧结果比较。
        expect(stored[fixture.name]).toEqual(server);
      }
      if (fixture.identical) {
        expect(browser).toEqual(server);
      } else {
        expect("error" in browser || "error" in server!).toBe(false);
        expect(parsedWithoutIds(browser as ExtractedDocument)).toEqual(parsedWithoutIds(server as ExtractedDocument));
        expect(browser).not.toEqual(server); // 证明这一份确实走到了两边切法不同的路径
      }
    });
  }

  it("（存档）LIBEVRA_WRITE_PY_FIXTURES=1 时写出 Python 结果", () => {
    if (process.env["LIBEVRA_WRITE_PY_FIXTURES"] === "1") {
      expect(python).not.toBeNull();
      writeFileSync(storedPath, `${JSON.stringify(fresh, null, 1)}\n`, "utf8");
    }
    expect(Object.keys(stored).length > 0 || process.env["LIBEVRA_WRITE_PY_FIXTURES"] === "1").toBe(true);
  });
});

describe("交给解析器后与服务器同一结果", () => {
  it("微信 XLSX：候选、警告与说明区核对相同", async () => {
    const document = await extractBillDocument(await wechatWorkbook(), options);
    const bill = parseWechatXlsx(document.sheets, CONTEXT);
    expect(bill.candidates.map((candidate) => [candidate.line, candidate.date, candidate.time, candidate.amount, candidate.kind, candidate.sourceRef])).toEqual([
      [18, "2026-09-22", "00:27:27", "18.00", "expense", "wechat:4200000000000000000000000000000000001234"],
      [19, "2026-09-23", "12:00:00", "50.00", "income", "wechat:4200000000000000000000000000000000000077"],
      [20, "2026-09-24", "00:00:00", "0.50", "expense", expect.stringMatching(/^wechat:[0-9a-f]{16}$/)],
    ]);
  });

  it("已知差异：TJ 拆开的换行描述——服务器丢掉这一行，浏览器拼回上一笔（其余候选、对账相同）", async () => {
    const python = pythonExecutable();
    const bytes = makePdf([runsContent(BOA_SUMMARY), boaDetailWithTj(true)]);
    const browser = parseBoaPdf((await extractBillDocument(bytes, options)).pages, CONTEXT);
    expect(browser.candidates[0]?.merchant).toBe("PAYROLL ACME INC REF 123456");
    expect(browser.warnings).toEqual(["有 1 行描述换行，已拼接到上一笔交易。"]);
    if (python === null) return;
    const server = pythonOutcome(python, bytes) as ExtractedDocument;
    const parsed = parseBoaPdf(server.pages, CONTEXT);
    expect(parsed.candidates[0]?.merchant).toBe("PAYROLL ACME INC");
    expect(parsed.warnings).toEqual([]);
    const strip = (bill: typeof parsed) => bill.candidates.map(({ id: _id, merchant: _merchant, ...rest }) => rest);
    expect(strip(browser)).toEqual(strip(parsed));
    expect(browser.reconciliation).toEqual(parsed.reconciliation);
  });

  it("BOA PDF：识别为 BOA、两段对账一致、换行描述拼回", async () => {
    const document = await extractBillDocument(makePdf([runsContent(BOA_SUMMARY), runsContent(BOA_DETAIL)]), options);
    const bill = parseBoaPdf(document.pages, CONTEXT);
    expect(bill.reconciliation.ok).toBe(true);
    expect(bill.candidates.map((candidate) => [candidate.date, candidate.amount, candidate.kind, candidate.merchant])).toEqual([
      ["2026-09-21", "500.00", "income", "PAYROLL ACME INC REF 123456"],
      ["2026-09-22", "200.00", "expense", "ATM WITHDRAWAL"],
      ["2026-09-23", "100.00", "expense", "CARD PURCHASE 09/20 COFFEE"],
      ["2026-09-24", "100.00", "expense", "MONTHLY FEE"],
    ]);
  });
});

describe("Python 语义的小细节", () => {
  it("round2 与 Python round(x, 2) 相同（中点取偶）", () => {
    expect([0.125, 0.375, 72.625, -0.125, 1.005, 2.675, 36, 90.8].map(round2)).toEqual([0.12, 0.38, 72.62, -0.12, 1, 2.67, 36, 90.8]);
  });

  it("成行：只与最近 3 行比较、容差 max(2, min(字号×0.6, 6))，行内按 x 排序", () => {
    const item = (x: number, y: number, size: number, str: string) => ({ str, transform: [size, 0, 0, size, x, y] });
    const state = { total: 0 };
    const lines = linesOfPage([item(90, 700, 10, "B"), item(36, 703, 10, "A"), item(36, 690, 10, "C"), item(0, 0, 10, "   ")], state);
    expect(lines).toEqual([{ y: 703, spans: [{ x: 36, text: "A" }, { x: 90, text: "B" }] }, { y: 690, spans: [{ x: 36, text: "C" }] }]);
    expect(state.total).toBe(3);
  });
});
