import { useState } from "react";
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
import { currencyName } from "../lib/format.js";
import { useLedger } from "../lib/queries.js";
import { handOverSpoken } from "../lib/scanHandoff.js";

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
  const ledger = useLedger();
  const [text, setText] = useState("");
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
        setClipboardError("剪贴板里没有文字，可以直接在下面手动粘贴。");
        return;
      }
      setText(pasted);
      setCandidates(null);
    } catch {
      setClipboardError("浏览器没有允许读取剪贴板，请在下面手动粘贴。");
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
      title="粘贴识别"
      subtitle="粘贴交易文字，自动识别金额、日期和分类。"
      backTo="/"
    >
      {clipboardError === null ? null : <Alert tone="info">{clipboardError}</Alert>}

      <section className="flex flex-col gap-3">
        <label htmlFor="paste-text" className="text-card-title text-ink">
          交易文字
        </label>
        <textarea
          id="paste-text"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            // A result belongs to the text that produced it. Keeping it after
            // an edit would let a stale candidate be saved under new text.
            setCandidates(null);
          }}
          rows={6}
          placeholder={"例如：今天中午麦当劳花了 28.5 元\n或粘贴：微信支付：交易成功，实付 ¥28.50"}
          className="w-full rounded-field border border-line bg-surface px-4 py-3 text-base leading-relaxed text-ink outline-none focus:border-brand"
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" fullWidth={false} onClick={() => void pasteFromClipboard()}>
            从剪贴板粘贴
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
            清空
          </Button>
        </div>

        <Button onClick={recognise} disabled={text.trim() === ""}>
          识别交易
        </Button>

        <p className="text-helper-relaxed text-muted">
          不会自动读取剪贴板；识别只在本机完成，不会把文字发给外部 AI，也不会在确认前写入账本。
        </p>
      </section>

      {candidates === null ? null : candidates.length === 0 ||
        candidates.every(
          (candidate) =>
            candidate.parsed.amount === null && candidate.parsed.merchant === null,
        ) ? (
        <Alert tone="info">
          没有从这段文字里认出交易金额。可以补充金额或商户后重试，也可以直接手动记账。
        </Alert>
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="text-section-title text-ink">
            识别结果（{candidates.length > 1 ? `共 ${String(candidates.length)} 笔` : "1 笔"}）
          </h2>

          {candidates.map((candidate, index) => (
            <CandidateCard
              key={`${String(index)}:${candidate.parsed.amount ?? ""}:${candidate.parsed.merchant ?? ""}`}
              candidate={candidate}
              index={index}
              total={candidates.length}
              categoryName={
                categories.find((category) => category.id === candidate.parsed.categoryId)?.name ??
                null
              }
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
        className="text-helper text-muted underline"
      >
        识别不方便？直接手动记账
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
  const parsed = candidate.parsed;
  const direction = parsed.kind === "income" ? "收入" : "支出";
  const money =
    parsed.amount === null
      ? "金额待确认"
      : `${direction} ${parsed.amount}${parsed.currency === null ? "" : ` ${currencyName(parsed.currency)}`}`;

  return (
    <article className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-base font-medium text-ink">{money}</p>
        {total > 1 ? <span className="text-helper text-muted">第 {String(index + 1)} 笔</span> : null}
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <Field label="日期" value={parsed.occurredLocalDate ?? "待确认"} />
        <Field label="时间" value={parsed.occurredTime ?? "未识别"} />
        <Field label="商户" value={parsed.merchant ?? "未识别"} />
        <Field label="支付方式" value={parsed.paymentMethod ?? "未识别"} />
        <Field label="分类" value={categoryName ?? "待选择"} />
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
              {issue.severity === "ambiguous" ? "需要确认：" : "提示："}
              {issue.message}
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
          这段文字里可能有多笔交易，目前无法可靠拆分。请先按每一笔分开粘贴，避免把多笔合成一笔。
        </Alert>
      ) : null}

      <Button onClick={onConfirm} disabled={parsed.multipleTransactions}>
        核对这笔记账
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
