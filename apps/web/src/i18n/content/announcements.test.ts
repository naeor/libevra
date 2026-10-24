import {
  RELEASE_MAJOR_ANNOUNCEMENT_1_14_18,
  TEST_LEGAL_DOCUMENT,
  activeLegalDocuments,
  activeMajorAnnouncements,
} from "@libellum/shared";
import { afterEach, describe, expect, it } from "vitest";

import { formatReleaseDate, releasedAnnouncementByVersion, releasedAnnouncements } from "../../lib/updateAnnouncements.js";
import { applyLocale } from "../index.js";
import { localizeMajorAnnouncement, localizeUpdateAnnouncement, sameAnnouncementShape } from "./index.js";
import { MAJOR_ANNOUNCEMENTS_EN } from "./majorAnnouncements.en.js";
import type { AnnouncementSectionText } from "./types.js";
import { UPDATE_ANNOUNCEMENTS_EN } from "./updateAnnouncements.en.js";

/**
 * S16：公告译文的完整性与显示规则。
 *
 * - 每条已发布的更新公告、每条重大公告（含本地测试公告）都有英文，且段落 / 分节 / 条目数量与中文一致；
 * - 英文里没有残留中文、没有空条目；没有指向不存在公告的多余译文；
 * - 中文界面原样返回；英文只替换文字，版本、日期、ID 等事实字段不变；
 * - 法律文本不翻译。
 */

const CJK = /[㐀-鿿豈-﫿]/u;

function texts(text: {
  readonly title: string;
  readonly summary: string;
  readonly intro?: readonly string[] | undefined;
  readonly sections: readonly AnnouncementSectionText[];
  readonly closing?: readonly string[] | undefined;
}): string[] {
  return [
    text.title,
    text.summary,
    ...(text.intro ?? []),
    ...text.sections.flatMap((section) => [section.heading, ...section.items]),
    ...(text.closing ?? []),
  ];
}

afterEach(() => {
  applyLocale("zh-CN");
});

describe("更新公告译文", () => {
  const released = releasedAnnouncements();

  it("每条已发布公告都有英文，结构与中文逐一对应", () => {
    expect(released.length).toBeGreaterThan(0);
    const missing = released.filter((announcement) => UPDATE_ANNOUNCEMENTS_EN[announcement.version] === undefined);
    expect(missing.map((announcement) => announcement.version)).toEqual([]);
    const mismatched = released.filter(
      (announcement) => !sameAnnouncementShape(announcement, UPDATE_ANNOUNCEMENTS_EN[announcement.version]!),
    );
    expect(mismatched.map((announcement) => announcement.version)).toEqual([]);
  });

  it("英文没有残留中文、没有空文字", () => {
    for (const [version, text] of Object.entries(UPDATE_ANNOUNCEMENTS_EN)) {
      for (const line of texts(text)) {
        expect(CJK.test(line), `${version}: ${line}`).toBe(false);
        expect(line.trim(), version).not.toBe("");
      }
    }
  });

  it("没有多余的译文（版本号拼错或公告已撤下）", () => {
    const versions = new Set(released.map((announcement) => announcement.version));
    expect(Object.keys(UPDATE_ANNOUNCEMENTS_EN).filter((version) => !versions.has(version))).toEqual([]);
  });

  it("中文界面原样返回；英文只替换文字，事实字段不变", () => {
    const original = releasedAnnouncementByVersion("1.16.08")!;
    expect(localizeUpdateAnnouncement(original)).toBe(original);

    applyLocale("en-US");
    const english = localizeUpdateAnnouncement(original);
    expect(english.title).toBe("Seven themes and dark mode");
    expect(english.sections[0]!.items[0]).toContain("Settings → Display & data → Appearance");
    expect(english.version).toBe(original.version);
    expect(english.releasedAt).toBe(original.releasedAt);
    expect(english.status).toBe(original.status);
    expect(english.major).toBe(original.major);
    expect(english.revisedAt).toBe(original.revisedAt);
    // 原对象不被改动。
    expect(original.title).toBe("七套主题与深色外观");
  });

  it("没有译文或结构对不上时显示中文原文", () => {
    applyLocale("en-US");
    const unknown = { ...releasedAnnouncementByVersion("1.16.08")!, version: "9.99.99" };
    expect(localizeUpdateAnnouncement(unknown)).toBe(unknown);
    const revised = { ...releasedAnnouncementByVersion("1.16.08")!, sections: [] };
    expect(localizeUpdateAnnouncement(revised)).toBe(revised);
  });

  it("发布日期：中文输出不变，英文按 Intl 显示", () => {
    expect(formatReleaseDate("2026-10-24")).toBe("2026年10月24日");
    applyLocale("en-US");
    expect(formatReleaseDate("2026-10-24")).toBe("Oct 24, 2026");
    expect(formatReleaseDate("2026-01-05")).toBe("Jan 5, 2026");
    expect(formatReleaseDate("not-a-date")).toBe("not-a-date");
  });
});

describe("重大公告译文", () => {
  const majors = activeMajorAnnouncements(true);

  it("每条重大公告（含本地测试公告）都有英文，结构与中文逐一对应", () => {
    expect(majors.length).toBeGreaterThanOrEqual(3);
    expect(majors.filter((announcement) => MAJOR_ANNOUNCEMENTS_EN[announcement.id] === undefined).map((a) => a.id)).toEqual([]);
    expect(
      majors.filter((announcement) => !sameAnnouncementShape(announcement, MAJOR_ANNOUNCEMENTS_EN[announcement.id]!)).map((a) => a.id),
    ).toEqual([]);
  });

  it("英文没有残留中文、没有空文字，也没有多余译文", () => {
    for (const [id, text] of Object.entries(MAJOR_ANNOUNCEMENTS_EN)) {
      for (const line of texts(text)) {
        expect(CJK.test(line), `${id}: ${line}`).toBe(false);
        expect(line.trim(), id).not.toBe("");
      }
    }
    const ids = new Set(majors.map((announcement) => announcement.id));
    expect(Object.keys(MAJOR_ANNOUNCEMENTS_EN).filter((id) => !ids.has(id))).toEqual([]);
  });

  it("中文原样返回；英文保留 ID、版本、发布时间与测试标记（以及服务器附带的其它字段）", () => {
    const withExtra = { ...RELEASE_MAJOR_ANNOUNCEMENT_1_14_18, acknowledged: false };
    expect(localizeMajorAnnouncement(withExtra)).toBe(withExtra);

    applyLocale("en-US");
    const english = localizeMajorAnnouncement(withExtra);
    expect(english.summary).toBe("Move your entries freely, with more peace of mind at every step.");
    expect(english.id).toBe(withExtra.id);
    expect(english.version).toBe(withExtra.version);
    expect(english.publishedAt).toBe(withExtra.publishedAt);
    expect(english.testOnly).toBe(withExtra.testOnly);
    expect(english.acknowledged).toBe(false);
  });

  it("服务器下发的公告已修订、结构对不上时显示中文原文", () => {
    applyLocale("en-US");
    const revised = {
      ...RELEASE_MAJOR_ANNOUNCEMENT_1_14_18,
      sections: [...RELEASE_MAJOR_ANNOUNCEMENT_1_14_18.sections, { heading: "新增一节", items: ["新条目"] }],
    };
    expect(localizeMajorAnnouncement(revised)).toBe(revised);
  });

  it("法律文本不翻译", () => {
    expect(activeLegalDocuments(true)).toContain(TEST_LEGAL_DOCUMENT);
    expect(Object.keys(MAJOR_ANNOUNCEMENTS_EN)).not.toContain(TEST_LEGAL_DOCUMENT.id);
    expect(Object.keys(UPDATE_ANNOUNCEMENTS_EN)).not.toContain(TEST_LEGAL_DOCUMENT.id);
  });
});
