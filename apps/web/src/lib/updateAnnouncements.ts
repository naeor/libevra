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
 * 1.13.15 is the S13-G/H/I release (2026-10-19). 1.13.09 is the S13-F release;
 * 1.13.08 was a production patch (card layout) and 1.13.07 was the full S13-E release.
 * All are production releases.
 */
const ALL_ANNOUNCEMENTS: readonly UpdateAnnouncement[] = [
  {
    version: "1.13.15",
    releasedAt: "2026-10-19",
    status: "released",
    title: "软件更新与版本公告",
    summary:
      "本次更新重点完善了账号和账本的安全管理，同时增强了数据备份、恢复及异常监测能力，让记账数据获得更可靠的保护。",
    sections: [
      {
        heading: "数据保护与恢复",
        items: [
          "新增关键操作记录机制，降低恢复历史备份时已删除账本、账号状态或权限变更意外失效的风险。",
          "增强数据库备份与校验能力，提高重要数据的可恢复性。",
          "改进后台异常监测，在关键数据保护机制出现问题时及时发出告警。",
        ],
      },
      {
        heading: "账号与账本安全",
        items: [
          "完善账号及账本生命周期管理，强化关闭、删除及相关状态变化的安全检查。",
          "加强账本成员与访问权限校验，减少不符合当前权限状态的操作。",
          "优化重要操作的保护机制，降低异常情况下的数据不一致风险。",
        ],
      },
      {
        heading: "稳定性改进",
        items: [
          "完善后台服务之间的健康检查机制。",
          "改进数据恢复过程中的完整性验证。",
          "修复部分运行配置问题，提升服务稳定性。",
        ],
      },
    ],
    major: false,
  },
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

/** The history page shows this many releases before offering the older ones. */
export const ANNOUNCEMENT_PAGE_SIZE = 20;

/** Released announcements, newest first. The page owns how many are initially shown. */
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
    });
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

/**
 * Neighbours for the detail page's version navigation.
 *
 * "older" is the previous release in time; "newer" is the next one. Both are
 * released announcements only, so the links can never lead to a development
 * placeholder or invent a version that users have not received.
 */
export function adjacentReleasedAnnouncements(
  version: string,
  all: readonly UpdateAnnouncement[] = ALL_ANNOUNCEMENTS,
): {
  readonly older: UpdateAnnouncement | null;
  readonly newer: UpdateAnnouncement | null;
} {
  const releases = releasedAnnouncements(all);
  const index = releases.findIndex((announcement) => announcement.version === version);
  if (index < 0) return { older: null, newer: null };

  return {
    older: releases[index + 1] ?? null,
    newer: index > 0 ? releases[index - 1]! : null,
  };
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
