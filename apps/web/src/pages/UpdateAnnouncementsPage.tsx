import { useState } from "react";

import { InnerPage } from "../components/Layouts.js";
import { RecordGroup, RecordRow } from "../components/ui/RecordList.js";
import { localizeUpdateAnnouncement } from "../i18n/content/index.js";
import { useI18n } from "../i18n/index.js";
import {
  ANNOUNCEMENT_PAGE_SIZE,
  formatReleaseDate,
  releasedAnnouncements,
  type UpdateAnnouncement,
} from "../lib/updateAnnouncements.js";

/**
 * The announcement archive: actual releases, newest first.
 *
 * The first 20 rows are the default view. If history grows beyond that, the
 * remaining releases stay reachable through the "显示更早公告" control rather
 * than being dropped from the bundled data or silently truncated.
 *
 * ⚠️ **No placeholders for older versions.** The owner's rule is actual
 * releases, not rows produced to fill a screen; if only two releases exist, two
 * rows is the honest answer.
 *
 * ⚠️ **S16-A：记录，而不是一叠白卡片。** 所有者：*"连续白底卡片与分割线过于机械。请优化版本、日期、
 * 标题、预览文字之间的视觉关系，增强历史列表的阅读体验。"* 现在每条是：版本号（等宽小字）与日期在
 * 同一行，标题一行，预览最多两行；按 `1.15`、`1.14` 这样的版本系列分组，组标题滚动时吸顶。
 * 预览读取独立撰写的 `summary`，不截取正文，也不从标题解析版本号。
 */
export function UpdateAnnouncementsPage(): React.JSX.Element {
  const announcements = releasedAnnouncements();
  const [visibleCount, setVisibleCount] = useState(ANNOUNCEMENT_PAGE_SIZE);
  const visible = announcements.slice(0, visibleCount);
  const olderCount = announcements.length - visible.length;
  const { t } = useI18n();

  return (
    <InnerPage title={t("update.announcements.title")} subtitle={t("update.announcements.subtitle")} backTo="/update">
      {announcements.length === 0 ? (
        <p className="text-body text-muted">{t("update.announcements.empty")}</p>
      ) : (
        <div className="flex flex-col">
          {groupBySeries(visible).map((group) => (
            <RecordGroup key={group.series} heading={t("update.announcements.series", { series: group.series })}>
              {group.items.map((source) => localizeUpdateAnnouncement(source)).map((announcement) => (
                <RecordRow
                  key={announcement.version}
                  eyebrow={<span className="font-mono">{announcement.version}</span>}
                  aside={announcement.releasedAt === null ? undefined : formatReleaseDate(announcement.releasedAt)}
                  primary={announcement.title}
                  preview={announcement.summary}
                  strong
                  to={`/update/announcements/${announcement.version}`}
                />
              ))}
            </RecordGroup>
          ))}
        </div>
      )}

      {olderCount > 0 ? (
        <button
          type="button"
          onClick={() => setVisibleCount((current) => current + ANNOUNCEMENT_PAGE_SIZE)}
          className="self-start text-left text-body font-medium text-brand"
        >
          {t("update.announcements.showOlder", { count: olderCount })}
        </button>
      ) : null}
    </InnerPage>
  );
}

/**
 * Newest-first announcements → runs of the same `major.minor` series ("1.15", "1.14", …).
 *
 * ⚠️ **Runs, not buckets**: the list is already ordered by release date, so a series heading appears
 * where that series starts in time. Re-bucketing would reorder releases if a patch of an older series
 * ever shipped after a newer series — the date order is the fact this page reports.
 */
function groupBySeries(
  announcements: readonly UpdateAnnouncement[],
): { readonly series: string; readonly items: UpdateAnnouncement[] }[] {
  const groups: { series: string; items: UpdateAnnouncement[] }[] = [];

  for (const announcement of announcements) {
    const series = announcement.version.split(".").slice(0, 2).join(".");
    const last = groups[groups.length - 1];
    if (last !== undefined && last.series === series) last.items.push(announcement);
    else groups.push({ series, items: [announcement] });
  }

  return groups;
}
