import { Link, useParams } from "react-router";
import { TEST_MAJOR_ANNOUNCEMENT } from "@libellum/shared";

import { InnerPage } from "../components/Layouts.js";
import { ListGroup, ListRow } from "../components/ui/List.js";
import { localizeUpdateAnnouncement } from "../i18n/content/index.js";
import { useI18n } from "../i18n/index.js";
import {
  adjacentReleasedAnnouncements,
  formatReleaseDate,
  releasedAnnouncementByVersion,
  type UpdateAnnouncement,
} from "../lib/updateAnnouncements.js";

/**
 * One release's full announcement.
 *
 * The version is in the URL so refresh, direct links and the browser's back button all land on
 * the same release. Unreleased versions deliberately do not fall through to a preview here.
 */
export function UpdateAnnouncementDetailPage(): React.JSX.Element {
  const { version } = useParams<{ readonly version: string }>();
  const { t } = useI18n();

  /**
   * The local major-announcement test has a synthetic version and is not part of the real release
   * history. It still gets the same full-detail page during the local flow test; a production build
   * (`import.meta.env.DEV === false`) never falls through to it.
   */
  const testMajor: UpdateAnnouncement | null =
    import.meta.env.DEV && version === TEST_MAJOR_ANNOUNCEMENT.version
      ? {
          version: TEST_MAJOR_ANNOUNCEMENT.version,
          releasedAt: TEST_MAJOR_ANNOUNCEMENT.publishedAt.slice(0, 10),
          status: "released",
          title: TEST_MAJOR_ANNOUNCEMENT.title,
          summary: TEST_MAJOR_ANNOUNCEMENT.summary,
          sections: TEST_MAJOR_ANNOUNCEMENT.sections,
          major: true,
        }
      : null;

  const source = (version === undefined ? null : releasedAnnouncementByVersion(version)) ?? testMajor;

  if (source === null) {
    return (
      <InnerPage title={t("update.detail.missingTitle")} subtitle={t("update.detail.missingSubtitle")} backTo="/update/announcements">
        <p className="rounded-card border border-line bg-surface px-4 py-3 text-body text-muted">
          {t("update.detail.missingBody")}
        </p>
        <Link to="/update/announcements" className="text-body font-medium text-brand">
          {t("update.detail.back")}
        </Link>
      </InnerPage>
    );
  }

  /** S16：版本号、日期、前后版本按原始公告决定；显示的文字走本地化（没有译文时原样返回）。 */
  const announcement = localizeUpdateAnnouncement(source);
  const adjacent = adjacentReleasedAnnouncements(source.version);
  const older = adjacent.older === null ? null : localizeUpdateAnnouncement(adjacent.older);
  const newer = adjacent.newer === null ? null : localizeUpdateAnnouncement(adjacent.newer);

  return (
    <InnerPage
      title={announcement.title}
      subtitle={
        announcement.releasedAt === null
          ? announcement.version
          : `${announcement.version} · ${formatReleaseDate(announcement.releasedAt)}`
      }
      backTo="/update/announcements"
    >
      {/**
        * ⚠️ **S16-A：公告是一篇短文，按文章排，而不是一叠卡片。** 摘要是导语（不再单独装框），
        * 每个小节用标题 + 细线分隔；版本导航是两行可点的列表。
        */}
      <p className="text-body-relaxed text-muted">{announcement.summary}</p>

      {announcement.revisedAt === undefined ? null : (
        <p className="text-helper-relaxed text-muted">
          {t("update.detail.revised", { date: formatReleaseDate(announcement.revisedAt) })}
        </p>
      )}

      {announcement.intro === undefined ? null : (
        <section className="flex flex-col gap-3 text-body-relaxed text-ink">
          {announcement.intro.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </section>
      )}

      {announcement.sections.map((section) => (
        <section key={section.heading} className="flex flex-col gap-2 border-t border-line pt-5">
          <h2 className="text-section-title text-ink">{section.heading}</h2>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-body-relaxed text-ink marker:text-brand">
            {section.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}

      {announcement.closing === undefined ? null : (
        <section className="flex flex-col gap-3 border-t border-line pt-5 text-body-relaxed text-ink">
          {announcement.closing.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </section>
      )}

      {older === null && newer === null ? null : (
        <nav aria-label={t("update.detail.navLabel")}>
          <ListGroup>
            {newer === null ? null : (
              <ListRow
                label={<span className="block truncate">{newer.version} · {newer.title}</span>}
                detail={t("update.detail.newer")}
                to={`/update/announcements/${newer.version}`}
              />
            )}
            {older === null ? null : (
              <ListRow
                label={<span className="block truncate">{older.version} · {older.title}</span>}
                detail={t("update.detail.older")}
                to={`/update/announcements/${older.version}`}
              />
            )}
          </ListGroup>
        </nav>
      )}

      <Link to="/update/announcements" className="self-start text-body font-medium text-brand">
        {t("update.detail.back")}
      </Link>
    </InnerPage>
  );
}
