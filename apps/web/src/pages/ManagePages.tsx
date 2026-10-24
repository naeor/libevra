import type {
  Category,
  ClassificationUsageResponse,
  PaymentMethod,
  Tag,
} from "@libellum/shared";
import { useState } from "react";
import { useParams } from "react-router";

import { Alert } from "../components/Alert.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { InnerPage } from "../components/Layouts.js";
import { SkeletonRows } from "../components/States.js";
import { errorMessage } from "../lib/api.js";
import { DEFAULT_TAG_COLOR, TAG_COLORS } from "../lib/tagColors.js";
import {
  useBookMembers,
  useCategoryMutations,
  useClassificationUsage,
  useLedger,
  useLedgerMeta,
  usePaymentMethodMutations,
  useTagMutations,
} from "../lib/queries.js";

/**
 * The three management screens.
 *
 * They share one rule, and the wording of their dialogs is where that rule
 * becomes visible to a person:
 *
 *   **A category or payment method is never destroyed — it is archived.**
 *   Entries from months ago still point at it, so it keeps its name in history
 *   and can be brought back at any time.
 *
 *   **A tag is destroyed, but nothing else is.** Entries keep every cent;
 *   they simply lose that label.
 *
 * Every destructive control asks first, and the safe option holds focus.
 *
 * ⚠️ **S13-E 之后这三页属于"账本"，不再属于"账户"**，所以每条路由都可以带 **可选** `bookId`
 * （`/books/:bookId/settings/categories` 等）。两种模式的区别只有三处，其余完全一样：
 *
 * | | 当前账本（旧地址 `/categories` 等） | 目标账本（`/books/:bookId/settings/...`） |
 * |---|---|---|
 * | 列表数据 | `useLedger()` | `useLedgerMeta(bookId)` |
 * | mutations | 不带 `bookId` | 带 `bookId` |
 * | 返回兜底 | `/me`（历史优先） | `/books/:bookId/settings` |
 *
 * ⚠️ **目标模式绝不能调用 `useLedger()`。** 它会把设备搬进那本账（`setCurrentBook` /
 * `setOfflineBook`），而"在账本设置里管理一本别人给的账"不应该改变你正在记的账。
 *
 * ⚠️ **这里只做"能管理目标账本"，不做删除影响提示 / 替换**（那是下一批）。所以创建、改名、
 * 归档、恢复、删除的现有交互一个字都没改——只是请求多了 `bookId`。
 */

/** 旧的 `/categories` 等地址从账户页进来，所以声明的父级仍是它（深链兜底）。 */
const CURRENT_BACK_TO = "/me";

/**
 * ⚠️ **The exact wording is pinned by `copy.test.ts`** ("归档后不再出现在记账选项中"), and the same
 * sentence is used for both modes — the target screen must not describe archiving differently.
 */
const CATEGORIES_HINT = "归档后不再出现在记账选项中。已有记录仍会显示该分类的名称，可随时恢复。";
const PAYMENT_METHODS_HINT = "记录款项的支付渠道。归档后不再出现在记账选项中，已有记录不受影响。";
const TAGS_HINT = "标签用于跨分类标注，例如「出差」「可报销」。每条记录最多添加 10 个标签。";

/** `名称（编号）` — the two facts that tell two similarly named ledgers apart. */
function describeBook(book: { readonly name: string; readonly bookNumber: string | null }): string {
  return book.bookNumber === null ? book.name : `${book.name}（${book.bookNumber}）`;
}

function AddRow({
  placeholder,
  onAdd,
  busy,
}: {
  readonly placeholder: string;
  readonly onAdd: (name: string) => Promise<void>;
  readonly busy: boolean;
}): React.JSX.Element {
  const [name, setName] = useState("");

  return (
    <form
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (trimmed === "") return;
        void onAdd(trimmed).then(() => {
          setName("");
        });
      }}
    >
      <input
        value={name}
        maxLength={20}
        placeholder={placeholder}
        onChange={(event) => {
          setName(event.target.value);
        }}
        className="flex-1 rounded-field border border-line bg-surface px-3.5 py-3 text-base text-ink outline-none placeholder:text-muted/80 focus:border-brand focus:ring-4 focus:ring-focus-ring"
      />
      <button
        type="submit"
        disabled={busy || name.trim() === ""}
        className="shrink-0 rounded-field bg-brand px-5 text-sm font-medium text-on-brand transition hover:bg-brand-dark disabled:opacity-45"
      >
        添加
      </button>
    </form>
  );
}

interface Archivable {
  readonly id: string;
  readonly name: string;
  readonly isArchived: boolean;
  /** Present only while this still carries the preset wording. */
  readonly description?: string | null | undefined;
}

function ArchivableList({
  items,
  busyId,
  onArchive,
  onRestore,
  onDelete,
  lockedIds = [],
  readOnly = false,
}: {
  readonly items: readonly Archivable[];
  readonly busyId: string | null;
  readonly onArchive: (item: Archivable) => void;
  readonly onRestore: (item: Archivable) => void;
  /**
   * **Permanent delete is a second action, not a stronger archive.** It asks again with the
   * affected-entry count and a replacement choice; see the dialogs below. `undefined` keeps a
   * screen read-only with respect to deletion.
   */
  readonly onDelete?: ((item: Archivable) => void) | undefined;
  readonly lockedIds?: readonly string[];
  /** ⚠️ Viewer: the server would 403 every write, so the controls are not offered at all. */
  readonly readOnly?: boolean;
}): React.JSX.Element {
  return (
    <ul className="overflow-hidden rounded-card border border-line bg-surface [&>*+*]:border-t [&>*+*]:border-line">
      {items.map((item) => {
        const locked = lockedIds.includes(item.id);
        const description = item.description ?? null;

        return (
          <li key={item.id}>
            <div className="flex items-center justify-between gap-4 px-5 py-3.5">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className={`text-sm ${item.isArchived ? "text-muted line-through" : "text-ink"}`}>
                  {item.name}
                </span>
                {/* The preset explanation, shown plainly here: this is the
                    screen somebody opens precisely to read them. */}
                {description ? (
                  <span className="text-helper-relaxed text-muted">{description}</span>
                ) : null}
                {locked ? <span className="text-helper text-muted">系统分类，不可修改</span> : null}
                {item.isArchived && !locked ? (
                  <span className="text-helper text-muted">已归档，历史记录仍显示</span>
                ) : null}
              </span>

              {readOnly ? null : (
                <span className="flex shrink-0 items-center gap-3">
                {locked ? null : item.isArchived ? (
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => {
                      onRestore(item);
                    }}
                    className="text-body text-brand-dark transition hover:underline disabled:opacity-45"
                  >
                    恢复
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => {
                      onArchive(item);
                    }}
                    className="text-body text-muted transition hover:text-ink disabled:opacity-45"
                  >
                    归档
                  </button>
                )}

                {locked || onDelete === undefined ? null : (
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => {
                      onDelete(item);
                    }}
                    className="text-helper text-danger transition hover:underline disabled:opacity-45"
                  >
                    永久删除
                  </button>
                )}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** The replacement chooser shared by the category and payment-method delete dialogs. */
function ReplacementSelect({
  label,
  value,
  onChange,
  options,
  fallbackLabel,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly { readonly id: string; readonly name: string }[];
  readonly fallbackLabel: string;
}): React.JSX.Element {
  return (
    <label className="mt-4 flex flex-col gap-1.5">
      <span className="text-helper text-muted">{label}</span>
      <select
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        /**
          * ⚠️ **`text-base`（16px），不是 `text-body`。** 与同页的新建输入框一致，也回到
          * `index.css` 的「表单控件不低于 16px」不变量（低于它时 iOS Safari 会放大整页）。
          * 下拉比文本框小一号是最容易被忽略的一种不一致——它不报错，只是不像同一个控件。
          */
        className="rounded-field border border-line bg-surface px-3.5 py-2.5 text-base text-ink outline-none focus:border-brand focus:ring-4 focus:ring-focus-ring"
      >
        <option value="">{fallbackLabel}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}

// ---------------------------------------------------------------------------
// 分类
// ---------------------------------------------------------------------------

/**
 * ⚠️ **The route decides the mode.** `/books/:bookId/settings/categories` has the parameter;
 * `/categories` does not — and the old address keeps working exactly as it did.
 */
export function CategoriesPage(): React.JSX.Element {
  const { bookId } = useParams<{ bookId?: string }>();

  return bookId === undefined ? <CategoriesForCurrentLedger /> : <CategoriesForBook bookId={bookId} />;
}

function CategoriesForCurrentLedger(): React.JSX.Element {
  const ledger = useLedger();
  const members = useBookMembers();
  const mutations = useCategoryMutations();
  const usage = useClassificationUsage();

  return (
    <CategoriesView
      categories={ledger.data?.categories ?? []}
      pending={ledger.isPending}
      isSuccess={ledger.isSuccess}
      backTo={CURRENT_BACK_TO}
      hint={CATEGORIES_HINT}
      shared={(ledger.data?.book.memberCount ?? 1) >= 2}
      canWrite={members.data?.myRole === "owner" || members.data?.myRole === "editor"}
      usage={usage.data}
      mutations={mutations}
    />
  );
}

function CategoriesForBook({ bookId }: { readonly bookId: string }): React.JSX.Element {
  const meta = useLedgerMeta(bookId);
  const members = useBookMembers(bookId);
  const mutations = useCategoryMutations(bookId);
  const usage = useClassificationUsage(bookId);

  return (
    <CategoriesView
      categories={meta.data?.categories ?? []}
      pending={meta.isPending}
      isSuccess={meta.isSuccess}
      backTo={`/books/${bookId}/settings`}
      subtitle={
        meta.isSuccess
          ? `正在管理「${describeBook(meta.data.book)}」`
          : meta.isError
            ? "读不到这本账。它可能已被弃置，或者你已经不在其中。"
            : "正在读取账本……"
      }
      hint={CATEGORIES_HINT}
      failure={meta.isError ? errorMessage(meta.error) : null}
      shared={(meta.data?.book.memberCount ?? 1) >= 2}
      canWrite={members.data?.myRole === "owner" || members.data?.myRole === "editor"}
      usage={usage.data}
      mutations={mutations}
    />
  );
}

function CategoriesView({
  categories: allCategories,
  pending,
  isSuccess,
  backTo,
  subtitle,
  hint,
  failure = null,
  shared,
  canWrite,
  usage,
  mutations,
}: {
  readonly categories: readonly Category[];
  readonly pending: boolean;
  readonly isSuccess: boolean;
  readonly backTo: string;
  readonly subtitle?: string;
  /** S16-A：页面用途的说明，放在列表下方（贴着它解释的操作），不再接在标题后面。 */
  readonly hint?: string;
  /** A target ledger that could not be read — stated, never silently replaced. */
  readonly failure?: string | null;
  /** A shared ledger must say that a delete/re-point affects every collaborator. */
  readonly shared: boolean;
  readonly canWrite: boolean;
  readonly usage: ClassificationUsageResponse | undefined;
  readonly mutations: ReturnType<typeof useCategoryMutations>;
}): React.JSX.Element {
  const { create, update, archive, permanentDelete } = mutations;

  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [pendingArchive, setPendingArchive] = useState<Archivable | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Category | null>(null);
  const [replacementId, setReplacementId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const categories = allCategories.filter((item) => item.kind === kind);
  const active = categories.filter((item) => !item.isArchived);
  const archived = categories.filter((item) => item.isArchived);
  const systemIds = categories.filter((item) => item.isSystem).map((item) => item.id);

  const deleteCount = pendingDelete === null ? 0 : (usage?.categories[pendingDelete.id] ?? 0);
  const replacementOptions =
    pendingDelete === null
      ? []
      : allCategories.filter(
          (item) =>
            item.kind === pendingDelete.kind &&
            !item.isArchived &&
            !item.isSystem &&
            item.id !== pendingDelete.id,
        );

  return (
    <InnerPage title="分类管理" {...(subtitle === undefined ? {} : { subtitle })} backTo={backTo}>
      {canWrite ? null : <Alert tone="info">你是这本账的查看者，只能查看分类，不能新增、改名、归档或删除。</Alert>}
      {error ? <Alert>{error}</Alert> : null}
      {notice === null ? null : <Alert tone="success">{notice}</Alert>}
      {failure === null ? null : <Alert>{failure}</Alert>}

      <div className="flex gap-2">
        {(["expense", "income"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              setKind(option);
            }}
            className={`flex-1 rounded-field py-2.5 text-sm font-medium transition ${
              kind === option ? "bg-brand text-on-brand" : "bg-surface text-muted"
            }`}
          >
            {option === "expense" ? "支出分类" : "收入分类"}
          </button>
        ))}
      </div>

      {pending ? <SkeletonRows rows={4} /> : null}

      {isSuccess ? (
        <>
          {canWrite ? <AddRow
            placeholder="新分类名称"
            busy={create.isPending}
            onAdd={async (name) => {
              setError(null);
              try {
                await create.mutateAsync({ name, kind });
              } catch (caught) {
                setError(errorMessage(caught));
              }
            }}
          /> : null}

          <ArchivableList
            items={active}
            readOnly={!canWrite}
            busyId={archive.isPending ? (pendingArchive?.id ?? null) : null}
            lockedIds={systemIds}
            onArchive={(item) => {
              setPendingArchive(item);
            }}
            onRestore={(item) => {
              void update.mutateAsync({ id: item.id, isArchived: false }).catch((caught: unknown) => {
                setError(errorMessage(caught));
              });
            }}
            onDelete={(item) => {
              setNotice(null);
              setReplacementId("");
              setPendingDelete(item as Category);
            }}
          />

          {hint === undefined ? null : <p className="px-1 text-helper-relaxed text-muted">{hint}</p>}

          {archived.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="px-1 text-helper text-muted">已归档（{String(archived.length)}）</h2>
              <ArchivableList
                items={archived}
                readOnly={!canWrite}
                busyId={update.isPending ? (pendingArchive?.id ?? null) : null}
                onArchive={() => undefined}
                onRestore={(item) => {
                  void update.mutateAsync({ id: item.id, isArchived: false }).catch((caught: unknown) => {
                    setError(errorMessage(caught));
                  });
                }}
                onDelete={(item) => {
                  setNotice(null);
                  setReplacementId("");
                  setPendingDelete(item as Category);
                }}
              />
            </section>
          ) : null}
        </>
      ) : null}

      <ConfirmDialog
        open={pendingArchive !== null}
        busy={archive.isPending}
        tone="default"
        title={`归档「${pendingArchive?.name ?? ""}」？`}
        description="归档不会删除任何数据。"
        consequences={[
          "它会从记账时的分类选项中消失",
          "已有的记录仍然显示这个分类的名字",
          "你随时可以在这里把它恢复",
        ]}
        confirmLabel="归档"
        onCancel={() => {
          setPendingArchive(null);
        }}
        onConfirm={() => {
          const target = pendingArchive;
          setPendingArchive(null);
          if (target) void archive.mutateAsync(target.id);
        }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        busy={permanentDelete.isPending}
        title={`永久删除「${pendingDelete?.name ?? ""}」？`}
        description={
          usage === undefined
            ? "正在统计受影响的记录……"
            : deleteCount === 0
              ? "目前没有在用这个分类的账目。删除后不可恢复。"
              : `有 ${String(deleteCount)} 笔记账正在使用这个分类。删除前请选择这些记录的处理方式。`
        }
        consequences={[
          "账目本身、金额与日期都不会改变",
          "这些记录会改用下方选择的分类（不选则使用「暂无分类」）",
          "删除后无法恢复这个分类",
          ...(shared ? ["这是共享账本，删除与替换会影响所有协作者看到的历史记录"] : []),
        ]}
        confirmLabel={permanentDelete.isPending ? "正在删除…" : "永久删除"}
        onCancel={() => {
          setPendingDelete(null);
        }}
        onConfirm={() => {
          const target = pendingDelete;
          if (target === null) return;
          setError(null);

          void permanentDelete
            .mutateAsync({
              id: target.id,
              ...(replacementId === "" ? {} : { replacementCategoryId: replacementId }),
            })
            .then((result) => {
              setPendingDelete(null);
              setReplacementId("");
              setNotice(
                `已删除「${target.name}」。${
                  result.affectedEntries === 0
                    ? "没有账目需要转移。"
                    : `${String(result.affectedEntries)} 笔记录已转入「${result.replacementName ?? "暂无分类"}」。`
                }`,
              );
            })
            .catch((caught: unknown) => {
              setError(errorMessage(caught));
            });
        }}
      >
        <ReplacementSelect
          label="这些历史记录改用哪个分类？"
          value={replacementId}
          onChange={setReplacementId}
          options={replacementOptions}
          fallbackLabel="使用「暂无分类」（推荐）"
        />
      </ConfirmDialog>
    </InnerPage>
  );
}

// ---------------------------------------------------------------------------
// 支付方式
// ---------------------------------------------------------------------------

export function PaymentMethodsPage(): React.JSX.Element {
  const { bookId } = useParams<{ bookId?: string }>();

  return bookId === undefined ? (
    <PaymentMethodsForCurrentLedger />
  ) : (
    <PaymentMethodsForBook bookId={bookId} />
  );
}

function PaymentMethodsForCurrentLedger(): React.JSX.Element {
  const ledger = useLedger();
  const members = useBookMembers();
  const mutations = usePaymentMethodMutations();
  const usage = useClassificationUsage();

  return (
    <PaymentMethodsView
      methods={ledger.data?.paymentMethods ?? []}
      pending={ledger.isPending}
      isSuccess={ledger.isSuccess}
      backTo={CURRENT_BACK_TO}
      hint={PAYMENT_METHODS_HINT}
      shared={(ledger.data?.book.memberCount ?? 1) >= 2}
      canWrite={members.data?.myRole === "owner" || members.data?.myRole === "editor"}
      usage={usage.data}
      mutations={mutations}
    />
  );
}

function PaymentMethodsForBook({ bookId }: { readonly bookId: string }): React.JSX.Element {
  const meta = useLedgerMeta(bookId);
  const members = useBookMembers(bookId);
  const mutations = usePaymentMethodMutations(bookId);
  const usage = useClassificationUsage(bookId);

  return (
    <PaymentMethodsView
      methods={meta.data?.paymentMethods ?? []}
      pending={meta.isPending}
      isSuccess={meta.isSuccess}
      backTo={`/books/${bookId}/settings`}
      subtitle={
        meta.isSuccess
          ? `正在管理「${describeBook(meta.data.book)}」`
          : meta.isError
            ? "读不到这本账。它可能已被弃置，或者你已经不在其中。"
            : "正在读取账本……"
      }
      hint={PAYMENT_METHODS_HINT}
      failure={meta.isError ? errorMessage(meta.error) : null}
      shared={(meta.data?.book.memberCount ?? 1) >= 2}
      canWrite={members.data?.myRole === "owner" || members.data?.myRole === "editor"}
      usage={usage.data}
      mutations={mutations}
    />
  );
}

function PaymentMethodsView({
  methods: allMethods,
  pending,
  isSuccess,
  backTo,
  subtitle,
  hint,
  failure = null,
  shared,
  canWrite,
  usage,
  mutations,
}: {
  readonly methods: readonly PaymentMethod[];
  readonly pending: boolean;
  readonly isSuccess: boolean;
  readonly backTo: string;
  readonly subtitle?: string;
  /** S16-A：页面用途的说明，放在列表下方（贴着它解释的操作），不再接在标题后面。 */
  readonly hint?: string;
  readonly failure?: string | null;
  readonly shared: boolean;
  readonly canWrite: boolean;
  readonly usage: ClassificationUsageResponse | undefined;
  readonly mutations: ReturnType<typeof usePaymentMethodMutations>;
}): React.JSX.Element {
  const { create, update, archive, permanentDelete } = mutations;

  const [pendingArchive, setPendingArchive] = useState<Archivable | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PaymentMethod | null>(null);
  const [replacementId, setReplacementId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = allMethods.filter((item) => !item.isArchived);
  const archived = allMethods.filter((item) => item.isArchived);

  const deleteCount = pendingDelete === null ? 0 : (usage?.paymentMethods[pendingDelete.id] ?? 0);
  const replacementOptions =
    pendingDelete === null
      ? []
      : allMethods.filter((item) => !item.isArchived && item.id !== pendingDelete.id);

  return (
    <InnerPage title="支付方式" {...(subtitle === undefined ? {} : { subtitle })} backTo={backTo}>
      {canWrite ? null : <Alert tone="info">你是这本账的查看者，只能查看支付方式，不能新增、改名、归档或删除。</Alert>}
      {error ? <Alert>{error}</Alert> : null}
      {notice === null ? null : <Alert tone="success">{notice}</Alert>}
      {failure === null ? null : <Alert>{failure}</Alert>}

      {pending ? <SkeletonRows rows={3} /> : null}

      {isSuccess ? (
        <>
          {canWrite ? <AddRow
            placeholder="新支付方式"
            busy={create.isPending}
            onAdd={async (name) => {
              setError(null);
              try {
                await create.mutateAsync({ name });
              } catch (caught) {
                setError(errorMessage(caught));
              }
            }}
          /> : null}

          <ArchivableList
            items={active}
            readOnly={!canWrite}
            busyId={archive.isPending ? (pendingArchive?.id ?? null) : null}
            onArchive={(item) => {
              setPendingArchive(item);
            }}
            onRestore={(item) => {
              void update.mutateAsync({ id: item.id, isArchived: false }).catch((caught: unknown) => {
                setError(errorMessage(caught));
              });
            }}
            onDelete={(item) => {
              setNotice(null);
              setReplacementId("");
              setPendingDelete(item as PaymentMethod);
            }}
          />

          {hint === undefined ? null : <p className="px-1 text-helper-relaxed text-muted">{hint}</p>}

          {archived.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="px-1 text-helper text-muted">已归档（{String(archived.length)}）</h2>
              <ArchivableList
                items={archived}
                readOnly={!canWrite}
                busyId={update.isPending ? (pendingArchive?.id ?? null) : null}
                onArchive={() => undefined}
                onRestore={(item) => {
                  void update.mutateAsync({ id: item.id, isArchived: false }).catch((caught: unknown) => {
                    setError(errorMessage(caught));
                  });
                }}
                onDelete={(item) => {
                  setNotice(null);
                  setReplacementId("");
                  setPendingDelete(item as PaymentMethod);
                }}
              />
            </section>
          ) : null}
        </>
      ) : null}

      <ConfirmDialog
        open={pendingArchive !== null}
        busy={archive.isPending}
        tone="default"
        title={`归档「${pendingArchive?.name ?? ""}」？`}
        description="归档不会删除任何数据。"
        consequences={[
          "它会从记账时的支付方式选项中消失",
          "已有的记录仍然显示这个支付方式",
          "你随时可以在这里把它恢复",
        ]}
        confirmLabel="归档"
        onCancel={() => {
          setPendingArchive(null);
        }}
        onConfirm={() => {
          const target = pendingArchive;
          setPendingArchive(null);
          if (target) void archive.mutateAsync(target.id);
        }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        busy={permanentDelete.isPending}
        title={`永久删除「${pendingDelete?.name ?? ""}」？`}
        description={
          usage === undefined
            ? "正在统计受影响的记录……"
            : deleteCount === 0
              ? "目前没有在用这个支付方式的账目。删除后不可恢复。"
              : `有 ${String(deleteCount)} 笔记账正在使用这个支付方式。删除前请选择这些记录的处理方式。`
        }
        consequences={[
          "账目本身、金额与日期都不会改变",
          "这些记录会改用下方选择的支付方式；不选则显示为「未指定」",
          "删除后无法恢复这个支付方式",
          ...(shared ? ["这是共享账本，删除与替换会影响所有协作者看到的历史记录"] : []),
        ]}
        confirmLabel={permanentDelete.isPending ? "正在删除…" : "永久删除"}
        onCancel={() => {
          setPendingDelete(null);
        }}
        onConfirm={() => {
          const target = pendingDelete;
          if (target === null) return;
          setError(null);

          void permanentDelete
            .mutateAsync({
              id: target.id,
              ...(replacementId === "" ? { replacementPaymentMethodId: null } : { replacementPaymentMethodId: replacementId }),
            })
            .then((result) => {
              setPendingDelete(null);
              setReplacementId("");
              setNotice(
                `已删除「${target.name}」。${
                  result.affectedEntries === 0
                    ? "没有账目需要转移。"
                    : result.replacementName === null
                      ? `${String(result.affectedEntries)} 笔记录已改为「未指定」。`
                      : `${String(result.affectedEntries)} 笔记录已改为「${result.replacementName}」。`
                }`,
              );
            })
            .catch((caught: unknown) => {
              setError(errorMessage(caught));
            });
        }}
      >
        <ReplacementSelect
          label="这些历史记录改用哪个支付方式？"
          value={replacementId}
          onChange={setReplacementId}
          options={replacementOptions}
          fallbackLabel="改为「未指定」"
        />
      </ConfirmDialog>
    </InnerPage>
  );
}

// ---------------------------------------------------------------------------
// 标签
// ---------------------------------------------------------------------------

/**
 * The swatches offered when creating a tag.
 *
 * They live in `lib/tagColors.ts`, not the chart palette: a tag colour is user
 * data saved as `#RRGGBB`, so it must not move when the theme changes. Chart
 * colours are a visual encoding and are now CSS tokens.
 */

export function TagsPage(): React.JSX.Element {
  const { bookId } = useParams<{ bookId?: string }>();

  return bookId === undefined ? <TagsForCurrentLedger /> : <TagsForBook bookId={bookId} />;
}

function TagsForCurrentLedger(): React.JSX.Element {
  const ledger = useLedger();
  const members = useBookMembers();
  const mutations = useTagMutations();
  const usage = useClassificationUsage();

  return (
    <TagsView
      tags={ledger.data?.tags ?? []}
      pending={ledger.isPending}
      backTo={CURRENT_BACK_TO}
      hint={TAGS_HINT}
      shared={(ledger.data?.book.memberCount ?? 1) >= 2}
      canWrite={members.data?.myRole === "owner" || members.data?.myRole === "editor"}
      usage={usage.data}
      mutations={mutations}
    />
  );
}

function TagsForBook({ bookId }: { readonly bookId: string }): React.JSX.Element {
  const meta = useLedgerMeta(bookId);
  const members = useBookMembers(bookId);
  const mutations = useTagMutations(bookId);
  const usage = useClassificationUsage(bookId);

  return (
    <TagsView
      tags={meta.data?.tags ?? []}
      pending={meta.isPending}
      backTo={`/books/${bookId}/settings`}
      subtitle={
        meta.isSuccess
          ? `正在管理「${describeBook(meta.data.book)}」`
          : meta.isError
            ? "读不到这本账。它可能已被弃置，或者你已经不在其中。"
            : "正在读取账本……"
      }
      hint={TAGS_HINT}
      failure={meta.isError ? errorMessage(meta.error) : null}
      shared={(meta.data?.book.memberCount ?? 1) >= 2}
      canWrite={members.data?.myRole === "owner" || members.data?.myRole === "editor"}
      usage={usage.data}
      mutations={mutations}
    />
  );
}

function TagsView({
  tags,
  pending,
  backTo,
  subtitle,
  hint,
  failure = null,
  shared,
  canWrite,
  usage,
  mutations,
}: {
  readonly tags: readonly Tag[];
  readonly pending: boolean;
  readonly backTo: string;
  readonly subtitle?: string;
  /** S16-A：页面用途的说明，放在列表下方（贴着它解释的操作），不再接在标题后面。 */
  readonly hint?: string;
  readonly failure?: string | null;
  readonly shared: boolean;
  readonly canWrite: boolean;
  readonly usage: ClassificationUsageResponse | undefined;
  readonly mutations: ReturnType<typeof useTagMutations>;
}): React.JSX.Element {
  const { create, remove } = mutations;

  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_TAG_COLOR);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const deleteCount = pendingDelete === null ? 0 : (usage?.tags[pendingDelete.id] ?? 0);

  return (
    <InnerPage title="标签" {...(subtitle === undefined ? {} : { subtitle })} backTo={backTo}>
      {canWrite ? null : <Alert tone="info">你是这本账的查看者，只能查看标签，不能新增或删除。</Alert>}
      {error ? <Alert>{error}</Alert> : null}
      {notice === null ? null : <Alert tone="success">{notice}</Alert>}
      {failure === null ? null : <Alert>{failure}</Alert>}

      {canWrite ? (
        <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
        <input
          value={name}
          maxLength={12}
          placeholder="新标签名称"
          onChange={(event) => {
            setName(event.target.value);
          }}
          className="rounded-field border border-line bg-surface px-3.5 py-3 text-base text-ink outline-none placeholder:text-muted/80 focus:border-brand focus:ring-4 focus:ring-focus-ring"
        />

        <div className="flex items-center gap-2">
          {TAG_COLORS.map((option) => (
            <button
              key={option}
              type="button"
              aria-label={`颜色 ${option}`}
              onClick={() => {
                setColor(option);
              }}
              style={{ backgroundColor: option }}
              className={`size-7 rounded-full transition ${
                color === option ? "ring-2 ring-ink ring-offset-2" : ""
              }`}
            />
          ))}
        </div>

        <button
          type="button"
          disabled={create.isPending || name.trim() === ""}
          onClick={() => {
            setError(null);
            void create
              .mutateAsync({ name: name.trim(), color })
              .then(() => {
                setName("");
              })
              .catch((caught: unknown) => {
                setError(errorMessage(caught));
              });
          }}
          className="w-full rounded-field bg-brand py-3 text-sm font-medium text-on-brand transition hover:bg-brand-dark disabled:opacity-45"
        >
          添加标签
        </button>
      </section>
      ) : null}

      {pending ? <SkeletonRows rows={3} /> : null}

      {tags.length > 0 ? (
        <ul className="overflow-hidden rounded-card border border-line bg-surface [&>*+*]:border-t [&>*+*]:border-line">
          {tags.map((tag) => (
            <li key={tag.id}>
              <div className="flex items-center justify-between gap-4 px-5 py-3.5">
                <span className="flex items-center gap-3">
                  <span style={{ backgroundColor: tag.color }} className="size-3 rounded-full" />
                  <span className="text-body text-ink">{tag.name}</span>
                </span>
                {canWrite ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPendingDelete({ id: tag.id, name: tag.name });
                    }}
                    className="shrink-0 text-body text-muted transition hover:text-danger"
                  >
                    删除
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {hint === undefined ? null : <p className="px-1 text-helper-relaxed text-muted">{hint}</p>}

      <ConfirmDialog
        open={pendingDelete !== null}
        busy={remove.isPending}
        title={`删除标签「${pendingDelete?.name ?? ""}」？`}
        description={
          usage === undefined
            ? "正在统计受影响的记录……"
            : deleteCount === 0
              ? "目前没有在用这个标签的账目。删除后不可恢复。"
              : `有 ${String(deleteCount)} 笔记账正在使用这个标签，删除后会解除这些关联。`
        }
        consequences={[
          "使用过这个标签的记账会失去该标签，账目本身完整保留",
          "删除后，你无法在应用里自行恢复这个标签",
          "如果需要，之后可以重新创建一个同名标签，但不会自动贴回原来的记账",
          ...(shared ? ["这是共享账本，删除会影响所有协作者看到的历史记录"] : []),
        ]}
        confirmLabel="确认删除"
        onCancel={() => {
          setPendingDelete(null);
        }}
        onConfirm={() => {
          const target = pendingDelete;
          if (target === null) return;
          setError(null);
          setPendingDelete(null);
          void remove
            .mutateAsync(target.id)
            .then((result) => {
              setNotice(
                `已删除标签「${target.name}」。${
                  result.affectedEntries === 0
                    ? "没有账目使用它。"
                    : `${String(result.affectedEntries)} 笔记录已解除该标签。`
                }`,
              );
            })
            .catch((caught: unknown) => {
              setError(errorMessage(caught));
            });
        }}
      />
    </InnerPage>
  );
}
