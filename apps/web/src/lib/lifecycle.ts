import { apiFetch } from "./api.js";

export type BookDecisionAction = "leave" | "archive" | "delete" | "keep_archived";
export type CloseMethod = "close_account";

export interface DataDeletionBook {
  readonly bookId: string;
  readonly name: string;
  readonly bookNumber: string | null;
  readonly memberCount: number;
  readonly archived: boolean;
  readonly action: "leave" | "delete";
  readonly blockedReason: string | null;
}

export interface DataDeletionPreview {
  readonly books: readonly DataDeletionBook[];
  readonly counts: { readonly total: number; readonly leave: number; readonly delete: number };
  readonly blockers: readonly string[];
}

export interface DataDeletionResult {
  readonly accountKept: true;
  readonly processed: readonly {
    readonly bookId: string;
    readonly action: "left" | "deleted" | "already_left" | "already_deleted";
  }[];
  readonly remainingBookCount: number;
}

export interface AccountBookOption {
  readonly bookId: string;
  readonly name: string;
  readonly bookNumber: string | null;
  readonly memberCount: number;
  readonly archived: boolean;
  readonly isManager: boolean;
  readonly options: readonly BookDecisionAction[];
  readonly blockedReason: string | null;
  readonly archivedAt: string | null;
  readonly selfRestoreUntil: string | null;
  readonly scheduledPurgeAt: string | null;
}

export interface AccountLifecycle {
  readonly account: { readonly username: string; readonly accountNumber: string; readonly displayName: string };
  readonly books: readonly AccountBookOption[];
  readonly blockers: readonly string[];
  readonly counts: {
    readonly total: number;
    readonly shared: number;
    readonly single: number;
    readonly archived: number;
  };
}

export interface BookLifecycleSummary {
  readonly id: string;
  readonly name: string;
  readonly bookNumber: string | null;
  readonly memberCount: number;
  readonly archivedAt: string | null;
  readonly selfRestoreUntil: string | null;
  readonly scheduledPurgeAt: string | null;
  readonly purgeStartedAt: string | null;
  readonly purgeAttempts: number;
  readonly purgeLastError: string | null;
  readonly isManager: boolean;
  readonly isCreator: boolean;
  readonly canLeave: boolean;
  readonly canArchive: boolean;
  readonly canDelete: boolean;
  readonly canSelfRestore: boolean;
  readonly canRequestManualRecovery: boolean;
  readonly needsSuccessor: boolean;
  readonly pendingRecoveryRequest: {
    readonly id: string;
    readonly status: string;
    readonly requestedAt: string;
    readonly deadlineAt: string;
  } | null;
}

export interface CloseAccountResult {
  readonly method: CloseMethod;
  readonly closedAt: string;
  readonly recoveryCredential: string | null;
  readonly archivedBookIds: readonly string[];
  readonly deletedBookIds: readonly string[];
  readonly leftBookIds: readonly string[];
  readonly keptArchivedBookIds: readonly string[];
}

export async function fetchAccountLifecycle(): Promise<AccountLifecycle> {
  return apiFetch<AccountLifecycle>("/account/lifecycle");
}

export async function fetchBookLifecycle(bookId: string): Promise<BookLifecycleSummary> {
  return apiFetch<BookLifecycleSummary>(`/books/${bookId}/lifecycle`);
}

export async function bookLifecycleAction(
  bookId: string,
  action: "leave" | "archive" | "delete",
): Promise<unknown> {
  return apiFetch<unknown>(`/books/${bookId}/lifecycle`, { method: "POST", body: { action } });
}

export async function restoreArchivedBook(bookId: string): Promise<BookLifecycleSummary> {
  return apiFetch<BookLifecycleSummary>(`/account/archives/${bookId}/restore`, { method: "POST" });
}

export async function requestManualRecovery(bookId: string): Promise<{ requestId: string; deadlineAt: string }> {
  return apiFetch<{ requestId: string; deadlineAt: string }>(
    `/account/archives/${bookId}/recovery-request`,
    { method: "POST" },
  );
}

export async function closeAccount(input: {
  readonly method: CloseMethod;
  readonly password: string;
  readonly confirmation: string;
  readonly decisions?: readonly { readonly bookId: string; readonly action: BookDecisionAction }[];
}): Promise<CloseAccountResult> {
  return apiFetch<CloseAccountResult>("/account/close", {
    method: "POST",
    body: {
      password: input.password,
      confirmation: input.confirmation,
      method: input.method,
      decisions: input.decisions ?? [],
    },
  });
}

export async function fetchDataDeletionPreview(): Promise<DataDeletionPreview> {
  return apiFetch<DataDeletionPreview>("/account/data-deletion/preview");
}

export async function deleteServerData(input: {
  readonly password: string;
  readonly confirmation: string;
  readonly all: boolean;
  readonly bookIds: readonly string[];
}): Promise<DataDeletionResult> {
  return apiFetch<DataDeletionResult>("/account/delete-data", {
    method: "POST",
    body: input,
  });
}
