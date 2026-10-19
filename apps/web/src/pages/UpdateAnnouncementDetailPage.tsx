import { Link, useParams } from "react-router";
import { TEST_MAJOR_ANNOUNCEMENT } from "@libellum/shared";

import { InnerPage } from "../components/Layouts.js";
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

  const announcement = (version === undefined ? null : releasedAnnouncementByVersion(version)) ?? testMajor;

  if (announcement === null) {
    return (
      <InnerPage title="版本公告" subtitle="这个版本没有可查看的正式公告。" backTo="/update/announcements">
        <p className="rounded-card border border-line bg-surface px-4 py-3 text-body text-muted">
          也许这个版本还未正式发布，或者链接有误。
        </p>
        <Link to="/update/announcements" className="text-body font-medium text-brand">
          返回更新公告
        </Link>
      </InnerPage>
    );
  }

  const { older, newer } = adjacentReleasedAnnouncements(announcement.version);

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
      <section className="flex flex-col gap-2 rounded-card border border-line bg-surface px-4 py-3.5">
        <p className="text-helper-relaxed text-muted">{announcement.summary}</p>
      </section>

      {announcement.intro === undefined ? null : (
        <section className="flex flex-col gap-3 px-1 text-body-relaxed text-ink">
          {announcement.intro.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </section>
      )}

      {announcement.sections.map((section) => (
        <section key={section.heading} className="flex flex-col gap-2 rounded-card border border-line bg-surface px-4 py-3.5">
          <h2 className="text-sm font-semibold text-ink">{section.heading}</h2>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-body-relaxed text-ink marker:text-brand">
            {section.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}

      {announcement.closing === undefined ? null : (
        <section className="flex flex-col gap-3 px-1 text-body-relaxed text-ink">
          {announcement.closing.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </section>
      )}

      {older === null && newer === null ? null : (
        <nav aria-label="版本导航" className="grid gap-3 sm:grid-cols-2">
          {older === null ? null : (
            <Link
              to={`/update/announcements/${older.version}`}
              className="flex min-w-0 flex-col gap-1 rounded-card border border-line bg-surface px-4 py-3 transition hover:bg-canvas focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-soft"
            >
              <span className="text-helper text-muted">上一版本</span>
              <span className="truncate text-sm font-medium text-ink">
                {older.version} · {older.title}
              </span>
            </Link>
          )}
          {newer === null ? null : (
            <Link
              to={`/update/announcements/${newer.version}`}
              className="flex min-w-0 flex-col gap-1 rounded-card border border-line bg-surface px-4 py-3 text-right transition hover:bg-canvas focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-soft sm:col-start-2"
            >
              <span className="text-helper text-muted">下一版本</span>
              <span className="truncate text-sm font-medium text-ink">
                {newer.version} · {newer.title}
              </span>
            </Link>
          )}
        </nav>
      )}

      <Link to="/update/announcements" className="text-body font-medium text-brand">
        返回更新公告
      </Link>
    </InnerPage>
  );
}
