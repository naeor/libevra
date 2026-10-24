import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { activeMajorAnnouncements } from "@libellum/shared";
import { selectDisplayedMajorAnnouncement } from "./majorAnnouncementVisibility.js";

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
  it("editorial revisions neither create major notices nor change their identity/publication cutoff", () => {
    const major = activeMajorAnnouncements(false);
    expect(major.map(({ id, version, publishedAt, testOnly }) => ({ id, version, publishedAt, testOnly }))).toEqual([
      { id: "major-1.14.18", version: "1.14.18", publishedAt: "2026-10-19T08:31:24.000Z", testOnly: false },
      { id: "major-1.15.00", version: "1.15.00", publishedAt: "2026-10-21T01:21:05.000Z", testOnly: false },
    ]);
    for (const notice of major) {
      expect(selectDisplayedMajorAnnouncement(notice, "1.16.04")).toBeNull();
      expect(selectDisplayedMajorAnnouncement(notice, notice.version)).toBe(notice);
    }
    expect(selectDisplayedMajorAnnouncement(null, "1.16.04")).toBeNull();
  });
  it("contains the actual releases, newest first", () => {
    const released = releasedAnnouncements();
    expect(released.map((entry) => entry.version)).toEqual([
      "1.16.08",
      "1.16.03",
      "1.15.05",
      "1.15.04",
      "1.15.03",
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

  it("preserves every original version, publication date, release state and major flag", () => {
    const original = JSON.parse(readFileSync(new URL("../../../../docs/archive/announcements/历史公告-S16整理前-20261023.json", import.meta.url), "utf8")) as { announcements: UpdateAnnouncement[] };
    const identity = (entry: UpdateAnnouncement) => ({ version: entry.version, releasedAt: entry.releasedAt, status: entry.status, major: entry.major });
    const originalVersions = new Set(original.announcements.map((entry) => entry.version));
    const released = releasedAnnouncements();
    expect(released.filter((entry) => originalVersions.has(entry.version)).map(identity)).toEqual(
      original.announcements.map(identity),
    );
    expect(released[0]?.version).toBe("1.16.08");
    expect(released.filter((entry) => !originalVersions.has(entry.version)).map((entry) => entry.version)).toEqual([
      "1.16.08",
      "1.16.03",
    ]);
  });

  it.each(releasedAnnouncements())("$version has an independent title, overview and classified body", (entry) => {
    expect(entry.title).not.toMatch(/^Libevra\s+\d/);
    expect(entry.summary).not.toBe(entry.title);
    expect(entry.summary).not.toBe(entry.sections[0]?.items[0]);
    expect(entry.sections.length).toBeGreaterThan(0);
    expect(new Set(entry.sections.map(section => section.heading)).size).toBe(entry.sections.length);
    for (const section of entry.sections) {
      expect(["新增功能", "调整及优化", "问题修复", "注意事项"]).toContain(section.heading);
      expect(section.items.length).toBeGreaterThan(0);
      expect(section.items.every(item => item.trim().length > 0)).toBe(true);
    }
    if (entry.version === "1.16.08") {
      expect(entry.releasedAt).toBe("2026-10-24");
      expect(entry.revisedAt).toBeUndefined();
    } else {
      expect(entry.revisedAt).toBe("2026-10-23");
      expect(entry.revisedAt! >= entry.releasedAt!).toBe(true);
    }
    expect(JSON.stringify(entry)).not.toMatch(/更省心|更安心|感谢你|我们会继续|更顺手|更可靠/);
  });

  it("records specific changes without moving later features into older releases", () => {
    const paste = JSON.stringify(releasedAnnouncementByVersion("1.15.05"));
    expect(paste).toContain("粘贴识别与语音解析");
    expect(paste).toContain("无需重新录音");
    expect(paste).toContain("无法可靠拆分");
    const duplicates = JSON.stringify(releasedAnnouncementByVersion("1.15.03"));
    expect(duplicates).toContain("当前浏览器，不跨设备同步");
    expect(duplicates).toContain("不自动删除、合并或覆盖");
    expect(duplicates).toContain("不支持扫描版");
    expect(duplicates).toContain("重新检查");
    const earlier = JSON.stringify(releasedAnnouncementByVersion("1.15.00"));
    expect(earlier).not.toContain("新增全账本");
    expect(earlier).toContain("不检查整本账本");
    expect(earlier).not.toContain("粘贴识别");
    const ocr = JSON.stringify(releasedAnnouncementByVersion("1.14.20"));
    expect(ocr).toContain("60 秒");
    expect(ocr).toContain("不包含语音提速");
  });

  it("retains recovery and acknowledgement boundaries instead of making stronger promises", () => {
    const imported = JSON.stringify(releasedAnnouncementByVersion("1.14.18"));
    expect(imported).toContain("10 分钟");
    expect(imported).toContain("系统会尝试撤回");
    expect(imported).toContain("CSV/XLSX 文件导入是不同流程");
    expect(imported).toContain("不会自动删除");
    const safety = JSON.stringify(releasedAnnouncementByVersion("1.13.15"));
    expect(safety).toContain("恢复凭证不能用于恢复已注销账号");
    expect(safety).toContain("不表示正式隐私政策或使用条款已经提供");
    expect(safety).toContain("降低恢复历史备份时已删除账本、账号状态或权限变更意外失效的风险");
  });

  it("does not invent independent notices for versions without a bundled announcement", () => {
    expect(releasedAnnouncementByVersion("1.14.21")).toBeNull();
    expect(releasedAnnouncementByVersion("1.15.01")).toBeNull();
    expect(releasedAnnouncementByVersion("1.15.02")).toBeNull();
  });

  it("answers with the latest applicable release for a running version", () => {
    expect(latestApplicableAnnouncement("1.16.08")?.version).toBe("1.16.08");
    expect(latestApplicableAnnouncement("1.16.07")?.version).toBe("1.16.03");
    expect(latestApplicableAnnouncement("1.16.03")?.version).toBe("1.16.03");
    expect(latestApplicableAnnouncement("1.16.02")?.version).toBe("1.15.05");
    expect(latestApplicableAnnouncement("1.15.05")?.version).toBe("1.15.05");
    expect(latestApplicableAnnouncement("1.15.04")?.version).toBe("1.15.04");
    expect(latestApplicableAnnouncement("1.15.03")?.version).toBe("1.15.03");
    expect(latestApplicableAnnouncement("1.15.02")?.version).toBe("1.15.00");
    expect(latestApplicableAnnouncement("1.15.01")?.version).toBe("1.15.00");
    expect(latestApplicableAnnouncement("1.15.00")?.version).toBe("1.15.00");
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
    expect(hasNewerReleasedVersion("1.15.00")).toBe(true);
    expect(hasNewerReleasedVersion("1.15.02")).toBe(true);
    expect(hasNewerReleasedVersion("1.15.03")).toBe(true);
    expect(hasNewerReleasedVersion("1.15.04")).toBe(true);
    expect(hasNewerReleasedVersion("1.15.05")).toBe(true);
    expect(hasNewerReleasedVersion("1.16.03")).toBe(true);
    expect(hasNewerReleasedVersion("1.16.08")).toBe(false);
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
    expect(adjacentReleasedAnnouncements("1.16.08").newer).toBeNull();
    expect(adjacentReleasedAnnouncements("1.16.08").older?.version).toBe("1.16.03");
    expect(adjacentReleasedAnnouncements("1.16.03").newer?.version).toBe("1.16.08");
    expect(adjacentReleasedAnnouncements("1.16.03").older?.version).toBe("1.15.05");
    expect(adjacentReleasedAnnouncements("1.15.05").newer?.version).toBe("1.16.03");
    expect(adjacentReleasedAnnouncements("1.15.05").older?.version).toBe("1.15.04");
    expect(adjacentReleasedAnnouncements("1.15.04").newer?.version).toBe("1.15.05");
    expect(adjacentReleasedAnnouncements("1.15.04").older?.version).toBe("1.15.03");
    expect(adjacentReleasedAnnouncements("1.15.03").newer?.version).toBe("1.15.04");
    expect(adjacentReleasedAnnouncements("1.15.03").older?.version).toBe("1.15.00");
    expect(adjacentReleasedAnnouncements("1.15.00").newer?.version).toBe("1.15.03");
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
    expect(formatReleaseDate("2026-10-23")).toBe("2026年10月23日");
    expect(formatReleaseDate("2026-10-22")).toBe("2026年10月22日");
    expect(formatReleaseDate("2026-10-19")).toBe("2026年10月19日");
    expect(formatReleaseDate("2026-10-18")).toBe("2026年10月18日");
  });
});
