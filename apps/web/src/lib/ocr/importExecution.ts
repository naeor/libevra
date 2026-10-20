/**
 * 执行逐条导入（S15-B §3.5）。
 *
 * **调用方注入写入函数**：页面传 `createEntry`/`localEntry`，测试传一个内存实现。
 * 这个模块因此不 import 离线队列、不碰 React，也不会在“计划”阶段偷偷写账。
 *
 * 三条行为是安全要求：
 *  - 有 blockers 时**一条都不写**（不静默跳过、不部分成功）；
 *  - 单条失败不中断后续条目，失败原因逐条保留（不静默部分失败）；
 *  - `pending` 原样传出去，页面据此显示“已在本机排队”，绝不宣称云端成功。
 */

import {
  buildImportPlan,
  type OcrImportFailure,
  type OcrImportOutcome,
  type OcrImportSuccess,
} from "./import.js";
import type { OcrBatch } from "./types.js";
import type { CreateTransactionInput } from "@libellum/shared";

/** 写入一条已存在的记录；`pending` 表示只写到了本机队列。 */
export type OcrImportWriter = (
  input: CreateTransactionInput,
) => Promise<{ readonly pending: boolean }>;

function defaultDescribeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function executeImport(
  batch: OcrBatch,
  write: OcrImportWriter,
  describeError: (error: unknown) => string = defaultDescribeError,
): Promise<OcrImportOutcome> {
  const plan = buildImportPlan(batch);

  if (plan.blockers.length > 0) {
    // Do not write a subset: a partially imported batch with no summary would be
    // exactly the silent partial failure this feature must never produce.
    return {
      attempted: 0,
      succeeded: [],
      failed: [],
      blockers: plan.blockers,
    };
  }

  const succeeded: OcrImportSuccess[] = [];
  const failed: OcrImportFailure[] = [];

  for (const entry of plan.ready) {
    try {
      const written = await write(entry.input);
      succeeded.push({
        candidateId: entry.candidateId,
        label: entry.label,
        pending: written.pending,
      });
    } catch (caught) {
      failed.push({
        candidateId: entry.candidateId,
        label: entry.label,
        reason: describeError(caught),
      });
    }
  }

  return { attempted: plan.ready.length, succeeded, failed, blockers: [] };
}
