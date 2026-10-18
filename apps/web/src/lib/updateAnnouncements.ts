/**
 * Version announcements bundled with the application.
 *
 * ⚠️ **Only actual production releases belong here.** A version that is still being developed
 * must not appear as released, and a release date must never be guessed. The list is deliberately
 * local and static for now: there is no server-side announcement service, no database table, and
 * no auto-popup. A future major-update reminder can build on `major`, but nothing in this file
 * marks a reminder as shown or read.
 */
export interface UpdateAnnouncement {
  /** The exact version users saw in production, e.g. "1.13.07". */
  readonly version: string;
  /** Publication date, or null while a version is not released yet. */
  readonly releasedAt: string | null;
  readonly status: "released" | "development";
  readonly title: string;
  /** One or two sentences for the home card and the history row. */
  readonly summary: string;
  /** Full announcement, grouped under short headings. */
  readonly sections: readonly {
    readonly heading: string;
    readonly items: readonly string[];
  }[];
  /** Reserved for a future, dismissible once-per-device major-update notice. */
  readonly major: boolean;
}

/**
 * 1.13.09 is the S13-F release; 1.13.08 was a production patch (card layout) and 1.13.07 was the
 * full S13-E release. All are production releases on 2026-10-18.
 */
const ALL_ANNOUNCEMENTS: readonly UpdateAnnouncement[] = [
  {
    version: "1.13.09",
    releasedAt: "2026-10-18",
    status: "released",
    title: "软件更新与版本公告",
    summary: "重新设计了软件更新页面，并新增版本公告历史与运行信息入口。",
    sections: [
      {
        heading: "软件更新",
        items: [
          "软件更新首页现在显示当前运行版本和最近一次更新公告。",
          "新增更新公告列表与单个版本详情，支持返回和直接刷新。",
          "右上角「更多」可以复制版本信息或查看运行信息。",
        ],
      },
    ],
    major: false,
  },
  {
    version: "1.13.08",
    releasedAt: "2026-10-18",
    status: "released",
    title: "界面与使用体验优化",
    summary: "优化了移动端当前账本卡片的布局，单人账本更紧凑，协作账本切换更顺手。",
    sections: [
      {
        heading: "当前账本卡片",
        items: [
          "单人账本改为左右布局，切换账本按钮回到卡片右侧。",
          "协作账本的切换操作收为紧凑横栏，减少操作区占用的高度。",
          "较长的账本名称改为换行显示，不再被省略。",
        ],
      },
    ],
    major: false,
  },
  {
    version: "1.13.07",
    releasedAt: "2026-10-18",
    status: "released",
    title: "账本管理与协作优化",
    summary: "重新整理了账本详情与设置，并让分类、标签和支付方式跟随账本独立管理。",
    sections: [
      {
        heading: "账本与设置",
        items: [
          "重新整理了账本详情与设置页面。",
          "分类、标签和支付方式改为按账本独立管理。",
        ],
      },
      {
        heading: "协作与记录",
        items: [
          "优化了多人协作权限与离线使用体验。",
          "改进了历史记录与管理操作的展示。",
        ],
      },
    ],
    major: false,
  },
];

function compareVersionParts(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const l = leftParts[index] ?? 0;
    const r = rightParts[index] ?? 0;
    if (l !== r) return l - r;
  }

  return 0;
}

/** Released announcements, newest first, capped to the history's ten rows. */
export function releasedAnnouncements(
  all: readonly UpdateAnnouncement[] = ALL_ANNOUNCEMENTS,
): readonly UpdateAnnouncement[] {
  return all
    .filter(
      (announcement): announcement is UpdateAnnouncement & { releasedAt: string } =>
        announcement.status === "released" && announcement.releasedAt !== null,
    )
    .slice()
    .sort((left, right) => {
      const byDate = right.releasedAt.localeCompare(left.releasedAt);
      return byDate === 0 ? compareVersionParts(right.version, left.version) : byDate;
    })
    .slice(0, 10);
}

export function latestReleasedAnnouncement(): UpdateAnnouncement | null {
  return releasedAnnouncements()[0] ?? null;
}

/**
 * The newest announcement applicable to a running build. An old client must not claim to know
 * about a version newer than itself; the caller pairs this with an explicit "no live check"
 * explanation on the screen.
 */
export function latestApplicableAnnouncement(
  currentVersion: string,
  all: readonly UpdateAnnouncement[] = ALL_ANNOUNCEMENTS,
): UpdateAnnouncement | null {
  return (
    releasedAnnouncements(all).find(
      (announcement) => compareVersionParts(currentVersion, announcement.version) >= 0,
    ) ?? null
  );
}

export function releasedAnnouncementByVersion(
  version: string,
  all: readonly UpdateAnnouncement[] = ALL_ANNOUNCEMENTS,
): UpdateAnnouncement | null {
  return (
    releasedAnnouncements(all).find((announcement) => announcement.version === version) ?? null
  );
}

/** Stable for a Chinese reader, without inventing a time or timezone. */
export function formatReleaseDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

export function compareVersions(left: string, right: string): number {
  return compareVersionParts(left, right);
}

/** Exported for tests; not a hook or a server query. */
export function hasNewerReleasedVersion(
  currentVersion: string,
  all: readonly UpdateAnnouncement[] = ALL_ANNOUNCEMENTS,
): boolean {
  const latest = releasedAnnouncements(all)[0] ?? null;
  return latest !== null && compareVersionParts(latest.version, currentVersion) > 0;
}
