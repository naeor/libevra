"""The sidecar's response shape.

S15-B changes what a recognition response *means*: it now answers "how many
transactions does this page hold?" as well as "what was the one transaction?".
Two contracts therefore have to hold at once, and both are tested here:

  * the S5 single-entry fields (`draft`) are unchanged, so the existing screens
    keep working;
  * the new fields (`page_type`, `requires_user_choice`, `candidates`,
    `warnings`) are present and JSON-serialisable, so the API can pass them on
    and the web can assemble a batch.

No OCR models are loaded: `describe_page` takes lines, not an image. That is the
point of separating it from `recognise` — the protocol can be pinned down in
milliseconds instead of by standing up the recogniser.
"""

from __future__ import annotations

import json
import unittest

from service import _year_of, describe_page
from tests import fixtures


class DescribePageTest(unittest.TestCase):
    def test_single_detail_keeps_one_candidate_and_its_legacy_fields(self) -> None:
        page = describe_page(
            fixtures.wechat_single_detail(),
            image_index=0,
            reference_year=2026,
            reference_date="2026-10-20",
        )

        self.assertEqual(page["page_type"], "single-detail")
        self.assertEqual(page["page_type_label"], "单笔详情")
        self.assertFalse(page["requires_user_choice"])
        self.assertEqual(len(page["candidates"]), 1)
        self.assertEqual(page["candidates"][0]["amount"], "20.00")
        self.assertEqual(page["candidates"][0]["direction"], "expense")
        self.assertEqual(page["candidates"][0]["candidate_id"], "img0-1")
        self.assertEqual(page["image_index"], 0)

    def test_transaction_list_is_cut_into_several_candidates(self) -> None:
        page = describe_page(
            fixtures.wechat_transaction_list(),
            image_index=2,
            reference_year=2026,
            reference_date="2026-10-20",
        )

        self.assertEqual(page["page_type"], "transaction-list")
        self.assertFalse(page["requires_user_choice"])
        self.assertEqual(len(page["candidates"]), 3)
        # The index reaches the candidate id, so two images cannot collide.
        self.assertEqual(
            [candidate["candidate_id"] for candidate in page["candidates"]],
            ["img2-1", "img2-2", "img2-3"],
        )
        self.assertEqual(
            [candidate["amount"] for candidate in page["candidates"]],
            ["32.00", "18.50", "100.00"],
        )

    def test_unknown_page_claims_no_count_and_asks_the_user(self) -> None:
        page = describe_page(fixtures.unknown_page(), reference_date="2026-10-20")

        self.assertEqual(page["page_type"], "unknown")
        self.assertEqual(page["candidates"], [])
        self.assertTrue(page["requires_user_choice"])
        self.assertTrue(any("无法判断" in warning for warning in page["warnings"]))

    def test_empty_page_is_unknown_and_does_not_crash(self) -> None:
        page = describe_page([], reference_date="2026-10-20")

        self.assertEqual(page["page_type"], "unknown")
        self.assertEqual(page["candidates"], [])
        self.assertTrue(page["requires_user_choice"])

    def test_the_response_is_json_serialisable(self) -> None:
        page = describe_page(
            fixtures.wechat_bill_cards(),
            reference_year=2026,
            reference_date="2026-10-20",
        )

        # `ensure_ascii=False` is how the service writes it; a value that cannot
        # be encoded would fail only in production, at the pipe.
        encoded = json.dumps(page, ensure_ascii=False)
        self.assertIn("candidates", encoded)
        self.assertIn("page_type", encoded)

    def test_every_candidate_carries_the_fields_the_overview_reads(self) -> None:
        page = describe_page(
            fixtures.alipay_transaction_list(),
            reference_year=2026,
            reference_date="2026-10-20",
        )

        candidate = page["candidates"][0]
        for key in (
            "candidate_id",
            "image_index",
            "amount",
            "currency",
            "direction",
            "occurred_local_date",
            "occurred_time",
            "merchant",
            "source_platform",
            "account",
            "note",
            "status",
            "is_refund",
            "is_transfer",
            "serial",
            "issues",
            "duplicate_suspected",
            "is_complete",
            "is_questionable",
        ):
            self.assertIn(key, candidate)

    def test_relative_dates_use_the_reference_date(self) -> None:
        page = describe_page(
            fixtures.alipay_bill_with_relative_dates(),
            reference_year=2026,
            reference_date="2026-10-20",
        )

        dates = [candidate["occurred_local_date"] for candidate in page["candidates"]]
        self.assertIn("2026-10-20", dates)

    def test_without_a_reference_date_a_relative_date_stays_a_question(self) -> None:
        page = describe_page(fixtures.alipay_bill_with_relative_dates())

        # No calendar date is invented from `今天` when the screenshot date is
        # unknown; the issue stays visible instead.
        self.assertTrue(
            any(
                issue["code"] in ("missing_date", "relative_date", "missing_year")
                for candidate in page["candidates"]
                for issue in candidate["issues"]
            )
        )


class YearOfTest(unittest.TestCase):
    def test_reads_a_calendar_date(self) -> None:
        self.assertEqual(_year_of("2026-10-20"), 2026)

    def test_refuses_anything_else(self) -> None:
        self.assertIsNone(_year_of("today"))
        self.assertIsNone(_year_of(""))


if __name__ == "__main__":
    unittest.main()
