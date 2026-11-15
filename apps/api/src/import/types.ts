/**
 * 解析器与路由共用的类型——1.19.96 起实现在 `packages/shared/src/billParsers/types.ts`（服务器与游客本机导入
 * 共用一份）。这里只转出，保持服务器内既有的导入路径（`routes/billImport.ts` 的 `instanceof BillParseError`
 * 与 shared 是同一个类）。
 */
export {
  BillParseError,
  type BillFormat,
  type BillSource,
  type CategoryOption,
  type ExtractedDocument,
  type ExtractedLine,
  type ExtractedRow,
  type ExtractedSheet,
  type ExtractedSpan,
  type ParseContext,
  type ParsedBill,
  type PaymentMethodOption,
} from "@libellum/shared/billParsers";
