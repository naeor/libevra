import { describe, expect, it } from "vitest";

import { entryKey, parseEntryLedgers, pruneEntryLedgers, withoutInstance } from "./entryLedgers.js";

describe("单条记录的账本：按实例区分", () => {
  it("两个实例的第一页都叫 default，也互不覆盖", () => {
    expect(entryKey("w1", "default")).not.toBe(entryKey("w2", "default"));
  });

  it("重建某个实例的历史时只清它自己的", () => {
    const map = { "w1:default": "travel", "w2:default": "home", "w2:k1": "travel" };
    expect(withoutInstance(map, "w1")).toEqual({ "w2:default": "home", "w2:k1": "travel" });
    expect(withoutInstance(map, "w2")).toEqual({ "w1:default": "travel" });
    const untouched = { "w2:k": "x" };
    expect(withoutInstance(untouched, "w1")).toBe(untouched);
  });

  it("会话恢复只接受带实例前缀的键与非空账本 id", () => {
    expect(parseEntryLedgers({ default: "travel", "w1:k": "", "w2:k": "home", "w3:k": "x", "w1:j": 3 })).toEqual({ "w2:k": "home" });
    expect(parseEntryLedgers(null)).toEqual({});
  });

  it("保存时丢掉已经不在任何历史里的记录", () => {
    const map = { "w1:a": "travel", "w1:gone": "travel", "w2:a": "home" };
    const histories = {
      w1: { entries: [{ path: "/", key: "a" }], index: 0 },
      w2: { entries: [{ path: "/", key: "default" }], index: 0 },
    };
    expect(pruneEntryLedgers(map, histories)).toEqual({ "w1:a": "travel" });
  });
});
