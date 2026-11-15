import { beforeEach, describe, expect, it, vi } from "vitest";

const guestStore = vi.hoisted(() => new Map<string, unknown>());
vi.mock("./storage.js", async () => {
  const actual = await vi.importActual<typeof import("./storage.js")>("./storage.js");
  return {
    ...actual,
    readGuestValue: vi.fn(async (key: string) => structuredClone(guestStore.get(key) ?? null)),
    writeGuestValue: vi.fn(async (key: string, value: unknown) => { guestStore.set(key, structuredClone(value)); return true; }),
  };
});
vi.mock("../offline/storage.js", () => ({
  readValue: vi.fn(async () => { throw new Error("游客不应读账号离线库"); }),
  writeValue: vi.fn(async () => { throw new Error("游客不应写账号离线库"); }),
}));

import { FX_MAX_FALLBACK_DAYS, FxError, FxHistoryService, type FxSnapshot } from "@libellum/shared";
import { clearOwnerPreferences, fxModeKey } from "../deviceStorageKeys.js";
import { fxOwnerId, readFxMode, saveFxMode } from "../fxView.js";
import { createGuestFxProvider, createGuestFxRepository, createGuestFxService, guestFxKey, GUEST_FX_PATH } from "./fx.js";

/** 测试环境是 node：用一个最小的内存 Storage 代替浏览器的 localStorage。 */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    key: index => [...map.keys()][index] ?? null,
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: key => { map.delete(key); },
    clear: () => map.clear(),
  };
}
vi.stubGlobal("localStorage", memoryStorage());
const GUEST_A = "guestaaaa1234";
const GUEST_B = "guestbbbb1234";
const snapshot = (date: string): FxSnapshot => ({ base: "EUR", date, provider: "p", revision: "r1", fetchedAt: new Date().toISOString(), rates: { EUR: "1", USD: "1.25", CNY: "10" } });
const today = new Date().toISOString().slice(0, 10);

beforeEach(() => { guestStore.clear(); localStorage.clear(); });

describe("游客汇率仓库", () => {
  it("缓存写进游客库、键带游客 id，且不碰账号离线库", async () => {
    const repo = createGuestFxRepository(() => GUEST_A);
    await repo.save("p", today, { snapshot: snapshot(today), checkedAt: new Date().toISOString() });
    expect([...guestStore.keys()]).toEqual([guestFxKey(GUEST_A)]);
    expect(guestFxKey(GUEST_A)).toBe(`guest:${GUEST_A}:fx-rates`);
    expect((await repo.get("p", today))?.snapshot.rates["USD"]).toBe("1.25");
    // 只有公共汇率，没有金额 / 账目 / 账本
    expect(JSON.stringify([...guestStore.values()])).not.toMatch(/amountCents|bookId|categoryId|convertedMinor/);
  });
  it("不同游客互不可见；没有游客身份时读不到、写不进", async () => {
    let id: string | null = GUEST_A;
    const repo = createGuestFxRepository(() => id);
    await repo.save("p", today, { snapshot: snapshot(today), checkedAt: new Date().toISOString() });
    id = GUEST_B;
    expect(await repo.get("p", today)).toBeNull();
    id = null;
    expect(await repo.get("p", today)).toBeNull();
    await expect(repo.save("p", today, { snapshot: snapshot(today), checkedAt: new Date().toISOString() })).rejects.toThrow();
    expect([...guestStore.keys()]).toEqual([guestFxKey(GUEST_A)]);
  });
  it("容量裁剪与登录用户同一套规则", async () => {
    const repo = createGuestFxRepository(() => GUEST_A, 1);
    const d1 = "2020-01-04", d2 = "2020-01-05";
    await repo.save("p", d1, { snapshot: snapshot(d1), checkedAt: new Date().toISOString() });
    await repo.save("p", d2, { snapshot: snapshot(d2), checkedAt: new Date().toISOString() });
    expect(await repo.get("p", d1)).toBeNull();
    expect(await repo.get("p", d2)).not.toBeNull();
  });
});

describe("游客汇率服务：离线用缓存，回退天数复用现有常量", () => {
  const provider = (fetchSnapshot: (date: string) => FxSnapshot) => ({ id: "p", fetch: vi.fn(async (date: string) => fetchSnapshot(date)) });
  it("联网取过一次后，离线仍可用缓存；没取过的日期是缺汇率", async () => {
    const source = provider(date => snapshot(date));
    const service = createGuestFxService(createGuestFxRepository(() => GUEST_A), source, {});
    expect(await service.lookup("2020-01-05", { offline: true })).toMatchObject({ status: "unavailable", reason: "missing_rate" });
    expect(await service.lookup("2020-01-05")).toMatchObject({ status: "available", cached: false });
    const again = createGuestFxService(createGuestFxRepository(() => GUEST_A), source, {});
    expect(await again.lookup("2020-01-05", { offline: true })).toMatchObject({ status: "available", cached: true });
    expect(source.fetch).toHaveBeenCalledTimes(1);
  });
  it("回退天数不超过 FX_MAX_FALLBACK_DAYS", async () => {
    const dayMs = 86400000, base = Date.parse("2020-01-10T00:00:00Z");
    const stale = new Date(base - (FX_MAX_FALLBACK_DAYS + 1) * dayMs).toISOString().slice(0, 10);
    const service = createGuestFxService(createGuestFxRepository(() => GUEST_A), provider(() => snapshot(stale)), {});
    expect(await service.lookup("2020-01-10")).toMatchObject({ status: "unavailable", reason: "missing_rate" });
    const ok = new Date(base - FX_MAX_FALLBACK_DAYS * dayMs).toISOString().slice(0, 10);
    const service2 = createGuestFxService(createGuestFxRepository(() => GUEST_B), provider(() => snapshot(ok)), {});
    expect(await service2.lookup("2020-01-10")).toMatchObject({ status: "available" });
  });
  it("服务实例类型", () => {
    expect(createGuestFxService(createGuestFxRepository(() => GUEST_A), provider(date => snapshot(date)), {})).toBeInstanceOf(FxHistoryService);
  });
});

describe("游客汇率来源（公开路由）", () => {
  const ok = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  it("只请求本站公开路由一个日期，不带 cookie 与设备头", async () => {
    const fetcher = ok({ status: "available", snapshot: snapshot("2020-01-03"), cached: false });
    const result = await createGuestFxProvider(fetcher).fetch("2020-01-03");
    expect(result.date).toBe("2020-01-03");
    const [url, init] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1${GUEST_FX_PATH}?date=2020-01-03`);
    expect(url.startsWith("/")).toBe(true);
    expect(init.credentials).toBe("omit");
    expect(Object.keys(init.headers as Record<string, string>)).toEqual(["accept"]);
  });
  it("限频（429）、服务器错误、没有汇率都按取不到处理", async () => {
    await expect(createGuestFxProvider(ok({ error: "rate_limited" }, 429)).fetch("2020-01-03")).rejects.toBeInstanceOf(FxError);
    await expect(createGuestFxProvider(ok({}, 500)).fetch("2020-01-03")).rejects.toBeInstanceOf(FxError);
    await expect(createGuestFxProvider(ok({ status: "unavailable", reason: "missing_rate" })).fetch("2020-01-03")).rejects.toMatchObject({ reason: "missing_rate" });
    const broken = vi.fn(async () => { throw new TypeError("network"); }) as unknown as typeof fetch;
    await expect(createGuestFxProvider(broken).fetch("2020-01-03")).rejects.toMatchObject({ reason: "network" });
  });
});

describe("游客的折算开关", () => {
  it("主人 id：账号用账号 id，游客加 guest: 前缀，都没有为空", () => {
    expect(fxOwnerId("u1", null)).toBe("u1");
    expect(fxOwnerId(undefined, GUEST_A)).toBe(`guest:${GUEST_A}`);
    expect(fxOwnerId(undefined, null)).toBe("");
  });
  it("开关存本机，按游客分开；清除游客数据只清自己的键", () => {
    const a = fxOwnerId(undefined, GUEST_A), b = fxOwnerId(undefined, GUEST_B);
    expect(readFxMode(a)).toBe(false);
    expect(saveFxMode(a, true)).toBe(true);
    saveFxMode(b, true); saveFxMode("user-1", true);
    expect(readFxMode(a)).toBe(true);
    expect(localStorage.getItem(fxModeKey(a))).toBe("on");
    clearOwnerPreferences("guest", GUEST_A, localStorage);
    expect(readFxMode(a)).toBe(false);
    expect(readFxMode(b)).toBe(true);
    expect(readFxMode("user-1")).toBe(true);
  });
});
