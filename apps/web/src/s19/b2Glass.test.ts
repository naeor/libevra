import { describe, expect, it } from "vitest";
import { createVisualStyleController, VISUAL_STYLE_STORAGE_KEY, type VisualStyleStorage } from "../lib/visualStyle.js";
import { GLASS_BLUR_STORAGE_KEY } from "./material.js";
import { B2_GLASS_PRESETS, B2_OLD_PAGE_RETREAT, b2GlassMaterial, b2GlassStorageKey, customGlass, parseB2Glass, presetGlass } from "./b2Glass.js";
import { createB2AdminEditor } from "./b2Admin.js";
import type { AdminSelfResponse } from "@libellum/shared";

function fixture(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const css = new Map<string, string>();
  const storage: VisualStyleStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
  const root = { dataset: {}, style: { setProperty: (key: string, value: string) => { css.set(key, value); } } };
  return { values, css, storage, root, controller: createVisualStyleController(root, storage) };
}
const admin: AdminSelfResponse = { isAdmin: true, accountNumber: "10000000", username: "test-admin" };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { resolve, promise }; }

describe("B2 统一玻璃预设", () => {
  it("严格使用指定四元组，B2 左退默认关闭，通透度和 blur 不混用", () => {
    expect(B2_GLASS_PRESETS).toEqual({ clear: { ambient: 95, content: 85, chrome: 50, blur: 50 }, balanced: { ambient: 85, content: 75, chrome: 65, blur: 65 }, soft: { ambient: 75, content: 65, chrome: 80, blur: 80 } });
    expect(B2_OLD_PAGE_RETREAT).toBe(false);
    expect(b2GlassMaterial(B2_GLASS_PRESETS.balanced)).toMatchObject({ carry: .85, contentFill: .25, chromeFill: .35, surfaceBlur: 9.1, outgoingBlur: 9.1 });
    expect(b2GlassMaterial(B2_GLASS_PRESETS.clear).surfaceBlur).toBe(7);
    expect(b2GlassMaterial(B2_GLASS_PRESETS.soft).contentFill).toBe(.35);
  });
  it("顶底栏使用 50/65/80 透明度和 80/65/50 模糊，卡片及已保存自定义互不串用", () => {
    for (const [mode, fill, blur] of [["clear", .5, 11.2], ["balanced", .35, 9.1], ["soft", .2, 7]] as const) {
      const { controller, css } = fixture();
      controller.chooseB2Preset(mode);
      expect(css.get("--s19-b2-chrome-fill")).toBe(String(fill));
      expect(css.get("--s19-b2-chrome-blur")).toBe(`${blur}px`);
    }
    expect(b2GlassMaterial(B2_GLASS_PRESETS.clear, "clear").surfaceBlur).toBe(7);
    expect(b2GlassMaterial(B2_GLASS_PRESETS.soft, "soft").surfaceBlur).toBe(11.2);
    expect(b2GlassMaterial({ ambient: 94, content: 86, chrome: 32, blur: 28 }, "custom").chromeBlur).toBe(3.92);
  });
  it("兼容旧模糊偏好，不覆盖已保存自定义；异常格式回默认且数值有界", () => {
    expect(parseB2Glass(null).mode).toBe("balanced");
    expect(parseB2Glass(null, "35")).toEqual(customGlass({ ...B2_GLASS_PRESETS.balanced, blur: 35 }));
    const custom = customGlass({ ambient: 94, content: 86, chrome: 32, blur: 28 });
    expect(parseB2Glass(JSON.stringify(custom), "35")).toEqual(custom);
    for (const raw of ["{broken", "null", '{"version":7}', '{"version":1,"mode":"custom","values":{}}']) expect(parseB2Glass(raw).mode).toBe("balanced");
    expect(customGlass({ ambient: -1, content: 101, chrome: 12.8, blur: NaN }).values).toEqual({ ambient: 0, content: 100, chrome: 13, blur: 65 });
    expect(customGlass(B2_GLASS_PRESETS.balanced).mode).toBe("custom");
  });
  it("选择即时应用、刷新恢复；切换风格和 B1 模糊不改 B2，账号之间隔离", () => {
    const f = fixture(); const c = f.controller;
    c.setB2Account("admin-a"); c.choose("b2"); c.chooseB2Preset("clear");
    expect(f.css.get("--s19-b2-content-fill")).toBe("0.15");
    c.chooseBlur(40); c.choose("c"); c.choose("b2");
    expect(c.getB2Snapshot().mode).toBe("clear");
    expect(f.css.get("--s19-b1-surface-blur")).toBe("6.4px");
    expect(f.css.get("--s19-b2-surface-blur")).toBe("7px");
    expect(f.css.get("--s19-b2-chrome-blur")).toBe("11.2px");
    c.chooseB2Custom("admin-a", { ambient: 12, content: 34, chrome: 56, blur: 78 });
    c.setB2Account("user-b"); expect(c.getB2Snapshot().mode).toBe("balanced");
    expect(c.getB2Snapshot().values).toEqual(B2_GLASS_PRESETS.balanced);
    c.chooseB2Preset("soft"); c.setB2Account("admin-a"); expect(c.getB2Snapshot().values.ambient).toBe(12);
    const restored = createVisualStyleController(f.root, f.storage); restored.setB2Account("admin-a");
    expect(restored.getB2Snapshot()).toEqual(c.getB2Snapshot());
    expect(f.values.has(b2GlassStorageKey("user-b"))).toBe(true);
  });
  it("明确的均衡覆盖旧格式迁移，跨标签页的其他账号变更不会串用或读到过期缓存", () => {
    const f = fixture({ [VISUAL_STYLE_STORAGE_KEY]: "b2", [GLASS_BLUR_STORAGE_KEY]: "35" });
    const c = f.controller; c.setB2Account("a"); expect(c.getB2Snapshot().mode).toBe("custom");
    c.chooseB2Preset("balanced");
    const fresh = createVisualStyleController(f.root, f.storage); fresh.setB2Account("a"); expect(fresh.getB2Snapshot().mode).toBe("balanced");
    fresh.setB2Account("new-account"); expect(fresh.getB2Snapshot().mode).toBe("balanced");
    c.setB2Account("b"); c.chooseB2Preset("soft"); c.setB2Account("a");
    const raw = JSON.stringify(presetGlass("clear")); f.storage.setItem(b2GlassStorageKey("b"), raw); c.restoreB2(raw, b2GlassStorageKey("b"));
    expect(c.getB2Snapshot().mode).toBe("balanced"); c.setB2Account("b"); expect(c.getB2Snapshot().mode).toBe("clear");
    f.values.clear(); c.restoreB2(null, null); expect(c.getB2Snapshot().mode).toBe("balanced");
    c.setB2Account("a"); expect(c.getB2Snapshot().mode).toBe("balanced");
  });
  it("存储拒绝时会话可用，正式模式只允许 Original / B2", () => {
    const storage: VisualStyleStorage = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); }, removeItem() { throw Error("blocked"); } };
    const c = createVisualStyleController({ dataset: {} }, storage, undefined, false);
    c.choose("a"); expect(c.getSnapshot()).toBe("original"); c.choose("b2"); expect(c.getSnapshot()).toBe("b2");
    c.setB2Account("a"); c.chooseB2Preset("soft"); c.setB2Account("b"); expect(c.getB2Snapshot().mode).toBe("balanced");
    c.setB2Account("a"); expect(c.getB2Snapshot().mode).toBe("soft");
  });
});

describe("B2 管理员编辑动作", () => {
  it("拒绝未授权、伪身份、不匹配账号和请求失败，真实管理员只改自己的本机值", async () => {
    const { controller: c, values } = fixture(); c.setB2Account("a");
    for (const self of [null, { ...admin, isAdmin: false }, { ...admin, accountNumber: "10000001" }]) {
      const editor = createB2AdminEditor(c, "a", admin.accountNumber, async () => self);
      expect(await editor.choose(B2_GLASS_PRESETS.clear)).toBe("denied");
    }
    expect(await createB2AdminEditor(c, "a", admin.accountNumber, async () => { throw Error("offline"); }).choose(B2_GLASS_PRESETS.clear)).toBe("denied");
    expect(values.has(b2GlassStorageKey("a"))).toBe(false);
    expect(await createB2AdminEditor(c, "a", admin.accountNumber, async () => admin).choose(B2_GLASS_PRESETS.clear)).toBe("saved");
    expect(c.getB2Snapshot().mode).toBe("custom");
    c.setB2Account("b"); expect(c.getB2Snapshot().mode).toBe("balanced");
  });
  it("迟到授权不能覆盖新预设、其他账号或更新的滑动值", async () => {
    const { controller: c } = fixture(); c.setB2Account("a");
    const first = deferred<AdminSelfResponse | null>();
    const editor = createB2AdminEditor(c, "a", admin.accountNumber, () => first.promise);
    const old = editor.choose(B2_GLASS_PRESETS.clear); c.chooseB2Preset("soft"); first.resolve(admin);
    expect(await old).toBe("superseded"); expect(c.getB2Snapshot().mode).toBe("soft");
    const second = deferred<AdminSelfResponse | null>(); const switched = createB2AdminEditor(c, "a", admin.accountNumber, () => second.promise).choose(B2_GLASS_PRESETS.clear);
    c.setB2Account("b"); second.resolve(admin); expect(await switched).toBe("superseded"); expect(c.getB2Snapshot().mode).toBe("balanced");
    c.setB2Account("a"); const replies = [deferred<AdminSelfResponse | null>(), deferred<AdminSelfResponse | null>()]; let index = 0;
    const latest = createB2AdminEditor(c, "a", admin.accountNumber, () => replies[index++]!.promise);
    const p1 = latest.choose(B2_GLASS_PRESETS.clear); const p2 = latest.choose(B2_GLASS_PRESETS.balanced);
    replies[1]!.resolve(admin); expect(await p2).toBe("saved"); replies[0]!.resolve(admin); expect(await p1).toBe("superseded");
    expect(c.getB2Snapshot()).toEqual(customGlass(B2_GLASS_PRESETS.balanced));
  });
});
