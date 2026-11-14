import { describe, expect, it, vi } from "vitest";

import { afterBackGuard, decideClose } from "./closeGuard.js";

/**
 * 关闭前询问（弹出面板模板，1.19.58）：点遮罩、下拉、×、Esc、系统返回都走这一个判断。
 * 系统返回的保护记录（`usePageBackGuard`）需要浏览器历史，这里不覆盖；如实说明，不假装覆盖。
 */
describe("关闭前询问的判断", () => {
  it("没有改动时直接关闭", () => {
    expect(decideClose({ busy: false, dirty: false })).toBe("close");
  });

  it("有改动时先询问", () => {
    expect(decideClose({ busy: false, dirty: true })).toBe("ask");
  });

  it("正在保存时任何关闭请求都不响应（有没有改动都一样）", () => {
    expect(decideClose({ busy: true, dirty: false })).toBe("ignore");
    expect(decideClose({ busy: true, dirty: true })).toBe("ignore");
  });

  it("保存成功后的关闭不再询问", () => {
    expect(decideClose({ busy: false, dirty: true, force: true })).toBe("close");
    expect(decideClose({ busy: true, dirty: true, force: true })).toBe("close");
  });
});

describe("释放面板的返回保护后导航", () => {
  it("有保护记录时只在退回原页后执行一次", () => {
    const events = new EventTarget();
    const back = vi.fn();
    const action = vi.fn();
    vi.stubGlobal("window", { addEventListener: events.addEventListener.bind(events), history: { back } });
    try {
      afterBackGuard((_fallback, released) => released?.(true), action);
      expect(back).toHaveBeenCalledTimes(1);
      expect(action).not.toHaveBeenCalled();
      events.dispatchEvent(new Event("popstate"));
      events.dispatchEvent(new Event("popstate"));
      expect(action).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("辅助工作区没有保护记录时直接导航", () => {
    const action = vi.fn();
    afterBackGuard((fallback) => fallback(), action);
    expect(action).toHaveBeenCalledTimes(1);
  });
});
