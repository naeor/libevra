/**
 * **公告类内容的本地化（S16 国际化）。**
 *
 * 更新公告（`lib/updateAnnouncements.ts`）与重大公告（`@libellum/shared` 的 `consent.ts`，由服务器下发）
 * 是成段的产品说明，不适合拆成一条条界面文案。这里按版本 / ID 提供整篇英文，显示时整篇替换；
 * 没有译文的公告原样显示中文。
 *
 * ⚠️ 法律文本（隐私政策、使用条款、协议确认）**不在这里翻译**：用户同意的是中文原文（内容哈希即中文版本），
 * 英文译本需要专业审核后另行处理（路线图 S16-C-10）。
 */
import type { MajorAnnouncement } from "@libellum/shared";

import type { UpdateAnnouncement } from "../../lib/updateAnnouncements.js";

/** 更新公告按当前语言显示。没有译文时原样返回。 */
export function localizeUpdateAnnouncement(announcement: UpdateAnnouncement): UpdateAnnouncement {
  return announcement;
}

/** 重大公告按当前语言显示。没有译文时原样返回。 */
export function localizeMajorAnnouncement<T extends MajorAnnouncement>(announcement: T): T {
  return announcement;
}
