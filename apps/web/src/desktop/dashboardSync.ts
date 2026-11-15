/**
 * **电脑版总览的跨设备同步**（1.19.104，候选清单 E1）：登录账号把总览页面、口径与侧栏、我的预设、常用账目同步到
 * 服务器（`/api/v1/dashboard-config`）；这台设备的金额遮罩、停在哪一页、列数偏好不同步。游客不同步（游客数据只在本机）。
 *
 * 规则（与分析工作台的同步同一套版本保护）：
 * - 记下上次同步时的云端版本与内容指纹。只有本机改了 → 提交（带版本，别处先改了就 409）；只有云端改了 → 装到本机；
 *   都没改 → 什么都不做；两边内容相同 → 只更新记号。
 * - **两边都改了**：采用云端（另一台设备后保存的），这台设备的版本先备份；总览上出现提示，可以一键「恢复这台设备的版本」
 *   （装回本机并提交，成为云端的新版本）。布局与常用账目都不会无声丢失。
 * - 编辑总览时不装云端的配置（`editing`），退出编辑后再同步一次。
 */
import { dashboardFingerprint, parseDashboardConfiguration, type DashboardConfiguration, type DashboardRemote } from "@libellum/shared/dashboard/configuration";

import { apiFetch, ApiRequestError } from "../lib/api.js";
import { LIBEVRA_KEY_PREFIX } from "../lib/deviceStorageKeys.js";
import type { SurfaceSync } from "../statsWorkbench/surface.js";
import {
  DASHBOARD_INSTALLED,
  DASHBOARD_RECORD_VERSION,
  DASHBOARD_SETTINGS_CHANGED,
  DASHBOARD_TEMPLATES_CHANGED,
  dashboardPresetsKey,
  dashboardSettingsKey,
  dashboardStorageKey,
  dashboardTemplatesKey,
  loadDashboardPresets,
  loadDashboardRecord,
  loadTemplates,
  readDashboardSettings,
  type DashboardRecord,
} from "./dashboardStore.js";

export type DashboardSyncStatus = "idle" | "syncing" | "synced" | "failed" | "conflict" | "invalid" | "newer";
export interface DashboardSyncSnapshot { readonly status: DashboardSyncStatus }

interface SyncMeta { readonly v: 1; readonly baseVersion: number; readonly baseFingerprint: string }

export function dashboardSyncKey(owner: string): string {
  return `${LIBEVRA_KEY_PREFIX}desktop.dashboard-sync:v1:${owner}`;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** 本机的总览配置（整理成与服务器相同的形状）；`null` = 本机什么都没有（从没改过任何总览设置）。 */
export function localDashboardConfiguration(owner: string): DashboardConfiguration | null {
  const store = storage();
  if (store === null) return null;
  const record = loadDashboardRecord(owner);
  const hasSettings = store.getItem(dashboardSettingsKey(owner)) !== null;
  const presets = loadDashboardPresets(owner);
  const templates = loadTemplates(owner);
  if (record.status === "missing" && !hasSettings && presets.length === 0 && templates.length === 0) return null;
  const pages = record.status === "ok" ? record.record.pages.map((page) => ({ id: page.id, name: page.name, ...(page.kind === undefined ? {} : { kind: page.kind }), documents: page.documents })) : [];
  return {
    schemaVersion: 1,
    pages,
    knownBooks: record.status === "ok" ? [...record.record.knownBooks] : [],
    settings: hasSettings ? (readDashboardSettings(owner) as unknown as DashboardConfiguration["settings"]) : null,
    presets: presets.map((preset) => ({ ...preset })),
    templates: templates.map((template) => ({ ...template, tagIds: [...template.tagIds] })),
  };
}

const EMPTY: DashboardConfiguration = { schemaVersion: 1, pages: [], knownBooks: [], settings: null, presets: [], templates: [] };

/** 把一份配置装到本机（覆盖本机的总览记录、口径、预设、常用账目），并通知页面重读。 */
export function installDashboardConfiguration(owner: string, configuration: DashboardConfiguration): void {
  const store = storage();
  if (store === null) return;
  const key = dashboardStorageKey(owner);
  const previous = loadDashboardRecord(owner);
  const localVersion = previous.status === "ok" ? previous.record.version : previous.status === "unreadable" ? previous.version : 0;
  const old = store.getItem(key);
  if (old !== null) store.setItem(`${key}:previous`, old);
  if (configuration.pages.length === 0) store.removeItem(key);
  else {
    const record: DashboardRecord = {
      v: DASHBOARD_RECORD_VERSION,
      owner,
      // 版本只在本机前进：打开着的总览按新版本重读，别的窗口拿旧版本保存会被拒绝。
      version: localVersion + 1,
      pages: configuration.pages.map((page) => ({ ...page })),
      activePage: configuration.pages[0]!.id,
      knownBooks: [...configuration.knownBooks],
      updatedAt: new Date().toISOString(),
    };
    store.setItem(key, JSON.stringify(record));
  }
  if (configuration.settings === null) store.removeItem(dashboardSettingsKey(owner));
  else store.setItem(dashboardSettingsKey(owner), JSON.stringify(configuration.settings));
  store.setItem(dashboardPresetsKey(owner), JSON.stringify({ v: 1, items: configuration.presets }));
  store.setItem(dashboardTemplatesKey(owner), JSON.stringify({ v: 1, items: configuration.templates }));
  if (typeof window !== "undefined") {
    for (const name of [DASHBOARD_INSTALLED, DASHBOARD_SETTINGS_CHANGED, DASHBOARD_TEMPLATES_CHANGED]) window.dispatchEvent(new CustomEvent(name, { detail: owner }));
  }
}

export class DashboardSync implements SurfaceSync {
  editing = false;
  private running = false;
  private again = false;
  private snapshotValue: DashboardSyncSnapshot = { status: "idle" };
  private readonly listeners = new Set<() => void>();

  constructor(readonly owner: string) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): DashboardSyncSnapshot => this.snapshotValue;

  private set(status: DashboardSyncStatus): void {
    if (this.snapshotValue.status === status) return;
    this.snapshotValue = { status };
    for (const listener of this.listeners) listener();
  }

  private readMeta(): SyncMeta | null {
    try {
      const raw = storage()?.getItem(dashboardSyncKey(this.owner));
      const value = raw ? (JSON.parse(raw) as SyncMeta) : null;
      return value?.v === 1 && Number.isSafeInteger(value.baseVersion) && typeof value.baseFingerprint === "string" ? value : null;
    } catch {
      return null;
    }
  }

  private writeMeta(baseVersion: number, configuration: DashboardConfiguration): void {
    try {
      storage()?.setItem(dashboardSyncKey(this.owner), JSON.stringify({ v: 1, baseVersion, baseFingerprint: dashboardFingerprint(configuration) } satisfies SyncMeta));
    } catch {
      // 记不下来就下次再比一次，不影响数据。
    }
  }

  private backupKey(): string {
    return `${dashboardSyncKey(this.owner)}:local-backup`;
  }

  /** 冲突时备份下来的这台设备的版本。 */
  hasBackup(): boolean {
    try {
      return storage()?.getItem(this.backupKey()) !== null && storage()?.getItem(this.backupKey()) !== undefined;
    } catch {
      return false;
    }
  }

  private async push(configuration: DashboardConfiguration, baseVersion: number): Promise<"ok" | "conflict" | "failed"> {
    try {
      const saved = await apiFetch<{ record: DashboardRemote }>("/dashboard-config", { method: "POST", body: { baseVersion, configuration } });
      this.writeMeta(saved.record.version, configuration);
      return "ok";
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) return "conflict";
      return "failed";
    }
  }

  async run(): Promise<void> {
    if (this.editing) return;
    if (this.running) { this.again = true; return; }
    this.running = true;
    this.set("syncing");
    try {
      const remote = (await apiFetch<{ record: DashboardRemote | null }>("/dashboard-config")).record;
      if (remote !== null && remote.schemaVersion > 1) { this.set("newer"); return; }
      if (this.editing) return;
      let local = localDashboardConfiguration(this.owner);
      // 本机的配置先按服务器的规则检查一遍：不合格的不提交（本机照常用）。
      if (local !== null) {
        try { local = parseDashboardConfiguration(JSON.parse(JSON.stringify(local))); } catch { this.set("invalid"); return; }
      }
      const meta = this.readMeta();
      const remoteConfig = remote?.configuration ?? null;
      const localPrint = dashboardFingerprint(local ?? EMPTY);
      const remotePrint = dashboardFingerprint(remoteConfig ?? EMPTY);
      if (localPrint === remotePrint) {
        this.writeMeta(remote?.version ?? 0, local ?? EMPTY);
        this.set("synced");
        return;
      }
      const localChanged = meta === null ? local !== null : localPrint !== meta.baseFingerprint;
      const remoteChanged = meta === null ? remote !== null : (remote?.version ?? 0) !== meta.baseVersion;
      if (remoteChanged && !localChanged && remoteConfig !== null) {
        installDashboardConfiguration(this.owner, remoteConfig);
        this.writeMeta(remote!.version, remoteConfig);
        this.set("synced");
        return;
      }
      if (localChanged && !remoteChanged) {
        const result = await this.push(local ?? EMPTY, remote?.version ?? 0);
        if (result === "conflict") this.again = true;
        this.set(result === "ok" ? "synced" : result === "conflict" ? "syncing" : "failed");
        return;
      }
      // 两边都改了：采用云端，备份这台设备的版本，等用户决定要不要恢复。
      if (remoteConfig !== null) {
        if (local !== null) storage()?.setItem(this.backupKey(), JSON.stringify(local));
        installDashboardConfiguration(this.owner, remoteConfig);
        this.writeMeta(remote!.version, remoteConfig);
        this.set("conflict");
        return;
      }
      // 云端被清空（例如在另一台设备注销重建前），本机有：按本机提交。
      const result = await this.push(local ?? EMPTY, remote?.version ?? 0);
      this.set(result === "ok" ? "synced" : "failed");
    } catch {
      this.set("failed");
    } finally {
      this.running = false;
      if (this.again) { this.again = false; void this.run(); }
    }
  }

  /** 「恢复这台设备的版本」：把冲突时备份的配置装回本机并提交。 */
  async restoreBackup(): Promise<boolean> {
    const store = storage();
    const raw = store?.getItem(this.backupKey()) ?? null;
    if (store === null || raw === null) return false;
    let backup: DashboardConfiguration;
    try { backup = parseDashboardConfiguration(JSON.parse(raw)); } catch { return false; }
    installDashboardConfiguration(this.owner, backup);
    const meta = this.readMeta();
    const result = await this.push(backup, meta?.baseVersion ?? 0);
    if (result !== "ok") { this.set(result === "conflict" ? "conflict" : "failed"); return false; }
    store.removeItem(this.backupKey());
    this.set("synced");
    return true;
  }

  dismissConflict(): void {
    try { storage()?.removeItem(this.backupKey()); } catch { /* 只是不再提示。 */ }
    this.set("synced");
  }
}
