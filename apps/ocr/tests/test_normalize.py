"""Tests for field normalisation.

The point of these tests is not that the reader is clever, but that it refuses
to be: every unreadable or ambiguous input has to come back as "not known" plus
a reason, because a wrong amount gets confirmed and a blank one gets filled in.
"""

from __future__ import annotations

import unittest

from model import (
    ISSUE_AMOUNT_CONFLICT,
    ISSUE_AMOUNT_UNCERTAIN,
    ISSUE_AMOUNT_UNREADABLE,
    ISSUE_MISSING_CURRENCY,
    ISSUE_MISSING_DATE,
    ISSUE_MISSING_YEAR,
    ISSUE_RELATIVE_DATE,
    ISSUE_YEAR_INFERRED,
)
from normalize import (
    closed_marker_in,
    currency_in,
    direction_from_text,
    normalize_status,
    read_amount,
    read_date_time,
    read_short_date,
)


def codes(read) -> set[str]:
    return {issue.code for issue in read.issues}


class ReadAmountTest(unittest.TestCase):
    def test_yuan_mark_is_cny_and_value_is_kept_verbatim(self) -> None:
        read = read_amount("¥32.00")

        self.assertEqual(read.value, "32.00")
        self.assertEqual(read.currency, "CNY")
        self.assertIsNone(read.negative)

    def test_minus_sign_sets_direction_without_a_currency(self) -> None:
        read = read_amount("-328.00")

        self.assertEqual(read.value, "328.00")
        self.assertTrue(read.negative)
        # No symbol: the currency is a question for the user, not a default.
        self.assertIn(ISSUE_MISSING_CURRENCY, codes(read))

    def test_plus_sign_is_income(self) -> None:
        self.assertFalse(read_amount("+50.00").negative)

    def test_accounting_parentheses_are_negative(self) -> None:
        read = read_amount("(32.00)")

        self.assertEqual(read.value, "32.00")
        self.assertTrue(read.negative)

    def test_thousands_separator_is_accepted_and_removed(self) -> None:
        self.assertEqual(read_amount("¥1,280.00").value, "1280.00")

    def test_ambiguous_dollar_is_not_guessed(self) -> None:
        read = read_amount("$1,234.56")

        self.assertEqual(read.value, "1234.56")
        self.assertIsNone(read.currency)
        self.assertIn(ISSUE_MISSING_CURRENCY, codes(read))

    def test_us_dollar_is_unambiguous(self) -> None:
        read = read_amount("US$1,234.56")

        self.assertEqual(read.currency, "USD")

    def test_a_sentence_with_two_numbers_is_not_read_as_an_amount(self) -> None:
        # "满 30 减 5": picking either number would be inventing a wrong amount.
        read = read_amount("满 30 减 5")

        self.assertIsNone(read.value)
        self.assertIn(ISSUE_AMOUNT_UNCERTAIN, codes(read))

    def test_a_long_serial_number_is_not_an_amount(self) -> None:
        read = read_amount("4200002318202610091234567890")

        self.assertIsNone(read.value)
        self.assertIn(ISSUE_AMOUNT_UNREADABLE, codes(read))

    def test_empty_text_is_not_an_amount(self) -> None:
        self.assertIn(ISSUE_AMOUNT_UNREADABLE, codes(read_amount("")))

    def test_conflicting_currency_hint_is_reported(self) -> None:
        read = read_amount("¥32.00", currency_hint="USD")

        self.assertEqual(read.currency, "CNY")
        self.assertIn(ISSUE_AMOUNT_CONFLICT, codes(read))


class ReadDateTimeTest(unittest.TestCase):
    def test_wechat_shape_with_seconds(self) -> None:
        read = read_date_time("2026年9月21日16:55:23")

        self.assertEqual(read.date, "2026-09-21")
        self.assertEqual(read.time, "16:55")
        self.assertEqual(codes(read), set())

    def test_alipay_dashed_shape_with_seconds(self) -> None:
        read = read_date_time("2026-10-08 12:29:31")

        self.assertEqual(read.date, "2026-10-08")
        self.assertEqual(read.time, "12:29")

    def test_us_shape_with_two_digit_year(self) -> None:
        self.assertEqual(read_date_time("09/21/26").date, "2026-09-21")

    def test_a_year_less_date_is_not_completed(self) -> None:
        read = read_date_time("10月9日 12:34")

        self.assertIsNone(read.date)
        self.assertEqual(read.time, "12:34")
        self.assertIn(ISSUE_MISSING_YEAR, codes(read))

    def test_a_reference_year_is_used_but_flagged(self) -> None:
        read = read_date_time("10月9日 12:34", reference_year=2026)

        self.assertEqual(read.date, "2026-10-09")
        self.assertIn(ISSUE_YEAR_INFERRED, codes(read))

    def test_a_time_alone_is_not_a_date(self) -> None:
        read = read_date_time("12:34")

        self.assertIsNone(read.date)
        self.assertEqual(read.time, "12:34")


class ReadDateTimeFromScreenshotsTest(unittest.TestCase):
    """The date shapes the 2026-10-20 real samples printed."""

    def test_english_month_date_from_a_us_bank_list(self) -> None:
        # The recogniser drops the space after the comma, and sometimes all of them.
        self.assertEqual(read_date_time("Oct 19, 2026").date, "2026-10-19")
        self.assertEqual(read_date_time("Oct 19,2026").date, "2026-10-19")
        self.assertEqual(read_date_time("Oct19,2026").date, "2026-10-19")

    def test_an_english_month_without_a_year_is_a_question(self) -> None:
        read = read_date_time("Oct 19")

        self.assertIsNone(read.date)
        self.assertIn(ISSUE_MISSING_YEAR, codes(read))

    def test_the_evening_modifier_moves_the_clock_twelve_hours(self) -> None:
        read = read_date_time("10月12日晚上9:04", reference_year=2026)

        self.assertEqual(read.date, "2026-10-12")
        self.assertEqual(read.time, "21:04")

    def test_the_afternoon_modifier_moves_the_clock_twelve_hours(self) -> None:
        self.assertEqual(read_date_time("10月13日下午5:20").time, "17:20")

    def test_midday_and_noon_are_not_moved(self) -> None:
        self.assertEqual(read_date_time("中午12:30").time, "12:30")
        self.assertEqual(read_date_time("晚上12:10").time, "00:10")

    def test_today_needs_an_explicit_screenshot_date(self) -> None:
        without = read_date_time("今天20:53")
        self.assertIsNone(without.date)
        self.assertIn(ISSUE_MISSING_DATE, codes(without))

        read = read_date_time("今天20:53", reference_date="2026-10-20")
        self.assertEqual(read.date, "2026-10-20")
        self.assertEqual(read.time, "20:53")
        # The date was computed, not printed, and that is said out loud.
        self.assertIn(ISSUE_RELATIVE_DATE, codes(read))

    def test_yesterday_and_the_day_before(self) -> None:
        self.assertEqual(read_date_time("昨天 08:00", reference_date="2026-10-20").date, "2026-10-19")
        self.assertEqual(read_date_time("前天", reference_date="2026-10-20").date, "2026-10-18")

    def test_a_weekday_counts_back_to_the_most_recent_one(self) -> None:
        # 2026-10-20 is a Tuesday.
        self.assertEqual(
            read_date_time("星期三下午6:34", reference_date="2026-10-20").date, "2026-10-14"
        )
        self.assertEqual(read_date_time("星期二 09:00", reference_date="2026-10-20").date, "2026-10-20")
        self.assertEqual(read_date_time("星期日 09:00", reference_date="2026-10-20").date, "2026-10-18")

    def test_a_weekday_without_a_screenshot_date_is_a_question(self) -> None:
        read = read_date_time("星期三下午6:34")

        self.assertIsNone(read.date)
        self.assertIn(ISSUE_MISSING_DATE, codes(read))

    def test_month_day_glued_to_its_clock(self) -> None:
        # Alipay prints `10-1823:58`: the day and the hour run together.
        read = read_date_time("10-1823:58", reference_year=2026)

        self.assertEqual(read.date, "2026-10-18")
        self.assertEqual(read.time, "23:58")
        self.assertIn(ISSUE_YEAR_INFERRED, codes(read))

    def test_a_dotted_month_day_is_not_a_date(self) -> None:
        # `；10.17购买` is a date the merchant printed with dots; reading it as the
        # transaction date would be wrong, and dots are not a date separator here.
        self.assertIsNone(read_date_time("某应用商店订阅；10.17购买").date)


class ReadShortDateTest(unittest.TestCase):
    """`09.21` - the year-less date Taobao prints next to `实付款`.

    A dot between two numbers is also how a price is written, so this reader is
    opt-in: `read_date_time` still refuses dotted dates (see the test above), and
    only the cell that is known to hold a date goes through here.
    """

    def test_a_dotted_month_day_uses_the_screenshot_year(self) -> None:
        read = read_short_date("09.21", reference_year=2026)

        self.assertEqual(read.date, "2026-09-21")
        self.assertIn(ISSUE_YEAR_INFERRED, codes(read))

    def test_the_separator_may_have_been_read_as_a_digit(self) -> None:
        # `09.211` is what the recogniser returns for the printed `09.21 |`.
        self.assertEqual(read_short_date("09.211", reference_year=2026).date, "2026-09-21")

    def test_single_digit_month_and_day(self) -> None:
        self.assertEqual(read_short_date("9.5", reference_year=2026).date, "2026-09-05")

    def test_without_a_reference_year_the_date_is_a_question(self) -> None:
        read = read_short_date("09.21")

        self.assertIsNone(read.date)
        self.assertIn(ISSUE_MISSING_YEAR, codes(read))

    def test_a_price_is_never_a_date(self) -> None:
        # `￥11.20` is eleven yuan twenty, not November 20th.
        self.assertIsNone(read_short_date("￥11.20", reference_year=2026).date)
        self.assertIsNone(read_short_date("11.20元", reference_year=2026).date)

    def test_an_impossible_month_or_day_is_refused(self) -> None:
        self.assertIsNone(read_short_date("13.01", reference_year=2026).date)
        self.assertIsNone(read_short_date("11.45", reference_year=2026).date)

    def test_a_full_date_is_left_to_the_general_reader(self) -> None:
        # The Taobao card also prints `限时补款：2026年9月20日-…`; a full date is
        # read by `read_date_time`, and this reader only handles the short shape.
        self.assertEqual(
            read_date_time("限时补款：2026年9月20日-2026...", reference_year=2026).date,
            "2026-09-20",
        )


class ClosedOrderTest(unittest.TestCase):
    def test_closing_wording_is_recognised(self) -> None:
        self.assertEqual(closed_marker_in("交易关闭"), "交易关闭")
        self.assertEqual(closed_marker_in("超时关闭"), "超时关闭")

    def test_a_shipping_state_is_not_a_closed_order(self) -> None:
        # 待发货 means the money already left; it is not a closed order.
        self.assertIsNone(closed_marker_in("待发货"))
        self.assertIsNone(closed_marker_in("已完成"))


class StatusAndDirectionTest(unittest.TestCase):
    def test_pending_and_posted_words(self) -> None:
        self.assertEqual(normalize_status("待入账"), "pending")
        self.assertEqual(normalize_status("Pending"), "pending")
        self.assertEqual(normalize_status("交易成功"), "posted")
        self.assertEqual(normalize_status("Posted"), "posted")
        self.assertIsNone(normalize_status("其他"))

    def test_refund_wins_over_payment_words(self) -> None:
        # A WeChat refund screen is titled 转账-退款 and also says 支付.
        self.assertEqual(direction_from_text("转账-退款"), "income")
        self.assertEqual(direction_from_text("退款成功"), "income")

    def test_a_party_name_is_not_a_direction(self) -> None:
        # The recorded mistake: 收款方名 appeared on a payment to a game company.
        self.assertIsNone(direction_from_text("收款方"))
        self.assertIsNone(direction_from_text("付款方"))

    def test_transfer_and_ordinary_directions(self) -> None:
        self.assertEqual(direction_from_text("转入"), "transfer")
        self.assertEqual(direction_from_text("收入"), "income")
        self.assertEqual(direction_from_text("支出"), "expense")

    def test_currency_symbols(self) -> None:
        self.assertEqual(currency_in("￥0.10"), "CNY")
        self.assertIsNone(currency_in("$0.10"))
        self.assertIsNone(currency_in("零钱"))


if __name__ == "__main__":
    unittest.main()
