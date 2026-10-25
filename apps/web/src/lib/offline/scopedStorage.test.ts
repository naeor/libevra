import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * ⚠️ **Why this test exists.**
 *
 * 2026-10 的账本串账故障（1.16.09 热修复）根因之一是：缓存层之外还有模块直接以**全局字面量键**
 * 读写本机存储，绕过了 `scope.ts` 的「账号 + 账本」命名空间。修好一次不等于永远不复发——只要
 * 将来再写一行 `readValue("query-cache")`，同样的隔离漏洞就会回来。
 *
 * 这里用静态扫描守住这条边界：`lib/offline` 下除 `storage.ts`（底层实现）与 `scope.ts`（命名空间
 * 本身）之外，任何模块都不得把字符串字面量直接传给存储原语；必须经 `scopedKey(...)`。
 */
const STORAGE_PRIMITIVE = /\b(?:readValue|writeValue|removeValue|readSnapshot)\s*\(\s*["'`]/;
const ALLOWED_FILES = new Set(["storage.ts", "scope.ts"]);

describe("离线存储的账本命名空间守卫", () => {
  it("离线模块不直接以字面量键访问存储（必须经 scopedKey）", () => {
    const offenders: string[] = [];
    const names = readdirSync(new URL(".", import.meta.url)).filter(
      name => name.endsWith(".ts") && !name.endsWith(".test.ts") && !ALLOWED_FILES.has(name),
    );
    for (const name of names) {
      const source = readFileSync(new URL(name, import.meta.url), "utf8");
      source.split("\n").forEach((line, index) => {
        if (STORAGE_PRIMITIVE.test(line)) offenders.push(`${name}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
