import { useI18n } from "../i18n/index.js";

/** Shared flex sibling above the tab bar; never overlays scrolling content. */
export function CurrentBookCaption({ name, hidden = false }: {
  readonly name: string | undefined;
  readonly hidden?: boolean;
}): React.JSX.Element | null {
  const { t } = useI18n();
  if (hidden || name === undefined) return null;
  const caption = t("ledger.caption.currentBook", { name });
  return <p className="current-book-caption shrink-0 truncate px-6 py-2 text-micro text-muted" title={caption}>{caption}</p>;
}
