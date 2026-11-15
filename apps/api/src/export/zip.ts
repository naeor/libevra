import { deflateRawSync } from "node:zlib";

import { buildZip as buildZipCore, crc32, type ZipEntry } from "@libellum/shared";

/**
 * ZIP 写入器的实现已移到 `@libellum/shared`（1.19.94：游客在浏览器里导出同一个 XLSX，不能有第二份）。
 * 这里只负责服务器端的一件事：注入 Node 的 `deflateRawSync`（level 9），并返回 `Buffer`。
 */
export { crc32 };
export type { ZipEntry };

export function buildZip(entries: readonly ZipEntry[]): Buffer {
  return Buffer.from(buildZipCore(entries, (raw) => deflateRawSync(Buffer.from(raw), { level: 9 })));
}
