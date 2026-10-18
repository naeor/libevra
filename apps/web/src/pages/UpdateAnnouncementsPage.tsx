import { Link } from "react-router";

import { InnerPage } from "../components/Layouts.js";
import { formatReleaseDate, releasedAnnouncements } from "../lib/updateAnnouncements.js";

/**
 * The announcement archive: only actual releases, newest first, at most ten.
 *
 * ⚠️ **No placeholders for older versions.** The owner's rule is ten *actual releases*, not ten
 * rows produced to fill a screen; if only two releases exist, two rows is the honest answer.
 */
export function UpdateAnnouncementsPage(): React.JSX.Element {
  const announcements = releasedAnnouncements();

  return (
    <InnerPage
      title="更新公告"
      subtitle="这里只列出已经正式发布的版本。"
      backTo="/update"
    >
      {announcements.length === 0 ? (
        <p className="rounded-card border border-line bg-surface px-4 py-3 text-body text-muted">
          还没有正式发布的公告。
        </p>
      ) : (
        <ul className="overflow-hidden rounded-card border border-line bg-surface">
          {announcements.map((announcement) => (
            <li key={announcement.version} className="border-b border-line last:border-b-0">
              <Link
                to={`/update/announcements/${announcement.version}`}
                className="flex items-start gap-3 px-4 py-4 transition hover:bg-canvas focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-soft"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="font-mono text-sm font-medium text-ink">{announcement.version}</span>
                    {announcement.releasedAt === null ? null : (
                      <span className="text-helper text-muted">
                        {formatReleaseDate(announcement.releasedAt)}
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block text-base font-medium text-ink">{announcement.title}</span>
                  <span className="mt-1 block text-helper-relaxed text-muted">{announcement.summary}</span>
                </span>
                <span aria-hidden="true" className="mt-1 shrink-0 text-lg leading-none text-muted">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </InnerPage>
  );
}
