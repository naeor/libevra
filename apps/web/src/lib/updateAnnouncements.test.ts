import { describe, expect, it } from "vitest";

import {
  ANNOUNCEMENT_PAGE_SIZE,
  adjacentReleasedAnnouncements,
  formatReleaseDate,
  hasNewerReleasedVersion,
  latestApplicableAnnouncement,
  releasedAnnouncementByVersion,
  releasedAnnouncements,
  type UpdateAnnouncement,
} from "./updateAnnouncements.js";

function announcement(version: string, releasedAt: string | null): UpdateAnnouncement {
  return {
    version,
    releasedAt,
    status: releasedAt === null ? "development" : "released",
    title: `title ${version}`,
    summary: `summary ${version}`,
    sections: [],
    major: false,
  };
}

describe("version announcements", () => {
  it("contains the actual releases, newest first", () => {
    const released = releasedAnnouncements();
    expect(released.map((entry) => entry.version)).toEqual([
      "1.15.00",
      "1.14.20",
      "1.14.18",
      "1.13.15",
      "1.13.09",
      "1.13.08",
      "1.13.07",
    ]);
    expect(released.every((entry) => entry.status === "released" && entry.releasedAt !== null)).toBe(true);
  });

  it("records the 1.15.00 release as a major update with the official copy", () => {
    const announcement = releasedAnnouncementByVersion("1.15.00");
    expect(announcement?.title).toBe("Libevra 1.15.00");
    expect(announcement?.summary).toBe("记录更顺手，识别更完整。");
    expect(announcement?.releasedAt).toBe("2026-10-21");
    expect(announcement?.major).toBe(true);
    expect(announcement?.sections.map((section) => section.heading)).toEqual([
      "手动记账，更顺手",
      "一张截图，识别多笔",
      "批量核对，一次确认",
      "账本与日常操作",
      "界面与可读性",
    ]);
    expect(announcement?.closing?.[0]).toBe("感谢你使用 Libevra。");
  });

  it("keeps the 1.14.20 OCR patch announcement as a non-major release", () => {
    const announcement = releasedAnnouncementByVersion("1.14.20");
    expect(announcement?.title).toBe("Libevra 1.14.20");
    expect(announcement?.summary).toBe("让每一次识别，都更可靠。");
    expect(announcement?.releasedAt).toBe("2026-10-20");
    expect(announcement?.major).toBe(false);
    expect(announcement?.sections.map((section) => section.heading)).toEqual([
      "图片识别恢复正常",
      "更及时的错误反馈",
      "其他改进",
    ]);
    expect(announcement?.closing?.[0]).toBe("感谢你使用 Libevra。");
  });

  it("keeps the exact 1.14.18 user-facing announcement", () => {
    const announcement = releasedAnnouncementByVersion("1.14.18");
    expect(announcement?.title).toBe("Libevra 1.14.18");
    expect(announcement?.summary).toBe("让账目流动，也让每一步更安心。");
    expect(announcement?.releasedAt).toBe("2026-10-19");
    expect(announcement?.major).toBe(true);
    expect(announcement?.intro?.[0]).toContain("重新设计了账本导入体验");
    expect(announcement?.sections.map((section) => section.heading)).toEqual([
      "账本之间，自由整理",
      "导入前，先确认",
      "更清楚地处理重复记录",
      "其他改进",
    ]);
    expect(announcement?.closing?.[0]).toBe("感谢你使用 Libevra。");
  });

  it("exposes the 1.13.15 release with its three user-facing groups", () => {
    const announcement = releasedAnnouncementByVersion("1.13.15");
    expect(announcement?.title).toBe("软件更新与版本公告");
    expect(announcement?.releasedAt).toBe("2026-10-19");
    expect(announcement?.sections.map((section) => section.heading)).toEqual([
      "数据保护与恢复",
      "账号与账本安全",
      "稳定性改进",
    ]);
  });

  it("exposes the 1.13.09 announcement as released", () => {
    expect(releasedAnnouncementByVersion("1.13.09")?.title).toBe("软件更新与版本公告");
    expect(releasedAnnouncementByVersion("1.13.09")?.releasedAt).toBe("2026-10-18");
  });

  it("does not invent an announcement for a future development build", () => {
    expect(releasedAnnouncementByVersion("1.14.21")).toBeNull();
    expect(releasedAnnouncementByVersion("1.15.01")).toBeNull();
  });

  it("answers with the latest applicable release for a running version", () => {
    expect(latestApplicableAnnouncement("1.15.00")?.version).toBe("1.15.00");
    expect(latestApplicableAnnouncement("1.15.01")?.version).toBe("1.15.00");
    expect(latestApplicableAnnouncement("1.14.20")?.version).toBe("1.14.20");
    expect(latestApplicableAnnouncement("1.14.19")?.version).toBe("1.14.18");
    expect(latestApplicableAnnouncement("1.14.18")?.version).toBe("1.14.18");
    expect(latestApplicableAnnouncement("1.13.15")?.version).toBe("1.13.15");
    expect(latestApplicableAnnouncement("1.13.14")?.version).toBe("1.13.09");
    expect(latestApplicableAnnouncement("1.13.10")?.version).toBe("1.13.09");
    expect(latestApplicableAnnouncement("1.13.09")?.version).toBe("1.13.09");
    expect(latestApplicableAnnouncement("1.13.08")?.version).toBe("1.13.08");
    expect(latestApplicableAnnouncement("1.13.07")?.version).toBe("1.13.07");
    expect(latestApplicableAnnouncement("1.13.06")).toBeNull();
  });

  it("detects a newer released version without claiming the running build is current", () => {
    expect(hasNewerReleasedVersion("1.13.07")).toBe(true);
    expect(hasNewerReleasedVersion("1.13.08")).toBe(true);
    expect(hasNewerReleasedVersion("1.13.09")).toBe(true);
    expect(hasNewerReleasedVersion("1.13.10")).toBe(true);
    expect(hasNewerReleasedVersion("1.13.15")).toBe(true);
    expect(hasNewerReleasedVersion("1.14.18")).toBe(true);
    expect(hasNewerReleasedVersion("1.14.19")).toBe(true);
    expect(hasNewerReleasedVersion("1.14.20")).toBe(true);
    expect(hasNewerReleasedVersion("1.15.00")).toBe(false);
  });

  it("returns all actual releases and leaves the first page to the UI", () => {
    const entries: UpdateAnnouncement[] = [
      announcement("1.13.30", null),
      ...Array.from({ length: 25 }, (_, index) => {
        const day = String(25 - index).padStart(2, "0");
        return announcement(`1.13.${String(20 - index)}`, `2026-09-${day}`);
      }),
    ];
    const released = releasedAnnouncements(entries);
    expect(ANNOUNCEMENT_PAGE_SIZE).toBe(20);
    expect(released).toHaveLength(25);
    expect(released.some((entry) => entry.version === "1.13.30")).toBe(false);
    expect(released.slice(0, ANNOUNCEMENT_PAGE_SIZE)).toHaveLength(20);
    expect(released.slice(ANNOUNCEMENT_PAGE_SIZE)).toHaveLength(5);
  });

  it("offers older/newer release navigation without development placeholders", () => {
    expect(adjacentReleasedAnnouncements("1.15.00").newer).toBeNull();
    expect(adjacentReleasedAnnouncements("1.15.00").older?.version).toBe("1.14.20");
    expect(adjacentReleasedAnnouncements("1.14.20").newer?.version).toBe("1.15.00");
    expect(adjacentReleasedAnnouncements("1.14.20").older?.version).toBe("1.14.18");
    expect(adjacentReleasedAnnouncements("1.14.18").newer?.version).toBe("1.14.20");
    expect(adjacentReleasedAnnouncements("1.14.18").older?.version).toBe("1.13.15");
    expect(adjacentReleasedAnnouncements("1.13.15").newer?.version).toBe("1.14.18");
    expect(adjacentReleasedAnnouncements("1.13.15").older?.version).toBe("1.13.09");
    expect(adjacentReleasedAnnouncements("1.13.08").newer?.version).toBe("1.13.09");
    expect(adjacentReleasedAnnouncements("1.13.08").older?.version).toBe("1.13.07");
    expect(adjacentReleasedAnnouncements("1.13.07").older).toBeNull();
    expect(adjacentReleasedAnnouncements("1.13.07").newer?.version).toBe("1.13.08");
  });

  it("formats the publication date without inventing a time or timezone", () => {
    expect(formatReleaseDate("2026-10-19")).toBe("2026年10月19日");
    expect(formatReleaseDate("2026-10-18")).toBe("2026年10月18日");
  });
});
