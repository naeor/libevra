/**
 * 账本导入结果页「归档来源账本」成功之后的先后顺序（1.19.63，待办 §6 第 25 条，所有者 2026-11-14 决定）。
 *
 * 所有者定的原则：“导入归档当前账本本质上就是一次普通的归档操作”。账本设置里的普通归档
 * （`pages/BookSettingsPage.tsx` 的 `runLifecycle`）是：归档请求成功 → 清掉**这本账**的本机离线数据
 * （`lib/offline/localCleanup.ts` 的 `clearBookLocalData`，不论是不是当前账本）→ 再决定是否整页载入。
 * 这里按同一顺序执行，只换掉最后一步：来源是设备当前账本 → 整页载入并加海浪（1.19.61）；不是 → 留在导入结果页、显示“已归档”。
 *
 * 失败语义与 `runLifecycle` 一致：归档请求或清本机数据抛错，整条流程都停在原地——Promise 拒绝、**不载入**，
 * 由调用方显示原因并放开忙碌状态；没有登录用户（`accountId === null`）时与 `runLifecycle` 一样跳过清理、照常继续。
 * 归档请求成功后、清理之前先报告 `onArchived`：服务器上已经归档了，界面要如实显示“已归档”、收起确认框，
 * 不能让用户以为没归档又去点一次。
 *
 * ⚠️ **只清被归档的来源账本**：确认导入的目标账本从不交给清理；万一来源与目标是同一本账（服务器在提交导入时
 * 已拒绝这种情况，`apps/api/src/ledger/importSolo.ts`），宁可报错也不清。这是新增的保护，不改归档请求本身。
 * 能否归档（`canArchive`）、确认框、归档请求仍在 `pages/LedgerImportPage.tsx` 的 `SourceRetentionCard` 原处，这里不判断权限。
 */

export interface ImportSourceArchiveSteps {
  /** 被归档的来源账本（服务器返回的处置信息里的 `sourceBookId`）。 */
  readonly sourceBookId: string;
  /** 这次导入的目标账本：只用于保护，绝不清理。 */
  readonly targetBookId: string;
  /** 设备当前账本（`useCurrentBookId`）。 */
  readonly currentBookId: string | null;
  /** 登录用户：本机离线数据按“账号 : 账本”存放；没有用户时跳过清理（与 `runLifecycle` 相同）。 */
  readonly accountId: string | null;
  /** 归档请求本身（`bookLifecycleAction(bookId, "archive")`），原样不变。 */
  readonly archive: (bookId: string) => Promise<unknown>;
  /** 清掉一本账的本机离线数据（`clearBookLocalData`）。 */
  readonly clearLocalData: (accountId: string, bookId: string) => Promise<unknown>;
  /** 归档请求成功：显示“已归档”、收起确认框。 */
  readonly onArchived: () => void;
  /** 整页重新载入（`reloadAfterLeaving`）。 */
  readonly reload: () => void;
}

/** `reloading`：来源是当前账本，已开始整页载入（按钮保持忙碌）；`stayed`：留在结果页。 */
export type ImportSourceArchiveOutcome = "reloading" | "stayed";

export async function archiveImportSource(steps: ImportSourceArchiveSteps): Promise<ImportSourceArchiveOutcome> {
  const { sourceBookId, targetBookId, currentBookId, accountId } = steps;
  await steps.archive(sourceBookId);
  steps.onArchived();
  if (sourceBookId === targetBookId) {
    throw new Error("refusing to clear the local data of the import target");
  }
  if (accountId !== null) await steps.clearLocalData(accountId, sourceBookId);
  if (sourceBookId === currentBookId) {
    steps.reload();
    return "reloading";
  }
  return "stayed";
}
