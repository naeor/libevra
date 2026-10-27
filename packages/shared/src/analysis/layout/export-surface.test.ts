/// <reference types="node" />
/**
 * S17 布局层 · I-0 静态守卫测试（Lead m02333 批准）。
 *
 * 覆盖：
 * 1. 包入口只做 additve 精选导出，禁止 `export *` 全量并入；
 * 2. 全部布局模块导出标识符与既有 `@libellum/shared` 导出无重名（含 reserved word 检查）；
 * 3. 低层辅助/测试符号不泄漏到包入口；
 * 4. 布局生产模块为纯函数：无 I/O、DOM、网络、时钟、随机、框架依赖；
 * 5. 入口导出的类型可被 `import type` 使用、关键函数与目录 barrel 同源；
 * 6. 投影不写回权威布局（纯函数不变量）。
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as layoutApi from "./index.js";
import * as sharedApi from "../../index.js";
import type {
  AnalysisReference,
  LayoutCommand,
  LayoutDocumentV1,
  ObjectSizeContract,
  ProjectionResult,
  WorkbenchContentDocumentV1,
} from "../../index.js";

const here = dirname(fileURLToPath(import.meta.url));
const sharedSrcDir = join(here, "..", "..");
const entryPath = join(sharedSrcDir, "index.ts");
const layoutSectionMarker = "// ---- S17 工作台布局层";

const INTERNAL_ONLY = [
  "PROFILE_KEY_STRATEGY_PLACEHOLDER",
  "PROFILE_WIDTH_BUCKETS_PLACEHOLDER",
  "UNIFIED_EDIT_WRITEBACK_PLACEHOLDER",
  "LAYOUT_MIGRATION_STEPS",
  "CONTENT_MIGRATION_STEPS",
  "GEOMETRY_REPAIR_ORDER",
  "ANALYSIS_PARAMS_ERROR_CODES",
  "findForbiddenKey",
  "sharePayloadByteLength",
  "isAnalysisReferenceShape",
  "DEFAULT_UNDO_LIMIT",
  "createTestPrng",
  "UNIT",
  "SPLIT_HALF",
  "contentOf",
] as const;

const RESERVED_WORDS = new Set(
  "break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await abstract boolean byte char double final float goto int long native short synchronized throws transient volatile arguments eval".split(
    " ",
  ),
);

function declaredNames(text: string): Set<string> {
  const names = new Set<string>();
  const declaration =
    /^export\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function|const|type|interface|class|enum)\s+([A-Za-z0-9_]+)/gm;
  let match: RegExpExecArray | null;
  while ((match = declaration.exec(text)) !== null) {
    const name = match[1];
    if (name !== undefined) names.add(name);
  }
  const block = /export\s+(?:type\s+)?\{([^}]*)\}/g;
  while ((match = block.exec(text)) !== null) {
    const body = match[1] ?? "";
    for (const raw of body.split(",")) {
      const entry = raw.trim().replace(/^type\s+/, "");
      if (entry.length === 0) continue;
      const parts = entry.split(/\s+/);
      const last = parts[parts.length - 1];
      if (last !== undefined && /^[A-Za-z0-9_]+$/.test(last)) names.add(last);
    }
  }
  return names;
}

function starTargets(text: string): string[] {
  const targets: string[] = [];
  const star = /^export\s+\*\s+from\s+"\.\/([A-Za-z0-9_.-]+?)(?:\.js)?";/gm;
  let match: RegExpExecArray | null;
  while ((match = star.exec(text)) !== null) {
    const target = match[1];
    if (target !== undefined) targets.push(target);
  }
  return targets;
}

const entryText = readFileSync(entryPath, "utf8");
const layoutSectionIndex = entryText.indexOf(layoutSectionMarker);
const entryWithoutLayout = layoutSectionIndex >= 0 ? entryText.slice(0, layoutSectionIndex) : entryText;

function existingSharedNames(): Set<string> {
  const names = new Set<string>(declaredNames(entryWithoutLayout));
  for (const target of starTargets(entryWithoutLayout)) {
    const file = join(sharedSrcDir, `${target}.ts`);
    try {
      for (const name of declaredNames(readFileSync(file, "utf8"))) names.add(name);
    } catch {
      // 忽略无法解析的 re-export 目标（CI 由 typecheck 兜底）。
    }
  }
  return names;
}

function layoutModuleNames(): Set<string> {
  const names = new Set<string>();
  for (const entry of readdirSync(here, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    if (entry.name === "index.ts" || entry.name.endsWith(".test.ts")) continue;
    for (const name of declaredNames(readFileSync(join(here, entry.name), "utf8"))) names.add(name);
  }
  return names;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("I-0 入口导出面守卫", () => {
  it("包入口新增 layout 精选导出段，且不出现 export * 全量并入", () => {
    expect(layoutSectionIndex).toBeGreaterThan(0);
    expect(entryText).not.toMatch(/export\s+\*\s+from\s+"\.\/analysis\/layout/);
    expect(entryText).toContain('from "./analysis/layout/projection.js"');
  });

  it("全部布局模块标识符与既有 shared 导出无重名、无 reserved word", () => {
    const existing = existingSharedNames();
    const layoutNames = layoutModuleNames();
    expect(layoutNames.size).toBeGreaterThanOrEqual(200);
    const conflicts = [...layoutNames].filter((name) => existing.has(name)).sort();
    expect(conflicts).toEqual([]);
    const reserved = [...layoutNames].filter((name) => RESERVED_WORDS.has(name)).sort();
    expect(reserved).toEqual([]);
  });

  it("低层辅助与测试符号不泄漏到包入口", () => {
    const exported = sharedApi as unknown as Record<string, unknown>;
    for (const name of INTERNAL_ONLY) expect(exported).not.toHaveProperty(name);
  });

  it("精选函数已从包入口导出且与目录 barrel 同源", () => {
    const fromShared = sharedApi as unknown as Record<string, unknown>;
    const fromLayout = layoutApi as unknown as Record<string, unknown>;
    const functions = [
      "projectLayout",
      "projectionToGeometry",
      "validateGeometry",
      "positionToRowCol",
      "runMigrationChain",
      "migrateLayoutDocument",
      "resolveProfile",
      "materializeProfile",
      "deriveContainerDisplay",
      "compactVertically",
      "repairLayoutGeometry",
      "createEditorState",
      "applyCommand",
      "transitionEditorMachine",
      "validateAnalysisParams",
      "checkShareImportGate",
      "buildShareSnapshot",
      "parseShareSnapshotJson",
      "prepareShareImport",
      "mergeLayoutDocuments",
      "mergeContentDocuments",
    ];
    for (const name of functions) {
      expect(typeof fromShared[name]).toBe("function");
      expect(fromShared[name]).toBe(fromLayout[name]);
    }
    expect(fromShared.LAYOUT_SCHEMA_VERSION).toBe(1);
    expect(fromShared.MAX_COLUMNS).toBe(12);
    expect((fromShared.TIME_FIXED_PRESETS as readonly string[]).length).toBe(6);
  });

  it("入口导出的类型可被 import type 使用", () => {
    const document: LayoutDocumentV1 | null = null;
    const content: WorkbenchContentDocumentV1 | null = null;
    const reference: AnalysisReference | null = null;
    const size: ObjectSizeContract | null = null;
    const command: LayoutCommand | null = null;
    const projection: ProjectionResult | null = null;
    expect([document, content, reference, size, command, projection]).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });
});

describe("I-0 纯函数静态守卫", () => {
  const productionFiles = readdirSync(here).filter(
    (name: string) =>
      name.endsWith(".ts") &&
      !name.endsWith(".test.ts") &&
      name !== "index.ts" &&
      name !== "test-support.ts" &&
      name !== "test-prng.ts",
  );

  it("布局生产模块无 I/O、DOM、网络、时钟、随机与框架依赖", () => {
    const forbidden: ReadonlyArray<readonly [RegExp, string]> = [
      [/from\s+"node:/, "node: 内置模块"],
      [/from\s+"(?:fs|path|os|http|https|crypto|url)"/, "Node 内置模块"],
      [/from\s+"react/, "React"],
      [/\brequire\s*\(/, "require"],
      [/\bwindow\./, "window"],
      [/\bnavigator\./, "navigator"],
      [/\bglobalThis\.document\b/, "globalThis.document"],
      [/\blocalStorage\b/, "localStorage"],
      [/\bsessionStorage\b/, "sessionStorage"],
      [/\bindexedDB\b/, "indexedDB"],
      [/\bfetch\s*\(/, "fetch"],
      [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
      [/\bMath\.random\b/, "Math.random"],
      [/\bDate\.now\b/, "Date.now"],
      [/\bnew Date\s*\(/, "new Date"],
      [/\bperformance\.now\b/, "performance.now"],
      [/\bsetTimeout\s*\(/, "setTimeout"],
      [/\bsetInterval\s*\(/, "setInterval"],
      [/\brequestAnimationFrame\b/, "requestAnimationFrame"],
      [/\bconsole\./, "console"],
      [/\bimport\.meta\b/, "import.meta"],
    ];
    const violations: string[] = [];
    for (const file of productionFiles) {
      const text = stripComments(readFileSync(join(here, file), "utf8"));
      for (const [pattern, label] of forbidden) {
        if (pattern.test(text)) violations.push(`${file}: ${label}`);
      }
      expect(text).not.toMatch(/from\s+"\.\.\/\.\.\/index\.js"/);
    }
    expect(violations).toEqual([]);
    expect(productionFiles.length).toBeGreaterThanOrEqual(17);
  });

  it("投影不写回权威布局（纯函数不变量）", () => {
    const content: WorkbenchContentDocumentV1 = {
      schemaVersion: 1,
      cards: [
        {
          objectId: "a",
          type: "analysis-card",
          analysis: { analysisId: "AN-B01", params: {} },
          chart: { chartFamily: "cf-01" },
          rangePolicy: "inherit",
        },
        {
          objectId: "b",
          type: "analysis-card",
          analysis: { analysisId: "AN-B02", params: {} },
          chart: { chartFamily: "cf-01" },
          rangePolicy: "inherit",
        },
      ],
      containers: [],
    };
    const layout: LayoutDocumentV1 = {
      schemaVersion: 1,
      layoutAlgorithmVersion: 1,
      mode: "unified",
      main: {
        baseCols: 3,
        objects: [
          { objectId: "a", objectType: "analysis-card", anchor: 1, colSpan: 2, rowSpan: 1 },
          { objectId: "b", objectType: "analysis-card", anchor: 3, colSpan: 1, rowSpan: 1 },
        ],
      },
    };
    const before = JSON.stringify({ content, layout });
    const result = sharedApi.projectLayout(layout.main, content, { targetColumns: 2 });
    expect(result.columns).toBe(2);
    expect(result.objects).toHaveLength(2);
    expect(JSON.stringify({ content, layout })).toBe(before);
    const second = sharedApi.projectLayout(layout.main, content, { targetColumns: 2 });
    expect(JSON.stringify(second)).toBe(JSON.stringify(result));
  });
});
