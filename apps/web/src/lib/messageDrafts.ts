import type { MessageReferenceView } from "@libellum/shared";

interface Draft { readonly text: string; readonly quote: MessageReferenceView | null }
const empty: Draft = { text: "", quote: null };
const drafts = new Map<string, Draft>();

/** 只存在于本次会话；账号、查看账本各自保存草稿，切换面板不串账。 */
export function messageDraftScope(owner: string | null, bookId: string | null): string {
  return JSON.stringify([owner, bookId]);
}
export function readMessageDraft(scope: string): Draft {
  return drafts.get(scope) ?? empty;
}
export function updateMessageDraft(scope: string, patch: Partial<Draft>): void {
  drafts.set(scope, { ...readMessageDraft(scope), ...patch });
}
export function clearAllMessageDrafts(): void {
  drafts.clear();
}
