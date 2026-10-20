"""Tests for multi-transaction cutting and field extraction.

The rules under test are the S15-B product rules, not "the reader is smart":

  * a detail page produces exactly one candidate;
  * a list produces one candidate per transaction;
  * an unknown page produces none and asks the user;
  * a field that was not read stays empty with an issue - it never becomes a
    plausible default;
  * a row with several numbers does not get a guessed amount.
"""

from __future__ import annotations

import unittest

from layouts import (
    ExtractionSpec,
    LayoutDescriptor,
    LayoutFeatures,
    classify,
    register_layout,
    reset_layouts,
)
from multi_extract import (
    CUSTOM_EXTRACTORS,
    extract_page,
    extract_pages,
    register_custom_extractor,
)
from model import Candidate
from tests import fixtures


def page_of(lines):
    classification = classify(lines)
    return extract_page(lines, classification)


def codes(candidate: Candidate) -> set[str]:
    return {issue.code for issue in candidate.issues}


class SingleDetailTest(unittest.TestCase):
    def test_wechat_detail_yields_one_complete_candidate(self) -> None:
        extraction = page_of(fixtures.wechat_single_detail())

        self.assertEqual(len(extraction.candidates), 1)
        candidate = extraction.candidates[0]
        self.assertEqual(candidate.amount, "20.00")
        self.assertEqual(candidate.currency, "CNY")
        self.assertEqual(candidate.direction, "expense")
        self.assertEqual(candidate.occurred_local_date, "2026-10-09")
        self.assertEqual(candidate.occurred_time, "12:34")
        self.assertEqual(candidate.merchant, "老王便利店")
        self.assertEqual(candidate.account, "零钱")
        self.assertEqual(candidate.status, "posted")
        self.assertEqual(candidate.serial, "4200002318202610091234567890")
        self.assertEqual(candidate.source_platform, "WECHAT")
        self.assertFalse(candidate.is_refund)
        self.assertFalse(candidate.is_transfer)
        self.assertEqual(codes(candidate), set())
        self.assertTrue(candidate.is_complete)
        self.assertFalse(candidate.is_questionable)

    def test_alipay_received_money_is_income_with_the_payer_as_counterparty(self) -> None:
        extraction = page_of(fixtures.alipay_single_detail())

        candidate = extraction.candidates[0]
        self.assertEqual(candidate.amount, "1280.00")
        self.assertEqual(candidate.direction, "income")
        self.assertEqual(candidate.merchant, "张*")
        self.assertEqual(candidate.source_platform, "ALIPAY")

    def test_bank_transfer_detail_is_one_transfer_flagged_unverified(self) -> None:
        extraction = page_of(fixtures.bank_transfer_detail())

        self.assertEqual(len(extraction.candidates), 1)
        candidate = extraction.candidates[0]
        self.assertEqual(candidate.amount, "3500.00")
        self.assertTrue(candidate.is_transfer)
        self.assertEqual(candidate.account, "尾号 6688")
        # The layout has only a synthetic sample, so the candidate must carry the
        # warning instead of looking verified.
        self.assertIn("layout_unverified", codes(candidate))
        self.assertFalse(extraction.classification.verified)

    def test_a_digital_mark_that_was_not_read_becomes_a_visible_assumption(self) -> None:
        # No currency symbol in this page at all, but the source is WeChat: CNY
        # is filled from the platform and marked, not presented as read.
        lines = [line for line in fixtures.wechat_single_detail() if line.text.strip() != "¥"]
        candidate = page_of(lines).candidates[0]

        self.assertEqual(candidate.currency, "CNY")
        self.assertIn("currency_assumed", codes(candidate))


class TransactionListTest(unittest.TestCase):
    def test_wechat_list_is_cut_into_one_candidate_per_row(self) -> None:
        extraction = page_of(fixtures.wechat_transaction_list())

        self.assertEqual(len(extraction.candidates), 3)
        self.assertEqual(
            [candidate.candidate_id for candidate in extraction.candidates],
            ["img0-1", "img0-2", "img0-3"],
        )
        self.assertEqual(
            [candidate.amount for candidate in extraction.candidates],
            ["32.00", "18.50", "100.00"],
        )
        self.assertEqual(
            [candidate.merchant for candidate in extraction.candidates],
            ["麦当劳", "小杨生煎", "转账-来自张三"],
        )
        self.assertEqual(
            [candidate.direction for candidate in extraction.candidates],
            ["expense", "expense", "income"],
        )
        self.assertTrue(extraction.candidates[2].is_transfer)

    def test_list_rows_without_a_year_do_not_get_an_invented_date(self) -> None:
        extraction = page_of(fixtures.wechat_transaction_list())

        for candidate in extraction.candidates:
            self.assertIsNone(candidate.occurred_local_date)
            self.assertIn("missing_year", codes(candidate))
            # The time *was* printed, so it is kept.
            self.assertIsNotNone(candidate.occurred_time)

    def test_a_reference_year_is_used_but_flagged_for_every_row(self) -> None:
        lines = fixtures.wechat_transaction_list()
        classification = classify(lines)
        extraction = extract_page(lines, classification, reference_year=2026)

        self.assertEqual(extraction.candidates[0].occurred_local_date, "2026-10-09")
        self.assertIn("year_inferred", codes(extraction.candidates[0]))

    def test_alipay_list_recognises_a_refund_row_as_income(self) -> None:
        extraction = page_of(fixtures.alipay_transaction_list())

        self.assertEqual(len(extraction.candidates), 3)
        refund = extraction.candidates[2]
        self.assertEqual(refund.amount, "35.60")
        self.assertTrue(refund.is_refund)
        self.assertEqual(refund.direction, "income")

    def test_boa_rows_are_cut_and_the_layout_is_reported_unverified(self) -> None:
        extraction = page_of(fixtures.boa_activity_list())

        self.assertEqual(len(extraction.candidates), 2)
        amounts = [candidate.amount for candidate in extraction.candidates]
        self.assertEqual(amounts, ["328.00", "2500.00"])
        directions = [candidate.direction for candidate in extraction.candidates]
        self.assertEqual(directions, ["expense", "income"])
        self.assertIn("layout_unverified", codes(extraction.candidates[0]))
        # BOA statements are USD; the default is visible as an assumption.
        self.assertIn("currency_assumed", codes(extraction.candidates[0]))

    def test_a_row_with_amount_and_balance_columns_does_not_guess(self) -> None:
        extraction = page_of(fixtures.boa_activity_list_with_balance_column())

        self.assertEqual(len(extraction.candidates), 2)
        self.assertEqual(
            [candidate.merchant for candidate in extraction.candidates],
            ["APPLE.COM/BILL  CUPERTINO", "PAYROLL  ACME CORP"],
        )
        for candidate in extraction.candidates:
            self.assertIsNone(candidate.amount)
            self.assertIn("amount_uncertain", codes(candidate))


class UnknownTest(unittest.TestCase):
    def test_an_unknown_page_yields_no_candidates_and_asks(self) -> None:
        extraction = page_of(fixtures.unknown_page())

        self.assertEqual(extraction.candidates, ())
        self.assertTrue(extraction.requires_user_choice)
        self.assertTrue(any("选择按单笔还是按多笔" in warning for warning in extraction.warnings))

    def test_no_lines_yields_no_candidates(self) -> None:
        extraction = page_of([])

        self.assertEqual(extraction.candidates, ())
        self.assertTrue(extraction.requires_user_choice)


class MultiPageTest(unittest.TestCase):
    def test_pages_are_extracted_in_upload_order_with_image_indexes(self) -> None:
        pages = [
            (0, fixtures.wechat_transaction_list()),
            (1, fixtures.wechat_transaction_list()),
        ]
        extractions = extract_pages(pages)

        self.assertEqual([extraction.image_index for extraction in extractions], [0, 1])
        ids = [candidate.candidate_id for extraction in extractions for candidate in extraction.candidates]
        self.assertEqual(ids[:3], ["img0-1", "img0-2", "img0-3"])
        self.assertEqual(ids[3:], ["img1-1", "img1-2", "img1-3"])

    def test_a_detail_page_and_a_list_page_can_share_one_batch(self) -> None:
        pages = [
            (0, fixtures.wechat_single_detail()),
            (1, fixtures.wechat_transaction_list()),
        ]
        extractions = extract_pages(pages)

        self.assertEqual(len(extractions[0].candidates), 1)
        self.assertEqual(len(extractions[1].candidates), 3)


class CustomExtractorTest(unittest.TestCase):
    def tearDown(self) -> None:
        reset_layouts()
        CUSTOM_EXTRACTORS.clear()

    def test_a_layout_can_supply_its_own_row_cutter_without_touching_the_main_flow(self) -> None:
        register_custom_extractor(
            "test-fixed",
            lambda lines, context: [
                Candidate(
                    candidate_id=f"img{context.image_index}-9",
                    image_index=context.image_index,
                    amount="1.23",
                    currency="CNY",
                    direction="expense",
                    occurred_local_date="2026-01-01",
                    merchant="自定义银行",
                )
            ],
        )
        register_layout(
            LayoutDescriptor(
                id="test-custom-detail",
                label="测试自定义版式",
                page_type="single-detail",
                platform="BANK",
                verified=False,
                sample=None,
                features=LayoutFeatures(
                    structure="single-detail",
                    platform_markers=("测试来源",),
                    min_detail_labels=0,
                ),
                extraction=ExtractionSpec(strategy="custom", custom_extractor="test-fixed"),
            )
        )
        page = [
            fixtures.L("测试来源", 60, 380, 34),
            fixtures.L("88.00", 350, 340, 100),
            fixtures.L("收款方", 543, 36),
            fixtures.L("某某", 543, 620),
        ]

        extraction = page_of(page)

        self.assertEqual(extraction.candidates[0].candidate_id, "img0-9")
        self.assertEqual(extraction.candidates[0].amount, "1.23")

    def test_an_unregistered_custom_extractor_falls_back_with_a_warning(self) -> None:
        register_layout(
            LayoutDescriptor(
                id="test-missing-extractor",
                label="缺少抽取器的版式",
                page_type="single-detail",
                platform="BANK",
                verified=False,
                sample=None,
                features=LayoutFeatures(
                    structure="single-detail",
                    platform_markers=("测试来源",),
                    min_detail_labels=0,
                ),
                extraction=ExtractionSpec(strategy="custom", custom_extractor="does-not-exist"),
            )
        )
        page = [
            fixtures.L("测试来源", 60, 380, 34),
            fixtures.L("88.00", 350, 340, 100),
            fixtures.L("收款方", 543, 36),
            fixtures.L("某某", 543, 620),
        ]

        extraction = page_of(page)

        self.assertTrue(any("没有注册自定义抽取器" in warning for warning in extraction.warnings))
        self.assertEqual(len(extraction.candidates), 1)


if __name__ == "__main__":
    unittest.main()
