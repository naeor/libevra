import { useRef, useState } from "react";
import { WORKSPACE_MAX_BYTES } from "@libellum/shared/workbench/configuration";
import { useI18n } from "../i18n/index.js";
import { BrowseGrid } from "./Grid.js";
import { createPreset, loadPresets, reidentify, MAX_USER_PRESETS } from "./presets.js";
import { readStored } from "./storage.js";
import type { WorkbenchScope } from "./scope.js";
import type { WorkbenchDocuments } from "./storage.js";
import { downloadWorkspaceFile, exportWorkspaceFile, parseWorkspaceFile, presetEntry, type ImportEntry } from "./exchange.js";

export function ExchangePanel({ accountScope, scope, onApply, onChanged }: {
  readonly accountScope: string | null; readonly scope: WorkbenchScope;
  readonly onApply: (documents: WorkbenchDocuments, name: string, filters: string | null) => boolean;
  readonly onChanged: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<readonly ImportEntry[]>([]);
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState<number | null>(null);
  const [pages, setPages] = useState<ReadonlyMap<string, number>>(new Map());
  function output(collection: boolean) {
    try {
      const presets = loadPresets(accountScope);
      const saved = readStored(accountScope);
      if (collection ? presets.locked || presets.unreadable.length > 0 : saved.unreadable) throw Error("unreadable");
      const entries = collection ? presets.presets.map(presetEntry) : [{ name: t("statsWorkbench.transfer.workspaceName"), description: "", documents: saved.documents, filters: null }];
      if (!entries.length) { setNotice(t("statsWorkbench.transfer.empty")); return; }
      downloadWorkspaceFile(exportWorkspaceFile(collection ? "presets" : "workspace", entries));
      setNotice(t("statsWorkbench.transfer.exported"));
    } catch { setNotice(t("statsWorkbench.transfer.invalid")); }
  }
  function add(index: number) {
    const entry = items[index]?.entry;
    if (!entry || !accountScope) return;
    const store = loadPresets(accountScope);
    if (store.presets.length + store.unreadable.length >= MAX_USER_PRESETS) { setNotice(t("statsWorkbench.presets.problems.full", { count: MAX_USER_PRESETS })); return; }
    const names = new Set([...store.presets, ...store.unreadable].map(p => p.name));
    let name = entry.name, number = 2;
    while (names.has(name)) { const suffix = ` (${number++})`; name = entry.name.slice(0, 20 - suffix.length) + suffix; }
    const saved = createPreset(accountScope, { ...entry, name, documents: reidentify(entry.documents) });
    setNotice(typeof saved === "string" ? t("statsWorkbench.transfer.invalid") : t("statsWorkbench.transfer.imported", { name }));
    onChanged();
  }
  return <section className="flex flex-col gap-3 border-t border-line px-5 pt-4 sm:px-6" aria-label={t("statsWorkbench.transfer.title")}>
    <div className="flex flex-wrap gap-2">
      <button type="button" className="sw-pill sw-pill-sm" onClick={() => output(false)}>{t("statsWorkbench.transfer.exportWorkspace")}</button>
      <button type="button" className="sw-pill sw-pill-sm" onClick={() => output(true)}>{t("statsWorkbench.transfer.exportPresets")}</button>
      <button type="button" className="sw-pill sw-pill-sm" onClick={() => input.current?.click()}>{t("statsWorkbench.transfer.importFile")}</button>
      <input ref={input} type="file" accept=".json,application/json" className="hidden" aria-label={t("statsWorkbench.transfer.importFile")} onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = "";
        if (!file) return;
        setItems([]); setConfirm(null); setNotice("");
        if (file.size > WORKSPACE_MAX_BYTES) { setNotice(t("statsWorkbench.transfer.tooLarge")); return; }
        try { setItems(parseWorkspaceFile(await file.text())); }
        catch { setNotice(t("statsWorkbench.transfer.invalid")); }
      }} />
    </div>
    {items.length ? <p className="text-helper-relaxed text-muted">{t("statsWorkbench.transfer.bindingHint")}</p> : null}
    {items.map((item, index) => <article key={index} className="flex flex-col gap-2 rounded-card border border-line p-3">
      <h4 className="text-body font-medium text-ink">{item.name}</h4>
      {item.entry ? <>
        <p className="text-helper text-muted">{t("statsWorkbench.transfer.summary", { cards: item.entry.documents.content.cards.length, containers: item.entry.documents.content.containers.length })}</p>
        <details><summary className="cursor-pointer text-helper text-brand-dark">{t("statsWorkbench.presets.preview")}</summary>
          <div className="max-h-80 overflow-y-auto"><BrowseGrid content={item.entry.documents.content} layout={item.entry.documents.layout} columns={2} scope={scope} onOpenCard={() => {}} onOpenCollapsed={() => {}} carouselPages={pages} onCarouselPage={(id, page) => setPages(current => new Map(current).set(id, page))} /></div>
        </details>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="sw-pill sw-pill-sm" disabled={!accountScope} onClick={() => add(index)}>{t("statsWorkbench.transfer.addPreset")}</button>
          <button type="button" className="sw-pill sw-pill-sm" onClick={() => setConfirm(index)}>{t("statsWorkbench.transfer.apply")}</button>
        </div>
        {confirm === index ? <div className="flex flex-col gap-2"><p className="text-helper text-muted">{t("statsWorkbench.transfer.confirmApply")}</p><div className="flex gap-2">
          <button type="button" className="sw-pill sw-pill-sm" onClick={() => { if (item.entry && onApply(item.entry.documents, item.entry.name, item.entry.filters)) { setConfirm(null); setNotice(t("statsWorkbench.transfer.applied")); } }}>{t("common.action.confirm")}</button>
          <button type="button" className="sw-pill sw-pill-sm" onClick={() => setConfirm(null)}>{t("common.action.cancel")}</button>
        </div></div> : null}
      </> : <p role="alert" className="text-helper text-warn-dark">{t("statsWorkbench.transfer.unsupported", { reason: item.error ?? "invalid" })}</p>}
    </article>)}
    {notice ? <p role="status" className="text-helper text-muted">{notice}</p> : null}
  </section>;
}
