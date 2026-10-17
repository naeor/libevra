import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { BookIdentityCard, BookSwitcherSheet } from "../components/BookSwitcherSheet.js";
import { Button } from "../components/Button.js";
import { InnerPage } from "../components/Layouts.js";
import { SkeletonRows } from "../components/States.js";
import { errorMessage } from "../lib/api.js";
import { useBooks, useLedgerMeta } from "../lib/queries.js";

/**
 * **账本详情 —— `/books/:bookId`。**
 *
 * ⚠️ **`bookId` 在地址里，所以刷新和深链都能回答"这是哪一本账"。** 这是 S13-E 的核心一条：
 * 以前的 `/start/book/:id` 与 `/ledger/info` 一个靠 URL、一个靠全局"当前账本"，两套语义；
 * 现在只有一个：**地址说什么就是什么。**
 *
 * ⚠️ **这一页只读，而且绝不改全局当前账本。** 数据只走 `useLedgerMeta(bookId)`（无副作用，
 * 见那个 hook 的注释）与 `useBooks()`（角色、成员数）。**不要在这一页调用 `useLedger()`** ——
 * 它会把设备搬进这本账（`setCurrentBook` / `setOfflineBook`），而这本账可能只是被点开看一眼。
 *
 * ⚠️ **换一本看，只换地址。** 「切换」打开 `BookSwitcherSheet`，选中后 `navigate(..., { replace: true })`
 * 换掉 URL 里的 id：不 `enterLedger`、不写 `currentBook`、不动离线作用域。
 *
 * ⚠️ **目标不存在/无权访问时，明确说清楚并给出两个出口**（返回账本空间 / 选其他账本），
 * **不静默回落到当前账本** —— 那会让用户以为自己打开的是 A 账，实际看到的是 B 账。
 */
export function BookDetailPage(): React.JSX.Element {
  const { bookId = "" } = useParams<{ bookId: string }>();
  const meta = useLedgerMeta(bookId);
  const books = useBooks();
  const navigate = useNavigate();
  const [switcher, setSwitcher] = useState(false);

  /**
   * ⚠️ **`useBooks()` is the fallback for the identity line only**, so a ledger that exists but
   * cannot be read (disposed, or no longer a member) still shows *which* ledger it was. **The
   * facts below are never built from it** — counts come from the server's metadata answer.
   */
  const row = books.data?.books.find((book) => book.id === bookId);
  const name = meta.data?.book.name ?? row?.name ?? null;
  const bookNumber = meta.data?.book.bookNumber ?? row?.bookNumber ?? null;
  const memberCount = meta.data?.book.memberCount ?? row?.memberCount;
  const stats = meta.data?.stats;

  return (
    <InnerPage title="账本详情" backTo="/start">
      {meta.isPending ? <SkeletonRows rows={4} /> : null}

      {meta.isSuccess ? (
        <>
          <BookIdentityCard
            bookId={bookId}
            name={name ?? ""}
            bookNumber={bookNumber}
            memberCount={memberCount}
            onSwitch={() => {
              setSwitcher(true);
            }}
          />

          <section className="flex flex-col gap-2">
            <h2 className="px-1 text-helper text-muted">这本账的资料</h2>

            <dl className="overflow-hidden rounded-card border border-line bg-surface">
              {memberCount === undefined ? null : <FactRow label="成员数量" value={`${String(memberCount)} 人`} />}
              {stats === undefined ? null : (
                <>
                  <FactRow label="创建日期" value={stats.createdAt.slice(0, 10)} />
                  <FactRow label="账目数量" value={`${String(stats.transactionCount)} 笔`} />
                  <FactRow label="编辑记录" value={`${String(stats.eventCount)} 条`} />
                </>
              )}
            </dl>

            <p className="px-1 text-helper-relaxed text-muted">
              这些数字来自服务器，只用于认出这本账；收支合计不在这里，见「分析」。
            </p>
          </section>

          {/**
            * ⚠️ **One entry row into the management screen, and it carries `bookId` with it.**
            * The arrow is real: this row navigates. Nothing else on this page pretends to.
            */}
          <button
            type="button"
            onClick={() => {
              void navigate(`/books/${bookId}/settings`);
            }}
            className="flex w-full items-center justify-between gap-4 rounded-card border border-line bg-surface px-5 py-4 text-left transition hover:bg-canvas"
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-body text-ink">账本设置</span>
              <span className="text-helper text-muted">管理账本资料、分类、标签和支付方式</span>
            </span>
            <span aria-hidden="true" className="shrink-0 text-muted">
              ›
            </span>
          </button>

          <Link to="/start" className="text-body text-brand transition hover:text-brand-dark">
            前往账本空间 ›
          </Link>
        </>
      ) : null}

      {/**
        * ⚠️ **A failed read is a state of its own, not an empty page.** Two things must be possible
        * from here: go back, or pick another ledger. **Nothing falls back to the current ledger** —
        * see the note at the top of this file.
        */}
      {meta.isError ? (
        <section className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-medium text-ink">打不开这本账</h2>
            <p role="alert" className="text-body-relaxed text-muted">
              {errorMessage(meta.error)}
            </p>
            <p className="text-helper-relaxed text-muted">
              它可能已经被弃置，或者你已经不在其中。这一页不会自动换成你当前的账本。
            </p>
          </div>

          {name === null ? null : (
            <BookIdentityCard
              bookId={bookId}
              name={name}
              bookNumber={bookNumber}
              memberCount={memberCount}
              onSwitch={() => {
                setSwitcher(true);
              }}
            />
          )}

          <div className="flex flex-col gap-2">
            <Button
              onClick={() => {
                void navigate("/start");
              }}
            >
              返回账本空间
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setSwitcher(true);
              }}
            >
              选择其他账本
            </Button>
          </div>
        </section>
      ) : null}

      {/**
        * ⚠️ **Switch means: change the id in the URL and the sheet closes.** `replace` rather than
        * push, so flipping through five ledgers does not leave five entries in the back stack —
        * the back control belongs to the page, not to every ledger looked at on the way here.
        */}
      <BookSwitcherSheet
        open={switcher}
        currentTargetId={bookId}
        purpose="view"
        onClose={() => {
          setSwitcher(false);
        }}
        onSelect={(nextId) => {
          setSwitcher(false);
          void navigate(`/books/${nextId}`, { replace: true });
        }}
      />
    </InnerPage>
  );
}

/** One read-only fact — label left, value right, **and no arrow**, because nothing happens here. */
function FactRow({ label, value }: { readonly label: string; readonly value: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5 last:border-b-0">
      <dt className="text-body text-muted">{label}</dt>
      <dd className="text-body text-ink">{value}</dd>
    </div>
  );
}
