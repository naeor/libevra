import { describe, expect, it } from "vitest";

import { RELEASE_MAJOR_ANNOUNCEMENT_1_14_18, RELEASE_MAJOR_ANNOUNCEMENT_1_15_00 } from "@libellum/shared";

import {
  isMajorAnnouncementOlderThanApp,
  selectDisplayedMajorAnnouncement,
} from "./majorAnnouncementVisibility.js";

/**
 * 客户端只负责“这条弹窗还属不属于当前构建”。
 *
 * 服务端仍会返回账号尚未确认的最新重大公告（这是跨设备一次提醒的来源）；但浏览器已经升级到
 * 更新版本后，旧公告不应再打断用户。这里用真实公告文案做样本，避免测试里另造一套版本。
 */
describe("重大更新弹窗的版本过滤", () => {
  it("当前构建比公告新时不再展示旧公告", () => {
    expect(
      selectDisplayedMajorAnnouncement(RELEASE_MAJOR_ANNOUNCEMENT_1_15_00, "1.15.03"),
    ).toBeNull();
    expect(isMajorAnnouncementOlderThanApp("1.15.00", "1.15.03")).toBe(true);
  });

  it("当前构建与公告同版本时保留弹窗", () => {
    expect(
      selectDisplayedMajorAnnouncement(RELEASE_MAJOR_ANNOUNCEMENT_1_15_00, "1.15.00"),
    ).toBe(RELEASE_MAJOR_ANNOUNCEMENT_1_15_00);
  });

  it("旧构建仍可看到更新的公告，不因版本比较把新提醒藏掉", () => {
    const announcement = {
      ...RELEASE_MAJOR_ANNOUNCEMENT_1_15_00,
      version: "1.15.04",
    };

    expect(selectDisplayedMajorAnnouncement(announcement, "1.15.03")).toBe(announcement);
  });

  it("只过滤更旧的公告，不误伤上一条历史重大公告", () => {
    expect(
      selectDisplayedMajorAnnouncement(RELEASE_MAJOR_ANNOUNCEMENT_1_14_18, "1.15.03"),
    ).toBeNull();
    expect(
      selectDisplayedMajorAnnouncement(RELEASE_MAJOR_ANNOUNCEMENT_1_15_00, "1.15.03"),
    ).toBeNull();
  });

  it("没有待展示公告时返回 null", () => {
    expect(selectDisplayedMajorAnnouncement(null, "1.15.03")).toBeNull();
  });

  it("版本号带后缀时按前导数字比较", () => {
    expect(isMajorAnnouncementOlderThanApp("1.15.00-test", "1.15.03")).toBe(true);
    expect(isMajorAnnouncementOlderThanApp("1.15.03-beta.1", "1.15.03")).toBe(false);
  });

  it("版本号无法解析时选择展示而不是静默丢弃公告", () => {
    expect(isMajorAnnouncementOlderThanApp("1.15.00", "unknown")).toBe(false);
    expect(isMajorAnnouncementOlderThanApp("not-a-version", "1.15.03")).toBe(false);

    const announcement = { ...RELEASE_MAJOR_ANNOUNCEMENT_1_15_00, version: "not-a-version" };
    expect(selectDisplayedMajorAnnouncement(announcement, "1.15.03")).toBe(announcement);
  });
});
