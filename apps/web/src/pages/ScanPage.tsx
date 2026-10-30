import {
  CURRENCIES,
  MAX_RECOGNIZE_IMAGES,
  UNCATEGORISED_NAME,
  decimalsFor,
  formatMinor,
  type Currency,
  type DuplicatePairResult,
  type OcrItemResult,
  type Transaction,
  type TransactionKind,
} from "@libellum/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { Trans } from "react-i18next";
import { useNavigate } from "react-router";

import { Alert } from "../components/Alert.js";
import { CameraIcon } from "../components/BottomNav.js";
import { Button } from "../components/Button.js";
import { ChoiceDialog, type Choice } from "../components/ChoiceDialog.js";
import { ReviewStep, type ReviewDraft } from "../components/EntryForm.js";
import { EntrySaved } from "../components/EntrySaved.js";
import { useDuplicateDetectionSettings } from "../components/DuplicateDetectionSettings.js";
import { InnerPage } from "../components/Layouts.js";
import { SkeletonRows } from "../components/States.js";
import { isChineseLocale, t as translate, useI18n } from "../i18n/index.js";
import { errorMessage } from "../lib/api.js";
import { currentBookId } from "../lib/currentBook.js";
import { currentMonth, localTimeZone, toLocalDate, toLocalIso } from "../lib/datetime.js";
import { describeDuplicateMatchText } from "../lib/duplicateReview.js";
import { currencyName, formatMoney, parseAmountInput } from "../lib/format.js";
import { createNotDuplicateRelations, notDuplicateConfirmationForEntry } from "../lib/notDuplicateRelations.js";
import { displayCategoryName, displayPaymentMethodName } from "../lib/presetNames.js";
import { createBatch } from "../lib/ocr/batch.js";
import { saveBatch } from "../lib/ocr/batchStore.js";
import { readableItems, routeRecognition } from "../lib/ocr/routeDecision.js";
import {
  useCheckDuplicates,
  useCreateTransaction,
  useDeleteTransaction,
  useLedger,
  useRecognize,
  useRestoreTransaction,
  useTransactions,
} from "../lib/queries.js";
import { takeScanHandover } from "../lib/scanHandoff.js";
import { uuidV7 } from "../lib/uuid.js";

/**
 * Recording from a screenshot.
 *
 * Four steps, and the screen never shows more than one of them: choose,
 * recognise, check, saved. The check step is the point of the whole feature —
 * the recogniser produces a *guess*, and a guess is only useful if somebody
 * looks at it before it becomes a fact. Every field is editable and a field
 * that could not be read is left empty with a reason, never defaulted to
 * something plausible. A wrong amount gets confirmed; a blank one gets filled
 * in.
 */
type Step =
  | { readonly name: "pick" }
  | { readonly name: "working"; readonly index: number; readonly total: number }
  | { readonly name: "review"; readonly draft: ReviewDraft; readonly warnings: readonly string[] }
  | { readonly name: "saved"; readonly entry: Transaction };

type Mode = "single" | "batch";

export function ScanPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { t, locale } = useI18n();
  const ledger = useLedger();
  const recognize = useRecognize();
  const createEntry = useCreateTransaction();
  const checkDuplicates = useCheckDuplicates();
  const removeEntry = useDeleteTransaction();
  const restoreEntry = useRestoreTransaction();
  const duplicateSettings = useDuplicateDetectionSettings();

  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState<Mode>("single");
  const [step, setStep] = useState<Step>({ name: "pick" });
  const [error, setError] = useState<string | null>(null);

  /**
   * Recognition ran and read nothing, so the user is asked what to do next.
   *
   * A flag rather than an error string, because the three ways forward do not
   * depend on *why* it failed, and the reason is already in the banner behind
   * the dialog when there is one.
   */
  const [nothingReadable, setNothingReadable] = useState(false);

  /**
   * A duplicate the user has to decide about.
   *
   * Holds the draft as well as what was found, because every choice in the
   * dialog needs it: "仍然保存" writes it, "删掉旧的" writes it after removing the
   * other, and cancelling keeps it so the user is back where they were rather
   * than losing what they typed.
   */
  const [pendingDuplicate, setPendingDuplicate] = useState<{
    readonly draft: ReviewDraft;
    readonly amountCents: number;
    readonly existing: readonly Transaction[];
    /** 每对命中的依据；对话框据此说明“哪些字段相同”，而不是写死一句话。 */
    readonly pairs: readonly DuplicatePairResult[];
    /** 这次答案来自服务器账本还是本机已知数据。 */
    readonly scope: "server" | "local";
  } | null>(null);

  /**
   * A page type nobody could decide.
   *
   * Holds the readable screenshots rather than a boolean, because every choice in
   * the dialog needs them: 按单笔 builds the old review from them, 按多笔 builds a
   * batch from them, and 重新上传 keeps them on the pick step.
   */
  const [batchChoice, setBatchChoice] = useState<OcrItemResult[] | null>(null);

  /**
   * An entry that was just taken back, kept so it can be put back.
   *
   * Holding the whole entry rather than its id, because the dialog says what was
   * undone — an amount and a category — and looking it up again would need a
   * request to describe something the screen already had.
   */
  const [undone, setUndone] = useState<Transaction | null>(null);

  /** Results that could be read, and where we are among them. */
  const [items, setItems] = useState<OcrItemResult[]>([]);
  const [cursor, setCursor] = useState(0);

  const categories = ledger.data?.categories ?? [];
  const paymentMethods = ledger.data?.paymentMethods ?? [];

  /**
   * The category a new entry starts on: whatever was used last, which is a far
   * better guess than the system "uncategorised" bucket that everything else
   * would land in. Screenshots never carry a category — no payment app knows
   * how you file your spending.
   */
  const recent = useTransactions({ month: currentMonth(), kind: "expense" });
  const lastCategoryId = recent.data?.pages[0]?.items[0]?.categoryId ?? null;

  // Object URLs for the thumbnails; released when the files change or the
  // screen unmounts, or the browser holds every image for the tab's lifetime.
  const previews = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);

  useEffect(
    () => () => {
      for (const url of previews) URL.revokeObjectURL(url);
    },
    [previews],
  );

  /**
   * Pictures that arrived from the 拍照 card, which opens the picker itself.
   *
   * Read once, on mount, and the handover is emptied as it is read — so a
   * remount, a back-navigation or a refresh finds nothing and this screen
   * behaves exactly as if it had been opened directly. That is what stops the
   * same screenshot being recognised twice.
   *
   * **One picture goes straight to recognition.** There is nothing to choose —
   * the mode question has only one answer — so asking it would be a step whose
   * only content is the user's own decision not to make a decision. Two or more
   * land on the pick step, where the same-or-different question is a real one
   * and has to be asked before recognising.
   */
  const [arrivedFromCard, setArrivedFromCard] = useState(false);

  useEffect(() => {
    const handed = takeScanHandover();
    if (handed.length === 0) return;

    setFiles(handed);
    setArrivedFromCard(true);
  }, []);

  /**
   * Start recognition once, for the single-picture handover.
   *
   * A separate effect rather than a call inside the one above, because
   * `start()` reads `files` from this render's scope — the render in which the
   * state has just been queued, not applied. Waiting for the next render is what
   * makes the files visible to it.
   */
  useEffect(() => {
    if (!arrivedFromCard || files.length !== 1) return;

    setArrivedFromCard(false);
    void start();
    // Deliberately only on the handover: `files` changing is the trigger, and
    // `start` is recreated every render, so depending on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrivedFromCard, files]);

  function addFiles(incoming: FileList | null): void {
    if (incoming === null) return;

    const chosen = [...incoming];
    const combined = [...files, ...chosen];

    if (combined.length > MAX_RECOGNIZE_IMAGES) {
      setError(t("capture.scan.tooMany", { max: MAX_RECOGNIZE_IMAGES }));
      setFiles(combined.slice(0, MAX_RECOGNIZE_IMAGES));
      return;
    }

    setError(null);
    setFiles(combined);
  }

  async function start(): Promise<void> {
    if (files.length === 0) return;

    setError(null);
    setStep({ name: "working", index: 1, total: files.length });

    try {
      const result = await recognize.mutateAsync(files);

      // A screenshot nobody could read is dropped here, with a count, rather
      // than being carried into the review queue as an empty form the user has
      // to work out is empty.
      const readable = readableItems(result.items);
      const lost = result.items.length - readable.length;

      if (readable.length === 0) {
        /**
         * ⚠️ **Nothing readable: ask, do not decide.**
         *
         * The owner's rule, and the first attempt at this got it wrong — it sent
         * the user straight to the manual form, which silently removed the two
         * options they might have preferred. Retrying the same picture is the
         * right move for a transient failure, and going back to choose a clearer
         * screenshot is the right move for a bad one; only the user knows which
         * happened.
         *
         * No error banner accompanies this. The dialog says what happened, and a
         * second copy of the same sentence behind it is noise.
         */
        setStep({ name: "pick" });
        setNothingReadable(true);
        return;
      }

      if (lost > 0) {
        setError(t("capture.scan.skipped", { count: lost }));
      }

      /**
       * **One upload, one path.**
       *
       * A transaction list (or a mix of list and detail screenshots) goes to the
       * batch overview; a page type nobody can decide asks the user; everything
       * else keeps the original single-entry review. The old flow is not
       * reimplemented here — it is the fallback branch.
       */
      const route = routeRecognition(readable);

      if (route === "batch") {
        openBatch(result.items);
        return;
      }

      if (route === "ask") {
        // Put the pick step back behind the dialog: the working spinner must not
        // keep turning while the user is answering a question.
        setStep({ name: "pick" });
        setItems(readable);
        setBatchChoice(readable);
        return;
      }

      startSingleReview(readable);
    } catch (caught) {
      /**
       * A failure to *reach* recognition, which is a different situation from
       * recognition succeeding and reading nothing — but the user's options are
       * the same, so it gets the same dialog rather than a banner that leaves
       * them to work out what to do. The reason still comes through `error`,
       * because "the server was unreachable" and "the picture was blurry" call
       * for different decisions.
       */
      setError(errorMessage(caught));
      setStep({ name: "pick" });
      setNothingReadable(true);
    }
  }

  /** Move to the next screenshot in a batch, or finish. */
  function advance(next: number): void {
    const item = items[next];

    if (item === undefined) {
      void navigate("/");
      return;
    }

    setCursor(next);
    setStep({
      name: "review",
      draft: draftOf(item, categories, paymentMethods, lastCategoryId),
      warnings: [...(item.draft?.warnings ?? [])],
    });
  }

  /** The original single-entry review, used directly and by the 按单笔 answer. */
  function startSingleReview(reviewItems: OcrItemResult[]): void {
    setItems(reviewItems);
    setCursor(0);
    setStep({
      name: "review",
      draft:
        mode === "single"
          ? foldDrafts(reviewItems, categories, paymentMethods, lastCategoryId)
          : draftOf(reviewItems[0]!, categories, paymentMethods, lastCategoryId),
      warnings: reviewItems[0]?.draft?.warnings ?? [],
    });
  }

  /**
   * Put the whole upload into one batch and open the overview.
   *
   * **Nothing is written here** and nothing is sent anywhere: the batch is text
   * in sessionStorage until the user confirms on the overview screen. If the
   * browser refuses to store it (private mode/quota), the user is told rather
   * than sent to an overview that would immediately look empty.
   */
  function openBatch(batchItems: readonly OcrItemResult[]): void {
    const batch = createBatch(batchItems, {
      bookId: ledger.data?.book.id ?? currentBookId(),
      duplicateSettings: duplicateSettings.settings,
      categories,
      paymentMethods,
      now: new Date(),
      generateBatchId: uuidV7,
    });

    if (!saveBatch(batch)) {
      setStep({ name: "pick" });
      setError(t("capture.scan.storageFailed"));
      return;
    }

    void navigate("/ocr/overview");
  }

  /** How many are still waiting, including the one on screen. */
  const remaining = mode === "single" ? 1 : items.length - cursor;

  async function save(draft: ReviewDraft): Promise<void> {
    setError(null);

    let amountCents: number;
    try {
      amountCents = parseAmountInput(draft.amount, draft.currency);
    } catch {
      setError(
        decimalsFor(draft.currency) === 0
          ? t("capture.amount.noDecimals", { currency: currencyName(draft.currency) })
          : t("capture.amount.invalid"),
      );
      return;
    }

    if (amountCents <= 0) {
      setError(t("capture.amount.positive"));
      return;
    }

    /**
     * Ask whether this entry is already there, **before** writing it.
     *
     * Before rather than after: the alternative is saving, noticing, and undoing,
     * which puts a wrong entry in the ledger for a moment and depends on the undo
     * working. A check that cannot write anything cannot go wrong.
     *
     * A failure to *ask* is not a failure to save. If the check cannot be reached
     * the write goes ahead — the feature is a courtesy, and losing somebody's
     * entry because a warning could not be fetched would be a far worse trade.
     */
    try {
      const found = await checkDuplicates.mutateAsync({
        kind: draft.kind,
        amountCents,
        currency: draft.currency,
        occurredLocalDate: draft.date,
        occurredTime: draft.time,
        ...(draft.time ? { occurredAt: toLocalIso(new Date(`${draft.date}T${draft.time}:00`)) } : {}),
        categoryId: draft.categoryId, paymentMethodId: draft.paymentMethodId,
        note: draft.note, settings: duplicateSettings.settings,
      });

      if (found.history.length > 0) {
        setPendingDuplicate({
          draft,
          amountCents,
          existing: found.history,
          pairs: found.pairs,
          scope: found.scope,
        });
        return;
      }
    } catch {
      // Deliberately silent: see above.
    }

    await write(draft, amountCents);
  }

  /** Actually write the entry. Reached directly, or after a duplicate warning. */
  async function write(
    draft: ReviewDraft,
    amountCents: number,
    /**
     * S15-E3: the pairs the user **explicitly** confirmed as "not the same transaction".
     *
     * These are existing entries the duplicate check found for this exact draft. The
     * confirmation is a separate choice in the dialog ("确认不是同一笔"), never inferred from
     * "仍然保存" — saving two similar entries is a legitimate thing to do and says nothing
     * about whether they are the same money.
     */
    notDuplicateWith: readonly string[] = [],
  ): Promise<void> {
    const occurredAt = new Date(`${draft.date}T${draft.time === "" ? "12:00" : draft.time}:00`);

    try {
      /**
       * `uuidV7()`, not `crypto.randomUUID()`.
       *
       * `randomUUID` is a secure-context API: over plain `http://` — which is
       * exactly how the app is reached from a phone on the LAN, at
       * `http://192.168.0.184:5173` — Safari does not define it, and the save
       * fails with "crypto.randomUUID is not a function". `getRandomValues`,
       * which `uuidV7` uses, has been available in every context for years.
       *
       * ⚠️ **`idempotencyKey` is the same value as `id`, and that is the point.**
       * It used to be a second, independent `uuidV7()`, which silently disabled the
       * server's de-duplication: that guard keys off `idempotency_key`, so a
       * resent request produced a *second* entry. Every other write path
       * (`AddEntryPage`, `lib/offline/sync.ts`) has always used `idempotencyKey = id`;
       * this file and `VoiceReviewPage` were the only two that did not.
       */
      const id = uuidV7();

      const entry = await createEntry.mutateAsync({
        id,
        idempotencyKey: id,
        kind: draft.kind,
        amountCents,
        currency: draft.currency,
        categoryId: draft.categoryId,
        paymentMethodId: draft.paymentMethodId,
        occurredAt: toLocalIso(occurredAt),
        occurredLocalDate: toLocalDate(occurredAt),
        occurredTz: localTimeZone(),
        note: draft.note.trim() === "" ? null : draft.note.trim(),
        tagIds: [],
      });

      /**
       * ⚠️ **S15-E3: recorded only after the entry exists**, and a failure here must not
       * pretend the entry was lost — it is already saved. The relation is extra memory, so
       * the message says exactly what did and did not happen.
       *
       * The pair is created with the entry's final id (the same client-generated id that was
       * sent as `id`/`idempotencyKey`), so a retried upload cannot point at a different row.
       */
      if (notDuplicateWith.length > 0) {
        try {
          const bookId = ledger.data?.book.id ?? currentBookId();
          if (bookId === null) throw new Error(t("capture.notDuplicate.bookMissing"));

          const input = notDuplicateConfirmationForEntry(notDuplicateWith, entry.id);
          if (input === null) throw new Error(t("capture.notDuplicate.noPairs"));

          await createNotDuplicateRelations(bookId, input);
        } catch (caught) {
          // 关系没记住，但钱已经记下了：消息必须说清哪件事成功、哪件没有。
          setError(t("capture.scan.notDuplicateFailed", { reason: errorMessage(caught) }));
        }
      }

      setStep({ name: "saved", entry });
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  /**
   * 对话框的选项：定义在组件外（只存 id 与文案键），这里按语言生成一次。
   * `locale` 是唯一依赖——语言不变时数组不变，`ChoiceDialog` 的 effect 不会因此重跑。
   */
  const choices = useMemo(
    () => ({
      nothingReadable: localizeChoices(NOTHING_READABLE_CHOICES),
      unknownPage: localizeChoices(UNKNOWN_PAGE_CHOICES),
      duplicate: localizeChoices(DUPLICATE_CHOICES),
      undone: localizeChoices(UNDONE_CHOICES),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );

  return (
    <InnerPage
      title={t("capture.scan.title")}
      subtitle={t("capture.scan.subtitle")}
      backTo="/"
    >
      {error === null ? null : <Alert tone="error">{error}</Alert>}

      {step.name === "pick" ? (
        <PickStep
          files={files}
          previews={previews}
          mode={mode}
          busy={false}
          onAdd={addFiles}
          onRemove={(index) => {
            setFiles((current) => current.filter((_, position) => position !== index));
          }}
          onMode={setMode}
          onStart={() => void start()}
          onManual={() => void navigate("/add")}
        />
      ) : null}

      {step.name === "working" ? <WorkingStep total={step.total} /> : null}

      {step.name === "review" ? (
        <ReviewStep
          draft={step.draft}
          warnings={step.warnings}
          remaining={remaining}
          categories={categories}
          paymentMethods={paymentMethods}
          busy={createEntry.isPending}
          onSave={(draft) => void save(draft)}
          onManual={() => void navigate("/add")}
        />
      ) : null}

      {step.name === "saved" ? (
        <div className="flex flex-col gap-4">
          <EntrySaved
            entry={step.entry}
            categoryName={displayCategoryName(
              categories.find((category) => category.id === step.entry.categoryId)?.name ?? UNCATEGORISED_NAME,
            )}
            paymentName={(() => {
              const name = paymentMethods.find((method) => method.id === step.entry.paymentMethodId)?.name;
              return name === undefined ? null : displayPaymentMethodName(name);
            })()}
            /**
             * How many are left **after** this one.
             *
             * The owner read "还需两次" as "two more after filling this in" while
             * the screen meant "two including this one", so the two readings
             * differed by one and the wrong reading was the natural one. Subtracting
             * the cursor states it directly: the count is of what is still ahead.
             */
            remaining={mode === "single" ? 0 : Math.max(0, items.length - cursor - 1)}
            onHome={() => void navigate("/")}
            onUndo={() => {
              /**
               * Take it back, and offer to put it back again.
               *
               * A soft delete, so this is reversible — which is why there is no
               * confirmation in front of it. Asking "are you sure?" before an
               * action that can be undone is the dialog people learn to dismiss;
               * showing what happened, with a way back, is the one they read.
               *
               * The screen stays on the confirmation rather than navigating, so
               * the offer to restore is in front of them rather than behind a
               * back-navigation.
               */
              void removeEntry
                .mutateAsync(step.entry.id)
                .then(() => {
                  setUndone(step.entry);
                  setStep({ name: "pick" });
                })
                .catch((caught: unknown) => {
                  setError(errorMessage(caught));
                });
            }}
            onAgain={() => {
              // In a batch, "one more" means the next screenshot in it; in the
              // single mode there is nothing left, so it starts over.
              if (mode === "batch" && cursor + 1 < items.length) {
                advance(cursor + 1);
                return;
              }

              setFiles([]);
              setItems([]);
              setCursor(0);
              setStep({ name: "pick" });
            }}
          />
        </div>
      ) : null}

      {/*
        The page type could not be decided. The design direction is explicit that
        the program must not invent a transaction count here, so the user picks
        the path: the original single-entry review, the batch overview, or going
        back for a clearer screenshot.
      */}
      <ChoiceDialog
        open={batchChoice !== null}
        title={t("capture.scan.unknownPage.title")}
        description={
          batchChoice === null
            ? ""
            : t("capture.scan.unknownPage.description", { count: batchChoice.length })
        }
        choices={choices.unknownPage}
        onChoose={(choice) => {
          const chosen = batchChoice;
          setBatchChoice(null);
          if (chosen === null) return;

          if (choice === "single") {
            startSingleReview(chosen);
            return;
          }

          if (choice === "multi") {
            openBatch(chosen);
            return;
          }

          // "back": stay on the pick step with the pictures still attached, so
          // the user can remove one or choose another. No automatic picker.
        }}
      />

      {/*
        Recognition read nothing. The user picks the way forward; nothing here
        decides for them — see the note on `NOTHING_READABLE_CHOICES`.
      */}
      <ChoiceDialog
        open={nothingReadable}
        title={t("capture.scan.nothingReadable.title")}
        choices={choices.nothingReadable}
        onChoose={(choice) => {
          setNothingReadable(false);

          if (choice === "retry") {
            // The same pictures, unchanged — that is what "再试一次" means, and
            // it is the reason the hint says so rather than leaving the user to
            // guess whether a new picker is coming.
            void start();
            return;
          }

          if (choice === "manual") {
            void navigate("/add");
            return;
          }

          /**
           * Back to the pick step, with the pictures still attached.
           *
           * **Deliberately no automatic picker.** The owner was explicit: "这种
           * 情况下不要帮用户自动点击." Re-opening a picker the moment a dialog
           * closes is the kind of helpfulness that takes the decision away —
           * and the user may want to look at what they chose first.
           */
        }}
      />

      {/*
        This looks like an entry that is already recorded.
        
        Three ways out, and the third one is the owner's: he asked for a button
        that deletes the **old** entry, on the grounds that the user is the one
        deciding and a decision should be carried out rather than questioned.
        That is also why this is a dialog and not a refusal — two identical
        entries are a legitimate thing to have, so the server reports suspicion
        and the person settles it.
      */}
      <ChoiceDialog
        open={pendingDuplicate !== null}
        title={t("duplicates.reminder.title")}
        description={
          pendingDuplicate === null ? "" : duplicateDialogDescription(pendingDuplicate)
        }
        choices={choices.duplicate}
        onChoose={(choice) => {
          const pending = pendingDuplicate;
          setPendingDuplicate(null);
          if (pending === null) return;

          if (choice === "save") {
            void write(pending.draft, pending.amountCents);
            return;
          }

          /**
           * ⚠️ **S15-E3: an explicit confirmation, not an inference.**
           *
           * "仍然保存" above intentionally records nothing: keeping two similar entries says
           * nothing about whether they are the same money. **This** choice is the one that says
           * so, and it is the only path that writes a not-duplicate relation for the new entry.
           *
           * The relation is written after the entry exists, with the entry's final id; a failure
           * to remember it is reported on the saved screen (the money was saved either way).
           */
          if (choice === "confirmNotDuplicate") {
            void write(
              pending.draft,
              pending.amountCents,
              pending.existing.map((existing) => existing.id),
            );
            return;
          }

          if (choice === "replace") {
            /**
             * Delete the old one, then write this one.
             *
             * Sequential, and a failure to delete stops the write: ending up
             * with two entries when the user asked for one is worse than ending
             * up with the old one and an error message they can act on.
             */
            void (async () => {
              try {
                for (const existing of pending.existing) {
                  await removeEntry.mutateAsync(existing.id);
                }
              } catch (caught) {
                setError(errorMessage(caught));
                return;
              }

              await write(pending.draft, pending.amountCents);
            })();
            return;
          }

          // "cancel": keep the draft and stay on the review step, so the user is
          // exactly where they were rather than losing what they typed.
          void 0;
        }}
      />

      {/*
        The entry was taken back. The way to put it back, while the undo is still
        the most recent thing that happened.
      */}
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
    </InnerPage>
  );
}

/**
 * The three ways forward when recognition reads nothing.
 *
 * Declared outside the component so the array is not rebuilt on every render —
 * `ChoiceDialog` uses it in an effect dependency, and a fresh array each time
 * would re-run that effect on every keystroke elsewhere on the screen.
 *
 * `back` is the dismissive one: Escape and a tap on the backdrop both return to
 * the pick step, which is where the user can choose a different picture. That is
 * the owner's "返回拍照记账页面" — **and deliberately not an automatic re-open of
 * the picker.** He was explicit: "这种情况下不要帮用户自动点击."
 */
const NOTHING_READABLE_CHOICES: readonly ChoiceDefinition<"retry" | "manual" | "back">[] = [
  {
    id: "retry",
    label: () => translate("capture.scan.nothingReadable.retry"),
    hint: () => translate("capture.scan.nothingReadable.retryHint"),
    primary: true,
  },
  {
    id: "manual",
    label: () => translate("capture.scan.nothingReadable.manual"),
  },
  {
    id: "back",
    label: () => translate("capture.scan.nothingReadable.back"),
    dismissive: true,
  },
];

/**
 * 对话框选项的定义（S16）：模块顶层只存 id、行为标记与**取文案的函数**，不存文案本身——
 * 顶层常量里的文案会固定成导入时的语言。`localizeChoices` 在渲染时按当前语言生成 `Choice`。
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

/**
 * The three ways out of "we cannot tell how many transactions this page holds".
 *
 * All three are real answers: the page may genuinely be one transaction on an
 * unfamiliar layout, it may be a list, or the screenshot may simply be unusable.
 * None of them is a sensible default, which is why the user is asked rather than
 * guessed at.
 */
const UNKNOWN_PAGE_CHOICES: readonly ChoiceDefinition<"single" | "multi" | "back">[] = [
  {
    id: "single",
    label: () => translate("capture.scan.unknownPage.single"),
    hint: () => translate("capture.scan.unknownPage.singleHint"),
    primary: true,
  },
  {
    id: "multi",
    label: () => translate("capture.scan.unknownPage.multi"),
  },
  {
    id: "back",
    label: () => translate("capture.scan.unknownPage.back"),
    dismissive: true,
  },
];

/**
 * The three ways out of "this looks like a duplicate".
 *
 * **"删掉旧的" is the owner's**, and it is worth recording why he wanted it:
 * "既然是用户自己做的决定，就应该尊重." The alternative design — only offering
 * "cancel" — quietly treats the user's intent as suspect. They said they want
 * this entry; the useful question is which of the two they meant to keep, not
 * whether they are sure.
 *
 * **No "go and look at the other one" option**, though it was considered: the
 * entry page needs an id and the natural way there is through the ledger, one
 * tab away. A button that navigates to a blank page is worse than a button that
 * does not exist.
 */
/**
 * 提示框正文：**说清是哪几条规则命中的、这次比对了哪份数据**。
 *
 * ⚠️ 这句话原先写死为“日期、时间、金额、币种和收支类型都相同”，可设置里每一项都能关。
 * 用户关掉分类匹配后再看到“分类相同”的暗示，就再也无法判断系统到底比过什么——
 * 所以正文一律由 `describeDuplicateMatch` 从实际命中的规则生成。
 */
function duplicateDialogDescription(pending: {
  readonly existing: readonly Transaction[];
  readonly pairs: readonly DuplicatePairResult[];
  readonly scope: "server" | "local";
}): string {
  // 各句按当前语言取；中文拼接结果与原来逐字一致（句子之间没有空格），英文句间加空格。
  const scopeNote = pending.scope === "local" ? translate("duplicates.reminder.localOnly") : "";
  const first = pending.pairs[0];
  const basis = first === undefined
    ? translate("duplicates.reminder.basisFallbackScan")
    : describeDuplicateMatchText(first);
  const count = pending.existing.length > 1
    ? translate("duplicates.reminder.countScan", { count: pending.existing.length })
    : "";
  return joinSentences([basis, count, translate("duplicates.reminder.askAgain"), scopeNote]);
}

/** 几句话连成一段：中文直接相连，其它语言用空格隔开。空句跳过。 */
function joinSentences(sentences: readonly string[]): string {
  return sentences.filter((sentence) => sentence !== "").join(isChineseLocale() ? "" : " ");
}

/** `confirmNotDuplicate` 是唯一会记录关系的**显式**选项；文案在 `duplicates.reminder.*`。 */
const DUPLICATE_CHOICES: readonly ChoiceDefinition<"save" | "confirmNotDuplicate" | "replace" | "cancel">[] = [
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
  {
    id: "replace",
    label: () => translate("duplicates.reminder.replace"),
    hint: () => translate("duplicates.reminder.replaceHint"),
  },
  { id: "cancel", label: () => translate("duplicates.reminder.cancel"), dismissive: true },
];

/**
 * What to offer after an entry has been taken back.
 *
 * **Two options, and neither is "OK".** The undo is immediate and reversible, so
 * the second thing the user sees is the way to reverse it — a plain "知道了"
 * would leave them restarting the entry by hand if they changed their mind.
 *
 * The first option is labelled 重新记上 rather than 撤销撤销, because the second
 * is a word nobody reads twice.
 */
const UNDONE_CHOICES: readonly ChoiceDefinition<"restore" | "dismiss">[] = [
  {
    id: "restore",
    label: () => translate("capture.undone.restore"),
    primary: true,
  },
  { id: "dismiss", label: () => translate("capture.undone.dismiss"), dismissive: true },
];

function PickStep({
  files,
  previews,
  mode,
  busy,
  onAdd,
  onRemove,
  onMode,
  onStart,
  onManual,
}: {
  readonly files: readonly File[];
  readonly previews: readonly string[];
  readonly mode: Mode;
  readonly busy: boolean;
  readonly onAdd: (files: FileList | null) => void;
  readonly onRemove: (index: number) => void;
  readonly onMode: (mode: Mode) => void;
  readonly onStart: () => void;
  readonly onManual: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const pickerRef = useRef<HTMLInputElement>(null);
  const [pickerAsked, setPickerAsked] = useState(false);
  const [pickerSilent, setPickerSilent] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      {/*
        `sr-only`, not `hidden`. `display: none` is what the first two attempts
        used, and iOS Safari is documented to ignore a programmatic click on a
        file input that is not rendered at all. Clipping it off-screen keeps it
        in the layout, which is the version that works everywhere.

        No `capture` attribute: that is what lets the browser offer camera and
        photo library in the same sheet, which is the choice the user needs.
        Forcing `capture` would remove the library entirely.
      */}
      <input
        ref={pickerRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={(event) => {
          setPickerAsked(false);
          setPickerSilent(false);
          onAdd(event.target.files);
          // Reset so choosing the same file twice still fires a change.
          event.target.value = "";
        }}
      />

      <button
        type="button"
        onClick={() => {
          // A picker that never opens and a tap that never registered look
          // identical from the outside. Saying what happened is the difference
          // between "broken" and "I must have missed".
          setPickerAsked(true);
          setPickerSilent(false);
          pickerRef.current?.click();
          window.setTimeout(() => {
            setPickerSilent(true);
          }, 3000);
        }}
        className="flex flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-line bg-surface py-10 text-center transition hover:border-brand active:bg-canvas"
      >
        {/* An SVG with no size fills its container, which is how this ended up
            the size of the whole drop zone. */}
        <CameraIcon className="size-8 text-muted" />
        <span className="text-body text-ink">{t("capture.scan.pick.choose")}</span>
        <span className="px-4 text-helper text-muted">
          {t("capture.scan.pick.chooseHint", { max: MAX_RECOGNIZE_IMAGES })}
        </span>
      </button>

      {pickerAsked && pickerSilent ? (
        <Alert tone="info">
          <Trans
            i18nKey="capture.scan.pick.pickerSilent"
            components={{ manual: <button type="button" className="mx-1 underline" onClick={onManual} /> }}
          />
        </Alert>
      ) : null}

      {files.length === 0 ? null : (
        <ul className="flex flex-wrap gap-3">
          {previews.map((url, index) => (
            <li key={url} className="relative">
              <img src={url} alt={t("capture.scan.pick.thumbnailAlt", { number: index + 1 })} className="size-20 rounded-field object-cover" />
              <button
                type="button"
                aria-label={t("capture.scan.pick.remove", { number: index + 1 })}
                onClick={() => {
                  onRemove(index);
                }}
                className="absolute -top-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full bg-ink/75 text-xs text-on-ink"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {/*
        Only asked when there is something to choose. With one screenshot both
        answers produce the same single review, so the question is not a
        decision — it is a step the user has to get past before they can do the
        thing they came for. A question with only one answer should not be
        asked.

        The default stands when the section is hidden, so nothing downstream
        has to know whether it was shown.
      */}
      {files.length > 1 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-card-title text-ink">{t("capture.scan.pick.modeTitle")}</h2>
          <div className="flex flex-col gap-2">
            <ModeOption
              mode="single"
              current={mode}
              title={t("capture.scan.pick.singleTitle")}
              hint={t("capture.scan.pick.singleHint")}
              onSelect={onMode}
            />
            <ModeOption
              mode="batch"
              current={mode}
              title={t("capture.scan.pick.batchTitle")}
              hint={t("capture.scan.pick.batchHint")}
              onSelect={onMode}
            />
          </div>

          {/*
            ⚠️ **Answering this question does not start anything, and that is a
            correction the owner made after using it.**
            
            It used to launch recognition on the tap, on the reasoning that the
            answer was the last thing between the user and the result. He tried
            it and described exactly what went wrong: "点的那一瞬间，它就已经跳转
            到识别了，对我来说这个体验并不算好——我没办法百分百确定我点到了合适
            的位置."
            
            A tap that both selects and navigates gives no chance to notice a
            mis-tap, and the two options here are opposite answers — picking the
            wrong one produces a wrong ledger entry, not a wrong screen. With
            several pictures the picker has already saved the trips that mattered,
            so one deliberate confirmation is cheap; the saving was never worth
            the uncertainty. Now the choice is visible, and 开始识别 confirms it.
            (1.17.23: the line that said "tap 开始识别 below" is gone — the button
            right under the choice says it.)
          */}
        </section>
      ) : null}

      <Button disabled={files.length === 0 || busy} onClick={onStart}>
        {t("capture.scan.pick.start")}
      </Button>

      <button type="button" onClick={onManual} className="touch-target self-center text-helper text-muted underline">
        {t("capture.manualFallback")}
      </button>

      {busy ? <SkeletonRows rows={2} /> : null}
    </div>
  );
}

function ModeOption({
  mode,
  current,
  title,
  hint,
  onSelect,
}: {
  readonly mode: Mode;
  readonly current: Mode;
  readonly title: string;
  readonly hint: string;
  readonly onSelect: (mode: Mode) => void;
}): React.JSX.Element {
  const selected = mode === current;

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => {
        onSelect(mode);
      }}
      className={`flex flex-col gap-0.5 rounded-field border px-4 py-3 text-left transition ${
        selected ? "border-brand bg-brand-soft" : "border-line bg-surface"
      }`}
    >
      <span className="text-card-title text-ink">{title}</span>
      <span className="text-helper-relaxed text-muted">{hint}</span>
    </button>
  );
}

function WorkingStep({ total }: { readonly total: number }): React.JSX.Element {
  const { t } = useI18n();

  // 1.17.23：只说正在识别几张；「截图识别后丢弃」已在页面副标题说过一次，预计耗时没有实测依据，都不再重复。
  return (
    <div className="flex flex-col items-center gap-4 py-10">
      <div className="size-10 animate-spin rounded-full border-3 border-brand-soft border-t-brand" />
      <p className="text-body text-ink">{t("capture.recognizing")}</p>
      {total > 1 ? <p className="text-center text-helper text-muted">{t("capture.scan.workingCount", { count: total })}</p> : null}
    </div>
  );
}

export function draftOf(
  item: OcrItemResult,
  categories: readonly { id: string; name: string; kind: string; isArchived: boolean; isSystem?: boolean }[],
  paymentMethods: readonly { id: string; name: string; isArchived: boolean; channel?: string }[],
  lastCategoryId: string | null,
): ReviewDraft {
  const draft = item.draft;
  const now = new Date();

  const kind: TransactionKind = draft?.kind === "income" ? "income" : "expense";

  // The channel narrows the payment method: a WeChat screenshot means WeChat.
  // Nothing is invented when there is no match — an empty field is honest.
  // S16：这些是与账本支付方式原名比较的**数据**，不随界面语言变化。
  const channelNames: Record<string, string> = { WECHAT: "微信", ALIPAY: "支付宝", BANK: "银行卡" }; // i18n-ignore：与支付方式原名比较的数据
  const wanted = draft?.channel === null || draft?.channel === undefined ? null : channelNames[draft.channel];
  const method = wanted === null ? undefined : paymentMethods.find((entry) => entry.name === wanted);

  // The reading's own date and time when the screenshot carried them: that is
  // when the payment actually happened, not a value borrowed from an earlier
  // entry. When it carried none, the fallback is the current moment — never the
  // date of the last entry recorded, which is a different purchase's day.
  const date = draft?.occurredLocalDate ?? toLocalDate(now);
  const time = draft?.occurredTime ?? "";

  return {
    amount: draft?.amount ?? "",
    kind,
    currency: (CURRENCIES as readonly string[]).includes(draft?.currency ?? "")
      ? (draft?.currency as Currency)
      : "CNY",
    date,
    time,
    // Only a category the form will actually offer **for this kind**. Two
    // mistakes were possible here and both were being made: an archived
    // category, and — the one that reached a user — the other kind's category.
    // A screenshot recognised as income inherited the previous expense entry's
    // 暂无分类, and the server refused the save with a message about permissions
    // that had nothing to do with it.
    categoryId:
      categories.some(
        (category) =>
          category.id === lastCategoryId &&
          !category.isArchived &&
          category.kind === kind &&
          !category.isSystem,
      )
        ? lastCategoryId
        : null,
    paymentMethodId: method?.id ?? null,
    note: [draft?.counterparty, draft?.note].filter((part) => part !== null && part !== "").join(" · "),
  };
}

/** The single-entry mode: several proofs, one purchase, so the amounts add up. */
export function foldDrafts(
  items: readonly OcrItemResult[],
  categories: readonly { id: string; name: string; kind: string; isArchived: boolean; isSystem?: boolean }[],
  paymentMethods: readonly { id: string; name: string; isArchived: boolean; channel?: string }[],
  lastCategoryId: string | null,
): ReviewDraft {
  const first = items[0];
  const base =
    first === undefined
      ? null
      : draftOf(first, categories, paymentMethods, lastCategoryId);

  const fallback: ReviewDraft = base ?? {
    amount: "",
    kind: "expense",
    currency: "CNY",
    date: toLocalDate(new Date()),
    time: "",
    categoryId: null,
    paymentMethodId: null,
    note: "",
  };

  const currencies = new Set(items.map((item) => item.draft?.currency ?? "CNY"));
  if (currencies.size > 1) {
    // Adding yuan to yen is meaningless, so it is refused rather than guessed.
    return { ...fallback, amount: "" };
  }

  let total = 0;
  let readable = 0;

  for (const item of items) {
    const amount = item.draft?.amount;
    if (amount === null || amount === undefined || amount === "") continue;

    try {
      total += parseAmountInput(amount, fallback.currency);
      readable += 1;
    } catch {
      // An unreadable amount is skipped; the total is of what could be read.
    }
  }

  if (readable === 0) return fallback;

  return {
    ...fallback,
    // Formatted through the currency's own precision, not by dividing: 30.30
    // must not come back as 30.3, or the field would disagree with every other
    // amount on the screen.
    amount: formatMinor(total, decimalsFor(fallback.currency)),
  };
}
