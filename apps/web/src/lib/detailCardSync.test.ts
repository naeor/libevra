import { describe, expect, it } from "vitest";
import { syncDetailCards, type CardLocal } from "./detailCardSync.js";
import type { apiFetch } from "./api.js";
import { ApiRequestError } from "./api.js";
const a = { main: "overview", first: "balance", second: "daily" } as const;
const b = { ...a, first: "count" } as const;
describe("个人展示方案同步", () => {
  it("干净本机采用云端；不同账号和账本显式传入", async () => {
    let state: CardLocal = { value: a, base: 0, dirty: false };
    const request = (async (path: string, options: unknown) => { expect(path).toBe("/detail-cards/book"); expect(options).toEqual({ query: { accountScope: "user:user" } }); return { record: { version: 2, configuration: b } }; }) as typeof apiFetch;
    await syncDetailCards("user", "book", () => state, v => state = v, () => true, request);
    expect(state).toEqual({ value: b, base: 2, dirty: false });
  });
  it("两端不同修改保留双方，不 POST 覆盖", async () => {
    let state: CardLocal = { value: a, base: 1, dirty: true }, calls = 0;
    const request = (async () => { calls++; return { record: { version: 2, configuration: b } }; }) as typeof apiFetch;
    await syncDetailCards("u", "b", () => state, v => state = v, () => true, request);
    expect(calls).toBe(1); expect(state.value).toEqual(a); expect(state.conflict?.configuration).toEqual(b);
  });
  it("上传过程中又编辑，保留新修改并推进基线", async () => {
    let state: CardLocal = { value: a, base: 0, dirty: true }, calls = 0;
    const request = (async () => { if (++calls === 1) return { record: null }; state = { ...state, value: b }; return { record: { version: 1, configuration: a } }; }) as typeof apiFetch;
    await syncDetailCards("u", "b", () => state, v => state = v, () => true, request);
    expect(state).toEqual({ value: b, base: 1, dirty: true });
  });
  it("切换账号后迟到的响应不安装到本机", async () => {
    let writes = 0;
    await syncDetailCards("u", "b", () => ({ value: a, base: 0, dirty: false }), () => writes++, () => false, (async () => ({ record: { version: 1, configuration: b } })) as typeof apiFetch);
    expect(writes).toBe(0);
  });
  it("离线失败保留已保存草稿", async () => {
    const state: CardLocal = { value: a, base: 0, dirty: true };
    await expect(syncDetailCards("u", "b", () => state, () => { throw Error("must not write"); }, () => true, (async () => { throw Error("offline"); }) as typeof apiFetch)).rejects.toThrow("offline");
    expect(state.dirty).toBe(true);
  });
  it("GET 和 POST 之间的竞争返回可选择的冲突", async () => {
    let state: CardLocal = { value: a, base: 0, dirty: true }, calls = 0;
    const request = (async () => { if (++calls === 1) return { record: null }; throw new ApiRequestError(409, "workbench_conflict", "conflict", { record: { version: 1, configuration: b } }); }) as typeof apiFetch;
    await syncDetailCards("u", "b", () => state, v => state = v, () => true, request);
    expect(state.conflict?.configuration).toEqual(b);
  });
});
