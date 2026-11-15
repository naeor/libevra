import { buildXlsxEntries, type XlsxOptions } from "@libellum/shared";

import { buildZip } from "./zip.js";

/**
 * XLSX 的 XML 生成已移到 `@libellum/shared`（`exportXlsx.ts`）；这里保留服务器的同步入口，
 * 压缩与打包走本目录的 `zip.ts`（Node `deflateRawSync`）。
 */
export type { XlsxOptions };

export function buildXlsx(
  rows: readonly (readonly (string | number | null)[])[],
  options: XlsxOptions,
): Buffer {
  return buildZip(buildXlsxEntries(rows, options));
}
