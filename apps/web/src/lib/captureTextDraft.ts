import { useSyncExternalStore } from "react";
import type { PasteCandidate } from "../pages/PastePage.js";

interface TextDraft { text: string; batchId: string; candidates: readonly PasteCandidate[] | null }
const EMPTY: TextDraft = { text: "", batchId: "", candidates: null };
const drafts = new Map<string, TextDraft>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** 核对单笔后返回仍可继续其余候选；只存当前标签页内存，不写浏览历史或云端。 */
export function useCaptureTextDraft(key: string) {
  const value = useSyncExternalStore(subscribe, () => drafts.get(key) ?? EMPTY, () => EMPTY);
  const patch = (changes: Partial<TextDraft>) => {
    drafts.set(key, { ...(drafts.get(key) ?? EMPTY), ...changes });
    for (const listener of listeners) listener();
  };
  return { ...value, setText: (text: string) => patch({ text }), setCandidates: (candidates: readonly PasteCandidate[] | null) => patch({ candidates, batchId: candidates ? crypto.randomUUID() : "" }) };
}
