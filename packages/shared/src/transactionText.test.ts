import { describe, expect, it } from "vitest";

import type { CategoryCandidate } from "./categoryMatch.js";
import { parseTransactionText, parseTransactionTexts } from "./transactionText.js";

/**
 * Fixed local clock: 2026-10-22 (Thursday) 10:30 in the user's own time zone.
 * Relative dates must be computed from this, never from UTC, and not from the
 * machine's real clock — otherwise the suite would pass in one time zone and
 * fail in another.
 */
const NOW = new Date(2026, 9, 22, 10, 30, 0);

const LEDGER: readonly CategoryCandidate[] = [
  { id: "c-food", name: "餐饮", kind: "expense", isArchived: false },
  { id: "c-transport", name: "交通", kind: "expense", isArchived: false },
  { id: "c-shopping", name: "购物", kind: "expense", isArchived: false },
  { id: "c-salary", name: "工资", kind: "income", isArchived: false },
];

function parse(text: string): ReturnType<typeof parseTransactionText> {
  return parseTransactionText(text, { categories: LEDGER, now: NOW });
}

describe("shared transaction text core: natural sentences", () => {
  it("reads the owner's voice example end to end", () => {
    const result = parse("昨天用支付宝在麦当劳花了二十八块五。");

    expect(result.amount).toBe("28.5");
    expect(result.currency).toBe("CNY");
    expect(result.kind).toBe("expense");
    expect(result.occurredLocalDate).toBe("2026-10-21");
    expect(result.merchant).toBe("麦当劳");
    expect(result.paymentMethod).toBe("支付宝");
    expect(result.categoryId).toBe("c-food");
    expect(result.status.amount).not.toBe("missing");
  });

  it("produces the same fields from digits, which is the point of one core", () => {
    const spoken = parse("昨天用支付宝在麦当劳花了二十八块五。");
    const pasted = parse("昨天用支付宝在麦当劳花了28.5元。");

    expect({
      amount: pasted.amount,
      currency: pasted.currency,
      kind: pasted.kind,
      date: pasted.occurredLocalDate,
      merchant: pasted.merchant,
      payment: pasted.paymentMethod,
      category: pasted.categoryId,
    }).toEqual({
      amount: spoken.amount,
      currency: spoken.currency,
      kind: spoken.kind,
      date: spoken.occurredLocalDate,
      merchant: spoken.merchant,
      payment: spoken.paymentMethod,
      category: spoken.categoryId,
    });
  });

  it("reads today and a food merchant without inventing a time", () => {
    const result = parse("今天中午麦当劳花了 28.5 元。");

    expect(result.amount).toBe("28.5");
    expect(result.occurredLocalDate).toBe("2026-10-22");
    expect(result.occurredTime).toBeNull();
    expect(result.merchant).toBe("麦当劳");
    expect(result.categoryId).toBe("c-food");
    expect(result.issues.some((issue) => issue.code === "time_missing")).toBe(true);
  });

  it("reads yesterday + payment method + a food word", () => {
    const result = parse("昨天晚上用支付宝买了 32 块钱的奶茶。");

    expect(result.amount).toBe("32");
    expect(result.occurredLocalDate).toBe("2026-10-21");
    expect(result.paymentMethod).toBe("支付宝");
    expect(result.categoryId).toBe("c-food");
    expect(result.occurredTime).toBeNull();
  });

  it("reads money coming in", () => {
    const result = parse("收到朋友还款 150 元。");

    expect(result.amount).toBe("150");
    expect(result.kind).toBe("income");
    expect(result.status.kind).toBe("confirmed");
  });

  it("reads a missing unit: 三百五 is 350", () => {
    const result = parse("前天花了三百五买东西。");

    expect(result.amount).toBe("350");
    expect(result.occurredLocalDate).toBe("2026-10-20");
    expect(result.kind).toBe("expense");
  });

  it("reads a foreign currency and an English merchant", () => {
    const result = parse("上周五 Uber Eats 消费 23.62 美元。");

    expect(result.amount).toBe("23.62");
    expect(result.currency).toBe("USD");
    expect(result.occurredLocalDate).toBe("2026-10-16");
    expect(result.merchant).toBe("Uber Eats");
  });

  it("reads colloquial day words, including 昨晚 and the longer 大前天", () => {
    expect(parse("昨晚支付宝32块奶茶").occurredLocalDate).toBe("2026-10-21");
    expect(parse("今早麦当劳15元").occurredLocalDate).toBe("2026-10-22");
    expect(parse("大前天买菜60元").occurredLocalDate).toBe("2026-10-19");
    expect(parse("前晚打车20元").occurredLocalDate).toBe("2026-10-20");
  });

  it("reads a date and an explicit time", () => {
    const result = parse("10 月 8 日晚上八点打车 42 元");

    expect(result.amount).toBe("42");
    expect(result.occurredLocalDate).toBe("2026-10-08");
    expect(result.occurredTime).toBe("20:00");
    expect(result.categoryId).toBe("c-transport");
    expect(result.status.date).toBe("suggested");
  });

  it("trusts digital clock notation but leaves a bare 8点 open", () => {
    const digital = parse("10:30 麦当劳 28.5 元");
    const spoken = parse("8 点 麦当劳 28.5 元");

    expect(digital.occurredTime).toBe("10:30");
    expect(digital.status.time).toBe("confirmed");
    expect(spoken.occurredTime).toBe("08:00");
    expect(spoken.status.time).toBe("suggested");
  });

  it("does not turn a missing time into noon", () => {
    const result = parse("10 月 8 日晚上吃饭 42 元");

    expect(result.occurredLocalDate).toBe("2026-10-08");
    expect(result.occurredTime).toBeNull();
  });

  it("keeps a date-only sentence without inventing an amount", () => {
    const result = parse("10 月 8 日");

    expect(result.amount).toBeNull();
    expect(result.occurredLocalDate).toBe("2026-10-08");
    expect(result.status.amount).toBe("missing");
  });
});

describe("shared transaction text core: amounts", () => {
  it("handles 28 块五, 28 元 5 角 and 28 元 5 分 distinctly", () => {
    expect(parse("午饭 28 块五").amount).toBe("28.5");
    expect(parse("午饭 28 元 5 角").amount).toBe("28.5");
    expect(parse("午饭 28 元 5 分").amount).toBe("28.05");
  });

  it("handles 一万二 and 三百五", () => {
    expect(parse("工资一万二").amount).toBe("12000");
    expect(parse("打车三百五").amount).toBe("350");
  });

  it("prefers the actual amount over original price and discount", () => {
    const result = parse("微信支付：交易成功，原价 35 元，优惠 6.5 元，实付 ¥28.50。");

    expect(result.amount).toBe("28.50");
    expect(result.currency).toBe("CNY");
    expect(result.source).toBe("structured");
    expect(result.paymentMethod).toBe("微信");
  });

  it("never takes a balance, order number or points as the amount", () => {
    const result = parse("余额 1000 元，订单号 202610220001，实付 30 元。");

    expect(result.amount).toBe("30");
  });

  it("keeps a bank notice's card tail and date out of the amount", () => {
    const result = parse("银行通知：您尾号1234的账户于10月8日消费人民币88.00元。");

    expect(result.amount).toBe("88.00");
    expect(result.currency).toBe("CNY");
    expect(result.occurredLocalDate).toBe("2026-10-08");
  });

  it("marks two competing amounts as ambiguous instead of choosing one", () => {
    const result = parse("付款 100 元，退款 50 元。");

    // The actual direction is genuinely unclear; the parser must ask rather than
    // silently filing either 100 or 50.
    expect(result.amount).toBeNull();
    expect(result.status.amount).toBe("ambiguous");
    expect(result.issues.some((issue) => issue.code === "amount_ambiguous")).toBe(true);
  });

  it("does not use the first number merely because it is first", () => {
    const result = parse("订单号 123456，付款金额 88 元，优惠 8 元");

    expect(result.amount).toBe("88");
  });
});

describe("shared transaction text core: merchant, category, payment", () => {
  it("reads a structured merchant and payment method", () => {
    const result = parse("支付宝交易详情\n商户：麦当劳\n支付方式：花呗\n实付：28.50 元");

    expect(result.amount).toBe("28.50");
    expect(result.merchant).toBe("麦当劳");
    expect(result.paymentMethod).toBe("花呗");
    expect(result.categoryId).toBe("c-food");
  });

  it("weights a transport action over a food destination", () => {
    expect(parse("打车去麦当劳 30 元").categoryId).toBe("c-transport");
  });

  it("weights a food action over the shop name", () => {
    expect(parse("在麦当劳买了汉堡 32 元").categoryId).toBe("c-food");
  });

  it("does not treat 支付宝 as the merchant", () => {
    const result = parse("支付宝付款 28 元");

    expect(result.paymentMethod).toBe("支付宝");
    expect(result.merchant).toBeNull();
  });

  it("does not put a transfer into ordinary shopping", () => {
    const result = parse("微信转给朋友 100 元");

    expect(result.amount).toBe("100");
    expect(result.kind).toBe("expense");
    expect(result.categoryId).toBeNull();
    expect(result.issues.some((issue) => issue.code === "transfer_suspected")).toBe(true);
  });

  it("reads a refund as income, not as salary", () => {
    const result = parse("收到退款 50 元");

    expect(result.kind).toBe("income");
    expect(result.categoryId).toBeNull();
  });
});

/**
 * The owner's acceptance examples (2026-10-22). These are deliberately kept as
 * one block: they are the fixed set we will re-run before and after any voice or
 * paste change, so a regression has to show up as a changed outcome, not as a
 * lower aggregate count.
 */
describe("shared transaction text core: fixed acceptance samples", () => {
  it("reads every natural-language sample in the brief", () => {
    expect(parse("今天中午麦当劳花了 28.5 元。")).toMatchObject({
      amount: "28.5",
      currency: "CNY",
      kind: "expense",
      occurredLocalDate: "2026-10-22",
      merchant: "麦当劳",
      categoryId: "c-food",
    });

    expect(parse("昨天晚上用支付宝买了 32 块钱的奶茶。")).toMatchObject({
      amount: "32",
      kind: "expense",
      occurredLocalDate: "2026-10-21",
      paymentMethod: "支付宝",
      categoryId: "c-food",
    });

    expect(parse("收到朋友还款 150 元。")).toMatchObject({
      amount: "150",
      kind: "income",
    });

    expect(parse("前天花了三百五买东西。")).toMatchObject({
      amount: "350",
      kind: "expense",
      occurredLocalDate: "2026-10-20",
    });

    expect(parse("上周五 Uber Eats 消费 23.62 美元。")).toMatchObject({
      amount: "23.62",
      currency: "USD",
      kind: "expense",
      occurredLocalDate: "2026-10-16",
      merchant: "Uber Eats",
    });
  });

  it("reads a copied WeChat detail without mistaking original price for payment", () => {
    const result = parse(
      "微信支付：交易成功\n商户：瑞幸咖啡\n原价：35.00元\n优惠：6.50元\n实付：¥28.50\n支付方式：微信零钱",
    );

    expect(result).toMatchObject({
      amount: "28.50",
      currency: "CNY",
      kind: "expense",
      merchant: "瑞幸咖啡",
      // The pasted label is kept verbatim; the review screen matches it against
      // the ledger's payment methods (微信零钱 is a form of 微信).
      paymentMethod: "微信零钱",
      categoryId: "c-food",
      source: "structured",
    });
  });

  it("reads a copied Alipay detail with a datetime and a labels-only layout", () => {
    const result = parse(
      "支付宝交易详情\n商户名称：麦当劳\n支付方式：花呗\n交易时间：2026-10-08 20:15\n实付：28.50 元",
    );

    expect(result).toMatchObject({
      amount: "28.50",
      currency: "CNY",
      merchant: "麦当劳",
      paymentMethod: "花呗",
      occurredLocalDate: "2026-10-08",
      occurredTime: "20:15",
      categoryId: "c-food",
    });
  });

  it("reads a bank notice and keeps the card tail out of the amount", () => {
    const result = parse("银行通知：您尾号1234的账户于10月8日消费人民币88.00元，交易对方：星巴克。");

    expect(result).toMatchObject({
      amount: "88.00",
      currency: "CNY",
      occurredLocalDate: "2026-10-08",
      merchant: "星巴克",
      categoryId: "c-food",
    });
  });

  it("finds the actual amount when the labels put the currency code in between", () => {
    const result = parse("商户名称：Uber Eats\n付款金额：USD 23.62\n交易日期：2026-10-16");

    expect(result.amount).toBe("23.62");
    expect(result.currency).toBe("USD");
    expect(result.merchant).toBe("Uber Eats");
    expect(result.occurredLocalDate).toBe("2026-10-16");
  });

  it("asks instead of choosing when every visible number is an excluded label", () => {
    const result = parse("原价 35 元，优惠 6.5 元，积分 200");

    expect(result.amount).toBeNull();
    expect(result.status.amount).toBe("missing");
  });

  it("does not treat a transport card as shopping just because 买了 is present", () => {
    expect(parse("买了公交卡 50 元").categoryId).toBe("c-transport");
  });
});

describe("shared transaction text core: multi-entry architecture", () => {
  it("splits explicitly separated entries and parses each", () => {
    const result = parseTransactionTexts("麦当劳 28.5 元\n\n打车 20 元", {
      categories: LEDGER,
      now: NOW,
    });

    expect(result).toHaveLength(2);
    expect(result[0]?.amount).toBe("28.5");
    expect(result[1]?.amount).toBe("20");
  });

  it("flags a multi-entry text without silently merging it", () => {
    expect(parse("麦当劳 28.5 元\n\n打车 20 元").multipleTransactions).toBe(true);
    expect(parse("今天麦当劳花了 28.5 元").multipleTransactions).toBe(false);
  });

  it("keeps one structured detail together across a layout blank line", () => {
    const result = parseTransactionTexts(
      "支付宝交易详情\n\n商户名称：麦当劳\n支付方式：花呗\n交易时间：2026-10-08 20:15\n实付：28.50 元",
      { categories: LEDGER, now: NOW },
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      amount: "28.50",
      merchant: "麦当劳",
      paymentMethod: "花呗",
      occurredLocalDate: "2026-10-08",
      occurredTime: "20:15",
    });
  });
});

/**
 * Regressions found by running real Whisper output through the same parser.
 *
 * Each case is the parser's own mistake, not a transcription mistake: the text
 * here is what the model actually wrote, and the expected fields are the ones a
 * careful reader would take from it.
 */
describe("shared transaction text core: real-voice regressions", () => {
  it("joins dollars and cents into one amount", () => {
    expect(parse("上周五在Uber Eats消费了23美元62美分。")).toMatchObject({
      amount: "23.62",
      currency: "USD",
      categoryId: "c-food",
    });
    expect(parse("上周五在 Uber Eats 消费了二十三美元六十二美分。")).toMatchObject({
      amount: "23.62",
      currency: "USD",
    });
  });

  it("reads a Chinese-numeral month and day", () => {
    expect(parse("十月八日打车去学校花了十二美元。").occurredLocalDate).toBe("2026-10-08");
  });

  it("stays with the food place even when a friend is mentioned", () => {
    expect(parse("今天中午和朋友在星巴克用微信支付了四十八元五角，买了咖啡和蛋糕。").categoryId).toBe(
      "c-food",
    );
  });

  it("reads a convenience store as shopping", () => {
    expect(parse("10月20日在全家便利店花了15元，用支付宝。").categoryId).toBe("c-shopping");
  });

  it("does not let a single food item outvote the shop that was named", () => {
    expect(
      parse("10月8号下午3点,我在超市买了牛奶和水果,一共支出42元五角,用支付宝付款。").categoryId,
    ).toBe("c-shopping");
  });

  it("uses a ledger's education category for a bookshop", () => {
    const withEducation = [
      ...LEDGER,
      { id: "c-education", name: "教育", kind: "expense", isArchived: false },
    ] satisfies readonly CategoryCandidate[];

    expect(
      parseTransactionText("买书花了12美元，用信用卡。", {
        categories: withEducation,
        now: NOW,
      }).categoryId,
    ).toBe("c-education");
  });
});
