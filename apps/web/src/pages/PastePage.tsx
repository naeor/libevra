import { useId, useState } from "react";
import {
  splitTransactionTexts,
  parseTransactionText,
  type CategoryCandidate,
  type TransactionTextResult,
} from "@libellum/shared";
import { useNavigate } from "react-router";

import { Alert } from "../components/Alert.js";
import { Button } from "../components/Button.js";
import { InnerPage } from "../components/Layouts.js";
import { useI18n } from "../i18n/index.js";
import { translateSharedMessage } from "../i18n/sharedMessages.js";
import { currencyName } from "../lib/format.js";
import { displayCategoryName, displayPaymentMethodName } from "../lib/presetNames.js";
import { useLedger } from "../lib/queries.js";
import { handOverSpoken } from "../lib/scanHandoff.js";

/**
 * 输入框里的示例。**识别规则按中文写**（关键词、商户、支付渠道），所以英文界面也保持这两句
 * 中文示例，只翻译“例如 / 或粘贴”这些说明。
 */
const TYPED_EXAMPLE = "今天中午麦当劳花了 28.5 元"; // i18n-ignore：识别语言（中文）的示例，不随界面语言变化
const PASTED_EXAMPLE = "微信支付：交易成功，实付 ¥28.50"; // i18n-ignore：识别语言（中文）的示例，不随界面语言变化

/** One pasted transaction, with the exact lines it was read from. */
export interface PasteCandidate {
  readonly sourceText: string;
  readonly parsed: TransactionTextResult;
}

/**
 * Parse pasted text into the same candidate model voice uses.
 *
 * Exported for the acceptance tests, and because the screen's only real work is
 * this step plus the clipboard gesture. Keeping it a pure function makes the
 * "did the split keep the right source lines?" question testable without a DOM.
 */
export function recognisePastedText(
  text: string,
  categories: readonly CategoryCandidate[],
  now: Date = new Date(),
): readonly PasteCandidate[] {
  return splitTransactionTexts(text.trim()).map((sourceText) => ({
    sourceText,
    parsed: parseTransactionText(sourceText, { categories, now }),
  }));
}

/**
 * Pasting transaction text.
 *
 * The point of this screen is not that it is another form. It exists so that a
 * sentence copied from WeChat/Alipay/a bank, or typed by the user, goes through
 * **the same transaction-semantics core as speech** and lands in the same review
 * form. The only thing this screen owns is the text cleanup and the paste
 * gesture.
 *
 * Nothing here writes to the ledger, calls an external service, or keeps the
 * text after navigation. The text lives in this component's state and in the
 * one-shot in-memory handover; a refresh intentionally loses it.
 */
export function PastePage(): React.JSX.Element {
  const navigate = useNavigate();
  const { t } = useI18n();
  const ledger = useLedger();
  const [text, setText] = useState("");
  /** S18：两个工作区可以同时打开粘贴识别。 */
  const textId = useId();
  const [candidates, setCandidates] = useState<readonly PasteCandidate[] | null>(null);
  const [clipboardError, setClipboardError] = useState<string | null>(null);

  const categories = ledger.data?.categories ?? [];

  async function pasteFromClipboard(): Promise<void> {
    setClipboardError(null);

    /**
     * Read only from this click. Reading on mount would be both a privacy
     * problem and a compatibility one: browsers only allow clipboard access
     * from a user gesture, and some do not allow it at all.
     */
    try {
      if (navigator.clipboard?.readText === undefined) {
        throw new Error("unsupported");
      }
      const pasted = await navigator.clipboard.readText();
      if (pasted.trim() === "") {
        setClipboardError(t("capture.paste.clipboardEmpty"));
        return;
      }
      setText(pasted);
      setCandidates(null);
    } catch {
      setClipboardError(t("capture.paste.clipboardDenied"));
    }
  }

  function recognise(): void {
    const trimmed = text.trim();
    if (trimmed === "") {
      setCandidates(null);
      return;
    }

    setCandidates(recognisePastedText(trimmed, categories));
  }

  return (
    <InnerPage
      title={t("capture.paste.title")}
      backTo="/"
    >
      {clipboardError === null ? null : <Alert tone="info">{clipboardError}</Alert>}

      <section className="flex flex-col gap-3">
        <label htmlFor={textId} className="text-card-title text-ink">
          {t("capture.paste.label")}
        </label>
        <textarea
          id={textId}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            // A result belongs to the text that produced it. Keeping it after
            // an edit would let a stale candidate be saved under new text.
            setCandidates(null);
          }}
          rows={6}
          placeholder={t("capture.paste.placeholder", { typed: TYPED_EXAMPLE, pasted: PASTED_EXAMPLE })}
          className="w-full rounded-field border border-line bg-surface px-4 py-3 text-base leading-relaxed text-ink outline-none focus:border-brand"
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" fullWidth={false} onClick={() => void pasteFromClipboard()}>
            {t("capture.paste.fromClipboard")}
          </Button>
          <Button
            variant="secondary"
            fullWidth={false}
            onClick={() => {
              setText("");
              setCandidates(null);
              setClipboardError(null);
            }}
          >
            {t("capture.paste.clear")}
          </Button>
        </div>

        <Button onClick={recognise} disabled={text.trim() === ""}>
          {t("capture.paste.recognize")}
        </Button>

        <p className="text-helper-relaxed text-muted">
          {t("capture.paste.privacy")}
        </p>
      </section>

      {candidates === null ? null : candidates.length === 0 ||
        candidates.every(
          (candidate) =>
            candidate.parsed.amount === null && candidate.parsed.merchant === null,
        ) ? (
        <Alert tone="info">
          {t("capture.paste.nothingFound")}
        </Alert>
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="text-section-title text-ink">
            {candidates.length > 1
              ? t("capture.paste.resultsMany", { count: candidates.length })
              : t("capture.paste.resultsSingle")}
          </h2>

          {candidates.map((candidate, index) => (
            <CandidateCard
              key={`${String(index)}:${candidate.parsed.amount ?? ""}:${candidate.parsed.merchant ?? ""}`}
              candidate={candidate}
              index={index}
              total={candidates.length}
              categoryName={(() => {
                const name = categories.find((category) => category.id === candidate.parsed.categoryId)?.name;
                return name === undefined ? null : displayCategoryName(name);
              })()}
              onConfirm={() => {
                handOverSpoken({
                  text: candidate.sourceText,
                  parsed: candidate.parsed,
                  source: "paste",
                });
                void navigate("/paste/review");
              }}
            />
          ))}
        </section>
      )}

      <button
        type="button"
        onClick={() => void navigate("/add")}
        className="touch-target self-center text-helper text-muted underline"
      >
        {t("capture.manualFallback")}
      </button>
    </InnerPage>
  );
}

/** One recognized transaction, shown as a checkable summary, never as a saved row. */
function CandidateCard({
  candidate,
  index,
  total,
  categoryName,
  onConfirm,
}: {
  readonly candidate: PasteCandidate;
  readonly index: number;
  readonly total: number;
  readonly categoryName: string | null;
  readonly onConfirm: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const parsed = candidate.parsed;
  const direction = t(parsed.kind === "income" ? "common.kind.income" : "common.kind.expense");
  const money =
    parsed.amount === null
      ? t("capture.paste.amountPending")
      : `${t("capture.paste.amountLine", { kind: direction, amount: parsed.amount })}${parsed.currency === null ? "" : ` ${currencyName(parsed.currency)}`}`;

  return (
    <article className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="min-w-0 text-base font-medium text-ink">{money}</p>
        {total > 1 ? <span className="shrink-0 text-helper text-muted">{t("capture.paste.position", { number: index + 1 })}</span> : null}
      </div>

      {/* 识别出来的日期、时间、商户是原文（数据）；支付方式只在是预置名时显示译名。 */}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <Field label={t("common.field.date")} value={parsed.occurredLocalDate ?? t("capture.paste.toConfirm")} />
        <Field label={t("common.field.time")} value={parsed.occurredTime ?? t("capture.paste.notFound")} />
        <Field label={t("common.field.merchant")} value={parsed.merchant ?? t("capture.paste.notFound")} />
        <Field
          label={t("common.field.paymentMethod")}
          value={parsed.paymentMethod === null ? t("capture.paste.notFound") : displayPaymentMethodName(parsed.paymentMethod)}
        />
        <Field label={t("common.field.category")} value={categoryName ?? t("capture.paste.toChoose")} />
      </dl>

      {/*
        The exact lines this card was parsed from. Kept visible so a wrong
        split is caught here, not after it has become a saved transaction.

        ⚠️ S16-A: only when the text produced more than one card. With a single card the source is
        the whole text still sitting in the box above, so the grey copy repeated it word for word
        and doubled the card's height; the split check it exists for only applies to several cards.
      */}
      {total > 1 ? (
        <p className="whitespace-pre-wrap rounded-field bg-canvas px-3 py-2 text-helper-relaxed text-muted">
          {candidate.sourceText}
        </p>
      ) : null}

      {parsed.issues.length > 0 ? (
        <ul className="flex flex-col gap-1 text-helper-relaxed text-muted">
          {parsed.issues.map((issue) => (
            <li key={`${issue.field}:${issue.code}`}>
              {issue.severity === "ambiguous" ? t("capture.issue.ambiguous") : t("capture.issue.warning")}
              {/* 识别核心（@libellum/shared transactionText）给出的中文说明，按原文查表翻译。 */}
              {translateSharedMessage(issue.message)}
            </li>
          ))}
        </ul>
      ) : null}

      {/*
        ⚠️ A numbered list or a paragraph with several purchases is **not**
        split here. Guessing which amount belongs to which line is how two
        transactions become one wrong saved entry; the honest answer is to ask
        for the text to be pasted one record at a time. The button is disabled
        so the warning cannot be clicked past by accident.
      */}
      {parsed.multipleTransactions ? (
        <Alert tone="info">
          {t("capture.paste.multiple")}
        </Alert>
      ) : null}

      <Button onClick={onConfirm} disabled={parsed.multipleTransactions}>
        {t("capture.paste.review")}
      </Button>
    </article>
  );
}

function Field({ label, value }: { readonly label: string; readonly value: string }): React.JSX.Element {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="truncate text-ink">{value}</dd>
    </>
  );
}
