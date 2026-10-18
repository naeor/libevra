import { createHash } from "node:crypto";

/**
 * Stable JSON: object keys sorted recursively. The event hash must not depend on JavaScript's
 * insertion order, or the same event would verify differently in a restore tool written later.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source)
        .sort()
        .filter((key) => source[key] !== undefined)
        .map((key) => [key, sortValue(source[key])]),
    );
  }
  return value;
}

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
