import { describe, expect, it } from "vitest";
import { wantsStyleLabDock } from "./labDock.js";

const memory = () => { const map = new Map<string, string>(); return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) }; };

describe("S19 开发风格把手", () => {
  it("默认不显示：正式界面不再出现右侧的开发切换浮层", () => {
    expect(wantsStyleLabDock("", memory())).toBe(false);
    expect(wantsStyleLabDock("?s19=b2", memory())).toBe(false);
    expect(wantsStyleLabDock("", null)).toBe(false);
  });
  it("?s19lab=1 打开并在本标签页内保持，?s19lab=0 关闭", () => {
    const storage = memory();
    expect(wantsStyleLabDock("?s19lab=1", storage)).toBe(true);
    expect(wantsStyleLabDock("", storage)).toBe(true);
    expect(wantsStyleLabDock("?s19lab=0", storage)).toBe(false);
    expect(wantsStyleLabDock("", storage)).toBe(false);
  });
  it("存储不可用时不显示", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => undefined };
    expect(wantsStyleLabDock("?s19lab=1", broken)).toBe(false);
  });
});
