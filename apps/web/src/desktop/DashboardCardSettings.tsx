/**
 * 总览编辑时，卡片菜单里的「配置」（1.19.100）：卡片名称、数据来自哪本账，以及总览卡片自己的选项。
 * 分析卡片的内容（指标、展示形式、组合、时间）仍在同一个卡片编辑器里改（「编辑卡片内容」）。
 *
 * 修改只进编辑会话（与卡片编辑器一样是一步撤销），点编辑条的「完成」才保存。
 */
import { useState } from "react";
import type { AnalysisCardNode } from "@libellum/shared/analysis/layout";

import { BottomSheet } from "../components/BottomSheet.js";
import { useI18n } from "../i18n/index.js";
import { cardTitle } from "../statsWorkbench/cards.js";
import {
  cardDisplay,
  cardSourceBook,
  NOTE_MAX,
  withCardDisplay,
  type CardDisplay,
  isNativeCard,
  nativeKindOf,
  nativeOptions,
  nativeSpec,
  withCardSource,
  withNativeOptions,
  type NativeMetric,
  type NativeOptions,
} from "../statsWorkbench/nativeCards.js";
import type { DashboardBook } from "./DashboardNativeCards.js";

const METRICS: readonly NativeMetric[] = ["expense", "income", "balance"];

export function DashboardCardSettings({
  card,
  books,
  currentBookId,
  onSave,
  onEditContent,
  onClose,
}: {
  readonly card: AnalysisCardNode;
  /** 总览范围里的账本（游客只有当前账本）。 */
  readonly books: readonly DashboardBook[];
  readonly currentBookId: string | null;
  readonly onSave: (card: AnalysisCardNode) => boolean;
  readonly onEditContent: () => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const native = isNativeCard(card);
  const kind = nativeKindOf(card);
  const [name, setName] = useState(card.title?.kind === "custom" ? card.title.text ?? "" : "");
  const [options, setOptions] = useState<NativeOptions>(() => nativeOptions(card));
  const [source, setSource] = useState<string | null>(() => cardSourceBook(card));
  const [display, setDisplay] = useState<CardDisplay>(() => cardDisplay(card));
  // 「没有数据时」与「点卡片」只对有数据、有去处的卡片有意义。
  const hasEmpty = !native || kind === "ledger" || kind === "trend" || kind === "cross";
  const opens: readonly ("default" | "entries" | "analysis" | "none")[] = !native ? ["default", "entries", "none"] : kind === "ledger" ? ["default", "analysis", "none"] : kind === "trend" ? ["default", "entries", "none"] : [];
  const multi = kind !== null && nativeSpec(kind).multiBook;
  const chosen = options.books === undefined || options.books === "all" ? null : new Set(options.books);
  const { title: _ignored, ...withoutTitle } = card;
  const placeholder = cardTitle(withoutTitle, t);

  const save = (finish: () => void): void => {
    const trimmed = name.trim();
    const { title: _title, ...untitled } = card;
    let next: AnalysisCardNode = trimmed === "" ? untitled : { ...card, title: { kind: "custom", text: trimmed.slice(0, 40) } };
    next = native ? withNativeOptions(next, options) : withCardSource(next, source);
    next = withCardDisplay(next, display);
    if (onSave(next)) finish();
  };

  const bookName = (id: string): string => books.find((book) => book.id === id)?.name ?? "—";

  return (
    <BottomSheet
      label={t("desktop.dashboard.settings.title")}
      title={t("desktop.dashboard.settings.title")}
      onClose={onClose}
      footer={(controls) => (
        <div className="flex justify-end gap-2 px-6 pb-5">
          <button type="button" className="lv-desk-btn" onClick={controls.close}>{t("desktop.common.cancel")}</button>
          <button type="button" className="lv-desk-btn lv-desk-btn-primary" onClick={() => save(controls.finish)}>{t("desktop.common.done")}</button>
        </div>
      )}
    >
      {() => (
        <div className="flex flex-col gap-5 px-6 pt-1 pb-5">
          <label className="flex flex-col gap-1.5">
            <span className="text-helper text-muted">{t("desktop.dashboard.settings.name")}</span>
            <input className="lv-desk-input text-base" value={name} maxLength={40} placeholder={placeholder} autoFocus onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-helper text-muted">{t("desktop.dashboard.settings.note")}</span>
            <input className="lv-desk-input text-base" value={display.note ?? ""} maxLength={NOTE_MAX} placeholder={t("desktop.dashboard.settings.notePlaceholder")} onChange={(event) => setDisplay({ ...display, note: event.target.value })} />
          </label>

          {kind === "ledger" ? (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="text-helper text-muted">{t("desktop.dashboard.settings.book")}</span>
                <select className="lv-dash-select rounded-field border border-line bg-surface text-base" value={options.bookId ?? ""} onChange={(event) => setOptions({ ...options, bookId: event.target.value })}>
                  {books.map((book) => <option key={book.id} value={book.id}>{book.name}</option>)}
                </select>
              </label>
              <fieldset className="flex flex-col gap-1.5">
                <legend className="pb-1.5 text-helper text-muted">{t("desktop.dashboard.metric")}</legend>
                <div className="lv-desk-seg" role="radiogroup">
                  {METRICS.map((metric) => (
                    <button key={metric} type="button" role="radio" aria-checked={(options.metric ?? "expense") === metric} onClick={() => setOptions({ ...options, metric })}>
                      {t(`desktop.entries.${metric}`)}
                    </button>
                  ))}
                </div>
              </fieldset>
              <label className="flex min-h-11 items-center gap-3 text-body text-ink">
                <input type="checkbox" className="size-5 accent-brand" checked={options.showTrend !== false} onChange={(event) => setOptions({ ...options, showTrend: event.target.checked })} />
                {t("desktop.dashboard.showTrend")}
              </label>
              <label className="flex min-h-11 items-center gap-3 text-body text-ink">
                <input type="checkbox" className="size-5 accent-brand" checked={options.showRecent !== false} onChange={(event) => setOptions({ ...options, showRecent: event.target.checked })} />
                {t("desktop.dashboard.showRecent")}
              </label>
              <p className="text-helper-relaxed text-muted">{t("desktop.dashboard.settings.sizeHint")}</p>
            </>
          ) : null}

          {kind === "trend" ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-helper text-muted">{t("desktop.dashboard.settings.book")}</span>
              <select className="lv-dash-select rounded-field border border-line bg-surface text-base" value={options.bookId ?? ""} onChange={(event) => {
                const { bookId: _previous, ...rest } = options;
                setOptions(event.target.value === "" ? rest : { ...rest, bookId: event.target.value });
              }}>
                <option value="">{t("desktop.dashboard.settings.followCurrent")}</option>
                {books.map((book) => <option key={book.id} value={book.id}>{book.name}</option>)}
              </select>
            </label>
          ) : null}

          {multi && books.length > 1 ? (
            <fieldset className="flex flex-col gap-1">
              <legend className="pb-1.5 text-helper text-muted">{t("desktop.dashboard.scope")}</legend>
              <label className="flex min-h-11 items-center gap-3 text-body text-ink">
                <input type="checkbox" className="size-5 accent-brand" checked={chosen === null} onChange={(event) => setOptions({ ...options, books: event.target.checked ? "all" : books.map((book) => book.id) })} />
                {t("desktop.dashboard.settings.allBooks")}
              </label>
              {chosen === null ? null : books.map((book) => (
                <label key={book.id} className="flex min-h-11 items-center gap-3 pl-8 text-body text-ink">
                  <input
                    type="checkbox"
                    className="size-5 accent-brand"
                    checked={chosen.has(book.id)}
                    onChange={(event) => {
                      const next = new Set(chosen);
                      if (event.target.checked) next.add(book.id);
                      else next.delete(book.id);
                      // 至少留一本：全部取消等于没有范围，按「全部账本」处理。
                      setOptions({ ...options, books: next.size === 0 ? "all" : books.map((item) => item.id).filter((id) => next.has(id)) });
                    }}
                  />
                  {book.name}
                </label>
              ))}
            </fieldset>
          ) : null}

          {opens.length === 0 ? null : (
            <label className="flex flex-col gap-1.5">
              <span className="text-helper text-muted">{t("desktop.dashboard.settings.open")}</span>
              <select
                className="lv-dash-select rounded-field border border-line bg-surface text-base"
                value={display.open ?? "default"}
                onChange={(event) => {
                  const { open: _open, ...rest } = display;
                  const value = event.target.value;
                  setDisplay(value === "entries" || value === "analysis" || value === "none" ? { ...rest, open: value } : rest);
                }}
              >
                {opens.map((value) => (
                  <option key={value} value={value}>{t(`desktop.dashboard.settings.opens.${value === "default" ? (kind === "trend" ? "trend" : kind === "ledger" ? "ledger" : "card") : value}`)}</option>
                ))}
              </select>
            </label>
          )}

          {hasEmpty ? (
            <label className="flex min-h-11 items-center gap-3 text-body text-ink">
              <input type="checkbox" className="size-5 accent-brand" checked={display.empty === "quiet"} onChange={(event) => {
                const { empty: _empty, ...rest } = display;
                setDisplay(event.target.checked ? { ...rest, empty: "quiet" } : rest);
              }} />
              {t("desktop.dashboard.settings.quiet")}
            </label>
          ) : null}
          <label className="flex min-h-11 items-center gap-3 text-body text-ink">
            <input type="checkbox" className="size-5 accent-brand" checked={display.masked === true} onChange={(event) => {
              const { masked: _masked, ...rest } = display;
              setDisplay(event.target.checked ? { ...rest, masked: true } : rest);
            }} />
            {t("desktop.dashboard.settings.masked")}
          </label>

          {!native ? (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="text-helper text-muted">{t("desktop.dashboard.settings.source")}</span>
                <select className="lv-dash-select rounded-field border border-line bg-surface text-base" value={source ?? ""} onChange={(event) => setSource(event.target.value === "" ? null : event.target.value)}>
                  <option value="">{t("desktop.dashboard.settings.followCurrent")}</option>
                  {books.map((book) => <option key={book.id} value={book.id}>{book.name}</option>)}
                </select>
                <span className="text-helper-relaxed text-muted">
                  {source === null
                    ? t("desktop.dashboard.settings.sourceCurrentHint", { name: currentBookId === null ? "—" : bookName(currentBookId) })
                    : t("desktop.dashboard.settings.sourceBookHint")}
                </span>
              </label>
              <button type="button" className="flex min-h-12 flex-col items-start rounded-field border border-line px-4 py-2.5 text-left transition hover:bg-canvas" onClick={onEditContent}>
                <span className="text-body text-ink">{t("desktop.dashboard.settings.editContent")}</span>
                <span className="text-helper text-muted">{t("desktop.dashboard.settings.editContentHint")}</span>
              </button>
            </>
          ) : null}
        </div>
      )}
    </BottomSheet>
  );
}
