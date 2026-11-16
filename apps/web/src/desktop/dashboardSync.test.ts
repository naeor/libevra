import { beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({ record: null as null | { version: number; schemaVersion: number; updatedAt: string; configuration: unknown }, posts: 0 }));

vi.mock("../lib/api.js", () => {
  class ApiRequestError extends Error {
    constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) { super(message); }
  }
  return {
    ApiRequestError,
    apiFetch: vi.fn(async (path: string, options?: { method?: string; body?: { baseVersion: number; configuration: unknown } }) => {
      if (path !== "/dashboard-config") throw new Error(`unexpected ${path}`);
      if (options?.method !== "POST") return { record: server.record === null ? null : structuredClone(server.record) };
      server.posts += 1;
      if ((server.record?.version ?? 0) !== options.body!.baseVersion) throw new ApiRequestError(409, "dashboard_config_conflict", "conflict", { record: server.record });
      server.record = { version: (server.record?.version ?? 0) + 1, schemaVersion: 1, updatedAt: new Date().toISOString(), configuration: structuredClone(options.body!.configuration) };
      return { record: structuredClone(server.record) };
    }),
  };
});

import { defaultDashboardDocuments, dashboardStorageKey, loadTemplates, readDashboard, saveDashboard, writeDashboardSettings, DEFAULT_DASHBOARD_SETTINGS, addTemplate } from "./dashboardStore.js";
import { DashboardSync, localDashboardConfiguration } from "./dashboardSync.js";

class MemoryStorage {
  private readonly map = new Map<string, string>();
  get length(): number { return this.map.size; }
  key(index: number): string | null { return [...this.map.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  setItem(key: string, value: string): void { this.map.set(key, value); }
  removeItem(key: string): void { this.map.delete(key); }
  clear(): void { this.map.clear(); }
}

const owner = "user:u1";
const entry = { kind: "expense" as const, amountCents: 2500, currency: "CNY" as const, categoryId: "c1", paymentMethodId: null, note: "午饭", tags: [] };

beforeEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
  server.record = null;
  server.posts = 0;
});

describe("1.19.104 总览同步", () => {
  it("本机什么都没改过、云端也没有：不提交", async () => {
    const sync = new DashboardSync(owner);
    expect(localDashboardConfiguration(owner)).toBeNull();
    await sync.run();
    expect(server.posts).toBe(0);
    expect(sync.getSnapshot().status).toBe("synced");
  });

  it("本机改过 → 第一次同步提交；之后没改就不再提交", async () => {
    saveDashboard(owner, defaultDashboardDocuments(["a"]), 0, ["a"]);
    writeDashboardSettings(owner, { ...DEFAULT_DASHBOARD_SETTINGS, combined: true });
    addTemplate(owner, "a", entry as never, "午饭");
    const sync = new DashboardSync(owner);
    await sync.run();
    expect(server.posts).toBe(1);
    expect(server.record?.version).toBe(1);
    await sync.run();
    expect(server.posts).toBe(1);
  });

  it("另一台设备改了、这台没改 → 装到本机（布局、口径、常用账目）", async () => {
    saveDashboard(owner, defaultDashboardDocuments(["a"]), 0, ["a"]);
    const sync = new DashboardSync(owner);
    await sync.run();
    // 另一台设备：两本账的布局 + 一条常用账目。
    const other = structuredClone(server.record!.configuration) as { pages: { documents: unknown }[]; templates: unknown[]; settings: unknown };
    other.pages[0]!.documents = defaultDashboardDocuments(["a", "b"]);
    other.templates = [{ id: "tpl-x", bookId: "a", name: "早饭", kind: "expense", amountCents: 800, currency: "CNY", categoryId: null, paymentMethodId: null, note: "", tagIds: [] }];
    other.settings = { ...DEFAULT_DASHBOARD_SETTINGS, combined: true };
    server.record = { ...server.record!, version: 2, configuration: other };
    await sync.run();
    expect(loadTemplates(owner).map((item) => item.name)).toEqual(["早饭"]);
    expect(readDashboard(owner, ["a", "b"]).documents.content.cards.length).toBe(defaultDashboardDocuments(["a", "b"]).content.cards.length);
    expect(sync.getSnapshot().status).toBe("synced");
  });

  it("两边都改了 → 采用云端并备份本机；「恢复这台设备的版本」装回并提交", async () => {
    saveDashboard(owner, defaultDashboardDocuments(["a"]), 0, ["a"]);
    const sync = new DashboardSync(owner);
    await sync.run();
    const cloud = structuredClone(server.record!.configuration) as { templates: unknown[] };
    cloud.templates = [{ id: "tpl-cloud", bookId: "a", name: "云端", kind: "expense", amountCents: 100, currency: "CNY", categoryId: null, paymentMethodId: null, note: "", tagIds: [] }];
    server.record = { ...server.record!, version: 2, configuration: cloud };
    addTemplate(owner, "a", entry as never, "本机");
    await sync.run();
    expect(sync.getSnapshot().status).toBe("conflict");
    expect(sync.hasBackup()).toBe(true);
    expect(loadTemplates(owner).map((item) => item.name)).toEqual(["云端"]);
    expect(await sync.restoreBackup()).toBe(true);
    expect(loadTemplates(owner).map((item) => item.name)).toEqual(["本机"]);
    expect(server.record?.version).toBe(3);
    expect(sync.hasBackup()).toBe(false);
  });

  it("编辑总览时不同步", async () => {
    saveDashboard(owner, defaultDashboardDocuments(["a"]), 0, ["a"]);
    const sync = new DashboardSync(owner);
    sync.editing = true;
    await sync.run();
    expect(server.posts).toBe(0);
  });

  // 1.19.105：本机记录损坏时，不能把「空 pages」当成一次本机改动提交上去，
  // 否则云端被改成「跟随默认总览」，其它设备再同步就会把布局清空。
  it("本机记录损坏 → 判 invalid、不提交，云端保持原样", async () => {
    saveDashboard(owner, defaultDashboardDocuments(["a"]), 0, ["a"]);
    const sync = new DashboardSync(owner);
    await sync.run();
    expect(server.posts).toBe(1);
    const before = structuredClone(server.record!.configuration);

    (globalThis as { localStorage: { setItem(key: string, value: string): void } }).localStorage.setItem(
      dashboardStorageKey(owner),
      JSON.stringify({ v: 2, owner, version: 1, pages: "broken" }),
    );
    await sync.run();

    expect(server.posts).toBe(1);
    expect(sync.getSnapshot().status).toBe("invalid");
    expect(server.record!.configuration).toEqual(before);
  });
});
