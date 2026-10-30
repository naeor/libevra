import { useLayoutEffect, useRef } from "react";
import { ENTRY_ACTIONS } from "../components/BottomNav.js";
import { useI18n } from "../i18n/index.js";
import { useGuestMode } from "../lib/guest/session.js";
import { useLedger } from "../lib/queries.js";
import { handOverForScan } from "../lib/scanHandoff.js";
import type { EntryNavigate } from "./entryMenu.js";
import { XIcon } from "./icons.js";

/** 与手机共用已有五种功能定义；只为侧栏调整顺序与密度。 */
export function EntryMethodList({ onNavigate, onSelected, disabledFor }: { readonly onNavigate: EntryNavigate; readonly onSelected?: () => void; readonly disabledFor: (action: typeof ENTRY_ACTIONS[number]) => boolean }): React.JSX.Element {
  const { t } = useI18n();
  const picker = useRef<HTMLInputElement>(null);
  const actions = [...ENTRY_ACTIONS].sort((a, b) => Number(b.id === "manual") - Number(a.id === "manual"));
  const onMenuKey = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [...(event.currentTarget.closest('[role="menu"]')?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not([disabled])') ?? [])];
    if (items.length === 0) return;
    event.preventDefault();
    const index = items.indexOf(event.currentTarget);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus({ preventScroll: true });
  };
  return <>
    <input ref={picker} type="file" accept="image/*" multiple className="hidden" onChange={(event) => {
      const chosen = [...(event.target.files ?? [])];
      event.target.value = "";
      if (chosen.length === 0) return;
      // 确认丢弃草稿后才交接文件；取消导航不会留下待识别图片。
      onNavigate("/scan", () => handOverForScan(chosen));
      onSelected?.();
    }} />
    {actions.map((action) => {
      const label = t(`nav.entry.${action.id}.label`);
      const disabled = disabledFor(action);
      return <button key={action.id} type="button" role="menuitem" className="lv-add-item" data-import={action.id === "import" ? "true" : undefined} disabled={disabled} onKeyDown={onMenuKey}
        aria-label={disabled ? t("nav.entry.needsAccount", { label }) : label} onClick={() => {
          if (action.picksImages === true) { picker.current?.click(); return; }
          if (action.to !== undefined) onNavigate(action.to);
          onSelected?.();
        }}><span className="lv-add-item-icon">{action.icon}</span><span>{label}</span></button>;
    })}
  </>;
}


/** 局部面板保留下面的页面及滚动；选择方式后才经过原草稿保护进行导航。 */
export function FollowEntryChooser({ onNavigate, onClose }: { readonly onNavigate: EntryNavigate; readonly onClose: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const guest = useGuestMode();
  const ledger = useLedger();
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { ref.current?.querySelector<HTMLElement>('button[role="menuitem"]:not([disabled])')?.focus({ preventScroll: true }); }, []);
  return <div ref={ref} className="lv-entry-chooser" data-entry-chooser="" role="region" aria-label={t("workspace.rail.addMenu")}>
    <div className="lv-entry-chooser-card">
      <header className="flex items-start justify-between gap-3"><div><h2 className="text-page-title text-ink">{t("workspace.rail.addMenu")}</h2><p className="text-helper-relaxed text-muted">{t("workspace.entry.target", { name: ledger.data?.book.name ?? t("workspace.entry.loading") })}</p></div>
        <button type="button" className="lv-rail-icon-button shrink-0" aria-label={t("workspace.rail.closeAddMenu")} onClick={onClose}><XIcon className="size-5" /></button>
      </header>
      <div id="lv-follow-entry-menu" className="lv-entry-methods" role="menu" aria-label={t("workspace.rail.addMenu")}><EntryMethodList disabledFor={(action) => guest && action.id !== "manual"} onNavigate={onNavigate} /></div>
    </div>
  </div>;
}
