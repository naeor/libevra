import { createHmac, createHash } from "node:crypto";

import { RemoteObjectExistsError, type CriticalRemote, type RemotePutResult, type RemoteHeadResult } from "./remote.js";

export interface CosConfig {
  readonly bucket: string;
  readonly region: string;
  readonly secretId: string;
  readonly secretKey: string;
  readonly endpoint?: string;
}

/**
 * Minimal Tencent COS XML-API client for the **relay sidecar only**.
 *
 * The API process never receives these credentials. The relay identity is expected to have
 * PutObject/HeadObject only on the dedicated prefix — no GetObject, no ListBucket, no Delete.
 * A separate restore identity (kept off the server) has GetObject/ListBucket and no write access.
 */
export class CosCriticalRemote implements CriticalRemote {
  readonly kind = "cos";
  private readonly host: string;

  constructor(
    private readonly config: CosConfig,
  ) {
    const host = config.endpoint ?? `${config.bucket}.cos.${config.region}.myqcloud.com`;
    this.host = host.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }

  private objectPath(key: string): string {
    return `/${key.replace(/^\/+/, "")}`;
  }

  private sign(
    method: "GET" | "PUT" | "HEAD",
    pathname: string,
    query: Record<string, string>,
    now = Math.floor(Date.now() / 1000),
  ): string {
    const keyTime = `${now};${now + 600}`;
    const signKey = hmacSha1(this.config.secretKey, keyTime);
    const queryString = Object.keys(query)
      .sort()
      .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(query[key]!)}`)
      .join("&");
    const canonicalRequest = [
      method.toLowerCase(),
      pathname,
      queryString,
      `host=${this.host}`,
      "",
    ].join("\n");
    const stringToSign = `sha1\n${keyTime}\n${sha1Hex(canonicalRequest)}\n`;
    const signature = hmacSha1(signKey, stringToSign);
    return [
      "q-sign-algorithm=sha1",
      `q-ak=${this.config.secretId}`,
      `q-sign-time=${keyTime}`,
      `q-key-time=${keyTime}`,
      "q-header-list=host",
      `q-url-param-list=${Object.keys(query).sort().join(";")}`,
      `q-signature=${signature}`,
    ].join("&");
  }

  private url(pathname: string, query: Record<string, string> = {}): string {
    const params = new URLSearchParams(query).toString();
    return `https://${this.host}${pathname}${params.length === 0 ? "" : `?${params}`}`;
  }

  async putIfAbsent(
    key: string,
    bytes: Buffer,
    metadata: Record<string, string> = {},
  ): Promise<RemotePutResult> {
    /**
     * Real COS behavior (verified 2026-10-18 against the production bucket): a same-key PUT is
     * accepted and overwrites the current object; `x-cos-forbid-overwrite` alone is not a
     * substitute for versioning/object lock. At minimum, never blindly overwrite a key that already
     * exists: HEAD first and let the caller's hash-checking recovery path decide. A race between
     * HEAD and PUT still exists; production immutability must be proven separately with versioning /
     * object lock, not assumed from the header.
     */
    const existing = await this.head(key);
    if (existing !== null) throw new RemoteObjectExistsError(key);
    const path = this.objectPath(key);
    const cosMeta = Object.fromEntries(
      Object.entries(metadata).map(([name, value]) => [`x-cos-meta-${name}`, value]),
    );
    const response = await fetch(this.url(path), {
      method: "PUT",
      headers: {
        Authorization: this.sign("PUT", path, {}),
        "Content-Type": "application/octet-stream",
        "x-cos-forbid-overwrite": "true",
        ...cosMeta,
      },
      body: new Uint8Array(bytes),
    });
    if (response.status === 409 || response.status === 412) {
      throw new RemoteObjectExistsError(key);
    }
    if (!response.ok) {
      throw new Error(`critical_event_cos_put_failed:${String(response.status)}`);
    }
    return {
      etag: response.headers.get("etag")?.replaceAll('"', "") ?? sha256Hex(bytes),
      created: true,
    };
  }

  async head(key: string): Promise<RemoteHeadResult | null> {
    const path = this.objectPath(key);
    const response = await fetch(this.url(path), {
      method: "HEAD",
      headers: { Authorization: this.sign("HEAD", path, {}) },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`critical_event_cos_head_failed:${String(response.status)}`);
    const metadata: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      if (name.startsWith("x-cos-meta-")) metadata[name.slice("x-cos-meta-".length)] = value;
    });
    return {
      etag: response.headers.get("etag")?.replaceAll('"', "") ?? "",
      size: numberOrNull(response.headers.get("content-length")),
      metadata,
    };
  }

  async get(key: string): Promise<Buffer | null> {
    const path = this.objectPath(key);
    const response = await fetch(this.url(path), {
      headers: { Authorization: this.sign("GET", path, {}) },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`critical_event_cos_get_failed:${String(response.status)}`);
    return Buffer.from(await response.arrayBuffer());
  }

  async list(prefix: string): Promise<string[]> {
    const query: Record<string, string> = {
      prefix: this.objectPath(prefix).replace(/^\//, ""),
      "max-keys": "1000",
    };
    const path = "/";
    const response = await fetch(this.url(path, query), {
      headers: { Authorization: this.sign("GET", path, query) },
    });
    if (!response.ok) throw new Error(`critical_event_cos_list_failed:${String(response.status)}`);
    const xml = await response.text();
    const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((match) =>
      decodeXml(match[1]!),
    );
    return keys.sort();
  }
}

function hmacSha1(key: string | Buffer, value: string): string {
  return createHmac("sha1", key).update(value, "utf8").digest("hex");
}

function sha1Hex(value: string): string {
  return createHash("sha1").update(value, "utf8").digest("hex");
}

function sha256Hex(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function numberOrNull(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
