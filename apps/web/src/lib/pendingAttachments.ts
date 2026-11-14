export interface PendingAttachment {
  id: string; ownerId: string; bookId: string; entryIds: string[]; name: string; blob: Blob;
  createdAt: number; error: string | null;
  draftLink?: import("./captureAttachments.js").AttachmentDraftLink;
}
let database: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("libevra-attachments-v1", 1);
    request.onupgradeneeded = () => { request.result.createObjectStore("pending", { keyPath: "id" }).createIndex("owner", "ownerId"); };
    request.onsuccess = () => {
      const connection = request.result;
      connection.onversionchange = () => { connection.close(); database = undefined; };
      resolve(connection);
    };
    request.onerror = () => reject(request.error);
  }).catch((error: unknown) => {
    database = undefined;
    throw error;
  });
  return database;
}
export async function pendingAttachments(ownerId: string): Promise<PendingAttachment[]> {
  if (!ownerId) return [];
  const database = await db();
  return new Promise((resolve, reject) => {
    const r = database.transaction("pending").objectStore("pending").index("owner").getAll(ownerId);
    r.onsuccess = () => resolve(r.result as PendingAttachment[]); r.onerror = () => reject(r.error);
  });
}
/** IndexedDB serializes these transactions across tabs. Only a new selection can create a row. */
async function writePending(action: (store: IDBObjectStore) => void): Promise<void> {
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction("pending", "readwrite");
    action(transaction.objectStore("pending"));
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
  });
  window.dispatchEvent(new Event("attachments-pending"));
}
export async function savePendingAttachment(file: PendingAttachment): Promise<void> {
  await writePending(store => { store.add(file); });
}

/** Late retries and association updates must never bring back a removed original. */
export async function updatePendingAttachment(file: PendingAttachment, patch: Partial<Pick<PendingAttachment, "entryIds" | "draftLink" | "error">>): Promise<void> {
  await writePending(store => {
    const request = store.get(file.id);
    request.onsuccess = () => {
      const current = request.result as PendingAttachment | undefined;
      if (current && current.ownerId === file.ownerId && current.bookId === file.bookId) {
        store.put({ ...current, ...patch });
      }
    };
  });
}

export async function removePendingAttachment(file: Pick<PendingAttachment, "id" | "ownerId">): Promise<void> {
  await writePending(store => {
    const request = store.get(file.id);
    request.onsuccess = () => {
      if (file.ownerId && request.result?.ownerId === file.ownerId) store.delete(file.id);
    };
  });
}

/** Account closure only. An owner index key cursor does not load any of the blobs into memory. */
export async function clearClosedAccountAttachments(ownerId: string): Promise<void> {
  if (!ownerId || typeof indexedDB === "undefined") return;
  await writePending(store => {
    const request = store.index("owner").openKeyCursor(ownerId);
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        store.delete(cursor.primaryKey);
        cursor.continue();
      }
    };
  });
}
