import { useState } from "react";
import { useI18n } from "../i18n/index.js";
import { useWorkspaceSync } from "./SyncBridge.js";
import { downloadWorkspaceFile, exportWorkspaceFile, presetEntry } from "./exchange.js";
import { localConfiguration } from "./sync.js";

export function SyncControls(): React.JSX.Element {
  const { t } = useI18n();
  const { engine, snapshot } = useWorkspaceSync();
  const [notice, setNotice] = useState("");
  const exportLocal = () => {
    if (!engine) return;
    try {
      const config = localConfiguration(engine.scope);
      const entries = [...(config.workspace ? [{ name: t("statsWorkbench.transfer.workspaceName"), description: "", documents: config.workspace, filters: null }] : []), ...config.presets.map(presetEntry)];
      if (entries.length === 0) return;
      // 当前工作台加全部预设最多十一项，分开下载避免超出预设集合的十项上限。
      if (config.workspace) downloadWorkspaceFile(exportWorkspaceFile("workspace", entries.slice(0, 1)));
      if (config.presets.length) downloadWorkspaceFile(exportWorkspaceFile("presets", config.presets.map(presetEntry)));
      setNotice(t("statsWorkbench.transfer.exported"));
    } catch { setNotice(t("statsWorkbench.transfer.invalid")); }
  };
  const conflict = snapshot.status === "conflict" || snapshot.status === "invalid";
  return <section className="flex flex-col gap-2 text-helper text-muted" aria-label={t("statsWorkbench.sync.title")}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span role="status">{t(`statsWorkbench.sync.${snapshot.status}`)}</span>
      {engine && snapshot.status !== "syncing" && !conflict && snapshot.status !== "newer" ? <button type="button" className="sw-pill sw-pill-sm" onClick={() => void engine.run()}>{t("statsWorkbench.sync.retry")}</button> : null}
    </div>
    {conflict ? <>
      <p>{t("statsWorkbench.sync.conflictHint")}</p>
      {engine?.editing ? <p>{t("statsWorkbench.sync.finishEditing")}</p> : <div className="flex flex-wrap gap-2">
        <button type="button" className="sw-pill sw-pill-sm" onClick={() => void engine?.resolve("cloud")}>{t("statsWorkbench.sync.useCloud")}</button>
        {snapshot.status === "conflict" ? <button type="button" className="sw-pill sw-pill-sm" onClick={() => void engine?.resolve("local")}>{t("statsWorkbench.sync.useLocal")}</button> : null}
      </div>}
      <button type="button" className="sw-pill sw-pill-sm self-start" onClick={exportLocal}>{t("statsWorkbench.sync.backupLocal")}</button>
    </> : null}
    {notice ? <p role="status">{notice}</p> : null}
  </section>;
}
