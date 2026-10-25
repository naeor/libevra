/**
 * **公告类内容的本地化（S16 国际化）。**
 *
 * 更新公告（`lib/updateAnnouncements.ts`）与重大公告（`@libellum/shared` 的 `consent.ts`，由服务器下发）
 * 是成段的产品说明，不适合拆成一条条界面文案。这里按版本 / ID 提供整篇英文，显示时整篇替换；
 * 没有译文的公告原样显示中文。
 *
 * 规则：
 * - 中文界面原样返回（同一个对象，不复制）；
 * - 只替换文字（标题、摘要、开头 / 结尾段落、各节标题与条目），版本号、日期、是否重大、ID 等
 *   事实字段保持原值——确认记录、排序、弹窗判断都不受语言影响；
 * - 译文的段落 / 分节 / 条目数量与原文对不上（例如中文公告修订后英文没跟上）时，整篇显示中文原文，
 *   不拼出一篇半中半英或缺条目的公告。
 *
 * ⚠️ 法律文本（隐私政策、使用条款、协议确认）**不在这里翻译**：用户同意的是中文原文（内容哈希即中文版本），
 * 英文译本需要专业审核后另行处理（路线图 S16-G-10）。
 */
import type { MajorAnnouncement } from "@libellum/shared";

import type { UpdateAnnouncement } from "../../lib/updateAnnouncements.js";
import { currentLocale, isChineseLocale, type Locale } from "../index.js";
import { MAJOR_ANNOUNCEMENTS_EN } from "./majorAnnouncements.en.js";
import type { AnnouncementSectionText, MajorAnnouncementText, UpdateAnnouncementText } from "./types.js";
import { UPDATE_ANNOUNCEMENTS_EN } from "./updateAnnouncements.en.js";

/** 各语言的更新公告译文（键：版本号）。 */
const UPDATE_TRANSLATIONS: Partial<Record<Locale, Readonly<Record<string, UpdateAnnouncementText>>>> = {
  "en-US": UPDATE_ANNOUNCEMENTS_EN,
};

/** 各语言的重大公告译文（键：公告 ID）。 */
const MAJOR_TRANSLATIONS: Partial<Record<Locale, Readonly<Record<string, MajorAnnouncementText>>>> = {
  "en-US": MAJOR_ANNOUNCEMENTS_EN,
};

interface AnnouncementShape {
  readonly intro?: readonly string[] | undefined;
  readonly sections: readonly { readonly items: readonly string[] }[];
  readonly closing?: readonly string[] | undefined;
}

/** 译文与原文的段落、分节、条目数量是否逐一对应。 */
export function sameAnnouncementShape(source: AnnouncementShape, text: AnnouncementShape): boolean {
  if ((source.intro?.length ?? 0) !== (text.intro?.length ?? 0)) return false;
  if ((source.closing?.length ?? 0) !== (text.closing?.length ?? 0)) return false;
  if (source.sections.length !== text.sections.length) return false;
  return source.sections.every((section, index) => section.items.length === text.sections[index]?.items.length);
}

const reported = new Set<string>();

function reportMismatch(kind: "update" | "major", key: string): void {
  if (import.meta.env?.DEV !== true || reported.has(`${kind}:${key}`)) return;
  reported.add(`${kind}:${key}`);
  console.warn(`[i18n] ${kind} announcement ${key}：译文与原文结构不一致，已显示原文。`); // i18n-ignore：开发者日志
}

function copySections(sections: readonly AnnouncementSectionText[]): AnnouncementSectionText[] {
  return sections.map((section) => ({ heading: section.heading, items: [...section.items] }));
}

/** 更新公告按当前语言显示。没有译文时原样返回。 */
export function localizeUpdateAnnouncement(announcement: UpdateAnnouncement): UpdateAnnouncement {
  const locale = currentLocale();
  if (isChineseLocale(locale)) return announcement;
  const text = UPDATE_TRANSLATIONS[locale]?.[announcement.version];
  if (text === undefined) return announcement;
  if (!sameAnnouncementShape(announcement, text)) {
    reportMismatch("update", announcement.version);
    return announcement;
  }
  return {
    ...announcement,
    title: text.title,
    summary: text.summary,
    sections: copySections(text.sections),
    ...(text.intro === undefined ? {} : { intro: [...text.intro] }),
    ...(text.closing === undefined ? {} : { closing: [...text.closing] }),
  };
}

/** 重大公告按当前语言显示。没有译文时原样返回。 */
export function localizeMajorAnnouncement<T extends MajorAnnouncement>(announcement: T): T {
  const locale = currentLocale();
  if (isChineseLocale(locale)) return announcement;
  const text = MAJOR_TRANSLATIONS[locale]?.[announcement.id];
  if (text === undefined) return announcement;
  if (!sameAnnouncementShape(announcement, text)) {
    reportMismatch("major", announcement.id);
    return announcement;
  }
  return {
    ...announcement,
    title: text.title,
    summary: text.summary,
    sections: copySections(text.sections),
  };
}
