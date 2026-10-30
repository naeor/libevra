/**
 * 1.18.01 工作台网格：自动列数、行高、列数偏好（只是显示偏好）与「较宽松」提示。
 * 引擎本身（投影、专属布局、保存路由）在 `@libellum/shared` 的 `responsive.test.ts`。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { geometryQuality, type LayoutGeometry } from "@libellum/shared/analysis/layout";

import { columnPreferenceKey, effectiveColumns, readColumnPreference, writeColumnPreference } from "./columns.js";
import { defaultWorkbench } from "./defaults.js";
import { autoColumnsFor, columnLimitFor, displayFor, gridMetricsFor, gridTrack, layoutLooksSparse } from "./Grid.js";
import { buildSystemPreset, SYSTEM_PRESET_IDS } from "./presets.js";

const translate = (key: string) => key;
const presets = SYSTEM_PRESET_IDS.map((id) => [id, buildSystemPreset(id, translate)] as const);

function geometryAt(documents: ReturnType<typeof defaultWorkbench>, columns: number): LayoutGeometry {
  const projection = displayFor(documents, columns).projection;
  return { baseCols: projection.columns, objects: projection.objects.map(({ objectId, objectType, anchor, colSpan, rowSpan }) => ({ objectId, objectType, anchor, colSpan, rowSpan })) };
}

describe("自动列数（网格容器宽度，不是窗口宽度）", () => {
  it("手机宽度（320 / 375 / 390 的网格）保持两列、行高 116px，与 1.17 相同", () => {
    for (const [, documents] of presets) {
      for (const width of [272, 327, 342]) {
        const columns = autoColumnsFor(documents, width);
        expect(columns).toBe(2);
        expect(gridTrack(width, columns).rowHeight).toBe(116);
      }
    }
  });

  it("iPad 横屏单工作区（约 1160px 网格）用 6 列；两格宽模块的系统预设不选会空出整列的奇数列数", () => {
    for (const [id, documents] of presets) {
      expect(autoColumnsFor(documents, 1160), id).toBe(6);
      for (const width of [450, 600, 800, 1000, 1200, 1500]) {
        const columns = autoColumnsFor(documents, width);
        expect(columns, `${id} ${String(width)}`).toBeLessThanOrEqual(columnLimitFor(width));
        const quality = geometryQuality(geometryAt(documents, columns));
        // 没有被包围的空洞；列底空白最多一两格（不会空出整列）。
        expect(quality.holes, `${id} ${String(width)}`).toBe(0);
        expect(quality.tail, `${id} ${String(width)}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it("首帧还没测出宽度时沿用基础列数（最多 2 列）", () => {
    expect(autoColumnsFor(defaultWorkbench(), 0)).toBe(2);
  });

  it("组合卡片的尺寸推荐用同一条轨道（行高随格宽变化）", () => {
    expect(gridMetricsFor(327, 2, 375)?.rowHeight).toBe(116);
    expect(gridMetricsFor(900, 4, 1180)).toMatchObject({ columns: 4, rowHeight: 125 });
    expect(gridMetricsFor(0, 2, 375)).toBeNull();
  });
});

describe("「较宽松」提示：按实际形状与空白判断，不是按列数", () => {
  const documents = defaultWorkbench();

  it("手机两列、iPad 自动列数：不提示", () => {
    expect(layoutLooksSparse(geometryAt(documents, 2), gridTrack(327, 2))).toBe(false);
    expect(layoutLooksSparse(geometryAt(documents, 6), gridTrack(1160, 6))).toBe(false);
  });

  it("很宽的工作区手动选两列：每格近 600px，卡片显得空旷 → 提示", () => {
    expect(layoutLooksSparse(geometryAt(documents, 2), gridTrack(1160, 2))).toBe(true);
    // iPad 竖屏自动选的两列（每格约 264px）不提示。
    expect(layoutLooksSparse(geometryAt(documents, 2), gridTrack(540, 2))).toBe(false);
  });

  it("2×1 卡片被拉成很扁的长条 → 提示", () => {
    const strip: LayoutGeometry = { baseCols: 4, objects: [{ objectId: "n", objectType: "analysis-card", anchor: 1, colSpan: 4, rowSpan: 1 }] };
    expect(layoutLooksSparse(strip, gridTrack(900, 4))).toBe(true);
  });

  it("三列里全是两格宽的模块、右边整列空着 → 提示", () => {
    expect(layoutLooksSparse(geometryAt(documents, 3), gridTrack(560, 3))).toBe(true);
  });
});

describe("列数偏好：本机、主 / 辅工作区各一份，只是显示偏好", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    };
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("默认自动；手动值按工作区分开记", () => {
    expect(readColumnPreference("primary")).toBe("auto");
    writeColumnPreference("secondary", 3);
    expect(readColumnPreference("secondary")).toBe(3);
    expect(readColumnPreference("primary")).toBe("auto");
    writeColumnPreference("secondary", "auto");
    expect(localStorage.getItem(columnPreferenceKey("secondary"))).toBeNull();
  });

  it("存储里的异常值按自动处理；键在 `libevra.` 前缀下（清除本机数据会一并清掉）", () => {
    localStorage.setItem(columnPreferenceKey("primary"), "12");
    expect(readColumnPreference("primary")).toBe("auto");
    localStorage.setItem(columnPreferenceKey("primary"), "abc");
    expect(readColumnPreference("primary")).toBe("auto");
    expect(columnPreferenceKey("primary").startsWith("libevra.")).toBe(true);
  });

  it("手动列数超过当前宽度的上限时按上限显示，不改存储的偏好", () => {
    expect(effectiveColumns(6, 4, 3)).toBe(3);
    expect(effectiveColumns(2, 6, 8)).toBe(2);
    expect(effectiveColumns("auto", 5, 8)).toBe(5);
  });
});
