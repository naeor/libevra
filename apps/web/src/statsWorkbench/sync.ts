import { configurationFingerprint, parseWorkspaceConfiguration, type WorkspaceConfiguration, type WorkspaceRemote } from "@libellum/shared/workbench/configuration";
import { ApiRequestError, apiFetch } from "../lib/api.js";
import { loadPresets, presetStorageKey } from "./presets.js";
import { loadWorkbench, workbenchStorageKey } from "./storage.js";
import { WORKBENCH_INSTALLED } from "./configEvents.js";

export type SyncStatus = "local" | "pending" | "syncing" | "synced" | "failed" | "conflict" | "newer" | "invalid";
export interface SyncSnapshot { readonly status: SyncStatus; readonly remote?: WorkspaceRemote }
interface SyncMeta { readonly v: 1; readonly version: number; readonly base: WorkspaceConfiguration }
export const syncStorageKey = (scope: string) => `libevra.stats-workbench-sync:v1:${scope}`;
const empty = (): WorkspaceConfiguration => ({ schemaVersion: 1, workspace: null, presets: [] });

/** 只读有效本机配置；损坏 / 新版本预设不能被“只同步有效条目”静默删除。 */
export function localConfiguration(scope: string): WorkspaceConfiguration {
  const workspace = loadWorkbench(scope);
  const presets = loadPresets(scope);
  if (workspace.status === "unreadable" || presets.locked || presets.unreadable.length) throw new Error("local-invalid");
  return parseWorkspaceConfiguration({ schemaVersion: 1, workspace: workspace.status === "ok" ? workspace.documents : null, presets: presets.presets });
}
export interface SyncTransport {
  read(): Promise<WorkspaceRemote | null>;
  write(baseVersion: number, configuration: WorkspaceConfiguration): Promise<WorkspaceRemote>;
}
const transportFor = (scope: string): SyncTransport => ({
  async read() { return (await apiFetch<{ record: WorkspaceRemote | null }>("/workbench", { query: { accountScope: scope } })).record; },
  async write(baseVersion, configuration) {
    return (await apiFetch<{ record: WorkspaceRemote }>("/workbench", { method: "POST", body: { baseVersion, configuration, accountScope: scope } })).record;
  },
});

/** 整份配置 CAS；删除预设同样受版本保护，不自动合并 / 复活旧列表。 */
export class WorkspaceSync {
  private snapshot: SyncSnapshot = { status: "pending" };
  private listeners = new Set<() => void>();
  private busy = false;
  private again = false;
  private active = true;
  private generation = 0;
  editing = false;
  activate() { this.active = true; }
  constructor(readonly scope: string, private readonly store: Storage, private readonly remote: SyncTransport = transportFor(scope)) {}
  subscribe = (callback: () => void) => { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; };
  getSnapshot = () => this.snapshot;
  private publish(snapshot: SyncSnapshot) { if (this.active) { this.snapshot = snapshot; this.listeners.forEach(fn => fn()); } }
  dispose() { this.active = false; this.generation++; this.listeners.clear(); }
  changed() {
    if (["conflict", "newer", "invalid"].includes(this.snapshot.status)) return;
    this.publish({ status: "pending" });
    if (this.busy) this.again = true;
  }
  private readMeta(): SyncMeta | null {
    const raw = this.store.getItem(syncStorageKey(this.scope));
    if (!raw) return null;
    const meta = JSON.parse(raw) as SyncMeta;
    if (meta.v !== 1 || !Number.isSafeInteger(meta.version) || meta.version < 0) throw Error("metadata");
    return { v: 1, version: meta.version, base: parseWorkspaceConfiguration(meta.base) };
  }
  private acknowledge(version: number, base: WorkspaceConfiguration) {
    this.store.setItem(syncStorageKey(this.scope), JSON.stringify({ v: 1, version, base }));
    // 保留旧记录字段的含义；只确认同一份工作台，不能把请求期间的新保存误标已同步。
    const saved = loadWorkbench(this.scope);
    if (base.workspace && saved.status === "ok" && configurationFingerprint({ schemaVersion: 1, workspace: saved.documents, presets: [] }) === configurationFingerprint({ schemaVersion: 1, workspace: base.workspace, presets: [] })) {
      const key = workbenchStorageKey(this.scope);
      const raw = this.store.getItem(key);
      if (raw) {
        const record = JSON.parse(raw) as { pendingSync: boolean };
        if (record.pendingSync) { record.pendingSync = false; this.store.setItem(key, JSON.stringify(record)); }
      }
    }
  }
  /** 两个旧存储键的安装有恢复日志；写入失败回滚，崩溃后下次运行回滚。 */
  private recover() {
    const key = `${syncStorageKey(this.scope)}:journal`;
    const raw = this.store.getItem(key);
    if (!raw) return;
    const journal = JSON.parse(raw) as { before: readonly [string, string | null][] };
    const allowed = new Set([workbenchStorageKey(this.scope), presetStorageKey(this.scope), syncStorageKey(this.scope)]);
    for (const [k, value] of journal.before) {
      if (!allowed.has(k)) throw Error("journal");
      if (value === null) this.store.removeItem(k); else this.store.setItem(k, value);
    }
    this.store.removeItem(key);
  }
  private install(configuration: WorkspaceConfiguration, version: number) {
    const wk = workbenchStorageKey(this.scope), pk = presetStorageKey(this.scope), sk = syncStorageKey(this.scope);
    const before = [wk, pk, sk].map(k => [k, this.store.getItem(k)] as const);
    // 显式恢复前先保留两份原文（包括损坏内容），备份失败就不覆盖。
    this.store.setItem(`${sk}:recovery`, JSON.stringify({ before, savedAt: new Date().toISOString() }));
    this.store.setItem(`${sk}:journal`, JSON.stringify({ before }));
    try {
      if (configuration.workspace) {
        const old = loadWorkbench(this.scope);
        const localVersion = (old.status === "ok" ? old.version : 0) + 1;
        this.store.setItem(wk, JSON.stringify({ storeSchemaVersion: 1, userId: this.scope, content: { version: localVersion, document: configuration.workspace.content }, layout: { version: localVersion, document: configuration.workspace.layout }, updatedAt: new Date().toISOString(), pendingSync: false }));
      } else this.store.removeItem(wk);
      this.store.setItem(pk, JSON.stringify({ v: 1, userId: this.scope, items: configuration.presets }));
      this.acknowledge(version, configuration);
      this.store.removeItem(`${sk}:journal`);
    } catch (error) { this.recover(); throw error; }
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(WORKBENCH_INSTALLED, { detail: this.scope }));
  }
  async run(): Promise<void> {
    if (!this.active || ["conflict", "newer", "invalid"].includes(this.snapshot.status)) return;
    if (this.busy) { this.again = true; return; }
    this.busy = true;
    const generation = this.generation;
    this.publish({ status: "syncing" });
    try {
      this.recover();
      const remote = await this.remote.read();
      if (!this.active || generation !== this.generation) return;
      if (remote && remote.schemaVersion !== 1) { this.publish({ status: "newer", remote }); return; }
      let server: WorkspaceConfiguration;
      try { server = remote ? parseWorkspaceConfiguration(remote.configuration) : empty(); }
      catch { this.publish({ status: "newer", ...(remote ? { remote } : {}) }); return; }
      let local: WorkspaceConfiguration, meta: SyncMeta | null;
      try { local = localConfiguration(this.scope); meta = this.readMeta(); }
      catch { this.publish({ status: "invalid", ...(remote ? { remote } : {}) }); return; }
      const current = configurationFingerprint(local), cloud = configurationFingerprint(server);
      const base = meta ? configurationFingerprint(meta.base) : configurationFingerprint(empty());
      if (current === cloud) this.acknowledge(remote?.version ?? 0, server);
      else if (current === base) {
        if (this.editing) { this.publish({ status: "pending" }); return; }
        this.install(server, remote?.version ?? 0);
      }
      else if ((meta?.version ?? 0) !== (remote?.version ?? 0) || (!meta && remote)) {
        this.publish({ status: "conflict", ...(remote ? { remote } : {}) }); return;
      } else {
        const saved = await this.remote.write(remote?.version ?? 0, local);
        if (!this.active || generation !== this.generation) return;
        this.acknowledge(saved.version, local);
        // 网络请求中产生的新本机编辑不能被“已同步”误报或被服务端响应覆盖。
        if (configurationFingerprint(localConfiguration(this.scope)) !== current) { this.again = true; this.publish({ status: "pending" }); return; }
      }
      this.publish({ status: "synced" });
    } catch (error) {
      if (!this.active || generation !== this.generation) return;
      if (error instanceof ApiRequestError && error.status === 409) {
        const details = error.details as { record?: WorkspaceRemote } | undefined;
        this.publish({ status: error.code === "workbench_newer" ? "newer" : "conflict", ...(details?.record ? { remote: details.record } : {}) });
      } else this.publish({ status: "failed" });
    } finally {
      this.busy = false;
      if (this.again && this.active) { this.again = false; void this.run(); }
    }
  }
  /** 选择前重新读取云端；云端再次改变就继续保留冲突，不强制覆盖。 */
  async resolve(choice: "cloud" | "local"): Promise<void> {
    if (!this.active || this.busy || this.editing || !["conflict", "invalid"].includes(this.snapshot.status)) return;
    const expected = this.snapshot.remote?.version ?? 0;
    this.busy = true;
    const generation = this.generation;
    try {
      const remote = await this.remote.read();
      if (!this.active || generation !== this.generation) return;
      if (remote && remote.schemaVersion !== 1) { this.publish({ status: "newer", remote }); return; }
      if ((remote?.version ?? 0) !== expected) { this.publish({ status: "conflict", ...(remote ? { remote } : {}) }); return; }
      const cloud = remote ? parseWorkspaceConfiguration(remote.configuration) : empty();
      if (choice === "cloud") this.install(cloud, expected);
      else {
        const local = localConfiguration(this.scope);
        this.store.setItem(`${syncStorageKey(this.scope)}:cloud-recovery`, JSON.stringify(remote));
        const saved = await this.remote.write(expected, local);
        if (!this.active || generation !== this.generation) return;
        this.acknowledge(saved.version, local);
        if (configurationFingerprint(localConfiguration(this.scope)) !== configurationFingerprint(local)) { this.publish({ status: "pending" }); return; }
      }
      this.publish({ status: "synced" });
    } catch (error) {
      if (generation !== this.generation) return;
      if (error instanceof ApiRequestError && error.status === 409) {
        const record = (error.details as { record?: WorkspaceRemote } | undefined)?.record;
        this.publish({ status: "conflict", ...(record ? { remote: record } : {}) });
      } else this.publish({ status: "failed" });
    }
    finally { this.busy = false; }
  }
}
