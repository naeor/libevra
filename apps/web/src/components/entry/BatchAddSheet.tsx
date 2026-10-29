import {
  MAX_TAGS_PER_TRANSACTION,
  decimalsFor,
  type CreateTransactionInput,
  type Currency,
  type Transaction,
  type TransactionKind,
} from "@libellum/shared";
import { useEffect, useMemo, useState } from "react";

import { t as translate, useI18n } from "../../i18n/index.js";
import { categoryPath } from "@libellum/shared";
import { displayCategoryName, displayPaymentMethodName } from "../../lib/presetNames.js";
import { Alert } from "../Alert.js";
import { tagFillStyle } from "../../lib/tagColors.js";
import { ChoiceDialog, type Choice } from "../ChoiceDialog.js";
import { ConfirmDialog } from "../ConfirmDialog.js";
import { useDuplicateDetectionSettings } from "../DuplicateDetectionSettings.js";
import { createEntry as createLocally, localEntry } from "../../lib/offline/write.js";
import {
  fromDateTimeLocalValue,
  localTimeZone,
  toDateTimeLocalValue,
  toLocalDate,
  toLocalIso,
} from "../../lib/datetime.js";
import { currencyName, minorToInput, parseAmountInput } from "../../lib/format.js";
import { useCheckDuplicates, useLedger } from "../../lib/queries.js";
import { uuidV7 } from "../../lib/uuid.js";

/**
 * One card in the batch-add sheet. The id is minted once, here, and reused as
 * the idempotency key on every retry — a failed save must never create a
 * second entry for the same card.
 */
export interface BatchEntryDraft {
  readonly id: string;
  readonly kind: TransactionKind;
  readonly amountText: string;
  readonly categoryId: string | null;
  readonly paymentMethodId: string | null;
  readonly currency: Currency;
  readonly occurredAt: Date;
  readonly note: string;
  readonly tagIds: readonly string[];
}

interface BatchCategory {
  readonly id: string;
  readonly name: string;
  readonly kind: TransactionKind;
  readonly isArchived: boolean;
}

interface BatchPaymentMethod {
  readonly id: string;
  readonly name: string;
  readonly isArchived: boolean;
}

interface BatchTag {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

interface BatchLedgerData {
  readonly book: { readonly id: string };
  readonly categories: readonly BatchCategory[];
  readonly paymentMethods: readonly BatchPaymentMethod[];
  readonly tags: readonly BatchTag[];
}

/** 批量记账遇到疑似重复时的两个选项；文案在调用时按当前语言取（不在模块顶层取）。 */
function batchDuplicateChoices(): readonly Choice<"save" | "cancel">[] {
  return [
    { id: "save", label: translate("entry.batch.saveAll"), primary: true },
    { id: "cancel", label: translate("entry.duplicate.cancel"), dismissive: true },
  ];
}

function fallbackPaymentMethodId(methods: readonly BatchPaymentMethod[]): string | null {
  return methods.find((method) => method.name === "其他")?.id ?? methods[0]?.id ?? null; // i18n-ignore：与数据库里的预置支付方式原名比较，不是界面文字
}

/** The source entry is a template for the first card; the original is never touched. */
export function initialBatchDraft(
  source: Transaction,
  fallbackPaymentMethod: string | null,
): BatchEntryDraft {
  return {
    id: uuidV7(),
    kind: source.kind,
    amountText: minorToInput(source.amountCents, source.currency),
    categoryId: source.categoryId,
    paymentMethodId: source.paymentMethodId ?? fallbackPaymentMethod,
    currency: source.currency,
    occurredAt: new Date(source.occurredAt),
    note: source.note ?? "",
    tagIds: source.tags.map((tag) => tag.id),
  };
}

/** A new card starts empty, apart from the ledger's default payment method. */
export function emptyBatchDraft(
  fallbackPaymentMethod: string | null,
  now: Date,
  currency: Currency = "CNY",
): BatchEntryDraft {
  return {
    id: uuidV7(),
    kind: "expense",
    amountText: "",
    categoryId: null,
    paymentMethodId: fallbackPaymentMethod,
    currency,
    occurredAt: now,
    note: "",
    tagIds: [],
  };
}

export function hasBatchContent(draft: BatchEntryDraft): boolean {
  return (
    draft.amountText.trim() !== "" ||
    draft.note.trim() !== "" ||
    draft.categoryId !== null ||
    draft.tagIds.length > 0
  );
}

export function batchCardAmount(draft: BatchEntryDraft): number | null {
  try {
    const amount = parseAmountInput(draft.amountText, draft.currency);
    return amount > 0 ? amount : null;
  } catch {
    return null;
  }
}

export function batchTotalCents(drafts: readonly BatchEntryDraft[]): number {
  return drafts.reduce((total, draft) => total + (batchCardAmount(draft) ?? 0), 0);
}

export function validateBatchDraft(draft: BatchEntryDraft): string | null {
  if (draft.amountText.trim() === "") return translate("entry.amount.required");
  try {
    const amount = parseAmountInput(draft.amountText, draft.currency);
    if (amount <= 0) return translate("entry.amount.positive");
  } catch {
    return decimalsFor(draft.currency) === 0
      ? translate("entry.amount.integerOnly", { currency: currencyName(draft.currency) })
      : translate("entry.amount.invalid", { currency: currencyName(draft.currency) });
  }
  if (Number.isNaN(draft.occurredAt.getTime())) return translate("entry.batch.timeInvalid");
  if (draft.note.length > 200) return translate("entry.batch.noteTooLong", { max: 200 });
  if (draft.tagIds.length > MAX_TAGS_PER_TRANSACTION) {
    return translate("entry.batch.tooManyTags", { max: MAX_TAGS_PER_TRANSACTION });
  }
  return null;
}

export function buildBatchInput(draft: BatchEntryDraft): CreateTransactionInput {
  const amountCents = parseAmountInput(draft.amountText, draft.currency);
  return {
    id: draft.id,
    idempotencyKey: draft.id,
    kind: draft.kind,
    amountCents,
    currency: draft.currency,
    categoryId: draft.categoryId,
    paymentMethodId: draft.paymentMethodId,
    occurredAt: toLocalIso(draft.occurredAt),
    occurredLocalDate: toLocalDate(draft.occurredAt),
    occurredTz: localTimeZone(),
    note: draft.note.trim() === "" ? null : draft.note.trim(),
    tagIds: [...draft.tagIds],
  };
}

/** Whether removing this card needs the confirmation dialog. */
export function batchRemovalNeedsConfirmation(
  drafts: readonly BatchEntryDraft[],
  draftId: string,
): boolean {
  if (drafts.length <= 1) return false;
  const draft = drafts.find((item) => item.id === draftId);
  return draft !== undefined && hasBatchContent(draft);
}

export function BatchAddSheet({
  open,
  source,
  onClose,
  onSaved,
}: {
  readonly open: boolean;
  readonly source: Transaction;
  readonly onClose: () => void;
  readonly onSaved: (count: number) => void;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const ledger = useLedger();
  const duplicateSettings = useDuplicateDetectionSettings();
  const checkDuplicates = useCheckDuplicates();
  const ledgerData = ledger.data as BatchLedgerData | undefined;
  const paymentFallback = useMemo(
    () => fallbackPaymentMethodId(ledgerData?.paymentMethods ?? []),
    [ledgerData],
  );

  const [drafts, setDrafts] = useState<readonly BatchEntryDraft[]>(() => [
    initialBatchDraft(source, paymentFallback),
  ]);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [removeCandidate, setRemoveCandidate] = useState<string | null>(null);
  const [duplicateCount, setDuplicateCount] = useState(0);

  useEffect(() => {
    if (!open) return;
    setDrafts([initialBatchDraft(source, paymentFallback)]);
    setErrors({});
    setError(null);
    setBusy(false);
    setSavedCount(null);
    setRemoveCandidate(null);
    setDuplicateCount(0);
    // A new opening starts a new batch; a background ledger refresh must not
    // discard cards the user has already edited.
  }, [open, source]);

  if (!open) return null;

  const currencies = new Set(drafts.map((draft) => draft.currency));
  const totalCurrency = currencies.size === 1 ? drafts[0]?.currency ?? "CNY" : null;

  function updateDraft(id: string, patch: Partial<BatchEntryDraft>): void {
    setDrafts((current) => current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)));
  }

  function addCard(): void {
    setDrafts((current) => [
      ...current,
      emptyBatchDraft(paymentFallback, new Date(), current[0]?.currency ?? "CNY"),
    ]);
  }

  function removeCard(id: string): void {
    if (drafts.length <= 1) return;
    if (batchRemovalNeedsConfirmation(drafts, id)) {
      setRemoveCandidate(id);
      return;
    }
    setDrafts((current) => current.filter((draft) => draft.id !== id));
  }

  function confirmRemove(): void {
    if (removeCandidate === null) return;
    setDrafts((current) => current.filter((draft) => draft.id !== removeCandidate));
    setRemoveCandidate(null);
  }

  async function saveAll(skipDuplicateCheck = false): Promise<void> {
    setError(null);
    if (ledgerData === undefined) {
      setError(t("entry.batch.ledgerLoading"));
      return;
    }

    const nextErrors: Record<string, string> = {};
    for (const draft of drafts) {
      const message = validateBatchDraft(draft);
      if (message !== null) nextErrors[draft.id] = message;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setError(t("entry.batch.hasErrors"));
      return;
    }

    setBusy(true);
    try {
      /**
       * The single-entry form asks before writing a likely duplicate. A batch
       * must not become a quiet way around that reminder, so check every card
       * first and offer one group-level choice. Detection is a courtesy, not a
       * gate: a failed lookup must never stop the write.
       */
      if (!skipDuplicateCheck) {
        let duplicateCards = 0;
        for (const draft of drafts) {
          try {
            const input = buildBatchInput(draft);
            const found = await checkDuplicates.mutateAsync({
              kind: input.kind,
              amountCents: input.amountCents,
              currency: input.currency,
              occurredAt: input.occurredAt,
              occurredTz: input.occurredTz,
              occurredLocalDate: input.occurredLocalDate,
              occurredTime: input.occurredAt.slice(11, 16),
              categoryId: input.categoryId,
              paymentMethodId: input.paymentMethodId,
              note: input.note ?? undefined,
              tagIds: [...input.tagIds],
              settings: duplicateSettings.settings,
            });
            if (found.history.length > 0) duplicateCards += 1;
          } catch {
            // An unavailable check must not block recording the batch.
          }
        }
        if (duplicateCards > 0) {
          setDuplicateCount(duplicateCards);
          return;
        }
      }

      let written = 0;
      try {
        for (const draft of drafts) {
          const input = buildBatchInput(draft);
          await createLocally(input, localEntry(input, ledgerData));
          written += 1;
        }
        setSavedCount(written);
        onSaved(written);
      } catch (caught) {
        setError(
          written === 0
            ? t("entry.batch.noneSaved", {
                reason: caught instanceof Error ? caught.message : t("entry.batch.retryLater"),
              })
            : t("entry.batch.partlySaved", { count: written }),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-40 bg-overlay-soft backdrop-in" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("entry.batch.title")}
        className="sheet-in fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[calc(100dvh-12px)] w-full max-w-md flex-col overflow-hidden rounded-t-sheet border border-line bg-canvas shadow-sheet"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3">
          <h2 className="min-w-0 text-base font-medium text-ink">{t("entry.batch.title")}</h2>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="shrink-0 text-sm font-medium text-brand-dark disabled:opacity-45"
          >
            {t("common.action.cancel")}
          </button>
        </div>

        {savedCount !== null ? (
          <div className="flex flex-col gap-5 p-5">
            <Alert tone="success">{t("entry.batch.saved", { count: savedCount })}</Alert>
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-field bg-brand py-3.5 text-button-lg font-medium text-on-brand"
            >
              {t("common.action.done")}
            </button>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
              <p className="pb-3 text-helper-relaxed text-muted">
                {t("entry.batch.intro")}
              </p>

              {error === null ? null : (
                <div className="pb-3">
                  <Alert>{error}</Alert>
                </div>
              )}

              <div className="flex flex-col gap-4">
                {drafts.map((draft, index) => (
                  <BatchCard
                    key={draft.id}
                    draft={draft}
                    index={index}
                    categories={(ledgerData?.categories ?? []).filter(
                      (category) => category.kind === draft.kind && !category.isArchived,
                    )}
                    allCategories={ledgerData?.categories??[]}
                    paymentMethods={(ledgerData?.paymentMethods ?? []).filter(
                      (method) => !method.isArchived,
                    )}
                    tags={ledgerData?.tags ?? []}
                    error={errors[draft.id]}
                    canRemove={drafts.length > 1}
                    autoFocusAmount={index === drafts.length - 1 && drafts.length > 1}
                    onChange={(patch) => updateDraft(draft.id, patch)}
                    onRemove={() => removeCard(draft.id)}
                  />
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
                <button
                  type="button"
                  onClick={addCard}
                  className="rounded-field border border-brand px-4 py-2.5 text-sm font-medium text-brand-dark transition hover:bg-brand-soft"
                >
                  {t("entry.batch.addCard")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const bookId = ledgerData?.book.id;
                    if (bookId === undefined) return;
                    onClose();
                    window.location.assign(`/books/${bookId}/settings`);
                  }}
                  className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-helper text-muted transition hover:text-ink"
                >
                  {t("entry.batch.settings")}
                </button>
              </div>
            </div>

            <div className="shrink-0 border-t border-line bg-surface px-4 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-3">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pb-2 text-sm">
                <span className="text-muted">{t("entry.batch.cardCount", { count: drafts.length })}</span>
                <span className="min-w-0 font-medium text-ink">
                  {totalCurrency === null
                    ? t("entry.batch.mixedCurrencies")
                    : t("entry.batch.total", {
                        currency: currencyName(totalCurrency),
                        amount: minorToInput(batchTotalCents(drafts), totalCurrency),
                      })}
                </span>
              </div>
              <button
                type="button"
                disabled={busy || drafts.length === 0}
                onClick={() => void saveAll()}
                className="w-full rounded-field bg-brand py-3.5 text-button-lg font-medium text-on-brand transition hover:bg-brand-dark disabled:opacity-45"
              >
                {busy ? t("common.action.saving") : t("entry.batch.saveCount", { count: drafts.length })}
              </button>
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={removeCandidate !== null}
        title={t("entry.batch.removeTitle")}
        description={t("entry.batch.removeDescription")}
        consequences={[t("entry.batch.removeConsequence")]}
        confirmLabel={t("entry.batch.removeConfirm")}
        onConfirm={confirmRemove}
        onCancel={() => {
          setRemoveCandidate(null);
        }}
      />

      <ChoiceDialog
        open={duplicateCount > 0}
        title={t("entry.batch.duplicateTitle")}
        description={t("entry.batch.duplicateDescription", { count: duplicateCount })}
        choices={batchDuplicateChoices()}
        onChoose={(choice) => {
          setDuplicateCount(0);
          if (choice === "save") void saveAll(true);
        }}
      />
    </>
  );
}

function BatchCard({
  draft,
  index,
  categories,
  allCategories=categories,
  paymentMethods,
  tags,
  error,
  canRemove,
  autoFocusAmount,
  onChange,
  onRemove,
}: {
  readonly draft: BatchEntryDraft;
  readonly index: number;
  readonly categories: readonly BatchCategory[];
  readonly allCategories?: readonly BatchCategory[];
  readonly paymentMethods: readonly BatchPaymentMethod[];
  readonly tags: readonly BatchTag[];
  readonly error: string | undefined;
  readonly canRemove: boolean;
  readonly autoFocusAmount: boolean;
  readonly onChange: (patch: Partial<BatchEntryDraft>) => void;
  readonly onRemove: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const categoryOptions = categories.filter((category) => category.kind === draft.kind);
  return (
    <section className="rounded-card border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-3 pb-3">
        <h3 className="text-sm font-semibold text-ink">{t("entry.batch.cardTitle", { number: index + 1 })}</h3>
        {canRemove ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={t("entry.batch.removeCard", { number: index + 1 })}
            className="text-helper text-danger"
          >
            {t("common.action.delete")}
          </button>
        ) : null}
      </div>

      <div className="flex gap-2 pb-3">
        {(["expense", "income"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={draft.kind === kind}
            onClick={() => {
              onChange({ kind, categoryId: null });
            }}
            className={`flex-1 rounded-field py-2 text-sm ${
              draft.kind === kind ? "bg-brand text-on-brand" : "bg-canvas text-ink"
            }`}
          >
            {t(`common.kind.${kind}`)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 pb-3">
        <label className="flex flex-col gap-1 text-helper text-muted">
          {t("common.field.amount")}
          <input
            autoFocus={autoFocusAmount}
            inputMode="decimal"
            value={draft.amountText}
            onChange={(event) => {
              onChange({ amountText: event.target.value });
            }}
            className="min-h-10 rounded-field border border-line bg-canvas px-3 text-base text-ink outline-none focus:border-brand"
          />
        </label>
        <select
          aria-label={t("common.field.currency")}
          value={draft.currency}
          onChange={(event) => {
            onChange({ currency: event.target.value as Currency });
          }}
          className="min-h-10 rounded-field border border-line bg-canvas px-2 text-base text-ink"
        >
          {(["CNY", "USD", "EUR", "JPY", "HKD", "GBP"] as const).map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2 pb-3">
        <label className="flex min-w-0 flex-col gap-1 text-helper text-muted">
          {t("common.field.category")}
          <select
            value={draft.categoryId ?? ""}
            onChange={(event) => {
              onChange({ categoryId: event.target.value === "" ? null : event.target.value });
            }}
            className="min-h-10 rounded-field border border-line bg-canvas px-2 text-base text-ink"
          >
            <option value="">{t("entry.batch.uncategorized")}</option>
            {categoryOptions.map((category) => (
              <option key={category.id} value={category.id}>
                {categoryPath(allCategories,category.id).map(c=>displayCategoryName(c.name)).join(" / ")}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-helper text-muted">
          {t("common.field.paymentMethod")}
          <select
            value={draft.paymentMethodId ?? ""}
            onChange={(event) => {
              onChange({ paymentMethodId: event.target.value === "" ? null : event.target.value });
            }}
            className="min-h-10 rounded-field border border-line bg-canvas px-2 text-base text-ink"
          >
            <option value="">{t("entry.batch.noPayment")}</option>
            {paymentMethods.map((method) => (
              <option key={method.id} value={method.id}>
                {displayPaymentMethodName(method.name)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1 pb-3 text-helper text-muted">
        {t("common.field.time")}
        <input
          type="datetime-local"
          step="1"
          value={toDateTimeLocalValue(draft.occurredAt)}
          onChange={(event) => {
            const parsed = fromDateTimeLocalValue(event.target.value);
            if (parsed !== null) onChange({ occurredAt: parsed });
          }}
          className="min-h-10 rounded-field border border-line bg-canvas px-2 text-base text-ink"
        />
      </label>

      <label className="flex flex-col gap-1 pb-3 text-helper text-muted">
        {t("common.field.note")}
        <input
          maxLength={200}
          value={draft.note}
          onChange={(event) => {
            onChange({ note: event.target.value });
          }}
          className="min-h-10 rounded-field border border-line bg-canvas px-3 text-base text-ink"
        />
      </label>

      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => {
            const selected = draft.tagIds.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => {
                  onChange({
                    tagIds: selected
                      ? draft.tagIds.filter((id) => id !== tag.id)
                      : draft.tagIds.length >= MAX_TAGS_PER_TRANSACTION
                        ? draft.tagIds
                        : [...draft.tagIds, tag.id],
                  });
                }}
                style={selected ? tagFillStyle(tag.color) : undefined}
                className={`rounded-full border px-2.5 py-1 text-helper ${
                  selected ? "text-on-tag" : "border-line bg-canvas text-muted"
                }`}
              >
                {tag.name}
              </button>
            );
          })}
        </div>
      ) : null}

      {error === undefined ? null : <p className="pt-2 text-helper text-danger">{error}</p>}
    </section>
  );
}
