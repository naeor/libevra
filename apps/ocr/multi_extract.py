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

## 已注册的专用行切分（2026-10-20 真实样本驱动）

| 抽取器 | 版式 | 为什么不能走通用行规则 |
|---|---|---|
| `boa-activity-rows` | `boa-activity-list` | 每笔以 `Oct 19, 2026` 分组头开始，描述 2–4 行，金额列旁边还有**运行余额列** |
| `wechat-bill-cards` | `wechat-bill-cards` | 日期是卡片上方的分组头，商户是卡片标题，`使用零钱支付` 是账户；底部「记账日报」整块不是交易 |
| `alipay-bill-rows` | `alipay-transaction-list` | 顶部月度汇总 + `收支分析` 按钮；金额右对齐才能认；日期是 `今天 / 10-1823:58` |
| `bank-single-detail` | `bank-single-detail` | 英文标签，值有时在标签**上方**；描述里的 `10/16` 不是交易日期 |
| `bank-transfer-confirmation` | `bank-transfer-confirmation` | 转账确认页，`is_transfer`，方向由页面语义决定 |
| `meituan-order-rows` | `meituan-order-list` | 卡片 = 店铺+状态行 + 右对齐￥金额；`共N件`/`使用时长`/`领神券` 不是金额；日期在卡片内 |
| `jd-order-rows` | `jd-order-list` | 同上，但这一屏**不打印日期** → 保持缺失并标 `missing_date` |
| `taobao-order-rows` | `taobao-order-list` | 金额是 `实付款￥xx` 行；日期只认这一行的 `09.21`（限时补款/预售发货日不是交易日期） |
| `cn-order-detail` | `meituan-order-detail` / `jd-order-detail` / `taobao-order-detail` | 金额只认「应付款/实付款/合计」标签后的数字；`交易关闭` → 方向未知 + `order_closed` |

通用行规则（`_extract_list_rows`）仍然服务没有专用抽取器的版式，也作为每个专用
抽取器「认不出这种行式样」时的回退，所以新页面不会因为专用规则不认识就变成 0 笔。
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
    ISSUE_AMOUNT_UNCERTAIN,
    ISSUE_AMOUNT_UNREADABLE,
    ISSUE_CURRENCY_ASSUMED,
    ISSUE_DATE_HINT,
    ISSUE_DIRECTION_UNCLEAR,
    ISSUE_EXTRACTION_INCOMPLETE,
    ISSUE_LAYOUT_UNVERIFIED,
    ISSUE_MISSING_AMOUNT,
    ISSUE_MISSING_CURRENCY,
    ISSUE_MISSING_DATE,
    ISSUE_MISSING_MERCHANT,
    ISSUE_ORDER_CLOSED,
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
    # `YYYY-MM-DD`, the day the screenshots were taken. It is the *only* input
    # that can turn `今天 20:53` or `星期三 下午6:34` into a calendar date, and it
    # is always passed in explicitly so a test cannot change meaning overnight.
    reference_date: str | None = None


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
    reference_date: str | None = None,
) -> PageExtraction:
    """Turn one classified page into candidates. Pure and deterministic."""

    context = ExtractionContext(
        classification=classification,
        image_index=image_index,
        reference_year=reference_year,
        reference_date=reference_date,
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
    records the running balance as the transaction amount. `_split_amount_balance`
    is what decides between them.
    """

    if any(label_of(line.text) is not None for line in band):
        return []

    return sorted(
        (line for line in band if is_amount_like(line)),
        key=lambda line: line.left,
    )


# Two numbers on one row: the transaction amount is the one drawn larger. On the
# real BOA screenshots the amount line is 51-57px tall and the balance 38-48px,
# so this ratio separates them; when heights are within 15% of each other the
# font gives no answer and the row stays ambiguous.
_AMOUNT_FONT_RATIO = 1.15

_SIGNED_AMOUNT = re.compile(r"[-－—–]\s*[¥￥$€£]?\s*\d")
_PLUS_AMOUNT = re.compile(r"\+\s*[¥￥$€£]?\s*\d")


def _printed_sign(text: str) -> bool | None:
    """The sign the screen printed: True negative, False positive, None unsigned."""

    if _SIGNED_AMOUNT.search(text):
        return True
    if _PLUS_AMOUNT.search(text):
        return False
    return None


def _split_amount_balance(
    columns: Sequence[Line],
) -> tuple[Line | None, list[Line], list[Issue]]:
    """The transaction amount among a row's number columns, and the ones that are not it.

    Two independent effects separate the amount column from a running-balance
    column, both observed on the real BOA samples:

      * **sign** - the amount is signed (`-$4.19`, `+140.00`), a running balance
        is printed unsigned (`$417.50`). One signed number on the row wins;
      * **font size** - the amount is drawn larger than the balance, which shows
        up in the OCR line height.

    When neither effect separates them (two unsigned numbers drawn the same
    size) the row is genuinely ambiguous, and the honest answer stays
    `amount_uncertain` rather than the rightmost number.
    """

    if len(columns) <= 1:
        return (columns[0] if columns else None), [], []

    signed = [line for line in columns if _printed_sign(line.text) is not None]
    if len(signed) == 1:
        chosen = signed[0]
        return chosen, [line for line in columns if line is not chosen], []

    ordered = sorted(columns, key=lambda line: -line.height)
    if ordered[0].height >= ordered[1].height * _AMOUNT_FONT_RATIO:
        chosen = ordered[0]
        return chosen, [line for line in columns if line is not chosen], []

    rendered = "、".join(line.text.strip() for line in columns)
    return (
        None,
        list(columns),
        [
            Issue(
                ISSUE_AMOUNT_UNCERTAIN,
                f"这一行有多个数字（{rendered}），无法确定哪个是交易金额，请填写。",
                "amount",
            )
        ],
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

    amount_line, _ignored, amount_issues = _split_amount_balance(columns)
    read = normalize.AmountRead()
    amount: str | None = None
    if amount_line is not None:
        read = normalize.read_amount(amount_line.text)
        amount = read.value

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

    date, time, date_issues = _read_group_date_time(
        group, context.reference_year, context.reference_date
    )
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
    reference_date: str | None = None,
) -> tuple[str | None, str | None, list[Issue]]:
    date: str | None = None
    time: str | None = None
    issues: list[Issue] = []

    for line in group:
        read = normalize.read_date_time(
            line.text, reference_year=reference_year, reference_date=reference_date
        )
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


_ACCOUNT_WORDS = ("尾号", "卡号", "余额", "Available", "Balance")


def _looks_like_merchant(text: str) -> bool:
    stripped = text.strip()
    if stripped == "":
        return False
    if is_date_like(stripped):
        return False
    if normalize.normalize_status(stripped) is not None:
        return False
    if label_of(stripped) is not None:
        # `付款账户` / `Amount` are field *names*, never the counterparty.
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


# --- custom row cutters -----------------------------------------------------
#
# Registered, not special-cased: `extract_page` looks these up by the layout's
# `ExtractionSpec.custom_extractor`, so a new screen shape is a new function plus
# a registry row, never a new branch in the main flow.
#
# Each one exists because that screen's *row shape* is not "an amount line plus
# the rows under it", and each was written against a real screenshot named in
# `layouts.py`. The fixtures in `tests/fixtures.py` are hand-built copies of
# those shapes - no real screenshot enters the repository.


def _sorted_body(lines: Sequence[Line]) -> list[Line]:
    """The page's lines without the phone's status bar, in reading order."""

    if not lines:
        return []
    max_top = max(line.top for line in lines)
    status_floor = max_top * STATUS_BAR_FRACTION
    return sorted(
        (line for line in lines if line.top > status_floor),
        key=lambda line: (line.top, line.left),
    )


def _median_height(lines: Sequence[Line]) -> float:
    heights = sorted(line.height for line in lines if line.height > 0)
    if not heights:
        return 0.0
    middle = len(heights) // 2
    if len(heights) % 2 == 1:
        return heights[middle]
    return (heights[middle - 1] + heights[middle]) / 2


def _same_row(left: Line, right: Line) -> bool:
    return abs(left.top - right.top) <= max(left.height, right.height, 8.0) * 0.7


def _field_value(lines: Sequence[Line], *labels: str) -> str | None:
    """The value of an English field label, right of it or on the next line.

    BOA prints both shapes on the same screen: `Amount` sits *next to* its value
    and `Merchant Name` sits *above* its value. Looking only to the right loses
    the merchant; looking only below loses the amount.
    """

    for label in labels:
        anchor = next((line for line in lines if line.text.strip() == label), None)
        if anchor is None:
            continue

        right = [
            line
            for line in lines
            if line is not anchor
            and _same_row(line, anchor)
            and line.left > anchor.left + 2
            and line.text.strip() != ""
        ]
        if right:
            return min(right, key=lambda line: line.left).text.strip()

        below = [
            line
            for line in lines
            if line.top > anchor.top + anchor.height * 0.5
            and line.left < anchor.left + 260
            and line.text.strip() != ""
        ]
        if below:
            return min(below, key=lambda line: (line.top, line.left)).text.strip()

    return None


def _spec_status_words(spec: ExtractionSpec) -> tuple[str, ...]:
    """The layout's own status wording, as the phrases the screen prints."""

    return tuple(marker for marker, _status in spec.status_markers)


def _read_status_text(joined: str, phrases: Sequence[str]) -> str | None:
    """A status the screen names in its own words, or pending/posted.

    Alipay prints `已报销` / `自动扣款成功` next to a row; those are neither
    "pending" nor "posted" in the ledger's vocabulary, so the screen's own short
    phrase is kept verbatim rather than flattened into a word it did not use.
    """

    for phrase in phrases:
        if phrase in joined:
            return phrase
    return normalize.normalize_status(joined)


# --- BOA activity list ------------------------------------------------------

# BOA opens each transaction with its own group date, printed again for every
# transaction even when they share a day. `Oct 19, 2026` / `Oct19,2026` /
# `Oct 19,2026` are all the same header to the recogniser.
_BOA_GROUP_DATE = re.compile(
    r"^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-zA-Z]*\.?\s*"
    r"\d{1,2}(?:\s*,\s*\d{2,4})?$"
)

# How far below the amount the description may run, as a multiple of the page's
# median line height. A BOA description is 2-4 rows; the bottom navigation bar is
# further down and must not be absorbed into the last transaction.
_BOA_DESCRIPTION_REACH = 3.6


def boa_activity_rows(
    lines: Sequence[Line],
    context: ExtractionContext,
) -> list[Candidate]:
    """BOA activity list: a date header opens each band, then 2-4 description rows.

    Two things are deliberately different from the generic cutter:

      * the band is cut on the **date header**, not on the amount, so a row whose
        description wraps onto four lines stays one transaction;
      * the amount column is separated from the **running balance** column by
        sign and font size (`_split_amount_balance`), so `$417.50` never becomes
        an amount.

    A description's own date (`10/19 MOBILE`, `HELP.UBER.CO 10/18`) is *not* the
    transaction date: it is the date the merchant printed. The only date this
    cutter accepts is the group header above the row.
    """

    body = _sorted_body(lines)
    headers = [line for line in body if _BOA_GROUP_DATE.match(line.text.strip())]
    if not headers:
        # No group dates at all: this is not the shape this cutter knows, so the
        # generic rule gets its chance instead of the page yielding nothing.
        return _extract_list_rows(lines, context, _layout_spec(context))

    spec = _layout_spec(context)
    median = _median_height(body)
    candidates: list[Candidate] = []

    for index, header in enumerate(headers):
        limit = headers[index + 1].top if index + 1 < len(headers) else float("inf")
        region = [line for line in body if header.top < line.top < limit]
        columns = sorted(
            (line for line in region if is_amount_like(line)), key=lambda line: line.left
        )
        if not columns:
            # A row cut off by the bottom of the screen (the real sample ends on
            # one) prints no amount at all. There is nothing to cut, and
            # inventing an empty transaction would be worse than dropping it.
            continue

        amount_line, _balance_columns, amount_issues = _split_amount_balance(columns)
        anchor_top = amount_line.top if amount_line is not None else header.top
        ceiling = anchor_top + median * _BOA_DESCRIPTION_REACH
        # Everything the row actually prints: below the header, and no further
        # down than a description can run. The bottom navigation bar
        # (`Pay & Transfer`, `Deposit Checks`) sits below that line and is not
        # part of the transaction - counting it made every BOA row look like a
        # transfer, because the bar prints the word `Transfer`.
        visible = [line for line in region if line.top <= ceiling]
        descriptions = sorted(
            (
                line
                for line in visible
                if line is not amount_line
                and not is_amount_like(line)
                and line.text.strip() != ""
            ),
            key=lambda line: (line.top, line.left),
        )

        joined = "\n".join(line.text for line in visible)
        merchant = descriptions[0].text.strip() if descriptions else None
        note = " · ".join(line.text.strip() for line in descriptions[1:]) or None

        read = normalize.AmountRead()
        amount: str | None = None
        if amount_line is not None:
            read = normalize.read_amount(amount_line.text)
            amount = read.value

        candidate = Candidate(
            candidate_id=f"img{context.image_index}-{len(candidates) + 1}",
            image_index=context.image_index,
            amount=amount,
            merchant=merchant,
            note=note,
            source_platform=context.classification.platform,
            status=_read_status_text(joined, _spec_status_words(spec)),
            raw_text=joined,
        )
        for issue in amount_issues:
            candidate.add_issue(issue.code, issue.message, issue.field)
        if amount is None and not any(issue.code == ISSUE_AMOUNT_UNCERTAIN for issue in candidate.issues):
            candidate.add_issue(ISSUE_MISSING_AMOUNT, "没有读出这一笔的金额，请填写。", "amount")

        candidate.currency = _apply_currency(candidate, joined, context, spec=spec)

        # Only the group header may date the transaction.
        date, time, date_issues = _read_group_date_time(
            (header,), context.reference_year, context.reference_date
        )
        candidate.occurred_local_date = date
        candidate.occurred_time = time
        for issue in date_issues:
            candidate.add_issue(issue.code, issue.message, issue.field)
        if date is None:
            candidate.add_issue(ISSUE_MISSING_DATE, "没有读出这一笔的日期，请选择。", "date")
        if time is None:
            candidate.add_issue("missing_time", "BOA 列表不显示时间；同一天的重复交易靠余额列区分。", "time")

        if merchant is None:
            candidate.add_issue(ISSUE_MISSING_MERCHANT, "没有读出商户/描述，请填写。", "merchant")

        candidate.direction, candidate.is_refund, candidate.is_transfer = _resolve_direction(
            joined, read, candidate
        )
        _add_layout_issue(candidate, context.classification)
        candidates.append(candidate)

    return candidates


# --- WeChat bill cards ------------------------------------------------------

# A WeChat bill card's date is a header *above* the card and nothing inside the
# card repeats it: `10月12日晚上9:04`, `星期三 下午6:34`, and on the Alipay-style
# day boundary `今天 20:53`. The recogniser drops every space.
_CARD_DATE_HEADER = re.compile(
    r"^(?:(?:\d{4}\s*年)?\d{1,2}\s*月\s*\d{1,2}\s*日"
    r"|(?:星期|周|礼拜)[一二三四五六日天]"
    r"|今天|今日|昨天|昨日|前天)"
    r"\s*(?:凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*"
    r"\d{1,2}\s*[:：]\s*\d{2}$"
)

# WeChat's own summary block, which is not a transaction. Its numbers (`￥40.00`)
# are exactly the shape of a transaction amount, which is why they must be
# excluded by the block's wording rather than by their formatting.
_CARD_SUMMARY_MARKERS = (
    "微信记账本",
    "记账日报",
    "昨日支出",
    "昨日入账",
    "本月统计",
    "本月已支出",
    "本月已入账",
    "昨日收支明细",
)

# `使用零钱支付` / `使用XX银行储蓄卡支付`: the payment method, and the only
# evidence on the card that the money left.
_PAY_WITH = re.compile(r"使用(.{1,14}?)\s*支付")

# Card chrome that must never become the merchant.
_CARD_CHROME = ("账单详情", "使用", "微信支付")


def _drop_summary_blocks(body: Sequence[Line]) -> list[Line]:
    """Remove whole summary blocks (记账日报 and friends) from the card list.

    The block runs from its first line to the next card date header, or to the
    end of the page - a summary block never sits between a date header and its
    card.
    """

    kept: list[Line] = []
    index = 0
    while index < len(body):
        line = body[index]
        if any(marker in line.text for marker in _CARD_SUMMARY_MARKERS):
            index += 1
            while index < len(body) and not _CARD_DATE_HEADER.match(body[index].text.strip()):
                index += 1
            continue
        kept.append(line)
        index += 1
    return kept


def wechat_bill_cards(
    lines: Sequence[Line],
    context: ExtractionContext,
) -> list[Candidate]:
    """WeChat bill cards: date header + card (merchant, payment method, amount).

    The date belongs to the header *above* the card, the merchant is the card's
    own title, and `使用零钱支付` names the account. The screen's 记账日报 summary
    block is removed before any card is cut, because its `￥40.00` is a statistic
    and not money that moved.
    """

    body = _drop_summary_blocks(_sorted_body(lines))
    headers = [line for line in body if _CARD_DATE_HEADER.match(line.text.strip())]
    if not headers:
        return _extract_list_rows(lines, context, _layout_spec(context))

    spec = _layout_spec(context)
    candidates: list[Candidate] = []

    for index, header in enumerate(headers):
        limit = headers[index + 1].top if index + 1 < len(headers) else float("inf")
        region = [line for line in body if header.top < line.top < limit]
        amounts = [line for line in region if is_amount_like(line)]
        if not amounts:
            # A date header whose card is scrolled off the bottom (the real
            # sample ends on one) has no transaction to cut.
            continue

        # The amount is the card's biggest number; anything left is a caption.
        amount_line = max(amounts, key=lambda line: (line.height, len(line.text.strip())))
        joined = "\n".join(line.text for line in region)

        merchant = None
        for band in vertical_bands(region)[:3]:
            options = [
                line
                for line in band
                if _looks_like_merchant(line.text)
                and not any(word in line.text for word in _CARD_CHROME)
            ]
            if options:
                best = max(options, key=lambda line: (line.height, len(line.text.strip())))
                merchant = best.text.strip()
                break

        read = normalize.read_amount(amount_line.text)
        candidate = Candidate(
            candidate_id=f"img{context.image_index}-{len(candidates) + 1}",
            image_index=context.image_index,
            amount=read.value,
            merchant=merchant,
            source_platform=context.classification.platform,
            raw_text=joined,
        )
        for issue in read.issues:
            candidate.add_issue(issue.code, issue.message, issue.field)
        if read.value is None:
            candidate.add_issue(ISSUE_MISSING_AMOUNT, "没有读出这一笔的金额，请填写。", "amount")

        pay_with = _PAY_WITH.search(joined)
        if pay_with is not None:
            candidate.account = pay_with.group(1).strip()

        candidate.currency = _apply_currency(candidate, joined, context, spec=spec)

        date, time, date_issues = _read_group_date_time(
            (header,), context.reference_year, context.reference_date
        )
        candidate.occurred_local_date = date
        candidate.occurred_time = time
        for issue in date_issues:
            candidate.add_issue(issue.code, issue.message, issue.field)
        if date is None:
            candidate.add_issue(ISSUE_MISSING_DATE, "没有读出这一笔的日期，请选择。", "date")
        if time is None:
            candidate.add_issue("missing_time", "没有读出时间。", "time")

        if merchant is None:
            candidate.add_issue(ISSUE_MISSING_MERCHANT, "没有读出商户，请填写。", "merchant")

        if normalize.is_refund_text(joined):
            candidate.direction, candidate.is_refund = "income", True
        elif pay_with is not None:
            # WeChat prints `使用…支付` only on money going out. Without this the
            # card has no sign and no 收入/支出 word, so the direction would stay
            # unknown on every card.
            candidate.direction = "expense"
        else:
            candidate.direction, candidate.is_refund, candidate.is_transfer = _resolve_direction(
                joined, read, candidate
            )

        _add_layout_issue(candidate, context.classification)
        candidates.append(candidate)

    return candidates


# --- Alipay transaction list ------------------------------------------------

# Alipay names the day relatively. `今天` needs the screenshot date; `10-1823:58`
# has the clock glued to the day.
_ALIPAY_STATUS_PHRASES = (
    "已报销",
    "自动扣款成功",
    "退款成功",
    "已退款",
    "交易关闭",
    "等待付款",
    "还款成功",
)

# The amount column is right-aligned on this screen; a monthly summary prints its
# numbers under its labels, far from the right edge. Only numbers in this band of
# the page width are treated as transaction amounts.
_ALIPAY_RIGHT_ALIGNED = 0.72


def alipay_bill_rows(
    lines: Sequence[Line],
    context: ExtractionContext,
) -> list[Candidate]:
    """Alipay transaction list: right-aligned amount, category, status, date.

    The screen's top area is a monthly summary (`支出/收入/￥2,631.78`) and a
    「收支分析」button; neither is a transaction. They are excluded structurally,
    by the amount column being right-aligned, rather than by a list of words that
    Alipay changes with every release.
    """

    body = _sorted_body(lines)
    if not body:
        return []

    page_right = max(line.left for line in body)
    right_zone = page_right * _ALIPAY_RIGHT_ALIGNED

    spec = _layout_spec(context)
    bands = vertical_bands(body)
    # A transaction starts on the band that carries a right-aligned amount. Its
    # metadata (category, status, date) is on the *following* bands, up to the
    # next amount band - the next row's description can sit a hair above its own
    # amount, so the cut has to be on bands, not on the amount's top.
    starts: list[tuple[int, Line]] = []
    for index, band in enumerate(bands):
        numbers = [line for line in band if is_amount_like(line) and line.left >= right_zone]
        if numbers:
            starts.append((index, max(numbers, key=lambda line: (line.height, line.left))))
    if not starts:
        # Nothing looked like a right-aligned amount column: this is not the shape
        # this cutter knows, so the generic rule gets its chance.
        return _extract_list_rows(lines, context, spec)

    candidates: list[Candidate] = []

    for ordinal, (index, row) in enumerate(starts):
        stop = starts[ordinal + 1][0] if ordinal + 1 < len(starts) else len(bands)
        amount_band = bands[index]
        later_bands = bands[index + 1 : stop]
        region = [line for band in bands[index:stop] for line in band]
        joined = "\n".join(line.text for line in region)

        date, time, date_issues = _read_group_date_time(
            region, context.reference_year, context.reference_date
        )

        status = _read_status_text(joined, _ALIPAY_STATUS_PHRASES)
        merchant_candidates = [
            line
            for line in amount_band
            if line is not row
            and line.left < row.left
            and _looks_like_merchant(line.text)
            and not any(phrase in line.text for phrase in _ALIPAY_STATUS_PHRASES)
        ]
        merchant = None
        if merchant_candidates:
            merchant = max(
                merchant_candidates, key=lambda line: (len(line.text.strip()), -line.left)
            ).text.strip()

        # The category (文化休闲 / 教育培训) is the one short text row *below* the
        # amount that is neither the date line, the status line nor a caption of
        # the merchant.
        note = None
        for line in (line for band in later_bands for line in band):
            text = line.text.strip()
            if not text:
                continue
            if any(phrase in text for phrase in _ALIPAY_STATUS_PHRASES):
                continue
            if normalize.read_date_time(
                text, reference_year=context.reference_year, reference_date=context.reference_date
            ).date is not None:
                continue
            if _looks_like_merchant(text):
                note = text
                break

        read = normalize.read_amount(row.text)
        candidate = Candidate(
            candidate_id=f"img{context.image_index}-{len(candidates) + 1}",
            image_index=context.image_index,
            amount=read.value,
            merchant=merchant,
            note=note,
            status=status,
            source_platform=context.classification.platform,
            raw_text=joined,
        )
        for issue in read.issues:
            candidate.add_issue(issue.code, issue.message, issue.field)
        if read.value is None:
            candidate.add_issue(ISSUE_MISSING_AMOUNT, "没有读出这一笔的金额，请填写。", "amount")

        candidate.currency = _apply_currency(candidate, joined, context, spec=spec)
        candidate.occurred_local_date = date
        candidate.occurred_time = time
        for issue in date_issues:
            candidate.add_issue(issue.code, issue.message, issue.field)
        if date is None:
            candidate.add_issue(ISSUE_MISSING_DATE, "没有读出这一笔的日期，请选择。", "date")
        if merchant is None:
            candidate.add_issue(ISSUE_MISSING_MERCHANT, "没有读出商户，请填写。", "merchant")

        candidate.direction, candidate.is_refund, candidate.is_transfer = _resolve_direction(
            joined, read, candidate
        )
        _add_layout_issue(candidate, context.classification)
        candidates.append(candidate)

    return candidates


# --- bank single detail / transfer confirmation -----------------------------


def _amount_and_date_from_fields(
    body: Sequence[Line],
    *,
    date_labels: tuple[str, ...],
) -> tuple[normalize.AmountRead, str | None, str | None, list[Issue]]:
    """Read `Amount` and a date field from an English detail screen."""

    issues: list[Issue] = []
    amount_text = _field_value(body, "Amount")
    read = normalize.AmountRead()
    if amount_text is not None:
        read = normalize.read_amount(amount_text)
        issues.extend(read.issues)

    date_text = _field_value(body, *date_labels)
    date: str | None = None
    time: str | None = None
    if date_text is not None:
        date_read = normalize.read_date_time(date_text)
        # The transaction date is a printed calendar date; a description that
        # also contains `10/16` must never replace it.
        if date_read.date is None:
            issues.append(
                Issue(ISSUE_MISSING_DATE, f"日期「{date_text}」读不出来，请选择。", "date")
            )
        date = date_read.date
        time = date_read.time
    return read, date, time, issues


def bank_single_detail(
    lines: Sequence[Line],
    context: ExtractionContext,
) -> list[Candidate]:
    """BOA `Transaction Details`: one transaction, labelled fields, English.

    Every value comes from its own label (`Amount`, `Transaction date`,
    `Merchant Name`), so the `10/16` inside the Description field cannot be read
    as the transaction date.
    """

    body = _sorted_body(lines)
    joined = "\n".join(line.text for line in lines)

    read, date, time, issues = _amount_and_date_from_fields(
        body, date_labels=("Transaction date", "Transaction Date", "Date")
    )
    type_text = _field_value(body, "Type")
    category = _field_value(body, "Transaction category")
    note = " · ".join(part for part in (type_text, category) if part) or None

    candidate = Candidate(
        candidate_id=f"img{context.image_index}-1",
        image_index=context.image_index,
        amount=read.value,
        merchant=_field_value(body, "Merchant Name"),
        note=note,
        status=_read_status_text(joined, ()),
        source_platform=context.classification.platform,
        raw_text=joined,
    )
    for issue in issues:
        candidate.add_issue(issue.code, issue.message, issue.field)
    candidate.currency = _apply_currency(candidate, joined, context, spec=_layout_spec(context))

    candidate.occurred_local_date = date
    candidate.occurred_time = time
    if candidate.occurred_local_date is None and not any(
        issue.code == ISSUE_MISSING_DATE for issue in candidate.issues
    ):
        candidate.add_issue(ISSUE_MISSING_DATE, "没有读出这一笔的日期，请选择。", "date")
    if candidate.amount is None and not any(
        issue.code in (ISSUE_AMOUNT_UNCERTAIN, ISSUE_AMOUNT_UNREADABLE) for issue in candidate.issues
    ):
        candidate.add_issue(ISSUE_MISSING_AMOUNT, "没有读出金额，请填写。", "amount")
    if candidate.merchant is None:
        candidate.add_issue(ISSUE_MISSING_MERCHANT, "没有读出商户，请填写。", "merchant")

    candidate.direction, candidate.is_refund, candidate.is_transfer = _resolve_direction(
        joined, read, candidate
    )
    _add_layout_issue(candidate, context.classification)
    return [candidate]


def bank_transfer_confirmation(
    lines: Sequence[Line],
    context: ExtractionContext,
) -> list[Candidate]:
    """BOA `Your payment is sent`: one transfer *out*, with the payee as merchant.

    A confirmation screen is not an ordinary purchase, so `is_transfer` is set
    from the layout rather than guessed from a word. The direction is `expense`
    because the screen's own sentence says the money was sent; the ledger's
    `status` vocabulary is pending/posted, so the screen's `Success` becomes
    `posted` (the word it printed stays in the note).
    """

    body = _sorted_body(lines)
    joined = "\n".join(line.text for line in lines)

    read, date, time, issues = _amount_and_date_from_fields(body, date_labels=("Date",))
    payee = _field_value(body, "To")
    sender = _field_value(body, "From")
    confirmation = _field_value(body, "Confirmation")

    # Only the product name: the last digits of the funding account are not a
    # field the ledger needs, and a partial account number is still an account
    # number.
    account = None
    if sender is not None:
        account = re.sub(r"[-\s]+\d{2,6}$", "", sender).strip().rstrip("-").strip() or None

    candidate = Candidate(
        candidate_id=f"img{context.image_index}-1",
        image_index=context.image_index,
        amount=read.value,
        merchant=payee,
        account=account,
        status=_read_status_text(joined, ()),
        is_transfer=True,
        serial=confirmation.strip() if confirmation is not None else None,
        source_platform=context.classification.platform,
        raw_text=joined,
    )

    for issue in issues:
        candidate.add_issue(issue.code, issue.message, issue.field)
    candidate.currency = _apply_currency(candidate, joined, context, spec=_layout_spec(context))

    candidate.occurred_local_date = date
    candidate.occurred_time = time
    if candidate.occurred_local_date is None:
        candidate.add_issue(ISSUE_MISSING_DATE, "没有读出这一笔的日期，请选择。", "date")
    if candidate.amount is None:
        candidate.add_issue(ISSUE_MISSING_AMOUNT, "没有读出金额，请填写。", "amount")
    if candidate.merchant is None:
        candidate.add_issue(ISSUE_MISSING_MERCHANT, "没有读出收款方，请填写。", "merchant")

    candidate.direction = "expense"
    _add_layout_issue(candidate, context.classification)
    return [candidate]


# --- 美团 / 京东 / 淘宝 order pages (2026-10-21 真实样本) ---------------------
#
# These three screens are *order* pages, not bill pages, and that changes two
# things the bill cutters never had to answer:
#
#   * the amount is the **order total the card prints**, while the same card also
#     prints a count (`共2件`), a rental duration (`使用时长：73分钟`) and a discount
#     (`共减￥x`). Only a money line is an amount;
#   * the card's date is **optional**: 美团 prints `下单：2026-09-02 17:56`, Taobao
#     prints `09.21` on the `实付款` row, and JD prints **no date at all** - which
#     must stay empty with a `missing_date` question, never be guessed.
#
# All three share one card shape: a **shop row** (shop name on the left, the
# order's own status on the right), the product rows, then the amount. So the
# merchant and the status are both read from that one row, and everything else
# is anchored on the amount.
#
# What must never become a candidate or a field: the platform ads and buttons
# (`再省一单`, `京东服务…`, `闪购`, `再来一单` / `再买一单` / `再次购买`), the
# notification banner (`开启通知，及时获取订单进度`), the count (`共2件`), the
# discount (`共减￥x`), the original price and the shipping promise
# (`预售，7月18日09:27前发货`).

# Buttons, filter chips and ad copy on these three screens. Substring matching is
# used only for phrases long enough not to hide inside a shop or product name.
_ORDER_CHROME_ANY = (
    "更多",
    "再来一单",
    "再买一单",
    "再次购买",
    "领神券",
    "加入购物车",
    "申请开票",
    "催发货",
    "修改地址",
    "删除订单",
    "查看发票",
    "去查看",
    "去开启",
    "开启通知",
    "搜索",
    "全部订单",
    "查看全部",
    # Address/contact/receipt rows: a hotel's name ends in 店 too, so an address
    # would otherwise win the merchant field (and take the user's address with it).
    "配送地址",
    "收货地址",
    "发票信息",
    "号码保护",
    "订单信息",
    "商品费用",
    "客服",
    "联系商家",
    "打赏骑手",
    "进店",
    "粉丝群",
    "费用明细",
    "申请售后",
    "退换/售后",
    "退款/售后",
    "评价晒单",
    "送朋友",
    "卖了换钱",
    "查看物流",
    "买后必看",
    "去看看",
    "筛选",
    "AI助手",
    "暂无进行中的订单",
    "限时",
    "优惠",
    "延保",
    "红包",
)

# Words that are chrome only when they are the whole line: `自营` is a JD badge
# but `京东自营旗舰店` is a shop name, and `外卖` is a badge while
# `【神抢手】…外卖兑换券` is what the order was for.
_ORDER_CHROME_EXACT = frozenset(
    {
        "全部",
        "购物",
        "服务",
        "健康",
        "待",
        "自营",
        "外卖",
        "天猫",
        "淘宝",
        "完成",
        "待付款",
        "待收货",
        "待发货",
        "待使用",
        "已完成",
        "评价",
        "发票",
        "筛选",
        "管理",
        "客服",
        "秒送外卖",
        "飞猪",
        "闪购",
        "京东服务",
        "搜索我的订单",
        "搜索订单",
        "退款/售后",
    }
)

# `爷爷不泡茶(济南高新万达店）>` → without the chevron. The chevron is the
# screen's "this row opens a page" mark, not part of the name.
_CHEVRON_TAIL = re.compile(r"\s*[>＞»]+\s*$")

# The status filter row at the top of every one of these lists (`全部` / `待付款` /
# `待收货/待使用`). It is page chrome, not an order: 美团 glues two chips into one
# OCR line, and before this was excluded the first card inherited
# `待收货/待使用` as its merchant and `待付款` as its status.
_ORDER_CHIP = re.compile(r"^待?[付款收货发使用评价]+(?:/待?[付款收货发使用评价]+)?$")


def _strip_chevron(text: str) -> str:
    return _CHEVRON_TAIL.sub("", text.strip()).strip()


def _is_order_chrome(text: str) -> bool:
    stripped = text.strip()
    if stripped in _ORDER_CHROME_EXACT:
        return True
    if _ORDER_CHIP.match(stripped):
        return True
    return any(word in stripped for word in _ORDER_CHROME_ANY)


def _looks_like_shop(text: str) -> bool:
    """A shop/merchant row on these order screens.

    `店` is the only word all three platforms share (`旗舰店` / `专营店` / `(…店)`),
    and a shop name never carries a date or a price. Requiring 店 is what keeps
    `订单信息` / `商品费用` / `进店逛逛` out of the merchant field.
    """

    stripped = _strip_chevron(text)
    if len(stripped) < 3 or "店" not in stripped:
        return False
    if _is_order_chrome(stripped):
        return False
    if is_date_like(stripped) or normalize.currency_in(stripped) is not None:
        return False
    return True


def _order_status(text: str, spec: ExtractionSpec) -> str | None:
    """The status the screen itself prints, in the layout's own vocabulary."""

    for marker, status in spec.status_markers:
        if marker in text:
            return status
    return normalize.normalize_status(text)


def _order_refund_wording(joined: str) -> bool:
    """A refund this screen states as such.

    The strict markers only: the bare word 退款 also appears in a shop's own
    rating (`好评率89%，平均22小时退款`) and in a service promise (`极速退款`), and
    reading either as a refund would flip the direction of a payment.
    """

    return any(marker in joined for marker in normalize.REFUND_MARKERS)


def _order_direction(
    candidate: Candidate,
    joined: str,
    spec: ExtractionSpec,
    read: normalize.AmountRead,
) -> tuple[str, bool, bool]:
    """Direction for one order card or detail page.

    Order of evidence, and why:

      1. a closed order (`交易关闭` / `超时关闭`) never became a payment, so the
         direction stays `unknown` and the question is shown to the user - a
         plausible amount on such a screen is very likely *not* money that moved;
      2. a refund (`退款成功`) is money coming back;
      3. a printed sign (unlikely on these screens, but free to honour);
      4. wording in the row (`收入` / `支出`), then the layout's default
         direction - 我的订单 only ever lists purchases I placed, which is why
         `default_direction="expense"` is declared per layout instead of assumed
         here.
    """

    closed = normalize.closed_marker_in(joined)
    refund = _order_refund_wording(joined)

    if closed is not None:
        candidate.add_issue(
            ISSUE_ORDER_CLOSED,
            f"这一笔印着「{closed}」，可能没有实际付款，请确认是否需要记账。",
            "status",
        )
        if refund:
            # 淘宝 prints both: the order was closed *and* the money was returned.
            return "income", True, False
        return "unknown", False, False

    if refund:
        return "income", True, False

    if read.negative is not None:
        return ("expense" if read.negative else "income"), False, False

    text_direction = normalize.direction_from_text(joined)
    if text_direction in ("income", "expense"):
        return text_direction, False, False

    if spec.default_direction in ("expense", "income"):
        return spec.default_direction, False, False

    return _resolve_direction(joined, read, candidate)


def _card_identity(
    window: Sequence[Line],
    spec: ExtractionSpec,
) -> tuple[str | None, str | None]:
    """The shop name and the status from the card's own header row.

    The header row is the only row that carries a shop name, and it is the same
    row the screen prints the order status on (完成 / 待发货 / 交易关闭). Reading
    the status from that row instead of from the whole card is what stops the
    page's filter chips (`待付款` / `待收货` at the top of the list) from being
    read as an order's status.
    """

    for band in vertical_bands(window):
        shops = [line for line in band if _looks_like_shop(line.text)]
        if not shops:
            continue
        shop = max(shops, key=lambda line: len(line.text.strip()))
        band_text = "\n".join(line.text for line in band)
        return _strip_chevron(shop.text), _order_status(band_text, spec)

    # No shop row on this card: 美团's 充电宝 card only prints what the order was.
    for band in vertical_bands(window):
        for line in sorted(band, key=lambda item: item.left):
            if _is_order_chrome(line.text) or not _looks_like_merchant(line.text):
                continue
            band_text = "\n".join(item.text for item in band)
            return _strip_chevron(line.text), _order_status(band_text, spec)

    return None, None


def _card_window(
    body: Sequence[Line],
    start: float,
    stop: float,
) -> list[Line]:
    """The lines between two vertical boundaries, in reading order."""

    return [line for line in body if start < line.top < stop]


def _order_amount_rows(
    body: Sequence[Line],
    *,
    amount_labels: tuple[str, ...],
) -> list[Line]:
    """The one money row per card, top to bottom.

    Two shapes, both observed: 美团/京东 print a right-aligned `￥xx.xx`, and
    淘宝 prints the same money inside its own label (`实付款￥xx`). The second
    shape needs the label because the *original* price is also printed on the
    card (a bare `￥xx` next to the product title).
    """

    if amount_labels:
        rows = [
            line
            for line in body
            if any(line.text.strip().startswith(label) for label in amount_labels)
            and normalize.read_amount(line.text).value is not None
        ]
        return rows

    page_right = max(line.left for line in body)
    right_zone = page_right * _ALIPAY_RIGHT_ALIGNED
    return [line for line in body if is_amount_like(line) and line.left >= right_zone]


def _date_cell_text(text: str) -> str:
    """The part of a row that can hold a date (`09.21 | 实付款￥xx` → `09.21`)."""

    cut = len(text)
    for needle in ("实付款", "实付价", "应付款", "合计", "¥", "￥"):
        index = text.find(needle)
        if index != -1:
            cut = min(cut, index)
    return text[:cut]


def _order_card_date(
    card: Sequence[Line],
    anchor: Line,
    context: ExtractionContext,
    *,
    date_scope: str,
) -> tuple[str | None, str | None, list[Issue]]:
    """The card's own date, or nothing at all.

    `date_scope="card"` (美团/京东) reads any printed date inside the card.
    `date_scope="paid-row"` (淘宝) reads only the row that carries `实付款`,
    because the rest of a Taobao card prints dates that are *not* the order's:
    a promo window (`限时补款：2026年9月20日-…`) and a shipping promise
    (`预售，7月18日09:27前发货`). Using those would date a purchase to a campaign.
    """

    if date_scope == "paid-row":
        row = [line for line in card if _same_row(line, anchor)]
        for line in sorted(row, key=lambda item: item.left):
            read = normalize.read_short_date(
                _date_cell_text(line.text),
                reference_year=context.reference_year,
                reference_date=context.reference_date,
            )
            if read.date is not None:
                return read.date, read.time, list(read.issues)
        return None, None, []

    return _read_group_date_time(card, context.reference_year, context.reference_date)


def _order_rows(
    lines: Sequence[Line],
    context: ExtractionContext,
    *,
    amount_labels: tuple[str, ...] = (),
    date_scope: str = "card",
) -> list[Candidate]:
    """One candidate per order card, cut on the card's own money row."""

    body = _sorted_body(lines)
    if not body:
        return []

    spec = _layout_spec(context)
    anchors = _order_amount_rows(body, amount_labels=amount_labels)
    if not anchors:
        # None of the shapes this cutter knows: the generic row rule still gets
        # its chance, so a screen that drifted does not silently yield nothing.
        return _extract_list_rows(lines, context, spec)

    candidates: list[Candidate] = []

    for index, anchor in enumerate(anchors):
        # The card starts at its shop row when that row can be found above the
        # amount; a card without one (美团's 充电宝) starts halfway from the
        # previous amount instead.
        previous = anchors[index - 1].top if index > 0 else float("-inf")
        identity_window = _card_window(body, previous, anchor.top + 1)
        start = previous
        for band in vertical_bands(identity_window):
            if any(_looks_like_shop(line.text) for line in band):
                # Half a pixel above the header row, because the row *is* part of
                # the card (`交易关闭` sits on it) and the boundary test is strict.
                start = min(line.top for line in band) - 1.0
                break

        stop = (
            anchors[index + 1].top
            if index + 1 < len(anchors)
            else float("inf")
        )
        card = _card_window(body, start, stop)
        if not card:
            card = identity_window

        merchant, status = _card_identity(identity_window, spec)
        visible = [line for line in card if not _is_order_chrome(line.text)]
        joined = "\n".join(line.text for line in visible)

        read = normalize.read_amount(anchor.text)
        candidate = Candidate(
            candidate_id=f"img{context.image_index}-{index + 1}",
            image_index=context.image_index,
            amount=read.value,
            merchant=merchant,
            status=status,
            source_platform=context.classification.platform,
            raw_text=joined,
        )
        for issue in read.issues:
            if issue.code == ISSUE_MISSING_CURRENCY:
                continue  # settled once by `_apply_currency`, with its own wording
            candidate.add_issue(issue.code, issue.message, issue.field)
        if candidate.amount is None:
            candidate.add_issue(ISSUE_MISSING_AMOUNT, "没有读出这一笔的金额，请填写。", "amount")

        candidate.currency = _apply_currency(candidate, joined, context, spec=spec)

        date, time, date_issues = _order_card_date(
            card, anchor, context, date_scope=date_scope
        )
        candidate.occurred_local_date = date
        candidate.occurred_time = time
        for issue in date_issues:
            candidate.add_issue(issue.code, issue.message, issue.field)
        if date is None:
            candidate.add_issue(
                ISSUE_MISSING_DATE,
                "这张订单卡片上没有日期，请选择是哪一天。",
                "date",
            )
        elif time is None:
            candidate.add_issue("missing_time", "卡片上没有时间，同一天的多笔可能无法区分。", "time")

        if candidate.merchant is None:
            candidate.add_issue(ISSUE_MISSING_MERCHANT, "没有读出店铺/商户，请填写。", "merchant")

        candidate.direction, candidate.is_refund, candidate.is_transfer = _order_direction(
            candidate, joined, spec, read
        )
        _add_layout_issue(candidate, context.classification)
        candidates.append(candidate)

    return candidates


def meituan_order_rows(
    lines: Sequence[Line],
    context: ExtractionContext,
) -> list[Candidate]:
    """美团外卖订单列表: 店铺 + 状态 on the header row, 金额 right-aligned.

    The card's date is either the plain timestamp (`2026-09-13 18:45:25`) or the
    label the screen prints (`下单：2026-09-02 17:56`), and both are inside the
    card - so the whole card is searched, and `使用时长：73分钟` is not a date.
    """

    return _order_rows(lines, context, date_scope="card")


def jd_order_rows(
    lines: Sequence[Line],
    context: ExtractionContext,
) -> list[Candidate]:
    """京东订单列表: same card shape, but the card prints **no date at all**.

    That is a fact about the screen, not a reading failure, so every candidate
    keeps an empty date and a `missing_date` question instead of borrowing the
    screenshot's date.
    """

    return _order_rows(lines, context, date_scope="card")


def taobao_order_rows(
    lines: Sequence[Line],
    context: ExtractionContext,
) -> list[Candidate]:
    """淘宝/天猫订单列表: the money row is `实付款￥xx`, and it also holds the date.

    The date on that row (`09.21`) has no year; it is completed from the
    reference year and flagged `year_inferred`. A card cut off by the bottom of
    the screen prints no `实付款` and therefore yields nothing, rather than an
    empty transaction.
    """

    return _order_rows(
        lines,
        context,
        amount_labels=("实付款", "实付价", "应付款"),
        date_scope="paid-row",
    )


# Money labels that name the *paid* total on a Chinese order detail, the most
# authoritative first. Order matters: `应付款`/`实付款`/`合计` are totals, while
# `实付价` is one line item - and the original price has no label at all.
_ORDER_AMOUNT_LABELS = (
    "应付款",
    "实付款",
    "合计",
    "总计",
    "订单金额",
    "付款金额",
    "实付价",
    "实付",
    "到手",
)

_PAYMENT_LABELS = ("支付方式", "付款方式")


def _amount_after_label(text: str, labels: Sequence[str]) -> str | None:
    """`共减￥x合计￥yy` → `yy` (the number that follows a money label)."""

    for label in labels:
        match = re.search(
            re.escape(label) + r"\s*[¥￥]?\s*(\d[\d,]*(?:\.\d{1,2})?)",
            text,
        )
        if match is not None:
            return match.group(1).replace(",", "")
    return None


def _labelled_amount(
    body: Sequence[Line],
    labels: Sequence[str],
) -> normalize.AmountRead:
    """The amount the page labels as paid, or an empty read.

    Three shapes appear on the real screens and all three are accepted:

      * `合计￥xx` - label and number on one line (美团);
      * `应付款` | `￥xx` - a label cell and a value cell on one row (淘宝);
      * `实付款` | `共减￥x合计￥yy` - the value cell itself carries the
        discount, so the number *after* a money label wins (京东).
    """

    for label in labels:
        for line in body:
            if label not in line.text:
                continue

            if line.text.strip() != label:
                inline = _amount_after_label(line.text, labels)
                if inline is not None:
                    return normalize.AmountRead(
                        value=inline, currency=normalize.currency_in(line.text)
                    )

            row = [
                other
                for other in body
                if other is not line
                and _same_row(other, line)
                and other.left > line.left + 2
            ]
            for other in sorted(row, key=lambda item: item.left):
                value = _amount_after_label(other.text, labels)
                if value is None:
                    single = normalize.read_amount(other.text)
                    value = single.value
                if value is not None:
                    return normalize.AmountRead(
                        value=value, currency=normalize.currency_in(other.text)
                    )

    return normalize.AmountRead()


def _detail_merchant(body: Sequence[Line]) -> str | None:
    for line in body:
        if _looks_like_shop(line.text):
            return _strip_chevron(line.text)
    return None


def _row_value_right_of(
    body: Sequence[Line],
    labels: Sequence[str],
) -> str | None:
    """The text to the right of an exact label, on the label's own row."""

    for label in labels:
        anchor = next((line for line in body if line.text.strip() == label), None)
        if anchor is None:
            continue
        row = [
            other
            for other in body
            if other is not anchor
            and _same_row(other, anchor)
            and other.left > anchor.left + 2
            and other.text.strip() != ""
        ]
        if row:
            return _strip_chevron(min(row, key=lambda item: item.left).text)
    return None


def _detail_date_time(
    body: Sequence[Line],
    context: ExtractionContext,
) -> tuple[str | None, str | None, list[Issue]]:
    """A date the page prints, or nothing.

    A detail page often prints no date at all (美团/京东 do not), and the
    screenshot's own date is **not** a substitute - `missing_date` is the honest
    answer. When the date comes from a sentence rather than a field
    (`凭据：6月25日下单交易快照`), it is kept but flagged `date_hint`, so the user
    sees where the number came from.
    """

    for line in body:
        text = line.text.strip()
        read = normalize.read_date_time(
            text,
            reference_year=context.reference_year,
            reference_date=context.reference_date,
        )
        if read.date is None:
            continue
        issues = list(read.issues)
        if "下单" in text:
            issues.append(
                Issue(
                    ISSUE_DATE_HINT,
                    f"日期是从「{text[:24]}」这一行读到的，不是独立的日期字段，请确认。",
                    "date",
                )
            )
        return read.date, read.time, issues
    return None, None, []


def cn_order_detail(
    lines: Sequence[Line],
    context: ExtractionContext,
) -> list[Candidate]:
    """美团 / 京东 / 淘宝 订单详情: one order, amount from its own money label.

    The amount is whichever number the screen labels as paid, never the largest
    number: the same page prints the original price, the discount
    (`共减￥x`) and a points/reward line, and a wrong amount is worse
    than a blank one. The payment method is read only when the screen actually
    prints it - 美团 keeps it behind a collapsed row (`配送骑手/支付方式等`), which
    must not be turned into a guess.
    """

    body = _sorted_body(lines)
    joined = "\n".join(line.text for line in lines)
    spec = _layout_spec(context)

    read = _labelled_amount(body, spec.amount_labels or _ORDER_AMOUNT_LABELS)
    if read.value is None:
        # Nothing labelled: fall back to the largest number, the rule the older
        # single-detail reader used, and let the issues say what happened.
        numbers = [line for line in body if is_amount_like(line)]
        if numbers:
            read = normalize.read_amount(max(numbers, key=lambda line: line.height).text)

    date, time, date_issues = _detail_date_time(body, context)

    candidate = Candidate(
        candidate_id=f"img{context.image_index}-1",
        image_index=context.image_index,
        amount=read.value,
        occurred_local_date=date,
        occurred_time=time,
        merchant=_detail_merchant(body),
        account=_row_value_right_of(body, _PAYMENT_LABELS),
        status=_order_status(joined, spec),
        source_platform=context.classification.platform,
        raw_text=joined,
    )

    for issue in read.issues:
        if issue.code == ISSUE_MISSING_CURRENCY:
            continue  # settled once by `_apply_currency`, with its own wording
        candidate.add_issue(issue.code, issue.message, issue.field)
    if candidate.amount is None:
        candidate.add_issue(ISSUE_MISSING_AMOUNT, "没有读出金额，请填写。", "amount")

    candidate.currency = _apply_currency(candidate, joined, context, spec=spec)

    for issue in date_issues:
        candidate.add_issue(issue.code, issue.message, issue.field)
    if candidate.occurred_local_date is None:
        candidate.add_issue(ISSUE_MISSING_DATE, "这张详情页上没有日期，请选择是哪一天。", "date")
    elif candidate.occurred_time is None:
        candidate.add_issue("missing_time", "详情页上没有时间。", "time")

    if candidate.merchant is None:
        candidate.add_issue(ISSUE_MISSING_MERCHANT, "没有读出店铺/商户，请填写。", "merchant")

    candidate.direction, candidate.is_refund, candidate.is_transfer = _order_direction(
        candidate, joined, spec, read
    )
    _add_layout_issue(candidate, context.classification)
    return [candidate]


_BUILTIN_EXTRACTORS: dict[str, CustomExtractor] = {
    "boa-activity-rows": boa_activity_rows,
    "wechat-bill-cards": wechat_bill_cards,
    "alipay-bill-rows": alipay_bill_rows,
    "bank-single-detail": bank_single_detail,
    "bank-transfer-confirmation": bank_transfer_confirmation,
    "meituan-order-rows": meituan_order_rows,
    "jd-order-rows": jd_order_rows,
    "taobao-order-rows": taobao_order_rows,
    "cn-order-detail": cn_order_detail,
}


def reset_custom_extractors() -> None:
    """Put the extractor registry back to the built-ins. For tests that add one."""

    CUSTOM_EXTRACTORS.clear()
    CUSTOM_EXTRACTORS.update(_BUILTIN_EXTRACTORS)


reset_custom_extractors()


def extract_pages(pages: Sequence[tuple[int, Sequence[Line]]],
    *,
    reference_year: int | None = None,
    reference_date: str | None = None,
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
                reference_date=reference_date,
            )
        )
    return results
