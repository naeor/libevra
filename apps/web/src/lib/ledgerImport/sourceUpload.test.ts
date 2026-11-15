import {
  MAX_IMPORT_TRANSACTIONS,
  MAX_STAGED_IMPORT_TRANSACTIONS,
  fingerprintGuestSource,
  type GuestImportSource,
} from "@libellum/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError, UserFacingError, errorMessage } from "../api.js";

/**
 * 1.19.97 · 游客来源分段上传（浏览器端）。服务器一侧的拼接、校验与三个入口见
 * `apps/api/test/ledgerImportSourceUpload.test.ts`；这里只验证浏览器怎么分段、续传、复用与重传。
 */
const calls = vi.hoisted(() => ({ list: [] as { path: string; method: string; body: unknown }[], respond: null as null | ((path: string, body: unknown) => unknown) }));
vi.mock("../api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api.js")>();
  return {
    ...actual,
    apiFetch: async (path: string, options: { method?: string; body?: unknown } = {}) => {
      calls.list.push({ path, method: options.method ?? "GET", body: options.body });
      return calls.respond!(path, options.body);
    },
  };
});

const BOOK = "guest-book-0b5e9a3c-1d7e-4b5f-9c1e-7a2d3f4b5c6d";

function sourceOf(count: number, note: string | null = null): GuestImportSource {
  const categoryId = "11111111-1111-4111-8111-111111111111";
  return {
    name: "游客账本",
    guestBookId: BOOK,
    categories: [{ id: categoryId, name: "餐饮", kind: "expense", description: null, sortOrder: 0, isArchived: false, isSystem: false, parentId: null, icon: null, color: null }],
    paymentMethods: [],
    tags: [],
    transactions: Array.from({ length: count }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      kind: "expense" as const,
      amountCents: 100 + index,
      currency: "CNY" as const,
      categoryId,
      paymentMethodId: null,
      occurredAt: "2026-01-01T00:00:00.000Z",
      occurredLocalDate: "2026-01-01",
      occurredTz: "Asia/Shanghai",
      note,
      tagIds: [],
    })),
  };
}

/** 一个听话的服务器：记下收到的段，complete 时回 ready。 */
function honestServer(options: { readyAtCreate?: boolean; received?: number[]; uploadId?: string } = {}) {
  const id = options.uploadId ?? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  return (path: string, body: unknown) => {
    const base = { guestBookId: BOOK, sourceFingerprint: "0".repeat(64), transactionCount: 0, partCount: 0, expiresAt: "2026-11-16T00:00:00.000Z" };
    if (path === "/ledger-imports/source-uploads") {
      const created = body as { transactionCount: number; partCount: number };
      return { ...base, ...created, uploadId: id, status: options.readyAtCreate ? "ready" : "receiving", receivedParts: options.received ?? [] };
    }
    if (path.endsWith("/complete")) return { ...base, uploadId: id, status: "ready", receivedParts: [] };
    if (path.includes("/parts/")) return { ...base, uploadId: id, status: "receiving", receivedParts: [] };
    return { ok: true };
  };
}

beforeEach(async () => {
  calls.list = [];
  calls.respond = honestServer();
  (await import("./sourceUpload.js")).resetGuestSourceUploadsForTest();
  vi.stubGlobal("navigator", { onLine: true });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("什么时候分段上传", () => {
  it("小的来源随请求上传；超过 5000 笔或超过 512 KB 才分段", async () => {
    const { needsStagedUpload, INLINE_SOURCE_MAX_BYTES, sourceByteLength } = await import("./sourceUpload.js");
    expect(needsStagedUpload(sourceOf(10))).toBe(false);
    expect(needsStagedUpload(sourceOf(MAX_IMPORT_TRANSACTIONS + 1))).toBe(true);
    const wordy = sourceOf(400, "很长的备注".repeat(100));
    expect(sourceByteLength(wordy)).toBeGreaterThan(INLINE_SOURCE_MAX_BYTES);
    expect(needsStagedUpload(wordy)).toBe(true);
  });

  it("withGuestSource 对小来源直接带上 source，不发上传请求", async () => {
    const { withGuestSource } = await import("./sourceUpload.js");
    const source = sourceOf(3);
    const sent = await withGuestSource(source, async (reference) => reference);
    expect(sent).toEqual({ source });
    expect(calls.list).toHaveLength(0);
  });
});

describe("分段上传", () => {
  it("按段上传后完成，返回服务器给的暂存 id；同一份来源本页只传一次", async () => {
    const { uploadGuestSource } = await import("./sourceUpload.js");
    const source = sourceOf(2_500);
    const progress: number[] = [];
    const id = await uploadGuestSource(source, { onProgress: (next) => progress.push(next.sentParts) });
    expect(id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const create = calls.list[0]!;
    expect(create.path).toBe("/ledger-imports/source-uploads");
    expect(create.body).toMatchObject({
      sourceFingerprint: await fingerprintGuestSource(source),
      transactionCount: 2_500,
      partCount: 3,
      header: { name: "游客账本", guestBookId: BOOK },
    });
    expect((create.body as { header: object }).header).not.toHaveProperty("transactions");
    const parts = calls.list.filter((call) => call.path.includes("/parts/"));
    expect(parts.map((call) => [call.method, call.path.split("/").at(-1), (call.body as { transactions: unknown[] }).transactions.length]))
      .toEqual([["POST", "0", 1000], ["POST", "1", 1000], ["POST", "2", 500]]);
    expect(calls.list.at(-1)!.path).toMatch(/\/complete$/);
    expect(progress).toEqual([0, 1, 2, 3]);

    calls.list = [];
    expect(await uploadGuestSource(source)).toBe(id);
    expect(calls.list).toHaveLength(0);
  });

  it("续传只补服务器没收到的段；服务器已有同一份 ready 的暂存时一段都不传", async () => {
    const { uploadGuestSource, resetGuestSourceUploadsForTest } = await import("./sourceUpload.js");
    calls.respond = honestServer({ received: [0, 2] });
    await uploadGuestSource(sourceOf(2_500));
    expect(calls.list.filter((call) => call.path.includes("/parts/")).map((call) => call.path.split("/").at(-1))).toEqual(["1"]);

    resetGuestSourceUploadsForTest();
    calls.list = [];
    calls.respond = honestServer({ readyAtCreate: true, uploadId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
    expect(await uploadGuestSource(sourceOf(2_500))).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(calls.list.map((call) => call.path)).toEqual(["/ledger-imports/source-uploads"]);
  });

  // 真实计时：第一次重试前等 1 秒（指纹用 WebCrypto 异步计算，假计时器推不动它）。
  it("网络错误与 5xx 重试同一段；4xx 不重试", async () => {
    {
      const { uploadGuestSource } = await import("./sourceUpload.js");
      const server = honestServer();
      let failures = 1;
      calls.respond = (path, body) => {
        if (path.endsWith("/parts/0") && failures > 0) { failures -= 1; throw new ApiRequestError(0, "timeout", "超时"); }
        return server(path, body);
      };
      await expect(uploadGuestSource(sourceOf(1_200))).resolves.toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
      expect(calls.list.filter((call) => call.path.endsWith("/parts/0"))).toHaveLength(2);

      calls.list = [];
      calls.respond = (path, body) => {
        if (path.includes("/parts/")) throw new ApiRequestError(409, "source_upload_part_conflict", "不一致");
        return server(path, body);
      };
      const { resetGuestSourceUploadsForTest } = await import("./sourceUpload.js");
      resetGuestSourceUploadsForTest();
      await expect(uploadGuestSource(sourceOf(1_200))).rejects.toMatchObject({ code: "source_upload_part_conflict" });
      expect(calls.list.filter((call) => call.path.includes("/parts/"))).toHaveLength(1);
    }
  }, 15_000);

  it("超过 2 万笔：不发请求，给出可读的提示", async () => {
    const { uploadGuestSource } = await import("./sourceUpload.js");
    const error = await uploadGuestSource(sourceOf(MAX_STAGED_IMPORT_TRANSACTIONS + 1)).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UserFacingError);
    expect(errorMessage(error)).toContain("20000");
    expect(calls.list).toHaveLength(0);
  }, 30_000);
});

describe("暂存失效时重新上传一次", () => {
  it("暂存过期或被取代：忘掉旧 id，重新上传后再发一次", async () => {
    const { withGuestSource } = await import("./sourceUpload.js");
    const source = sourceOf(MAX_IMPORT_TRANSACTIONS + 1);
    let uploads = 0;
    const server = honestServer();
    calls.respond = (path, body) => {
      if (path === "/ledger-imports/source-uploads") uploads += 1;
      const answer = server(path, body) as { uploadId: string };
      return path === "/ledger-imports/source-uploads" ? { ...answer, uploadId: uploads === 1 ? "cccccccc-cccc-4ccc-8ccc-cccccccccccc" : "dddddddd-dddd-4ddd-8ddd-dddddddddddd" } : answer;
    };
    const seen: string[] = [];
    const result = await withGuestSource(source, async (reference) => {
      const id = "sourceUploadId" in reference ? reference.sourceUploadId : "inline";
      seen.push(id);
      if (seen.length === 1) throw new ApiRequestError(410, "source_upload_expired", "过期");
      return id;
    });
    expect(uploads).toBe(2);
    expect(seen).toHaveLength(2);
    expect(result).toBe(seen[1]);
  }, 30_000);

  it("其它错误照常抛出，不重传", async () => {
    const { withGuestSource } = await import("./sourceUpload.js");
    const source = sourceOf(MAX_IMPORT_TRANSACTIONS + 1);
    await expect(
      withGuestSource(source, async () => { throw new ApiRequestError(409, "target_changed", "目标变了"); }),
    ).rejects.toMatchObject({ code: "target_changed" });
    expect(calls.list.filter((call) => call.path === "/ledger-imports/source-uploads")).toHaveLength(1);
  }, 30_000);
});
