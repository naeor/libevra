"""Normalise what the screen printed into what the ledger needs.

This is layer 5 of S15-B (see the design direction, §4): OCR text → a canonical
amount text, currency code, direction, date/time and status. It is intentionally
*suspicious*: every function may return "I could not tell", and every caller is
expected to carry that through as 待确认 instead of filling it in.

The rules here come from real screenshots recorded in `extract.py` (the module
docstring there lists the six mistakes that produced them). Two of those lessons
are repeated here because they apply to rows as well as to detail pages:

  * A currency mark is not a direction. `¥` says what money, not which way.
  * A word that names a party is not a direction. 收款方 is the counterparty on
    both a payment and a receipt.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from extract import CLOCK, DATE_DASHED, DATE_WITH_MARKERS, INCOME_MARKERS, REFUND_MARKERS, Line
from model import (
    ISSUE_AMOUNT_CONFLICT,
    ISSUE_AMOUNT_UNCERTAIN,
    ISSUE_AMOUNT_UNREADABLE,
    ISSUE_MISSING_CURRENCY,
    ISSUE_MISSING_YEAR,
    ISSUE_YEAR_INFERRED,
    Issue,
)

# Currency marks, as the recogniser may print them. `¥`/`￥` are treated as CNY
# because every sample that carried one was a Chinese payment app; a yen amount
# on a Japanese screen would need the currency to be chosen by the user, which is
# exactly why a currency is nullable in `Candidate`.
CURRENCY_SYMBOLS: tuple[tuple[str, str], ...] = (
    ("US$", "USD"),
    ("HK$", "HKD"),
    ("C$", "CAD"),
    ("A$", "AUD"),
    ("S$", "SGD"),
    ("CNY", "CNY"),
    ("RMB", "CNY"),
    ("人民币", "CNY"),
    ("USD", "USD"),
    ("HKD", "HKD"),
    ("EUR", "EUR"),
    ("GBP", "GBP"),
    ("JPY", "JPY"),
    ("¥", "CNY"),
    ("￥", "CNY"),
    ("$", None),  # Ambiguous: USD/CAD/AUD/HKD/SGD all print it. Never guessed.
    ("€", "EUR"),
    ("£", "GBP"),
)

# Stripped before a number is read. Signs are handled separately because the
# recogniser puts them wherever it likes.
_TRIM = " \t¥￥$€£+-－—–·.,:："

# Longest digit run a candidate transaction amount may have. Serial numbers are
# 16-30 digits; treating one as an amount is the "wrong number" failure that
# `extract.py` records as worse than a blank one.
SERIAL_LENGTH = 10

# Marks a transaction as not yet settled. Read from the screenshots: WeChat says
# 待入账/转账中, BOA says Pending.
PENDING_MARKERS = ("待入账", "处理中", "转账中", "待对方确认", "Pending", "PENDING", "pending")

# Settled. Kept apart from pending so a list row can carry either.
POSTED_MARKERS = (
    "已入账",
    "已到账",
    "支付成功",
    "交易成功",
    "已收款",
    "收款成功",
    "已完成",
    "Posted",
    "POSTED",
    "posted",
    "Completed",
)

# Money leaving/entering by a transfer rather than a purchase. `转账-退款` is a
# refund, not a transfer, so refunds are checked first.
TRANSFER_MARKERS = ("转账", "转入", "转出", "汇款", "还款", "Transfer", "TRANSFER")

# Words that mean money came *in*. `extract.INCOME_MARKERS` are the phrases the
# detail screens print; `收入` is what a list row or a summary line prints.
# 收款方/收款账户 are deliberately absent: naming the payee is not the direction.
INCOME_HINTS = INCOME_MARKERS + ("收入", "Refund", "REFUND", "Credit", "CREDIT")

EXPENSE_HINTS = ("支出", "消费", "付款成功", "已支付", "扣款", "Debit", "DEBIT")

# A refund marker wins over everything else: its direction is the opposite of
# the `支付` word that also appears on the screen. `退款` alone is included
# because list rows print `退款-美团外卖` rather than a full detail screen.
REFUND_HINTS = REFUND_MARKERS + ("退款", "Refund", "REFUND")


@dataclass(frozen=True)
class AmountRead:
    """The result of reading one amount off one line."""

    value: str | None = None
    """Canonical text: digits, one dot, no sign, no thousands separators."""
    currency: str | None = None
    negative: bool | None = None
    """None means no sign was printed - the direction is still unknown."""
    issues: tuple[Issue, ...] = ()

    @property
    def ok(self) -> bool:
        return self.value is not None


@dataclass(frozen=True)
class DateTimeRead:
    date: str | None = None
    time: str | None = None
    issues: tuple[Issue, ...] = ()
    raw: str | None = None


# US-style slash dates (BOA and most English sites). Full year first, then the
# year-less shape that a list row often prints.
_US_DATE = re.compile(r"(\d{1,2})\s*/\s*(\d{1,2})\s*/\s*(\d{2,4})")
# A month/day without a year: WeChat's list rows print `10月9日`, Alipay's print
# `10-09`. The year is NOT guessed; it becomes an issue for the user.
_CN_MONTH_DAY = re.compile(r"(\d{1,2})\s*月\s*(\d{1,2})\s*日")
_DASH_MONTH_DAY = re.compile(r"(?<!\d)(\d{1,2})\s*[-/]\s*(\d{1,2})(?!\d)")


def _clean_number(text: str) -> str | None:
    """Strip decorations and validate the digit shape; None if it is not a number."""

    body = text.strip().strip(_TRIM).replace(",", "").replace("，", "").strip()
    if body == "":
        return None

    if not re.fullmatch(r"\d+(?:\.\d{1,2})?|\d{1,3}(?:\.\d{3})+(?:\.\d{1,2})?", body):
        return None

    # A bare integer of ten or more digits is a serial number, never an amount.
    if "." not in body and len(body) >= SERIAL_LENGTH:
        return None

    return body


def currency_in(text: str) -> str | None:
    """The currency a line mentions, or None when it says nothing conclusive."""

    upper = text.upper()
    for marker, code in CURRENCY_SYMBOLS:
        if marker.upper() in upper:
            return code
    return None


def read_amount(text: str, *, currency_hint: str | None = None) -> AmountRead:
    """Read one amount, including its sign and currency mark.

    Returns `ok=False` with an issue rather than picking a number out of a line
    that contains several: a coupon row like "满 30 减 5" has two numbers and
    choosing one would be a guess.
    """

    issues: list[Issue] = []
    raw = text.strip()
    if raw == "":
        return AmountRead(issues=(Issue(ISSUE_AMOUNT_UNREADABLE, "这一行没有金额。", "amount"),))

    # Parentheses are the accountants' negative, e.g. "(32.00)".
    parenthesised = raw.startswith("(") and raw.endswith(")")
    body = raw[1:-1] if parenthesised else raw

    negative: bool | None = None
    if parenthesised or re.search(r"[-－—–]\s*[¥￥$€£]?\s*\d", body):
        negative = True
        body = re.sub(r"[-－—–]", " ", body)
    elif re.search(r"\+\s*[¥￥$€£]?\s*\d", body):
        negative = False
        body = re.sub(r"\+", " ", body)

    found_currency = currency_in(body) or currency_hint
    symbol_currency = currency_in(raw)

    # Every numeric run on the line. One is an amount; two or more is a sentence
    # ("满 30 减 5") and picking one would be inventing a number.
    numbers = re.findall(r"\d[\d,]*(?:\.\d{1,2})?", body.replace(" ", ""))
    plausible = [_clean_number(number) for number in numbers]
    plausible = [number for number in plausible if number is not None]

    if len(plausible) == 0:
        return AmountRead(issues=(Issue(ISSUE_AMOUNT_UNREADABLE, "没有读出金额。", "amount"),))
    if len(plausible) > 1:
        return AmountRead(
            currency=found_currency,
            issues=(
                Issue(
                    ISSUE_AMOUNT_UNCERTAIN,
                    f"这一行有多个数字（{'、'.join(plausible)}），无法确定金额。",
                    "amount",
                ),
            ),
        )

    value = plausible[0]

    # A currency symbol and a currency code that disagree is a real conflict, not
    # a preference: it appears on mixed-currency receipts.
    if currency_hint is not None and symbol_currency is not None and currency_hint != symbol_currency:
        issues.append(
            Issue(
                ISSUE_AMOUNT_CONFLICT,
                f"币种符号（{symbol_currency}）与预期币种（{currency_hint}）不一致。",
                "currency",
            )
        )

    if found_currency is None:
        issues.append(Issue(ISSUE_MISSING_CURRENCY, "没有读出币种，请确认。", "currency"))

    return AmountRead(
        value=value,
        currency=found_currency,
        negative=negative,
        issues=tuple(issues),
    )


def read_date_time(text: str, *, reference_year: int | None = None) -> DateTimeRead:
    """Read a date and/or time from a line of text.

    A year-less date is **not** completed silently. With no `reference_year` the
    date comes back None and the caller turns that into 待确认; with one (the
    upload happened in a known year) the date is filled but flagged
    `year_inferred`, so the user still sees it as a question.
    """

    issues: list[Issue] = []

    date: str | None = None
    match = DATE_WITH_MARKERS.search(text)
    if match:
        date = f"{int(match.group(1)):04d}-{int(match.group(2)):02d}-{int(match.group(3)):02d}"
    else:
        match = DATE_DASHED.search(text)
        if match:
            date = f"{int(match.group(1)):04d}-{int(match.group(2)):02d}-{int(match.group(3)):02d}"

    if date is None:
        match = _US_DATE.search(text)
        if match:
            month, day, year = int(match.group(1)), int(match.group(2)), int(match.group(3))
            year = _full_year(year)
            if 1 <= month <= 12 and 1 <= day <= 31:
                date = f"{year:04d}-{month:02d}-{day:02d}"
            else:
                issues.append(
                    Issue(ISSUE_MISSING_YEAR, f"日期「{match.group(0)}」无法解析，请确认。", "date")
                )

    if date is None:
        match = _CN_MONTH_DAY.search(text)
        if match is None:
            match = _DASH_MONTH_DAY.search(text)
        if match is not None:
            month, day = int(match.group(1)), int(match.group(2))
            if 1 <= month <= 12 and 1 <= day <= 31:
                if reference_year is None:
                    issues.append(
                        Issue(
                            ISSUE_MISSING_YEAR,
                            f"只读到「{match.group(0)}」没有年份，请确认是哪一年。",
                            "date",
                        )
                    )
                else:
                    date = f"{reference_year:04d}-{month:02d}-{day:02d}"
                    issues.append(
                        Issue(
                            ISSUE_YEAR_INFERRED,
                            f"年份是按上传年份（{reference_year}）补的，请确认。",
                            "date",
                        )
                    )

    clock = CLOCK.search(text)
    time = None
    if clock is not None:
        hour, minute = int(clock.group(1)), int(clock.group(2))
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            time = f"{hour:02d}:{minute:02d}"

    return DateTimeRead(date=date, time=time, issues=tuple(issues), raw=text)


def _full_year(year: int) -> int:
    """`26` → 2026; `2026` stays. Two-digit years in lists are 2000-2099."""

    return year + 2000 if year < 100 else year


def normalize_status(text: str) -> str | None:
    """Pending / posted, or None when the text does not say."""

    for marker in PENDING_MARKERS:
        if marker in text:
            return "pending"
    for marker in POSTED_MARKERS:
        if marker in text:
            return "posted"
    return None


def is_refund_text(text: str) -> bool:
    return any(marker in text for marker in REFUND_HINTS)


def refund_direction(text: str) -> str | None:
    """Refund wins over pending/income/expense words; it is checked first."""

    return "income" if is_refund_text(text) else None


def direction_from_text(text: str) -> str | None:
    """A direction a line states in words, or None.

    Order matters: refund → income markers → transfer → expense. `转账-退款` must
    be income, and `已支付` on a refund screen must not make it an expense.
    """

    if refund_direction(text) is not None:
        return "income"
    for marker in INCOME_HINTS:
        if marker in text:
            return "income"
    for marker in TRANSFER_MARKERS:
        if marker in text:
            return "transfer"
    for marker in EXPENSE_HINTS:
        if marker in text:
            return "expense"
    return None


def to_lines(result: list) -> list[Line]:
    """Re-exported convenience so tests can build `Line`s without importing extract.

    The real conversion lives in `extract.to_lines`; duplicating it would be a
    second place to get the coordinate order wrong.
    """

    from extract import to_lines as convert

    return convert(result)
