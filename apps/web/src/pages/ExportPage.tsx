import { CURRENCIES, type Category, type Currency, type ExportFormat } from "@libellum/shared";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { Alert } from "../components/Alert.js";
import { Button } from "../components/Button.js";
import { InnerPage } from "../components/Layouts.js";
import { useAuth } from "../auth/AuthProvider.js";
import { useI18n } from "../i18n/index.js";
import { errorMessage } from "../lib/api.js";
import { currentMonth, formatMonthLabel, shiftMonth } from "../lib/datetime.js";
import { currencyName } from "../lib/format.js";
import { displayCategoryName } from "../lib/presetNames.js";
import { fetchExport, fetchTemplate, useLedger, useLedgerMeta } from "../lib/queries.js";
import { canShareFiles, deliverFile } from "../lib/share.js";

/**
 * Export the ledger.
 *
 * The owner's design: the tool button on the detail screen leads here, the user
 * chooses what to take, and pressing 导出 hands the file over — **the share
 * sheet on an iPhone, an ordinary download everywhere else**. That difference is
 * not cosmetic. iOS has no downloads folder to speak of; a saved blob is a dead
 * end, whereas the share sheet offers 存储到文件, AirDrop and the rest.
 *
 * The screen is deliberately one page with no sub-dialogs: filters, format,
 * button. Everything on it is optional — pressing 导出 with the defaults exports
 * the whole ledger, which is the common case.
 *
 * ⚠️ **S13-E 之后这一页有第二个入口：`/books/:bookId/settings/export`。**
 * 它导出的是**地址里那本账**，不是"当前账本"——所以这条路由把 `bookId` 一路带到
 * `fetchExport(filters, bookId)` / `fetchTemplate(bookId)`，而屏幕上先用
 * `useLedgerMeta(bookId)` 把**目标账本的名字与编号**写在标题下面。**导错账本是不可接受的**：
 * 文件看起来完全正常，只是里面的账不是用户以为的那一本。
 *
 * ⚠️ **两条路径的区别只有"数据从哪来 / 给谁"**：`/export` 与明细页的工具按钮保持原样
 * （当前账本、`useLedger()`、返回 `/`），目标模式不调用 `useLedger()`。
 *
 * ⚠️ **S15-C：这一页的返回是 `parent` 模式，两种入口都一样。** 导出是账本设置的子页，
 * 但也可以从明细页的工具按钮直接进来（`/export`）。两条入口的父级都是固定的：
 * `/books/:bookId/settings/export` → 账本设置，`/export` → 明细。**用历史会让「设置 ⇄ 导出」
 * 互相指回去**——设置 → 导出 → 返回（设置）→ 返回（导出）——所以两条入口都声明父级模式。
 *
 * ⚠️ **S16 国际化：只翻译这一页的界面，导出的文件不随语言变化。** 文件内容（表头、列顺序、日期与
 * 金额格式）由服务器生成，请求里不带界面语言；文件名由 `lib/queries.ts` 按固定规则生成。
 * 切换语言前后导出的文件逐字节一致（见 `ExportPage.locale.test.ts`）。
 */

type RangePreset = "all" | "thisMonth" | "lastMonth" | "last3" | "custom";

/** 快捷范围按钮的顺序；文字在渲染时取 `dataio.export.range.<id>`。 */
const RANGE_PRESETS: readonly Exclude<RangePreset, "custom">[] = ["all", "thisMonth", "lastMonth", "last3"];

/*
 * The sentence the current-ledger entry and 账本设置's export entry share (`dataio.export.hint`).
 *
 * ⚠️ S16-A: it now sits under the 导出 button (what happens to the file), not under the title. Its old
 * first half, 「选择要导出的范围与格式。」, only described the form directly below it, and with the
 * ledger name in front it made the header four lines tall at 390px.
 */

function rangeForPreset(preset: RangePreset, customFrom: string, customTo: string): {
  monthFrom?: string;
  monthTo?: string;
} {
  const thisMonth = currentMonth();

  switch (preset) {
    case "all":
      return {};
    case "thisMonth":
      return { monthFrom: thisMonth, monthTo: thisMonth };
    case "lastMonth": {
      const last = shiftMonth(thisMonth, -1);
      return { monthFrom: last, monthTo: last };
    }
    case "last3":
      return { monthFrom: shiftMonth(thisMonth, -2), monthTo: thisMonth };
    case "custom":
      return {
        ...(customFrom === "" ? {} : { monthFrom: customFrom }),
        ...(customTo === "" ? {} : { monthTo: customTo }),
      };
  }
}

/** A month input that falls back to the current month when first opened. */
function defaultMonth(offset: number): string {
  return shiftMonth(currentMonth(), offset);
}

/**
 * ⚠️ **The route decides the mode**, and the two wrappers exist for one reason:
 * **the current-ledger branch is the only one allowed to call `useLedger()`** (it sets this device's
 * ledger). Both then render the same screen, so the export itself cannot behave differently.
 */
export function ExportPage(): React.JSX.Element {
  const { bookId } = useParams<{ bookId?: string }>();

  return bookId === undefined ? <ExportForCurrentLedger /> : <ExportForBook bookId={bookId} />;
}

function ExportForCurrentLedger(): React.JSX.Element {
  const ledger = useLedger();

  return (
    <ExportView
      categories={ledger.data?.categories ?? []}
      loading={ledger.isLoading}
      backTo="/"
      importTo="/import"
    />
  );
}

function ExportForBook({ bookId }: { readonly bookId: string }): React.JSX.Element {
  const meta = useLedgerMeta(bookId);
  const { t } = useI18n();

  const name = meta.data?.book.name ?? null;
  const bookNumber = meta.data?.book.bookNumber ?? null;
  const label =
    name === null
      ? t("dataio.common.readingBook")
      : bookNumber === null
        ? name
        : t("dataio.common.bookLabel", { name, number: bookNumber });

  return (
    /**
     * ⚠️ **Keyed by the ledger**, so the filter state (and especially a `categoryId` picked from
     * another ledger's list) cannot survive a change of target.
     */
    <ExportView
      key={bookId}
      categories={meta.data?.categories ?? []}
      loading={meta.isLoading}
      backTo={`/books/${bookId}/settings`}
      subtitle={t("dataio.export.subtitle", { label })}
      importTo={`/books/${bookId}/settings/import`}
      bookId={bookId}
      failure={meta.isError ? errorMessage(meta.error) : null}
    />
  );
}

function ExportView({
  categories: allCategories,
  loading,
  backTo,
  subtitle,
  importTo,
  bookId,
  failure = null,
}: {
  readonly categories: readonly Category[];
  readonly loading: boolean;
  readonly backTo: string;
  readonly subtitle?: string;
  /** Where the 导入 button goes: `/import` for the current ledger, the book's own page otherwise. */
  readonly importTo: string;
  /** ⚠️ Named only in target mode — and then every request below carries it. */
  readonly bookId?: string;
  readonly failure?: string | null;
}): React.JSX.Element {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t, locale } = useI18n();

  const [format, setFormat] = useState<ExportFormat>("csv");
  const [range, setRange] = useState<RangePreset>("all");
  const [customFrom, setCustomFrom] = useState(defaultMonth(-1));
  const [customTo, setCustomTo] = useState(currentMonth());
  const [kind, setKind] = useState<"all" | "expense" | "income">("all");
  const [currency, setCurrency] = useState<Currency | "all">("all");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const categories = useMemo(
    () => allCategories.filter((category) => !category.isSystem),
    [allCategories],
  );
  const [categoryId, setCategoryId] = useState<string>("all");

  /**
   * What the button will do, said plainly before it is pressed.
   *
   * Telling someone "this will use the share sheet" in advance is the difference
   * between a welcome surprise and a confusing one — and on a desktop it warns
   * that a file is about to appear in their downloads.
   */
  const deliveryHint = useMemo(() => {
    // A throwaway file of the same shape: `canShare` only inspects the file.
    const probe = new File([new Uint8Array(1)], "probe.csv", { type: "text/csv" });
    return canShareFiles(probe) ? t("dataio.export.deliveryShare") : t("dataio.export.deliveryDownload");
    // `locale`：切换语言后重新取文案（`t` 本身不变）。
  }, [locale, t]);

  async function run(): Promise<void> {
    setBusy(true);
    setError(null);
    setDone(null);

    try {
      const bounds = rangeForPreset(range, customFrom, customTo);

      const file = await fetchExport(
        {
          format,
          ...bounds,
          ...(kind === "all" ? {} : { kind }),
          ...(currency === "all" ? {} : { currency }),
          ...(categoryId === "all" ? {} : { categoryId }),
        },
        bookId,
      );

      const outcome = await deliverFile(file.fileName, file.mimeType, file.bytes);

      if (outcome.cancelled) {
        setDone(t("dataio.export.cancelled"));
        return;
      }

      setDone(
        outcome.method === "share"
          ? t("dataio.export.doneShare", { count: file.rowCount, ref: file.fileRef })
          : t("dataio.export.doneDownload", { count: file.rowCount, ref: file.fileRef }),
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function downloadTemplate(): Promise<void> {
    setBusy(true);
    setError(null);
    setDone(null);

    try {
      const file = await fetchTemplate(bookId);
      const outcome = await deliverFile(file.fileName, file.mimeType, file.bytes);
      if (!outcome.cancelled) setDone(t("dataio.export.templateDone"));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <InnerPage title={t("dataio.export.title")} {...(subtitle === undefined ? {} : { subtitle })} backTo={backTo}>
      {error === null ? null : <Alert>{error}</Alert>}
      {failure === null ? null : <Alert>{failure}</Alert>}
      {done === null ? null : <Alert tone="success">{done}</Alert>}

      {/* ------------------------------------------------------------------ */}
      <section className="flex flex-col gap-3">
        <h2 className="text-section-title text-ink">{t("dataio.export.range.title")}</h2>

        <div className="grid grid-cols-2 gap-2">
          {RANGE_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              aria-pressed={range === preset}
              onClick={() => {
                setRange(preset);
              }}
              className={`rounded-field px-4 py-3 text-sm transition ${
                range === preset ? "bg-brand text-on-brand" : "bg-brand-soft text-brand-dark"
              }`}
            >
              {t(`dataio.export.range.${preset}`)}
            </button>
          ))}

          <button
            type="button"
            aria-pressed={range === "custom"}
            onClick={() => {
              setRange("custom");
            }}
            className={`col-span-2 rounded-field px-4 py-3 text-sm transition ${
              range === "custom" ? "bg-brand text-on-brand" : "bg-brand-soft text-brand-dark"
            }`}
          >
            {t("dataio.export.range.custom")}
          </button>
        </div>

        {range === "custom" ? (
          <div className="flex items-center gap-3">
            <label className="min-w-0 flex-1">
              <span className="sr-only">{t("dataio.export.range.from")}</span>
              <input
                type="month"
                value={customFrom}
                onChange={(event) => {
                  setCustomFrom(event.target.value);
                }}
                className="w-full rounded-field border border-line bg-surface px-3 py-3 text-[16px] text-ink"
              />
            </label>
            <span className="shrink-0 text-body text-muted">{t("dataio.export.range.between")}</span>
            <label className="min-w-0 flex-1">
              <span className="sr-only">{t("dataio.export.range.to")}</span>
              <input
                type="month"
                value={customTo}
                onChange={(event) => {
                  setCustomTo(event.target.value);
                }}
                className="w-full rounded-field border border-line bg-surface px-3 py-3 text-[16px] text-ink"
              />
            </label>
          </div>
        ) : null}

        <p className="text-helper-relaxed text-muted">
          {t("dataio.export.range.current", {
            value:
              range === "custom"
                ? t("dataio.export.range.customValue", {
                    from: formatMonthLabel(customFrom),
                    to: formatMonthLabel(customTo),
                  })
                : range === "all"
                  ? t("dataio.export.range.allRecords")
                  : t(`dataio.export.range.${range}`),
          })}
        </p>
      </section>

      {/* ------------------------------------------------------------------ */}
      <section className="flex flex-col gap-3">
        <h2 className="text-section-title text-ink">{t("dataio.export.format.title")}</h2>

        <div className="grid grid-cols-2 gap-2">
          {/* 「CSV」「Excel」是格式名，不翻译；说明文字随语言。 */}
          {(
            [
              ["csv", "CSV", t("dataio.export.format.csvHint")],
              ["xlsx", "Excel", t("dataio.export.format.xlsxHint")],
            ] as const
          ).map(([value, label, hint]) => (
            <button
              key={value}
              type="button"
              aria-pressed={format === value}
              onClick={() => {
                setFormat(value);
              }}
              className={`flex min-w-0 flex-col items-start gap-1 rounded-field px-4 py-3 text-left transition ${
                format === value ? "bg-brand text-on-brand" : "bg-brand-soft text-brand-dark"
              }`}
            >
              <span className="text-sm font-medium">{label}</span>
              <span className={`text-xs leading-snug ${format === value ? "text-on-brand/80" : "text-brand-dark/70"}`}>
                {hint}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      <section className="flex flex-col gap-3">
        <h2 className="text-section-title text-ink">{t("dataio.export.filters.title")}</h2>

        <label className="flex flex-col gap-1.5">
          <span className="text-body text-ink">{t("dataio.export.filters.kind")}</span>
          <select
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as typeof kind);
            }}
            className="rounded-field border border-line bg-surface px-3 py-3 text-[16px] text-ink"
          >
            <option value="all">{t("dataio.export.filters.kindAll")}</option>
            <option value="expense">{t("dataio.export.filters.kindExpense")}</option>
            <option value="income">{t("dataio.export.filters.kindIncome")}</option>
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-body text-ink">{t("dataio.export.filters.currency")}</span>
          <select
            value={currency}
            onChange={(event) => {
              setCurrency(event.target.value as typeof currency);
            }}
            className="rounded-field border border-line bg-surface px-3 py-3 text-[16px] text-ink"
          >
            <option value="all">{t("dataio.export.filters.currencyAll")}</option>
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {t("dataio.export.filters.currencyOption", { name: currencyName(code), code })}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-body text-ink">{t("dataio.export.filters.category")}</span>
          <select
            value={categoryId}
            onChange={(event) => {
              setCategoryId(event.target.value);
            }}
            className="rounded-field border border-line bg-surface px-3 py-3 text-[16px] text-ink"
          >
            <option value="all">{t("dataio.export.filters.categoryAll")}</option>
            {/* 预置分类只在显示时翻译；筛选提交的是 id，导出文件里仍是原名。 */}
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.kind === "expense" ? t("common.kind.expense") : t("common.kind.income")} ·{" "}
                {displayCategoryName(category.name)}
              </option>
            ))}
          </select>
        </label>
      </section>

      {/* ------------------------------------------------------------------ */}
      <section className="flex flex-col gap-3">
        <Button
          onClick={() => {
            void run();
          }}
          /**
           * ⚠️ **A target ledger that cannot be read cannot be exported either** — the server would
           * refuse, and pressing a button that is certain to fail is worse than seeing why it will not.
           */
          disabled={busy || loading || failure !== null}
        >
          {busy ? t("dataio.export.preparing") : t("dataio.export.run")}
        </Button>

        <p className="text-helper-relaxed text-muted">
          {t("dataio.export.hintWithDelivery", { hint: t("dataio.export.hint"), delivery: deliveryHint })}
        </p>

        <Button
          variant="secondary"
          onClick={() => {
            void downloadTemplate();
          }}
          disabled={busy}
        >
          {t("dataio.export.template")}
        </Button>
        <p className="text-helper-relaxed text-muted">{t("dataio.export.templateHint")}</p>

        <Button
          variant="ghost"
          onClick={() => {
            void navigate(importTo);
          }}
        >
          {t("dataio.export.importLink")}
        </Button>
      </section>

      {/*
        There is deliberately **no** list of past exports here.

        An earlier version of this screen showed one, and the owner's objection
        is worth stating as a principle rather than a preference: **this site is
        a client.** Everything built here is visible to every user of it, so the
        test for anything on a screen is not "is this interesting" but "does this
        user have to see this". Audit data — who exported what, and when — is the
        server's record of events, not the client's content. The safest way not
        to show something is not to send it.

        `GET /api/v1/export-log` still exists and is scoped to the caller's own
        book, so it can back a "my export history" surface the day there is a
        reason for one. Until then the client does not ask for it, and therefore
        cannot show it.
      */}

      <p className="text-helper-relaxed text-muted">
        {t("dataio.export.currencyNote", { currency: currencyName(user?.defaultCurrency ?? "CNY") })}
      </p>
    </InnerPage>
  );
}
