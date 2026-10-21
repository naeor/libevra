import {
  DUPLICATE_SCOPE_LABELS,
  MAX_TAGS_PER_TRANSACTION,
  decimalsFor,
  describeDuplicateMatch,
  type CreateTransactionInput,
  type Currency,
  type DuplicatePairResult,
  type Transaction,
  type TransactionKind,
} from "@libellum/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { Alert } from "../components/Alert.js";
import { ChoiceDialog, type Choice } from "../components/ChoiceDialog.js";
import { useDuplicateDetectionSettings } from "../components/DuplicateDetectionSettings.js";
import { EntrySaved } from "../components/EntrySaved.js";
import { AmountField } from "../components/entry/AmountField.js";
import { CurrencySheet } from "../components/entry/CurrencySheet.js";
import { EntryMoreOptions } from "../components/entry/EntryMoreOptions.js";
import { EntryQuickActions } from "../components/entry/EntryQuickActions.js";
import { EntrySaveBar } from "../components/entry/EntrySaveBar.js";
import { inheritFromLastEntry, type InheritRefusal } from "../components/entry/inheritLast.js";
import { ChevronIcon } from "../components/Icons.js";
import { InfoIcon } from "../components/InfoHint.js";
import { TabPage } from "../components/Layouts.js";
import { errorMessage } from "../lib/api.js";
import { currentBookId } from "../lib/currentBook.js";
import {
  fromDateTimeLocalValue,
  localTimeZone,
  toDateTimeLocalValue,
  toLocalDate,
  toLocalIso,
} from "../lib/datetime.js";
import { currencyName, minorToInput, parseAmountInput } from "../lib/format.js";
import { createNotDuplicateRelations, notDuplicateConfirmationForEntry } from "../lib/notDuplicateRelations.js";
import { createEntry as createLocally, localEntry } from "../lib/offline/write.js";
import { useSharedLedgerOfflineReadOnly } from "../lib/offline/writePolicy.js";
import {
  useCheckDuplicates,
  useCreateTransaction,
  useLedger,
  useQuickAmounts,
  useTransactions,
} from "../lib/queries.js";
import { uuidV7 } from "../lib/uuid.js";

/** Shown when there is nothing to inherit and nothing named 其他 to fall back on. */
const UNCATEGORISED_LABEL = "暂无分类";
const DEFAULT_PAYMENT_METHOD_NAME = "其他";

/**
 * 手动记账的轻提醒选项。
 *
 * 与拍照页的四个选项相比少一个「删掉旧的」：手动记账时用户刚才是**在输入**，不是在核对一张
 * 识别结果；此刻更常见的意图是“我记错了，回去改”。删除旧账目仍然可以到明细页用现有软删除。
 */
export const MANUAL_DUPLICATE_CHOICES: readonly Choice<"save" | "confirmNotDuplicate" | "cancel">[] = [
  { id: "save", label: "仍然保存", hint: "两笔都留下（也许是两次一样的消费）", primary: true },
  { id: "confirmNotDuplicate", label: "确认不是同一笔", hint: "两笔都留，并记住这一对：以后不再提示" },
  { id: "cancel", label: "取消，我再看看", dismissive: true },
];

/**
 * 提醒正文。与拍照页共用 `describeDuplicateMatch`，所以“哪些字段相同”永远来自实际命中的规则。
 */
export function manualDuplicateDescription(pending: {
  readonly existing: readonly Transaction[];
  readonly pairs: readonly DuplicatePairResult[];
  readonly scope: "server" | "local";
}): string {
  const first = pending.pairs[0];
  const basis = first === undefined ? "金额、收支方向和时间与已有账目相符。" : describeDuplicateMatch(first);
  const count = pending.existing.length > 1 ? `共找到 ${String(pending.existing.length)} 笔相似记录。` : "";
  const scopeNote = pending.scope === "local" ? `本次只比对了${DUPLICATE_SCOPE_LABELS.local}。` : "";
  return `${basis}${count}${scopeNote}`;
}

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
   * 写之前先问一句（S15-E4）：手动记账**轻提醒**，不进入分组核对页。
   *
   * ⚠️ 规则与设置全部来自统一核心（`useCheckDuplicates` → `checkNewCandidates`），
   * 这里只决定“问不问、怎么问”。检测失败不阻止写入——提醒是礼貌，不是关卡。
   */
  const checkDuplicates = useCheckDuplicates();
  const duplicateSettings = useDuplicateDetectionSettings();
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
  /**
   * 币种面板是否打开。
   *
   * ⚠️ **第三轮：币种从"金额下方独立一行"搬到金额框右侧。** 它不再是常驻字段，
   * 而是一个按需打开的选择器；打开与否只影响面板可见性，`currency` 的读写路径没有变。
   */
  const [currencyOpen, setCurrencyOpen] = useState(false);
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
   * 疑似重复时挂起的那一笔：**先不写**，等用户决定。
   *
   * ⚠️ 保存的 id 已经在进对话框之前生成并留在 `input` 里，所以「仍然保存」「确认不是同一笔」
   * 两次选择写的是**同一条记录**（同一个 `id` = `idempotencyKey`），不会因为重试多出一笔。
   */
  const [pendingDuplicate, setPendingDuplicate] = useState<{
    readonly input: CreateTransactionInput;
    readonly amountCents: number;
    readonly existing: readonly Transaction[];
    readonly pairs: readonly DuplicatePairResult[];
    readonly scope: "server" | "local";
  } | null>(null);
  /** 本地写入进行中；与检测中的状态一起锁住保存按钮。 */
  const [writing, setWriting] = useState(false);

  /** 保存按钮的忙碌态：检测、写入、或正在等待用户回答“像不像”。 */
  const busy = writing || checkDuplicates.isPending || createEntry.isPending || pendingDuplicate !== null;

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

    /**
     * ⚠️ **The id and the idempotency key are the same value, minted here — once.**
     *
     * That is what lets the entry exist — and be shown — before the server has ever heard of it, and it
     * is what makes a replayed upload harmless: the server's `idempotency_key` is unique, so the second
     * delivery finds the row it already made.
     *
     * ⚠️ **Minted before the duplicate question, not after.** The dialog may be cancelled and the entry
     * saved later, or saved twice; both paths must write the **same** entry, so the id cannot be created
     * inside the write call.
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

    /**
     * 手动记账的**轻提醒**（S15-E4）：像不像，一句话问；不像就直接写。
     *
     * ⚠️ 检测失败一律静默放行：拿不到提醒不是丢掉一笔账的理由。数据范围由
     * `found.scope` 说明——离线时只比对了本机已知记录。
     */
    try {
      const found = await checkDuplicates.mutateAsync({
        kind,
        amountCents,
        currency,
        occurredAt: input.occurredAt,
        occurredLocalDate: input.occurredLocalDate,
        /** `HH:mm`：旧接口的形状；统一核心只认 `occurredAt` 的秒级偏移时间。 */
        occurredTime: input.occurredAt.slice(11, 16),
        categoryId,
        paymentMethodId,
        note: input.note ?? undefined,
        tagIds,
        settings: duplicateSettings.settings,
      });

      if (found.history.length > 0) {
        setPendingDuplicate({
          input,
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

    await write(input);
  }

  /**
   * 真正写入。`notDuplicateWith` 只有在用户选了「确认不是同一笔」时非空，
   * 「仍然保存」永远传空——保存两笔相似账目是正当操作，不构成“它们不是同一笔”的证据。
   */
  async function write(
    input: CreateTransactionInput,
    notDuplicateWith: readonly string[] = [],
  ): Promise<void> {
    setWriting(true);
    try {
      let entry: Transaction;
      try {
        const outcome = await createLocally(input, localEntry(input, ledger.data));
        entry = outcome.entry;
      } catch (caught) {
        /**
         * ⚠️ **Falling back to the local write when the server refuses.**
         *
         * A 5xx or a dropped connection is not a reason to lose what the user typed. The write goes to the
         * device and the queue, and reaches the server when it can — which is the whole point of this round.
         * The retry uses the **same** `id`/`idempotencyKey`: a new one would create a second entry for the
         * same money if the first request had in fact reached the server.
         */
        try {
          const outcome = await createLocally(input, localEntry(input, ledger.data));
          entry = outcome.entry;
        } catch {
          setError(errorMessage(caught));
          return;
        }
      }

      /**
       * ⚠️ **A locally stored entry is still a saved entry.**
       *
       * The screen shows its success state either way, because the user's entry *is* recorded — on the
       * device. The only difference is the marker the ledger puts on the row: **silently reporting a write
       * that has not left the device is how somebody loses spending they believe they recorded.**
       */
      setSaved(entry);
      setPendingDuplicate(null);

      /**
       * S15-E3/E4: 「确认不是同一笔」写入关系记忆。放在写入**之后**，因为关系要指向真实存在的
       * 交易 id；失败也只说“没记住”，绝不说“没保存”。
       */
      if (notDuplicateWith.length > 0) {
        try {
          const bookId = ledger.data?.book.id ?? currentBookId();
          if (bookId === null) throw new Error("找不到当前账本，无法记录「不是同一笔」。");
          const confirmation = notDuplicateConfirmationForEntry(notDuplicateWith, entry.id);
          if (confirmation === null) throw new Error("没有可记录的交易对。");
          await createNotDuplicateRelations(bookId, confirmation);
        } catch (caught) {
          setError(`这笔账已保存，但「不是同一笔」没有记住：${errorMessage(caught)}`);
        }
      }
    } finally {
      setWriting(false);
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
    <TabPage
      active="/add"
      onNavigate={(to) => void navigate(to)}
      scrollRef={scrollRef}
      /**
       * ⚠️ **第四轮：让表单撑满滚动视口，并把 `TabPage` 的 `pb-24` 让给保存条自己。**
       *
       * `pb-24`（96px）是第一轮给"抬起的 +"预留的尾部空白。它有两个后果：内容短于一屏时
       * 保存条落在内容之后、离底栏还很远；内容长时滚到底部保存条又会突然抬升 96px。
       * 第四轮把保存条改成 `sticky bottom-0`（贴着底栏、靠 z 序让 + 压在上面），
       * 尾部那段空白不再需要——这里用 `pb-0!` 只覆盖**本页**（`className` 是 `TabPage`
       * 的既有入口，没有改 `Layouts.tsx`）。
       *
       * `min-h-full` + 表单 `flex-1` 让内容短时表单仍然铺满滚动区，保存条才会始终贴住
       * 底栏；长内容时 `flex-1` 的 `min-height:auto` 不会压缩表单，滚动行为不变。
       */
      className="min-h-full pb-0!"
    >
      <form
        className="flex flex-1 flex-col"
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
            ⚠️ **S15-C 第三轮：金额卡右侧的币种从"一句说明"变成"一个入口"。**
            同时删掉了金额旁那行提示——金额框本来就是全屏最显眼的输入框，
            那行字没有让任何人多记一笔，只占了一行高度。
          */}
          <h2 className="pb-2 text-helper text-muted">金额</h2>

          <AmountField
            amountText={amountText}
            currency={currency}
            currencyOpen={currencyOpen}
            inputRef={amountRef}
            onAmountChange={setAmountText}
            onOpenCurrency={() => {
              setCurrencyOpen(true);
            }}
          />

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

          {/* 币种面板：选中即写回 `currency`，金额文本与精度规则一个字不动。 */}
          <CurrencySheet
            open={currencyOpen}
            currency={currency}
            onSelect={(next) => {
              setCurrency(next);
            }}
            onClose={() => {
              setCurrencyOpen(false);
            }}
          />
        </section>

        {/*
          ⚠️ **The rest of the form starts here.** The old markup continued a single header past the amount, so
          everything below was inside the white-on-green block; it now sits on the page background, where
          ordinary fields belong.

          S15-C 的排列顺序按真实手机重排（第二轮再收一轮，第三轮把币种并入金额卡）：
          支出/收入 → 金额（右侧币种入口）→ 一行快捷操作（沿用上一笔｜快捷金额）→ 分类 →
          时间一行 → 更多选项（支付方式、备注、标签）→ 底部粘性保存条。
          高频核心在前，常用次级合并，低频收起。
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
              {/* 与币种、快捷金额、更多选项同一个 Chevron：同一个 SVG，展开时旋转 180°。 */}
              <ChevronIcon up={categoryOpen} className="text-muted" />
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
        </section>

        {/*
          ⚠️ **时间仍是独立、可编辑的一行**（S15-C 第三轮）。币种已经并入金额卡，
          这一张卡不再需要分两行，因此去掉了 `divide-y` 与币种那一行；`datetime-local`
          控件、`occurredAt` / `occurredAtTouched` 的语义与第一轮完全相同。

          右侧对齐与上一轮一致：标签在左、值在右，整行最小 48px，手指好点。
        */}
        <section className="flex flex-col gap-2 px-6 pt-5">
          <div className="grid min-h-12 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-field border border-line bg-surface px-4">
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
          保存时读到的还是同一份状态。收起时那一行是**已填值 + 未填提示**的混排
          （`支付宝 · 有备注 · 2 个标签`；未填的那项用灰色字段名占位），
          所以沿用或复制进来的内容不用展开也看得见，还能看出这里剩下什么可填。
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
          ⚠️ **这一块弹性空白把保存条推到底部**（第四轮）。内容短于一屏时它吃掉多余高度，
          保存条因此仍贴住底栏；内容长时它是 0 高，保存条的 `mt-5` 仍给出同样的间距。
        */}
        <div aria-hidden="true" className="flex-1" />

        {/*
          ⚠️ **保存是滚动的终点，而不是另一次滑动。** 行动条粘在滚动区底部：它在文档流里
          （最后一块内容不会被永久盖住），下边缘与底部导航上沿重合（`bottom-0`）；
          抬起的 + 靠 z 序（导航 z-10 > 这条 z-0）压在保存条底部的空白垫上，不压按钮。
          软键盘弹出时整条抬起。校验错误与共享账本只读提示也放在这里——点了保存就该在原地看到原因。
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
            disabled={sharedOfflineReadOnly || busy || amountText.trim() === ""}
            className="w-full rounded-field bg-brand py-3.5 text-button-lg font-medium text-white transition hover:bg-brand-dark disabled:opacity-45"
          >
            {busy ? "保存中…" : "保存"}
          </button>
        </EntrySaveBar>
      </form>

      {/*
        ⚠️ **手动记账的提醒是“一句话”，不是分组核对页。** 手动记账一笔一笔来，用户手上
        就只有这一笔；把他送进批量界面反而更慢。选项与拍照页一致（仍然保存 / 确认不是同一笔 /
        取消），因为同一条规则在两个入口必须给出同样的选择。

        「仍然保存」不写关系记忆——两笔相似账目可能真的是两次消费，保存它们不构成“不是同一笔”。
      */}
      <ChoiceDialog
        open={pendingDuplicate !== null}
        title="这笔账好像已经记过了"
        description={pendingDuplicate === null ? "" : manualDuplicateDescription(pendingDuplicate)}
        choices={MANUAL_DUPLICATE_CHOICES}
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
          // "cancel": 表单原样留着，用户回到刚才的位置继续改。
        }}
      />
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
