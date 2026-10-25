import { DEFAULT_TAG_COLOR } from "../tagColors.js";
import type { Transaction } from "@libellum/shared";
import { t } from "../../i18n/index.js";
import type { ConflictRecord } from "./localLedger.js";
import { FIELD_LABELS, fieldLabel, mergeEntries, type MergeField } from "./merge.js";

export interface ConflictOption { readonly label: string; readonly value: unknown; readonly currency?: string }
export interface ConflictQuestion { readonly field: MergeField; readonly label: string; readonly options: readonly ConflictOption[] }

function valueOf(entry: Transaction, field: MergeField): unknown {
  return field === "tags" ? entry.tags.map(tag => tag.id) : entry[field];
}
function key(field: MergeField, value: unknown): string | undefined {
  return JSON.stringify(field === "tags" && Array.isArray(value) ? [...value].sort() : value);
}

/**
 * Server claims survive refreshes and are available on every device, including the winner.
 *
 * S16: the labels are taken in the current interface language when this runs; the conflict screen re-runs it when
 * the language changes. The option *values* are the stored data and are never translated.
 */
export function conflictQuestions(conflict: ConflictRecord): readonly ConflictQuestion[] {
  if (conflict.fields === undefined) {
    return mergeEntries(conflict.base, conflict.mine, conflict.theirs).conflicts
      .filter(item => item.field !== "occurredAt")
      .map(item => ({ field: item.field, label: item.label, options: [
        { label: t("offline.conflict.optionThisDevice"), value: item.mine, currency: conflict.mine.currency },
        { label: t("offline.conflict.optionServer"), value: item.theirs, currency: conflict.theirs.currency },
      ] }));
  }
  return conflict.fields.flatMap(item => {
    const field = (item.field === "tagIds" ? "tags" : item.field) as MergeField;
    if (!(field in FIELD_LABELS) || field === "occurredAt") return [];
    const options: ConflictOption[] = [{ label: t("offline.conflict.optionServer"), value: valueOf(conflict.theirs, field), currency: conflict.theirs.currency }];
    for (const claim of item.claims ?? []) {
      if (claim.chain.length === 0) continue;
      options.push({ label: t("offline.conflict.optionDevice", { device: claim.deviceId.slice(0, 8) }), value: claim.chain.at(-1) });
    }
    // Older persisted conflicts may predate the claims payload.
    if ((item.claims?.length ?? 0) === 0) options.push({ label: t("offline.conflict.optionThisDevice"), value: valueOf(conflict.mine, field), currency: conflict.mine.currency });
    const unique = options.filter((option, index) => options.findIndex(other => key(field, other.value) === key(field, option.value)) === index);
    return unique.length < 2 ? [] : [{ field, label: fieldLabel(field), options: unique }];
  });
}

export function applyConflictChoices(
  entry: Transaction,
  choices: ReadonlyMap<MergeField, unknown>,
  names: { categories?: readonly { id: string; name: string; isSystem?: boolean }[] | undefined;
    paymentMethods?: readonly { id: string; name: string }[] | undefined;
    tags?: readonly { id: string; name: string; color?: string }[] | undefined },
  sources: readonly Transaction[],
): Transaction {
  const result = { ...entry };
  for (const [field, value] of choices) {
    if (field === "tags") {
      const known = new Map([...sources.flatMap(source => source.tags), ...(names.tags ?? [])].map(tag => [tag.id, tag]));
      result.tags = (value as string[]).map(id => ({ id, name: known.get(id)?.name ?? id, color: known.get(id)?.color ?? DEFAULT_TAG_COLOR }));
    } else (result as unknown as Record<string, unknown>)[field] = value;
  }
  if (choices.has("categoryId")) {
    const category = names.categories?.find(item => item.id === result.categoryId);
    const source = sources.find(item => item.categoryId === result.categoryId);
    result.categoryName = category?.name ?? source?.categoryName ?? result.categoryId;
    result.categoryIsSystem = category?.isSystem ?? source?.categoryIsSystem ?? false;
  }
  if (choices.has("paymentMethodId")) result.paymentMethodName = result.paymentMethodId === null ? null :
    names.paymentMethods?.find(item => item.id === result.paymentMethodId)?.name ??
    sources.find(item => item.paymentMethodId === result.paymentMethodId)?.paymentMethodName ?? result.paymentMethodId;
  return result;
}
