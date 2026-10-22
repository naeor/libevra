import type { MajorAnnouncement } from "@libellum/shared";

import { compareVersions } from "./updateAnnouncements.js";

/**
 * A major-announcement popup belongs to the release it announces.
 *
 * The API deliberately keeps returning the newest announcement that the account has not
 * acknowledged, even after the browser has moved to a newer release. That is useful for an
 * account that has not opened the newer build yet, but once the running bundle is *newer* than
 * the announcement, the old popup is stale: the user has already moved past that release and the
 * update history is the right place for the old text. Showing it again after an update is exactly
 * the repeat this client-side filter prevents.
 *
 * ⚠️ **Display-only filter.** It changes no server row, no acknowledgement count and no
 * authorization behaviour. The browser can only hide a prompt it would otherwise show; the
 * server remains the source of truth for what was acknowledged.
 */
export function isMajorAnnouncementOlderThanApp(
  announcementVersion: string,
  appVersion: string,
): boolean {
  const announced = numericVersion(announcementVersion);
  const current = numericVersion(appVersion);
  if (announced === null || current === null) return false;

  return compareVersions(current, announced) > 0;
}

/**
 * Pick the announcement the gate may render, or `null` when it is history.
 *
 * A malformed version is treated as "not older" on purpose: hiding an announcement because of an
 * unparseable string would silently drop a notice. The server's acknowledgement check still
 * keeps the normal one-per-account behaviour.
 */
export function selectDisplayedMajorAnnouncement(
  pending: MajorAnnouncement | null,
  appVersion: string,
): MajorAnnouncement | null {
  if (pending === null) return null;
  if (isMajorAnnouncementOlderThanApp(pending.version, appVersion)) return null;
  return pending;
}

/** Compare only the leading numeric version, so `1.15.00-test` still means `1.15.00`. */
function numericVersion(value: string): string | null {
  const match = /^\d+(?:\.\d+)*/.exec(value.trim());
  return match === null ? null : match[0];
}
