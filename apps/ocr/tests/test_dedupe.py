"""Tests for suspected-duplicate detection.

The rules under test are:

  * same transaction inside one image is grouped;
  * same transaction across two images is grouped as 跨图重复;
  * a ledger entry with the same date/time/amount/currency/direction is flagged;
  * nothing is ever removed, merged or silently excluded;
  * different transactions that merely share an amount are *not* flagged.
"""

from __future__ import annotations

import unittest

from dedupe import (
    ExistingEntry,
    amount_value,
    find_cross_image,
    find_duplicates,
    find_within_image,
    mark_duplicates,
    merchants_comparable,
)
from layouts import classify
from model import Candidate
from multi_extract import extract_page
from tests import fixtures


def candidate(
    candidate_id: str = "c1",
    *,
    image_index: int = 0,
    amount: str | None = "32.00",
    currency: str | None = "CNY",
    direction: str = "expense",
    date: str | None = "2026-10-09",
    time: str | None = "12:34",
    merchant: str | None = "麦当劳",
    serial: str | None = None,
) -> Candidate:
    return Candidate(
        candidate_id=candidate_id,
        image_index=image_index,
        amount=amount,
        currency=currency,
        direction=direction,
        occurred_local_date=date,
        occurred_time=time,
        merchant=merchant,
        serial=serial,
    )


def two_page_candidates() -> list[Candidate]:
    """The same Alipay list twice, as two uploaded images."""

    lines = fixtures.alipay_transaction_list()
    first = classify(lines)
    return [
        *extract_page(lines, first, image_index=0).candidates,
        *extract_page(lines, first, image_index=1).candidates,
    ]


class WithinImageTest(unittest.TestCase):
    def test_identical_rows_inside_one_image_are_grouped(self) -> None:
        candidates = [candidate("a"), candidate("b")]

        groups = find_within_image(candidates)

        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0].kind, "same-image")
        self.assertEqual(groups[0].candidate_ids, ("a", "b"))
        self.assertIn("金额", groups[0].reason)

    def test_different_serial_numbers_are_a_strong_negative(self) -> None:
        candidates = [
            candidate("a", serial="4200000000000001"),
            candidate("b", serial="4200000000000002"),
        ]

        self.assertEqual(find_within_image(candidates), ())

    def test_same_serial_but_conflicting_amount_is_still_flagged(self) -> None:
        # Same transaction number with a different amount is a data conflict the
        # user must see, not two transactions.
        candidates = [
            candidate("a", amount="32.00", serial="4200000000000001"),
            candidate("b", amount="33.00", serial="4200000000000001"),
        ]

        groups = find_within_image(candidates)

        self.assertEqual(len(groups), 1)
        self.assertIn("金额不同", groups[0].reason)

    def test_same_amount_different_merchant_is_not_a_duplicate(self) -> None:
        candidates = [
            candidate("a", merchant="麦当劳"),
            candidate("b", merchant="小杨生煎"),
        ]

        self.assertEqual(find_within_image(candidates), ())

    def test_same_amount_different_day_is_not_a_duplicate(self) -> None:
        candidates = [
            candidate("a", date="2026-10-09"),
            candidate("b", date="2026-10-10"),
        ]

        self.assertEqual(find_within_image(candidates), ())

    def test_a_missing_date_cannot_be_matched_by_values(self) -> None:
        candidates = [
            candidate("a", date=None),
            candidate("b", date=None),
        ]

        # Two unknowns must not be described as "the same".
        self.assertEqual(find_within_image(candidates), ())


class CrossImageTest(unittest.TestCase):
    def test_the_same_list_uploaded_twice_is_flagged_across_images(self) -> None:
        candidates = two_page_candidates()

        groups = find_cross_image(candidates)

        self.assertEqual(len(groups), 3)
        self.assertTrue(all(group.kind == "cross-image" for group in groups))
        self.assertEqual(len({candidate.candidate_id for candidate in candidates}), 6)
        reported = [candidate_id for group in groups for candidate_id in group.candidate_ids]
        self.assertEqual(len(reported), 6)
        self.assertEqual(
            {group.group_id for group in groups},
            {"dup-cross-1", "dup-cross-2", "dup-cross-3"},
        )

    def test_identical_wechat_details_across_images_are_grouped_by_serial(self) -> None:
        lines = fixtures.wechat_single_detail()
        first = extract_page(lines, classify(lines), image_index=0).candidates[0]
        second = extract_page(lines, classify(lines), image_index=1).candidates[0]

        groups = find_cross_image([first, second])

        self.assertEqual(len(groups), 1)
        self.assertIn("交易单号", groups[0].reason)


class AgainstExistingTest(unittest.TestCase):
    def test_an_existing_entry_with_the_same_values_is_flagged(self) -> None:
        existing = [
            ExistingEntry(
                entry_id="tx-1",
                direction="expense",
                amount_minor=2000,
                currency="CNY",
                occurred_local_date="2026-10-09",
                occurred_time="12:34",
            )
        ]
        lines = fixtures.wechat_single_detail()
        extracted = extract_page(lines, classify(lines)).candidates

        report = find_duplicates(list(extracted), existing)

        self.assertEqual(report.existing_count, 1)
        group = report.groups[0]
        self.assertEqual(group.kind, "existing-entry")
        self.assertEqual(group.existing_entry_ids, ("tx-1",))
        self.assertEqual(group.candidate_ids, ("img0-1",))
        self.assertIn("img0-1", report.duplicate_candidate_ids)

    def test_a_different_time_is_not_the_same_moment(self) -> None:
        existing = [
            ExistingEntry(
                entry_id="tx-1",
                direction="expense",
                amount_minor=2000,
                currency="CNY",
                occurred_local_date="2026-10-09",
                occurred_time="15:00",
            )
        ]
        lines = fixtures.wechat_single_detail()
        extracted = extract_page(lines, classify(lines)).candidates

        self.assertEqual(find_duplicates(list(extracted), existing).existing_count, 0)

    def test_direction_must_match(self) -> None:
        existing = [
            ExistingEntry(
                entry_id="tx-1",
                direction="income",
                amount_minor=2000,
                currency="CNY",
                occurred_local_date="2026-10-09",
                occurred_time="12:34",
            )
        ]
        lines = fixtures.wechat_single_detail()
        extracted = extract_page(lines, classify(lines)).candidates

        self.assertEqual(find_duplicates(list(extracted), existing).existing_count, 0)

    def test_the_same_money_recorded_by_two_apps_is_not_claimed(self) -> None:
        # 跨来源重复口径 is an owner decision (design direction §10.4); equal values
        # across different platforms are not silently declared duplicates. This
        # test pins the current, conservative behaviour so a future change is a
        # deliberate one.
        wechat = extract_page(
            fixtures.wechat_single_detail(), classify(fixtures.wechat_single_detail())
        ).candidates
        existing = [
            ExistingEntry(
                entry_id="tx-1",
                direction="expense",
                amount_minor=2000,
                currency="CNY",
                occurred_local_date="2026-10-09",
                occurred_time="12:34",
            )
        ]

        report = find_duplicates(list(wechat), existing)

        # Same values *are* flagged here; the platform is not consulted, which is
        # the documented behaviour: it is a suspicion for the user, not a verdict.
        self.assertEqual(report.existing_count, 1)


class MarkingTest(unittest.TestCase):
    def test_marking_adds_ids_and_a_visible_issue_without_removing_anything(self) -> None:
        candidates = [candidate("a"), candidate("b")]
        report = find_duplicates(candidates)

        mark_duplicates(candidates, report)

        for item in candidates:
            self.assertEqual(item.duplicate_group_ids, ["dup-same-1"])
            self.assertTrue(item.duplicate_suspected)
            self.assertTrue(any(issue.code == "duplicate_suspected" for issue in item.issues))
        self.assertEqual(len(candidates), 2)


class ValueHelpersTest(unittest.TestCase):
    def test_amount_value_handles_thousands_and_unreadable_amounts(self) -> None:
        self.assertEqual(amount_value(candidate(amount="1,280.00")), 1280)
        self.assertIsNone(amount_value(candidate(amount=None)))
        self.assertIsNone(amount_value(candidate(amount="待确认")))

    def test_merchant_similarity(self) -> None:
        self.assertTrue(merchants_comparable("APPLE.COM/BILL", "apple.com/bill"))
        self.assertTrue(merchants_comparable("麦当劳", "麦当劳（国贸店）"))
        self.assertFalse(merchants_comparable("麦当劳", "小杨生煎"))
        # Missing text never blocks a match; other evidence decides.
        self.assertTrue(merchants_comparable(None, "麦当劳"))


if __name__ == "__main__":
    unittest.main()
