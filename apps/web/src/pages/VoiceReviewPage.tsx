import { useMemo, useState } from "react";
import {
  UNCATEGORISED_NAME,
  decimalsFor,
  type CategoryCandidate,
  type CreateTransactionInput,
  type DuplicatePairResult,
  type Transaction,
  type TransactionTextResult,
} from "@libellum/shared";
import { Trans } from "react-i18next";
import { useNavigate } from "react-router";

import { Alert } from "../components/Alert.js";
import { ChoiceDialog, type Choice } from "../components/ChoiceDialog.js";
import { useDuplicateDetectionSettings } from "../components/DuplicateDetectionSettings.js";
import { EntrySaved } from "../components/EntrySaved.js";
import { ReviewStep, type ReviewDraft } from "../components/EntryForm.js";
import { InnerPage } from "../components/Layouts.js";
import { isChineseLocale, t as translate, useI18n } from "../i18n/index.js";
import { translateSharedMessage } from "../i18n/sharedMessages.js";
import { errorMessage } from "../lib/api.js";
import { currentBookId } from "../lib/currentBook.js";
import {
  currentMonth,
  localTimeZone,
  toLocalDate,
  toLocalIso,
} from "../lib/datetime.js";
import { describeDuplicateMatchText } from "../lib/duplicateReview.js";
import { currencyName, formatMoney, parseAmountInput } from "../lib/format.js";
import { createNotDuplicateRelations, notDuplicateConfirmationForEntry } from "../lib/notDuplicateRelations.js";
import { displayCategoryName, displayPaymentMethodName } from "../lib/presetNames.js";
import {
  useCheckDuplicates,
  useCreateTransaction,
  useDeleteTransaction,
  useLedger,
  useRestoreTransaction,
  useTransactions,
} from "../lib/queries.js";
import { takeSpokenHandover } from "../lib/scanHandoff.js";
import { uuidV7 } from "../lib/uuid.js";

/**
 * Turn one shared-core candidate into the form's starting values.
 *
 * Pure, and exported for the acceptance tests: the screen's job is the save
 * handshake, while the mapping is where a field quietly lands in the wrong
 * place — an amount losing its decimals, a date becoming today because the
 * parse was `null`, or a payment label being matched to the wrong card.
 *
 * The two "do not invent" rules stay here:
 *
 *  * A missing date falls back to **today**, which is what "recorded now" means,
 *    not a guess about what the user said.
 *  * A payment label only fills the field when exactly one ledger method fits;
 *    支付宝 and 余额宝 are different things, and an empty field gets chosen
 *    while a wrong one gets confirmed.
 */
export function draftOf(
  parsed: TransactionTextResult | null,
  fallbackText: string,
  categories: readonly CategoryCandidate[],
  paymentMethods: readonly { readonly id: string; readonly name: string; readonly isArchived: boolean }[],
  lastCategoryId: string | null,
  now: Date = new Date(),
  /**
   * Whether the note may start from the heard/pasted text. Voice keeps the old
   * behaviour (the transcript stays next to the form while it is being checked);
   * paste does not, because a copied payment detail can contain an order number
   * or a whole bank message and the note is saved. The paste screen shows the
   * snippet for review and only a short merchant note is prefilled.
   */
  keepTranscriptInNote = true,
): { readonly draft: ReviewDraft; readonly categoryReason: string | null; readonly heardCategoryId: string | null } {
  const usable = (id: string | null): string | null =>
    id !== null && categories.some((category) => category.id === id && !category.isArchived) ? id : null;

  const heardCategoryId = usable(parsed?.categoryId ?? null);
  const categoryId = heardCategoryId ?? usable(lastCategoryId);

  const label = parsed?.paymentMethod ?? null;
  const matches =
    label === null
      ? []
      : paymentMethods.filter(
          (method) => method.name === label || method.name.includes(label) || label.includes(method.name),
        );

  return {
    draft: {
      amount: parsed?.amount ?? "",
      kind: parsed?.kind ?? "expense",
      currency: parsed?.currency ?? "CNY",
      date: parsed?.occurredLocalDate ?? toLocalDate(now),
      time: parsed?.occurredTime ?? "",
      categoryId,
      paymentMethodId: matches.length === 1 ? (matches[0]?.id ?? null) : null,
      note: keepTranscriptInNote
        ? parsed?.note !== undefined && parsed.note !== ""
          ? parsed.note
          : fallbackText
        : (parsed?.merchant ?? ""),
    },
    categoryReason:
      heardCategoryId === null || parsed === null || parsed.categoryMatched.length === 0
        ? null
        : parsed.categoryMatched.join("、"),
    heardCategoryId,
  };
}

/**
 * Confirming an entry that was spoken.
 *
 * **The same form as the camera path**, which is what the owner asked for:
 * "核对页面跟拍照记账的核对页面可以类似". Similar is served best by *being* the same
 * component — the questions are identical (how much, what kind, when, which
 * category, paid how, what note), and two copies would drift the first time a
 * field was added to one of them.
 *
 * What differs is where the starting values come from, and one line at the top:
 * the sentence that was heard. That line is the trust mechanism for speech and
 * the reason the transcript is shown rather than quietly consumed — recognition
 * fails in ways that look plausible, and the owner's own example is the one to
 * keep in mind: **午饭 came back as 五份**. Nobody can catch that in a filled-in
 * form; they can catch it beside the sentence that produced it.
 *
 * **A date is taken only from an explicit date word.** "昨天" and "10 月 8 日"
 * are parsed by the same core as the amount, with the browser's local clock, so
 * a relative date means the user's today rather than the server's. When the
 * sentence says no date, the entry stays today — which is what "recorded now"
 * means, not a guess about what the user said.
 */
export function VoiceReviewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { t, locale } = useI18n();
  const ledger = useLedger();
  const createEntry = useCreateTransaction();
  const removeEntry = useDeleteTransaction();
  const restoreEntry = useRestoreTransaction();

  /**
   * Read once, on mount; the handover is emptied as it is read.
   *
   * A `useState` initialiser rather than `useMemo`, so it reads exactly once even
   * under React's development double-render — a double read takes the draft the
   * first time and `null` the second, which is a bug that only appears in dev.
   */
  const [spoken] = useState(() => takeSpokenHandover());

  const [saved, setSaved] = useState<Transaction | null>(null);
  const [undone, setUndone] = useState<Transaction | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * 语音记账同样只给**轻提醒**（S15-E4）：一句话问，不上分组核对页。
   * 规则、设置和文案都来自统一核心，与手动/拍照完全一致。
   */
  const checkDuplicates = useCheckDuplicates();
  const duplicateSettings = useDuplicateDetectionSettings();
  const [pendingDuplicate, setPendingDuplicate] = useState<{
    readonly input: CreateTransactionInput;
    readonly existing: readonly Transaction[];
    readonly pairs: readonly DuplicatePairResult[];
    readonly scope: "server" | "local";
  } | null>(null);

  const categories = ledger.data?.categories ?? [];
  const paymentMethods = ledger.data?.paymentMethods ?? [];
  const parsed = spoken?.parsed ?? null;
  const origin = spoken?.source === "paste" ? "/paste" : "/record";

  /** 对话框选项按语言生成一次（见 `localizeChoices`）；必须在下面的提前返回之前调用。 */
  const choices = useMemo(
    () => ({
      duplicate: localizeChoices(MANUAL_DUPLICATE_CHOICES),
      undone: localizeChoices(UNDONE_CHOICES),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );

  /**
   * The category a new entry starts on.
   *
   * ⚠️ **What was said wins over what was used last**, which is the opposite of
   * the camera path's rule and deliberately so. A screenshot carries no hint about
   * the category, so the last one used is the only evidence available. A sentence
   * often carries one — "午饭三十八" is food — and the shared parser has already
   * worked out which of *this* ledger's categories it sounds like. Falling back
   * to the last used one only when nothing matched.
   */
  const recent = useTransactions({ month: currentMonth(), kind: parsed?.kind ?? "expense" });
  const lastCategoryId = recent.data?.pages[0]?.items[0]?.categoryId ?? null;

  /**
   * The form's starting values, mapped from the same candidate the paste screen
   * uses. All of the "what does this field mean" decisions live in `draftOf`,
   * where they are testable without a session.
   */
  const { draft, categoryReason, heardCategoryId } = useMemo(
    () =>
      draftOf(
        parsed,
        spoken?.text ?? "",
        categories,
        paymentMethods,
        lastCategoryId,
        undefined,
        spoken?.source !== "paste",
      ),
    [parsed, spoken?.text, spoken?.source, categories, paymentMethods, lastCategoryId],
  );

  /**
   * 写入 + 记录「不是同一笔」。
   *
   * 「仍然保存」传空数组：用户保留两笔相似账目，并不等于他确认这两笔不是同一笔。
   */
  async function write(
    input: CreateTransactionInput,
    notDuplicateWith: readonly string[] = [],
  ): Promise<void> {
    try {
      const entry = await createEntry.mutateAsync(input);
      setSaved(entry);
      setPendingDuplicate(null);

      if (notDuplicateWith.length > 0) {
        try {
          const bookId = ledger.data?.book.id ?? currentBookId();
          if (bookId === null) throw new Error(t("capture.notDuplicate.bookMissing"));
          const confirmation = notDuplicateConfirmationForEntry(notDuplicateWith, entry.id);
          if (confirmation === null) throw new Error(t("capture.notDuplicate.noPairs"));
          await createNotDuplicateRelations(bookId, confirmation);
        } catch (caught) {
          setError(t("capture.review.notDuplicateFailed", { reason: errorMessage(caught) }));
        }
      }
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  /**
   * Nothing to confirm.
   *
   * Reached by a refresh, a bookmark, or a back press after the handover has been
   * read. Saying so and offering the recorder is better than an empty form the
   * user has to work out is empty.
   */
  if (spoken === null) {
    return (
      <InnerPage title={t("capture.review.title")} subtitle={t("capture.review.emptySubtitle")} backTo="/">
        <button
          type="button"
          onClick={() => void navigate("/record")}
          className="touch-target self-start text-body text-brand-dark underline"
        >
          {t("capture.review.goRecord")}
        </button>
      </InnerPage>
    );
  }

  if (saved !== null) {
    return (
      <>
        <EntrySaved
          entry={saved}
          categoryName={displayCategoryName(
            categories.find((category) => category.id === saved.categoryId)?.name ??
            UNCATEGORISED_NAME,
          )}
          paymentName={(() => {
            const name = paymentMethods.find((method) => method.id === saved.paymentMethodId)?.name;
            return name === undefined ? null : displayPaymentMethodName(name);
          })()}
          // One entry at a time, so nothing is waiting behind it.
          remaining={0}
          onHome={() => void navigate("/")}
          onAgain={() => void navigate(origin)}
          onUndo={() => {
            void removeEntry
              .mutateAsync(saved.id)
              .then(() => {
                setUndone(saved);
                setSaved(null);
              })
              .catch((caught: unknown) => {
                setError(errorMessage(caught));
              });
          }}
        />

        <ChoiceDialog
          open={undone !== null}
          title={t("capture.undone.title")}
          description={
            undone === null
              ? ""
              : t("capture.undone.description", { amount: formatMoney(undone.amountCents, undone.currency) })
          }
          choices={choices.undone}
          onChoose={(choice) => {
            const entry = undone;
            setUndone(null);
            if (entry === null || choice === "dismiss") return;

            void restoreEntry.mutateAsync(entry.id).catch((caught: unknown) => {
              setError(errorMessage(caught));
            });
          }}
        />
      </>
    );
  }

  return (
    <InnerPage
      title={t("capture.review.title")}
      backTo={origin}
    >
      {error === null ? null : <Alert tone="error">{error}</Alert>}

      {/*
        What was heard, kept on screen next to the numbers it produced.
        See the note at the top of the file for why this is not decoration.
        The text itself is the user's own words and is never translated.
      */}
      <p className="break-words rounded-field bg-canvas px-4 py-3 text-sm leading-relaxed text-muted">
        {spoken.source === "paste"
          ? t("capture.review.heardPaste", { text: spoken.text })
          : t("capture.review.heardVoice", { text: spoken.text })}
      </p>

      {/*
        What the parser is unsure about is shown once, inside the form (`ReviewStep`'s
        `warnings`) — 1.17.23 removed a second copy that used to sit here above it.
      */}

      {/*
        Why the category is already filled in.

        The rule that applies to the amount applies to every field the app fills by
        itself: a value that looks plausible and is wrong is the failure to design
        against, so the app has to say where the value came from. "已选：餐饮" alone
        leaves the user wondering whether it was a guess; naming the word it
        latched onto turns it into something checkable at a glance.
      */}
      {categoryReason === null ? null : (
        <p className="text-helper text-muted">
          {/*
            The matched words and the category name are data (the user's words, the
            ledger's category), so they are escaped before Trans parses the sentence.
          */}
          <Trans
            i18nKey={
              spoken.source === "paste"
                ? "capture.review.categoryReasonPaste"
                : "capture.review.categoryReasonVoice"
            }
            values={{
              reason: categoryReason,
              name: displayCategoryName(
                categories.find((category) => category.id === heardCategoryId)?.name ?? "",
              ),
            }}
            tOptions={{ interpolation: { escapeValue: true } }}
            shouldUnescape
            components={{ name: <span className="text-ink" /> }}
          />
        </p>
      )}

      <ReviewStep
        draft={draft}
        remaining={1}
        categories={categories}
        paymentMethods={paymentMethods}
        busy={createEntry.isPending || checkDuplicates.isPending || pendingDuplicate !== null}
        onManual={() => void navigate("/add")}
        warnings={parsed?.issues.map((issue) => translateSharedMessage(issue.message)) ?? []}
        onSave={async (edited) => {
          setError(null);

          /**
           * Parsed with the shared helper, not `Number`.
           *
           * `parseAmountInput` already knows about per-currency precision — JPY
           * has no decimals — and returns minor units, which is what the API
           * wants. `Number(text)` would have accepted `12.345` and then rounded
           * it silently, and would have needed the currency rules reimplemented
           * here for no reason.
           */
          let amountCents: number;
          try {
            amountCents = parseAmountInput(edited.amount, edited.currency);
          } catch {
            setError(
              decimalsFor(edited.currency) === 0
                ? t("capture.amount.noDecimals", { currency: currencyName(edited.currency) })
                : t("capture.amount.invalid"),
            );
            return;
          }

          if (amountCents <= 0) {
            setError(t("capture.amount.positive"));
            return;
          }

          const occurredAt = new Date(
            `${edited.date}T${edited.time === "" ? "12:00" : edited.time}:00`,
          );

          /**
           * ⚠️ **时间字段留空时，检测按“只有日期”处理。**
           *
           * 保存的 `occurredAt` 仍然是 12:00（既有行为，不改写入），但判重不能拿这个 12:00
           * 当真：语音从不提供时刻，用它去和 12:00 附近的历史记录比“相差 60 秒”，
           * 等于凭空造出一个时间。所以检测传 `occurredAt: null` + 空 `occurredTime`，
           * 核心只会给出“同一天”的弱依据，并明确标注时间信息不足。
           */
          const timeKnown = edited.time !== "";

          /**
           * `uuidV7()`, not `crypto.randomUUID()`: the latter is a
           * secure-context API and is undefined over plain `http://`, which
           * is how a phone on the LAN used to reach this app.
           *
           * ⚠️ **`idempotencyKey` is the same value as `id`** — see the longer
           * note in `ScanPage.tsx`. Two independent ids turned the server's
           * `idempotency_key` de-duplication into a no-op on this path.
           */
          const id = uuidV7();
          /** 类型标注而不是 `as const`：`CreateTransactionInput` 的 `tagIds` 是可变的 `string[]`。 */
          const input: CreateTransactionInput = {
            id,
            idempotencyKey: id,
            kind: edited.kind,
            amountCents,
            currency: edited.currency,
            categoryId: edited.categoryId,
            paymentMethodId: edited.paymentMethodId,
            occurredAt: toLocalIso(occurredAt),
            occurredLocalDate: toLocalDate(occurredAt),
            occurredTz: localTimeZone(),
            note: edited.note.trim() === "" ? null : edited.note.trim(),
            tagIds: [],
          };

          try {
            const found = await checkDuplicates.mutateAsync({
              kind: edited.kind,
              amountCents,
              currency: edited.currency,
              occurredAt: timeKnown ? input.occurredAt : undefined,
              occurredLocalDate: input.occurredLocalDate,
              /** 空字符串 = 没有记录时刻；核心据此按 day 精度给出弱依据。 */
              occurredTime: timeKnown ? edited.time : "",
              categoryId: edited.categoryId,
              paymentMethodId: edited.paymentMethodId,
              note: input.note ?? undefined,
              tagIds: input.tagIds,
              settings: duplicateSettings.settings,
            });
            if (found.history.length > 0) {
              setPendingDuplicate({
                input,
                existing: found.history,
                pairs: found.pairs,
                scope: found.scope,
              });
              return;
            }
          } catch {
            // 检测失败不阻止保存：提醒是礼貌，不是关卡。
          }

          await write(input);
        }}
      />

      <ChoiceDialog
        open={pendingDuplicate !== null}
        title={t("duplicates.reminder.title")}
        description={pendingDuplicate === null ? "" : voiceDuplicateDescription(pendingDuplicate)}
        choices={choices.duplicate}
        onChoose={(choice) => {
          const pending = pendingDuplicate;
          setPendingDuplicate(null);
          if (pending === null) return;
          if (choice === "save") {
            void write(pending.input);
            return;
          }
          if (choice === "confirmNotDuplicate") {
            void write(pending.input, pending.existing.map((entry) => entry.id));
            return;
          }
          // "cancel": 表单还在，用户可以继续改。
        }}
      />
    </InnerPage>
  );
}

/**
 * 语音记账的轻提醒选项：与手动记账完全一致。
 *
 * ⚠️ **没有「删掉旧的，保存这笔」**：语音核对页的撤销路径是“保存后撤销”，而不是在保存前
 * 删除历史账目；两种删除语义混在一个对话框里，用户很难分清删的是哪一笔。
 */
const MANUAL_DUPLICATE_CHOICES: readonly ChoiceDefinition<"save" | "confirmNotDuplicate" | "cancel">[] = [
  {
    id: "save",
    label: () => translate("duplicates.reminder.save"),
    primary: true,
  },
  {
    id: "confirmNotDuplicate",
    label: () => translate("duplicates.reminder.confirmNotDuplicate"),
    hint: () => translate("duplicates.reminder.confirmNotDuplicateHint"),
  },
  { id: "cancel", label: () => translate("duplicates.reminder.cancel"), dismissive: true },
];

/**
 * 对话框选项的定义（S16）：模块顶层只存 id、行为标记与**取文案的函数**；
 * `localizeChoices` 在渲染时按当前语言生成 `Choice`（与 `ScanPage` 同一做法）。
 */
interface ChoiceDefinition<Id extends string> {
  readonly id: Id;
  readonly label: () => string;
  readonly hint?: () => string;
  readonly primary?: boolean;
  readonly dismissive?: boolean;
}

function localizeChoices<Id extends string>(
  definitions: readonly ChoiceDefinition<Id>[],
): readonly Choice<Id>[] {
  return definitions.map(({ label, hint, ...rest }) => ({
    ...rest,
    label: label(),
    ...(hint === undefined ? {} : { hint: hint() }),
  }));
}

/** 提醒正文：依据来自实际命中的规则，并说明本次比对了哪份数据。 */
function voiceDuplicateDescription(pending: {
  readonly existing: readonly Transaction[];
  readonly pairs: readonly DuplicatePairResult[];
  readonly scope: "server" | "local";
}): string {
  const first = pending.pairs[0];
  const basis = first === undefined
    ? translate("duplicates.reminder.basisFallbackVoice")
    : describeDuplicateMatchText(first);
  const count = pending.existing.length > 1
    ? translate("duplicates.reminder.countVoice", { count: pending.existing.length })
    : "";
  const scopeNote = pending.scope === "local" ? translate("duplicates.reminder.localOnly") : "";
  // 中文句子直接相连（与原来逐字一致），其它语言句间加空格。
  return [basis, count, scopeNote].filter((sentence) => sentence !== "").join(isChineseLocale() ? "" : " ");
}

/**
 * What to offer after the entry has been taken back.
 *
 * The same two choices the camera path offers, and for the same reason: an undo
 * that cannot be reversed makes the user restart the entry by hand if they change
 * their mind. 重新记上 rather than 撤销撤销, because the second is a word nobody
 * reads twice.
 */
const UNDONE_CHOICES: readonly ChoiceDefinition<"restore" | "dismiss">[] = [
  {
    id: "restore",
    label: () => translate("capture.undone.restore"),
    primary: true,
  },
  { id: "dismiss", label: () => translate("capture.undone.dismiss"), dismissive: true },
];

