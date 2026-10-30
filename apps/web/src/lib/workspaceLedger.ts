/**
 * **S18：每个工作区自己的「查看账本」。**
 *
 * 大屏上两个工作区可以分别查看不同的账本（主区「我的账本」、辅助区「旅行账本」）。设备仍然只有一个
 * **当前账本**——离线副本、同步队列、请求头默认值都属于它；一个工作区查看的账本：
 *
 * - **就是当前账本**（`null` 或等于当前账本 id）→ 一切照旧，走原有离线优先的读写路径；
 * - **是另一本账**（「外部账本」）→ 这个工作区里的读取都带上这本账的 id（`x-libellum-book` 单次覆盖），
 *   结果放在独立的查询键 `["ws-ledger", 账本 id, …]` 下、不写进设备的离线副本；写入在线直接发往这本账，
 *   离线时明确拒绝（不会落进当前账本的本机队列）。服务器照常按这本账做成员与角色检查。
 *
 * ⚠️ **写入安全**：外部账本的创建、修改、删除、恢复都显式带这本账的 id；当前账本的写入仍走原有的离线
 * 队列，由当前账本作用域约束。两条路径各自只能写到自己显示的那本账。
 */
import type { CreateTransactionInput, Transaction, UpdateTransactionInput } from "@libellum/shared";
import { createContext, useContext, useSyncExternalStore } from "react";

import { t } from "../i18n/index.js";
import { apiFetch } from "./api.js";
import { currentBookId, subscribeCurrentBook } from "./currentBook.js";
import { useGuestMode } from "./guest/session.js";
import { isAccountOffline } from "./offline/connectivity.js";

/** 工作区选择查看的账本 id；`null` = 跟随设备当前账本。由工作区外壳提供，页面只读。 */
export const ViewLedgerContext = createContext<string | null>(null);

/** 外部账本查询键的前缀：不以 `transactions` / `summary` 开头，离线回退与当前账本的失效规则都碰不到它。 */
export const FOREIGN_KEY = "ws-ledger";

export function foreignKey(bookId: string, ...rest: readonly unknown[]): readonly unknown[] {
  return [FOREIGN_KEY, bookId, ...rest];
}

/** 两个值是否指向「外部账本」：选了一本账、而且不是设备当前账本（游客只有一本账，永远不是外部）。 */
export function foreignBookFor(chosen: string | null, current: string | null, guest: boolean): string | null {
  if (guest || chosen === null || chosen === "" || chosen === current) return null;
  return chosen;
}

/** 本工作区正在查看的外部账本 id；查看的就是当前账本时为 `null`。 */
export function useForeignBookId(): string | null {
  const chosen = useContext(ViewLedgerContext);
  const guest = useGuestMode();
  const current = useSyncExternalStore(subscribeCurrentBook, currentBookId, currentBookId);
  return foreignBookFor(chosen, current, guest);
}

/**
 * 只认「可选账本 id」的读写钩子用：调用方明确给了账本就用它；没给、而本工作区在看外部账本时用那本；
 * 否则 `undefined`（= 设备当前账本，原有行为一个字不变）。
 */
export function useScopedBook(given: string | undefined): string | undefined {
  const foreign = useForeignBookId();
  return given ?? foreign ?? undefined;
}

/** 本工作区实际查看的账本 id（外部账本，或设备当前账本）。 */
export function useViewBookId(): string | null {
  const foreign = useForeignBookId();
  const current = useSyncExternalStore(subscribeCurrentBook, currentBookId, currentBookId);
  return foreign ?? current;
}

// ---------------------------------------------------------------------------
// 外部账本的在线写入
// ---------------------------------------------------------------------------

export class ForeignLedgerOfflineError extends Error {
  constructor() {
    super(t("workspace.ledger.offlineWrite"));
    this.name = "ForeignLedgerOfflineError";
  }
}

function assertOnline(): void {
  if (isAccountOffline()) throw new ForeignLedgerOfflineError();
}

/** 在指定账本里新建（id 与幂等键由调用方生成，重放安全）。 */
export async function createInBook(bookId: string, input: CreateTransactionInput): Promise<Transaction> {
  assertOnline();
  return apiFetch<Transaction>("/transactions", { bookId, method: "POST", body: input });
}

/**
 * 修改指定账本里的一笔：带上用户看到的版本号与「从哪个值改成哪个值」（`changes`）——服务器按它判断
 * 冲突并写入金额、分类等字段，只带新值的请求不会改动这些字段。
 */
export async function updateInBook(
  bookId: string,
  id: string,
  input: UpdateTransactionInput,
  changes: readonly { readonly field: string; readonly base: unknown; readonly wanted: unknown; readonly chain: readonly unknown[] }[] = [],
): Promise<Transaction> {
  assertOnline();
  const body = changes.length === 0 ? input : { ...input, changes };
  return apiFetch<Transaction>(`/transactions/${encodeURIComponent(id)}`, { bookId, method: "PATCH", body });
}

export async function deleteInBook(bookId: string, id: string): Promise<void> {
  assertOnline();
  await apiFetch<unknown>(`/transactions/${encodeURIComponent(id)}`, { bookId, method: "DELETE" });
}

export async function restoreInBook(bookId: string, id: string): Promise<Transaction> {
  assertOnline();
  return apiFetch<Transaction>(`/transactions/${encodeURIComponent(id)}/restore`, { bookId, method: "POST" });
}

/** 工作区外壳读取：给侧栏、辅助区导航等不在工作区内部渲染的控件用。 */
export function useChosenLedger(): string | null {
  return useContext(ViewLedgerContext);
}
