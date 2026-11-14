import { removePendingAttachment, type PendingAttachment } from "./pendingAttachments.js";
export { pendingAttachments, savePendingAttachment, updatePendingAttachment, removePendingAttachment, type PendingAttachment } from "./pendingAttachments.js";
import { ATTACHMENT_CHUNK_BYTES, type AttachmentView, type BookStorageView, type AccountStorageView } from "@libellum/shared";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { apiFetch, ApiRequestError, buildHeaders } from "./api.js";
import { useAuth } from "../auth/AuthProvider.js";

export function useAttachments(bookId: string | null, entry?: string, state = "active", search = "", type = "", sort = "newest") {
  const { user } = useAuth();
  return useInfiniteQuery({ queryKey: ["attachments", user?.id, bookId, entry, state, search, type, sort], enabled: !!user && !!bookId,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => apiFetch<{ items: AttachmentView[]; nextCursor: string | null }>(`/books/${bookId}/attachments`, {
      query: { entry, state, search, type, sort, cursor: pageParam ?? undefined },
    }), getNextPageParam: (page) => page.nextCursor ?? undefined });
}
export function useBookStorage(bookId: string | null) {
  const { user } = useAuth();
  return useQuery({ queryKey: ["storage", user?.id, bookId], enabled: !!user && !!bookId,
    queryFn: () => apiFetch<BookStorageView>(`/books/${bookId}/storage`) });
}
export function useAccountStorage() {
  const { user } = useAuth();
  return useQuery({ queryKey: ["storage", user?.id, "account"], enabled: !!user,
    queryFn: () => apiFetch<AccountStorageView>("/storage") });
}
export function attachmentUrl(file: { bookId: string; id: string }, download = false): string {
  return `/api/v1/books/${encodeURIComponent(file.bookId)}/attachments/${encodeURIComponent(file.id)}/content${download ? "?download=1" : ""}`;
}

const cancelledTransfers = new Set<string>();
export const attachmentProgress = new Map<string, number>();
const reportProgress = (id: string, bytes: number | null) => { if (bytes === null) attachmentProgress.delete(id); else attachmentProgress.set(id, bytes); window.dispatchEvent(new Event("attachments-progress")); };

export async function uploadAttachment(file: PendingAttachment, active: () => boolean = () => true): Promise<void> {
  if (!active() || cancelledTransfers.has(file.id)) return;
  const base = `/books/${file.bookId}/attachments`;
  let remote = await apiFetch<AttachmentView>(base, { method: "POST", body: {
    id: file.id, accountId: file.ownerId, name: file.name, mediaType: file.blob.type, sizeBytes: file.blob.size, transactionIds: file.entryIds,
  } });
  reportProgress(file.id, remote.receivedBytes);
  try {
  for (let offset = remote.receivedBytes; offset < file.blob.size; offset += ATTACHMENT_CHUNK_BYTES) {
    if (!active() || cancelledTransfers.has(file.id)) return;
    const response = await fetch(`/api/v1${base}/${file.id}/chunks/${offset / ATTACHMENT_CHUNK_BYTES}`, {
      method: "PUT", credentials: "same-origin", headers: { ...buildHeaders(file.bookId), "Content-Type": "application/octet-stream" },
      body: file.blob.slice(offset, offset + ATTACHMENT_CHUNK_BYTES), signal: AbortSignal.timeout(60_000),
    });
    if (response.ok) reportProgress(file.id, Math.min(offset + ATTACHMENT_CHUNK_BYTES, file.blob.size));
    if (!response.ok) { const error = await response.json() as { code: string; message: string }; throw new ApiRequestError(response.status, error.code, error.message); }
  }
  if (!active() || cancelledTransfers.has(file.id)) return;
  remote = await apiFetch<AttachmentView>(`${base}/${file.id}/complete`, { method: "POST", timeoutMs: 90_000 });
  if (remote.state === "ready") await removePendingAttachment(file);
  } finally { reportProgress(file.id, null); }
}

export async function cancelPendingAttachment(file: PendingAttachment): Promise<void> {
  cancelledTransfers.add(file.id);
  try { await apiFetch(`/books/${file.bookId}/attachments/${file.id}`, { method: "DELETE" }); }
  catch (error) { if (!(error instanceof ApiRequestError && error.status === 404)) { cancelledTransfers.delete(file.id); throw error; } }
  await removePendingAttachment(file);
}
