import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, open, readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { canonicalJson, sha256Hex } from "./canonical.js";
import { hashCore } from "./store.js";
import type { CriticalEventCore } from "./types.js";

export interface RemotePutResult {
  readonly etag: string;
  /** True when this call created the object; false when an identical object already existed. */
  readonly created: boolean;
}

export interface RemoteHeadResult {
  readonly etag: string;
  readonly size: number | null;
  readonly metadata: Readonly<Record<string, string>>;
}

/** Minimal remote interface. It is deliberately append-only: there is no delete method. */
export interface CriticalRemote {
  readonly kind: string;
  putIfAbsent(key: string, bytes: Buffer, metadata?: Record<string, string>): Promise<RemotePutResult>;
  get(key: string): Promise<Buffer | null>;
  list(prefix: string): Promise<string[]>;
  /** HEAD-only recovery from a lost PUT acknowledgement; never returns the object body. */
  head?(key: string): Promise<RemoteHeadResult | null>;
}

export class RemoteObjectExistsError extends Error {
  constructor(readonly key: string) {
    super(`remote object already exists: ${key}`);
  }
}

/** Local stand-in for the encrypted COS prefix. Test/dev only; not an off-site guarantee. */
export class FileSystemCriticalRemote implements CriticalRemote {
  readonly kind = "filesystem";
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathFor(key: string): string {
    const path = resolve(join(this.root, key));
    const rel = relative(this.root, path);
    if (rel.startsWith("..") || rel.includes(`..${process.platform === "win32" ? "\\" : "/"}`)) {
      throw new Error("critical_event_remote_path_escape");
    }
    return path;
  }

  async putIfAbsent(key: string, bytes: Buffer): Promise<RemotePutResult> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    let handle;
    try {
      handle = await open(path, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new RemoteObjectExistsError(key);
      }
      throw error;
    }
    try {
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
    return { etag: sha256Hex(bytes), created: true };
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathFor(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const base = this.pathFor(prefix);
    const entries = await readdir(base, { recursive: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [] as string[];
      throw error;
    });
    const result: string[] = [];
    for (const entry of entries) {
      const key = join(prefix, entry).replaceAll("\\", "/");
      if ((await stat(join(this.root, key))).isFile()) result.push(key);
    }
    return result.sort();
  }
}

/** In-memory sink for integration tests. It still enforces append-only semantics. */
export class MemoryCriticalRemote implements CriticalRemote {
  readonly kind = "memory";
  private readonly objects = new Map<string, Buffer>();

  async putIfAbsent(key: string, bytes: Buffer): Promise<RemotePutResult> {
    if (this.objects.has(key)) throw new RemoteObjectExistsError(key);
    this.objects.set(key, Buffer.from(bytes));
    return { etag: sha256Hex(bytes), created: true };
  }

  async get(key: string): Promise<Buffer | null> {
    return this.objects.get(key) ?? null;
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
  }

  /** Test hook: corrupt/delete an object to exercise recovery isolation. */
  overwriteForTests(key: string, bytes: Buffer): void {
    this.objects.set(key, Buffer.from(bytes));
  }

  deleteForTests(key: string): void {
    this.objects.delete(key);
  }
}

export const REMOTE_PREFIX = "critical-events/v1";
export const EVENT_PREFIX = `${REMOTE_PREFIX}/events/`;
export const MANIFEST_PREFIX = `${REMOTE_PREFIX}/manifests/`;

export function eventObjectKey(seq: number, eventId: string): string {
  return `${EVENT_PREFIX}${String(seq).padStart(12, "0")}-${eventId}.json.enc`;
}

export function manifestObjectKey(seq: number, hash: string): string {
  return `${MANIFEST_PREFIX}${String(seq).padStart(12, "0")}-${hash}.json.enc`;
}

export function parseKey(data: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(data)) return Buffer.from(data, "hex");
  const decoded = Buffer.from(data, "base64");
  if (decoded.length !== 32) throw new Error("critical_event_key_must_be_32_bytes");
  return decoded;
}

export function encryptJson(value: unknown, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(canonicalJson(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.from(
    JSON.stringify({
      v: 1,
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      data: ciphertext.toString("base64"),
    }),
    "utf8",
  );
}

export function decryptJson(bytes: Buffer, key: Buffer): unknown {
  const envelope = JSON.parse(bytes.toString("utf8")) as {
    v?: number;
    iv?: string;
    tag?: string;
    data?: string;
  };
  if (envelope.v !== 1 || !envelope.iv || !envelope.tag || !envelope.data) {
    throw new Error("critical_event_envelope_invalid");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as unknown;
}

export interface RemoteManifest {
  readonly version: 1;
  readonly firstSeq: number;
  readonly lastSeq: number;
  readonly lastHash: string;
  readonly count: number;
  readonly generatedAt: string;
}

export async function writeManifest(
  remote: CriticalRemote,
  key: Buffer,
  events: readonly CriticalEventCore[],
): Promise<void> {
  if (events.length === 0) return;
  const last = events[events.length - 1]!;
  const manifest: RemoteManifest = {
    version: 1,
    firstSeq: Math.min(...events.map((event) => event.seq)),
    lastSeq: last.seq,
    lastHash: hashCore(last),
    count: events.length,
    generatedAt: new Date().toISOString(),
  };
  const keyName = manifestObjectKey(manifest.lastSeq, manifest.lastHash);
  try {
    await remote.putIfAbsent(keyName, encryptJson(manifest, key));
  } catch (error) {
    if (!(error instanceof RemoteObjectExistsError)) throw error;
  }
}

export interface RemoteVerification {
  readonly events: readonly {
    readonly key: string;
    readonly core: CriticalEventCore;
  }[];
  readonly manifests: readonly RemoteManifest[];
  readonly lastSeq: number;
  readonly lastHash: string | null;
}

/**
 * Verify every available object without touching the database. This is what the safe-restore
 * verifier uses; the raw backup path never calls it.
 */
export async function verifyRemoteLedger(
  remote: CriticalRemote,
  key: Buffer,
  options: { readonly allowPrunedBefore?: number } = {},
): Promise<RemoteVerification> {
  const keys = await remote.list(EVENT_PREFIX);
  if (keys.length === 0) throw new Error("critical_event_remote_empty");
  const events: { key: string; core: CriticalEventCore }[] = [];
  for (const objectKey of keys) {
    const bytes = await remote.get(objectKey);
    if (bytes === null) throw new Error(`critical_event_object_missing:${objectKey}`);
    const core = decryptJson(bytes, key) as CriticalEventCore;
    if (core.version !== 1 || !core.eventId || !Number.isInteger(core.seq)) {
      throw new Error(`critical_event_object_invalid:${objectKey}`);
    }
    events.push({ key: objectKey, core });
  }
  events.sort((left, right) => left.core.seq - right.core.seq);

  if (events[0]!.core.seq === 1 && events[0]!.core.prevHash !== null) {
    throw new Error("critical_event_genesis_prev_hash_invalid");
  }
  const allowedFirstSeq = options.allowPrunedBefore ?? 1;
  if (events[0]!.core.seq > allowedFirstSeq) {
    throw new Error(`critical_event_pruned_prefix:${events[0]!.core.seq}`);
  }
  for (let index = 1; index < events.length; index += 1) {
    const previous = events[index - 1]!;
    const current = events[index]!;
    if (current.core.seq !== previous.core.seq + 1) {
      throw new Error(`critical_event_sequence_gap:${previous.core.seq}->${current.core.seq}`);
    }
    if (current.core.prevHash !== hashCore(previous.core)) {
      throw new Error(`critical_event_hash_chain_broken:${current.core.seq}`);
    }
  }

  const manifestKeys = await remote.list(MANIFEST_PREFIX);
  const manifests: RemoteManifest[] = [];
  for (const objectKey of manifestKeys) {
    const bytes = await remote.get(objectKey);
    if (bytes === null) continue;
    manifests.push(decryptJson(bytes, key) as RemoteManifest);
  }
  manifests.sort((left, right) => left.lastSeq - right.lastSeq);
  if (manifests.length === 0) {
    throw new Error("critical_event_manifest_missing");
  }
  const latest = manifests.at(-1);
  if (latest !== undefined) {
    if (latest.lastSeq > events.at(-1)!.core.seq) {
      throw new Error("critical_event_manifest_head_missing");
    }
    const matched = events.find((event) => event.core.seq === latest.lastSeq);
    if (matched === undefined || hashCore(matched.core) !== latest.lastHash) {
      throw new Error("critical_event_manifest_head_mismatch");
    }
  }
  return {
    events,
    manifests,
    lastSeq: events.at(-1)!.core.seq,
    lastHash: hashCore(events.at(-1)!.core),
  };
}

/** SHA-256 of the plaintext core, used by callers that want an object-level digest. */
export function coreDigest(core: CriticalEventCore): string {
  return createHash("sha256").update(canonicalJson(core)).digest("hex");
}
