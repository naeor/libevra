"""Tests for the 美团 / 京东 / 淘宝 order screens (2026-10-21 samples).

These three platforms are *order* pages, so the failures they can cause are
different from a bill page's, and every test below names the one it guards:

  * the amount must be the order total - not the count (`共2件`), not the
    original price (`￥28.8`), not the discount (`共减￥3.75`);
  * a card with no date stays empty and says so (JD prints none at all);
  * on Taobao the date is the one on the `实付款` row - the promo window and the
    shipping promise printed elsewhere on the same card are not the order date;
  * a closed order is not an expense: direction unknown + `order_closed`;
  * ads, buttons, filter chips, the status bar and the system's notification
    banner never become a candidate, a merchant or a date.

The fixtures are hand-built OCR lines (see `tests/fixtures.py`): the geometry is
the real screenshots', the content is synthetic, and no real screenshot is in the
repository.
"""

from __future__ import annotations

import unittest

from layouts import classify
from multi_extract import extract_page
from model import (
    ISSUE_DATE_HINT,
    ISSUE_MISSING_DATE,
    ISSUE_ORDER_CLOSED,
    ISSUE_YEAR_INFERRED,
)
from tests import fixtures


def page_on(lines, *, reference_date="2026-10-21", reference_year=2026, image_index=0):
    classification = classify(lines)
    return extract_page(
        lines,
        classification,
        image_index=image_index,
        reference_year=reference_year,
        reference_date=reference_date,
    )


def codes(candidate) -> set[str]:
    return {issue.code for issue in candidate.issues}


class MeituanOrderListTest(unittest.TestCase):
    def setUp(self) -> None:
        self.page = page_on(fixtures.meituan_order_list())
        self.candidates = self.page.candidates

    def test_four_cards_become_four_candidates(self) -> None:
        self.assertEqual(self.page.classification.layout_id, "meituan-order-list")
        self.assertEqual(len(self.candidates), 4)

    def test_each_card_keeps_its_own_amount(self) -> None:
        self.assertEqual(
            [candidate.amount for candidate in self.candidates],
            ["7.40", "12.30", "18.6", "18.6"],
        )

    def test_the_count_and_the_rental_duration_are_not_amounts(self) -> None:
        # `共2件` and `使用时长：73分钟` sit on the cards and are numbers; reading
        # either as the amount would file money that never moved.
        amounts = {candidate.amount for candidate in self.candidates}
        self.assertNotIn("2", amounts)
        self.assertNotIn("73", amounts)
        for candidate in self.candidates:
            self.assertNotIn("件", candidate.merchant or "")
            self.assertNotIn("使用时长", candidate.merchant or "")

    def test_dates_are_the_cards_own_dates(self) -> None:
        self.assertEqual(
            [candidate.occurred_local_date for candidate in self.candidates],
            ["2026-09-13", "2026-09-02", "2026-09-01", "2026-09-01"],
        )
        # `2026-09-13 18:45:25` and the glued `下单：2026-09-0217:56`.
        self.assertEqual(
            [candidate.occurred_time for candidate in self.candidates],
            ["18:45", "17:56", "19:51", "19:51"],
        )

    def test_the_shop_row_is_the_merchant_even_for_a_card_without_one(self) -> None:
        merchants = [candidate.merchant for candidate in self.candidates]
        self.assertEqual(merchants[0], "充电宝")  # a rental: title only, no shop row
        self.assertEqual(merchants[1], "爷爷不泡茶(济南高新万达店）")
        self.assertEqual(merchants[2], "大师卤肉饭(济南高新万达店）")
        self.assertIn("大师卤肉饭外卖兑换券", merchants[3])

    def test_buttons_and_the_notification_banner_are_not_merchants(self) -> None:
        for candidate in self.candidates:
            for word in ("更多", "领神券", "再来一单", "去开启", "开启通知", "全部"):
                self.assertNotIn(word, candidate.merchant or "")

    def test_the_status_on_the_shop_row_is_kept(self) -> None:
        self.assertEqual(
            [candidate.status for candidate in self.candidates],
            ["posted", "posted", "posted", None],
        )

    def test_an_order_list_is_an_expense(self) -> None:
        for candidate in self.candidates:
            self.assertEqual(candidate.direction, "expense")
            self.assertFalse(candidate.is_refund)
            self.assertFalse(candidate.is_questionable)


class MeituanOrderDetailTest(unittest.TestCase):
    def setUp(self) -> None:
        self.page = page_on(fixtures.meituan_order_detail())
        self.candidate = self.page.candidates[0]

    def test_one_order_from_the_total_row(self) -> None:
        self.assertEqual(self.page.classification.layout_id, "meituan-order-detail")
        self.assertEqual(len(self.page.candidates), 1)
        self.assertEqual(self.candidate.amount, "12.30")

    def test_the_merchant_is_the_shop_not_the_delivery_address(self) -> None:
        # The address names a hotel, so it also ends in 店 - and it would take the
        # user's address into an entry.
        self.assertEqual(self.candidate.merchant, "爷爷不泡茶（济南高新万达店）")
        self.assertNotIn("示例路", self.candidate.merchant or "")

    def test_a_page_without_a_date_keeps_it_missing(self) -> None:
        self.assertIsNone(self.candidate.occurred_local_date)
        self.assertIn(ISSUE_MISSING_DATE, codes(self.candidate))
        self.assertTrue(self.candidate.is_questionable)

    def test_the_collapsed_payment_row_is_not_read_as_a_payment_method(self) -> None:
        # `配送骑手/支付方式等` means the value is behind a collapsed row.
        self.assertIsNone(self.candidate.account)

    def test_the_ad_banner_does_not_change_the_amount(self) -> None:
        self.assertNotIn("5", {self.candidate.amount})
        self.assertEqual(self.candidate.status, "posted")


class JdOrderListTest(unittest.TestCase):
    def setUp(self) -> None:
        self.page = page_on(fixtures.jd_order_list())
        self.candidates = self.page.candidates

    def test_three_cards_become_three_candidates(self) -> None:
        self.assertEqual(self.page.classification.layout_id, "jd-order-list")
        self.assertEqual(len(self.candidates), 3)

    def test_amounts_and_shops(self) -> None:
        self.assertEqual(
            [candidate.amount for candidate in self.candidates],
            ["328.00", "64.50", "9.90"],
        )
        self.assertEqual(
            [candidate.merchant for candidate in self.candidates],
            ["前行者（EWEADN）京东自营旗舰店", "优品数码专营店", "塔斯汀·中国汉堡（望京街店）"],
        )

    def test_no_date_is_kept_missing_and_never_inferred(self) -> None:
        # This screen prints no order date at all; borrowing the screenshot date
        # would date every purchase to the day the user happened to capture it.
        for candidate in self.candidates:
            self.assertIsNone(candidate.occurred_local_date)
            self.assertIn(ISSUE_MISSING_DATE, codes(candidate))
            self.assertTrue(candidate.is_questionable)
            self.assertFalse(candidate.is_complete)

    def test_the_grey_completion_chip_is_not_a_status(self) -> None:
        # The recogniser reads `完成` on every card header; it is not `已完成`.
        for candidate in self.candidates:
            self.assertIsNone(candidate.status)

    def test_the_service_ad_inside_the_first_card_is_not_a_transaction(self) -> None:
        self.assertNotIn("京东服务", [candidate.merchant for candidate in self.candidates])
        self.assertEqual(len(self.candidates), 3)


class JdOrderDetailTest(unittest.TestCase):
    def setUp(self) -> None:
        self.page = page_on(fixtures.jd_order_detail())
        self.candidate = self.page.candidates[0]

    def test_the_paid_total_wins_over_the_original_price_and_the_discount(self) -> None:
        self.assertEqual(self.page.classification.layout_id, "jd-order-detail")
        self.assertEqual(self.candidate.amount, "64.50")  # not 79.9, not 16.50

    def test_the_payment_method_is_read_when_the_page_prints_it(self) -> None:
        self.assertEqual(self.candidate.account, "微信支付")

    def test_the_merchant_is_the_shop(self) -> None:
        self.assertEqual(self.candidate.merchant, "优品数码专营店")

    def test_the_page_has_no_date_so_it_stays_missing(self) -> None:
        self.assertIsNone(self.candidate.occurred_local_date)
        self.assertIn(ISSUE_MISSING_DATE, codes(self.candidate))


class TaobaoOrderListTest(unittest.TestCase):
    def setUp(self) -> None:
        self.page = page_on(fixtures.taobao_order_list())
        self.candidates = self.page.candidates

    def test_only_the_cards_that_print_a_paid_amount_become_candidates(self) -> None:
        # The third card is cut off by the bottom of the screen: no amount, no
        # invented empty transaction.
        self.assertEqual(self.page.classification.layout_id, "taobao-order-list")
        self.assertEqual(len(self.candidates), 2)
        self.assertEqual([candidate.amount for candidate in self.candidates], ["168", "128"])

    def test_the_order_date_is_the_one_next_to_the_paid_amount(self) -> None:
        # `09.211` is `09.21 |` with the separator read as a digit.
        self.assertEqual(
            [candidate.occurred_local_date for candidate in self.candidates],
            ["2026-09-21", "2026-09-21"],
        )

    def test_the_promo_window_is_not_the_order_date(self) -> None:
        for candidate in self.candidates:
            self.assertNotEqual(candidate.occurred_local_date, "2026-09-20")

    def test_the_shipping_promise_is_not_the_order_date(self) -> None:
        for candidate in self.candidates:
            self.assertNotEqual(candidate.occurred_local_date, "2026-07-18")

    def test_the_year_comes_from_the_screenshot_and_is_flagged(self) -> None:
        for candidate in self.candidates:
            self.assertIn(ISSUE_YEAR_INFERRED, codes(candidate))

    def test_a_closed_and_refunded_order_is_a_refund_with_a_warning(self) -> None:
        closed = self.candidates[0]
        self.assertEqual(closed.direction, "income")
        self.assertTrue(closed.is_refund)
        self.assertEqual(closed.status, "交易关闭")
        self.assertIn(ISSUE_ORDER_CLOSED, codes(closed))
        self.assertTrue(closed.is_questionable)

    def test_an_order_waiting_to_ship_is_still_paid(self) -> None:
        shipped = self.candidates[1]
        self.assertEqual(shipped.direction, "expense")
        self.assertFalse(shipped.is_refund)
        self.assertEqual(shipped.status, "pending")
        self.assertFalse(shipped.is_questionable)

    def test_the_shop_row_is_the_merchant(self) -> None:
        self.assertEqual(
            [candidate.merchant for candidate in self.candidates],
            ["天猫原神旗舰店", "天猫原神旗舰店"],
        )


class TaobaoOrderListWithoutDateTest(unittest.TestCase):
    def test_a_card_that_prints_no_date_keeps_it_missing(self) -> None:
        lines = [
            line for line in fixtures.taobao_order_list() if not line.text.startswith("09.")
        ]
        page = page_on(lines)

        self.assertEqual(len(page.candidates), 2)
        for candidate in page.candidates:
            self.assertIsNone(candidate.occurred_local_date)
            self.assertIn(ISSUE_MISSING_DATE, codes(candidate))


class TaobaoOrderDetailTest(unittest.TestCase):
    def setUp(self) -> None:
        self.page = page_on(fixtures.taobao_order_detail())
        self.candidate = self.page.candidates[0]

    def test_the_amount_is_the_payable_total(self) -> None:
        self.assertEqual(self.page.classification.layout_id, "taobao-order-detail")
        self.assertEqual(len(self.page.candidates), 1)
        self.assertEqual(self.candidate.amount, "66.5")

    def test_a_closed_order_is_not_filed_as_an_expense(self) -> None:
        self.assertEqual(self.candidate.status, "交易关闭")
        self.assertEqual(self.candidate.direction, "unknown")
        self.assertIn(ISSUE_ORDER_CLOSED, codes(self.candidate))
        self.assertTrue(self.candidate.is_questionable)
        self.assertFalse(self.candidate.is_complete)

    def test_the_shops_refund_promise_is_not_a_refund(self) -> None:
        # `平均22小时退款` / `极速退款` are service promises, not money coming back.
        self.assertFalse(self.candidate.is_refund)

    def test_the_merchant_is_the_shop_not_the_address(self) -> None:
        self.assertEqual(self.candidate.merchant, "boxkok旗舰店")

    def test_the_sentence_date_is_kept_but_flagged(self) -> None:
        # The only date on the page is inside `凭据：6月25日下单交易快照`.
        self.assertEqual(self.candidate.occurred_local_date, "2026-06-25")
        self.assertIn(ISSUE_DATE_HINT, codes(self.candidate))
        self.assertIn(ISSUE_YEAR_INFERRED, codes(self.candidate))

    def test_the_order_number_is_not_a_date_or_an_amount(self) -> None:
        self.assertNotEqual(self.candidate.amount, "0000000000000000000")
        self.assertIsInstance(self.candidate.amount, str)


class NoDateInferenceTest(unittest.TestCase):
    def test_without_a_reference_year_the_taobao_date_stays_a_question(self) -> None:
        page = extract_page(
            fixtures.taobao_order_list(),
            classify(fixtures.taobao_order_list()),
        )

        # No reference year → the year-less `09.21` is not completed; the user is
        # asked instead, exactly as with Alipay's `10-18`.
        for candidate in page.candidates:
            self.assertIsNone(candidate.occurred_local_date)
            self.assertTrue(candidate.is_questionable)


class OrderPagesAreNotEachOtherTest(unittest.TestCase):
    """The platform gates must not borrow each other's page."""

    def test_the_detail_layouts_do_not_match_a_list(self) -> None:
        for fixture in (
            fixtures.meituan_order_list,
            fixtures.jd_order_list,
            fixtures.taobao_order_list,
        ):
            result = classify(fixture())
            self.assertEqual(result.page_type, "transaction-list")
            self.assertTrue(result.layout_id.endswith("-order-list"))

    def test_the_list_layouts_do_not_match_a_detail(self) -> None:
        for fixture in (
            fixtures.meituan_order_detail,
            fixtures.jd_order_detail,
            fixtures.taobao_order_detail,
        ):
            result = classify(fixture())
            self.assertEqual(result.page_type, "single-detail")
            self.assertTrue(result.layout_id.endswith("-order-detail"))

    def test_a_taobao_list_is_not_read_as_an_alipay_bill(self) -> None:
        # 支付宝 is printed *inside* a refund row of this Taobao card; the Alipay
        # bill layout used to win on that single word.
        result = classify(fixtures.taobao_order_list())

        self.assertEqual(result.layout_id, "taobao-order-list")
        self.assertNotEqual(result.layout_id, "alipay-transaction-list")
        self.assertEqual(result.platform, "TAOBAO")


if __name__ == "__main__":
    unittest.main()
