import { describe, expect, it } from "vitest";
import { ApiRequestError, errorMessage } from "./api.js";

describe("用户错误反馈边界", () => {
  it("保留服务端明确的权限原因及错误结构", () => {
    const details = { role: "viewer" };
    const error = new ApiRequestError(403, "forbidden", "你没有编辑权限。", details);
    expect(errorMessage(error)).toBe("你没有编辑权限。");
    expect(error.status).toBe(403);
    expect(error.code).toBe("forbidden");
    expect(error.details).toBe(details);
  });

  it.each([new Error("TypeError: internal-path /secret"), "raw exception", null, {}])(
    "未分类异常不展示内部内容，也不猜测网络或文件故障：%s",
    (error) => {
      const message = errorMessage(error);
      expect(message).toContain("请重试");
      expect(message).toContain("联系管理员");
      expect(message).not.toMatch(/TypeError|secret|raw exception|网络|文件格式|\[object Object\]/);
    },
  );
});
