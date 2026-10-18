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

async function withStore<T>(
  readonly: boolean,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openGuestDatabase();

  return new Promise<T>((resolve, reject) => {
    let request: IDBRequest<T>;
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(STORE, readonly ? "readonly" : "readwrite");
      request = work(transaction.objectStore(STORE));
    } catch (error) {
      reject(error instanceof Error ? error : new Error("guest_indexeddb_transaction_failed"));
      return;
    }

    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("guest_indexeddb_request_failed"));
    };
    transaction.onabort = () => {
      reject(transaction.error ?? new Error("guest_indexeddb_transaction_aborted"));
    };
  });
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

/** Read one guest value; `null` means "absent or unreadable", which the caller treats the same. */
export async function readGuestValue<T>(key: string): Promise<T | null> {
  if (!hasGuestIndexedDb()) return null;

  try {
    const value = await withStore(true, (store) => store.get(key) as IDBRequest<T | undefined>);
    return value === undefined ? null : value;
  } catch {
    return null;
  }
}

/** Write one guest value. Returns whether it was persisted. */
export async function writeGuestValue(key: string, value: unknown): Promise<boolean> {
  return inOrder(key, async () => {
    if (!hasGuestIndexedDb()) return false;

    try {
      await withStore(false, (store) => store.put(value, key));
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Delete the guest database.
 *
 * ⚠️ **Only the guest database.** The formal `libellum` database, the remembered formal user,
 * the current book and the query cache are not touched — and that is the promise this function
 * exists to keep: "clear guest data" must be unable to affect a formal account on the same device.
 */
export async function clearGuestDatabase(): Promise<boolean> {
  if (!hasGuestIndexedDb()) return false;

  try {
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

    return true;
  } catch {
    return false;
  }
}

/**
 * Key namespace for guest data. The prefix starts with `guest:` so it can never be mistaken for a
 * formal `<userId>:<bookId>` scope, and the identity id is validated before use.
 */
export function guestKey(guestId: string, name: string): string {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(guestId)) {
    throw new Error("guestKey: invalid guest id");
  }
  if (!/^[a-z][a-z0-9-]{0,40}$/.test(name)) {
    throw new Error("guestKey: invalid key name");
  }
  return `guest:${guestId}:${name}`;
}
