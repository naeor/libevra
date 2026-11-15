/**
 * 读 XLSX 外层的 ZIP（只读、只在内存里）：中央目录 → 本地文件头 → `DecompressionStream("deflate-raw")` 解压。
 *
 * 对应服务器 `apps/api/src/import/extract_document.py` 里 Python `zipfile` 的那一部分。安全限制逐条照搬
 * （条目数、展开总量、单个条目大小、压缩比、加密、重名），错误码也相同（`document_limit` / `unsafe_zip`），
 * 结构损坏一律 `document_invalid`（Python 的 `BadZipFile` 不在白名单里，也是这个码）。
 *
 * 不支持 ZIP64 与 deflate 以外的压缩方式（bzip2 / lzma）：微信导出的 XLSX 都不是；遇到就报
 * `document_invalid`，不去猜。
 */
import { BillParseError } from "@libellum/shared/billParsers";

export const MAX_ZIP_ENTRIES = 256;
export const MAX_EXPANDED_BYTES = 40 * 1024 * 1024;
export const MAX_ENTRY_BYTES = 20 * 1024 * 1024;
export const MAX_COMPRESSION_RATIO = 200;

export interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly flags: number;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly localHeaderOffset: number;
}

/** 抽取失败：只带白名单错误码，消息与服务器（`extractor.ts`）一致。 */
export function extractError(code: string): BillParseError {
  return new BillParseError(code, "解析失败。"); // i18n-ignore：与服务器同一原文，显示前由 translateSharedMessage / 错误码译文翻译
}

let crcTable: Uint32Array | null = null;

/** 标准 CRC-32（与 Python `zlib.crc32` / ZIP 规范相同）。 */
export function crc32(data: Uint8Array): number {
  if (crcTable === null) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    crc = crcTable[(crc ^ data[index]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(bytes: Uint8Array, offset: number): number {
  if (offset + 2 > bytes.length) throw extractError("document_invalid");
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function u32(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) throw extractError("document_invalid");
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}

const utf8 = new TextDecoder("utf-8");

/** 文件名：通用位 11 置位时是 UTF-8，否则按字节原样（XLSX 的部件名都是 ASCII）。 */
function entryName(bytes: Uint8Array, flags: number): string {
  if (flags & 0x800) return utf8.decode(bytes);
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

/** 读中央目录；不是 ZIP、目录损坏都是 `document_invalid`。 */
export function readZipDirectory(bytes: Uint8Array): ZipEntry[] {
  // End of central directory：在最后 64KB + 22 字节里从后往前找签名（与 zipfile 相同的范围）。
  const minimum = Math.max(0, bytes.length - (0xffff + 22));
  let end = -1;
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (bytes[offset] === 0x50 && bytes[offset + 1] === 0x4b && bytes[offset + 2] === 0x05 && bytes[offset + 3] === 0x06) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw extractError("document_invalid");

  const count = u16(bytes, end + 10);
  const directorySize = u32(bytes, end + 12);
  const directoryOffset = u32(bytes, end + 16);
  if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) throw extractError("document_invalid");
  if (directoryOffset + directorySize > end) throw extractError("document_invalid");

  const entries: ZipEntry[] = [];
  let offset = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (u32(bytes, offset) !== 0x02014b50) throw extractError("document_invalid");
    const flags = u16(bytes, offset + 8);
    const method = u16(bytes, offset + 10);
    const crc = u32(bytes, offset + 16);
    const compressedSize = u32(bytes, offset + 20);
    const size = u32(bytes, offset + 24);
    const nameLength = u16(bytes, offset + 28);
    const extraLength = u16(bytes, offset + 30);
    const commentLength = u16(bytes, offset + 32);
    const localHeaderOffset = u32(bytes, offset + 42);
    if (offset + 46 + nameLength > bytes.length) throw extractError("document_invalid");
    const name = entryName(bytes.subarray(offset + 46, offset + 46 + nameLength), flags);
    entries.push({ name, method, flags, crc32: crc, compressedSize, size, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** 与 Python 版 `xlsx()` 开头的检查相同的顺序与错误码。 */
export function assertZipLimits(entries: readonly ZipEntry[]): void {
  if (entries.length > MAX_ZIP_ENTRIES || entries.reduce((sum, entry) => sum + entry.size, 0) > MAX_EXPANDED_BYTES) {
    throw extractError("document_limit");
  }
  if (new Set(entries.map((entry) => entry.name)).size !== entries.length) throw extractError("unsafe_zip");
  for (const entry of entries) {
    if (entry.flags & 1 || entry.size > MAX_ENTRY_BYTES) throw extractError("document_limit");
    if (entry.size > Math.max(1, entry.compressedSize) * MAX_COMPRESSION_RATIO) throw extractError("document_limit");
  }
}

async function inflateRaw(data: Uint8Array, limit: number): Promise<Uint8Array> {
  const source = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = source.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      // 声明的大小已经过了上限检查；实际解出来比声明的多就是伪造的目录，立即停止，不把炸弹解完。
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw extractError("document_invalid");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof BillParseError) throw error;
    throw extractError("document_invalid");
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** 读出一个条目的原始字节（校验本地文件头、文件名与 CRC，与 `ZipFile.read` 相同）。 */
export async function readZipEntry(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const offset = entry.localHeaderOffset;
  if (u32(bytes, offset) !== 0x04034b50) throw extractError("document_invalid");
  const nameLength = u16(bytes, offset + 26);
  const extraLength = u16(bytes, offset + 28);
  const localName = entryName(bytes.subarray(offset + 30, offset + 30 + nameLength), entry.flags);
  if (localName !== entry.name) throw extractError("document_invalid");
  const start = offset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > bytes.length) throw extractError("document_invalid");
  const raw = bytes.subarray(start, end);

  let data: Uint8Array;
  if (entry.method === 0) data = raw;
  else if (entry.method === 8) data = await inflateRaw(raw, entry.size);
  else throw extractError("document_invalid");

  if (data.length !== entry.size || crc32(data) !== entry.crc32) throw extractError("document_invalid");
  return data;
}
