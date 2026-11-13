import { describe, expect, it } from "vitest";

import { decideClose } from "./closeGuard.js";

/**
 * 关闭前询问（弹出面板模板，1.19.58）：点遮罩、下拉、×、Esc、系统返回都走这一个判断。
 * 系统返回的保护记录（`useBackGuard`）需要浏览器历史，这里不覆盖；如实说明，不假装覆盖。
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
