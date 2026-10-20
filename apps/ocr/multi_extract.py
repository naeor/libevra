"""Cut a page into candidate transactions and fill their fields.

This is layers 3-4 of S15-B (design direction §4): **切分** then **字段提取**.
It works from geometry and wording, not from any single bank's hard-coded rule
sheet, and the bank-specific part lives in `layouts.py`'s registry.

The two shapes it handles:

  * `single-detail` - the existing single-entry reader (`extract.extract`) is
    reused rather than re-derived. That reader's rules were paid for with real
    screenshots and are the closest thing to verified knowledge this module has.
  * `transaction-list` - a generic row cutter. A row is an amount line on a
    horizontal band; the transaction is that band plus the following metadata
    band(s) (date/time, status) up to the next amount band. This deliberately
    assumes almost nothing: no bank-specific column offsets, no fixed row
    height, no promises that the merchant is above or below the amount.

An unknown page type produces no candidates at all: the interface asks the user
whether to treat it as one transaction or many, rather than this module
inventing a count.

## 扩展点

- 新银行的行式样如果只是**关键词/状态词不同**：只改 `layouts.LayoutDescriptor`。
- 行式样不同（金额在左、日期单独一列、跨行合并备注等）：在
  `CUSTOM_EXTRACTORS` 里注册一个 `(lines, context) -> list[Candidate]` 函数，
  版式描述里写 `ExtractionSpec(strategy="custom", custom_extractor="<名字>")`。
  主流程（`extract_page`）不需要改。
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable, Sequence

import normalize
from extract import STATUS_BAR_FRACTION, Line
from extract import extract as extract_single_draft
from layouts import (
    Classification,
    ExtractionSpec,
    PageStructure,
    analyse_structure,
    is_amount_like,
    is_date_like,
    label_of,
    layout_by_id,
    vertical_bands,
)
from model import (
    ISSUE_AMOUNT_UNREADABLE,
    ISSUE_CURRENCY_ASSUMED,
    ISSUE_DIRECTION_UNCLEAR,
    ISSUE_EXTRACTION_INCOMPLETE,
    ISSUE_LAYOUT_UNVERIFIED,
    ISSUE_MISSING_AMOUNT,
    ISSUE_MISSING_CURRENCY,
    ISSUE_MISSING_DATE,
    ISSUE_MISSING_MERCHANT,
    Candidate,
    Issue,
)

# A custom row cutter. Registered per layout id, never called unless that layout
# classified the page.
CustomExtractor = Callable[[Sequence[Line], "ExtractionContext"], list[Candidate]]
CUSTOM_EXTRACTORS: dict[str, CustomExtractor] = {}


def register_custom_extractor(name: str, extractor: CustomExtractor) -> None:
    if name in CUSTOM_EXTRACTORS:
        raise ValueError(f"抽取器名字重复：{name}")
    CUSTOM_EXTRACTORS[name] = extractor


@dataclass(frozen=True)
class ExtractionContext:
    """Everything an extraction rule may need that is not the page itself."""

    classification: Classification
    image_index: int
    reference_year: int | None = None


@dataclass(frozen=True)
class PageExtraction:
    """One page's candidates plus the questions the user must be asked."""

    image_index: int
    classification: Classification
    candidates: tuple[Candidate, ...]
    warnings: tuple[str, ...]

    @property
    def requires_user_choice(self) -> bool:
        """The classifier said so, or a claimed list yielded no transactions."""

        return self.classification.requires_user_choice or (
            self.classification.page_type == "transaction-list" and len(self.candidates) == 0
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "image_index": self.image_index,
            "page": self.classification.to_dict(),
            "candidates": [candidate.to_dict() for candidate in self.candidates],
            "warnings": list(self.warnings),
            "requires_user_choice": self.requires_user_choice,
        }


def extract_page(
    lines: Sequence[Line],
    classification: Classification,
    *,
    image_index: int = 0,
    reference_year: int | None = None,
) -> PageExtraction:
    """Turn one classified page into candidates. Pure and deterministic."""

    context = ExtractionContext(
        classification=classification,
        image_index=image_index,
        reference_year=reference_year,
    )

    page_lines = list(lines)
    if not page_lines:
        return PageExtraction(
            image_index=image_index,
            classification=classification,
            candidates=(),
            warnings=("这一页没有读出任何文字，无法识别。",),
        )

    if classification.page_type == "unknown":
        return PageExtraction(
            image_index=image_index,
            classification=classification,
            candidates=(),
            warnings=("无法判断这是什么页面，请选择按单笔还是按多笔处理。",),
        )

    layout = layout_by_id(classification.layout_id)
    spec = layout.extraction if layout is not None else ExtractionSpec(strategy="single-detail")
    warnings: list[str] = []

    if classification.page_type == "single-detail" and spec.strategy != "custom":
        candidates = _extract_single(page_lines, context)
    else:
        strategy = spec.strategy
        if strategy == "custom":
            extractor = CUSTOM_EXTRACTORS.get(spec.custom_extractor or "")
            if extractor is None:
                warnings.append(f"没有注册自定义抽取器「{spec.custom_extractor}」，按通用行规则处理。")
                candidates = _extract_list_rows(page_lines, context, spec)
            else:
                candidates = extractor(page_lines, context)
        elif strategy == "list-rows":
            candidates = _extract_list_rows(page_lines, context, spec)
        else:
            candidates = _extract_single(page_lines, context)

    if not candidates:
        warnings.append("这一页没有切分出任何交易，需要手动确认或改为单笔处理。")

    return PageExtraction(
        image_index=image_index,
        classification=classification,
        candidates=tuple(candidates),
        warnings=tuple(warnings),
    )


# --- single detail ----------------------------------------------------------


def _extract_single(lines: Sequence[Line], context: ExtractionContext) -> list[Candidate]:
    """Reuse the verified single-entry reader, then map its draft to a candidate.

    The old reader fills a *form*; a candidate is a weaker thing - it must record
    what was not read instead of defaulting it. So the ledger currency that the
    old draft assumes is re-derived from the screen here, and a missing field
    becomes an issue rather than a plausible value.
    """

    draft = extract_single_draft(list(lines))
    joined = "\n".join(line.text for line in lines)

    candidate = Candidate(
        candidate_id=f"img{context.image_index}-1",
        image_index=context.image_index,
        amount=draft.amount,
        direction="income" if draft.kind == "income" else "expense",
        occurred_local_date=draft.occurred_local_date,
        occurred_time=draft.occurred_time,
        merchant=draft.counterparty,
        note=draft.note,
        source_platform=context.classification.platform,
        account=_first_row_value(lines, ("支付方式", "付款方式", "收款方式", "付款账户", "收款账户", "转账方式")),
        status=normalize.normalize_status(joined),
        is_refund=draft.is_refund,
        is_transfer=(not draft.is_refund)
        and any(marker in joined for marker in normalize.TRANSFER_MARKERS),
        serial=draft.serial,
        raw_text=joined,
    )

    candidate.currency = _apply_currency(candidate, joined, context, spec=_layout_spec(context))
    if candidate.amount is None:
        candidate.add_issue(ISSUE_MISSING_AMOUNT, "没有读出金额，请填写。", "amount")
    if candidate.occurred_local_date is None:
        candidate.add_issue(ISSUE_MISSING_DATE, "没有读出日期，请选择是哪一天。", "date")
    if candidate.merchant is None:
        candidate.add_issue(ISSUE_MISSING_MERCHANT, "没有读出商户/交易对象，请填写。", "merchant")

    for warning in draft.warnings:
        candidate.add_issue(*_issue_from_legacy_warning(warning))

    _add_layout_issue(candidate, context.classification)
    return [candidate]


def _issue_from_legacy_warning(warning: str) -> tuple[str, str, str | None]:
    """Map the old reader's free-text warnings onto typed issues."""

    if "金额" in warning:
        return (ISSUE_MISSING_AMOUNT, warning, "amount")
    if "日期" in warning:
        return (ISSUE_MISSING_DATE, warning, "date")
    return (ISSUE_EXTRACTION_INCOMPLETE, warning, None)


def _layout_spec(context: ExtractionContext) -> ExtractionSpec:
    layout = layout_by_id(context.classification.layout_id)
    return layout.extraction if layout is not None else ExtractionSpec(strategy="single-detail")


def _apply_currency(
    candidate: Candidate,
    joined: str,
    context: ExtractionContext,
    *,
    spec: ExtractionSpec,
) -> str | None:
    """The currency printed on the screen, or an *explicitly flagged* assumption.

    WeChat Pay and Alipay bills are CNY, so a mark the recogniser dropped is
    filled from the platform - but as a visible `currency_assumed` issue. It is
    never as good as reading the symbol, and the design direction is clear that
    an invented field must not be presented as a complete one.
    """

    read = normalize.currency_in(joined)
    if read is not None:
        return read

    default = spec.default_currency
    if default is not None:
        _drop_missing_currency_issue(candidate)
        candidate.add_issue(
            ISSUE_CURRENCY_ASSUMED,
            f"截图里没有读出币种，按该版式默认币种 {default} 处理，请确认。",
            "currency",
        )
        return default

    if context.classification.platform in ("WECHAT", "ALIPAY"):
        _drop_missing_currency_issue(candidate)
        candidate.add_issue(
            ISSUE_CURRENCY_ASSUMED,
            "截图里没有读出币种，按微信/支付宝账单默认 CNY 处理，请确认。",
            "currency",
        )
        return "CNY"

    candidate.add_issue(ISSUE_MISSING_CURRENCY, "没有读出币种，请确认。", "currency")
    return None


def _drop_missing_currency_issue(candidate: Candidate) -> None:
    """The amount reader always reports a missing currency; an explicit,
    visible assumption supersedes it so the user is not told the same thing
    twice."""

    candidate.issues = [
        issue
        for issue in candidate.issues
        if not (issue.field == "currency" and issue.code == ISSUE_MISSING_CURRENCY)
    ]


def _first_row_value(lines: Sequence[Line], labels: tuple[str, ...]) -> str | None:
    """The text to the right of one of `labels`, on the same visual row.

    A small local copy of the old reader's private helper: importing a private
    name would make this module depend on another module's internals.
    """

    for label in labels:
        anchor = next((line for line in lines if line.text.strip() == label), None)
        if anchor is None:
            continue

        row = [
            other
            for other in lines
            if abs(other.top - anchor.top) < max(anchor.height, other.height, 8.0) * 0.9
            and other.left > anchor.left
            and other.text.strip() != ""
        ]
        if row:
            return min(row, key=lambda other: other.left).text

    return None


# --- transaction lists ------------------------------------------------------

# How far below an amount band the transaction's metadata may sit, as a multiple
# of the page's median line height. Two rows is generous: WeChat/Alipay put the
# timestamp directly under the merchant, BOA prints it on the same row.
_METADATA_GAP_FACTOR = 2.4

# Never absorb more than this many rows after an amount band. A list page can
# have section headers between transactions; pulling half the page into one
# transaction would be worse than losing a note.
_MAX_METADATA_BANDS = 2


def _extract_list_rows(
    lines: Sequence[Line],
    context: ExtractionContext,
    spec: ExtractionSpec,
) -> list[Candidate]:
    """Cut a list page into one candidate per amount row."""

    structure = analyse_structure(lines)
    bands = _body_bands(lines)
    amount_band_indexes = [
        index for index, band in enumerate(bands) if len(_amount_columns(band)) > 0
    ]

    candidates: list[Candidate] = []
    median = structure.median_height if structure.median_height > 0 else 24.0
    gap_limit = max(median * _METADATA_GAP_FACTOR, 24.0)

    for ordinal, band_index in enumerate(amount_band_indexes, start=1):
        next_index = (
            amount_band_indexes[ordinal] if ordinal < len(amount_band_indexes) else len(bands)
        )

        grouped_bands = [bands[band_index]]
        previous_bottom = max(line.top for line in bands[band_index])
        for follow_index in range(band_index + 1, next_index):
            band = bands[follow_index]
            band_top = min(line.top for line in band)
            if band_top - previous_bottom > gap_limit:
                break
            grouped_bands.append(band)
            previous_bottom = max(line.top for line in band)
            if len(grouped_bands) > _MAX_METADATA_BANDS:
                break

        group = [line for band in grouped_bands for line in band]
        candidate = _candidate_from_group(
            group=group,
            amount_band=bands[band_index],
            context=context,
            spec=spec,
            candidate_id=f"img{context.image_index}-{ordinal}",
        )
        candidates.append(candidate)

    return candidates


def _body_bands(lines: Sequence[Line]) -> list[list[Line]]:
    """Bands of the page's body, with the phone status bar removed."""

    if not lines:
        return []

    max_top = max(line.top for line in lines)
    status_floor = max_top * STATUS_BAR_FRACTION
    body = [line for line in lines if line.top > status_floor]
    return vertical_bands(body)


def _amount_columns(band: Sequence[Line]) -> list[Line]:
    """Every amount-like line in one row, left to right.

    More than one is not a detail to smooth over: a bank list with Amount and
    Balance columns prints two numbers per row, and taking the rightmost one
    would record the balance as the transaction amount. Without a sample of that
    layout, the honest result is "amount uncertain", not a wrong number.
    """

    if any(label_of(line.text) is not None for line in band):
        return []

    return sorted(
        (line for line in band if is_amount_like(line)),
        key=lambda line: line.left,
    )


def _candidate_from_group(
    *,
    group: Sequence[Line],
    amount_band: Sequence[Line],
    context: ExtractionContext,
    spec: ExtractionSpec,
    candidate_id: str,
) -> Candidate:
    joined = "\n".join(line.text for line in group)
    columns = _amount_columns(amount_band)
    assert columns, "callers only pass amount bands"
    # The merchant sits left of the *first* number column, so that is the
    # reference point even when the row also prints a balance column.
    reference = columns[0]

    if len(columns) == 1:
        read = normalize.read_amount(reference.text)
        amount = read.value
        amount_issues = list(read.issues)
    else:
        read = normalize.AmountRead()
        amount = None
        rendered = "、".join(line.text.strip() for line in columns)
        amount_issues = [
            Issue(
                "amount_uncertain",
                f"这一行有多个数字（{rendered}），无法确定哪个是交易金额，请填写。",
                "amount",
            )
        ]

    candidate = Candidate(
        candidate_id=candidate_id,
        image_index=context.image_index,
        amount=amount,
        source_platform=context.classification.platform,
        merchant=_pick_merchant(group, reference),
        serial=_find_serial(group),
        raw_text=joined,
    )

    for issue in amount_issues:
        candidate.add_issue(issue.code, issue.message, issue.field)

    if candidate.amount is None and not any(
        issue.code in (ISSUE_AMOUNT_UNREADABLE, "amount_uncertain") for issue in candidate.issues
    ):
        candidate.add_issue(ISSUE_MISSING_AMOUNT, "没有读出这一笔的金额，请填写。", "amount")

    candidate.currency = _apply_currency(candidate, joined, context, spec=spec)

    date, time, date_issues = _read_group_date_time(group, context.reference_year)
    candidate.occurred_local_date = date
    candidate.occurred_time = time
    for issue in date_issues:
        candidate.add_issue(issue.code, issue.message, issue.field)
    # `missing_year` already explains why the date is unknown; adding
    # `missing_date` next to it would show the user the same fact twice.
    if date is None and not any(issue.code == "missing_year" for issue in candidate.issues):
        candidate.add_issue(ISSUE_MISSING_DATE, "没有读出这一笔的日期，请选择。", "date")
    if candidate.occurred_time is None:
        candidate.add_issue("missing_time", "没有读出时间；如果是同一天的多笔，可能无法区分。", "time")

    if candidate.merchant is None:
        candidate.add_issue(ISSUE_MISSING_MERCHANT, "没有读出商户/交易对象，请填写。", "merchant")

    candidate.direction, candidate.is_refund, candidate.is_transfer = _resolve_direction(
        joined, read, candidate
    )
    candidate.status = _read_status(joined, spec)

    _add_layout_issue(candidate, context.classification)
    return candidate


def _read_group_date_time(
    group: Sequence[Line],
    reference_year: int | None,
) -> tuple[str | None, str | None, list[Issue]]:
    date: str | None = None
    time: str | None = None
    issues: list[Issue] = []

    for line in group:
        read = normalize.read_date_time(line.text, reference_year=reference_year)
        for issue in read.issues:
            if not any(existing.code == issue.code for existing in issues):
                issues.append(issue)
        if date is None and read.date is not None:
            date = read.date
        if time is None and read.time is not None:
            time = read.time

    return date, time, issues


def _pick_merchant(group: Sequence[Line], amount_line: Line) -> str | None:
    """The merchant/description for one row: nearest text, then the row's other text.

    The nearest text to the left of the amount is the merchant column on every
    list layout seen so far. Nothing is invented: a row that only prints a date
    and an amount has no merchant, and that becomes a question.
    """

    lefters = [
        line
        for line in group
        if line.left < amount_line.left and line.top <= amount_line.top + 4 and _looks_like_merchant(line.text)
    ]
    if lefters:
        return max(lefters, key=lambda line: line.left).text.strip()

    for line in group:
        if line is amount_line:
            continue
        if _looks_like_merchant(line.text):
            return line.text.strip()

    return None


_ACCOUNT_WORDS = ("尾号", "账户", "卡号", "余额", "支付方式", "付款方式", "收款方式", "Available", "Balance")


def _looks_like_merchant(text: str) -> bool:
    stripped = text.strip()
    if stripped == "":
        return False
    if is_date_like(stripped):
        return False
    if normalize.normalize_status(stripped) is not None:
        return False
    if normalize.currency_in(stripped) is not None and len(re.findall(r"\d", stripped)) >= 1:
        return False
    if is_amount_like(Line(text=stripped, score=1.0, height=20.0, top=0.0, left=0.0)):
        return False
    if any(word in stripped for word in _ACCOUNT_WORDS):
        return False
    if stripped in ("收入", "支出", "交易", "全部", "详情", "退款"):
        return False
    return any(character.isalpha() or "\u4e00" <= character <= "\u9fff" for character in stripped)


def _find_serial(group: Sequence[Line]) -> str | None:
    for line in group:
        digits = line.text.replace(" ", "")
        if digits.isdigit() and len(digits) >= 15:
            return digits
    return None


def _resolve_direction(
    joined: str,
    read: normalize.AmountRead,
    candidate: Candidate,
) -> tuple[str, bool, bool]:
    """Money direction plus the refund/transfer flags. Never invents a direction.

    Order: refund wins (its wording contains a payment word), then an explicit
    sign, then clear wording. A transfer row that says neither 收入 nor 支出 is
    `unknown` with an issue - "转账" alone does not say which way the money went.
    """

    refund = normalize.is_refund_text(joined)
    transfer = (not refund) and any(marker in joined for marker in normalize.TRANSFER_MARKERS)

    if refund:
        return ("income", True, False)

    if read.negative is not None:
        from_sign = "expense" if read.negative else "income"
        text_direction = normalize.direction_from_text(joined)
        if text_direction in ("income", "expense") and text_direction != from_sign:
            candidate.add_issue(
                ISSUE_DIRECTION_UNCLEAR,
                "金额符号与文字方向不一致，请确认是收入还是支出。",
                "direction",
            )
            return ("unknown", False, transfer)
        return (from_sign, False, transfer)

    text_direction = normalize.direction_from_text(joined)
    if text_direction in ("income", "expense"):
        return (text_direction, False, False)

    if transfer:
        candidate.add_issue(
            ISSUE_DIRECTION_UNCLEAR,
            "这是一笔转账，但截图中没有说明是转入还是转出，请确认。",
            "direction",
        )
        return ("unknown", False, True)

    candidate.add_issue(
        ISSUE_DIRECTION_UNCLEAR,
        "没有读出收支方向，请确认是收入还是支出。",
        "direction",
    )
    return ("unknown", False, False)


def _read_status(joined: str, spec: ExtractionSpec) -> str | None:
    for marker, status in spec.status_markers:
        if marker in joined:
            return status
    return normalize.normalize_status(joined)


def _add_layout_issue(candidate: Candidate, classification: Classification) -> None:
    if classification.verified:
        return

    label = classification.layout_label or classification.layout_id or "未命名版式"
    candidate.add_issue(
        ISSUE_LAYOUT_UNVERIFIED,
        f"版式「{label}」未验证（缺少真实样本），这一笔的字段请核对。",
        None,
    )


def extract_pages(
    pages: Sequence[tuple[int, Sequence[Line]]],
    *,
    reference_year: int | None = None,
) -> list[PageExtraction]:
    """Classify and extract several pages. Kept beside `extract_page` for callers.

    Cross-image duplicate detection belongs to `dedupe.py`; this only turns each
    page into candidates, in upload order.
    """

    from layouts import classify

    results: list[PageExtraction] = []
    for image_index, lines in pages:
        classification = classify(lines)
        results.append(
            extract_page(
                lines,
                classification,
                image_index=image_index,
                reference_year=reference_year,
            )
        )
    return results
