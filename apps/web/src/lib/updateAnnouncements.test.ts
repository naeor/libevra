import { describe, expect, it } from "vitest";

import {
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
  it("contains only the two actual releases, newest first", () => {
    const released = releasedAnnouncements();
    expect(released.map((entry) => entry.version)).toEqual(["1.13.08", "1.13.07"]);
    expect(released.every((entry) => entry.status === "released" && entry.releasedAt !== null)).toBe(true);
  });

  it("does not invent an announcement for the current development build", () => {
    expect(releasedAnnouncementByVersion("1.13.09")).toBeNull();
  });

  it("answers with the latest applicable release for a running version", () => {
    expect(latestApplicableAnnouncement("1.13.09")?.version).toBe("1.13.08");
    expect(latestApplicableAnnouncement("1.13.08")?.version).toBe("1.13.08");
    expect(latestApplicableAnnouncement("1.13.07")?.version).toBe("1.13.07");
    expect(latestApplicableAnnouncement("1.13.06")).toBeNull();
  });

  it("detects a newer released version without claiming the running build is current", () => {
    expect(hasNewerReleasedVersion("1.13.07")).toBe(true);
    expect(hasNewerReleasedVersion("1.13.08")).toBe(false);
    expect(hasNewerReleasedVersion("1.13.09")).toBe(false);
  });

  it("caps history at ten actual releases and skips development-only entries", () => {
    const entries: UpdateAnnouncement[] = [
      announcement("1.13.30", null),
      ...Array.from({ length: 12 }, (_, index) => {
        const day = String(12 - index).padStart(2, "0");
        return announcement(`1.13.${String(20 - index)}`, `2026-10-${day}`);
      }),
    ];
    const released = releasedAnnouncements(entries);
    expect(released).toHaveLength(10);
    expect(released.some((entry) => entry.version === "1.13.30")).toBe(false);
  });

  it("formats the publication date without inventing a time or timezone", () => {
    expect(formatReleaseDate("2026-10-18")).toBe("2026年10月18日");
  });
});
