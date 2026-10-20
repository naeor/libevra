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
import { EntryQuickActions } from "../components/entry/EntryQuickActions.js";
import { EntrySaveBar } from "../components/entry/EntrySaveBar.js";
import { inheritFromLastEntry, type InheritRefusal } from "../components/entry/inheritLast.js";
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
 * 「沿用上一笔」的三句失败提示。读者下一步不同，所以不合并成一句：
 * 空账本要去记第一笔，方向不对要切支出/收入，账本元数据没到要等一下。
 */
const INHERIT_REFUSAL_NOTICES: Record<InheritRefusal, string> = {
  "no-record": "这个账本还没有可沿用的记录。",
  "no-compatible": "还没有同方向的上一笔记录。",
  "ledger-unavailable": "分类与支付方式还没加载完，稍后再试。",
};

/** 成功沿用的一句确认：没有它，只沿用了币种或分类为空时看起来像没反应。 */
const INHERIT_DONE_NOTICE = "已沿用上一笔的分类、支付方式、币种与标签。";

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
   * 「更多选项」（支付方式、备注、标签）是否展开。
   *
   * ⚠️ **默认收起是 S15-C 的取舍**：这几项不是每笔都要填，却曾占着保存按钮上方两整段。
   * 收起不丢能力——展开后仍是原来的控件；这里只控制可见性。
   */
  const [moreOpen, setMoreOpen] = useState(false);
  /**
   * 快捷金额（五个按钮）是否展开。
   *
   * ⚠️ **第二轮同样默认收起**：它只在「金额是整笔账的常用值」时有用，而金额框本身
   * 才是每笔都要走的那一步。取值逻辑仍来自 `useQuickAmounts()`，这一项只控制可见性。
   */
  const [quickOpen, setQuickOpen] = useState(false);
  /** 「沿用上一笔」的结果提示；null 表示没点过或已重置。 */
  const [inheritNotice, setInheritNotice] = useState<string | null>(null);
  /** Which category's ⓘ explanation is open, if any. */
  const [hintCategoryId, setHintCategoryId] = useState<string | null>(null);
  const [paymentMethodId, setPaymentMethodId] = useState<string | null>(null);
  const [currency, setCurrency] = useState<Currency>("CNY");
  const [occurredAt, setOccurredAt] = useState(() => new Date());
  /**
   * Whether the reader has touched the 时间 field.
   *
   * ⚠️ **S15-C follow-up (2026-10-20): the field used to be decorative.** The submit
   * path read the clock unconditionally, so editing the time changed nothing on the
   * saved entry — while the comment above claimed the user's choice was kept. The
   * default is still "now at submit" (a mount-time value would go stale); the moment
   * the reader edits the field, their value has to win. `entryMoment` is the rule.
   */
  const [occurredAtTouched, setOccurredAtTouched] = useState(false);
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

  /**
   * 同方向的最近记录，只给「沿用上一笔」用。
   *
   * ⚠️ **Why a `kind`-filtered query and not the already-loaded `recent`.** 两者都带账本作用域
   * （`useTransactions` 的请求走当前账本，离线回退也只读当前账本的存储），区别在「最近一笔」的定义：
   * `recent` 是全方向的最新一页，**若最近几十条恰好都是收入，支出方向就会「找不到上一笔」**，
   * 而更早的支出其实存在。按 `kind` 过滤后，「跳过不兼容、继续找更早的」由同一套查询层完成
   * （服务器与本地回退共用 `filterLocally`），页面既不翻页也不需要新接口。
   *
   * 代价是多一个 list 查询（按方向缓存，最多两份），换来的是**方向兼容的最近一笔**而不是
   * 「最新一页里恰好有」。金额、备注、时间永远不从这里取。
   */
  const recentOfKind = useTransactions({ kind });

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
  // ⚠️ **自动默认值只覆盖分类、支付方式与币种**；金额、备注、时间从不自动继承。
  // 「沿用上一笔」是另一个入口（`inheritLast`）：由读者点击触发，带标签，但仍然不碰
  // 金额/备注/时间，也不改方向。两条路径都不在提交路径上偷偷带值。
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

  /**
   * 「沿用上一笔」：把同方向上一笔的分类、支付方式、币种与标签套到当前草稿。
   *
   * ⚠️ **纯表单状态操作。** 不创建账目、不写库、不碰离线队列——保存仍然只能由读者按「保存」
   * 触发。连续点多次的结果与点一次相同（`inheritFromLastEntry` 对同一份输入是幂等的）。
   *
   * ⚠️ **金额、备注、时间一个字都不动，方向也不改**：这正是它与「复制这一笔」的区别。
   * 选谁、跳过谁由 `inheritFromLastEntry` 决定，这里只把结果塞回 state 并给一句提示。
   */
  function inheritLast(): void {
    const outcome = inheritFromLastEntry(
      recentOfKind.data?.pages.flatMap((page) => page.items) ?? [],
      ledger.data,
      kind,
      { categoryId, paymentMethodId, currency, tagIds },
    );

    if (outcome.status === "nothing") {
      setInheritNotice(INHERIT_REFUSAL_NOTICES[outcome.reason]);
      return;
    }

    setCategoryId(outcome.fields.categoryId);
    setPaymentMethodId(outcome.fields.paymentMethodId);
    setCurrency(outcome.fields.currency);
    setTagIds([...outcome.fields.tagIds]);
    setInheritNotice(INHERIT_DONE_NOTICE);
  }

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
     * ⚠️ **An explicitly chosen time is untouched by this**, because `occurredAtTouched`
     * records that the reader edited the field, and `entryMoment` then returns their value
     * instead of the clock. Without that flag the paragraphs above were a promise the code
     * did not keep (S15-C follow-up, 2026-10-20).
     */
    const savedAt = entryMoment(occurredAt, occurredAtTouched, new Date());

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
          setOccurredAtTouched(next.occurredAtTouched);
          setMoreOpen(false);
          setQuickOpen(false);
          setInheritNotice(null);
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
                  // 上一笔是另一个方向的，沿用提示留着会指错对象。
                  setInheritNotice(null);
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

          {/*
            ⚠️ **一行放两个「局部快捷动作」**（S15-C 第二轮）：左边沿用上一笔，右边展开快捷金额。
            收起来不是删掉能力——五个金额按钮仍是 `useQuickAmounts()` 的那五个，
            点击仍写进同一个金额框；这一行只决定它们是否占版面。
          */}
          <EntryQuickActions
            amounts={quickAmounts}
            currency={currency}
            open={quickOpen}
            onToggle={() => {
              setQuickOpen((open) => !open);
            }}
            onPickAmount={(cents) => {
              setAmountText(minorToInput(cents, currency));
            }}
            onInherit={inheritLast}
            notice={inheritNotice}
          />
        </section>

        {/*
          ⚠️ **The rest of the form starts here.** The old markup continued a single header past the amount, so
          everything below was inside the white-on-green block; it now sits on the page background, where
          ordinary fields belong.

          S15-C 的排列顺序按真实手机重排（第二轮再收一轮）：支出/收入 → 金额 → 一行快捷操作
          （沿用上一笔｜快捷金额）→ 分类 → 币种与时间一条紧凑卡片 → 更多选项（支付方式、备注、标签）
          → 底部粘性保存条。高频核心在前，常用次级合并，低频收起。
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
                  if (parsed) {
                    setOccurredAt(parsed);
                    // From here on the field outranks the clock; see `entryMoment`.
                    setOccurredAtTouched(true);
                  }
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
          支付方式、备注与标签收进「更多选项」：默认收起，展开后与原来的字段完全一致
          （支付方式仍是那组胶囊、归档过滤与默认值不变；备注 200 字上限、标签 10 个上限、
          选中颜色都不变）。**支付方式不是账户**，它只是「这笔钱怎么付的」，两者不合并。
          组件只负责显示，`moreOpen`、`paymentMethodId`、`note` 与 `tagIds` 仍由本页持有——
          保存时读到的还是同一份状态。收起时那一行显示摘要（支付方式名 · 备注 · 标签），
          所以沿用或复制进来的内容不用展开也看得见。
        */}
        <EntryMoreOptions
          open={moreOpen}
          onToggle={() => {
            setMoreOpen((open) => !open);
          }}
          paymentMethods={paymentMethods}
          paymentMethodId={paymentMethodId}
          onPaymentMethodChange={setPaymentMethodId}
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

/**
 * Where `save` gets the moment it records.
 *
 * Two cases, and only two: **the reader edited 时间** → their value, exactly;
 * otherwise → the clock at submit, never the value captured when the screen
 * mounted. A free function so the rule can be asserted without a browser.
 */
export function entryMoment(chosen: Date, touched: boolean, now: Date): Date {
  return touched ? chosen : now;
}

/** The form fields a new entry starts from, once its moment is known. */
export interface NextEntryFields {
  readonly amountText: string;
  readonly note: string;
  readonly tagIds: readonly string[];
  readonly occurredAt: Date;
  /** False: the next entry starts on "now at submit" again. */
  readonly occurredAtTouched: boolean;
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
  return { amountText: "", note: "", tagIds: [], occurredAt: now, occurredAtTouched: false };
}
