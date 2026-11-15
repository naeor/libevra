/**
 * 按内容识别账单文件——1.19.96 起实现在 `packages/shared/src/billParsers/sniff.ts`（收 `Uint8Array`，
 * 服务器照旧传 `Buffer`）。这里只转出，保持既有导入路径。
 */
export {
  decodeTextFile,
  detectTextHeader,
  detectWechatHeader,
  kindLabel,
  sniffKind,
  type DecodedText,
  type SniffedKind,
} from "@libellum/shared/billParsers";
