import {
  incrementalPreviewResponseSchema,
  type IncrementalDecision,
  type IncrementalDecisionAction,
  type IncrementalPreviewResponse,
  type IncrementalSourceStatus,
} from "@libellum/shared";

import { apiFetch } from "../api.js";
import type { ImportSource } from "./types.js";
import { guestSourceOfSource } from "./submit.js";

export async function loadIncrementalPreview(input: {
  readonly targetBookId: string;
  readonly source: ImportSource;
}): Promise<IncrementalPreviewResponse> {
  const payload =
    input.source.kind === "guest"
      ? {
          targetBookId: input.targetBookId,
          source: guestSourceOfSource(input.source),
        }
      : {
          targetBookId: input.targetBookId,
          sourceBookId: input.source.bookId,
        };
  const raw = await apiFetch<unknown>("/ledger-imports/incremental-preview", {
    method: "POST",
    body: payload,
    timeoutMs: 120_000,
  });
  return incrementalPreviewResponseSchema.parse(raw);
}

/** The safe default: never silently overwrite an existing target. */
export function defaultIncrementalAction(status: IncrementalSourceStatus): IncrementalDecisionAction | null {
  switch (status.status) {
    case "unchanged":
    case "new":
      return null;
    case "modified":
    case "target_changed":
      return "keep_target";
    case "target_deleted":
      return "keep_target";
    case "previously_skipped":
    case "previously_skipped_modified":
    case "needs_review":
      return "skip";
  }
}

export function decisionsForRequest(
  response: IncrementalPreviewResponse | null,
  chosen: ReadonlyMap<string, IncrementalDecisionAction>,
): IncrementalDecision[] {
  if (response === null) return [];
  const decisions: IncrementalDecision[] = [];
  for (const status of response.statuses) {
    const action = chosen.get(status.sourceTransactionId) ?? defaultIncrementalAction(status);
    if (action === null) continue;
    decisions.push({ sourceTransactionId: status.sourceTransactionId, action });
  }
  return decisions;
}

export function incrementalExclusions(response: IncrementalPreviewResponse | null): {
  sourceIds: ReadonlySet<string>;
  targetIds: ReadonlySet<string>;
} {
  if (response === null) return { sourceIds: new Set(), targetIds: new Set() };
  const sourceIds = new Set(
    response.statuses
      .filter((status) => status.status !== "new")
      .map((status) => status.sourceTransactionId),
  );
  const targetIds = new Set(
    response.statuses
      .map((status) => status.targetTransactionId)
      .filter((id): id is string => id !== null),
  );
  return { sourceIds, targetIds };
}
