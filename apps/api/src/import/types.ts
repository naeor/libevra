import type { BillImportCandidate } from "@libellum/shared";

/**
 * 解析器与路由共用的类型。
 *
 * 这里刻意不依赖 Prisma 类型：适配器只负责「把文件内容变成候选」，
 * 数据库查询、判重、写入都留给 service 层，方便用合成夹具单测。
 */
export type BillSource = "libevra" | "wechat" | "alipay" | "boa";
export type BillFormat = "csv" | "xlsx" | "pdf";

export interface ExtractedSpan {
  readonly x: number;
  readonly text: string;
}

export interface ExtractedLine {
  readonly y: number;
  readonly spans: readonly ExtractedSpan[];
}

export interface ExtractedRow {
  readonly line: number;
  readonly cells: readonly string[];
}

export interface ExtractedSheet {
  readonly name: string;
  readonly rows: readonly ExtractedRow[];
}

/**
 * Python 解析器的统一输出。
 *
 * 同时保留 sheets 与 pages，是为了让 TS 侧的「按内容识别」不需要知道文件扩展名：
 * 谁有数据就用谁，缺失的字段由 extractor 统一补成空数组。
 */
export interface ExtractedDocument {
  readonly format: BillFormat;
  readonly sheets: readonly ExtractedSheet[];
  readonly pages: readonly (readonly ExtractedLine[])[];
}

export interface CategoryOption {
  readonly id: string;
  readonly name: string;
  readonly kind: "expense" | "income";
  readonly isArchived: boolean;
}

export interface PaymentMethodOption {
  readonly id: string;
  readonly name: string;
  readonly isArchived: boolean;
}

export interface ParseContext {
  /** 文件指纹，只用于生成稳定 synthetic 来源单号，不写日志。 */
  readonly fingerprint: string;
  /** 前端传来的 IANA 时区；用于把本地时间换算成带偏移的 ISO 时间。 */
  readonly timezone: string;
  readonly categories: readonly CategoryOption[];
  readonly paymentMethods: readonly PaymentMethodOption[];
}

export interface ParsedBill {
  readonly source: BillSource;
  readonly format: BillFormat;
  readonly candidates: BillImportCandidate[];
  readonly warnings: string[];
  readonly reconciliation: { ok: boolean | null; messages: string[] };
  /** 文件里读到的数据行数（含被规则排除的行），用于「读到 N 笔」。 */
  readonly totalRows: number;
  /** 读到了但认不出日期/金额、无法成为候选的行数。 */
  readonly skippedRows: number;
}

/**
 * 解析错误：只允许携带白名单 code（由路由翻译成中文消息），
 * 绝不把第三方异常/文件内容带出去。
 */
export class BillParseError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BillParseError";
    this.code = code;
  }
}
