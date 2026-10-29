import { assertBoundedJson, parseWorkspaceDocuments, parseExchangeEnvelope, parseExchangeEntry, WORKSPACE_MAX_BYTES, type WorkspaceDocuments } from "@libellum/shared/workbench/configuration";
import { cardType, type ChartFamily } from "./catalog.js";
import { readComposition, templateFit, templateOf, countSlots } from "./composition.js";
import type { UserPreset } from "./presets.js";

export interface ExchangeEntry { readonly name: string; readonly description: string; readonly documents: WorkspaceDocuments; readonly filters: string | null }
export interface ImportEntry { readonly name: string; readonly entry?: ExchangeEntry; readonly error?: string }

export function compatibilityProblems(documents: WorkspaceDocuments): string[] {
  const problems: string[] = [];
  for (const card of documents.content.cards) {
    const slots = readComposition(card).slots;
    for (const slot of slots) if (!cardType(slot.analysisId)?.families.includes(slot.family as ChartFamily)) problems.push(`${slot.analysisId}/${slot.family}`);
    const composition = readComposition(card);
    if (composition.adjusted || composition.source === "future" || composition.source === "invalid") problems.push("composition");
    const template = templateOf(composition.template);
    if (!template || templateFit(template, countSlots(slots)).status !== "ok") problems.push(composition.template);
  }
  return problems;
}
/** 账号 / 账本内的 UUID 引用不跨账号传播；时间与币种语义保留，维度需在目标账本重选。 */
export function portableEntry(entry: ExchangeEntry): ExchangeEntry {
  const documents = structuredClone(entry.documents);
  for (const card of documents.content.cards) {
    const params = card.analysis.params as Record<string, unknown>;
    for (const key of ["categoryIds", "paymentMethodIds", "tagIds"]) delete params[key];
  }
  const filters = entry.filters === null ? null : new URLSearchParams(entry.filters);
  for (const key of ["category", "categoryBranch", "payment", "tag", "book", "bookId", "userId", "accountId"]) filters?.delete(key);
  return { ...entry, documents: parseWorkspaceDocuments(documents), filters: filters?.toString() ?? null };
}
export function exportWorkspaceFile(kind: "workspace" | "preset" | "presets", entries: readonly ExchangeEntry[], now = new Date()): string {
  for (const entry of entries) parseExchangeEntry(entry);
  const file = { format: "libevra-workspace", formatVersion: 1, createdAt: now.toISOString(), kind, entries: entries.map(portableEntry) };
  assertBoundedJson(file);
  parseExchangeEnvelope(file);
  return JSON.stringify(file, null, 2);
}
export function parseWorkspaceFile(text: string): readonly ImportEntry[] {
  if (new TextEncoder().encode(text).length > WORKSPACE_MAX_BYTES) throw Error("size");
  const parsed: unknown = JSON.parse(text);
  assertBoundedJson(parsed);
  const file = parseExchangeEnvelope(parsed);
  return file.entries.map((item, index) => {
    try {
      const raw = parseExchangeEntry(item);
      const documents = parseWorkspaceDocuments(raw.documents);
      const problems = compatibilityProblems(documents);
      if (problems.length) return { name: raw.name, error: problems.join(", ") };
      return { name: raw.name, entry: portableEntry({ ...raw, documents }) };
    } catch { return { name: typeof (item as { name?: unknown })?.name === "string" ? String((item as { name: string }).name).slice(0, 20) : String(index + 1), error: "invalid" }; }
  });
}
export function presetEntry(preset: UserPreset): ExchangeEntry { return { name: preset.name, description: preset.description, documents: preset.documents, filters: preset.filters }; }
export function downloadWorkspaceFile(text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
  const a = document.createElement("a");
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  a.href = url; a.download = `libevra-workspace-${date}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
