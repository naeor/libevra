import { Link, Navigate, useLocation, useParams } from "react-router";

import { InnerPage } from "../components/Layouts.js";
import { useLedger } from "../lib/queries.js";

/**
 * **旧地址的兼容层（S13-E）—— 只做一件事：把地址换成带 `bookId` 的新地址。**
 *
 * ⚠️ **S13-E 的规则是"账本 id 必须在 URL 里"**：刷新、深链、返回都能重新回答"这是哪一本账"。
 * 旧地址（`/categories`、`/payment-methods`、`/tags`、`/ledger/info`）表达的是**当前账本**，
 * 所以它们唯一的任务是**问出当前账本是哪一本，然后重定向**——不渲染第二个页面，也不在旧地址上
 * 再维护一份功能。所有者 2026-10-17 的答复（Q3）是旧路径**暂时兼容**，暂定维持到 2026-12-31。
 *
 * ⚠️ **这里是全项目允许调用 `useLedger()` 的地方之一，而且必须是它。** `useLedger` 会写下
 * "设备正在哪本账里"（`setCurrentBook` / `setOfflineBook`），这正是"当前账本"这个旧语义的全部内容；
 * 目标账本的页面（`BookDetailPage` / `BookSettingsPage`）**恰恰不能调用它**，否则用户只是想看一眼
 * B 账，设备却悄悄搬进了 B 账——那是 1.10.08 明令禁止的。两个方向，两个 hook，不要互换。
 */

/** 读取中：一句静态文字，比一块骨架更诚实——这一屏本来就不会停留。 */
function Loading(): React.JSX.Element {
  return (
    <main className="flex min-h-full items-center justify-center text-body text-muted">正在打开账本……</main>
  );
}

/**
 * **没有当前账本时的出口。**
 *
 * ⚠️ **不能静默落到别处，也不能假装成功。** `/categories` 在没有当前账本时无从谈起"哪一本账的
 * 分类"，所以这里给出原因和唯一有用的下一步（去账本空间选一本）。
 */
function NoCurrentBook(): React.JSX.Element {
  return (
    <InnerPage title="还没有当前账本" backTo="/start">
      <p className="text-body-relaxed text-muted">
        这个入口管理的是「当前账本」的分类、标签或支付方式。先选一本账本进去，再回来就能用了。
      </p>
      <Link
        to="/start"
        className="inline-flex self-start rounded-field bg-brand px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-dark"
      >
        去账本空间
      </Link>
    </InnerPage>
  );
}

/**
 * **当前账本的旧地址 → 带 id 的新地址。**
 *
 * `tail` 是新地址在账本 id 之后的部分：`/categories` 传 `"/settings/categories"`，
 * `/ledger/info` 不传（它就是账本详情）。
 */
export function CurrentBookRedirect({ tail = "" }: { readonly tail?: string }): React.JSX.Element {
  const ledger = useLedger();

  if (ledger.isPending) return <Loading />;
  /** ⚠️ 未登录由 `RequireAuth` 拦在外面；到这里失败就只有"没有可用的账本"这一种解释。 */
  if (!ledger.isSuccess) return <NoCurrentBook />;

  return <Navigate to={`/books/${ledger.data.book.id}${tail}`} replace />;
}

/**
 * **`/start/book/:bookId` → `/books/:bookId`（S13-E 的地址迁移）。**
 *
 * ⚠️ **`?rename=1` 必须跟着走**：齿轮面板的「重命名」就是靠这个参数让设置页一打开就弹输入框
 * （见 `BookManageSheet`）。把它丢在重定向里的结果，是用户点了重命名却到了一个什么都不发生的页面。
 *
 * ⚠️ **只做替换（`replace`），不压历史**：否则浏览器返回会落在旧地址上，再被重定向回新地址，
 * 返回键看起来"按不动"。
 */
export function StartBookRedirect(): React.JSX.Element {
  const { bookId = "" } = useParams<{ bookId: string }>();
  const { search } = useLocation();

  /** 没有 id 的地址不存在，兜到账本空间好过兜到首页（用户本来就是从那里来的）。 */
  if (bookId === "") return <Navigate to="/start" replace />;

  const rename = new URLSearchParams(search).get("rename") === "1";
  const target = rename ? `/books/${bookId}/settings${search}` : `/books/${bookId}`;

  return <Navigate to={target} replace />;
}
