import { useI18n } from "../i18n/index.js";
import { useGuestMode } from "../lib/guest/session.js";
import { usePane } from "../workspace/context.js";
import { BookCapsuleContents, CurrentBookPicker } from "./CurrentBookPicker.js";
import { useBookCapsuleMotion } from "./useBookCapsuleMotion.js";
import "./current-book-caption.css";

/** 手机使用独立账本胶囊；大屏沿用原说明，选择逻辑仍由 CurrentBookPicker 负责。 */
export function CurrentBookCaption({ name, hidden = false }: {
  readonly name: string | undefined;
  readonly hidden?: boolean;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const pane = usePane();
  const guest = useGuestMode();
  const ref = useBookCapsuleMotion(pane.shell === "phone" && !hidden && name !== undefined);
  if (hidden || name === undefined) return null;
  const caption = t("ledger.caption.currentBook", { name });
  return <div ref={ref} className={`current-book-caption shrink-0 px-6 ${pane.shell === "phone" ? "py-1 text-helper" : "truncate py-2 text-micro text-muted"}`} title={caption}>{pane.shell === "phone" && !guest ? <CurrentBookPicker caption={caption} name={name} /> : pane.shell === "phone" ? <span className="lv-book-capsule"><BookCapsuleContents name={name} disclosure={false} /></span> : caption}</div>;
}
