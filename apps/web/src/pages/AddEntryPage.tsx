import {
  CURRENCIES,
  MAX_TAGS_PER_TRANSACTION,
  decimalsFor,
  type Currency,
  type Transaction,
  type TransactionKind,
} from "@libellum/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { Alert } from "../components/Alert.js";
import { EntrySaved } from "../components/EntrySaved.js";
import { EntryMoreOptions } from "../components/entry/EntryMoreOptions.js";
import { EntrySaveBar } from "../components/entry/EntrySaveBar.js";
import { InfoIcon } from "../components/InfoHint.js";
import { TabPage } from "../components/Layouts.js";
import { errorMessage } from "../lib/api.js";
import {
  fromDateTimeLocalValue,
  localTimeZone,
  toDateTimeLocalValue,
  toLocalDate,
  toLocalIso,
} from "../lib/datetime.js";
import { amountPlaceholder, currencyName, minorToInput, parseAmountInput } from "../lib/format.js";
import { createEntry as createLocally, localEntry } from "../lib/offline/write.js";
import { useSharedLedgerOfflineReadOnly } from "../lib/offline/writePolicy.js";
import { useCreateTransaction, useLedger, useQuickAmounts, useTransactions } from "../lib/queries.js";
import { uuidV7 } from "../lib/uuid.js";

/** Shown when there is nothing to inherit and nothing named 其他 to fall back on. */
const UNCATEGORISED_LABEL = "暂无分类";
const DEFAULT_PAYMENT_METHOD_NAME = "其他";

/**
 * The screen the whole application exists for.
 *
 * Two defaults matter here. A category starts at 暂无分类 and a payment method
 * at 其他, so a first entry can be saved without opening either control. Once
 * there is history the category, the payment method and the currency follow the
 * previous entry instead, which is what makes recording a day's receipts quick.
 *
 * The *date* never follows anything. Every entry starts at the current time:
 * the first one on a freshly opened screen, and equally the one after the
 * "再记一笔" button. Inheriting a date from an older entry would silently file
 * today's spending under the wrong day — and because the stale value stays
 * visible in the field, nothing on the screen would look wrong.
 *
 * Editing an existing entry is not an exception to that rule but the other side
 * of it: `EntryDetailPage` shows the past moment because it is changing *that
 * entry*, which keeps its own time. A new entry never borrows one.
 */
export function AddEntryPage(): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const ledger = useLedger();
  const quickAmounts = useQuickAmounts();
  const recent = useTransactions({});
  const createEntry = useCreateTransaction();
  /**
   * ⚠️ **Shared ledger + offline = read-only**, the owner's S13-E rule. The write layer refuses it
   * anyway; this hook is what lets the form say why *before* the user types a whole entry.
   */
  const { readOnly: sharedOfflineReadOnly } = useSharedLedgerOfflineReadOnly();

  /** Set by "复制这一笔" on the detail screen. */
  const copyFrom = (location.state as { copyFrom?: Transaction } | null)?.copyFrom;

  const amountRef = useRef<HTMLInputElement>(null);
  const defaultsApplied = useRef(false);
  /**
   * 滚动区本身。只交给保存行动条使用：`useKeyboardInset` 要量它的底边，
   * 才能算出软键盘到底盖住了多少（`TabPage` 本来就把这个 ref 暴露出来了）。
   */
  const scrollRef = useRef<HTMLDivElement>(null);

  const [kind, setKind] = useState<TransactionKind>("expense");
  const [amountText, setAmountText] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [categoryOpen, setCategoryOpen] = useState(false);
  /**
   * 「更多选项」（备注、标签）是否展开。
   *
   * ⚠️ **默认收起是 S15-C 的取舍**：这两项不是每笔都要填，却曾占着保存按钮上方两整段。
   * 收起不丢能力——展开后仍是原来的输入框与标签按钮；这里只控制可见性。
   */
  const [moreOpen, setMoreOpen] = useState(false);
  /** Which category's ⓘ explanation is open, if any. */
  const [hintCategoryId, setHintCategoryId] = useState<string | null>(null);
  const [paymentMethodId, setPaymentMethodId] = useState<string | null>(null);
  const [currency, setCurrency] = useState<Currency>("CNY");
  const [occurredAt, setOccurredAt] = useState(() => new Date());
  const [note, setNote] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  /**
   * The entry just saved, or null while the form is showing.
   *
   * Held in component state rather than pushed to a route: the confirmation is
   * the tail of this screen's flow, not a place with its own address. Coming
   * back to /add must never resurrect a filled-in form.
   */
  const [saved, setSaved] = useState<Transaction | null>(null);
  /** Set when the next render should put the cursor back in the amount field. */
  const focusAfterReset = useRef(false);

  const categories = useMemo(
    () =>
      (ledger.data?.categories ?? []).filter(
        // The system category is a fallback, not a choice — never offered.
        (category) => category.kind === kind && !category.isArchived && !category.isSystem,
      ),
    [ledger.data, kind],
  );

  const paymentMethods = useMemo(
    () => (ledger.data?.paymentMethods ?? []).filter((method) => !method.isArchived),
    [ledger.data],
  );

  const tags = ledger.data?.tags ?? [];
  const selectedCategory = categories.find((category) => category.id === categoryId);

  // Defaults are applied exactly once, and only after both reads have settled —
  // otherwise a click made while the data was still loading would be overwritten.
  //
  // ⚠️ **连续记账（S15-C E）只在这里留了位置，没有实现。** 这一版「继承上一笔」只覆盖
  // 分类、支付方式与币种；将来若要连金额/备注/标签也继承，唯一入口应当是这里与
  // `NextEntryFields`，而不是在提交路径上偷偷带值。本轮不新增没有使用者的 props——
  // 一个没有消费者的开关只会腐烂。
  useEffect(() => {
    if (defaultsApplied.current || copyFrom) return;
    if (!recent.isSuccess || !ledger.isSuccess) return;

    const last = recent.data?.pages[0]?.items[0];
    const fallbackMethod = paymentMethods.find((method) => method.name === DEFAULT_PAYMENT_METHOD_NAME);

    if (last) {
      setCategoryId(last.categoryId);
      setPaymentMethodId(last.paymentMethodId ?? fallbackMethod?.id ?? null);
      setCurrency(last.currency);
    } else {
      setPaymentMethodId(fallbackMethod?.id ?? null);
    }

    defaultsApplied.current = true;
  }, [recent.isSuccess, recent.data, ledger.isSuccess, paymentMethods, copyFrom]);

  // "复制这一笔" pre-fills everything about the source entry except the date,
  // which stays the present: a copy is a new expense, not a re-dating of the old.
  useEffect(() => {
    if (!copyFrom) return;
    setKind(copyFrom.kind);
    setAmountText(minorToInput(copyFrom.amountCents, copyFrom.currency));
    setCategoryId(copyFrom.categoryId);
    setPaymentMethodId(copyFrom.paymentMethodId);
    setCurrency(copyFrom.currency);
    setNote(copyFrom.note ?? "");
    setTagIds(copyFrom.tags.map((tag) => tag.id));
    // 复制来的备注/标签若藏在收起的「更多选项」里，会像没有复制成功；
    // 只有确实有内容时才展开，空白的新笔记账仍保持收起。
    if ((copyFrom.note ?? "") !== "" || copyFrom.tags.length > 0) setMoreOpen(true);
    defaultsApplied.current = true;
  }, [copyFrom]);

  async function save(): Promise<void> {
    setError(null);

    if (sharedOfflineReadOnly) {
      setError("当前离线，共享账本暂时只能查看。恢复网络后可以继续记账。");
      return;
    }

    let amountCents: number;
    try {
      amountCents = parseAmountInput(amountText, currency);
    } catch {
      setError(
        decimalsFor(currency) === 0
          ? `${currencyName(currency)}不支持小数，请输入整数金额。`
          : `金额格式不正确，${currencyName(currency)}最多两位小数。`,
      );
      return;
    }

    if (amountCents <= 0) {
      setError("金额需要大于 0。");
      return;
    }

    /**
     * ⚠️ **The time is a *default the user may override*, and that is the whole story.**
     *
     * The owner settled this: **"时间不用是提交的那一刻。因为时间本质上是可以让用户自己编辑的，
     * 预设的时间只是一个方便用户的预设，大多数情况下，记一笔账所花的时间也只有十几秒。所以问题不大。"**
     *
     * So there are two cases, and they must not be confused:
     *
     * | What the user did | What is stored |
     * |---|---|
     * | left the field alone | **now** — a convenience default, and now is what they meant |
     * | **changed the field** | **what they chose**, exactly |
     *
     * ⚠️ **Where this value is read matters, and this is the subtle part.** Reading it *here* — at submit —
     * rather than from the state that was captured when the screen mounted is what makes the default "now".
     * **The screen stays mounted between entries and can sit in the background for hours**, so its mount-time
     * value is not now, and a default that is hours stale is not a convenience. **That staleness is what the
     * owner reported**: two evening entries filed at noon, "被放到了 19:09 和 12 点整的两个账单中间."
     *
     * ⚠️ **An explicitly chosen time is untouched by this**, because `occurredAt` is what the field holds and
     * the field is what the user edited. The edit screen sets it from the entry being edited for the same
     * reason: **a time the user chose outranks any default the program would prefer.**
     */
    const savedAt = new Date();

    try {
      /**
       * ⚠️ **The id and the idempotency key are the same value, minted here.**
       *
       * That is what lets the entry exist — and be shown — before the server has ever heard of it, and it
       * is what makes a replayed upload harmless: the server's `idempotency_key` is unique, so the second
       * delivery finds the row it already made.
       */
      const id = uuidV7();
      const input = {
        id,
        idempotencyKey: id,
        kind,
        amountCents,
        currency,
        categoryId,
        paymentMethodId,
        /**
         * ⚠️ **The default is "now", the user's own choice is kept — see `savedAt` above.**
         */
        occurredAt: toLocalIso(savedAt),
        occurredLocalDate: toLocalDate(savedAt),
        occurredTz: localTimeZone(),
        note: note.trim() === "" ? null : note.trim(),
        tagIds,
      } as const;

      const outcome = await createLocally(
        input,
        localEntry(input, ledger.data),
      );

      /**
       * ⚠️ **A locally stored entry is still a saved entry.**
       *
       * The screen shows its success state either way, because the user's entry *is* recorded — on the
       * device. The only difference is the marker the ledger puts on the row: **silently reporting a write
       * that has not left the device is how somebody loses spending they believe they recorded.**
       */
      setSaved(outcome.entry);
    } catch (caught) {
      /**
       * ⚠️ **Falling back to the local write when the server refuses.**
       *
       * A 5xx or a dropped connection is not a reason to lose what the user typed. The write goes to the
       * device and the queue, and reaches the server when it can — which is the whole point of this round.
       */
      try {
        const id = uuidV7();
        const input = {
          id,
          idempotencyKey: id,
          kind,
          amountCents,
          currency,
          categoryId,
          paymentMethodId,
          occurredAt: toLocalIso(savedAt),
          occurredLocalDate: toLocalDate(savedAt),
          occurredTz: localTimeZone(),
          note: note.trim() === "" ? null : note.trim(),
          tagIds,
        } as const;

        const outcome = await createLocally(input, localEntry(input, ledger.data));

        setSaved(outcome.entry);
      } catch {
        setError(errorMessage(caught));
      }
    }
  }

  // Focus returns to the amount field for the next entry, but only after the
  // form has actually been put back on screen.
  useEffect(() => {
    if (saved === null && focusAfterReset.current) {
      focusAfterReset.current = false;
      amountRef.current?.focus();
    }
  }, [saved]);

  if (saved !== null) {
    return (
      <EntrySaved
        entry={saved}
        categoryName={
          categories.find((category) => category.id === saved.categoryId)?.name ?? UNCATEGORISED_LABEL
        }
        paymentName={
          paymentMethods.find((method) => method.id === saved.paymentMethodId)?.name ?? null
        }
        // The manual form records one entry at a time, so nothing is ever
        // waiting behind it and both ways onward are offered.
        remaining={0}
        onHome={() => {
          void navigate("/");
        }}
        onAgain={() => {
          const next = nextEntryFields(new Date());

          focusAfterReset.current = true;
          setAmountText(next.amountText);
          setNote(next.note);
          setTagIds([...next.tagIds]);
          setOccurredAt(next.occurredAt);
          setMoreOpen(false);
          setError(null);
          setSaved(null);
        }}
      />
    );
  }

  return (
    <TabPage active="/add" onNavigate={(to) => void navigate(to)} scrollRef={scrollRef}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <header className="flex flex-col gap-4 bg-brand px-6 pt-8 pb-6 text-white">
          {/**
            * ⚠️ **The guest identity is deliberately not shown on this screen** (S14-C UI fix,
            * 1.14.05). It shared this row with the 支出/收入 switch and broke its balance; the owner
            * asked for it removed here rather than moved, and for the two buttons to keep their
            * original full-width proportions. It remains in the header of 明细 / 分析 / 账本空间 /
            * 我的.
            */}
          <div data-entry-kind-switch className="flex gap-2">
            {(["expense", "income"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={kind === option}
                onClick={() => {
                  setKind(option);
                  setCategoryId(null);
                }}
                className={`flex-1 rounded-field py-3 text-sm font-medium transition ${
                  kind === option ? "bg-white text-brand-dark" : "bg-white/15 text-white/90"
                }`}
              >
                {option === "expense" ? "支出" : "收入"}
              </button>
            ))}
          </div>
        </header>

        {/*
          ⚠️ **The amount is its own card, in white, with a green frame — and the owner asked for exactly
          this**: "现在的手动记账页面金钱的部分底色是绿色的，看起来上面太接近了。我手动记账的时候也出现过
          直接往下滑，没计钱的情况。建议把绿色改为只有支出和收入两个按钮使用绿色。然后把金额的稍微往下移动
          一点，并且周围改为多一个绿色的框，中间还是白底，让人第一时间能把视觉重心放到这里."

          **Two problems, and the second one is about losing money.**

          The green header and the amount field inside it were the same colour family, so the most important
          field on the screen read as part of the chrome. **And he scrolled past it**: with the field flush
          against the buttons, a scroll that was meant to reveal the rest of the form could take the amount
          out of view — and an entry saved with no amount is an entry that has to be found and fixed later.

          **White inside a green frame is the answer to both**: the eye lands on the only white thing above the
          fold, and the frame is a boundary the scroll has to cross rather than a place the cursor can sit
          ambiguously.
        */}
        <section className="bg-canvas px-6 pt-4">
          {/*
            ⚠️ **「点按即可修改」不是装饰**（S15-C）。金额是这块屏幕存在的理由，但它长得像一张
            展示卡；给出一行 12px 的提示，比把卡片改成控件样式更克制，也不用动输入框本身。
          */}
          <div className="flex items-baseline justify-between gap-2 pb-2">
            <h2 className="text-helper text-muted">金额</h2>
            <span className="text-helper text-muted">点按即可修改</span>
          </div>
          <label
            className="flex cursor-text items-baseline gap-2 rounded-card border-2 border-brand bg-surface px-4 py-4 shadow-sm"
          >
            <span className="text-2xl text-brand-dark">{currency === "CNY" ? "¥" : ""}</span>
            <input
              ref={amountRef}
              value={amountText}
              onChange={(event) => {
                setAmountText(event.target.value);
              }}
              inputMode="decimal"
              placeholder={amountPlaceholder(currency)}
              aria-label="金额"
              autoFocus
              className="w-full bg-transparent text-4xl font-semibold text-ink outline-none placeholder:text-muted/80"
            />
            <span className="text-body text-muted">{currency}</span>
          </label>

          <div className="flex flex-wrap gap-2 pt-3">
            {quickAmounts.map((cents) => (
              <button
                key={cents}
                type="button"
                onClick={() => {
                  setAmountText(minorToInput(cents, currency));
                }}
                className="rounded-full border border-brand-soft bg-brand-soft px-3.5 py-1.5 text-body text-brand-dark transition hover:border-brand"
              >
                {minorToInput(cents, currency)}
              </button>
            ))}
          </div>
        </section>

        {/*
          ⚠️ **The rest of the form starts here.** The old markup continued a single header past the amount, so
          everything below was inside the white-on-green block; it now sits on the page background, where
          ordinary fields belong.

          S15-C 的排列顺序按真实手机重排：高频核心（金额、分类、支付方式）在前，常用次级（币种、时间）
          合成一条紧凑卡片，低频（备注、标签）收进「更多选项」，保存固定为底部的粘性行动条。
        */}

        <section className="flex flex-col gap-2 px-6 pt-5">
          <h2 className="text-helper text-muted">分类</h2>

          <div className="overflow-hidden rounded-field border border-line bg-surface">
            <button
              type="button"
              aria-expanded={categoryOpen}
              onClick={() => {
                setCategoryOpen((open) => !open);
              }}
              className="flex w-full items-center justify-between px-4 py-3.5 text-left transition hover:bg-canvas"
            >
              <span className="text-button-lg text-ink">
                {selectedCategory?.name ?? UNCATEGORISED_LABEL}
              </span>
              <span className="text-muted" aria-hidden="true">
                {categoryOpen ? "⌃" : "⌄"}
              </span>
            </button>

            {categoryOpen ? (
              <ul className="max-h-64 overflow-y-auto border-t border-line">
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      setCategoryId(null);
                      setCategoryOpen(false);
                    }}
                    className={`w-full px-4 py-3 text-left text-sm transition hover:bg-brand-soft ${
                      categoryId === null ? "text-brand-dark" : "text-ink"
                    }`}
                  >
                    {UNCATEGORISED_LABEL}
                  </button>
                </li>

                {categories.map((category) => (
                  <li key={category.id} className="border-t border-line">
                    <div className="flex items-stretch">
                      <button
                        type="button"
                        onClick={() => {
                          setCategoryId(category.id);
                          setCategoryOpen(false);
                        }}
                        className={`flex-1 px-4 py-3 text-left text-sm transition hover:bg-brand-soft ${
                          category.id === categoryId ? "text-brand-dark" : "text-ink"
                        }`}
                      >
                        {category.name}
                      </button>

                      {/* The explanation belongs to the preset, so it only
                          exists until the category is renamed. */}
                      {category.description ? (
                        <button
                          type="button"
                          aria-label={`${category.name}包含哪些支出`}
                          aria-expanded={hintCategoryId === category.id}
                          onClick={() => {
                            setHintCategoryId((current) =>
                              current === category.id ? null : category.id,
                            );
                          }}
                          className="shrink-0 px-4 text-muted transition hover:text-brand-dark"
                        >
                          <InfoIcon />
                        </button>
                      ) : null}
                    </div>

                    {hintCategoryId === category.id && category.description ? (
                      <p className="px-4 pb-3 text-helper-relaxed text-muted">
                        {category.description}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <p className="text-helper text-muted">不选也可以保存，会记入「{UNCATEGORISED_LABEL}」。</p>
        </section>

        <section className="flex flex-col gap-2 px-6 pt-5">
          <h2 className="text-helper text-muted">支付方式</h2>
          <div className="flex flex-wrap gap-2">
            {paymentMethods.map((method) => (
              <button
                key={method.id}
                type="button"
                onClick={() => {
                  setPaymentMethodId(method.id === paymentMethodId ? null : method.id);
                }}
                className={`rounded-full px-4 py-2 text-sm transition ${
                  method.id === paymentMethodId
                    ? "bg-brand text-white"
                    : "bg-surface text-ink hover:bg-brand-soft"
                }`}
              >
                {method.name}
              </button>
            ))}
          </div>
        </section>

        {/*
          ⚠️ **币种与时间是「常用次级」，所以留在页面上，但不各占一整段。** 原来币种是六个胶囊
          （360px 上要折成两行），时间是另一个整段；现在合成一张两行的卡片，各自仍然是可编辑控件：
          币种是原生 select（手机上直接调起系统选择器），时间仍是 `datetime-local` 输入框。
          取值、精度与提交语义一个字没变。
        */}
        <section className="flex flex-col gap-2 px-6 pt-5">
          <div className="divide-y divide-line overflow-hidden rounded-field border border-line bg-surface">
            <div className="grid min-h-12 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 px-4">
              <label htmlFor="entry-currency" className="text-helper text-muted">
                币种
              </label>
              <select
                id="entry-currency"
                aria-label="币种"
                value={currency}
                onChange={(event) => {
                  setCurrency(event.target.value as Currency);
                }}
                className="min-h-11 w-full min-w-0 rounded-field bg-transparent px-2 text-right text-base text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset"
              >
                {CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {currencyName(code)}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid min-h-12 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 px-4">
              <label htmlFor="entry-time" className="text-helper text-muted">
                时间
              </label>
              <input
                id="entry-time"
                type="datetime-local"
                step="1"
                aria-label="时间"
                value={toDateTimeLocalValue(occurredAt)}
                onChange={(event) => {
                  const parsed = fromDateTimeLocalValue(event.target.value);
                  if (parsed) setOccurredAt(parsed);
                }}
                className="min-h-11 w-full min-w-0 rounded-field bg-transparent px-2 text-right text-base text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset"
              />
            </div>
          </div>

          {/*
            精度提示只在真的需要时出现（目前只有日元是 0 位小数）。原来它常驻两行，
            讲的却是大多数币种用不上的事。
          */}
          {decimalsFor(currency) === 0 ? (
            <p className="text-helper-relaxed text-muted">
              {currencyName(currency)}不保留小数，金额按整数记录。
            </p>
          ) : null}
        </section>

        {/*
          备注与标签收进「更多选项」：默认收起，展开后与原来的字段完全一致
          （备注 200 字上限、标签 10 个上限、选中颜色都不变）。组件只负责显示，
          `moreOpen`、`note` 与 `tagIds` 仍由本页持有——保存时读到的还是同一份状态。
        */}
        <EntryMoreOptions
          open={moreOpen}
          onToggle={() => {
            setMoreOpen((open) => !open);
          }}
          note={note}
          onNoteChange={setNote}
          tags={tags}
          selectedTagIds={tagIds}
          onToggleTag={(tagId) => {
            setTagIds((current) =>
              current.includes(tagId)
                ? current.filter((id) => id !== tagId)
                : current.length >= MAX_TAGS_PER_TRANSACTION
                  ? current
                  : [...current, tagId],
            );
          }}
        />

        {/*
          ⚠️ **保存是滚动的终点，而不是另一次滑动。** 行动条粘在滚动区底部：它在文档流里
          （最后一块内容不会被永久盖住），底部与 BottomNav 的上沿相接，软键盘弹出时整条抬起。
          校验错误与共享账本只读提示也放在这里——点了保存就该在原地看到原因。
        */}
        <EntrySaveBar scrollRef={scrollRef}>
          {sharedOfflineReadOnly ? (
            <div className="pb-3">
              <Alert>
                当前离线，共享账本暂时只能查看。恢复网络后可以继续记账；之前尚未同步的改动会保留。
              </Alert>
            </div>
          ) : null}
          {error ? (
            <div className="pb-3">
              <Alert>{error}</Alert>
            </div>
          ) : null}
          <button
            type="submit"
            disabled={sharedOfflineReadOnly || createEntry.isPending || amountText.trim() === ""}
            className="w-full rounded-field bg-brand py-3.5 text-button-lg font-medium text-white transition hover:bg-brand-dark disabled:opacity-45"
          >
            {createEntry.isPending ? "保存中…" : "保存"}
          </button>
        </EntrySaveBar>
      </form>
    </TabPage>
  );
}

/** The form fields a new entry starts from, once its moment is known. */
export interface NextEntryFields {
  readonly amountText: string;
  readonly note: string;
  readonly tagIds: readonly string[];
  readonly occurredAt: Date;
}

/**
 * What "再记一笔" puts the form back into.
 *
 * The date is part of the reset, like the amount and the note: it is the moment
 * the button was pressed, never the moment of the entry just saved. `now` is an
 * argument rather than a call to the clock inside, so this rule can be asserted
 * in a test without a browser — the same reason `draftOf` in the scan screen is
 * a free function.
 */
export function nextEntryFields(now: Date): NextEntryFields {
  return { amountText: "", note: "", tagIds: [], occurredAt: now };
}
