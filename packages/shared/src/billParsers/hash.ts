/**
 * 账单导入用的两个“与平台无关”的小工具：同步 SHA-256 与随机 UUID。
 *
 * ⚠️ **为什么自己写 SHA-256，而不用 `crypto.subtle.digest`**：来源单号（`makeSourceRef` /
 * `syntheticSourceRef`）在解析每一行时同步生成，原来用 Node 的 `createHash`（同步）。浏览器只有异步的
 * `crypto.subtle`，而且它只在安全上下文（https / localhost）里存在——局域网 http 调试时根本没有。
 * 解析器保持同步、两端算出**逐字节相同**的十六进制摘要，最直接的办法就是一份纯 TS 实现
 * （FIPS 180-4，测试里与 Node `createHash("sha256")` 逐字比对）。
 *
 * 性能：10 MB 文件在 V8 上约几十毫秒；解析器只对很短的键用它，整份文件的指纹浏览器优先用 `crypto.subtle`。
 */

const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** 原始 32 字节摘要。 */
export function sha256Bytes(data: Uint8Array): Uint8Array {
  const h = new Int32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Int32Array(64);

  const block = (bytes: Uint8Array, offset: number): void => {
    for (let i = 0; i < 16; i += 1) {
      const j = offset + i * 4;
      w[i] = (bytes[j]! << 24) | (bytes[j + 1]! << 16) | (bytes[j + 2]! << 8) | bytes[j + 3]!;
    }
    for (let i = 16; i < 64; i += 1) {
      const x = w[i - 15]!;
      const y = w[i - 2]!;
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
    }
    let a = h[0]!;
    let b = h[1]!;
    let c = h[2]!;
    let d = h[3]!;
    let e = h[4]!;
    let f = h[5]!;
    let g = h[6]!;
    let k = h[7]!;
    for (let i = 0; i < 64; i += 1) {
      const sum1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const choose = (e & f) ^ (~e & g);
      const t1 = (k + sum1 + choose + K[i]! + w[i]!) | 0;
      const sum0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (sum0 + majority) | 0;
      k = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] = (h[0]! + a) | 0;
    h[1] = (h[1]! + b) | 0;
    h[2] = (h[2]! + c) | 0;
    h[3] = (h[3]! + d) | 0;
    h[4] = (h[4]! + e) | 0;
    h[5] = (h[5]! + f) | 0;
    h[6] = (h[6]! + g) | 0;
    h[7] = (h[7]! + k) | 0;
  };

  const full = data.length - (data.length % 64);
  for (let offset = 0; offset < full; offset += 64) block(data, offset);

  // 末尾补位：0x80 + 若干 0 + 64 位大端长度（单位：比特）。
  const rest = data.length - full;
  const tail = new Uint8Array(rest < 56 ? 64 : 128);
  tail.set(data.subarray(full));
  tail[rest] = 0x80;
  const bits = data.length * 8;
  const high = Math.floor(bits / 0x100000000);
  const low = bits >>> 0;
  const end = tail.length;
  tail[end - 8] = (high >>> 24) & 0xff;
  tail[end - 7] = (high >>> 16) & 0xff;
  tail[end - 6] = (high >>> 8) & 0xff;
  tail[end - 5] = high & 0xff;
  tail[end - 4] = (low >>> 24) & 0xff;
  tail[end - 3] = (low >>> 16) & 0xff;
  tail[end - 2] = (low >>> 8) & 0xff;
  tail[end - 1] = low & 0xff;
  for (let offset = 0; offset < tail.length; offset += 64) block(tail, offset);

  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i += 1) {
    const value = h[i]!;
    out[i * 4] = (value >>> 24) & 0xff;
    out[i * 4 + 1] = (value >>> 16) & 0xff;
    out[i * 4 + 2] = (value >>> 8) & 0xff;
    out[i * 4 + 3] = value & 0xff;
  }
  return out;
}

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/** 字节的小写十六进制 SHA-256（与 Node `createHash("sha256").update(buffer).digest("hex")` 相同）。 */
export function sha256HexOfBytes(data: Uint8Array): string {
  return hex(sha256Bytes(data));
}

/** 文本按 UTF-8 编码后的 SHA-256（与 `createHash("sha256").update(text, "utf8")` 相同）。 */
export function sha256HexOfText(text: string): string {
  return sha256HexOfBytes(new TextEncoder().encode(text));
}

/**
 * 随机 v4 UUID。
 *
 * 优先用 `crypto.randomUUID`（Node 22+ 与浏览器安全上下文都有）；浏览器在 http 局域网调试时没有它，
 * 退回 `getRandomValues`（任何上下文都有）自己拼一个 v4——候选 id 必须是 UUID（提交行 schema 要求
 * `z.string().uuid()`，游客账本转正式账号时也要求账目 id 是 UUID），不能退化成别的格式。
 */
export function randomUuid(): string {
  const api = globalThis.crypto;
  if (typeof api.randomUUID === "function") return api.randomUUID();
  const bytes = new Uint8Array(16);
  api.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const text = hex(bytes);
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
}
