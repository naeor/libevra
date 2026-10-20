import { describe, expect, it } from "vitest";

import { cleanNote, isSpeechless, parseSpokenEntry } from "./speech.js";

/**
 * Turning a spoken sentence into fields.
 *
 * Tested with typed text rather than audio, which is the reason the module is
 * separate from recognition at all: the interesting cases here — a filler at the
 * front, a comma run where something was removed, an amount that appears twice —
 * are all cheap to write down and expensive to reproduce by talking into a phone.
 */
describe("parseSpokenEntry", () => {
  it("reads an amount and keeps the rest as the note", () => {
    const spoken = parseSpokenEntry("午饭 38 块");

    expect(spoken.amount).toBe("38");
    expect(spoken.note).toBe("午饭");
  });

  it("does not repeat the amount inside the note", () => {
    // The amount is a field, not part of the description. Leaving it in the note
    // means the number appears twice, and the copy in the note is the one that
    // goes stale when somebody corrects the amount.
    expect(parseSpokenEntry("打车 25.5 元").note).toBe("打车");
  });

  it("keeps a decimal amount intact", () => {
    expect(parseSpokenEntry("咖啡 18.80").amount).toBe("18.80");
  });

  it("reads an amount with no unit word", () => {
    expect(parseSpokenEntry("买菜 64").amount).toBe("64");
  });

  it("finds no amount when none was said", () => {
    // Nothing is invented. An empty field gets filled by the user; a wrong one
    // gets saved.
    const spoken = parseSpokenEntry("午饭吃的是拉面");

    expect(spoken.amount).toBeNull();
    expect(spoken.note).toBe("午饭吃的是拉面");
  });

  it("calls it income when the words say so", () => {
    expect(parseSpokenEntry("收到工资 12000").kind).toBe("income");
    expect(parseSpokenEntry("退款 38").kind).toBe("income");
  });

  it("calls it spending by default", () => {
    // Spending is the common case, and the kind control is one tap away.
    expect(parseSpokenEntry("午饭 38").kind).toBe("expense");
    expect(parseSpokenEntry("买了本书 45").kind).toBe("expense");
  });

  it("strips a filler from the front", () => {
    expect(parseSpokenEntry("嗯，午饭 38").note).toBe("午饭");
  });

  it("strips a filler from the end", () => {
    expect(parseSpokenEntry("午饭 38 啊").note).toBe("午饭");
  });

  it("strips several fillers in a row", () => {
    // One pass leaves "那个，午饭", which still reads as broken.
    expect(parseSpokenEntry("嗯，那个，午饭 38").note).toBe("午饭");
  });

  it("keeps a filler that is inside the sentence", () => {
    // 啊 in the middle is part of what somebody said; the same character at the
    // front is the sound of starting to talk.
    expect(parseSpokenEntry("买了啊那个牌子的 38").note).toContain("啊");
  });

  it("handles an empty recording", () => {
    const spoken = parseSpokenEntry("");

    expect(spoken.amount).toBeNull();
    expect(spoken.note).toBe("");
  });
});

/**
 * The owner's fixed acceptance sentences (docs/01-规划.md · S15-A) and the
 * date/amount confusion he reported while reviewing S14-V.
 *
 * ⚠️ The bug was never "a number was misread" — it was "the wrong number was
 * read". 「9 月 21 日餐饮花费 88 元」 produced **9** (the month) and
 * 「10 月 8 日……四十二块五」 produced **42** without the jiao, because the old
 * code took the first digits it found and the Chinese branch took the first
 * numeral run that had a money word after it. These cases are written down
 * verbatim so the fix cannot quietly regress.
 */
describe("parseSpokenEntry: a date is not an amount", () => {
  it("reads the amount out of the owner's fixed acceptance sentences", () => {
    expect(parseSpokenEntry("今天午饭花了三十八块").amount).toBe("38");
    expect(parseSpokenEntry("10 月 8 日在超市花了四十二块五").amount).toBe("42.5");
    expect(parseSpokenEntry("9 月 21 日餐饮花费 88 元").amount).toBe("88");
    expect(parseSpokenEntry("星巴克 38.5 元，微信支付").amount).toBe("38.5");
    expect(parseSpokenEntry("12 美元，信用卡支付").amount).toBe("12");
  });

  it("does not take the month or the day for the amount", () => {
    // The month a number sits next to is when, not how much.
    expect(parseSpokenEntry("9 月 21 日餐饮花费 88 元").amount).not.toBe("9");
    expect(parseSpokenEntry("10 月 8 日在超市花了 42.5 元").amount).toBe("42.5");
    expect(parseSpokenEntry("2026 年 10 月 8 日上午 9 时 30 分在超市花了 42 元").amount).toBe("42");
  });

  it("returns no amount when the sentence only says a date", () => {
    // Nothing is invented: an empty field is filled by the user, a wrong number
    // that looks plausible gets saved.
    expect(parseSpokenEntry("10 月 8 日").amount).toBeNull();
    expect(parseSpokenEntry("十月八日").amount).toBeNull();
    expect(parseSpokenEntry("下午 3 点").amount).toBeNull();
  });

  it("does not take the jiao for the amount", () => {
    // The case in the S14-V report, verbatim: 「42元五角」 used to yield 5.
    expect(parseSpokenEntry("10月8号 42元五角").amount).toBe("42.5");
    expect(parseSpokenEntry("四十二块五").amount).toBe("42.5");
    expect(parseSpokenEntry("四十二元五角").amount).toBe("42.5");
    // …and said fully in Chinese numerals.
    expect(parseSpokenEntry("十月八日在超市花了四十二块五").amount).toBe("42.5");
  });

  it("prefers the number next to a currency word", () => {
    // 三个 is a quantity; 25 元 is the price.
    expect(parseSpokenEntry("买了三个苹果 25 元").amount).toBe("25");
    expect(parseSpokenEntry("三个人吃饭三百块").amount).toBe("300");
  });

  it("keeps the date in the note, joined up, with the amount removed", () => {
    expect(parseSpokenEntry("今天午饭花了三十八块").note).toBe("今天午饭花了");
    expect(parseSpokenEntry("10 月 8 日在超市花了四十二块五").note).toBe("10月8日在超市花了");
    expect(parseSpokenEntry("9 月 21 日餐饮花费 88 元").note).toBe("9月21日餐饮花费");
  });

  it("keeps a foreign currency word in the note", () => {
    // There is no currency field yet: an amount of 12 with 「美元」 removed would
    // read as 12 yuan in the entry form.
    const spoken = parseSpokenEntry("12 美元，信用卡支付");

    expect(spoken.amount).toBe("12");
    expect(spoken.note).toContain("美元");
  });
});

describe("parseSpokenEntry: direction, currency and ambiguous numbers", () => {
  it("keeps income and refunds as income", () => {
    expect(parseSpokenEntry("收到工资 12000 元")).toMatchObject({ amount: "12000", kind: "income" });
    expect(parseSpokenEntry("退款 38 元")).toMatchObject({ amount: "38", kind: "income" });
    expect(parseSpokenEntry("收到工资一万二千").amount).toBe("12000");
  });

  it("reads 十四/四十 and 十五/五十 apart", () => {
    expect(parseSpokenEntry("十四块").amount).toBe("14");
    expect(parseSpokenEntry("四十块").amount).toBe("40");
    expect(parseSpokenEntry("十五块").amount).toBe("15");
    expect(parseSpokenEntry("五十块").amount).toBe("50");
    expect(parseSpokenEntry("五十四块").amount).toBe("54");
    expect(parseSpokenEntry("四十五块").amount).toBe("45");
  });

  it("recognises the currencies it scores as money", () => {
    expect(parseSpokenEntry("100 港币").amount).toBe("100");
    expect(parseSpokenEntry("20 欧元").amount).toBe("20");
    expect(parseSpokenEntry("38 人民币").amount).toBe("38");
    expect(parseSpokenEntry("12 美元").amount).toBe("12");
  });
});

describe("cleanNote", () => {
  it("collapses a run of separators into one", () => {
    expect(cleanNote("午饭，，， 和同事")).toBe("午饭，和同事");
  });

  it("removes a separator left at an edge", () => {
    expect(cleanNote("，午饭，")).toBe("午饭");
  });

  it("removes trailing sentence punctuation", () => {
    expect(cleanNote("午饭。")).toBe("午饭");
  });

  it("leaves an ordinary note alone", () => {
    expect(cleanNote("和同事吃午饭")).toBe("和同事吃午饭");
  });

  it("keeps a date written with spaces together", () => {
    // The note is what was said; turning the spaces of 「10 月 8 日」 into commas
    // read as broken text.
    expect(cleanNote("10 月 8 日在超市")).toBe("10月8日在超市");
    expect(cleanNote("下午 3 点在超市")).toBe("下午3点在超市");
  });
});

describe("isSpeechless", () => {
  it("recognises silence", () => {
    expect(isSpeechless("")).toBe(true);
    expect(isSpeechless("   ")).toBe(true);
  });

  it("recognises whisper's own annotations", () => {
    // Whisper answers a non-speech sound with a bracketed marker. Offering to
    // file one as a note would be offering to save nonsense.
    expect(isSpeechless("[BLANK_AUDIO]")).toBe(true);
    expect(isSpeechless("(字幕:J Chong)")).toBe(true);
    expect(isSpeechless("【音乐】")).toBe(true);
  });

  it("does not mistake real speech for noise", () => {
    expect(isSpeechless("午饭 38")).toBe(false);
    expect(isSpeechless("嗯")).toBe(false);
  });
});
