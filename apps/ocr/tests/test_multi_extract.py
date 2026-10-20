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
    reset_custom_extractors,
)
from model import Candidate
from tests import fixtures


def page_of(lines):
    classification = classify(lines)
    return extract_page(lines, classification)


def page_on(lines, *, reference_date="2026-10-20", reference_year=2026, image_index=0):
    """Extract with an explicit screenshot date. Nothing here reads `today`."""

    classification = classify(lines)
    return extract_page(
        lines,
        classification,
        image_index=image_index,
        reference_year=reference_year,
        reference_date=reference_date,
    )


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

    def test_boa_rows_are_cut_and_the_layout_is_verified(self) -> None:
        extraction = page_of(fixtures.boa_activity_list())

        self.assertEqual(len(extraction.candidates), 2)
        amounts = [candidate.amount for candidate in extraction.candidates]
        self.assertEqual(amounts, ["328.00", "2500.00"])
        directions = [candidate.direction for candidate in extraction.candidates]
        self.assertEqual(directions, ["expense", "income"])
        self.assertTrue(extraction.classification.verified)
        self.assertNotIn("layout_unverified", codes(extraction.candidates[0]))
        # BOA statements are USD; the default is visible as an assumption.
        self.assertIn("currency_assumed", codes(extraction.candidates[0]))

    def test_the_signed_column_is_the_amount_and_the_unsigned_one_the_balance(self) -> None:
        # Both numbers are drawn at the same size; the sign is the only evidence.
        # Picking the rightmost number (the old behaviour) recorded the balance.
        extraction = page_of(fixtures.boa_activity_list_with_balance_column())

        self.assertEqual(len(extraction.candidates), 2)
        self.assertEqual(
            [candidate.amount for candidate in extraction.candidates], ["328.00", "2500.00"]
        )
        self.assertEqual(
            [candidate.direction for candidate in extraction.candidates], ["expense", "income"]
        )
        for candidate in extraction.candidates:
            self.assertNotIn("amount_uncertain", codes(candidate))

    def test_two_unsigned_numbers_of_the_same_size_stay_ambiguous(self) -> None:
        # No sign, no size difference: there is no evidence at all, so the amount
        # must stay empty instead of becoming the rightmost (balance) number.
        extraction = page_of(fixtures.boa_activity_list_two_unsigned_columns())

        self.assertEqual(len(extraction.candidates), 2)
        for candidate in extraction.candidates:
            self.assertIsNone(candidate.amount)
            self.assertIn("amount_uncertain", codes(candidate))


class BoaActivityListTest(unittest.TestCase):
    """The real BOA list shape: group dates, multi-row descriptions, balance column."""

    def test_each_transaction_starts_at_its_own_group_date(self) -> None:
        extraction = page_on(fixtures.boa_deals_list())

        self.assertEqual(len(extraction.candidates), 3)
        self.assertEqual(
            [candidate.amount for candidate in extraction.candidates],
            ["4.19", "23.00", "14.60"],
        )
        self.assertEqual(
            [candidate.occurred_local_date for candidate in extraction.candidates],
            ["2026-10-19", "2026-10-19", "2026-10-19"],
        )
        self.assertEqual(
            [candidate.direction for candidate in extraction.candidates],
            ["expense", "expense", "expense"],
        )

    def test_the_running_balance_never_becomes_the_amount(self) -> None:
        extraction = page_on(fixtures.boa_deals_list())

        amounts = [candidate.amount for candidate in extraction.candidates]
        # 417.50 is both the account banner above the list and the running
        # balance under the first row.
        self.assertNotIn("417.50", amounts)
        self.assertNotIn("421.69", amounts)
        for candidate in extraction.candidates:
            self.assertNotIn("amount_uncertain", codes(candidate))

    def test_a_description_of_several_rows_is_one_merchant_plus_a_note(self) -> None:
        extraction = page_on(fixtures.boa_deals_list())

        first = extraction.candidates[0]
        self.assertEqual(first.merchant, "COFFEE SHOP")
        self.assertEqual(first.note, "10/19 MOBILE · PURCHASE ANYTOWN · CA")
        self.assertEqual(extraction.candidates[1].merchant, "Zelle payment to")
        self.assertIn("PAYEE NAME Conf#", extraction.candidates[1].note)

    def test_the_bottom_navigation_bar_is_not_part_of_the_transaction(self) -> None:
        # `Pay & Transfer` used to be absorbed into the last row, which made every
        # BOA row look like a transfer.
        extraction = page_on(fixtures.boa_deals_list())

        for candidate in extraction.candidates:
            self.assertFalse(candidate.is_transfer)
            self.assertNotIn("Pay&Transfer", candidate.raw_text)

    def test_a_date_printed_inside_the_description_does_not_date_the_transaction(self) -> None:
        extraction = page_on(fixtures.boa_deals_list_scrolled())

        # The header says Oct 19, the description says 10/18; the header wins.
        second = extraction.candidates[1]
        self.assertEqual(second.occurred_local_date, "2026-10-19")
        self.assertIn("10/18", second.note)

    def test_a_row_cut_off_by_the_screen_bottom_is_not_invented(self) -> None:
        extraction = page_on(fixtures.boa_deals_list_scrolled())

        # Three rows print an amount; the fourth prints only its description.
        self.assertEqual(len(extraction.candidates), 3)
        self.assertEqual(
            [candidate.amount for candidate in extraction.candidates], ["23.00", "14.60", "20.78"]
        )

    def test_currency_is_assumed_visibly_because_the_dollar_sign_is_ambiguous(self) -> None:
        extraction = page_on(fixtures.boa_deals_list())

        for candidate in extraction.candidates:
            self.assertEqual(candidate.currency, "USD")
            self.assertIn("currency_assumed", codes(candidate))


class WechatBillCardsTest(unittest.TestCase):
    """The real WeChat bill-card shape: date header above the card, 记账日报 excluded."""

    def test_each_card_takes_the_date_and_time_of_the_header_above_it(self) -> None:
        extraction = page_on(fixtures.wechat_bill_cards())

        self.assertEqual(len(extraction.candidates), 2)
        self.assertEqual(
            [candidate.amount for candidate in extraction.candidates], ["120.00", "50.00"]
        )
        self.assertEqual(
            [candidate.occurred_local_date for candidate in extraction.candidates],
            ["2026-10-12", "2026-10-13"],
        )
        self.assertEqual(
            [candidate.occurred_time for candidate in extraction.candidates], ["21:04", "17:20"]
        )

    def test_the_evening_hour_is_read_as_pm(self) -> None:
        # `晚上9:04` is 21:04; reading the clock alone would be twelve hours early.
        extraction = page_on(fixtures.wechat_bill_cards())

        self.assertEqual(extraction.candidates[0].occurred_time, "21:04")

    def test_the_card_title_is_the_merchant_and_using_change_is_the_account(self) -> None:
        extraction = page_on(fixtures.wechat_bill_cards())

        self.assertEqual(
            [candidate.merchant for candidate in extraction.candidates],
            ["某某云费用账户-移动支付", "某某智能科技"],
        )
        for candidate in extraction.candidates:
            self.assertEqual(candidate.account, "零钱")
            self.assertEqual(candidate.currency, "CNY")
            self.assertEqual(candidate.direction, "expense")

    def test_a_trailing_date_header_with_no_card_yields_nothing(self) -> None:
        # The third header is visible at the bottom of the screenshot with its
        # card scrolled off; it must not become an empty transaction.
        extraction = page_on(fixtures.wechat_bill_cards())

        self.assertEqual(len(extraction.candidates), 2)

    def test_a_weekday_header_is_counted_back_from_the_screenshot_date(self) -> None:
        extraction = page_on(fixtures.wechat_bill_cards_with_daily_report())

        candidate = extraction.candidates[0]
        # 2026-10-20 is a Tuesday, so 星期三 is the previous Wednesday.
        self.assertEqual(candidate.occurred_local_date, "2026-10-14")
        self.assertEqual(candidate.occurred_time, "18:34")
        self.assertIn("relative_date", codes(candidate))

    def test_the_daily_report_block_is_excluded_whole(self) -> None:
        extraction = page_on(fixtures.wechat_bill_cards_with_daily_report())

        self.assertEqual(len(extraction.candidates), 1)
        self.assertEqual(extraction.candidates[0].amount, "316.86")
        self.assertEqual(extraction.candidates[0].merchant, "某某游戏平台")
        # `￥40.00` and `￥50.00，共1笔` are statistics, not money that moved.
        self.assertNotIn("40.00", [candidate.amount for candidate in extraction.candidates])
        for candidate in extraction.candidates:
            self.assertNotIn("记账日报", candidate.raw_text)

    def test_a_weekday_without_a_reference_date_stays_a_question(self) -> None:
        lines = fixtures.wechat_bill_cards_with_daily_report()
        classification = classify(lines)
        extraction = extract_page(lines, classification)

        self.assertIsNone(extraction.candidates[0].occurred_local_date)
        self.assertIn("missing_date", codes(extraction.candidates[0]))


class AlipayListTest(unittest.TestCase):
    """The real Alipay list shape: right-aligned amounts, relative dates, statuses."""

    def test_five_transactions_with_the_dates_the_screen_names(self) -> None:
        extraction = page_on(fixtures.alipay_bill_with_relative_dates())

        self.assertEqual(len(extraction.candidates), 5)
        self.assertEqual(
            [candidate.amount for candidate in extraction.candidates],
            ["1.00", "50.00", "6.00", "198.00", "1.00"],
        )
        self.assertEqual(
            [candidate.occurred_local_date for candidate in extraction.candidates],
            ["2026-10-17", "2026-10-20", "2026-10-18", "2026-10-18", "2026-10-17"],
        )
        self.assertEqual(
            [candidate.occurred_time for candidate in extraction.candidates],
            ["17:35", "20:53", "23:58", "19:56", "17:35"],
        )

    def test_the_month_summary_and_the_analysis_button_are_not_transactions(self) -> None:
        extraction = page_on(fixtures.alipay_bill_with_relative_dates())

        amounts = [candidate.amount for candidate in extraction.candidates]
        self.assertNotIn("2631.78", amounts)  # the month's income summary
        self.assertNotIn("0.00", amounts)  # the month's expense summary
        for candidate in extraction.candidates:
            self.assertNotEqual(candidate.merchant, "收支分析")

    def test_the_status_the_row_prints_is_kept(self) -> None:
        extraction = page_on(fixtures.alipay_bill_with_relative_dates())

        self.assertEqual(
            [candidate.status for candidate in extraction.candidates],
            ["已报销", None, "自动扣款成功", "自动扣款成功", "自动扣款成功"],
        )

    def test_the_category_row_becomes_the_note(self) -> None:
        extraction = page_on(fixtures.alipay_bill_with_relative_dates())

        self.assertEqual(
            [candidate.note for candidate in extraction.candidates],
            [None, "教育培训", "文化休闲", "文化休闲", "文化休闲"],
        )

    def test_an_unsigned_row_is_still_an_expense_when_it_says_it_was_bought(self) -> None:
        # The 1.00 row prints no minus sign; `；10.17购买` is the only direction
        # evidence on it.
        extraction = page_on(fixtures.alipay_bill_with_relative_dates())

        self.assertEqual(extraction.candidates[0].direction, "expense")

    def test_today_without_a_screenshot_date_stays_a_question(self) -> None:
        lines = fixtures.alipay_bill_with_relative_dates()
        classification = classify(lines)
        extraction = extract_page(lines, classification)

        today_row = extraction.candidates[1]
        self.assertIsNone(today_row.occurred_local_date)
        self.assertIn("missing_date", codes(today_row))


class BankDetailTest(unittest.TestCase):
    """The two BOA single-transaction screens (one real sample each)."""

    def test_single_detail_reads_labels_and_ignores_the_description_date(self) -> None:
        extraction = page_on(fixtures.bank_single_detail())

        self.assertEqual(len(extraction.candidates), 1)
        candidate = extraction.candidates[0]
        self.assertEqual(candidate.amount, "44.76")
        self.assertEqual(candidate.direction, "expense")
        # `10/16` inside the Description field is not the transaction date.
        self.assertEqual(candidate.occurred_local_date, "2026-10-19")
        self.assertEqual(candidate.merchant, "BURGER PLACE")
        self.assertIn("Mobile Payment", candidate.note)
        self.assertIn("Restaurants", candidate.note)
        self.assertEqual(candidate.currency, "USD")
        self.assertIn("layout_unverified", codes(candidate))
        self.assertFalse(extraction.classification.verified)

    def test_transfer_confirmation_is_one_transfer_out(self) -> None:
        extraction = page_on(fixtures.bank_transfer_confirmation())

        self.assertEqual(len(extraction.candidates), 1)
        candidate = extraction.candidates[0]
        self.assertEqual(candidate.amount, "23.00")
        self.assertEqual(candidate.occurred_local_date, "2026-10-18")
        self.assertEqual(candidate.merchant, "PAYEE NAME")
        self.assertTrue(candidate.is_transfer)
        self.assertEqual(candidate.direction, "expense")
        # The screen says `Success`; the ledger's vocabulary is pending/posted.
        self.assertEqual(candidate.status, "posted")

    def test_the_funding_account_keeps_its_product_name_but_not_its_digits(self) -> None:
        candidate = page_on(fixtures.bank_transfer_confirmation()).candidates[0]

        self.assertEqual(candidate.account, "Adv SafeBalance Banking")
        self.assertNotIn("0000", candidate.account)


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
        # Restore the built-in extractors rather than clearing the registry: the
        # built-ins are what every other test class relies on.
        reset_custom_extractors()

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
