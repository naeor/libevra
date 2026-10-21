import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createNotDuplicateRelations,
  fetchNotDuplicateRelations,
  revokeNotDuplicateRelation,
} from "./notDuplicateRelations.js";

/**
 * S15-E3 · 关系 API 的请求形状。
 *
 * 纯 Node 环境没有浏览器：这里把 `window`（超时定时器）、`navigator.onLine` 与 `fetch`
 * 换成最小 stub，只验证"请求打到哪里、带哪些参数、如何解析响应"。
 * 真正的行为由 API 集成测试覆盖。
 */

let requested: { url: string; init: RequestInit }[] = [];

function stubBrowser(responseBody: unknown, status = 200): void {
  vi.stubGlobal("window", {
    setTimeout: (handler: () => void, timeout?: number) => setTimeout(handler, timeout),
    clearTimeout: (id: number) => clearTimeout(id),
  });
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      requested.push({ url, init });
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(responseBody),
      };
    }),
  );
}

beforeEach(() => {
  requested = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("关系 API 请求", () => {
  it("默认只取生效关系，并带上账本请求头", async () => {
    stubBrowser({ items: [], nextCursor: null });

    await fetchNotDuplicateRelations("book-1");

    expect(requested).toHaveLength(1);
    const [call] = requested;
    expect(call!.url).toBe("/api/v1/books/book-1/not-duplicate-relations");
    expect(call!.init.method).toBe("GET");
    expect((call!.init.headers as Record<string, string>)["x-libellum-book"]).toBe("book-1");
  });

  it("includeRevoked / transactionId 变成查询参数", async () => {
    stubBrowser({ items: [], nextCursor: null });

    await fetchNotDuplicateRelations("book-1", {
      includeRevoked: true,
      transactionId: "01990000-0000-7000-8000-000000000001",
    });

    const url = requested[0]!.url;
    expect(url).toContain("includeRevoked=true");
    expect(url).toContain("transactionId=01990000-0000-7000-8000-000000000001");
  });

  it("创建用 POST + JSON，撤销用 DELETE", async () => {
    stubBrowser({ items: [], created: 1, reactivated: 0, unchanged: 0 }, 201);

    await createNotDuplicateRelations("book-1", {
      pairs: [
        {
          transactionIdA: "01990000-0000-7000-8000-000000000001",
          transactionIdB: "01990000-0000-7000-8000-000000000002",
        },
      ],
    });

    stubBrowser({ items: [], created: 0, reactivated: 0, unchanged: 1 });
    await revokeNotDuplicateRelation("book-1", "rel-1");

    expect(requested.map((call) => call.init.method)).toEqual(["POST", "DELETE"]);
    expect(requested[1]!.url).toBe("/api/v1/books/book-1/not-duplicate-relations/rel-1");
    expect(JSON.parse(String(requested[0]!.init.body))).toMatchObject({ pairs: [{ transactionIdA: expect.any(String) }] });
  });

  it("响应不合协议时抛错，不把坏数据当列表", async () => {
    stubBrowser({ items: "not-an-array" });

    await expect(fetchNotDuplicateRelations("book-1")).rejects.toBeTruthy();
  });
});
