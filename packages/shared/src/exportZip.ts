/**
 * 一个最小而正确的 ZIP 写入器——够写一个 XLSX，不多不少。
 *
 * 1.19.94 从 `apps/api/src/export/zip.ts` 移到这里：游客模式没有服务器，要在浏览器里生成同样的 XLSX，
 * 而“同一件事的第二份实现迟早会不一致”，所以只有这一份。唯一依赖运行环境的是**压缩**，
 * 由调用方注入：服务器传 `deflateRawSync`，浏览器传 `CompressionStream("deflate-raw")`；
 * 不传（或返回 `null`）就“只存储不压缩”——文件更大，但任何读取器都能打开。
 *
 * 实现了：存储与 deflate 条目、CRC-32、本地文件头、中央目录、目录结束记录。
 * 没有实现：ZIP64、加密、数据描述符、多盘——这么小的文件不会遇到。
 *
 * ZIP 把“本地头”的偏移与大小存在两个地方，读取器信中央目录；两处不一致时文件在一个程序里能开、
 * 另一个里打不开，极难排查。所以两处都由同一趟遍历、同一份数据写出。
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const encoder = new TextEncoder();

function u16(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

export interface ZipEntry {
  readonly name: string;
  readonly data: string | Uint8Array;
}

/** 同步压缩：返回 raw deflate 字节；返回 `null` 表示不压缩（只存储）。 */
export type DeflateRaw = (raw: Uint8Array) => Uint8Array | null;
/** 异步压缩，给浏览器的 `CompressionStream` 用。 */
export type DeflateRawAsync = (raw: Uint8Array) => Uint8Array | null | Promise<Uint8Array | null>;

interface PreparedEntry {
  readonly nameBytes: Uint8Array;
  readonly raw: Uint8Array;
  readonly body: Uint8Array;
  readonly method: 0 | 8;
}

function rawBytes(entry: ZipEntry): Uint8Array {
  return typeof entry.data === "string" ? encoder.encode(entry.data) : entry.data;
}

/** 只有压缩后确实更小才用压缩结果，否则存储。 */
function prepare(entry: ZipEntry, raw: Uint8Array, deflated: Uint8Array | null): PreparedEntry {
  const stored = deflated === null || deflated.length >= raw.length;
  return {
    nameBytes: encoder.encode(entry.name),
    raw,
    body: stored ? raw : deflated,
    method: stored ? 0 : 8,
  };
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * 时间戳固定而不取时钟：同样的输入必须得到同样的字节，否则每次导出都像一个新文件，
 * 测试也没法比较两个压缩包。
 */
function assemble(entries: readonly PreparedEntry[]): Uint8Array {
  const DOS_TIME = 0; // 00:00:00
  const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01

  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const { nameBytes, raw, body, method } = entry;
    const crc = crc32(raw);

    const localHeader = Uint8Array.from([
      ...u32(0x04034b50), // local file header signature
      ...u16(20), // version needed to extract (2.0)
      ...u16(0), // flags
      ...u16(method), // compression method
      ...u16(DOS_TIME),
      ...u16(DOS_DATE),
      ...u32(crc),
      ...u32(body.length), // compressed size
      ...u32(raw.length), // uncompressed size
      ...u16(nameBytes.length),
      ...u16(0), // extra field length
      ...nameBytes,
    ]);

    localParts.push(localHeader, body);

    centralParts.push(
      Uint8Array.from([
        ...u32(0x02014b50), // central directory header signature
        ...u16(20), // version made by
        ...u16(20), // version needed
        ...u16(0), // flags
        ...u16(method),
        ...u16(DOS_TIME),
        ...u16(DOS_DATE),
        ...u32(crc),
        ...u32(body.length),
        ...u32(raw.length),
        ...u16(nameBytes.length),
        ...u16(0), // extra field length
        ...u16(0), // comment length
        ...u16(0), // disk number
        ...u16(0), // internal attributes
        ...u32(0), // external attributes
        ...u32(offset), // offset of the local header
        ...nameBytes,
      ]),
    );

    offset += localHeader.length + body.length;
  }

  const centralDirectory = concat(centralParts);

  const end = Uint8Array.from([
    ...u32(0x06054b50), // end of central directory signature
    ...u16(0), // disk number
    ...u16(0), // disk with central directory
    ...u16(entries.length), // entries on this disk
    ...u16(entries.length), // entries in total
    ...u32(centralDirectory.length),
    ...u32(offset),
    ...u16(0), // comment length
  ]);

  return concat([...localParts, centralDirectory, end]);
}

/** 同步版（服务器）。不传 `deflate` 就全部只存储。 */
export function buildZip(entries: readonly ZipEntry[], deflate?: DeflateRaw): Uint8Array {
  return assemble(
    entries.map((entry) => {
      const raw = rawBytes(entry);
      return prepare(entry, raw, deflate === undefined ? null : deflate(raw));
    }),
  );
}

/** 异步版（浏览器）。压缩失败或不支持时该条目只存储，不让导出整体失败。 */
export async function buildZipAsync(
  entries: readonly ZipEntry[],
  deflate?: DeflateRawAsync,
): Promise<Uint8Array> {
  const prepared: PreparedEntry[] = [];
  for (const entry of entries) {
    const raw = rawBytes(entry);
    let deflated: Uint8Array | null = null;
    if (deflate !== undefined) {
      try {
        deflated = await deflate(raw);
      } catch {
        deflated = null;
      }
    }
    prepared.push(prepare(entry, raw, deflated));
  }
  return assemble(prepared);
}
