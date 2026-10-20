import { describe, expect, it } from "vitest";

import {
  duplicateReason,
  findSuspectedDuplicates,
  withDuplicateMarks,
} from "./duplicates.js";
import { batchCandidate } from "./testFixtures.js";

/**
 * The duplicate rule is a *prompt*, not a decision.
 *
 * These tests pin the two things the product cares about: the same transaction
 * seen twice is surfaced (same image and across images), and editing a number
 * makes the prompt go away instead of leaving a stale warning.
 */
describe("duplicateReason", () => {
  it("matches equal money in the same direction at the same time", () => {
    expect(duplicateReason(batchCandidate(), batchCandidate({ candidateId: "img1-1" }))).toBe(
      "金额、币种、方向、日期、时间都相同",
    );
  });

  it("does not treat two different merchants as one transaction", () => {
    expect(
      duplicateReason(
        batchCandidate(),
        batchCandidate({ candidateId: "img1-1", merchant: "中石化加油站" }),
      ),
    ).toBeNull();
  });

  it("absorbs OCR differences in the merchant text", () => {
    // A missing space/punctuation must not hide the duplicate.
    expect(
      duplicateReason(
        batchCandidate({ merchant: "Starbucks Coffee" }),
        batchCandidate({ candidateId: "img1-1", merchant: "STARBUCKSCOFFEE" }),
      ),
    ).not.toBeNull();
  });

  it("uses the 60-second window and refuses a minute later", () => {
    expect(
      duplicateReason(
        batchCandidate({ occurredTime: "12:34" }),
        batchCandidate({ candidateId: "img1-1", occurredTime: "12:35" }),
      ),
    ).not.toBeNull();

    expect(
      duplicateReason(
        batchCandidate({ occurredTime: "12:34" }),
        batchCandidate({ candidateId: "img1-1", occurredTime: "12:36" }),
      ),
    ).toBeNull();
  });

  it("treats a missing time as weak evidence, not a contradiction", () => {
    expect(
      duplicateReason(
        batchCandidate({ occurredTime: null }),
        batchCandidate({ candidateId: "img1-1", occurredTime: "12:34" }),
      ),
    ).toBe("金额、币种、方向、日期相同（时间缺失，可能无法区分同日多笔）");
  });

  it("never guesses a direction or a date", () => {
    expect(
      duplicateReason(
        batchCandidate({ direction: "unknown" }),
        batchCandidate({ candidateId: "img1-1" }),
      ),
    ).toBeNull();
    expect(
      duplicateReason(
        batchCandidate({ occurredLocalDate: null }),
        batchCandidate({ candidateId: "img1-1" }),
      ),
    ).toBeNull();
  });

  it("defaults to the printed serial when both screens have one", () => {
    const left = batchCandidate({ serial: "4200002318202610091234567890" });
    const right = batchCandidate({
      candidateId: "img1-1",
      serial: "4200002318202610091234567890",
    });
    expect(duplicateReason(left, right)).toBe("交易单号相同");

    expect(
      duplicateReason(left, batchCandidate({ candidateId: "img1-1", serial: "999999999999999" })),
    ).toBeNull();
  });

  it("flags the same serial with a different amount rather than ignoring it", () => {
    expect(
      duplicateReason(
        batchCandidate({ serial: "4200002318202610091234567890" }),
        batchCandidate({
          candidateId: "img1-1",
          serial: "4200002318202610091234567890",
          amount: "21.00",
        }),
      ),
    ).toBe("交易单号相同但金额不同，疑似同一笔，请核对");
  });
});

describe("findSuspectedDuplicates", () => {
  it("separates overlaps inside one screenshot from overlaps across screenshots", () => {
    const groups = findSuspectedDuplicates([
      batchCandidate({ candidateId: "img0-1" }),
      // Same image, same money: an overlap inside a long screenshot.
      batchCandidate({ candidateId: "img0-2" }),
      // Another screenshot showing the same transaction.
      batchCandidate({ candidateId: "img1-1", imageIndex: 1 }),
    ]);

    expect(groups.map((group) => group.kind)).toEqual(["same-image", "cross-image"]);
    expect(groups.map((group) => group.candidateIds)).toEqual([
      ["img0-1", "img0-2"],
      // All three screenshots show the same money, so the cross-image component
      // contains the in-image pair as well: one decision, not two conflicting ones.
      ["img0-1", "img0-2", "img1-1"],
    ]);
    // The second screenshot's candidate appears in a cross-image group too; each
    // candidate is not restricted to one group.
    expect(groups[1]?.message).toContain("重复上传");
  });

  it("does not link two unrelated rows of the same amount on the same day", () => {
    expect(
      findSuspectedDuplicates([
        batchCandidate({ candidateId: "img0-1", occurredTime: "09:00", merchant: "早餐店" }),
        batchCandidate({ candidateId: "img0-2", occurredTime: "18:00", merchant: "晚餐店" }),
      ]),
    ).toEqual([]);
  });
});

describe("withDuplicateMarks", () => {
  it("marks both copies and keeps the user's edits authoritative", () => {
    const first = withDuplicateMarks([
      batchCandidate(),
      batchCandidate({ candidateId: "img1-1", imageIndex: 1 }),
    ]);

    expect(first.groups).toHaveLength(1);
    expect(first.items.every((item) => item.duplicateSuspected)).toBe(true);

    // The user changes the amount in the detail screen: the prompt must vanish.
    const edited = first.items.map((item) =>
      item.candidateId === "img1-1" ? { ...item, amount: "21.00" } : item,
    );
    const second = withDuplicateMarks(edited);

    expect(second.groups).toEqual([]);
    expect(second.items.every((item) => !item.duplicateSuspected)).toBe(true);
  });

  it("never deletes or invalidates a candidate", () => {
    const items = [batchCandidate(), batchCandidate({ candidateId: "img0-2" })];
    const marked = withDuplicateMarks(items);

    expect(marked.items).toHaveLength(2);
    expect(marked.items.every((item) => item.invalid === false)).toBe(true);
  });
});
