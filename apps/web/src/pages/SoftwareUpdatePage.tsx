import { useCallback, useState } from "react";
import { Link } from "react-router";

import { InnerPage } from "../components/Layouts.js";
import { MoreIcon } from "../components/Icons.js";
import { UpdateMoreSheet } from "../components/UpdateMoreSheet.js";
import { APP_VERSION } from "../lib/version.js";
import {
  formatReleaseDate,
  hasNewerReleasedVersion,
  latestApplicableAnnouncement,
  releasedAnnouncementByVersion,
} from "../lib/updateAnnouncements.js";

/**
 * The update centre's front page.
 *
 * ⚠️ **Two facts only: what is running, and the latest applicable announcement.** Build stamps,
 * cache sizes, Service Worker state and the copied diagnostic report used to be the first thing
 * on this screen; they now live behind `更多`, where somebody chasing a problem can still find
 * them without making every reader read them.
 *
 * ⚠️ **No live "latest version" claim.** There is no server-side update-check endpoint yet, and
 * the application bundle may itself be an old cached copy. The screen therefore says what it
 * knows from the current build and its bundled announcements, and says so plainly.
 */
export function SoftwareUpdatePage(): React.JSX.Element {
  const [moreOpen, setMoreOpen] = useState(false);
  const closeMore = useCallback(() => {
    setMoreOpen(false);
  }, []);

  const currentAnnouncement = releasedAnnouncementByVersion(APP_VERSION);
  const latest = latestApplicableAnnouncement(APP_VERSION);
  const newerExists = hasNewerReleasedVersion(APP_VERSION);
  const developmentBuild = import.meta.env.DEV;

  const statusLabel = currentAnnouncement === null
    ? developmentBuild
      ? "开发预览"
      : "运行版本"
    : "正式发布";

  const statusText = (() => {
    if (newerExists) {
      return "应用内置的公告记录中有较新的正式版本；本页没有连接服务器做实时检查。";
    }
    if (currentAnnouncement !== null) {
      return "这个版本已收录在发布公告中。";
    }
    if (developmentBuild) {
      return "这是本地开发构建，不代表已经正式发布。";
    }
    return "当前构建尚未收录在发布公告中。";
  })();

  return (
    <InnerPage
      title="软件更新"
      subtitle="当前版本和最近的更新内容。"
      backTo="/me"
      actions={
        <button
          type="button"
          onClick={() => {
            setMoreOpen(true);
          }}
          aria-label="更多"
          className="rounded-field p-2.5 text-muted transition hover:bg-brand-soft hover:text-ink"
        >
          <MoreIcon className="size-5" />
        </button>
      }
    >
      <section className="flex flex-col gap-2 rounded-card border border-line bg-surface px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-helper text-muted">当前运行版本</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-ink">{APP_VERSION}</p>
          </div>
          <span className="shrink-0 rounded-full bg-brand-soft px-2.5 py-1 text-micro font-medium text-brand-dark">
            {statusLabel}
          </span>
        </div>
        <p className="text-helper-relaxed text-muted">{statusText}</p>
        <p className="text-micro text-muted">
          版本来自当前运行的构建；本页不做服务器实时版本检查。
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="section-title text-ink">最近更新公告</h2>
          <Link to="/update/announcements" className="text-helper font-medium text-brand transition hover:text-brand-dark">
            全部公告 ›
          </Link>
        </div>

        {latest === null ? (
          <p className="rounded-card border border-line bg-surface px-4 py-3 text-body text-muted">
            还没有正式发布的公告。
          </p>
        ) : (
          <Link
            to={`/update/announcements/${latest.version}`}
            className="flex flex-col gap-2 rounded-card border border-line bg-surface px-4 py-3.5 transition hover:border-brand/40 hover:bg-brand-soft/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-soft"
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono text-sm font-medium text-ink">{latest.version}</span>
              {latest.releasedAt === null ? null : (
                <span className="text-helper text-muted">{formatReleaseDate(latest.releasedAt)}</span>
              )}
            </div>
            <p className="text-base font-medium text-ink">{latest.title}</p>
            <p className="text-helper-relaxed text-muted">{latest.summary}</p>
            <span className="mt-0.5 text-helper font-medium text-brand">查看更新公告 ›</span>
          </Link>
        )}
      </section>

      <UpdateMoreSheet open={moreOpen} onClose={closeMore} />
    </InnerPage>
  );
}
