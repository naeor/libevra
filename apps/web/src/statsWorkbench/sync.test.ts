import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseWorkspaceConfiguration, parseWorkspaceDocuments, configurationFingerprint, type WorkspaceConfiguration, type WorkspaceRemote } from "@libellum/shared/workbench/configuration";
import { WorkspaceSync, localConfiguration, syncStorageKey, type SyncTransport } from "./sync.js";
import { defaultWorkbench, legacyDefaultWorkbench } from "./defaults.js";
import { buildSystemPreset, createPreset, deletePreset, loadPresets, presetStorageKey, reidentify } from "./presets.js";
import { loadWorkbench, saveWorkbench, workbenchStorageKey } from "./storage.js";
import { ApiRequestError } from "../lib/api.js";
import { exportWorkspaceFile, parseWorkspaceFile } from "./exchange.js";

class MemoryStorage implements Storage {
  private items = new Map<string, string>();
  get length() { return this.items.size; }
  clear() { this.items.clear(); }
  getItem(key: string) { return this.items.get(key) ?? null; }
  key(index: number) { return [...this.items.keys()][index] ?? null; }
  removeItem(key: string) { this.items.delete(key); }
  setItem(key: string, value: string) { this.items.set(key, value); }
}
let store: MemoryStorage;
const scope = "user:w6-test";
let cloud: WorkspaceRemote | null;
let writes: number;
const remote: SyncTransport = {
  async read() { return structuredClone(cloud); },
  async write(baseVersion, configuration) {
    if (baseVersion !== (cloud?.version ?? 0)) throw new ApiRequestError(409, "workbench_conflict", "conflict", { record: cloud });
    writes++;
    cloud = { version: baseVersion + 1, schemaVersion: 1, updatedAt: new Date().toISOString(), configuration: structuredClone(configuration) };
    return structuredClone(cloud);
  },
};
const engine = () => new WorkspaceSync(scope, store, remote);
const configuration = (workspace = defaultWorkbench()): WorkspaceConfiguration => ({ schemaVersion: 1, workspace, presets: [] });
beforeEach(() => { store = new MemoryStorage(); cloud = null; writes = 0; vi.stubGlobal("localStorage", store); });
afterEach(() => vi.unstubAllGlobals());

describe("W6 配置验证与文件交换", () => {
  it("已有默认、三套系统预设和组合 / 抽屉完整往返", () => {
    for (const documents of [defaultWorkbench(), ...(["beginner", "advanced", "professional"] as const).map(id => buildSystemPreset(id, key => key.slice(-12)))]) {
      expect(parseWorkspaceDocuments(documents)).toEqual(documents);
      const text = exportWorkspaceFile("workspace", [{ name: "test", description: "", documents, filters: "range=30d" }]);
      const result = parseWorkspaceFile(text);
      expect(result[0]?.error).toBeUndefined();
      expect(result[0]?.entry?.documents).toEqual(documents);
    }
  });
  it("拒绝非法字段、重复对象、恶意嵌套与未来版本", () => {
    const docs = defaultWorkbench();
    expect(() => parseWorkspaceDocuments({ ...docs, transactions: [] })).toThrow();
    expect(() => parseWorkspaceConfiguration({ ...configuration(), password: "secret" })).toThrow();
    expect(() => parseWorkspaceDocuments({ ...docs, content: { ...docs.content, cards: [...docs.content.cards, docs.content.cards[0]] } })).toThrow();
    expect(() => parseWorkspaceDocuments({ ...docs, content: { ...docs.content, schemaVersion: 999 } })).toThrow();
    let nested: unknown = {}; for (let i = 0; i < 30; i++) nested = { nested };
    expect(() => parseWorkspaceConfiguration(nested)).toThrow();
    expect(() => parseWorkspaceConfiguration(JSON.parse('{"__proto__":{"polluted":true}}'))).toThrow();
  });
  it("文件集合逐项报告错误，不丢掉其它有效项；UUID 维度引用不导出", () => {
    const file = JSON.parse(exportWorkspaceFile("presets", [{ name: "one", description: "", documents: defaultWorkbench(), filters: "category=private-id&currency=CNY&range=30d" }]));
    expect(file.entries[0].filters).not.toContain("private-id");
    file.entries.push({ ...file.entries[0], name: "broken", documents: {} });
    const entries = parseWorkspaceFile(JSON.stringify(file));
    expect(entries[0]?.entry).toBeDefined(); expect(entries[1]?.error).toBeDefined();
    file.formatVersion = 99; expect(() => parseWorkspaceFile(JSON.stringify(file))).toThrow();
    expect(() => parseWorkspaceFile("bad")).toThrow();
    expect(() => parseWorkspaceFile("x".repeat(2097153))).toThrow();
  });
  it("导入换 ID 同时覆盖主布局、独立档案、上一个布局和容器引用", () => {
    const documents = defaultWorkbench();
    const withProfiles = { ...documents, layout: { ...documents.layout, mode: "independent" as const, profiles: [{ profileKey: "cols-2", geometry: structuredClone(documents.layout.main) }], previousMain: structuredClone(documents.layout.main) } };
    const next = reidentify(withProfiles);
    expect(parseWorkspaceDocuments(next)).toEqual(next);
    expect(next.layout.main.objects.map(o => o.objectId)).toEqual(next.layout.profiles?.[0]?.geometry.objects.map(o => o.objectId));
    expect(next.layout.main.objects.map(o => o.objectId)).toEqual(next.layout.previousMain?.objects.map(o => o.objectId));
    expect(next.content.containers[0]?.children.every(id => next.content.cards.some(c => c.objectId === id))).toBe(true);
    expect(next.content.cards.some(card => documents.content.cards.some(old => old.objectId === card.objectId))).toBe(false);
  });
});
describe("W6 本地优先同步状态机", () => {
  it("首次已有本机配置、云端空：上传；空本机、云端有：下载", async () => {
    saveWorkbench(scope, defaultWorkbench(), 0);
    const first = engine(); await first.run();
    expect(first.getSnapshot().status).toBe("synced"); expect(writes).toBe(1);
    store.clear(); const second = engine(); await second.run();
    expect(second.getSnapshot().status).toBe("synced");
    expect(loadWorkbench(scope).status).toBe("ok"); expect(writes).toBe(1);
  });
  it("首次两边不同：不覆盖，采用云端前备份本机原文", async () => {
    const docs = defaultWorkbench(); saveWorkbench(scope, docs, 0);
    cloud = { version: 1, schemaVersion: 1, updatedAt: new Date().toISOString(), configuration: { schemaVersion: 1, workspace: null, presets: [] } };
    const sync = engine(); await sync.run();
    expect(sync.getSnapshot().status).toBe("conflict"); expect(writes).toBe(0);
    const original = store.getItem(workbenchStorageKey(scope));
    await sync.resolve("cloud");
    expect(loadWorkbench(scope).status).toBe("missing");
    expect(store.getItem(`${syncStorageKey(scope)}:recovery`)).toContain(JSON.stringify(original).slice(1, -1));
  });
  it("离线保存失败保留本机，恢复网络后同步；删除预设不会被旧列表复活", async () => {
    const preset = createPreset(scope, { name: "月度复盘", description: "", documents: defaultWorkbench(), filters: null });
    expect(typeof preset).toBe("object");
    const sync = engine(); await sync.run();
    const savedCloud = structuredClone(cloud!);
    deletePreset(scope, (preset as { id: string }).id);
    const failed = new WorkspaceSync(scope, store, { ...remote, read: async () => { throw Error("offline"); } });
    await failed.run(); expect(failed.getSnapshot().status).toBe("failed");
    expect(loadPresets(scope).presets).toHaveLength(0);
    await sync.run(); expect(cloud!.configuration.presets).toHaveLength(0);
    // 第二台设备仍以旧版本为基准新增预设，不得自动覆盖服务器删除。
    store.setItem(presetStorageKey(scope), JSON.stringify({ v: 1, userId: scope, items: savedCloud.configuration.presets }));
    store.setItem(syncStorageKey(scope), JSON.stringify({ v: 1, version: savedCloud.version, base: savedCloud.configuration }));
    createPreset(scope, { name: "other", description: "", documents: defaultWorkbench(), filters: null });
    await sync.run(); expect(sync.getSnapshot().status).toBe("conflict");
    expect(cloud!.configuration.presets).toHaveLength(0);
  });
  it("损坏本机不能污染正常云端，较新云端只读", async () => {
    cloud = { version: 1, schemaVersion: 1, updatedAt: new Date().toISOString(), configuration: configuration() };
    store.setItem(workbenchStorageKey(scope), "broken");
    const sync = engine(); await sync.run(); expect(sync.getSnapshot().status).toBe("invalid"); expect(writes).toBe(0);
    store.clear(); cloud = { ...cloud, schemaVersion: 99 };
    const future = engine(); await future.run(); expect(future.getSnapshot().status).toBe("newer");
    await future.resolve("local"); expect(writes).toBe(0);
  });
  it("编辑草稿期间不安装云端配置；账号离开后忽略迟到响应", async () => {
    cloud = { version: 1, schemaVersion: 1, updatedAt: new Date().toISOString(), configuration: configuration() };
    const sync = engine(); sync.editing = true; await sync.run();
    expect(loadWorkbench(scope).status).toBe("missing");
    sync.editing = false; await sync.run(); expect(loadWorkbench(scope).status).toBe("ok");
    store.clear();
    let resolve!: (v: WorkspaceRemote | null) => void;
    const waiting = new WorkspaceSync(scope, store, { ...remote, read: () => new Promise(r => { resolve = r; }) });
    const running = waiting.run(); waiting.dispose(); resolve(cloud); await running;
    expect(loadWorkbench(scope).status).toBe("missing");
  });
  it("同步中的新本机修改保留，下一次写入使用新的基版本", async () => {
    saveWorkbench(scope, defaultWorkbench(), 0);
    let once = true;
    const sync = new WorkspaceSync(scope, store, { ...remote, write: async (base, config) => {
      const saved = await remote.write(base, config);
      if (once) { once = false; createPreset(scope, { name: "during request", description: "", documents: defaultWorkbench(), filters: null }); }
      return saved;
    } });
    await sync.run(); await vi.waitFor(() => expect(cloud!.configuration.presets).toHaveLength(1));
    expect(configurationFingerprint(localConfiguration(scope))).toBe(configurationFingerprint(cloud!.configuration));
  });
  it("服务器已写入但响应丢失，重试读取确认，不重复写入", async () => {
    saveWorkbench(scope, defaultWorkbench(), 0);
    const sync = new WorkspaceSync(scope, store, { ...remote, write: async (base, config) => { await remote.write(base, config); throw Error("response lost"); } });
    await sync.run(); expect(sync.getSnapshot().status).toBe("failed"); expect(writes).toBe(1);
    await sync.run(); expect(sync.getSnapshot().status).toBe("synced"); expect(writes).toBe(1);
  });
  it("安装时本机写入失败会回滚；崩溃恢复日志不能改写其他账号键", async () => {
    cloud = { version: 1, schemaVersion: 1, updatedAt: new Date().toISOString(), configuration: configuration() };
    const original = store.setItem.bind(store);
    let fail = true;
    vi.spyOn(store, "setItem").mockImplementation((key, value) => {
      if (fail && key === presetStorageKey(scope)) { fail = false; throw Error("quota"); }
      original(key, value);
    });
    const sync = engine(); await sync.run(); expect(sync.getSnapshot().status).toBe("failed");
    expect(loadWorkbench(scope).status).toBe("missing"); expect(store.getItem(syncStorageKey(scope))).toBeNull();
    const foreign = workbenchStorageKey("user:other"); original(foreign, "keep");
    original(`${syncStorageKey(scope)}:journal`, JSON.stringify({ before: [[foreign, "overwrite"]] }));
    await sync.run(); expect(store.getItem(foreign)).toBe("keep"); expect(sync.getSnapshot().status).toBe("failed");
  });
  it("退出后重新激活也不能接收上一轮迟到响应", async () => {
    cloud = { version: 1, schemaVersion: 1, updatedAt: new Date().toISOString(), configuration: configuration() };
    let resolve!: (v: WorkspaceRemote | null) => void;
    const sync = new WorkspaceSync(scope, store, { ...remote, read: () => new Promise(r => { resolve = r; }) });
    const running = sync.run(); sync.dispose(); sync.activate(); resolve(cloud); await running;
    expect(loadWorkbench(scope).status).toBe("missing");
  });
});

describe("1.17.23 旧版系统默认「日常总览」→ 跟随系统默认（新手布局）", () => {
  const legacy = () => legacyDefaultWorkbench();
  const remoteWith = (version: number, workspace: WorkspaceConfiguration["workspace"], presets: WorkspaceConfiguration["presets"] = []): WorkspaceRemote =>
    ({ version, schemaVersion: 1, updatedAt: new Date().toISOString(), configuration: { schemaVersion: 1, workspace, presets } });
  /** 本机已与云端同步的旧版默认：本机记录 + 同步基准都是旧版默认。 */
  function syncedLegacy(version: number): void {
    saveWorkbench(scope, legacy(), 0);
    store.setItem(syncStorageKey(scope), JSON.stringify({ v: 1, version, base: { schemaVersion: 1, workspace: legacy(), presets: [] } }));
  }

  it("服务器已迁移（null，版本 +1）、本机还是旧版默认：本机备份后移除，不冲突、不写云端", async () => {
    syncedLegacy(1);
    cloud = remoteWith(2, null);
    const sync = engine(); await sync.run();
    expect(sync.getSnapshot().status).toBe("synced");
    expect(writes).toBe(0);
    expect(loadWorkbench(scope).status).toBe("missing");
    expect(store.getItem(`${workbenchStorageKey(scope)}:legacy-default`)).not.toBeNull();
    expect((JSON.parse(store.getItem(syncStorageKey(scope))!) as { version: number }).version).toBe(2);
  });

  it("服务器还没迁移、两边都是旧版默认：本机显示新手布局，云端不被改写，也不会把旧版默认装回来", async () => {
    syncedLegacy(1);
    cloud = remoteWith(1, legacy());
    const sync = engine(); await sync.run(); await sync.run();
    expect(sync.getSnapshot().status).toBe("synced");
    expect(writes).toBe(0);
    expect(loadWorkbench(scope).status).toBe("missing");
  });

  it("新设备第一次登录、云端是旧版默认：不安装旧版默认；我的预设照常下载", async () => {
    const preset = { id: "p1", name: "月度复盘", description: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), documents: defaultWorkbench(), filters: null };
    cloud = remoteWith(3, legacy(), [preset]);
    const sync = engine(); await sync.run();
    expect(sync.getSnapshot().status).toBe("synced");
    expect(loadWorkbench(scope).status).toBe("missing");
    expect(loadPresets(scope).presets.map(p => p.name)).toEqual(["月度复盘"]);
    expect(writes).toBe(0);
  });

  it("本机是旧版默认、云端已被另一台设备改成自定义布局：直接安装云端，不误报冲突", async () => {
    syncedLegacy(1);
    const custom = buildSystemPreset("advanced", key => key.slice(-12));
    cloud = remoteWith(3, custom);
    const sync = engine(); await sync.run();
    expect(sync.getSnapshot().status).toBe("synced");
    const loaded = loadWorkbench(scope);
    expect(loaded.status === "ok" ? loaded.documents : null).toEqual(custom);
    expect(writes).toBe(0);
  });

  it("服务器迁移让版本 +1、本机有尚未同步的自定义：内容上云端没变，直接上传，不误报冲突", async () => {
    syncedLegacy(1);
    cloud = remoteWith(2, null);
    const custom = buildSystemPreset("advanced", key => key.slice(-12));
    saveWorkbench(scope, custom, 1);
    const sync = engine(); await sync.run();
    expect(sync.getSnapshot().status).toBe("synced");
    expect(writes).toBe(1);
    expect(cloud!.version).toBe(3);
    expect(cloud!.configuration.workspace).toEqual(custom);
  });

  it("本机备份写不进去、旧版默认没能移走：仍按「跟随系统默认」比较，不会反复写回云端", async () => {
    syncedLegacy(1);
    cloud = remoteWith(2, null);
    const original = store.setItem.bind(store);
    vi.spyOn(store, "setItem").mockImplementation((key, value) => {
      if (key.endsWith(":legacy-default")) throw Error("quota");
      original(key, value);
    });
    const sync = engine(); await sync.run(); await sync.run(); await sync.run();
    expect(sync.getSnapshot().status).toBe("synced");
    expect(writes).toBe(0);
    expect(cloud!.version).toBe(2);
  });

  it("基准是旧版默认、本机已改成自定义：照常上传自定义（用户布局优先）", async () => {
    syncedLegacy(1);
    cloud = remoteWith(1, legacy());
    const custom = buildSystemPreset("professional", key => key.slice(-12));
    saveWorkbench(scope, custom, 1);
    const sync = engine(); await sync.run();
    expect(sync.getSnapshot().status).toBe("synced");
    expect(writes).toBe(1);
    expect(cloud!.configuration.workspace).toEqual(custom);
  });
});
