/**
 * P16 · 币种交易构成（C-4 草案）。
 *
 * 这一项刻意「不折算」：它只回答「各种原币分别有多少笔交易、收入/支出各多少」。
 * owner 规格 §32 要求不同币种的原始金额不能直接相加、不能合成没有币种的总数，
 * 所以结果按币种分行，每行只含该币种内部的原币合计；份额只按**交易数量**计算。
 *
 * 与 P17（综合金额币种贡献）的区别：
 * - P16 = 数量构成，不需要汇率，任何一笔交易都能计入；
 * - P17 = 金额贡献，需要逐笔折算，缺汇率的记录单独计数。
 * 两张卡片不得共用同一个「币种占比」，否则会把数量份额误当金额份额。
 */

import type {
  DraftCurrencyCompositionResult,
  DraftCurrencyCompositionRow,
  DraftCompleteness,
  DraftFxRecord,
} from "./draftTypes.js";
import { assertFxRecord } from "./fxDiagnostics.js";
import { makeRational } from "./rational.js";

interface CompositionAccumulator {
  currency: string;
  recordCount: number;
  incomeCount: number;
  expenseCount: number;
  incomeAmountMinor: bigint;
  expenseAmountMinor: bigint;
}

/**
 * P16：按原始币种统计交易数量构成。
 *
 * - 输入记录只需 `DraftFxRecord`（id/kind/amountMinor/currency/occurredLocalDate）；
 * - 行按交易笔数降序、币种升序排列（同笔数时顺序稳定，便于截图与测试）；
 * - 空输入返回 `no-transactions`，不是 `complete`。
 *
 * @throws {RangeError} 任何一条记录字段非法（金额为负、币种/日期不合法）。
 */
export function currencyCompositionOf(
  records: readonly DraftFxRecord[],
): DraftCurrencyCompositionResult {
  const accumulators = new Map<string, CompositionAccumulator>();

  for (const record of records) {
    assertFxRecord(record);
    let accumulator = accumulators.get(record.currency);
    if (accumulator === undefined) {
      accumulator = {
        currency: record.currency,
        recordCount: 0,
        incomeCount: 0,
        expenseCount: 0,
        incomeAmountMinor: 0n,
        expenseAmountMinor: 0n,
      };
      accumulators.set(record.currency, accumulator);
    }
    accumulator.recordCount += 1;
    if (record.kind === "income") {
      accumulator.incomeCount += 1;
      accumulator.incomeAmountMinor += record.amountMinor;
    } else {
      accumulator.expenseCount += 1;
      accumulator.expenseAmountMinor += record.amountMinor;
    }
  }

  const totalRecordCount = records.length;
  const rows: DraftCurrencyCompositionRow[] = [...accumulators.values()]
    .sort((left, right) => {
      if (left.recordCount !== right.recordCount) {
        return right.recordCount - left.recordCount;
      }
      return left.currency < right.currency ? -1 : left.currency > right.currency ? 1 : 0;
    })
    .map((accumulator) => ({
      currency: accumulator.currency,
      recordCount: accumulator.recordCount,
      incomeCount: accumulator.incomeCount,
      expenseCount: accumulator.expenseCount,
      incomeAmountMinor: accumulator.incomeAmountMinor,
      expenseAmountMinor: accumulator.expenseAmountMinor,
      recordShare:
        totalRecordCount === 0
          ? null
          : makeRational(BigInt(accumulator.recordCount), BigInt(totalRecordCount)),
    }));

  const completeness: DraftCompleteness = rows.length === 0 ? "no-transactions" : "complete";

  return {
    rows,
    totalRecordCount,
    currencyCount: rows.length,
    completeness,
  };
}
