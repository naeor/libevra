import { useEffect } from "react";

import { useBookMembers } from "../../lib/queries.js";
import type { BatchRoleState } from "./batch.js";

/**
 * Asks which role this account has in the current ledger, and reports it upward.
 *
 * ⚠️ **Mounted only while batch mode is on, and only in a shared ledger.** A personal ledger has one
 * member, who is its owner, so the question has one possible answer and asking it would be a request
 * on every visit to the main screen for nothing. **The main screen is where the app must stay cheap.**
 *
 * ⚠️ **Why the lookup exists at all**: a 查看者's write is refused by the server for ever, and the
 * offline write path queues first and asks later — so without this the row would turn green and never
 * leave. `MemberList` already reads the same endpoint for the same reason; this is not a new source of
 * truth, it is the same one asked earlier.
 */
export function BatchRoleProbe({
  onProbe,
}: {
  readonly onProbe: (state: BatchRoleState) => void;
}): null {
  const members = useBookMembers();
  const failed = members.isError;
  const role = members.data?.myRole;

  useEffect(() => {
    if (failed) {
      onProbe({ status: "error" });

      return;
    }

    if (role !== undefined) onProbe({ status: "ready", role });
  }, [failed, role, onProbe]);

  return null;
}
