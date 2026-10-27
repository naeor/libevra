import { describe, expect, it } from "vitest";

import { APP_VERSION, formatAppVersion } from "./version.js";

/**
 * 所有者 2026-10-27 要求：用户界面上的版本名统一两位补零（1.17.03），
 * 但 `APP_VERSION` 本身必须保持严格 SemVer 合法（1.17.3），两者不能各说各话。
 */
describe("formatAppVersion", () => {
  it("补零到两位补丁号", () => {
    expect(formatAppVersion("1.17.3")).toBe("1.17.03");
    expect(formatAppVersion("1.17.4")).toBe("1.17.04");
    expect(formatAppVersion("1.17.10")).toBe("1.17.10");
    expect(formatAppVersion("1.16.22")).toBe("1.16.22");
    expect(formatAppVersion("2.0.1")).toBe("2.0.01");
  });

  it("非三段版本原样返回，不制造半个版本号", () => {
    expect(formatAppVersion("1.17")).toBe("1.17");
    expect(formatAppVersion("dev")).toBe("dev");
  });

  it("运行代码的版本不变，只影响展示", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(formatAppVersion()).toBe(formatAppVersion(APP_VERSION));
  });
});
