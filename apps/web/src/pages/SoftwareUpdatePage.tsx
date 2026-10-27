import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { InnerPage } from "../components/Layouts.js";
import { MoreIcon } from "../components/Icons.js";
import { UpdateMoreSheet } from "../components/UpdateMoreSheet.js";
import { localizeUpdateAnnouncement } from "../i18n/content/index.js";
import { useI18n } from "../i18n/index.js";
import { APP_VERSION, formatAppVersion } from "../lib/version.js";
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

  const { t } = useI18n();
  const currentAnnouncement = releasedAnnouncementByVersion(APP_VERSION);
  /**
   * S16：判断与排序用原始公告（版本号、日期与语言无关）；显示的标题 / 摘要 / 小节走
   * `localizeUpdateAnnouncement()`，没有译文时原样返回中文。
   */
  const latestSource = latestApplicableAnnouncement(APP_VERSION);
  const latest = latestSource === null ? null : localizeUpdateAnnouncement(latestSource);
  const newerExists = hasNewerReleasedVersion(APP_VERSION);
  const developmentBuild = import.meta.env.DEV;
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewLines, setPreviewLines] = useState(6);

  // Fit whole lines into the reserved preview space; the link remains outside the clamp.
  // 依赖原始公告对象（稳定引用），本地化后的副本每次渲染都可能是新对象。
  useEffect(() => {
    const element = previewRef.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
      if (lineHeight > 0) setPreviewLines(Math.max(1, Math.floor(element.clientHeight / lineHeight)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [latestSource]);

  const statusLabel = currentAnnouncement === null
    ? developmentBuild
      ? t("update.home.status.development")
      : t("update.home.status.running")
    : t("update.home.status.released");

  const statusText = (() => {
    if (newerExists) {
      return t("update.home.statusText.newer");
    }
    if (currentAnnouncement !== null) {
      return "";
    }
    if (developmentBuild) {
      return t("update.home.statusText.development");
    }
    return t("update.home.statusText.unlisted");
  })();

  /**
   * 首页以本期公告为主，下方补充五个历史版本，与「全部公告」的完整目录区分。
   * 历史摘要读取独立的 summary 字段，不从正文自动截取；公告数据保持不变。
   * 仍然只列不晚于当前运行版本的公告。
   */
  const recent = releasedAnnouncements()
    .filter((announcement) => compareVersions(APP_VERSION, announcement.version) >= 0 && announcement.version !== latest?.version)
    .slice(0, RECENT_UPDATE_COUNT)
    .map((announcement) => localizeUpdateAnnouncement(announcement));

  return (
    <InnerPage
      title={t("update.home.title")}
      backTo="/me"
      actions={
        <button
          type="button"
          onClick={() => {
            setMoreOpen(true);
          }}
          aria-label={t("update.home.more")}
          className="flex size-11 items-center justify-center rounded-full text-muted transition hover:bg-brand-soft hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring"
        >
          <MoreIcon className="size-5" />
        </button>
      }
    >
      <article aria-label={t("update.home.previewLabel")} className="flex h-[min(30rem,60svh)] min-h-80 flex-col gap-4 border-b border-line py-5">
      <section aria-label={t("update.home.statusLabel")} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 items-baseline gap-2">
            <span aria-label={t("update.home.currentVersion", { version: formatAppVersion() })} className="text-3xl font-semibold tracking-tight text-ink tabular-nums">{formatAppVersion()}</span>
          </div>
          <span className="shrink-0 rounded-full bg-brand-soft px-2.5 py-1 text-micro font-medium text-brand-dark">
            {statusLabel}
          </span>
        </div>
        {statusText ? <p className="text-helper-relaxed text-muted">{statusText}</p> : null}
      </section>

      {latest === null ? (
        <p className="text-body text-muted">{t("update.home.noAnnouncements")}</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <header className="flex flex-col gap-2">
            <h2 className="text-section-title text-ink">{latest.title}</h2>
            {latest.releasedAt === null ? null : <time className="text-helper text-muted" dateTime={latest.releasedAt}>{formatReleaseDate(latest.releasedAt)}</time>}
          </header>
          <div ref={previewRef} className="min-h-0 flex-1 overflow-hidden text-body-relaxed text-muted">
            <p className="line-clamp-(--preview-lines)" style={{ "--preview-lines": previewLines } as React.CSSProperties}>
              {latest.summary}<br /><br />
              {latest.sections.map((section, index) => (
                <Fragment key={section.heading}>
                  {index > 0 ? <><br /><br /></> : null}
                  <span className="font-medium text-ink">{section.heading}</span><br />
                  {section.items.join(" ")}
                </Fragment>
              ))}
            </p>
          </div>
          <Link
            to={`/update/announcements/${latest.version}`}
            className="flex min-h-11 shrink-0 items-center self-start text-helper font-medium text-brand transition hover:text-brand-dark"
          >
            {t("update.home.readFull")}
          </Link>
        </div>
      )}
      </article>

      <section className="flex flex-col gap-3">
        {/* S16：英文标题与链接都更长，窄屏时链接换到下一行而不是挤压标题 */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="section-title min-w-0 text-ink">{t("update.home.recent")}</h2>
          <Link to="/update/announcements" className="text-helper font-medium text-brand transition hover:text-brand-dark">
            {t("update.home.all")}
          </Link>
        </div>

        {recent.length === 0 ? null : (
          <div className="[&>ul>li>a]:gap-0.5 [&>ul>li>a]:py-2.5">
            <RecordList label={t("update.home.recent")}>
              {recent.map((announcement) => (
                <RecordRow
                  key={announcement.version}
                  eyebrow={<span className="tabular-nums">{announcement.version}</span>}
                  aside={announcement.releasedAt === null ? undefined : formatReleaseDate(announcement.releasedAt)}
                  primary={announcement.title}
                  title={announcement.title}
                  preview={announcement.summary}
                  strong
                  to={`/update/announcements/${announcement.version}`}
                />
              ))}
            </RecordList>
          </div>
        )}
        <p className="text-helper text-muted">{t("update.home.source")}</p>
      </section>

      <UpdateMoreSheet open={moreOpen} onClose={closeMore} />
    </InnerPage>
  );
}

/** 本期公告之外再展示五个版本，完整历史通过「全部公告」进入。 */
const RECENT_UPDATE_COUNT = 5;
