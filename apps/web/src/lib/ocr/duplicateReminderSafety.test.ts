import { describe, expect, it } from "vitest";

import {
  DEFAULT_DUPLICATE_DETECTION_SETTINGS,
  type CreateTransactionInput,
} from "@libellum/shared";

import { findSuspectedDuplicates, withDuplicateMarks } from "./duplicates.js";
import { executeImport, type OcrImportWriter } from "./importExecution.js";
import { batchCandidate } from "./testFixtures.js";
import type { OcrBatch } from "./types.js";

/**
 * 关闭“重复交易提醒”**不等于**关闭数据安全保护。
 *
 * 这组测试走**写入计划与幂等键**，而不是只检查界面：
 *  1. 两笔内容相同的候选，默认规则会提示重复；
 *  2. 关闭提醒后不再提示，但两笔仍进入导入计划；
 *  3. 每条 `CreateTransactionInput.idempotencyKey` 仍等于固定 `id`；
 *  4. 用同一批次重放一次，发出的幂等键**完全相同**——服务端 `idempotency_key` 唯一约束
 *     仍会挡住重复写入。
 *
 * 这正是“提醒只是业务层提示”的可执行边界；它不是 UI 文案测试。
 */

const DISABLED = { ...DEFAULT_DUPLICATE_DETECTION_SETTINGS, enabled: false };

function duplicateCandidates(): OcrBatch["items"] {
  return [
    batchCandidate({ candidateId: "c1" }),
    batchCandidate({ candidateId: "c2", imageIndex: 1 }),
  ];
}

function batchWithIds(): OcrBatch {
  return {
    version: 1,
    batchId: "batch-duplicate-safety",
    createdAt: "2026-10-21T10:00:00.000Z",
    bookId: "book-1",
    pages: [],
    items: duplicateCandidates(),
    importIds: { c1: "id-c1", c2: "id-c2" },
  };
}

function collectWrites(): {
  readonly write: OcrImportWriter;
  readonly inputs: CreateTransactionInput[];
} {
  const inputs: CreateTransactionInput[] = [];

  return {
    inputs,
    write: async (input) => {
      inputs.push(input);
      return { pending: false };
    },
  };
}

describe("关闭重复提醒后的幂等保护", () => {
  it("默认规则下这两笔确实会被提示为疑似重复（对照）", () => {
    expect(findSuspectedDuplicates(duplicateCandidates())).toHaveLength(1);
  });

  it("关闭提醒只去掉提示，不改变导入计划与幂等键", async () => {
    const batch = batchWithIds();
    const items = withDuplicateMarks(batch.items, { settings: DISABLED }).items;

    expect(items.every((item) => !item.duplicateSuspected && !item.invalid)).toBe(true);
    expect(findSuspectedDuplicates(items, { settings: DISABLED })).toEqual([]);

    const { write, inputs } = collectWrites();
    const outcome = await executeImport({ ...batch, items }, write);

    expect(outcome.attempted).toBe(2);
    expect(outcome.succeeded).toHaveLength(2);
    expect(outcome.failed).toEqual([]);
    expect(outcome.blockers).toEqual([]);

    expect(inputs.map((input) => input.id)).toEqual(["id-c1", "id-c2"]);
    expect(inputs.map((input) => input.idempotencyKey)).toEqual(["id-c1", "id-c2"]);
    expect(inputs.every((input) => input.idempotencyKey === input.id)).toBe(true);
  });

  it("同一批次重放使用完全相同的幂等键，服务端仍能挡住重复写入", async () => {
    const batch = batchWithIds();
    const first = collectWrites();
    const second = collectWrites();

    await executeImport(batch, first.write);
    await executeImport(batch, second.write);

    expect(second.inputs.map((input) => input.idempotencyKey)).toEqual(
      first.inputs.map((input) => input.idempotencyKey),
    );
    // 重放的是同一批 id，而不是重新生成的一组 id。
    expect(new Set([...first.inputs, ...second.inputs].map((input) => input.id)).size).toBe(2);
  });
});
