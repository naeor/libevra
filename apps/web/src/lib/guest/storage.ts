/**
 * The guest's own local store — deliberately a **separate IndexedDB database**.
 *
 * ⚠️ **Why not reuse `libellum` (the account offline store)?** Because cleaning up after a formal
 * account is allowed to touch that database, while cleaning up a guest must never be able to:
 * `resetEverything()` deletes the whole `libellum` database, and the account's query cache/sync
 * queue share its store. A guest living in the same database would be one account-cleanup path away
 * from losing someone's local ledger — or, worse, from the guest's data sitting in a store whose
 * lifetime is governed by formal-account rules.
 *
 * **A second database is the smallest mechanism that makes the isolation structural rather than
 * a convention.** It costs one `indexedDB.open()` and gives S14-C a clean place for guest
 * transactions, categories and drafts without touching the account cache or the sync queue.
 *
 * ⚠️ **Every operation reports failure rather than throwing**, same rule as `offline/storage.ts`:
 * a storage layer that breaks the page is worse than a storage layer that says "no".
 *
 * 游客多账本（第二批）在这里补了三件事：
 * 1. **写入等事务提交完成才算成功**（`oncomplete`，以前是请求成功即返回）。切换账本、迁移旧数据之后
 *    紧接着整页重新载入，请求成功但事务尚未提交时离开页面，浏览器可以中止这次写入；等到提交完成，
 *    “写成功”才真的落盘，迁移的“写新键 → 读回校验 → 删旧键”也才有意义。
 * 2. **删除与原子更新**：`deleteGuestValue`、`updateGuestValue`（同一个 readwrite 事务里读 + 改 + 写，
 *    两个标签页同时改账本注册表也不会互相覆盖）。
 * 3. **可替换的存储后端**，只给测试用（`setGuestStorageBackendForTests`）：Node 测试环境没有 IndexedDB，
 *    迁移与中断场景要在内存后端上逐步注入失败来验证。正式代码永远走 IndexedDB 后端。
 */

/** The guest database. Renaming this abandons guest ledgers rather than migrating them. */
export const GUEST_DATABASE = "libellum-guest";

const STORE = "kv";
const VERSION = 1;

export function hasGuestIndexedDb(): boolean {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

let databasePromise: Promise<IDBDatabase> | null = null;

function openGuestDatabase(): Promise<IDBDatabase> {
  if (databasePromise !== null) return databasePromise;

  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(GUEST_DATABASE, VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE);
      }
    };

    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      resolve(database);
    };

    request.onerror = () => {
      reject(request.error ?? new Error("guest_indexeddb_open_failed"));
    };

    request.onblocked = () => {
      reject(new Error("guest_indexeddb_blocked"));
    };
  });

  // A failed open must not be remembered as the permanent answer.
  databasePromise = databasePromise.catch((error: unknown) => {
    databasePromise = null;
    throw error;
  });

  return databasePromise;
}

/**
 * 一次事务。读事务在请求成功时返回；写事务**等事务提交完成**（`oncomplete`）才返回——见文件头第 1 点。
 */
async function withStore<T>(
  readonly: boolean,
  work: (store: IDBObjectStore, done: (value: T) => void, fail: (error: unknown) => void) => void,
): Promise<T> {
  const database = await openGuestDatabase();

  return new Promise<T>((resolve, reject) => {
    let transaction: IDBTransaction;
    let result: { value: T } | null = null;
    let settled = false;
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error("guest_indexeddb_request_failed"));
    };
    try {
      transaction = database.transaction(STORE, readonly ? "readonly" : "readwrite");
      work(
        transaction.objectStore(STORE),
        (value) => {
          result = { value };
          if (readonly && !settled) {
            settled = true;
            resolve(value);
          }
        },
        fail,
      );
    } catch (error) {
      fail(error instanceof Error ? error : new Error("guest_indexeddb_transaction_failed"));
      return;
    }

    transaction.oncomplete = () => {
      if (settled) return;
      settled = true;
      if (result === null) reject(new Error("guest_indexeddb_no_result"));
      else resolve(result.value);
    };
    transaction.onerror = () => {
      fail(transaction.error ?? new Error("guest_indexeddb_transaction_failed"));
    };
    transaction.onabort = () => {
      fail(transaction.error ?? new Error("guest_indexeddb_transaction_aborted"));
    };
  });
}

/**
 * 存储后端：正式代码是 IndexedDB；测试可以换成内存实现并注入失败。
 *
 * 约定：`get` 返回 `undefined` 表示“没有这个键”，读失败时抛出；`put` / `delete` 失败时抛出；
 * `update` 在**一个原子步骤**里读出旧值、交给 `change` 计算新值（返回 `undefined` 表示不写）、写回，
 * 返回写入后的值（没写时是旧值）。`available()` 为 false 时，读视为“没有”，写视为失败。
 */
export interface GuestStorageBackend {
  available(): boolean;
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  update(key: string, change: (current: unknown) => unknown): Promise<unknown>;
  clear(): Promise<void>;
}

const indexedDbBackend: GuestStorageBackend = {
  available: hasGuestIndexedDb,
  get: (key) =>
    withStore<unknown>(true, (store, done, fail) => {
      const request = store.get(key);
      request.onsuccess = () => done(request.result);
      request.onerror = () => fail(request.error);
    }),
  put: (key, value) =>
    withStore<undefined>(false, (store, done, fail) => {
      const request = store.put(value, key);
      request.onsuccess = () => done(undefined);
      request.onerror = () => fail(request.error);
    }),
  delete: (key) =>
    withStore<undefined>(false, (store, done, fail) => {
      const request = store.delete(key);
      request.onsuccess = () => done(undefined);
      request.onerror = () => fail(request.error);
    }),
  update: (key, change) =>
    withStore<unknown>(false, (store, done, fail) => {
      const read = store.get(key);
      read.onerror = () => fail(read.error);
      read.onsuccess = () => {
        let next: unknown;
        try {
          next = change(read.result);
        } catch (error) {
          fail(error);
          return;
        }
        if (next === undefined) {
          done(read.result);
          return;
        }
        const write = store.put(next, key);
        write.onerror = () => fail(write.error);
        write.onsuccess = () => done(next);
      };
    }),
  clear: async () => {
    databasePromise = null;

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(GUEST_DATABASE);
      request.onsuccess = () => {
        resolve();
      };
      request.onerror = () => {
        reject(request.error ?? new Error("guest_indexeddb_delete_failed"));
      };
      request.onblocked = () => {
        reject(new Error("guest_indexeddb_delete_blocked"));
      };
    });
  },
};

let backendOverride: GuestStorageBackend | null = null;

function backend(): GuestStorageBackend {
  return backendOverride ?? indexedDbBackend;
}

/**
 * ⚠️ **只给测试用。** 换成内存后端以便在 Node 里验证迁移、中断与多账本读写；传 `null` 换回 IndexedDB。
 * 同时清空按键排队的写入链，避免上一组测试遗留的等待影响下一组。
 */
export function setGuestStorageBackendForTests(next: GuestStorageBackend | null): void {
  backendOverride = next;
  writeChains.clear();
}

/** Run writes for one key in the order they were requested (same reason as the account store). */
const writeChains = new Map<string, Promise<unknown>>();

function inOrder<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = writeChains.get(key) ?? Promise.resolve();
  const next = previous.then(work, work);
  writeChains.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

/** 读一个键的结果：`ok: false` 是“读失败”，与“没有这个键”（`value: null`）区分开。 */
export type GuestReadResult<T> = { readonly ok: true; readonly value: T | null } | { readonly ok: false };

/**
 * Read one guest value and say whether the read itself worked.
 *
 * ⚠️ **多账本迁移与载入用这个，而不是 `readGuestValue`。** “读不到”与“读失败”必须分开：把一次读失败
 * 当成“没有数据”再去种一本空账，就会覆盖掉真实账目——这正是本批要堵住的丢数据路径。
 */
export async function readGuestValueResult<T>(key: string): Promise<GuestReadResult<T>> {
  const store = backend();
  if (!store.available()) return { ok: true, value: null };

  try {
    const value = (await store.get(key)) as T | undefined;
    return { ok: true, value: value === undefined ? null : value };
  } catch {
    return { ok: false };
  }
}

/** Read one guest value; `null` means "absent or unreadable", which the caller treats the same. */
export async function readGuestValue<T>(key: string): Promise<T | null> {
  const result = await readGuestValueResult<T>(key);
  return result.ok ? result.value : null;
}

/** Write one guest value. Returns whether it was persisted (the transaction committed). */
export async function writeGuestValue(key: string, value: unknown): Promise<boolean> {
  return inOrder(key, async () => {
    const store = backend();
    if (!store.available()) return false;

    try {
      await store.put(key, value);
      return true;
    } catch {
      return false;
    }
  });
}

/** Delete one guest value. Returns whether the delete committed (deleting an absent key is success). */
export async function deleteGuestValue(key: string): Promise<boolean> {
  return inOrder(key, async () => {
    const store = backend();
    if (!store.available()) return false;

    try {
      await store.delete(key);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Read-modify-write one key in a single step.
 *
 * `change` receives the stored value (`null` when absent) and returns the next value, or `undefined`
 * to leave it alone. **It must be synchronous** — an IndexedDB transaction commits as soon as nothing
 * is pending, so awaiting anything inside would end the transaction before the write.
 *
 * Returns `{ ok, value }`: `value` is what the key holds afterwards (the new value, or the unchanged
 * one). An exception thrown by `change` is reported as `ok: false` and nothing is written.
 */
export async function updateGuestValue<T>(
  key: string,
  change: (current: T | null) => T | undefined,
): Promise<{ readonly ok: boolean; readonly value: T | null }> {
  return inOrder(key, async () => {
    const store = backend();
    if (!store.available()) return { ok: false, value: null };

    try {
      const value = await store.update(key, (current) =>
        change(current === undefined || current === null ? null : (current as T)),
      );
      return { ok: true, value: value === undefined ? null : (value as T) };
    } catch {
      return { ok: false, value: null };
    }
  });
}

/**
 * Delete the guest database.
 *
 * ⚠️ **Only the guest database.** The formal `libellum` database, the remembered formal user,
 * the current book and the query cache are not touched — and that is the promise this function
 * exists to keep: "clear guest data" must be unable to affect a formal account on the same device.
 *
 * 多账本以后同样一次删掉**全部**游客账本（每本账的数据、注册表、当前账本、迁移标记都在这个库里）。
 */
export async function clearGuestDatabase(): Promise<boolean> {
  const store = backend();
  if (!store.available()) return false;

  try {
    await store.clear();
    writeChains.clear();
    return true;
  } catch {
    return false;
  }
}

const GUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const KEY_NAME_PATTERN = /^[a-z][a-z0-9-]{0,40}$/;
/** 账本 id 的格式与注册表的校验一致（`ledger.ts` 的 `isGuestLedger`）；新账本都是 `guest-book-<uuid>`。 */
export const GUEST_BOOK_ID_PATTERN = /^[A-Za-z0-9_-]{4,80}$/;

/**
 * Key namespace for guest data. The prefix starts with `guest:` so it can never be mistaken for a
 * formal `<userId>:<bookId>` scope, and the identity id is validated before use.
 */
export function guestKey(guestId: string, name: string): string {
  if (!GUEST_ID_PATTERN.test(guestId)) {
    throw new Error("guestKey: invalid guest id");
  }
  if (!KEY_NAME_PATTERN.test(name)) {
    throw new Error("guestKey: invalid key name");
  }
  return `guest:${guestId}:${name}`;
}

/**
 * 属于某一本游客账本的键：`guest:<游客id>:<name>:<账本id>`（例如每本账的数据 `guest:<id>:data:<账本id>`）。
 * 三段都校验，账本 id 不能带冒号，所以不会与 `guestKey` 的两段键或别的账本的键混淆。
 */
export function guestBookKey(guestId: string, name: string, bookId: string): string {
  if (!GUEST_BOOK_ID_PATTERN.test(bookId)) {
    throw new Error("guestBookKey: invalid book id");
  }
  return `${guestKey(guestId, name)}:${bookId}`;
}
