/**
 * 批次 → 既有个体写入的翻译层（S15-B §3.5）。
 *
 * **这里没有新的保存协议。** 每条候选最终变成一个 `CreateTransactionInput`，由页面
 * 逐条调用 `offline/write.ts` 的 `createEntry`——和 `/add`、单笔 OCR 完全同一条通道：
 * 本地先写、离线排队、`id`/`idempotencyKey` 幂等、服务端仍是权威。
 *
 * 两个安全性质由这个模块保证：
 *  - **确认前不产生任何写入**：`buildImportPlan` 是纯函数，只读批次；它不会调用 API、
 *    不会触发 `createEntry`。
 *  - **id 在确认时固定**：`id` 来自 `batch.importIds`（由 `assignImportIds` 在第一次
 *    确认时一次性生成并写回 sessionStorage），重试复用同一个值，不会重复入账。
 *
 * 不能导入的项不会“静默跳过”：它们在 `blockers` 里逐条给出原因，概览页在确认前
 * 就据此禁用按钮并显示原因；只有写入阶段才可能出现的失败，也会逐条汇总。
 */

import {
  CURRENCIES,
  type CreateTransactionInput,
  type Currency,
} from "@libellum/shared";

import { localTimeZone, toLocalDate, toLocalIso } from "../datetime.js";
import { parseAmountInput } from "../format.js";
import type { OcrBatch, OcrBatchCandidate } from "./types.js";

/** 备注上限，与共享 `createTransactionSchema` 一致。 */
export const NOTE_MAX_LENGTH = 200;

export interface OcrImportBlocker {
  readonly candidateId: string;
  readonly label: string;
  readonly reason: string;
}

export interface OcrImportPlanItem {
  readonly candidateId: string;
  readonly label: string;
  readonly input: CreateTransactionInput;
}

export interface OcrImportPlan {
  readonly ready: readonly OcrImportPlanItem[];
  readonly blockers: readonly OcrImportBlocker[];
}

export interface OcrImportSuccess {
  readonly candidateId: string;
  readonly label: string;
  /** 已写在本机、还在等联网投递；不能当成云端已保存。 */
  readonly pending: boolean;
}

export interface OcrImportFailure {
  readonly candidateId: string;
  readonly label: string;
  readonly reason: string;
}

export interface OcrImportOutcome {
  readonly attempted: number;
  readonly succeeded: readonly OcrImportSuccess[];
  readonly failed: readonly OcrImportFailure[];
  /** 尚未开始就发现不能导入的项；有它们时一条都不会写。 */
  readonly blockers: readonly OcrImportBlocker[];
}

function hasText(value: string | null): value is string {
  return value !== null && value.trim() !== "";
}

/** 简短的可读标识，用于失败汇总；不包含完整截图原文。 */
export function candidateLabel(item: OcrBatchCandidate): string {
  const amount = hasText(item.amount) ? `${item.amount} ${item.currency ?? ""}`.trim() : "金额待确认";
  const merchant = hasText(item.merchant) ? item.merchant : "商户待确认";
  return `${amount} · ${merchant}`;
}

/**
 * 备注里保留“这一笔是谁、从哪个账户、是不是转账”。
 *
 * 账本没有商户/账户字段，现有单笔核对也是把对手方拼进 note；这里沿用同一做法，
 * 而不是新增字段。转账不是 kind，所以用“转账”文字标记保留语义，分类仍由用户选。
 */
export function composeNote(item: OcrBatchCandidate): string | null {
  const parts: string[] = [];
  if (hasText(item.merchant)) parts.push(item.merchant.trim());
  if (hasText(item.note)) parts.push(item.note.trim());
  if (hasText(item.account)) parts.push(`账户：${item.account.trim()}`);
  if (item.isTransfer) parts.push("转账");
  return parts.length === 0 ? null : parts.join(" · ");
}

function isSupportedCurrency(value: string | null): value is Currency {
  return value !== null && (CURRENCIES as readonly string[]).includes(value);
}

function validDate(value: string | null): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00`);
  // Compare through the same local-date function the entry is written with, so a
  // timezone cannot make a valid date look like the day before.
  return !Number.isNaN(parsed.getTime()) && toLocalDate(parsed) === value;
}

function validTime(value: string | null): value is string {
  return value !== null && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim());
}

function blocker(item: OcrBatchCandidate, reason: string): OcrImportBlocker {
  return { candidateId: item.candidateId, label: candidateLabel(item), reason };
}

/**
 * Why this candidate cannot be written as-is, or `null` when it can.
 *
 * Separate from the id check so the overview can tell the user *before* the
 * confirmation (and before any uuid is minted) how many items still need work.
 */
export function validationBlocker(item: OcrBatchCandidate): string | null {
  if (!hasText(item.amount)) return "金额缺失";

  if (!isSupportedCurrency(item.currency)) {
    return hasText(item.currency) ? `账本不支持币种 ${item.currency}` : "币种待确认";
  }

  let amountCents: number;
  try {
    amountCents = parseAmountInput(item.amount, item.currency);
  } catch {
    return "金额格式不正确";
  }
  if (amountCents <= 0) return "金额需要大于 0";

  if (item.direction !== "income" && item.direction !== "expense") return "收支方向待确认";
  if (!validDate(item.occurredLocalDate)) return "日期待确认";

  const time = hasText(item.occurredTime) ? item.occurredTime.trim() : "";
  if (time !== "" && !validTime(time)) return "时间格式不正确";

  const note = composeNote(item);
  if (note !== null && note.length > NOTE_MAX_LENGTH) {
    return `备注超过 ${String(NOTE_MAX_LENGTH)} 字，请精简`;
  }

  return null;
}

/** 所有有效项里仍不能导入的，逐条给原因。确认前按钮据此禁用。 */
export function findImportBlockers(batch: OcrBatch): OcrImportBlocker[] {
  const blockers: OcrImportBlocker[] = [];

  for (const item of batch.items) {
    if (item.invalid) continue;
    const reason = validationBlocker(item);
    if (reason !== null) blockers.push(blocker(item, reason));
  }

  return blockers;
}

/**
 * 有资格写入的笔数：未标记无效、且通过字段校验（`validationBlocker` 为 null）。
 *
 * ⚠️ **这是概览页「可导入 N 笔」和确认按钮上的那个 N**，不是“未标记无效”的数量。
 * 两者在字段不够时会差开：一笔缺币种的候选仍然“有效”（用户没排除它），但它写不进去。
 * 把未标记无效的数量当成可导入，会让概览在按钮被禁用时仍写着“可导入 5 笔”。
 *
 * 它**不检查固定 id**：`importIds` 只在确认那一刻才生成，所以这里不把“还没有 id”
 * 算成阻塞，否则页面一打开就永远显示 0 笔可导入。
 */
export function countImportableItems(items: readonly OcrBatchCandidate[]): number {
  let count = 0;

  for (const item of items) {
    if (item.invalid) continue;
    if (validationBlocker(item) === null) count += 1;
  }

  return count;
}

/**
 * 把批次翻译成逐条写入计划。纯函数，不触网、不写账。
 *
 * 无效项（用户标记）不进入 ready 也不进入 blockers：它们本来就不该导入，页面用
 * “已标记无效”单独计数。有效项如果缺关键字段，进入 blockers——确认按钮据此禁用，
 * 不会出现“点了确认但有几笔被悄悄跳过”。
 */
export function buildImportPlan(batch: OcrBatch): OcrImportPlan {
  const ready: OcrImportPlanItem[] = [];
  const blockers: OcrImportBlocker[] = [];

  for (const item of batch.items) {
    if (item.invalid) continue;

    const reason = validationBlocker(item);
    if (reason !== null) {
      blockers.push(blocker(item, reason));
      continue;
    }
    // The validation above narrowed nothing in TypeScript's eyes; re-read the
    // fields it proved are present.
    if (!isSupportedCurrency(item.currency) || !validDate(item.occurredLocalDate)) continue;

    const id = batch.importIds[item.candidateId];
    if (id === undefined) {
      blockers.push(blocker(item, "内部错误：这一笔还没有固定的幂等 id，请返回概览重试。"));
      continue;
    }

    const amountCents = parseAmountInput(item.amount!, item.currency);
    const time = hasText(item.occurredTime) ? item.occurredTime.trim() : "";
    const occurredAt = new Date(`${item.occurredLocalDate}T${time === "" ? "12:00" : time}:00`);

    ready.push({
      candidateId: item.candidateId,
      label: candidateLabel(item),
      input: {
        id,
        idempotencyKey: id,
        kind: item.direction as "expense" | "income",
        amountCents,
        currency: item.currency,
        categoryId: item.categoryId,
        paymentMethodId: item.paymentMethodId,
        occurredAt: toLocalIso(occurredAt),
        occurredLocalDate: item.occurredLocalDate,
        occurredTz: localTimeZone(),
        note: composeNote(item),
        tagIds: item.tagIds,
      },
    });
  }

  return { ready, blockers };
}
