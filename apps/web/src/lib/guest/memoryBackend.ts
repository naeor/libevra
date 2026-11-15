/**
 * **只给测试用**的游客库内存后端（`storage.ts` 的 `setGuestStorageBackendForTests`）。
 *
 * Node 测试环境没有 IndexedDB；游客多账本的迁移必须在“写到一半关页面”“配额不足”“删不掉旧键”这些情况下
 * 都不丢账目，这些情况要能逐步注入：
 *
 * - `failPut` / `failDelete` / `failGet`：让某个键的某次操作失败（像配额不足、读失败）；
 * - `crashAfter(n)`：第 n 次改动（写 / 删 / 原子更新）完成之后“页面关了”——之后的每个操作都永远不返回，
 *   后面的代码一行都不会再跑。测试随后用同一个 `store` 新建后端、重新载入模块，就是“下次启动”。
 *
 * 读写都做结构化克隆，和 IndexedDB 一样：写进去的是副本，读出来的也是副本。
 */
import type { GuestStorageBackend } from "./storage.js";

export interface MemoryGuestBackend extends GuestStorageBackend {
  readonly store: Map<string, unknown>;
  /** 已完成的改动次数（写、删、原子更新各算一次）。 */
  readonly mutations: () => number;
  /** 这次改动之后页面就“关了”。 */
  crashAfter(count: number | null): void;
  readonly crashed: () => boolean;
  failPut: (key: string, value: unknown) => boolean;
  failDelete: (key: string) => boolean;
  failGet: (key: string) => boolean;
}

export function createMemoryGuestBackend(store: Map<string, unknown> = new Map()): MemoryGuestBackend {
  let count = 0;
  let limit: number | null = null;
  let dead = false;
  const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

  const backend: MemoryGuestBackend = {
    store,
    mutations: () => count,
    crashAfter(next) {
      limit = next;
      dead = limit !== null && count >= limit;
    },
    crashed: () => dead,
    failPut: () => false,
    failDelete: () => false,
    failGet: () => false,
    available: () => true,
    async get(key) {
      if (dead) return never();
      if (backend.failGet(key)) throw new Error("memory_get_failed");
      return store.has(key) ? structuredClone(store.get(key)) : undefined;
    },
    async put(key, value) {
      if (dead) return never();
      if (backend.failPut(key, value)) throw new Error("memory_quota_exceeded");
      store.set(key, structuredClone(value));
      mutated();
    },
    async delete(key) {
      if (dead) return never();
      if (backend.failDelete(key)) throw new Error("memory_delete_failed");
      store.delete(key);
      mutated();
    },
    async update(key, change) {
      if (dead) return never();
      if (backend.failGet(key)) throw new Error("memory_get_failed");
      const current = store.has(key) ? structuredClone(store.get(key)) : undefined;
      const next = change(current);
      if (next === undefined) return current;
      if (backend.failPut(key, next)) throw new Error("memory_quota_exceeded");
      store.set(key, structuredClone(next));
      mutated();
      return structuredClone(next);
    },
    async clear() {
      if (dead) return never();
      store.clear();
      mutated();
    },
  };

  function mutated(): void {
    count += 1;
    if (limit !== null && count >= limit) dead = true;
  }

  return backend;
}
