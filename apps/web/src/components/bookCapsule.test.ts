import { describe, expect, it, vi } from "vitest";
import { createBookCapsuleStore } from "./bookCapsule.js";

describe("常驻底栏上的当前账本胶囊", () => {
  it("页面登记哪本账就显示哪本；新页登记、旧页撤销在同一次提交里时，结果不变就不通知", () => {
    const store = createBookCapsuleStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const detail = {}, stats = {};
    store.set(detail, "家庭账本");
    expect(store.get()).toBe("家庭账本");
    expect(listener).toHaveBeenCalledTimes(1);
    // 主 Tab 交换：旧页撤销、新页登记同一本账 → 最终仍是同一本，胶囊不动。
    store.set(stats, "家庭账本");
    store.set(detail, null);
    expect(store.get()).toBe("家庭账本");
    expect(listener).toHaveBeenCalledTimes(1);
  });
  it("目标页不需要胶囊时变为 null（胶囊缩回底栏），再次登记时出现", () => {
    const store = createBookCapsuleStore();
    const page = {};
    store.set(page, "家庭账本");
    store.set(page, null);
    expect(store.get()).toBeNull();
    store.set({}, "旅行账本");
    expect(store.get()).toBe("旅行账本");
  });
});
