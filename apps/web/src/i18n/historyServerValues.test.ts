import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import zhLedger from "./resources/zh-CN/ledger.js";

/**
 * S16：成员加入 / 重新加入事件里服务器写死的中文值（`collab/share.ts`、`collab/respond.ts`）
 * 在英文界面要能翻译。服务器新增一个说法却没写译文时，这里失败，而不是在英文界面悄悄露出中文。
 */
const FILES = ["../../../api/src/collab/share.ts", "../../../api/src/collab/respond.ts"];

describe("编辑历史：服务器写入的加入事件值都有译文", () => {
  it("joined 事件的 from / to 值", () => {
    const values = new Set<string>();
    for (const file of FILES) {
      const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
      for (const match of source.matchAll(/joined:\s*\{\s*from:\s*("([^"]*)"|null),\s*to:\s*"([^"]*)"/g)) {
        if (match[2] !== undefined) values.add(match[2]);
        if (match[3] !== undefined) values.add(match[3]);
      }
    }
    expect(values.size).toBeGreaterThan(0);
    const known = new Set(Object.keys(zhLedger.history.serverValues.加入账本));
    expect([...values].filter((value) => !known.has(value))).toEqual([]);
  });
});
