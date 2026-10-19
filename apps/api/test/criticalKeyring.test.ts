import { createCipheriv, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { canonicalJson } from "../src/critical/canonical.js";
import {
  decryptJson,
  encryptJson,
  parseKeyRing,
  type CriticalKeyRing,
} from "../src/critical/remote.js";

const OLD = Buffer.alloc(32, 7);
const NEW = Buffer.alloc(32, 8);

function ring(activeId: string, active: Buffer, previous: Record<string, Buffer> = {}): CriticalKeyRing {
  return {
    activeKeyId: activeId,
    activeKey: active,
    decryptionKeys: new Map([[activeId, active], ...Object.entries(previous)]),
  };
}

describe("S13-I critical event key rotation compatibility", () => {
  it("decrypts old envelopes with a previous key after rotation", () => {
    const before = ring("v1", OLD);
    const oldEnvelope = encryptJson({ event: "old", n: 1 }, before);
    expect((JSON.parse(oldEnvelope.toString("utf8")) as { keyId: string }).keyId).toBe("v1");

    const after = ring("v2", NEW, { v1: OLD });
    expect(decryptJson(oldEnvelope, after)).toEqual({ event: "old", n: 1 });

    const newEnvelope = encryptJson({ event: "new", n: 2 }, after);
    expect((JSON.parse(newEnvelope.toString("utf8")) as { keyId: string }).keyId).toBe("v2");
    expect(decryptJson(newEnvelope, after)).toEqual({ event: "new", n: 2 });
  });

  it("decrypts legacy v1 envelopes that have no key id by trying all keys", () => {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", OLD, iv);
    const plaintext = Buffer.from(canonicalJson({ legacy: true }), "utf8");
    const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const legacy = Buffer.from(
      JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") }),
    );
    expect(decryptJson(legacy, ring("v2", NEW, { v1: OLD }))).toEqual({ legacy: true });
    expect(() => decryptJson(legacy, ring("v2", NEW))).toThrow();
  });

  it("parses active + previous keys from env-style values without exposing them in ids", () => {
    const parsed = parseKeyRing(
      NEW.toString("base64"),
      "v2",
      `v1:${OLD.toString("base64")}`,
    );
    expect(parsed.activeKeyId).toBe("v2");
    expect(parsed.decryptionKeys.get("v1")?.equals(OLD)).toBe(true);
    expect(parsed.decryptionKeys.get("v2")?.equals(NEW)).toBe(true);
  });
});
