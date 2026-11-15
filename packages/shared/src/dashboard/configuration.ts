/**
 * **电脑版总览的跨设备配置**（1.19.104，候选清单 E1）：账号级，一个账号一份，存在单独的表与接口里
 * （`dashboard_configurations`、`/api/v1/dashboard-config`），与分析工作台的配置分开——工作台的服务器校验和
 * 旧版本客户端都是严格字段，总览卡片的选项塞进去会被拒绝或被旧客户端写丢。
 *
 * 内容：总览页面（工作台文档，D 的正式管线校验）、已知账本、口径与侧栏设置、我的预设、常用账目。
 * 不含：这台设备的金额遮罩开关、停在哪一页、列数偏好（都是设备上的显示偏好）。
 *
 * 校验与工作台同一原则：先限制复杂度、拒绝原型键；每一层都是 strict 对象，不允许夹带未知字段；
 * 文档走迁移链 + 布局管线 + 几何校验。常用账目带金额、备注与分类 id——它们是账号自己的数据，
 * 与账本数据一样只给本人读写。
 */
import { z } from "zod";

import { migrateContentDocument, migrateLayoutDocument, validateGeometry, type LayoutDocumentV1, type WorkbenchContentDocumentV1 } from "../analysis/layout/index.js";
import { runLayoutPipeline } from "../workbench/pipeline.js";
import { assertBoundedJson } from "../workbench/configuration.js";

export const DASHBOARD_SCHEMA_VERSION = 1;
export const DASHBOARD_MAX_BYTES = 2 * 1024 * 1024;
export const DASHBOARD_MAX_PAGES = 8;
export const DASHBOARD_MAX_PRESETS = 10;
export const DASHBOARD_MAX_TEMPLATES = 30;

const id = z.string().min(1).max(128);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const size = z.strictObject({ colSpan: z.number().int().min(1).max(12), rowSpan: z.number().int().min(1).max(8) });
const geometry = z.strictObject({ baseCols: z.number().int().min(1).max(12), objects: z.array(z.strictObject({
  objectId: id, objectType: z.enum(["analysis-card", "grid-split", "carousel", "spacer"]),
  anchor: z.number().int().min(1).max(10000), colSpan: z.number().int().min(1).max(12), rowSpan: z.number().int().min(1).max(8),
  presentation: z.enum(["full", "collapsed"]).optional(), expandedSize: size.optional(),
})).max(40) });

/** 总览卡片可以有的 `chart.options` 键（分析页没有的四个：native、source、display 之外与工作台相同）。 */
const chartOptions = z.strictObject({
  window: z.enum(["last-7-days", "month-to-date", "previous-month", "last-4-weeks", "last-6-months", "last-12-months"]).optional(),
  composition: z.strictObject({ v: z.literal(1), template: z.enum(["single", "T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"]), slots: z.array(z.strictObject({ id, analysisId: id, family: id })).min(1).max(8) }).optional(),
  native: z.strictObject({
    bookId: id.optional(),
    books: z.union([z.literal("all"), z.array(id).max(50)]).optional(),
    metric: z.enum(["expense", "income", "balance"]).optional(),
    showTrend: z.boolean().optional(),
    showRecent: z.boolean().optional(),
    kinds: z.array(z.enum(["conflicts", "pending", "uncategorised", "missingFx", "attachments"])).max(5).optional(),
  }).optional(),
  source: z.strictObject({ bookId: id }).optional(),
  display: z.strictObject({
    note: z.string().max(60).optional(),
    empty: z.literal("quiet").optional(),
    open: z.enum(["entries", "analysis", "none"]).optional(),
    masked: z.literal(true).optional(),
  }).optional(),
});

const documentsShape = z.strictObject({
  content: z.strictObject({ schemaVersion: z.literal(1), cards: z.array(z.strictObject({
    objectId: id, type: z.literal("analysis-card"),
    analysis: z.strictObject({ analysisId: id, analysisVersion: id.optional(), params: z.record(z.string(), z.unknown()) }),
    chart: z.strictObject({ chartFamily: id, options: chartOptions.optional() }),
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

export interface DashboardDocuments { readonly content: WorkbenchContentDocumentV1; readonly layout: LayoutDocumentV1 }

/** 一份总览页文档：迁移链 → strict 形状 → 布局管线（没有错误级问题）→ 每份几何合法。 */
export function parseDashboardDocuments(value: unknown): DashboardDocuments {
  const raw = value as { content?: unknown; layout?: unknown };
  if (!raw || typeof raw !== "object" || Object.keys(raw).some((key) => key !== "content" && key !== "layout")) throw new Error("fields");
  const content = migrateContentDocument(raw.content);
  const layout = migrateLayoutDocument(raw.layout);
  if (!content.ok || content.status === "read-only-newer" || !content.value || !layout.ok || layout.status === "read-only-newer" || !layout.value) throw new Error("schema");
  const docs = documentsShape.parse({ content: content.value, layout: layout.value }) as DashboardDocuments;
  if (!runLayoutPipeline(docs, { targetColumns: docs.layout.main.baseCols }).ok) throw new Error("documents");
  for (const g of [docs.layout.main, ...(docs.layout.profiles ?? []).map((p) => p.geometry), ...(docs.layout.previousMain ? [docs.layout.previousMain] : [])]) {
    if (validateGeometry(g.objects, g.baseCols).length > 0) throw new Error("geometry");
  }
  return docs;
}

const templateShape = z.strictObject({
  id, bookId: id, name: z.string().trim().min(1).max(20),
  kind: z.enum(["expense", "income"]),
  amountCents: z.number().int().min(1).max(1_000_000_000_000),
  currency: z.string().min(3).max(8),
  categoryId: id.nullable(), paymentMethodId: id.nullable(),
  note: z.string().max(200),
  tagIds: z.array(id).max(50),
});

const settingsShape = z.strictObject({
  time: z.record(z.string(), z.union([z.string().max(16), z.number()])),
  books: z.union([z.literal("all"), z.array(id).max(50)]),
  combined: z.boolean(),
  sidebar: z.strictObject({ modules: z.array(z.strictObject({
    kind: z.enum(["quick", "messages", "pending", "recent", "books", "inbox", "calendar", "templates", "inspector"]),
    collapsed: z.boolean().optional(),
    methods: z.array(z.enum(["manual", "paste", "voice", "scan", "import"])).max(5).optional(),
    iconOnly: z.boolean().optional(),
    account: z.boolean().optional(),
    limit: z.number().int().min(1).max(20).optional(),
  })).max(9) }),
});

const configurationShape = z.strictObject({
  schemaVersion: z.literal(DASHBOARD_SCHEMA_VERSION),
  // 空列表 = 没有自己的布局，跟随默认总览（按当前账本生成）。
  pages: z.array(z.strictObject({ id, name: z.string().max(12), kind: z.literal("per-book").optional(), documents: z.unknown() })).max(DASHBOARD_MAX_PAGES),
  knownBooks: z.array(id).max(200),
  settings: settingsShape.nullable(),
  presets: z.array(z.strictObject({ id, name: z.string().trim().min(1).max(20), createdAt: z.iso.datetime(), documents: z.unknown() })).max(DASHBOARD_MAX_PRESETS),
  templates: z.array(templateShape).max(DASHBOARD_MAX_TEMPLATES),
});

export interface DashboardConfiguration {
  readonly schemaVersion: typeof DASHBOARD_SCHEMA_VERSION;
  readonly pages: readonly { readonly id: string; readonly name: string; readonly kind?: "per-book"; readonly documents: DashboardDocuments }[];
  readonly knownBooks: readonly string[];
  /** 口径与侧栏（客户端按自己的规则再解析一次，看不懂的字段按缺省）；没有设置过为 `null`。 */
  readonly settings: z.infer<typeof settingsShape> | null;
  readonly presets: readonly { readonly id: string; readonly name: string; readonly createdAt: string; readonly documents: DashboardDocuments }[];
  readonly templates: readonly z.infer<typeof templateShape>[];
}

export function parseDashboardConfiguration(value: unknown): DashboardConfiguration {
  assertBoundedJson(value);
  if (new TextEncoder().encode(JSON.stringify(value)).length > DASHBOARD_MAX_BYTES) throw new Error("size");
  const parsed = configurationShape.parse(value);
  const ids = (items: readonly { id: string }[]): boolean => new Set(items.map((item) => item.id)).size === items.length;
  if (!ids(parsed.pages) || !ids(parsed.presets) || !ids(parsed.templates)) throw new Error("duplicate-id");
  return {
    schemaVersion: DASHBOARD_SCHEMA_VERSION,
    pages: parsed.pages.map((page) => ({ id: page.id, name: page.name, ...(page.kind === undefined ? {} : { kind: page.kind }), documents: parseDashboardDocuments(page.documents) })),
    knownBooks: parsed.knownBooks,
    settings: parsed.settings,
    presets: parsed.presets.map((preset) => ({ ...preset, documents: parseDashboardDocuments(preset.documents) })),
    templates: parsed.templates,
  };
}

/** 与顺序无关的指纹（判断本机与云端是否相同）。 */
export function dashboardFingerprint(value: DashboardConfiguration): string {
  const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : v !== null && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, stable(x)])) : v;
  return JSON.stringify(stable(value));
}

export interface DashboardRemote {
  readonly version: number;
  readonly schemaVersion: number;
  readonly updatedAt: string;
  readonly configuration: DashboardConfiguration;
}
