import { z } from "zod";
import { analysisParamsKeys, migrateContentDocument, migrateLayoutDocument, validateGeometry, type WorkbenchContentDocumentV1, type LayoutDocumentV1 } from "../analysis/layout/index.js";
import { runLayoutPipeline } from "./pipeline.js";

export const WORKSPACE_SCHEMA_VERSION = 1;
export const WORKSPACE_MAX_BYTES = 2 * 1024 * 1024;
export const WORKSPACE_MAX_PRESETS = 10;
const id = z.string().min(1).max(128);
const date = z.iso.datetime();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const size = z.strictObject({ colSpan: z.number().int().min(1).max(12), rowSpan: z.number().int().min(1).max(8) });
const geometry = z.strictObject({ baseCols: z.number().int().min(1).max(12), objects: z.array(z.strictObject({
  objectId: id, objectType: z.enum(["analysis-card", "grid-split", "carousel", "spacer"]),
  anchor: z.number().int().min(1).max(10000), colSpan: z.number().int().min(1).max(12), rowSpan: z.number().int().min(1).max(8),
  presentation: z.enum(["full", "collapsed"]).optional(), expandedSize: size.optional(),
})).max(40) });
const reference = z.strictObject({ analysisId: id, analysisVersion: id.optional(), params: z.record(z.string(), z.unknown()) });
const documentsShape = z.strictObject({
  content: z.strictObject({ schemaVersion: z.literal(1), cards: z.array(z.strictObject({
    objectId: id, type: z.literal("analysis-card"), analysis: reference,
    chart: z.strictObject({ chartFamily: id, options: z.strictObject({
      window: z.enum(["last-7-days", "month-to-date", "previous-month", "last-4-weeks", "last-6-months", "last-12-months"]).optional(),
      composition: z.strictObject({ v: z.literal(1), template: z.enum(["single", "T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"]), slots: z.array(z.strictObject({ id, analysisId: id, family: id })).min(1).max(8) }).optional(),
    }).optional() }),
    title: z.strictObject({ kind: z.enum(["preset", "custom"]), text: z.string().max(200).optional() }).optional(),
    rangePolicy: z.enum(["inherit", "pinned"]), pinnedRange: z.strictObject({ from: day, to: day }).optional(),
  })).max(40), containers: z.array(z.union([
    z.strictObject({ objectId: id, type: z.literal("carousel"), children: z.array(id).min(2).max(6) }),
    z.strictObject({ objectId: id, type: z.literal("grid-split"), children: z.array(id).min(1).max(4), split: z.strictObject({ columnSplitPermille: z.number().int().min(0).max(1000), rowSplitPermille: z.number().int().min(0).max(1000) }) }),
  ])).max(12) }),
  layout: z.strictObject({ schemaVersion: z.literal(1), layoutAlgorithmVersion: z.literal(1), mode: z.enum(["unified", "independent"]), main: geometry,
    profiles: z.array(z.strictObject({ profileKey: id, geometry })).max(12).optional(), previousMain: geometry.optional(),
  }),
});
export interface WorkspaceDocuments { readonly content: WorkbenchContentDocumentV1; readonly layout: LayoutDocumentV1 }
export interface WorkspacePreset {
  readonly id: string; readonly name: string; readonly description: string;
  readonly createdAt: string; readonly updatedAt: string; readonly documents: WorkspaceDocuments; readonly filters: string | null;
}
export interface WorkspaceConfiguration {
  readonly schemaVersion: 1;
  readonly workspace: WorkspaceDocuments | null;
  readonly presets: readonly WorkspacePreset[];
}
export const workspacePresetShape = z.strictObject({ id, name: z.string().trim().min(1).max(20), description: z.string().max(60), createdAt: date, updatedAt: date, documents: documentsShape, filters: z.string().max(12000).nullable() });
const configurationShape = z.strictObject({ schemaVersion: z.literal(1), workspace: documentsShape.nullable(), presets: z.array(workspacePresetShape).max(WORKSPACE_MAX_PRESETS) });
function assertFilters(value: string | null): void {
  if (value === null) return;
  const params = new URLSearchParams(value);
  const allowed = new Set(["range", "month", "from", "to", "currency", "analysis", "category", "payment", "tag"]);
  for (const [key, item] of params) if (!allowed.has(key) || item.length > 128) throw new Error("filters");
  for (const key of allowed) if (params.getAll(key).length > (["category", "payment", "tag"].includes(key) ? 50 : 1)) throw new Error("filters");
}

/** 校验前限制复杂度并拒绝原型键；不允许未知字段夹带交易、结果或凭据。 */
export function assertBoundedJson(value: unknown): void {
  let nodes = 0;
  const visit = (v: unknown, depth: number) => {
    if (++nodes > 80000 || depth > 24) throw new Error("complexity");
    if (typeof v === "string" && v.length > 20000) throw new Error("size");
    if (v !== null && typeof v === "object") {
      for (const key of Object.keys(v)) {
        if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("unsafe-field");
        visit((v as Record<string, unknown>)[key], depth + 1);
      }
    }
  };
  visit(value, 0);
  if (new TextEncoder().encode(JSON.stringify(value)).length > WORKSPACE_MAX_BYTES) throw new Error("size");
}
export function parseWorkspaceDocuments(value: unknown): WorkspaceDocuments {
  assertBoundedJson(value);
  const raw = value as { content?: unknown; layout?: unknown };
  const content = migrateContentDocument(raw?.content);
  const layout = migrateLayoutDocument(raw?.layout);
  if (!content.ok || content.status === "read-only-newer" || !content.value || !layout.ok || layout.status === "read-only-newer" || !layout.value) throw new Error("schema");
  // 不用迁移链丢掉未知顶层字段。
  if (!raw || Object.keys(raw).some(key => !["content", "layout"].includes(key))) throw new Error("fields");
  const docs = documentsShape.parse({ content: content.value, layout: layout.value }) as WorkspaceDocuments;
  const result = runLayoutPipeline(docs, { targetColumns: docs.layout.main.baseCols });
  if (!result.ok) throw new Error("documents");
  for (const g of [docs.layout.main, ...(docs.layout.profiles ?? []).map(p => p.geometry), ...(docs.layout.previousMain ? [docs.layout.previousMain] : [])]) {
    if (validateGeometry(g.objects, g.baseCols).length) throw new Error("geometry");
  }
  for (const card of docs.content.cards) {
    const allowed = new Set(analysisParamsKeys(card.analysis.analysisId));
    if (Object.keys(card.analysis.params).some(key => !allowed.has(key))) throw new Error("params");
    const slots = card.chart.options?.["composition"] as { slots?: readonly { id: string }[] } | undefined;
    if (slots?.slots && new Set(slots.slots.map(s => s.id)).size !== slots.slots.length) throw new Error("duplicate-slot");
  }
  return docs;
}
export function parseWorkspaceConfiguration(value: unknown): WorkspaceConfiguration {
  assertBoundedJson(value);
  const raw = value as WorkspaceConfiguration;
  const migrated = { ...raw, workspace: raw?.workspace === null ? null : parseWorkspaceDocuments(raw?.workspace), presets: Array.isArray(raw?.presets) ? raw.presets.map(p => ({ ...p, documents: parseWorkspaceDocuments(p.documents) })) : raw?.presets };
  const parsed = configurationShape.parse(migrated);
  if (new Set(parsed.presets.map(p => p.id)).size !== parsed.presets.length) throw new Error("duplicate-preset");
  for (const preset of parsed.presets) assertFilters(preset.filters);
  return { schemaVersion: 1, workspace: parsed.workspace === null ? null : parseWorkspaceDocuments(parsed.workspace), presets: parsed.presets.map(p => ({ ...p, documents: parseWorkspaceDocuments(p.documents) })) };
}
export function configurationFingerprint(value: WorkspaceConfiguration): string {
  const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : v !== null && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, stable(x)])) : v;
  return JSON.stringify(stable(value));
}
export interface WorkspaceRemote { readonly version: number; readonly schemaVersion: number; readonly updatedAt: string; readonly configuration: WorkspaceConfiguration }

const exchangeEntryShape = z.strictObject({ name: z.string().trim().min(1).max(20), description: z.string().max(60), documents: z.unknown(), filters: z.string().max(12000).nullable() });
const exchangeFileShape = z.strictObject({ format: z.literal("libevra-workspace"), formatVersion: z.literal(1), createdAt: z.iso.datetime(), kind: z.enum(["workspace", "preset", "presets"]), entries: z.array(z.unknown()).min(1).max(WORKSPACE_MAX_PRESETS) });
export function parseExchangeEnvelope(value: unknown) { assertBoundedJson(value); return exchangeFileShape.parse(value); }
export function parseExchangeEntry(value: unknown) { const entry = exchangeEntryShape.parse(value); assertFilters(entry.filters); return entry; }
