import { useContext } from "react";
import { useI18n } from "../i18n/index.js";
import { useGuestMode } from "../lib/guest/session.js";
import { usePane } from "../workspace/context.js";
import { useRegisterBookCapsule } from "./bookCapsule.js";
import { BookCapsuleContents, CurrentBookPicker } from "./CurrentBookPicker.js";
import { PersistentNavContext } from "./PersistentNavContext.js";
import { useBookCapsuleMotion } from "./useBookCapsuleMotion.js";
import "./current-book-caption.css";

/**
 * 手机使用独立账本胶囊；大屏沿用原说明，选择逻辑仍由 CurrentBookPicker 负责。
 *
 * 1.19.50：手机有常驻底栏时，胶囊挂在底栏上（PersistentBookCapsule），这里只登记需要显示哪本账、不占页面一行；
 * `hidden`（记账菜单展开）由底栏里的胶囊自己按菜单状态处理。没有常驻底栏时仍按原来的一行显示。
 */
export function CurrentBookCaption({ name, hidden = false }: {
  readonly name: string | undefined;
  readonly hidden?: boolean;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const pane = usePane();
  const guest = useGuestMode();
  const persistent = useContext(PersistentNavContext) && pane.shell === "phone" && pane.nav === "bottom";
  const docked = useRegisterBookCapsule(persistent && name !== undefined ? name : null) && persistent;
  const ref = useBookCapsuleMotion(!docked && pane.shell === "phone" && !hidden && name !== undefined);
  if (docked || hidden || name === undefined) return null;
  const caption = t("ledger.caption.currentBook", { name });
  return <div ref={ref} className={`current-book-caption shrink-0 px-6 ${pane.shell === "phone" ? "py-1 text-helper" : "truncate py-2 text-micro text-muted"}`} title={caption}>{pane.shell === "phone" && !guest ? <CurrentBookPicker caption={caption} name={name} /> : pane.shell === "phone" ? <span className="lv-book-capsule"><BookCapsuleContents name={name} disclosure={false} /></span> : caption}</div>;
}
