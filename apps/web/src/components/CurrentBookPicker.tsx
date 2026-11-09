import { useState } from "react";
import { Link, useLocation } from "react-router";
import { useEnterLedger } from "../desktop/DesktopNav.js";
import { useI18n } from "../i18n/index.js";
import { currentLedgerDestination } from "../lib/currentLedgerDestination.js";
import { useCurrentBookId } from "../lib/queries.js";
import { BookSwitcherSheet } from "./BookSwitcherSheet.js";
import { ChevronIcon } from "./Icons.js";

/** 只在手机阅读页挂载；激活与落盘仍走现有 useEnterLedger。 */
export function CurrentBookPicker({ caption, name }: { readonly caption: string; readonly name: string }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const currentId = useCurrentBookId();
  // 1.19.50：从胶囊切换账本时，整页重新载入期间海浪从下缘涌上、停顿、再从上缘离开。
  const switcher = useEnterLedger({ rise: true });
  const location = useLocation();
  const { t } = useI18n();
  return <>
    <button type="button" className="lv-book-capsule" aria-label={caption} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><BookCapsuleContents name={name} /></button>
    {open ? <BookSwitcherSheet open currentTargetId={currentId ?? ""} purpose="activate" onClose={() => { if (!switcher.busy) setOpen(false); }} onSelect={id => {
      if (!switcher.busy) switcher.enter(id, undefined, currentLedgerDestination(location.pathname, location.search));
    }} footer={<div className="border-t border-line px-5 py-3">
      {switcher.status ? <p role="status" className="mb-2 text-helper text-muted">{switcher.status}</p> : null}
      {switcher.busy ? null : <Link to="/start" className="text-helper text-brand-dark">{t("books.switcher.manageAll")}</Link>}
    </div>} /> : null}
  </>;
}

/** 小尺寸统一账本图标；只替换入口外观，不读取或改变账本身份。 */
export function BookCapsuleContents({ name, disclosure = true }: { readonly name: string; readonly disclosure?: boolean }): React.JSX.Element {
  return <>
    <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3h13v18H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z"/><path d="M3 17h16M7 7h7M7 11h5"/></svg>
    <span className="min-w-0 truncate">{name}</span>
    {disclosure ? <ChevronIcon className="size-3 shrink-0" /> : null}
  </>;
}
