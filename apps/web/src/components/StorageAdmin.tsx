import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatStorageBytes, type StorageLimits } from "@libellum/shared";
import { apiFetch, errorMessage } from "../lib/api.js";
import { useI18n } from "../i18n/index.js";

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
  const values = draft ?? policy.data;
  return <details className="lv-attachments"><summary className="text-section-title cursor-pointer">{t("attachments.admin")}</summary>
    {policy.isError ? <p role="alert">{errorMessage(policy.error)}</p> : null}
    {values ? <form className="grid gap-4 pt-4 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); void save("/admin/storage-policy", values); }}>
      {(["accountBytes", "bookBytes", "fileBytes", "entryBytes", "entryFiles"] as const).map(key => <label className="text-helper" key={key}>{t(`attachments.${key}`)} {key !== "entryFiles" ? "(MB)" : ""}
        <input className="block lv-desk-input w-full" type="number" min={key === "entryFiles" ? 1 : 0.001} step={key === "entryFiles" ? 1 : 0.001} required value={key === "entryFiles" ? values[key] : values[key] / 1e6} onChange={e => setDraft({ ...values, [key]: Number(e.target.value) * (key === "entryFiles" ? 1 : 1e6) })} /></label>)}
      <button className="lv-desk-btn self-end" disabled={busy}>{t("common.action.save")}</button>
    </form> : null}
    <h3 className="mt-6 text-card-title">{t("attachments.individual")}</h3>
    <form className="flex flex-wrap items-end gap-3 py-3" onSubmit={e => { e.preventDefault(); void target.refetch(); }}>
      <label>{t("attachments.scope")}<select className="block lv-desk-input rounded-field border border-line bg-surface text-base" value={scope} onChange={e => setScope(e.target.value as "account" | "book")}><option value="account">{t("attachments.account")}</option><option value="book">{t("attachments.book")}</option></select></label>
      <label>{t("attachments.target")}<input className="block lv-desk-input" value={id} onChange={e => setId(e.target.value)} required /></label>
      <button className="lv-desk-btn" disabled={busy}>{t("attachments.lookup")}</button>
    </form>
    {target.isError ? <p role="alert">{errorMessage(target.error)}</p> : null}
    {target.data ? <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); void save("/admin/storage-limit", { scope, id: target.data!.id, limit: limit === "" ? null : Number(limit) * 1e6 }); }}>
      <p>{target.data.name} · {t("attachments.used", { used: formatStorageBytes(target.data.bytes), limit: formatStorageBytes(target.data.limit) })}</p>
      <label>{t("attachments.bytes")} (MB)<input className="block lv-desk-input" type="number" min="0.001" step="0.001" value={limit} placeholder={t("attachments.defaults")} onChange={e => setLimit(e.target.value)} /></label>
      <button className="lv-desk-btn" disabled={busy}>{t("common.action.save")}</button>
    </form> : null}
    {message ? <p role="status" className="mt-3 text-helper">{message}</p> : null}
  </details>;
}
