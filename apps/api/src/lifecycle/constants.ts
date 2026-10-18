/**
 * S13-H lifecycle constants.
 *
 * The rules are deliberately plain numbers here: the UI, the cleanup job and the tests all read
 * the same values, so "60 days" cannot mean one thing on a screen and another in the purger.
 */
export const SELF_RESTORE_DAYS = 60;
export const ARCHIVE_RETENTION_DAYS = 365;
export const RECOVERY_REQUEST_DAYS = 7;

/** The cleanup job is allowed to run once a day; the UI must say so, not imply an instant purge. */
export const PURGE_SCHEDULE_NOTE = "到期后 24 小时内";

export function addDays(now: Date, days: number): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

export interface ArchiveDeadlines {
  readonly archivedAt: Date;
  readonly selfRestoreUntil: Date;
  readonly scheduledPurgeAt: Date;
}

export function archiveDeadlines(now: Date): ArchiveDeadlines {
  return {
    archivedAt: now,
    selfRestoreUntil: addDays(now, SELF_RESTORE_DAYS),
    scheduledPurgeAt: addDays(now, ARCHIVE_RETENTION_DAYS),
  };
}
