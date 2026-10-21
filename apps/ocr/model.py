"""Things every S15-B layer passes around: a field problem, and a candidate.

A **candidate** is one transaction the recogniser *thinks* it saw. It is never an
entry: every field may be missing, and a missing field is a question for the
user rather than a default. The S15-B design direction says this explicitly -
"没有识别出的字段必须显示未填写/待确认，不允许伪造默认值" - so the data shape has
to be able to say "I do not know" for every field, and the `issues` list has to
say *why*.

Two rules are encoded here rather than left to callers:

  * **Issues are typed and de-duplicated.** A screen that shows the same problem
    twice (two extraction passes, or a duplicate check run again) must still
    show the user one line, so `add_issue` ignores an identical `(code, field)`.
  * **A duplicate mark is not a deletion.** `duplicate_suspected` only ever
    means "ask the user"; nothing in this pipeline removes or merges a
    candidate automatically.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# The direction of the money. `unknown` is a real answer - a list row without a
# sign or a marker has not told us - and it must not quietly become `expense`.
DIRECTIONS = ("expense", "income", "transfer", "unknown")

# Pending vs posted. `None` means the screenshot did not say.
STATUSES = ("pending", "posted", None)

# Issue codes. Kept as plain strings because they cross the Python/JSON boundary
# (the interface shows `message`; tests and logs match `code`).
ISSUE_MISSING_AMOUNT = "missing_amount"
ISSUE_MISSING_DATE = "missing_date"
ISSUE_MISSING_TIME = "missing_time"  # informational, not a blocker
ISSUE_MISSING_MERCHANT = "missing_merchant"
ISSUE_MISSING_CURRENCY = "missing_currency"
ISSUE_MISSING_YEAR = "missing_year"
ISSUE_YEAR_INFERRED = "year_inferred"
# A calendar date computed from the screenshot date rather than printed on the
# screen (`今天 20:53`, `星期三 下午6:34`). Informational: the date is usable,
# but the user is told where it came from.
ISSUE_RELATIVE_DATE = "relative_date"
ISSUE_DIRECTION_UNCLEAR = "direction_unclear"
ISSUE_AMOUNT_UNCERTAIN = "amount_uncertain"
ISSUE_AMOUNT_CONFLICT = "amount_conflict"
ISSUE_AMOUNT_UNREADABLE = "amount_unreadable"
ISSUE_DUPLICATE_SUSPECTED = "duplicate_suspected"
ISSUE_LAYOUT_UNVERIFIED = "layout_unverified"
ISSUE_LAYOUT_CONFLICT = "layout_conflict"
ISSUE_EXTRACTION_INCOMPLETE = "extraction_incomplete"
# A currency that was not printed but is implied by the source platform (WeChat
# and Alipay bills are CNY). Kept as a visible assumption, not silent default.
ISSUE_CURRENCY_ASSUMED = "currency_assumed"
# An order that was closed (交易关闭 / 超时关闭) or cancelled. It never became a
# payment, so it must not be filed as an expense: the money question goes back
# to the user. Blocking on purpose - it is the one case where a plausible amount
# on the screen is very likely *not* money that moved.
ISSUE_ORDER_CLOSED = "order_closed"
# A date that was read from a sentence rather than from a field
# (`凭据：6月25日下单交易快照`). Informational: the date is usable, but the user
# is told it is a hint and not a printed field.
ISSUE_DATE_HINT = "date_hint"

# Issues that stop an item from counting as "没有问题". Everything else is
# context the user can read at a glance without being asked to act.
BLOCKING_ISSUES = frozenset(
    {
        ISSUE_MISSING_AMOUNT,
        ISSUE_MISSING_DATE,
        ISSUE_MISSING_MERCHANT,
        ISSUE_MISSING_CURRENCY,
        ISSUE_MISSING_YEAR,
        ISSUE_DIRECTION_UNCLEAR,
        ISSUE_AMOUNT_UNCERTAIN,
        ISSUE_AMOUNT_CONFLICT,
        ISSUE_AMOUNT_UNREADABLE,
        ISSUE_DUPLICATE_SUSPECTED,
        ISSUE_LAYOUT_UNVERIFIED,
        ISSUE_LAYOUT_CONFLICT,
        ISSUE_EXTRACTION_INCOMPLETE,
        ISSUE_ORDER_CLOSED,
    }
)


@dataclass(frozen=True)
class Issue:
    """One reason a field is missing or doubtful, shown to the user verbatim."""

    code: str
    message: str
    field: str | None = None


@dataclass
class Candidate:
    """One transaction guessed from one page. Every field is nullable on purpose."""

    candidate_id: str
    image_index: int
    # A canonical decimal *string*: "32.00", never "32" for a value read as
    # "32.00". Keeping the text read avoids float rounding before the user sees it.
    amount: str | None = None
    currency: str | None = None
    direction: str = "unknown"
    occurred_local_date: str | None = None
    occurred_time: str | None = None
    # 商户 / 交易对象. The product design requires this to stay separate from the
    # payment method and the source platform; the three are different questions.
    merchant: str | None = None
    source_platform: str | None = None
    # 支付方式 / 来源账户, e.g. "零钱", "尾号 6688". One field, because a list row
    # usually carries one of the two and the same slot in the row.
    account: str | None = None
    note: str | None = None
    status: str | None = None
    is_refund: bool = False
    # A transfer is not an ordinary expense or income; the ledger's own rules for
    # transfers are still an owner decision (design direction §10.3), so this is
    # recorded as a flag next to the money direction rather than folded into it.
    is_transfer: bool = False
    # Transaction number, when the screen printed one. Used to recognise the same
    # transaction appearing in overlapping scroll screenshots.
    serial: str | None = None
    # The recognised lines this candidate was cut from, for debugging and for
    # showing the user what the guess was based on.
    raw_text: str = ""
    issues: list[Issue] = field(default_factory=list)
    duplicate_group_ids: list[str] = field(default_factory=list)

    def add_issue(self, code: str, message: str, field_name: str | None = None) -> None:
        """Record a problem once. The same problem twice is still one problem."""
        for existing in self.issues:
            if existing.code == code and existing.field == field_name:
                return
        self.issues.append(Issue(code=code, message=message, field=field_name))

    @property
    def duplicate_suspected(self) -> bool:
        return len(self.duplicate_group_ids) > 0

    @property
    def is_questionable(self) -> bool:
        return self.duplicate_suspected or any(issue.code in BLOCKING_ISSUES for issue in self.issues)

    @property
    def is_complete(self) -> bool:
        """Enough to show without *requiring* a detail visit.

        Deliberately not "all fields present": a screenshot rarely prints a note
        or a category, and demanding them would send every item to the detail
        screen - which is the interaction S15-B exists to remove. This is the
        check the design direction calls 字段完整性检查.
        """
        return (
            self.amount is not None
            and self.currency is not None
            and self.direction != "unknown"
            and self.occurred_local_date is not None
            and self.merchant is not None
        )

    def to_dict(self) -> dict[str, Any]:
        """JSON-ready shape. `None` is preserved; the interface renders 待确认."""

        return {
            "candidate_id": self.candidate_id,
            "image_index": self.image_index,
            "amount": self.amount,
            "currency": self.currency,
            "direction": self.direction,
            "occurred_local_date": self.occurred_local_date,
            "occurred_time": self.occurred_time,
            "merchant": self.merchant,
            "source_platform": self.source_platform,
            "account": self.account,
            "note": self.note,
            "status": self.status,
            "is_refund": self.is_refund,
            "is_transfer": self.is_transfer,
            "serial": self.serial,
            "issues": [
                {"code": issue.code, "message": issue.message, "field": issue.field}
                for issue in self.issues
            ],
            "duplicate_suspected": self.duplicate_suspected,
            "duplicate_group_ids": list(self.duplicate_group_ids),
            "is_complete": self.is_complete,
            "is_questionable": self.is_questionable,
            "raw_text": self.raw_text,
        }
