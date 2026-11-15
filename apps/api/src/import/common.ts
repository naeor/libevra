/**
 * 账单解析的公共工具——1.19.96 起实现在 `packages/shared/src/billParsers/common.ts`（服务器与游客本机导入
 * 共用一份）。这里只转出，保持既有导入路径（`routes/transactions.ts` 的 `dateTimeToInstant` 等）。
 */
export {
  MAX_SOURCE_REF_LENGTH,
  cleanText,
  compactText,
  dateTimeToInstant,
  formatAmountText,
  isPlaceholder,
  makeSourceRef,
  normalizeAmountText,
  parseClockTime,
  parseLocalDate,
  splitDateTime,
  suggestCategoryId,
  suggestPaymentMethodId,
  syntheticSourceRef,
  truncateText,
  type ClockParts,
  type DateTimeParts,
  type LocalDateParts,
} from "@libellum/shared/billParsers";
