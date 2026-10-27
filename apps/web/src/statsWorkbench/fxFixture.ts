/**
 * 综合折算专项测试用的混币种账目集，以及**手算**的期望值（独立于被测代码）。
 *
 * 目标币种 CNY；汇率见 `fxTestSupport.ts`：1 USD = 6.4 CNY，1 HKD = 0.8 CNY，1 JPY = 0.05 CNY。
 * `HAND_CONVERTED` 里每一笔的人民币分都是手算后写成字面量的（半入取整、JPY 无小数位）：
 *
 *   USD 1234 分  → 1234 × 6.4 = 7897.6 → 7898
 *   HKD  750 分  →  750 × 0.8 =  600.0 →  600
 *   JPY 1000 日元 → 1000 × 0.05 元 = 50.00 元 → 5000 分
 *   HKD 1001 分  → 1001 × 0.8 =  800.8 →  801
 *
 * 期望的统计量（总额、笔数、极值、排行……）同样手算，见各测试内的注释。
 */
import type { Transaction } from "@libellum/shared";

import { tx } from "./fxTestSupport.js";

export const TODAY = "2026-10-27";
export const RANGE = { from: "2026-10-01", to: "2026-10-27" } as const;

const food = { categoryId: "c-food", categoryName: "餐饮" } as const;
const transport = { categoryId: "c-transport", categoryName: "交通" } as const;
const shopping = { categoryId: "c-shopping", categoryName: "购物" } as const;
const rent = { categoryId: "c-rent", categoryName: "房租" } as const;
const salary = { categoryId: "c-salary", categoryName: "工资" } as const;
const freelance = { categoryId: "c-freelance", categoryName: "兼职" } as const;
const payA = { paymentMethodId: "p-a", paymentMethodName: "微信" } as const;
const payB = { paymentMethodId: "p-b", paymentMethodName: "现金" } as const;

function entry(id: string, date: string, kind: "expense" | "income", currency: Transaction["currency"], amountCents: number, extra: Partial<Transaction>): Transaction {
  return tx(id, { occurredLocalDate: date, occurredAt: `${date}T04:00:00.000Z`, kind, currency, amountCents, ...extra });
}

/** 12 笔账目，覆盖 CNY / USD / HKD / JPY、收入与支出、同日多币种、多分类与支付方式。 */
export const MIXED_ENTRIES: readonly Transaction[] = [
  entry("e01", "2026-10-01", "expense", "CNY", 10000, { ...food, ...payA }),
  entry("e02", "2026-10-02", "expense", "USD", 1234, { ...food, ...payA }),
  entry("e03", "2026-10-02", "expense", "HKD", 750, { ...transport }),
  entry("e04", "2026-10-03", "income", "CNY", 500000, { ...salary }),
  entry("e05", "2026-10-03", "expense", "JPY", 1000, { ...shopping }),
  entry("e06", "2026-10-05", "expense", "CNY", 2500, { ...transport, ...payB }),
  entry("e07", "2026-10-05", "income", "USD", 10000, { ...freelance }),
  entry("e08", "2026-10-10", "expense", "USD", 1000, { ...food, ...payB }),
  entry("e09", "2026-10-10", "expense", "HKD", 1001, { ...food }),
  entry("e10", "2026-10-15", "expense", "CNY", 30000, { ...rent }),
  entry("e11", "2026-10-20", "expense", "USD", 50000, { ...shopping }),
  entry("e12", "2026-10-20", "income", "HKD", 100000, { ...freelance }),
];

/** 手算：每笔折算成人民币「分」。键是账目 id。 */
export const HAND_CONVERTED: Readonly<Record<string, number>> = {
  e01: 10000,
  e02: 7898,
  e03: 600,
  e04: 500000,
  e05: 5000,
  e06: 2500,
  e07: 64000,
  e08: 6400,
  e09: 801,
  e10: 30000,
  e11: 320000,
  e12: 80000,
};

/** 上一周期（2026-09-04 ~ 2026-09-30）的账目，供「上期比较」。 */
export const PREVIOUS_ENTRIES: readonly Transaction[] = [
  entry("p01", "2026-09-10", "expense", "USD", 5000, { ...food }),
  entry("p02", "2026-09-15", "income", "CNY", 100000, { ...salary }),
];
export const PREVIOUS_HAND_CONVERTED: Readonly<Record<string, number>> = { p01: 32000, p02: 100000 };
export const PREVIOUS_RANGE = { from: "2026-09-04", to: "2026-09-30" } as const;
