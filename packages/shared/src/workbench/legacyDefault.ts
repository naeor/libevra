/**
 * **旧版系统默认工作台「日常总览」**（1.17.x 至 1.17.22 的 `defaultWorkbench()`），冻结在这里，只用于**识别**。
 *
 * 1.17.23 起，没有保存过工作台的账号默认看到「新手」系统预设。保存过的工作台里，只有与这份文档**完全一致**
 * （对象 ID `default-*`、卡片、标题种类、排布全部相同）的才算「仍在用旧版系统默认」——它只可能来自旧版的
 * 「恢复默认工作台」再点「完成」。这样的工作台等价于「没有自定义」，迁移为 `workspace: null`（跟随系统默认）。
 * 任何一处不同（移动、改尺寸、换展示形式、加删卡片、改标题）都视为用户自己的布局，原样保留。
 *
 * ⚠️ **不要修改这份文档**：服务器的一次性迁移
 * `prisma/migrations/20261030120000_workbench_legacy_default_to_beginner` 里写着同一份 JSON，测试比对两者一致。
 */
import { configurationFingerprint, type WorkspaceConfiguration, type WorkspaceDocuments } from "./configuration.js";

const card = (objectId: string, analysisId: string, chartFamily: string) => ({
  objectId,
  type: "analysis-card" as const,
  analysis: { analysisId, params: {} },
  chart: { chartFamily },
  title: { kind: "preset" as const },
  rangePolicy: "inherit" as const,
});

const place = (objectId: string, objectType: "analysis-card" | "carousel", anchor: number, colSpan: number, rowSpan: number) => ({
  objectId,
  objectType,
  anchor,
  colSpan,
  rowSpan,
});

export const LEGACY_DEFAULT_WORKSPACE: WorkspaceDocuments = {
  content: {
    schemaVersion: 1,
    cards: [
      card("default-b01", "AN-B01", "number"),
      card("default-b02", "AN-B02", "number"),
      card("default-b03", "AN-B03", "number"),
      card("default-b06", "AN-B06", "number"),
      card("default-i11", "AN-I11", "flow-bars"),
      card("default-i01", "AN-I01", "donut"),
      card("default-b09", "AN-B09", "extreme"),
      card("default-b11", "AN-B11", "extreme"),
      card("default-b15", "AN-B15", "extreme"),
      card("default-a01", "AN-A01", "comparison"),
      card("default-i12", "AN-I12", "heatmap"),
    ],
    containers: [{ objectId: "default-extremes", type: "carousel", children: ["default-b09", "default-b11", "default-b15"] }],
  },
  layout: {
    schemaVersion: 1,
    layoutAlgorithmVersion: 1,
    mode: "unified",
    main: {
      baseCols: 2,
      objects: [
        place("default-b01", "analysis-card", 1, 1, 1),
        place("default-b02", "analysis-card", 2, 1, 1),
        place("default-b03", "analysis-card", 3, 1, 1),
        place("default-b06", "analysis-card", 4, 1, 1),
        place("default-i11", "analysis-card", 5, 2, 2),
        place("default-i01", "analysis-card", 9, 2, 3),
        place("default-extremes", "carousel", 15, 2, 1),
        place("default-a01", "analysis-card", 17, 2, 2),
        place("default-i12", "analysis-card", 21, 2, 3),
      ],
    },
  },
} as unknown as WorkspaceDocuments;

const fingerprintOf = (workspace: WorkspaceDocuments): string =>
  configurationFingerprint({ schemaVersion: 1, workspace, presets: [] });

const LEGACY_FINGERPRINT = fingerprintOf(LEGACY_DEFAULT_WORKSPACE);

/** 工作台文档是否与旧版系统默认「日常总览」完全一致（键顺序无关；任何内容差异都返回 `false`）。 */
export function isLegacyDefaultWorkspace(workspace: WorkspaceDocuments | null | undefined): boolean {
  if (workspace === null || workspace === undefined) return false;
  try {
    return fingerprintOf(workspace) === LEGACY_FINGERPRINT;
  } catch {
    return false;
  }
}

/** 把「仍是旧版系统默认」的工作台换成 `null`（跟随当前系统默认）；其它一律原样返回。预设列表不动。 */
export function withoutLegacyDefault(configuration: WorkspaceConfiguration): WorkspaceConfiguration {
  return isLegacyDefaultWorkspace(configuration.workspace) ? { ...configuration, workspace: null } : configuration;
}
