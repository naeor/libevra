import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ConsentStatus } from "./consent.js";
import { readRememberedConsent, rememberConsent, rememberedMissing } from "./consent.js";
import { consentStatusKey, isAppDeviceStorageKey } from "./deviceStorageKeys.js";

/**
 * 1.19.81（所有者 2026-11-15：“不同意就不能正常的再去记账了……写得死一点，不要留下太明显的用户可以跳过的地方”）：
 * 门禁记下最近一次的同意状态——已知还有没同意的协议时，打开应用立即挡住、取回失败也不放行。
 */
class MemoryStorage {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
  get length(): number { return this.data.size; }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
}

const doc = { id: "terms", title: "用户协议", version: "2", summary: "摘要", accepted: false, contentHash: "h" };
const missing = { requiredDocuments: [doc], missingDocumentIds: ["terms"], majorAnnouncement: { id: "m", version: "1.19.0" } } as unknown as ConsentStatus;
const agreed = { requiredDocuments: [{ ...doc, accepted: true }], missingDocumentIds: [], majorAnnouncement: null } as unknown as ConsentStatus;

describe("记下的同意状态", () => {
  let previous: unknown;
  beforeEach(() => { previous = (globalThis as { localStorage?: unknown }).localStorage; (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage(); });
  afterEach(() => { (globalThis as { localStorage?: unknown }).localStorage = previous; });

  it("只存协议列表与缺哪几份，不存公告（不会因为缓存重播公告）", () => {
    rememberConsent("u1", missing);
    const back = readRememberedConsent("u1");
    expect(back?.missingDocumentIds).toEqual(["terms"]);
    expect(back?.requiredDocuments[0]?.id).toBe("terms");
    expect(back?.majorAnnouncement).toBeNull();
  });

  it("只有“已知还有没同意的”才用记下的状态挡住；全部已同意或从没取到过都不挡", () => {
    expect(rememberedMissing("u1")).toBeNull();
    rememberConsent("u1", missing);
    expect(rememberedMissing("u1")?.missingDocumentIds).toEqual(["terms"]);
    rememberConsent("u1", agreed);
    expect(rememberedMissing("u1")).toBeNull();
    expect(rememberedMissing("someone-else")).toBeNull();
  });

  it("存储里的坏数据当作没有记录", () => {
    globalThis.localStorage.setItem(consentStatusKey("u1"), "{not json");
    expect(readRememberedConsent("u1")).toBeNull();
  });

  it("键属于本应用（清除本机数据时一并清掉），并随账号清理", () => {
    expect(isAppDeviceStorageKey(consentStatusKey("u1"))).toBe(true);
    expect(readFileSync(new URL("./offline/localCleanup.ts", import.meta.url), "utf8")).toContain("consentStatusKey(accountId)");
  });
});

describe("同意门禁：不留可以跳过的地方（源码约束）", () => {
  const gate = readFileSync(new URL("../components/ConsentGate.tsx", import.meta.url), "utf8");
  it("打开应用时以记下的状态立即挡住；取回失败时已知未同意就继续挡住", () => {
    expect(gate).toContain("useState<ConsentStatus | null>(() => (userId === null ? null : rememberedMissing(userId)))");
    expect(gate).toMatch(/catch \{[\s\S]{0,200}setStatus\(remembered\);/);
  });
  it("去「账户数据」时先收起门禁再导航；离开状态只在这一次前往里有效（地址一变或 1.5 秒后清掉）", () => {
    expect(gate).toContain('flushSync(() => { setLeaving(true); });\n              void navigate("/settings/account-data");');
    expect(gate).toContain("useEffect(() => { setLeaving(false); }, [location.pathname]);");
    expect(gate).toContain("setTimeout(() => { setLeaving(false); }, 1500)");
  });
});
