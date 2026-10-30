import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseWorkspaceConfiguration, parseWorkspaceDocuments, type WorkspaceDocuments } from "./configuration.js";
import { isLegacyDefaultWorkspace, LEGACY_DEFAULT_WORKSPACE, withoutLegacyDefault } from "./legacyDefault.js";

const MIGRATION = fileURLToPath(
  new URL("../../../../prisma/migrations/20261030120000_workbench_legacy_default_to_beginner/migration.sql", import.meta.url),
);

const clone = (): WorkspaceDocuments => JSON.parse(JSON.stringify(LEGACY_DEFAULT_WORKSPACE)) as WorkspaceDocuments;

/** 深拷贝并把每一层对象的键倒序（jsonb 与指纹都应与键顺序无关）。 */
function reversedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversedKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reversedKeys(item)]));
  }
  return value;
}

describe("旧版系统默认工作台「日常总览」的识别", () => {
  it("冻结文档本身能通过服务器同一套校验（与旧版保存到云端的形状一致）", () => {
    expect(parseWorkspaceDocuments(clone())).toEqual(LEGACY_DEFAULT_WORKSPACE);
  });

  it("服务器一次性迁移里写死的 JSON 与冻结文档完全一致", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const match = /"configuration" -> 'workspace' = '(\{.*\})'::jsonb;/s.exec(sql);
    expect(match).not.toBeNull();
    expect(JSON.parse(match![1]!)).toEqual(JSON.parse(JSON.stringify(LEGACY_DEFAULT_WORKSPACE)));
    // 迁移只把 workspace 置空，并保留旧配置、提升版本；不删除行、不碰其它表。
    expect(sql).toMatch(/jsonb_set\("configuration", '\{workspace\}', 'null'::jsonb, false\)/);
    expect(sql).toMatch(/"previous_configuration" = "configuration"/);
    expect(sql).toMatch(/"version" = "version" \+ 1/);
    expect(sql).not.toMatch(/\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i);
  });

  it("完全一致（含键顺序不同）才算旧版默认", () => {
    expect(isLegacyDefaultWorkspace(clone())).toBe(true);
    expect(isLegacyDefaultWorkspace(reversedKeys(clone()) as WorkspaceDocuments)).toBe(true);
  });

  it("任何一处由用户改动过的布局都不算（原样保留）", () => {
    const moved = clone();
    (moved.layout.main.objects[0] as { anchor: number }).anchor = 23;
    const family = clone();
    (family.content.cards[5]!.chart as { chartFamily: string }).chartFamily = "ranking";
    const named = clone();
    (named.content.cards[0] as { title: unknown }).title = { kind: "custom", text: "总支出" };
    const fewer = clone();
    (fewer.content as unknown as { cards: unknown[] }).cards = fewer.content.cards.filter((card) => card.objectId !== "default-i12");
    (fewer.layout.main as unknown as { objects: unknown[] }).objects = fewer.layout.main.objects.filter((object) => object.objectId !== "default-i12");
    const renamedId = clone();
    (renamedId.content.cards[0] as { objectId: string }).objectId = "card-0001";
    const pinned = clone();
    Object.assign(pinned.content.cards[0]!, { rangePolicy: "pinned", pinnedRange: { from: "2026-10-01", to: "2026-10-31" } });
    for (const variant of [moved, family, named, fewer, renamedId, pinned]) expect(isLegacyDefaultWorkspace(variant)).toBe(false);
    expect(isLegacyDefaultWorkspace(null)).toBe(false);
    expect(isLegacyDefaultWorkspace(undefined)).toBe(false);
  });

  it("换成「跟随系统默认」时只动工作台，我的预设原样保留", () => {
    const preset = {
      id: "p1", name: "旧布局", description: "", createdAt: "2026-10-29T00:00:00.000Z", updatedAt: "2026-10-29T00:00:00.000Z",
      documents: clone(), filters: null,
    };
    const configuration = parseWorkspaceConfiguration({ schemaVersion: 1, workspace: clone(), presets: [preset] });
    const next = withoutLegacyDefault(configuration);
    expect(next.workspace).toBeNull();
    expect(next.presets).toEqual(configuration.presets);
    // 已经不是旧版默认的配置原样返回（同一个对象）。
    expect(withoutLegacyDefault(next)).toBe(next);
  });
});
