import { randomUUID } from "node:crypto";

import { parseAmountToMinor, type BillImportCandidate } from "@libellum/shared";

import {
  cleanText,
  formatAmountText,
  normalizeAmountText,
  parseLocalDate,
  suggestCategoryId,
  syntheticSourceRef,
  truncateText,
} from "./common.js";
import {
  BillParseError,
  type ExtractedLine,
  type ParseContext,
  type ParsedBill,
} from "./types.js";

type Section = "deposits" | "atm" | "other" | "fees";
type Totals = Record<Section, number | null>;

interface StatementTotals {
  readonly beginning: number | null;
  readonly ending: number | null;
  readonly sections: Totals;
}

interface TransactionRow {
  readonly page: number;
  readonly line: number;
  y: number;
  date: string;
  amount: string;
  description: string;
}

const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{2})$/;
const AMOUNT_RE = /^-?\$?\d{1,3}(?:,\d{3})*\.\d{2}$/;

function textOf(line: ExtractedLine): string {
  return line.spans.map((span) => span.text).join(" ").trim();
}

function parseBoaDate(raw: string): string | null {
  const match = DATE_RE.exec(cleanText(raw));
  if (match === null) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = 2000 + Number(match[3]);
  const stamp = Date.UTC(year, month - 1, day);
  const check = new Date(stamp);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const DESCRIPTION_DATE_RE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/;

/**
 * BOA 只给「过账日期」；部分商户描述里还会写交易日期（如 `UBER EATS 10/03`）。
 *
 * 两个日期不一致时不改写候选日期（避免编造消费日期），但把差异作为警告交给用户核对：
 * 这是「消费日期 vs 入账日期」在本轮数据模型下能做到的核对边界。
 */
function descriptionDate(description: string, postingDate: string): string | null {
  const match = DESCRIPTION_DATE_RE.exec(description);
  const posting = parseLocalDate(postingDate);
  if (match === null || posting === null) return null;

  const month = Number(match[1]);
  const day = Number(match[2]);
  const explicitYear = match[3] === undefined ? null : Number(match[3]);
  let year = explicitYear === null ? posting.year : explicitYear < 100 ? 2000 + explicitYear : explicitYear;
  if (explicitYear === null) {
    if (month === 12 && posting.month === 1) year -= 1;
    if (month === 1 && posting.month === 12) year += 1;
  }

  const stamp = Date.UTC(year, month - 1, day);
  const check = new Date(stamp);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return iso === posting.iso ? null : iso;
}

function amountToCents(raw: string): number | null {
  const text = cleanText(raw).replace(/\$/g, "");
  // 结单用负号表示支出；parseAmountToMinor 只收无符号十进制金额，
  // 所以先取绝对值，最后再把符号加回去，供分区合计使用。
  const negative = text.startsWith("-");
  const normalized = normalizeAmountText(negative ? text.slice(1) : text, "USD");
  if (normalized === null) return null;
  try {
    const minor = parseAmountToMinor(normalized, 2);
    return negative ? -minor : minor;
  } catch {
    return null;
  }
}

function sectionFromHeader(text: string): Section | "withdrawals" | null {
  const lower = text.toLowerCase();
  if (lower.startsWith("deposits and other additions")) return "deposits";
  if (lower.startsWith("atm and debit card subtractions")) return "atm";
  if (lower.startsWith("other subtractions")) return "other";
  if (lower.startsWith("service fees")) return "fees";
  if (lower.startsWith("withdrawals and other subtractions")) return "withdrawals";
  return null;
}

function sectionFromTotal(text: string): Section | null {
  const lower = text.toLowerCase();
  if (lower.startsWith("total deposits and other additions")) return "deposits";
  if (lower.startsWith("total atm and debit card subtractions")) return "atm";
  if (lower.startsWith("total other subtractions")) return "other";
  if (lower.startsWith("total service fees")) return "fees";
  return null;
}

function hasAmountSpan(line: ExtractedLine): boolean {
  return line.spans.some(
    (span) => span.x >= 500 && AMOUNT_RE.test(cleanText(span.text)),
  );
}

function isDateSpan(span: { readonly x: number; readonly text: string }): boolean {
  return span.x < 80 && DATE_RE.test(cleanText(span.text));
}

function isColumnHeader(line: ExtractedLine): boolean {
  const texts = line.spans.map((span) => cleanText(span.text));
  return texts.includes("Date") && texts.includes("Description") && texts.includes("Amount");
}

function currency(cents: number): string {
  return `$${formatAmountText(cents, "USD")}`;
}

/**
 * 从 Account summary 读期初/期末与三（四）段汇总。
 *
 * 只在前两页找：第 3 页起的分区标题没有金额，若混在一起会把「分区标题」
 * 误当成汇总行。金额都在第二个 span，直接取最后一个 span 即可。
 */
function readStatementTotals(pages: readonly (readonly ExtractedLine[])[]): StatementTotals {
  let beginning: number | null = null;
  let ending: number | null = null;
  const sections: Totals = { deposits: null, atm: null, other: null, fees: null };

  for (let page = 0; page < Math.min(2, pages.length); page += 1) {
    const lines = pages[page] ?? [];
    for (const line of lines) {
      const text = textOf(line);
      const last = cleanText(line.spans[line.spans.length - 1]?.text ?? "");
      const cents = AMOUNT_RE.test(last) ? amountToCents(last) : null;
      if (text.startsWith("Beginning balance on") && cents !== null) beginning = cents;
      if (text.startsWith("Ending balance on") && cents !== null) ending = cents;
      if (cents === null) continue;

      const section = sectionFromHeader(text);
      if (section !== null && section !== "withdrawals") sections[section] = cents;
    }
  }

  return { beginning, ending, sections };
}

/**
 * Bank of America 结单 PDF 适配器。
 *
 * Python 层只负责把文本按坐标还原成行，这里做业务状态机：
 * 1. 只在出现 `Date Description Amount` 表头的页面里认分区，避免把摘要页的
 *    「Deposits and other additions」当成交易表；
 * 2. 交易行 = 首列 MM/DD/YY + 右列金额；余额/汇总/法律/页脚因此天然被排除；
 * 3. 描述换行（单 span、x≈90.8、紧跟上一笔）拼回上一笔；
 * 4. 末页 Total 与首页汇总做两段对账，全部相等才 ok。
 */
export function parseBoaPdf(
  pages: readonly (readonly ExtractedLine[])[],
  context: ParseContext,
): ParsedBill {
  const totals = readStatementTotals(pages);
  const warnings: string[] = [];
  const reconciliationMessages: string[] = [];
  const rows: TransactionRow[] = [];
  const sectionSums: Record<Section, number> = { deposits: 0, atm: 0, other: 0, fees: 0 };
  const totalLines = new Map<Section, number>();
  let skippedRows = 0;
  let continuationCount = 0;
  let lastRow: TransactionRow | null = null;
  let lastSection: Section | null = null;

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex] ?? [];
    const transactional = page.some((line) => isColumnHeader(line));
    // 每页都重复分区标题；跨页续表也会再写一次，所以按页重置状态。
    let section: Section | null = null;

    for (let lineIndex = 0; lineIndex < page.length; lineIndex += 1) {
      const line = page[lineIndex];
      if (line === undefined) continue;
      const text = textOf(line);
      if (!text) continue;

      if (!transactional) continue;
      if (isColumnHeader(line)) continue;

      const totalSection = sectionFromTotal(text);
      if (totalSection !== null) {
        const cents = amountToCents(cleanText(line.spans[line.spans.length - 1]?.text ?? ""));
        if (cents !== null && !totalLines.has(totalSection)) {
          totalLines.set(totalSection, cents);
        }
        lastRow = null;
        continue;
      }

      const headerSection = sectionFromHeader(text);
      if (headerSection !== null) {
        section = headerSection === "withdrawals" ? null : headerSection;
        lastRow = null;
        continue;
      }

      // 页脚/免责声明/地址不是交易，也不该打断「上一笔」。
      if (/^(Page \d+ of \d+|continued on the next page)/.test(text)) continue;

      const dateSpan = line.spans.find((span) => isDateSpan(span));
      const amountSpan = [...line.spans]
        .reverse()
        .find((span) => span.x >= 500 && AMOUNT_RE.test(cleanText(span.text)));

      if (dateSpan !== undefined && amountSpan !== undefined) {
        const date = parseBoaDate(dateSpan.text);
        const amount = normalizeAmountText(cleanText(amountSpan.text).replace(/\$/g, ""), "USD");
        if (date === null || amount === null) {
          skippedRows += 1;
          continue;
        }
        const description = line.spans
          .filter((span) => span.x >= 80 && span.x < 500)
          .map((span) => cleanText(span.text))
          .filter((part) => part.length > 0)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();

        if (section === null) {
          warnings.push(`第 ${pageIndex + 1} 页有一笔交易无法判断所属分区，已按金额方向导入。`);
        } else {
          sectionSums[section] += amountToCents(amount) ?? 0;
        }

        const row: TransactionRow = {
          page: pageIndex + 1,
          line: lineIndex + 1,
          y: line.y,
          date,
          amount,
          description,
        };
        rows.push(row);
        lastRow = row;
        lastSection = section;
        continue;
      }

      // 描述换行：只有一个 span，落在描述列，且紧跟在上一笔交易之后。
      const single = line.spans.length === 1 ? line.spans[0] : undefined;
      if (
        single !== undefined &&
        single.x >= 80 &&
        single.x <= 120 &&
        lastRow !== null &&
        lastSection !== null &&
        lastRow.page === pageIndex + 1 &&
        Math.abs(lastRow.y - line.y) <= 25
      ) {
        lastRow.description = `${lastRow.description} ${cleanText(single.text)}`.trim();
        lastRow.y = line.y;
        continuationCount += 1;
      }
    }
  }

  if (rows.length === 0) {
    throw new BillParseError("no_rows", "BOA 结单里没有找到可识别的交易行。");
  }

  const candidates: BillImportCandidate[] = rows.map((row) => {
    const expense = row.amount.startsWith("-");
    // 候选的 amount 与其它平台一致：永远是无符号十进制，方向放 kind。
    // 前端 parseAmountInput 不接受负号，带负号会导致整行无法提交。
    const amount = expense ? row.amount.slice(1) : row.amount;
    const kind = expense ? "expense" : "income";
    const categoryId = suggestCategoryId(row.description, context.categories, kind);
    const rowWarnings = ["结单只提供过账日期，时间按当天 00:00 记录。"];
    const transactionDate = descriptionDate(row.description, row.date);
    if (transactionDate !== null) {
      rowWarnings.push(
        `描述里出现日期 ${transactionDate}（可能是消费日期），与过账日期 ${row.date} 不同；本行按过账日期入账，请核对。`,
      );
    }
    if (/refund|return/i.test(row.description)) {
      rowWarnings.push("描述里含 REFUND/RETURN，请核对这笔是否为退款。");
    }
    if (Number(row.amount) === 0) {
      rowWarnings.push("这笔金额为 0.00，请核对。");
    }

    return {
      id: randomUUID(),
      selected: true,
      amount,
      currency: "USD",
      kind,
      date: row.date,
      time: null,
      timezone: context.timezone,
      categoryId,
      paymentMethodId: null,
      note: "",
      tags: [],
      line: row.line,
      page: row.page,
      timePrecision: "day",
      merchant: truncateText(row.description, 200),
      sourceRef: syntheticSourceRef("boa:", context.fingerprint, row.page, row.line),
      sourceStatus: "",
      warnings: rowWarnings,
      duplicateIds: [],
      identityDuplicate: false,
    };
  });

  if (continuationCount > 0) {
    warnings.push(`有 ${continuationCount} 行描述换行，已拼接到上一笔交易。`);
  }
  if (skippedRows > 0) {
    warnings.push(`有 ${skippedRows} 行日期或金额无法识别，已跳过。`);
  }

  // ---- 对账：先比三段合计，再比「期初 + 存入 - 支取 = 期末」 ----
  const sectionLabels: Record<Section, string> = {
    deposits: "存入",
    atm: "ATM 与借记卡支出",
    other: "其他支出",
    fees: "服务费",
  };
  let sectionsOk = true;
  for (const section of ["deposits", "atm", "other", "fees"] as const) {
    const summary = totals.sections[section];
    const footer = totalLines.get(section) ?? null;
    if (summary !== null && footer !== null && summary !== footer) {
      sectionsOk = false;
      reconciliationMessages.push(
        `${sectionLabels[section]}在摘要页写 ${currency(summary)}、在明细末页写 ${currency(footer)}，两处合计不一致。`,
      );
    }
    const stated = summary ?? footer;
    const sum = sectionSums[section];
    if (stated === null) {
      // Service fees 分区在样本里是 0 行；没有合计行且没有明细时视为 0。
      if (sum !== 0) {
        sectionsOk = false;
        reconciliationMessages.push(
          `结单里没有${sectionLabels[section]}合计，但明细读到了 ${currency(sum)}，无法核对。`,
        );
      }
      continue;
    }
    if (stated !== sum) {
      sectionsOk = false;
      reconciliationMessages.push(
        `${sectionLabels[section]}明细合计 ${currency(sum)} 与结单 ${currency(stated)} 不一致，请核对。`,
      );
    }
  }
  if (sectionsOk) {
    reconciliationMessages.push(
      `明细合计与结单一致：存入 ${currency(sectionSums.deposits)}、ATM ${currency(sectionSums.atm)}、其他 ${currency(sectionSums.other)}、服务费 ${currency(sectionSums.fees)}。`,
    );
  }

  let balanceOk = false;
  if (totals.beginning === null || totals.ending === null) {
    reconciliationMessages.push("没有读到期初或期末余额，无法完成「期初 + 存入 - 支出 = 期末」核对。");
  } else {
    const expected =
      totals.beginning +
      sectionSums.deposits +
      sectionSums.atm +
      sectionSums.other +
      sectionSums.fees;
    balanceOk = expected === totals.ending;
    if (balanceOk) {
      reconciliationMessages.push(
        `期初 ${currency(totals.beginning)} + 存入 ${currency(sectionSums.deposits)} - ATM ${currency(Math.abs(sectionSums.atm))} - 其他 ${currency(Math.abs(sectionSums.other))} - 服务费 ${currency(Math.abs(sectionSums.fees))} = 期末 ${currency(totals.ending)}，核对一致。`,
      );
    } else {
      reconciliationMessages.push(
        `按明细计算期末应为 ${currency(expected)}，结单写的是 ${currency(totals.ending)}，不一致，请核对。`,
      );
    }
  }

  const totalsPresent = (["deposits", "atm", "other"] as const).every(
    (section) => (totals.sections[section] ?? totalLines.get(section) ?? null) !== null,
  );
  const ok = sectionsOk && balanceOk && totalsPresent;

  return {
    source: "boa",
    format: "pdf",
    candidates,
    warnings,
    reconciliation: { ok, messages: reconciliationMessages },
    totalRows: rows.length,
    skippedRows,
  };
}

export const BOA_AMOUNT_PATTERN = AMOUNT_RE;
