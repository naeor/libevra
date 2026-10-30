/**
 * 工作区身份：「明细 · 家庭账本」。拖动分界线时的预览、恢复按钮、辅助区导航都用这一份。
 */
import { useI18n } from "../i18n/index.js";
import { useBooks, useLedger } from "../lib/queries.js";
import { useChosenLedger } from "../lib/workspaceLedger.js";
import { destinationOf } from "./follow.js";

export type PageKey = "entries" | "insights" | "ledger" | "me" | "add" | "detail" | "start" | "other";

export const START_PATH = "/workspace/start";

export function pageKeyFor(pathname: string): PageKey {
  if (pathname === START_PATH) return "start";
  if (pathname.startsWith("/transactions/")) return "detail";
  if (pathname === "/add" || pathname === "/scan" || pathname === "/record" || pathname === "/paste") return "add";
  return destinationOf(pathname) ?? "other";
}

const BOOK_PATH = /^\/books\/([^/]+)/;

/**
 * 页面名 + 这个工作区实际查看的账本名（`/books/:id` 系列看的是那一本，其余是这个工作区查看的账本）。
 *
 * @param chosen 这个工作区选的账本（`null` = 设备当前账本）；省略时读所在的 `ViewLedgerContext`。
 *   外壳控件（分界线预览、恢复按钮）不在工作区内部渲染，必须明确传入，不能拿另一侧的账本名。
 */
export function usePaneIdentity(pathname: string, chosen?: string | null): { readonly title: string; readonly book: string | null } {
  const { t } = useI18n();
  const context = useChosenLedger();
  const ledgerId = chosen === undefined ? context : chosen;
  const ledger = useLedger();
  const books = useBooks();
  const title = t(`workspace.pane.page.${pageKeyFor(pathname)}`);
  const match = BOOK_PATH.exec(pathname);
  if (match !== null) {
    const id = match[1];
    const book = books.data?.books.find((item) => item.id === id);
    return { title, book: book?.name ?? null };
  }
  if (ledgerId !== null) {
    const book = books.data?.books.find((item) => item.id === ledgerId);
    if (book !== undefined) return { title, book: book.name };
  }
  return { title, book: ledger.data?.book.name ?? null };
}
