import { useCallback, useState } from "react";
import { Link } from "react-router";

import { InnerPage } from "../components/Layouts.js";
import { MoreIcon } from "../components/Icons.js";
import { UpdateMoreSheet } from "../components/UpdateMoreSheet.js";
import { APP_VERSION } from "../lib/version.js";
import { RecordList, RecordRow } from "../components/ui/RecordList.js";
import {
  compareVersions,
  formatReleaseDate,
  hasNewerReleasedVersion,
  latestApplicableAnnouncement,
  releasedAnnouncementByVersion,
  releasedAnnouncements,
} from "../lib/updateAnnouncements.js";

/**
 * The update centre's front page.
 *
 * ⚠️ **What is running, and what changed recently.** (S16-A widened the second half from one
 * announcement to a short list — see `RECENT_UPDATE_COUNT`.) Build stamps,
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

  /**
   * ⚠️ **S16-A：近期更新是一小段列表，而不是孤零零一条。** 所有者：*"目前首页只显示很少的信息，
   * 大量空间空置。请重新设计版本信息和近期更新的布局，提高可浏览性。"* 公告的数据与条目数量都没有
   * 改——这里只是把**已有的**公告按时间多列几条：最新一条展开（含各小节标题），其余几条各占一行。
   * 布局按 5–10 条设计（所有者说明的后续需求）；当前取 `RECENT_UPDATE_COUNT` 条，改这一个常量即可。
   * 仍然只列"不晚于当前运行版本"的公告——旧客户端不能声称知道比自己更新的版本。
   */
  const recent = releasedAnnouncements()
    .filter((announcement) => compareVersions(APP_VERSION, announcement.version) >= 0)
    .slice(0, RECENT_UPDATE_COUNT);
  const earlier = latest === null ? recent : recent.filter((announcement) => announcement.version !== latest.version);
  const totalReleased = releasedAnnouncements().length;

  return (
    <InnerPage
      title="软件更新"
      backTo="/me"
      actions={
        <button
          type="button"
          onClick={() => {
            setMoreOpen(true);
          }}
          aria-label="更多"
          className="flex size-11 items-center justify-center rounded-full text-muted transition hover:bg-brand-soft hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-soft"
        >
          <MoreIcon className="size-5" />
        </button>
      }
    >
      {/**
        * ⚠️ **当前版本是一个"摘要对象"，所以它仍是卡片**（布局规范 §9-A）；只是把三行零散的灰字
        * 收成一行状态 + 一行说明。
        */}
      <section className="flex flex-col gap-3 rounded-card border border-line bg-surface px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-helper text-muted">当前运行版本</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-ink tabular-nums">{APP_VERSION}</p>
            {currentAnnouncement?.releasedAt === undefined || currentAnnouncement.releasedAt === null ? null : (
              <p className="mt-1 text-helper text-muted">{formatReleaseDate(currentAnnouncement.releasedAt)} 发布</p>
            )}
          </div>
          <span className="shrink-0 rounded-full bg-brand-soft px-2.5 py-1 text-micro font-medium text-brand-dark">
            {statusLabel}
          </span>
        </div>
        <p className="border-t border-line pt-3 text-helper-relaxed text-muted">
          {statusText}
          {newerExists ? null : "版本来自当前运行的构建；本页不做服务器实时版本检查。"}
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="section-title text-ink">近期更新</h2>
          <Link to="/update/announcements" className="text-helper font-medium text-brand transition hover:text-brand-dark">
            全部公告 ›
          </Link>
        </div>

        {latest === null ? (
          <p className="text-body text-muted">还没有正式发布的公告。</p>
        ) : (
          <Link
            to={`/update/announcements/${latest.version}`}
            className="flex flex-col gap-2 rounded-card border border-line bg-surface px-5 py-4 transition hover:border-brand/40 hover:bg-brand-soft/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-soft"
          >
            <span className="flex items-baseline justify-between gap-3">
              <span className="font-mono text-helper font-medium text-muted">{latest.version}</span>
              {latest.releasedAt === null ? null : (
                <span className="shrink-0 text-helper text-muted">{formatReleaseDate(latest.releasedAt)}</span>
              )}
            </span>
            <span className="text-section-title text-ink">{latest.title}</span>
            <span className="text-body-relaxed text-muted">{latest.summary}</span>
            {latest.sections.length === 0 ? null : (
              <ul className="mt-1 flex flex-col gap-1.5 border-t border-line pt-3">
                {latest.sections.map((section) => (
                  <li key={section.heading} className="flex items-baseline gap-2 text-body text-ink">
                    <span aria-hidden="true" className="size-1.5 shrink-0 -translate-y-0.5 rounded-full bg-brand" />
                    <span className="min-w-0">{section.heading}</span>
                  </li>
                ))}
              </ul>
            )}
            <span className="mt-1 text-helper font-medium text-brand">查看更新公告 ›</span>
          </Link>
        )}

        {earlier.length === 0 ? null : (
          <div className="flex flex-col">
            <h3 className="pt-2 pb-1 text-helper font-medium text-muted">更早</h3>
            <RecordList label="更早的更新公告">
              {earlier.map((announcement) => (
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
            </RecordList>
            {totalReleased > recent.length ? (
              <Link
                to="/update/announcements"
                className="mt-1 self-start py-2 text-body font-medium text-brand transition hover:text-brand-dark"
              >
                查看全部 {String(totalReleased)} 条公告 ›
              </Link>
            ) : null}
          </div>
        )}
      </section>

      <UpdateMoreSheet open={moreOpen} onClose={closeMore} />
    </InnerPage>
  );
}

/** 软件更新首页列出的公告条数（含展开的最新一条）。后续需求是 5–10 条。 */
const RECENT_UPDATE_COUNT = 5;
