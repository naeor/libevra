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
    ISSUE_MISSING_YEAR,
    ISSUE_YEAR_INFERRED,
)
from normalize import (
    currency_in,
    direction_from_text,
    normalize_status,
    read_amount,
    read_date_time,
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
