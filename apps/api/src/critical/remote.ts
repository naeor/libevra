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

export interface CriticalKeyRing {
  readonly activeKeyId: string;
  readonly activeKey: Buffer;
  /** Includes the active key and every previous key still needed to read historical objects. */
  readonly decryptionKeys: ReadonlyMap<string, Buffer>;
}

/**
 * Key material accepted by the event codec. Tests and old callers may keep passing a Buffer;
 * production should pass a ring so a key rotation can still decrypt older envelopes.
 */
export type CriticalKey = Buffer | CriticalKeyRing;

export function normalizeKeyRing(key: CriticalKey): CriticalKeyRing {
  if (Buffer.isBuffer(key)) {
    return { activeKeyId: "v1", activeKey: key, decryptionKeys: new Map([["v1", key]]) };
  }
  return key;
}

/**
 * Parse the active key plus previous keys:
 *   CRITICAL_EVENT_KEY=v2-key
 *   CRITICAL_EVENT_KEY_ID=v2
 *   CRITICAL_EVENT_PREVIOUS_KEYS=v1:<old-key>,v0:<older-key>
 *
 * Envelopes written before key IDs existed (`v:1`) have no keyId; decryption tries the active key
 * and every previous key so old COS objects remain readable after a rotation.
 */
export function parseKeyRing(
  activeValue: string,
  activeKeyIdValue?: string,
  previousValue?: string,
): CriticalKeyRing {
  const activeKeyId = activeKeyIdValue?.trim() || "v1";
  if (!/^[A-Za-z0-9._-]{1,32}$/.test(activeKeyId)) {
    throw new Error("critical_event_key_id_invalid");
  }
  const activeKey = parseKey(activeValue);
  const decryptionKeys = new Map<string, Buffer>([[activeKeyId, activeKey]]);
  if (previousValue !== undefined && previousValue.trim() !== "") {
    for (const item of previousValue.split(",")) {
      const separator = item.indexOf(":");
      if (separator <= 0) throw new Error("critical_event_previous_key_invalid");
      const id = item.slice(0, separator).trim();
      const value = item.slice(separator + 1).trim();
      if (!/^[A-Za-z0-9._-]{1,32}$/.test(id)) throw new Error("critical_event_previous_key_id_invalid");
      decryptionKeys.set(id, parseKey(value));
    }
  }
  return { activeKeyId, activeKey, decryptionKeys };
}

export function encryptJson(value: unknown, key: CriticalKey): Buffer {
  const ring = normalizeKeyRing(key);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ring.activeKey, iv);
  const plaintext = Buffer.from(canonicalJson(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.from(
    JSON.stringify({
      v: 2,
      keyId: ring.activeKeyId,
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      data: ciphertext.toString("base64"),
    }),
    "utf8",
  );
}

export function decryptJson(bytes: Buffer, key: CriticalKey): unknown {
  const ring = normalizeKeyRing(key);
  const envelope = JSON.parse(bytes.toString("utf8")) as {
    v?: number;
    keyId?: string;
    iv?: string;
    tag?: string;
    data?: string;
  };
  if ((envelope.v !== 1 && envelope.v !== 2) || !envelope.iv || !envelope.tag || !envelope.data) {
    throw new Error("critical_event_envelope_invalid");
  }
  const candidates: Buffer[] = [];
  if (envelope.v === 2) {
    if (envelope.keyId === undefined) throw new Error("critical_event_envelope_key_id_missing");
    const selected = ring.decryptionKeys.get(envelope.keyId);
    if (selected === undefined) throw new Error(`critical_event_key_unknown:${envelope.keyId}`);
    candidates.push(selected);
  } else {
    // Legacy envelope: no keyId. Try active then previous keys; GCM authentication makes a wrong
    // key fail cleanly instead of returning garbage.
    candidates.push(ring.activeKey, ...ring.decryptionKeys.values());
  }
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", candidate, Buffer.from(envelope.iv, "base64"));
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.data, "base64")),
        decipher.final(),
      ]);
      return JSON.parse(plaintext.toString("utf8")) as unknown;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error("critical_event_decryption_failed", { cause: lastError });
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
  key: CriticalKey,
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
  key: CriticalKey,
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
