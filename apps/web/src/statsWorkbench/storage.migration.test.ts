import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultWorkbench } from "./defaults.js";
import { clearWorkbench, loadWorkbench, readStored, saveWorkbench, saveWorkbenchSafely, workbenchStorageKey } from "./storage.js";

describe("正式持久化链：版本、损坏副本与标签页并发", () => {
  const values = new Map<string, string>();
  beforeEach(() => {
    values.clear();
    Object.assign(globalThis, { localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    } });
  });
  afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage; vi.unstubAllGlobals(); });

  it("v1 经D迁移链读回，过期标签页保存被拒且原文不变", () => {
    expect(saveWorkbench("user:a", defaultWorkbench(), 0)).toBe(1);
    const raw = values.get(workbenchStorageKey("user:a"));
    expect(loadWorkbench("user:a").status).toBe("ok");
    expect(saveWorkbench("user:a", defaultWorkbench(), 0)).toBeNull();
    expect(values.get(workbenchStorageKey("user:a"))).toBe(raw);
    expect(saveWorkbench("user:a", defaultWorkbench(), 1)).toBe(2);
    expect(values.get(`${workbenchStorageKey("user:a")}:previous`)).toBe(raw);
  });

  it("较新schema只读，不能保存覆盖或删除未知字段", () => {
    saveWorkbench("user:a", defaultWorkbench(), 0);
    const key = workbenchStorageKey("user:a");
    const record = JSON.parse(values.get(key) ?? "{}");
    record.layout.document.schemaVersion = 2;
    record.layout.document.future = { keep: true };
    const raw = JSON.stringify(record);
    values.set(key, raw);
    expect(loadWorkbench("user:a").status).toBe("unreadable");
    expect(saveWorkbench("user:a", defaultWorkbench(), 0)).toBeNull();
    expect(values.get(key)).toBe(raw);
  });

  it("一侧文档缺失时仍保护另一侧较新schema，不让损坏恢复绕过只读", () => {
    saveWorkbench("user:a", defaultWorkbench(), 0);
    const key = workbenchStorageKey("user:a");
    const record = JSON.parse(values.get(key) ?? "{}");
    delete record.content.document;
    record.layout.document.schemaVersion = 2;
    record.layout.document.future = { keep: true };
    const raw = JSON.stringify(record);
    values.set(key, raw);
    const fallback = readStored("user:a");
    expect(fallback.unreadable).toBe(true);
    expect(saveWorkbench("user:a", fallback.documents, fallback.version)).toBeNull();
    expect(values.get(key)).toBe(raw);
  });

  it("损坏原文在主动恢复保存前后均保留，清除只清自己的主副本", () => {
    const key = workbenchStorageKey("user:a");
    values.set(key, "{broken");
    expect(loadWorkbench("user:a").status).toBe("unreadable");
    expect(saveWorkbench("user:a", defaultWorkbench(), 0)).toBe(1);
    expect(values.get(`${key}:previous`)).toBe("{broken");
    expect(saveWorkbench("user:a", defaultWorkbench(), 1)).toBe(2);
    expect(values.get(`${key}:unreadable`)).toBe("{broken");
    saveWorkbench("user:b", defaultWorkbench(), 0);
    clearWorkbench("user:a");
    expect(values.has(key)).toBe(false);
    expect(values.has(`${key}:previous`)).toBe(false);
    expect(values.has(`${key}:unreadable`)).toBe(false);
    expect(loadWorkbench("user:b").status).toBe("ok");
  });

  it("非法版本号拒绝读取或保存，不产生版本回退", () => {
    expect(saveWorkbench("user:a", defaultWorkbench(), -1)).toBeNull();
    expect(saveWorkbench("user:a", defaultWorkbench(), Number.MAX_SAFE_INTEGER)).toBeNull();
    saveWorkbench("user:a", defaultWorkbench(), 0);
    const key = workbenchStorageKey("user:a");
    const record = JSON.parse(values.get(key) ?? "{}");
    record.content.version = -3;
    values.set(key, JSON.stringify(record));
    expect(loadWorkbench("user:a").status).toBe("unreadable");
  });

  it("合法JSON的损坏文档保留版本，允许主动恢复且原文不会被下一保存吞掉", () => {
    saveWorkbench("user:a", defaultWorkbench(), 0);
    const key = workbenchStorageKey("user:a");
    const record = JSON.parse(values.get(key) ?? "{}");
    record.content.document.cards = "broken";
    const raw = JSON.stringify(record);
    values.set(key, raw);
    const fallback = readStored("user:a");
    expect(fallback.unreadable).toBe(true);
    expect(fallback.version).toBe(1);
    expect(saveWorkbench("user:a", fallback.documents, fallback.version)).toBe(2);
    expect(saveWorkbench("user:a", fallback.documents, 2)).toBe(3);
    expect(values.get(`${key}:unreadable`)).toBe(raw);
  });

  it("Web Locks串行化两个同时保存，同一旧版本只允许一个胜方", async () => {
    let tail: Promise<unknown> = Promise.resolve();
    const keys: string[] = [];
    vi.stubGlobal("navigator", { locks: { request: (key: string, action: () => number | null) => {
      keys.push(key);
      const result = tail.then(action);
      tail = result;
      return result;
    } } });
    saveWorkbench("user:a", defaultWorkbench(), 0);
    const result = await Promise.all([
      saveWorkbenchSafely("user:a", defaultWorkbench(), 1),
      saveWorkbenchSafely("user:a", defaultWorkbench(), 1),
    ]);
    expect(result).toEqual([2, null]);
    expect(keys).toEqual([workbenchStorageKey("user:a"), workbenchStorageKey("user:a")]);
  });
});
