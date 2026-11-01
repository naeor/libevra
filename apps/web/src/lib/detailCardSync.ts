import { detailCardSchema, type DetailCardConfiguration } from "@libellum/shared";
import { apiFetch, ApiRequestError } from "./api.js";

export type CardRemote = { version: number; configuration: DetailCardConfiguration };
export type CardLocal = { value: DetailCardConfiguration; base: number; dirty: boolean; conflict?: CardRemote };
export const sameCards = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function validRemote(v: unknown): CardRemote | null {
  if (v === null) return null;
  const record = v as CardRemote;
  if (!record || !Number.isSafeInteger(record.version) || record.version < 1) throw Error("Unsupported configuration");
  return { version: record.version, configuration: detailCardSchema.parse(record.configuration) };
}
/** CAS 冲突保留本地草稿，只有显式选择才能覆盖另一端。 */
export async function syncDetailCards(owner: string, book: string, read: () => CardLocal, write: (v: CardLocal) => void, active: () => boolean,
  request: typeof apiFetch = apiFetch): Promise<void> {
  const path = `/detail-cards/${book}`, accountScope = `user:${owner}`;
  const response = await request<{ record: unknown }>(path, { query: { accountScope } });
  const remote = validRemote(response.record);
  if (!active()) return;
  const local = read();
  if (remote && sameCards(remote.configuration, local.value)) {
    write({ value: local.value, base: remote.version, dirty: false }); return;
  }
  if (!local.dirty) {
    if (remote) write({ value: remote.configuration, base: remote.version, dirty: false });
    return;
  }
  if ((remote?.version ?? 0) !== local.base) {
    if (remote) write({ ...local, conflict: remote });
    return;
  }
  if (local.conflict) return;
  try {
    const result = await request<{ record: unknown }>(path, { method: "POST", body: { accountScope, baseVersion: local.base, configuration: local.value } });
    const saved = validRemote(result.record);
    if (!active() || !saved) return;
    const latest = read();
    write({ ...latest, base: saved.version, dirty: !sameCards(latest.value, saved.configuration) });
  } catch (error) {
    if (active() && error instanceof ApiRequestError && error.code === "workbench_conflict") {
      const other = validRemote((error.details as { record?: unknown })?.record);
      if (other) { write({ ...read(), conflict: other }); return; }
    }
    throw error;
  }
}
