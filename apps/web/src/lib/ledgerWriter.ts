/**
 * **页面写账用的统一入口**（S18）：按本工作区查看的账本选择写入路径。
 *
 * - 当前账本：原样调用离线优先的 `createEntry` / `updateEntry` / `deleteEntry`（本机副本 + 同步队列）；
 * - 外部账本：在线直接写到那本账（显式带账本 id），成功后只刷新那本账的查询；离线时抛出明确的错误。
 *
 * 页面只需要把原来的三个函数换成这里的同名方法，当前账本的行为一个字不变。
 */
import type { CreateTransactionInput, Transaction, UpdateTransactionInput } from "@libellum/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { apiFetch } from "./api.js";
import { createEntry, deleteEntry, onlineChanges, updateEntry, type WriteOutcome } from "./offline/write.js";
import { createInBook, deleteInBook, FOREIGN_KEY, restoreInBook, updateInBook, useForeignBookId } from "./workspaceLedger.js";

export interface LedgerWriter {
  /** 外部账本 id；写的是设备当前账本时为 `null`。 */
  readonly foreign: string | null;
  create(input: CreateTransactionInput, entry: Transaction): Promise<WriteOutcome>;
  /**
   * @param seen 用户看到并据以修改的那一份（外部账本据此算出「从哪个值改成哪个值」）；省略时先向服务器读一次。
   */
  update(id: string, input: UpdateTransactionInput, apply: (current: Transaction) => Transaction, seen?: Transaction): Promise<WriteOutcome | null>;
  remove(id: string): Promise<void>;
  /** 外部账本的「撤销删除」；当前账本仍由页面原有的恢复请求处理。 */
  restore(id: string): Promise<Transaction>;
}

export function useLedgerWriter(): LedgerWriter {
  const foreign = useForeignBookId();
  const client = useQueryClient();

  return useMemo<LedgerWriter>(() => {
    if (foreign === null) {
      return {
        foreign: null,
        create: createEntry,
        update: updateEntry,
        remove: deleteEntry,
        restore: async () => {
          throw new Error("restore through the page's own mutation for the current ledger");
        },
      };
    }

    const refresh = async (): Promise<void> => {
      await client.invalidateQueries({ queryKey: [FOREIGN_KEY, foreign] });
    };

    return {
      foreign,
      async create(input) {
        const entry = await createInBook(foreign, input);
        await refresh();
        return { entry, pending: false };
      },
      async update(id, input, apply, seen) {
        const before = seen ?? (await apiFetch<Transaction>(`/transactions/${encodeURIComponent(id)}`, { bookId: foreign }));
        const entry = await updateInBook(foreign, id, input, onlineChanges(before, apply(before)));
        await refresh();
        return { entry, pending: false };
      },
      async remove(id) {
        await deleteInBook(foreign, id);
        await refresh();
      },
      async restore(id) {
        const entry = await restoreInBook(foreign, id);
        await refresh();
        return entry;
      },
    };
  }, [client, foreign]);
}
