/**
 * 公告译文的结构：只含**文字**，版本号、日期、是否重大等事实字段一律取自原文。
 *
 * ⚠️ 段落数、分节数、每节条目数必须与中文原文一一对应（`content/index.ts` 显示前核对，
 * 对不上就整篇显示中文原文；`announcements.test.ts` 在测试里拦截）。
 */
export interface AnnouncementSectionText {
  readonly heading: string;
  readonly items: readonly string[];
}

/** 更新公告（`lib/updateAnnouncements.ts`）的译文。 */
export interface UpdateAnnouncementText {
  readonly title: string;
  readonly summary: string;
  readonly intro?: readonly string[];
  readonly sections: readonly AnnouncementSectionText[];
  readonly closing?: readonly string[];
}

/** 重大公告（`@libellum/shared` 的 `consent.ts`，由服务器下发）的译文。 */
export interface MajorAnnouncementText {
  readonly title: string;
  readonly summary: string;
  readonly sections: readonly AnnouncementSectionText[];
}
