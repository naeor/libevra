import { describe, expect, it } from "vitest";

import { chineseNumeralToDigits, findChineseAmount } from "./chineseNumerals.js";

/**
 * Reading amounts written in Chinese numerals.
 *
 * The owner's observation was "他似乎对汉字大写的数字不太敏感", which turned out to be
 * this module's absence rather than the recogniser's fault: whisper writes 三十八
 * for an unclear "三十八" and 叁佰捌拾 for a formal one, and only digits were
 * understood.
 */
describe("chineseNumeralToDigits", () => {
  it("reads a bare digit", () => {
    expect(chineseNumeralToDigits("五")).toBe("5");
  });

  it("reads tens and hundreds", () => {
    expect(chineseNumeralToDigits("十")).toBe("10");
    expect(chineseNumeralToDigits("十五")).toBe("15");
    expect(chineseNumeralToDigits("三十八")).toBe("38");
    expect(chineseNumeralToDigits("三百")).toBe("300");
    expect(chineseNumeralToDigits("三百八十")).toBe("380");
  });

  it("reads a leading unit as one of it", () => {
    // 「十五」 is fifteen; nobody says 一十五 in ordinary speech.
    expect(chineseNumeralToDigits("十五")).toBe("15");
    expect(chineseNumeralToDigits("十八")).toBe("18");
  });

  it("reads thousands and the ten-thousands unit", () => {
    expect(chineseNumeralToDigits("两千")).toBe("2000");
    // ⚠️ The owner was explicit: **一万二 = 12000**, not 10002. The old assertion
    // here said 10002 because every trailing digit was read as ones.
    expect(chineseNumeralToDigits("一万二")).toBe("12000");
    expect(chineseNumeralToDigits("一万二千")).toBe("12000");
    expect(chineseNumeralToDigits("十二万")).toBe("120000");
  });

  it("fills in a unit the speaker left out", () => {
    // Colloquial amounts elide the last unit: 一万二 is 一万二千, 三百五 is
    // 三百五十. The missing unit is one level below the last unit actually said
    // (万→千, 千→百, 百→十), which is that unit divided by ten.
    expect(chineseNumeralToDigits("一万二")).toBe("12000");
    expect(chineseNumeralToDigits("两万三")).toBe("23000");
    expect(chineseNumeralToDigits("三千五")).toBe("3500");
    expect(chineseNumeralToDigits("五百六")).toBe("560");
    expect(chineseNumeralToDigits("三百五")).toBe("350");
    expect(chineseNumeralToDigits("一百二")).toBe("120");
    expect(chineseNumeralToDigits("一千二")).toBe("1200");
    expect(chineseNumeralToDigits("五千六")).toBe("5600");
    expect(chineseNumeralToDigits("一万二千三")).toBe("12300");
    expect(chineseNumeralToDigits("一亿二")).toBe("120000000");
  });

  it("does not invent a unit when the number is already complete", () => {
    // The elision rule only changes the value when the last unit said is above
    // the ones place; 一百二十三 already ends at ones, so its 3 stays 3.
    expect(chineseNumeralToDigits("一万二千")).toBe("12000");
    expect(chineseNumeralToDigits("三千五百")).toBe("3500");
    expect(chineseNumeralToDigits("二百")).toBe("200");
    expect(chineseNumeralToDigits("二十")).toBe("20");
    expect(chineseNumeralToDigits("一百二十三")).toBe("123");
    expect(chineseNumeralToDigits("十五")).toBe("15");
    expect(chineseNumeralToDigits("一万一千")).toBe("11000");
  });

  it("treats 零 as an explicit ones position", () => {
    // 零 tells the listener the low position is ones, so 一万零二 stays 10002
    // while 一万二 is 12000. The marker is what separates the two readings.
    expect(chineseNumeralToDigits("一百零二")).toBe("102");
    expect(chineseNumeralToDigits("三百零五")).toBe("305");
    expect(chineseNumeralToDigits("一万零二")).toBe("10002");
    expect(chineseNumeralToDigits("一千零二十")).toBe("1020");
  });

  it("keeps a bare digit or single unit unchanged", () => {
    expect(chineseNumeralToDigits("五")).toBe("5");
    expect(chineseNumeralToDigits("两")).toBe("2");
    expect(chineseNumeralToDigits("十")).toBe("10");
    expect(chineseNumeralToDigits("十五")).toBe("15");
  });

  it("reads the formal cheque-writing characters", () => {
    // The case the owner hit: money written the way a bank writes it.
    expect(chineseNumeralToDigits("叁佰捌拾")).toBe("380");
    expect(chineseNumeralToDigits("壹佰贰拾")).toBe("120");
    expect(chineseNumeralToDigits("伍拾")).toBe("50");
    expect(chineseNumeralToDigits("玖")).toBe("9");
  });

  it("reads 两 as two", () => {
    // 「两」 is how two is said before a measure word: 两块, 两百.
    expect(chineseNumeralToDigits("两")).toBe("2");
    expect(chineseNumeralToDigits("两百")).toBe("200");
  });

  it("stops at a unit character, which the caller strips", () => {
    // The function reads numerals, not money: 元 and 块 are the caller's business.
    // This is asserted so the boundary does not quietly move.
    expect(chineseNumeralToDigits("十八块")).toBeNull();
    expect(findChineseAmount("十八块")?.value).toBe("18");
  });

  it("reads zeros without losing the magnitude", () => {
    // 三百零五 is 305, not 35 and not 3005.
    expect(chineseNumeralToDigits("三百零五")).toBe("305");
    expect(chineseNumeralToDigits("一千零二十")).toBe("1020");
  });

  it("reads a spoken decimal point", () => {
    expect(chineseNumeralToDigits("三点五")).toBe("3.5");
    expect(chineseNumeralToDigits("三点一四")).toBe("3.14");
    expect(chineseNumeralToDigits("十八点八")).toBe("18.8");
  });

  it("keeps money exact rather than going through a float", () => {
    // ⚠️ The reason the conversion is string-based. 三百 and 3 differ by a
    // hundred, and 0.1 + 0.2 is not 0.3; an amount must not be assembled by
    // arithmetic that can round.
    expect(chineseNumeralToDigits("一千二百三十四点五六")).toBe("1234.56");
    expect(chineseNumeralToDigits("三点七")).toBe("3.7");
  });

  it("drops a trailing zero after the point", () => {
    // 「三点零」 is how somebody says "three point zero", but "3.0" is not how an
    // amount is typed.
    expect(chineseNumeralToDigits("三点零")).toBe("3");
  });

  it("refuses a run that is not a number", () => {
    // Guessing here would turn a stray character into an amount.
    expect(chineseNumeralToDigits("")).toBeNull();
    expect(chineseNumeralToDigits("万")).toBeNull();
    expect(chineseNumeralToDigits("午饭")).toBeNull();
  });
});

describe("findChineseAmount", () => {
  it("finds the amount and where it was", () => {
    const found = findChineseAmount("午饭三百八十");

    expect(found?.value).toBe("380");
    expect(found?.index).toBe(2);
  });

  it("prefers a run followed by a currency word", () => {
    // ⚠️ The case a plain "first number wins" gets wrong: 三个人 is a number, but
    // 三百块 is the price.
    const found = findChineseAmount("三个人吃饭三百块");

    expect(found?.value).toBe("300");
  });

  it("takes the longest run when nothing marks the currency", () => {
    const found = findChineseAmount("三个人吃饭三百");

    expect(found?.value).toBe("300");
  });

  it("finds the formal characters too", () => {
    expect(findChineseAmount("买菜叁佰捌拾元")?.value).toBe("380");
  });

  it("finds an amount whose last unit was left out", () => {
    // Sentence level, because that is how the number arrives from recognition.
    expect(findChineseAmount("午饭一万二")?.value).toBe("12000");
    expect(findChineseAmount("打车三百五")?.value).toBe("350");
    expect(findChineseAmount("买了个三千五的耳机")?.value).toBe("3500");
    expect(findChineseAmount("工资一万二")?.value).toBe("12000");
    // Regression: a numeral that was already complete must still read as before.
    expect(findChineseAmount("买菜六十四")?.value).toBe("64");
  });

  it("returns null when there is no number", () => {
    expect(findChineseAmount("午饭吃的是拉面")).toBeNull();
  });

  it("does not hang on a sentence with no numerals", () => {
    // A cap on the run length keeps a long recording from turning into a scan per
    // character position.
    const long = "啊".repeat(20_000);
    expect(findChineseAmount(long)).toBeNull();
  });
});
