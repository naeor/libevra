import { useState } from "react";
import { useNavigate, useParams } from "react-router";

import { BookIdentityCard, BookSwitcherSheet } from "../components/BookSwitcherSheet.js";
import { Button } from "../components/Button.js";
import { InnerPage } from "../components/Layouts.js";
import { FactRow, ListGroup, ListRow } from "../components/ui/List.js";
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

          {/**
            * ⚠️ **S16-A：资料是只读事实（`FactRow`），去处是可点的行（`ListRow`）——两组分开。**
            * 「占用空间」从账本页的「账本信息」卡片移到这里（那张卡片已并入账本页顶部）。
            */}
          <ListGroup
            as="dl"
            title="这本账的资料"
            footer="这些数字来自服务器，只用于认出这本账；收支合计不在这里，见「分析」。"
          >
            {memberCount === undefined ? null : <FactRow label="成员数量" value={`${String(memberCount)} 人`} />}
            {stats === undefined ? null : (
              <>
                <FactRow label="创建日期" value={stats.createdAt.slice(0, 10)} />
                <FactRow label="账目数量" value={`${String(stats.transactionCount)} 笔`} />
                <FactRow label="编辑记录" value={`${String(stats.eventCount)} 条`} />
                {/**
                  * ⚠️ **"约" stays.** An estimate shown beside three exact figures is read as exact,
                  * and somebody will eventually reconcile against it — see `estimateBytes`.
                  */}
                <FactRow
                  label="占用空间"
                  value={`约 ${formatBytes(estimateBytes(stats.transactionCount, stats.eventCount))}`}
                />
              </>
            )}
          </ListGroup>

          {/**
            * ⚠️ **One entry row into the management screen, and it carries `bookId` with it.**
            * The arrow is real: this row navigates. Nothing else on this page pretends to.
            */}
          <ListGroup>
            <ListRow
              label="账本设置"
              detail="管理账本资料、分类、标签和支付方式"
              onClick={() => {
                void navigate(`/books/${bookId}/settings`);
              }}
            />
            <ListRow label="前往账本空间" detail="切换、新建或整理全部账本" to="/start" />
          </ListGroup>
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

/**
 * A rough size for one ledger's rows.
 *
 * ⚠️ **Deliberately an estimate, and the constants are deliberately round.** PostgreSQL keeps table
 * bytes per table, not per owning ledger, so an exact answer means measuring each row's payload —
 * **real work for a figure nobody makes a decision with.**
 */
function estimateBytes(transactionCount: number, eventCount: number): number {
  return transactionCount * 1024 + eventCount * 512;
}

/** KB / MB, with one decimal — enough to see a change, not enough to imply precision. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
