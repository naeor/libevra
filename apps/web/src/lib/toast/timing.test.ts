import { describe, expect, it } from "vitest";

import { ACTION_DWELL_MS, dwellMs, ECHO_ERROR_DWELL_MS, readableLength, resumeFloorMs, waitLimitMs } from "./timing.js";

/**
 * 1.19.66 统一提示条的停留时长（方案 §2.4）。原来五套各写各的 2.6 / 3 / 3.2 / 4 / 5 秒，这里锁定统一规则。
 */
describe("提示条停留时长", () => {
  it("可读长度：中文按字、其他文字按词 × 2，标点不计", () => {
    expect(readableLength("工作台已保存到本机。")).toBe(9);
    expect(readableLength("Saved to this device.")).toBe(8);
    expect(readableLength("已删除「收支趋势」")).toBe(7);
    expect(readableLength("")).toBe(0);
  });

  it("信息 / 成功：clamp(4s, 1.5s + 0.12s × 长度, 8s)", () => {
    expect(dwellMs({ tone: "success", text: "已保存", hasAction: false, echo: false })).toBe(4_000);
    // 22 个字：1.5 + 2.64 = 4.14s
    expect(dwellMs({ tone: "info", text: "辅助工作区有未保存的修改详情已在主工作区打开", hasAction: false, echo: false })).toBe(4_140);
    expect(dwellMs({ tone: "info", text: "字".repeat(200), hasAction: false, echo: false })).toBe(8_000);
    // 第二行也算阅读量
    expect(dwellMs({ tone: "success", text: "字".repeat(20), detail: "字".repeat(20), hasAction: false, echo: false })).toBe(6_300);
  });

  it("警告：下限 6s、上限 10s", () => {
    expect(dwellMs({ tone: "warning", text: "放不下", hasAction: false, echo: false })).toBe(6_000);
    expect(dwellMs({ tone: "warning", text: "字".repeat(200), hasAction: false, echo: false })).toBe(10_000);
  });

  it("带操作：固定 10s，不按文字缩短（原撤销条 5s）", () => {
    expect(dwellMs({ tone: "info", text: "已删除这笔记账", hasAction: true, echo: false })).toBe(ACTION_DWELL_MS);
    expect(ACTION_DWELL_MS).toBe(10_000);
    expect(dwellMs({ tone: "success", text: "字".repeat(200), hasAction: true, echo: false })).toBe(10_000);
  });

  it("错误不自动消失；错误回声 8s", () => {
    expect(dwellMs({ tone: "error", text: "保存失败", hasAction: false, echo: false })).toBeNull();
    expect(dwellMs({ tone: "error", text: "保存失败", hasAction: true, echo: false })).toBeNull();
    expect(dwellMs({ tone: "error", text: "全部失败", hasAction: false, echo: true })).toBe(ECHO_ERROR_DWELL_MS);
  });

  it("暂停后恢复的最少剩余：普通 2s、警告 3s、带操作 4s、错误回声 3s", () => {
    expect(resumeFloorMs({ tone: "success", hasAction: false, echo: false })).toBe(2_000);
    expect(resumeFloorMs({ tone: "warning", hasAction: false, echo: false })).toBe(3_000);
    expect(resumeFloorMs({ tone: "info", hasAction: true, echo: false })).toBe(4_000);
    expect(resumeFloorMs({ tone: "error", hasAction: false, echo: true })).toBe(3_000);
  });

  it("等待位：普通 3s、警告 6s 过期，错误不过期", () => {
    expect(waitLimitMs("info")).toBe(3_000);
    expect(waitLimitMs("success")).toBe(3_000);
    expect(waitLimitMs("warning")).toBe(6_000);
    expect(waitLimitMs("error")).toBeNull();
  });
});
