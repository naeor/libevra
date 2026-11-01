import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatStorageBytes, type StorageLimits } from "@libellum/shared";
import { apiFetch, errorMessage } from "../lib/api.js";
import { useI18n } from "../i18n/index.js";

import { Button } from "./Button.js";
import { InlineChoice } from "./ui/InlineChoice.js";

export function StorageAdmin(): React.JSX.Element {
  const { t } = useI18n();
  const policy = useQuery({ queryKey: ["admin", "storage-policy"], queryFn: () => apiFetch<StorageLimits>("/admin/storage-policy") });
  const [draft, setDraft] = useState<StorageLimits | null>(null);
  const [scope, setScope] = useState<"account" | "book">("account"), [id, setId] = useState(""), [limit, setLimit] = useState("");
  const [message, setMessage] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const target = useQuery({ queryKey: ["admin", "storage-target", scope, id], enabled: false,
    queryFn: () => apiFetch<{ id: string; name: string; bytes: number; limit: number }>("/admin/storage-limit", { query: { scope, id } }) });
  async function save(path: string, body: unknown) {
    setBusy(true); setMessage(null);
    try { await apiFetch(path, { method: "PATCH", body }); setMessage(t("attachments.policySaved")); void policy.refetch(); if (target.data) void target.refetch(); }
    catch (e) { setMessage(errorMessage(e)); } finally { setBusy(false); }
  }
  const [scopeOpen, setScopeOpen] = useState(false);
  const values = draft ?? policy.data;
  return <section className="lv-attachments lv-storage-admin"><h2 className="text-section-title">{t("attachments.admin")}</h2>
    {policy.isError ? <p role="alert">{errorMessage(policy.error)}</p> : null}
    {values ? <form className="grid gap-4 pt-4 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); void save("/admin/storage-policy", values); }}>
      {(["accountBytes", "bookBytes", "fileBytes", "entryBytes", "entryFiles"] as const).map(key => <label className="text-helper" key={key}>{t(`attachments.${key}`)} {key !== "entryFiles" ? "(MB)" : ""}
        <input className="block lv-desk-input w-full" type="number" min={key === "entryFiles" ? 1 : 0.001} step={key === "entryFiles" ? 1 : 0.001} required value={key === "entryFiles" ? values[key] : values[key] / 1e6} onChange={e => setDraft({ ...values, [key]: Number(e.target.value) * (key === "entryFiles" ? 1 : 1e6) })} /></label>)}
      <Button fullWidth={false} className="self-end" disabled={busy}>{t("common.action.save")}</Button>
    </form> : null}
    <h3 className="mt-6 text-card-title">{t("attachments.individual")}</h3>
    <form className="flex flex-wrap items-end gap-3 py-3" onSubmit={e => { e.preventDefault(); void target.refetch(); }}>
      <InlineChoice label={t("attachments.scope")} value={scope} open={scopeOpen} onToggle={() => setScopeOpen(!scopeOpen)} onClose={() => setScopeOpen(false)} onSelect={value => { setScope(value as "account" | "book"); setScopeOpen(false); }} options={["account", "book"].map(value => ({ id: value, label: t(value === "account" ? "attachments.account" : "attachments.book") }))} />
      <label>{t("attachments.target")}<input className="block lv-desk-input" value={id} onChange={e => setId(e.target.value)} required /></label>
      <Button fullWidth={false} disabled={busy}>{t("attachments.lookup")}</Button>
    </form>
    {target.isError ? <p role="alert">{errorMessage(target.error)}</p> : null}
    {target.data ? <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); void save("/admin/storage-limit", { scope, id: target.data!.id, limit: limit === "" ? null : Number(limit) * 1e6 }); }}>
      <p>{target.data.name} · {t("attachments.used", { used: formatStorageBytes(target.data.bytes), limit: formatStorageBytes(target.data.limit) })}</p>
      <label>{t("attachments.bytes")} (MB)<input className="block lv-desk-input" type="number" min="0.001" step="0.001" value={limit} placeholder={t("attachments.defaults")} onChange={e => setLimit(e.target.value)} /></label>
      <Button fullWidth={false} disabled={busy}>{t("common.action.save")}</Button>
    </form> : null}
    {message ? <p role="status" className="mt-3 text-helper">{message}</p> : null}
  </section>;
}
