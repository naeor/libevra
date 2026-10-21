"""Decide what kind of page a screenshot is - before counting transactions.

This is layer 2 of S15-B (design direction §4): the OCR layer only gives text
with positions; this module answers **one** question - 单笔详情 / 交易列表 /
无法判断 - and says which features led to that answer. Extraction (layer 3-4)
is a separate module, so a wrong page type and a wrong field can be debugged
independently.

Two product rules from the design direction are baked in here:

  * **Unknown means ask, never guess.** If no registered layout matches, the
    answer is `unknown` with `requires_user_choice=True`. The interface then
    offers 按单笔处理 / 按多笔处理 / 取消 instead of silently deciding a count.
  * **Every answer is explainable.** `Classification.evidence` lists the
    keywords and structural facts that fired. There is no "the model says so".

## 已知 / 未验证 版式（2026-10-20 真实样本基线）

| layout id | 依据 | 状态 |
|---|---|---|
| wechat-single-detail | `real-samples/README.md` 记录的 6 张真实截图 + `make_samples.py` 合成样本 | 已验证 |
| alipay-single-detail | 同上 | 已验证 |
| wechat-bill-list | 真实样本：微信「账单」全部列表 8 笔，金额/日期/时间/商户/方向全对 | 已验证 |
| wechat-bill-cards | 真实样本：微信支付账单卡片 2 张（分组日期头 + 记账日报排除） | 已验证 |
| alipay-transaction-list | 真实样本：支付宝交易记录 5 笔（相对日期 + 汇总/按钮排除） | 已验证 |
| meituan-order-list | 真实样本：美团外卖订单列表 1 张（4 笔，含广告卡/通知横幅） | 已验证（1 张） |
| meituan-order-detail | 真实样本：美团外卖订单详情 1 张（合计金额，页面无日期） | 已验证（1 张） |
| jd-order-list | 真实样本：京东订单列表 1 张（3 笔，卡片不打印日期） | 已验证（1 张） |
| jd-order-detail | 真实样本：京东订单详情 1 张（实付款/合计/支付方式） | 已验证（1 张） |
| taobao-order-list | 真实样本：淘宝订单列表 1 张（2 笔，`09.21` 缺年份 + 交易关闭） | 已验证（1 张） |
| taobao-order-detail | 真实样本：淘宝交易关闭详情 1 张（交易关闭 = 方向未知） | 已验证（1 张） |
| boa-activity-list | 真实样本：BOA 交易列表 2 张（滚动重叠，金额/余额列分离） | 已验证 |
| bank-single-detail | 真实样本 1 张（BOA Transaction Details） | **未验证**（仅 1 张） |
| bank-transfer-confirmation | 真实样本 1 张（BOA 转账成功页） | **未验证**（仅 1 张） |
| bank-transfer-detail | 仅 `make_samples.py` 合成样本；真实银行 App 截图仍缺失 | **未验证** |
| wechat-transaction-list | **没有真实「交易记录」行式样截图**；按常见字段先建框架 | **未验证** |
| generic-transaction-list | 纯结构规则（多组"金额 + 日期"行） | **未验证** |

The table above is the honest answer to "支持哪些版式". "已验证" means at least one
real screenshot was read end-to-end and every field it printed came out right;
it does not mean every screen of that bank is handled. The two bank detail
layouts have exactly one sample each, so they stay unverified and every candidate
they yield carries the unverified-layout flag.

The six 美团/京东/淘宝 order layouts (2026-10-21) are the exception that proves
the rule: each has **one** real sample per page type, and it was read field by
field, so they are marked verified - but one screenshot cannot cover a platform's
variants (a Taobao detail that prints no `交易关闭`, a 美团 card with no date, a
JD card whose shop name is OCR'd in two pieces). Their `notes` and
`real-samples/README.md` say what that one sample did and did not prove.

## 如何新增一个银行/版式

1. 收集**合成或脱敏**样本（真实截图不得入库，见 design direction §8）；
2. 在本文件末尾照现有描述对象加一个 `LayoutDescriptor`：
   - `features`：`platform_markers`（出现任一即认为属于该来源）、
     `required_markers`（必须全部出现）、`strong`/`weak`/`list_markers`（加分关键词）、
     `min_detail_labels`（详情页字段标签下限）、`structure`（`single-detail`/`list`）；
   - `extraction`：`strategy="single-detail"` 复用现有单笔规则，或 `"list-rows"`
     复用通用行切分；若该行式样特殊（例如金额在左、日期单独一列），
     在 `multi_extract.CUSTOM_EXTRACTORS` 里加一个函数并让
     `extraction.strategy="custom"`、`custom_extractor="<名字>"`；
3. 用该银行的合成样本补 `tests/fixtures.py` 与 `tests/test_layouts.py`；
4. **未验证**的版式必须 `verified=False`，概述页会把它标成待确认；
5. 不需要改 `classify()` 或主流程 - 注册表遍历顺序就是优先级，得分相同则先注册者优先。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal, Sequence

from extract import (
    CLOCK,
    CN_RELATIVE_DAY,
    CN_WEEKDAY,
    DATE_DASHED,
    DATE_WITH_MARKERS,
    EN_MONTH_DATE,
    LABEL_AMOUNT_ROW,
    LABEL_COUNTERPARTY_IN,
    LABEL_COUNTERPARTY_OUT,
    LABEL_NOTE,
    Line,
    NUMBER,
    SERIAL_LENGTH,
    STATUS_BAR_FRACTION,
    TRIM,
)

PageType = Literal["single-detail", "transaction-list", "unknown"]

PAGE_TYPE_LABELS: dict[str, str] = {
    "single-detail": "单笔详情",
    "transaction-list": "交易列表",
    "unknown": "无法判断",
}

# `¥` is read as CNY by `normalize.currency_in`; these labels are the fallback
# vocabulary for pages where no registered layout matched.
PLATFORM_LABELS: dict[str, str] = {
    "WECHAT": "微信",
    "ALIPAY": "支付宝",
    "BANK": "银行",
    "MEITUAN": "美团",
    "JD": "京东",
    "TAOBAO": "淘宝/天猫",
}

WECHAT_MARKERS = ("微信支付", "财付通", "微信账单", "对订单有疑惑", "零钱", "微信")
ALIPAY_MARKERS = ("支付宝", "芝麻", "账单管理", "计入收支", "余额宝", "我的余额")

# Field labels a *detail* page prints as its own row. They are the strongest
# structural sign of a single-transaction screen: a list page has no room for
# them, and a coupon/ad block does not use these words.
DETAIL_LABELS: frozenset[str] = frozenset(
    set(LABEL_AMOUNT_ROW)
    | set(LABEL_COUNTERPARTY_OUT)
    | set(LABEL_COUNTERPARTY_IN)
    | set(LABEL_NOTE)
    | {
        "当前状态",
        "交易状态",
        "转账状态",
        "支付方式",
        "付款方式",
        "收款方式",
        "退款状态",
        "退款方式",
        "退款时间",
        "退款单号",
        "原订单",
        "交易单号",
        "商户单号",
        "交易号",
        "订单号",
        "交易流水号",
        "付款账户",
        "收款账户",
        "转账说明",
        "转账时间",
        "交易时间",
        "创建时间",
        "支付时间",
        "收款时间",
        "备注",
        "商品",
        "商品说明",
        "商户全称",
        "收款方全称",
        "账单详情",
        "退款进度",
        "关联记录",
        "支付方式",
    }
)

# The same idea on an English bank screen (`real-samples/2026-10-20_BOA*`): BOA
# prints its field name and its value on separate rows, and two of those values
# are numbers (`Amount`, `Transaction date`), so without these labels a detail
# screen's amount row and date row would be counted as two transactions.
BANK_FIELD_LABELS: frozenset[str] = frozenset(
    {
        "Merchant Name",
        "Amount",
        "Transaction date",
        "Transaction Date",
        "Date",
        "Type",
        "Transaction category",
        "Description",
        "From",
        "To",
        "Confirmation",
        "Number",
        "Confirmation Number",
        "Account",
        "Balance",
        "Posted Date",
    }
)

DETAIL_LABELS: frozenset[str] = DETAIL_LABELS | BANK_FIELD_LABELS

# Keywords that only appear on a *list* screen. Kept small on purpose: a list
# page is better recognised by its row structure, and a keyword that is wrong
# here silently changes a transaction count.
LIST_MARKERS = (
    "交易记录",
    "账单",
    "全部账单",
    "月账单",
    "收支明细",
    "交易明细",
    "流水",
    "Transactions",
    "Activity",
    "Posted",
    "Pending",
)

# A numeric line that might be a transaction amount. Signs/currency marks are
# stripped because the recogniser splits them onto their own line.
def is_amount_like(line: Line) -> bool:
    stripped = line.text.strip().strip(TRIM)
    if not stripped or not NUMBER.match(stripped):
        return False

    plain = stripped.replace(",", "")
    if "." not in plain and len(plain) >= SERIAL_LENGTH:
        return False
    # A four-digit year is not an amount; neither is the status bar clock.
    if "." not in plain and re.fullmatch(r"(?:19|20)\d{2}", plain):
        return False
    return True


def is_date_like(text: str) -> bool:
    return bool(
        DATE_WITH_MARKERS.search(text)
        or DATE_DASHED.search(text)
        # `Oct 19, 2026`: a US bank list's group date.
        or EN_MONTH_DATE.search(text)
        # `今天` / `昨天` (Alipay's list) and `星期三` (WeChat's card header).
        or CN_RELATIVE_DAY.search(text)
        or CN_WEEKDAY.search(text)
        or re.search(r"\d{1,2}\s*/\s*\d{1,2}(?:\s*/\s*\d{2,4})?", text)
        or re.search(r"\d{1,2}\s*月\s*\d{1,2}\s*日", text)
        or CLOCK.search(text)
    )


def vertical_bands(lines: Sequence[Line], *, tolerance_factor: float = 0.7) -> list[list[Line]]:
    """Group lines into visual rows.

    OCR returns lines in reading order, but "same row" is a geometric fact: two
    pieces of text whose tops are within about the line height belong together.
    Bands are what segmentation works on, so that a single transaction split
    across rows is read in the right order.
    """

    ordered = sorted(lines, key=lambda line: (line.top, line.left))
    bands: list[list[Line]] = []
    current: list[Line] = []

    for line in ordered:
        if not current:
            current = [line]
            continue

        tolerance = max(current[-1].height, line.height, 8.0) * tolerance_factor
        if abs(line.top - current[-1].top) <= tolerance:
            current.append(line)
        else:
            bands.append(current)
            current = [line]

    if current:
        bands.append(current)

    return bands


@dataclass(frozen=True)
class AmountRow:
    """A numeric line plus the nearest text to its left on the same band."""

    line: Line
    left_text: str | None


@dataclass(frozen=True)
class PageStructure:
    """Structural facts, independent of any bank's wording."""

    amount_rows: tuple[AmountRow, ...]
    date_count: int
    detail_label_count: int
    has_big_amount: bool
    body_line_count: int
    median_height: float

    @property
    def list_like(self) -> bool:
        """Several amount rows, at least one of them near a date.

        Three rows is enough evidence even without dates: a detail screen has
        one amount, and a coupon/ad block does not line numbers up in rows.
        """

        return len(self.amount_rows) >= 2 and self.date_count >= 1 or len(self.amount_rows) >= 3

    @property
    def detail_like(self) -> bool:
        return not self.list_like and (self.has_big_amount or self.detail_label_count >= 2)


def _only_numbers(band: Sequence[Line]) -> bool:
    """True when every non-empty line in the band is a bare number/currency amount."""

    lines = [line for line in band if line.text.strip() != ""]
    return bool(lines) and all(is_amount_like(line) for line in lines)


def label_of(text: str) -> str | None:
    """`当前状态：支付成功` → `当前状态`; unknown labels stay unknown."""

    stripped = text.strip()
    for separator in ("：", ":"):
        if separator in stripped:
            candidate = stripped.split(separator, 1)[0].strip()
            if candidate in DETAIL_LABELS:
                return candidate
    return stripped if stripped in DETAIL_LABELS else None


def _median(values: list[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2 == 1:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


def analyse_structure(lines: Sequence[Line]) -> PageStructure:
    """Read the layout facts the classifier and the row cutter both need."""

    if not lines:
        return PageStructure(
            amount_rows=(), date_count=0, detail_label_count=0, has_big_amount=False,
            body_line_count=0, median_height=0.0,
        )

    max_top = max(line.top for line in lines)
    status_floor = max_top * STATUS_BAR_FRACTION
    body = [line for line in lines if line.top > status_floor]

    bands = vertical_bands(body)
    amount_rows: list[AmountRow] = []
    previous_was_label = False

    for band in bands:
        # A band whose text includes a **field label** is a detail-page field
        # row (`付款账户` → `尾号 6688`), so any number in it is a field value,
        # not a second transaction. Without this, a numeric account/尾号 value
        # classified a bank transfer detail page as a transaction list.
        if any(label_of(line.text) is not None for line in band):
            previous_was_label = True
            continue

        # A value that did not fit next to its label wraps onto the row *below*
        # it (BOA prints `From` / `Adv SafeBalance Banking-` / the last digits of
        # the account on their own row). A row of digits straight under a field
        # label is that field's tail, not a transaction amount - without this the
        # BOA transfer confirmation page looked like a list because those digits
        # were counted as an amount.
        if previous_was_label and _only_numbers(band):
            previous_was_label = False
            continue
        previous_was_label = False

        amounts = [line for line in band if is_amount_like(line)]
        if not amounts:
            continue
        # The rightmost number is the row's amount column on every list layout
        # seen so far; a row with several numbers gets its rightmost one, and a
        # conflicting one is caught later by the amount reader.
        amount = max(amounts, key=lambda line: line.left)
        lefters = [line for line in band if line.left < amount.left and line.text.strip() != ""]
        left_text = max(lefters, key=lambda line: line.left).text if lefters else None
        amount_rows.append(AmountRow(line=amount, left_text=left_text))

    date_count = sum(1 for line in body if is_date_like(line.text))

    detail_label_count = sum(1 for line in body if label_of(line.text) is not None)

    heights = [line.height for line in body if line.height > 0]
    median_height = _median(heights)
    tallest_amount = max((row.line.height for row in amount_rows), default=0.0)
    has_big_amount = median_height > 0 and tallest_amount >= median_height * 1.5

    return PageStructure(
        amount_rows=tuple(amount_rows),
        date_count=date_count,
        detail_label_count=detail_label_count,
        has_big_amount=has_big_amount,
        body_line_count=len(body),
        median_height=median_height,
    )


@dataclass(frozen=True)
class ExtractionSpec:
    """The extraction rule a layout asks the next layer to use.

    Declarative so that a new layout is data, not a new branch in the main flow.
    """

    strategy: str = "list-rows"  # "single-detail" | "list-rows" | "custom"
    custom_extractor: str | None = None
    # Extra wording that states a direction, e.g. `("收入", "income")`. Sign
    # characters are read by `normalize`, not listed here.
    direction_markers: tuple[tuple[str, str], ...] = ()
    # Extra wording that states pending/posted, e.g. `("待入账", "pending")`.
    status_markers: tuple[tuple[str, str], ...] = ()
    refund_markers: tuple[str, ...] = ()
    # Only set when the platform's currency is certain; `None` means the line
    # must carry its own symbol and a missing currency is a question.
    default_currency: str | None = None
    # Money labels an *order detail* prints in front of the amount, the most
    # authoritative first. `应付款`/`实付款`/`合计` are totals; `实付价` is one line
    # item. Only a labelled amount may become the amount - the original price and
    # the discount line sit right next to it (`共减￥x合计￥y`).
    amount_labels: tuple[str, ...] = ()
    # The direction an *order list* implies without printing a sign or the word
    # 支出: 我的订单 only ever lists purchases I placed. Never applied to a closed
    # or refunded order - their own wording decides first.
    default_direction: str | None = None


@dataclass(frozen=True)
class LayoutFeatures:
    """What a screen looks like, as data. No code, so a new bank is a new row."""

    structure: str  # "single-detail" | "list"
    platform_markers: tuple[str, ...] = ()
    required_markers: tuple[str, ...] = ()
    strong: tuple[str, ...] = ()
    weak: tuple[str, ...] = ()
    list_markers: tuple[str, ...] = ()
    min_detail_labels: int = 0
    min_amount_rows: int = 2
    # A detail screen that prints several bare prices (one per product line) has
    # `structure.list_like` and would otherwise be refused as a detail. Opt in
    # only together with `required_markers` naming the screen's money label, so
    # the gate is "this page prints 实付款/应付款/合计", not "it looks like a list".
    tolerate_list_structure: bool = False


@dataclass(frozen=True)
class LayoutDescriptor:
    """One registered layout: its features, its extraction rule, its honesty."""

    id: str
    label: str
    page_type: PageType
    platform: str | None
    verified: bool
    sample: str | None
    features: LayoutFeatures
    extraction: ExtractionSpec = field(default_factory=ExtractionSpec)
    notes: str | None = None


@dataclass(frozen=True)
class LayoutMatch:
    """One layout's score against one page, with the reasons."""

    layout: LayoutDescriptor
    score: float
    confidence: float
    evidence: tuple[str, ...]


@dataclass(frozen=True)
class Classification:
    """The page-type answer, plus everything needed to explain or override it."""

    page_type: PageType
    layout_id: str | None
    layout_label: str | None
    platform: str | None
    verified: bool
    confidence: float
    evidence: tuple[str, ...]
    requires_user_choice: bool
    structure_signals: tuple[str, ...]
    alternatives: tuple[LayoutMatch, ...] = ()

    @property
    def page_type_label(self) -> str:
        return PAGE_TYPE_LABELS[self.page_type]

    def to_dict(self) -> dict[str, object]:
        return {
            "page_type": self.page_type,
            "page_type_label": self.page_type_label,
            "layout_id": self.layout_id,
            "layout_label": self.layout_label,
            "platform": self.platform,
            "verified": self.verified,
            "confidence": round(self.confidence, 3),
            "evidence": list(self.evidence),
            "requires_user_choice": self.requires_user_choice,
            "structure_signals": list(self.structure_signals),
            "alternatives": [
                {
                    "layout_id": match.layout.id,
                    "page_type": match.layout.page_type,
                    "verified": match.layout.verified,
                    "score": match.score,
                    "confidence": round(match.confidence, 3),
                    "evidence": list(match.evidence),
                }
                for match in self.alternatives
            ],
        }


# Registry. Order is priority for equal scores: specific layouts before the
# generic fallback. `register_layout` is the only way in.
_REGISTRY: list[LayoutDescriptor] = []


def register_layout(descriptor: LayoutDescriptor) -> LayoutDescriptor:
    """Add a layout at run time. The main flow never needs to change for this."""

    if any(existing.id == descriptor.id for existing in _REGISTRY):
        raise ValueError(f"版式 id 重复：{descriptor.id}")
    _REGISTRY.append(descriptor)
    return descriptor


def registered_layouts() -> tuple[LayoutDescriptor, ...]:
    return tuple(_REGISTRY)


def layout_by_id(layout_id: str | None) -> LayoutDescriptor | None:
    """The descriptor a classification points at, if it still exists."""

    if layout_id is None:
        return None
    return next((layout for layout in _REGISTRY if layout.id == layout_id), None)


def reset_layouts() -> None:
    """Put the registry back to the built-ins. For tests that add a layout."""

    _REGISTRY.clear()
    _REGISTRY.extend(_BUILTIN_LAYOUTS)


def _marker_evidence(joined: str, markers: Sequence[str], label: str) -> list[str]:
    return [f"{label}「{marker}」" for marker in markers if marker in joined]


def _score_layout(
    layout: LayoutDescriptor,
    joined: str,
    structure: PageStructure,
) -> LayoutMatch | None:
    """Score one layout, or None when a hard gate fails.

    Hard gates are what keep a single transaction from being counted as a list:
    a list layout requires `structure.list_like`, and a detail layout requires
    the page *not* to look like a list.
    """

    features = layout.features

    if features.structure == "list":
        if not structure.list_like:
            return None
        if len(structure.amount_rows) < features.min_amount_rows:
            return None
    else:
        if structure.list_like and not features.tolerate_list_structure:
            return None

    if features.required_markers and not all(marker in joined for marker in features.required_markers):
        return None

    if features.platform_markers and not any(marker in joined for marker in features.platform_markers):
        return None

    if features.min_detail_labels > 0 and structure.detail_label_count < features.min_detail_labels:
        return None

    score = 0.0
    evidence: list[str] = []

    if features.platform_markers:
        hits = _marker_evidence(joined, features.platform_markers, "来源")
        score += 3.0
        evidence.extend(hits[:2])

    if features.structure == "list":
        score += 2.0
        evidence.append(f"结构：{len(structure.amount_rows)} 个金额行")
        if structure.date_count > 0:
            score += 1.0
            evidence.append(f"结构：{structure.date_count} 个日期/时间")
    else:
        if structure.has_big_amount:
            score += 2.0
            evidence.append("结构：一个明显更大的金额")
        if structure.detail_label_count > 0:
            score += 1.0
            evidence.append(f"结构：{structure.detail_label_count} 个字段标签")

    strong_hits = _marker_evidence(joined, features.strong, "字段")
    score += min(len(strong_hits), 3) * 2.0
    evidence.extend(strong_hits[:3])

    weak_hits = _marker_evidence(joined, features.weak, "线索")
    score += min(len(weak_hits), 4) * 1.0
    evidence.extend(weak_hits[:4])

    list_hits = _marker_evidence(joined, features.list_markers, "列表词")
    if list_hits:
        score += 2.0
        evidence.extend(list_hits[:2])

    # Unverified layouts still classify, but a caller must be able to see that
    # the wording has never been checked against a screenshot.
    if not layout.verified:
        evidence.append("未验证版式（没有对应样本）")

    confidence = min(1.0, score / 12.0)
    return LayoutMatch(
        layout=layout,
        score=score,
        confidence=confidence,
        evidence=tuple(evidence),
    )


# Below this score nothing is claimed; the user is asked. The generic list
# fallback scores 3-4 on structure alone, which is intentionally close to the
# line - it is a guess about a page type, not about a transaction.
MIN_MATCH_SCORE = 3.0


def detect_platform(joined: str) -> str | None:
    """The payment platform a page mentions, when it says so plainly."""

    if any(marker in joined for marker in WECHAT_MARKERS):
        return "WECHAT"
    if any(marker in joined for marker in ALIPAY_MARKERS):
        return "ALIPAY"
    return None


def classify(lines: Sequence[Line]) -> Classification:
    """Classify one page. Pure: no I/O, no globals mutated, deterministic."""

    joined = "\n".join(line.text for line in lines)
    structure = analyse_structure(lines)

    signals = [
        f"{len(structure.amount_rows)} 个金额行",
        f"{structure.date_count} 个日期/时间",
        f"{structure.detail_label_count} 个详情字段标签",
    ]
    if structure.has_big_amount:
        signals.append("存在明显更大的金额")
    signals.append("看起来像列表" if structure.list_like else "不像列表")

    matches = [
        match
        for layout in _REGISTRY
        if (match := _score_layout(layout, joined, structure)) is not None and match.score >= MIN_MATCH_SCORE
    ]
    matches.sort(key=lambda match: (-match.score, not match.layout.verified, match.layout.id))

    if not matches:
        # No claim about the count. This is the branch the design direction
        # requires: 让用户选择按单笔/按多笔处理，不擅自决定.
        return Classification(
            page_type="unknown",
            layout_id=None,
            layout_label=None,
            platform=detect_platform(joined),
            verified=False,
            confidence=0.0,
            evidence=("没有匹配到已注册版式",),
            requires_user_choice=True,
            structure_signals=tuple(signals),
        )

    top = matches[0]
    # A tie between different page types would mean the page could be read two
    # ways; asking is the only honest answer.
    conflicting = [
        match for match in matches[1:] if match.score == top.score and match.layout.page_type != top.layout.page_type
    ]

    return Classification(
        page_type="unknown" if conflicting else top.layout.page_type,
        layout_id=top.layout.id,
        layout_label=top.layout.label,
        platform=top.layout.platform or detect_platform(joined),
        verified=top.layout.verified,
        confidence=top.confidence,
        evidence=top.evidence,
        requires_user_choice=bool(conflicting) or top.confidence < 0.25,
        structure_signals=tuple(signals),
        alternatives=tuple(matches[1:]),
    )


def explain(classification: Classification) -> str:
    """A human-readable rendering, for logs and for the OCR probe script."""

    lines = [
        f"页面类型：{classification.page_type_label}",
        f"版式：{classification.layout_label or '未识别'}"
        f"（{'已验证' if classification.verified else '未验证'}）",
        f"来源：{PLATFORM_LABELS.get(classification.platform or '', '未知')}",
        f"置信度：{classification.confidence:.2f}",
        f"需要用户选择：{'是' if classification.requires_user_choice else '否'}",
    ]
    lines.append("依据：")
    lines.extend(f"  - {item}" for item in classification.evidence)
    if classification.structure_signals:
        lines.append("结构信号：" + "、".join(classification.structure_signals))
    return "\n".join(lines)


# --- built-in layouts -------------------------------------------------------
#
# Kept at the bottom so the machinery above reads first. Every "verified" below
# is backed by evidence named in the module docstring; everything else is
# marked unverified and says what is missing.

_BUILTIN_LAYOUTS: tuple[LayoutDescriptor, ...] = (
    LayoutDescriptor(
        id="wechat-single-detail",
        label="微信支付单笔详情",
        page_type="single-detail",
        platform="WECHAT",
        verified=True,
        sample="real-samples/README.md（6 张真实截图） + make_samples.py: samples/wechat-pay.png",
        features=LayoutFeatures(
            structure="single-detail",
            platform_markers=WECHAT_MARKERS,
            strong=("当前状态", "支付方式", "交易单号", "商户单号", "商户全称", "商品"),
            weak=("支付成功", "已支付", "账单详情"),
            min_detail_labels=2,
        ),
        extraction=ExtractionSpec(
            strategy="single-detail",
            refund_markers=("退款状态", "退款成功", "已退款", "退款方式", "退款单号"),
        ),
    ),
    LayoutDescriptor(
        id="alipay-single-detail",
        label="支付宝单笔详情",
        page_type="single-detail",
        platform="ALIPAY",
        verified=True,
        sample="real-samples/README.md（6 张真实截图） + make_samples.py: samples/alipay-receive.png",
        features=LayoutFeatures(
            structure="single-detail",
            platform_markers=ALIPAY_MARKERS,
            strong=("当前状态", "交易号", "付款方", "收款方", "账单详情", "备注"),
            weak=("收款成功", "已到账", "账单", "退款成功"),
            min_detail_labels=2,
        ),
        extraction=ExtractionSpec(
            strategy="single-detail",
            refund_markers=("退款状态", "退款成功", "已退款", "退款方式", "退款单号"),
        ),
    ),
    LayoutDescriptor(
        id="bank-transfer-detail",
        label="银行转账详情（通用）",
        page_type="single-detail",
        platform="BANK",
        verified=False,
        sample="make_samples.py: samples/bank-transfer.png（合成）",
        features=LayoutFeatures(
            structure="single-detail",
            required_markers=("转账",),
            strong=("转账状态", "付款账户", "收款账户", "交易流水号", "转账说明", "转账时间"),
            weak=("转账详情", "转账成功", "交易成功", "银行"),
            min_detail_labels=3,
        ),
        extraction=ExtractionSpec(strategy="single-detail"),
        notes="真实银行 App 截图仍缺失（real-samples/README.md §2），字段词只在合成样本上验证过。",
    ),
    LayoutDescriptor(
        id="bank-single-detail",
        label="银行单笔交易详情（BOA Transaction Details）",
        page_type="single-detail",
        platform="BANK",
        verified=False,
        sample="real-samples/2026-10-20 单笔交易详情 1 张（本地基线；文本不入库）",
        features=LayoutFeatures(
            structure="single-detail",
            # This screen never prints the bank's name (the account banner is
            # above the fold), so the gate is the screen's own title and field
            # names. A platform gate here would never fire on the real sample.
            required_markers=("Transaction Details",),
            strong=("Merchant Name", "Transaction date", "Transaction category", "Amount"),
            weak=("Mobile Payment", "Online Purchase", "View more information"),
            min_detail_labels=2,
        ),
        extraction=ExtractionSpec(
            strategy="custom",
            custom_extractor="bank-single-detail",
            default_currency="USD",
        ),
        notes="1 张真实 BOA 截图；英文标签与值分行的版式，金额/日期/商户由英文标签定位。",
    ),
    LayoutDescriptor(
        id="bank-transfer-confirmation",
        label="银行转账成功确认页（BOA）",
        page_type="single-detail",
        platform="BANK",
        verified=False,
        sample="real-samples/2026-10-20 转账成功页 1 张（本地基线；文本不入库）",
        features=LayoutFeatures(
            structure="single-detail",
            # `Confirmation Number` is printed on two rows by the recogniser, so
            # the markers are the phrases that survive as one line.
            required_markers=("Your payment is sent", "Print or Save"),
            strong=("Confirmation", "Amount", "Date", "Success"),
            weak=("Enrolled as", "Transaction dates are based on Eastern Time"),
            min_detail_labels=2,
        ),
        extraction=ExtractionSpec(
            strategy="custom",
            custom_extractor="bank-transfer-confirmation",
            default_currency="USD",
        ),
        notes="转账确认不是普通消费：is_transfer=True，方向按“钱已转出”记为 expense。",
    ),
    LayoutDescriptor(
        id="wechat-bill-list",
        label="微信账单全部列表（账单首页）",
        page_type="transaction-list",
        platform="WECHAT",
        verified=True,
        sample="real-samples/2026-10-20 微信账单全部列表（1 张，8 笔字段全对；文本不入库）",
        features=LayoutFeatures(
            structure="list",
            required_markers=("全部账单",),
            # The screen never prints 微信 anywhere: its title is just 账单 and
            # the chrome is 全部账单 / 查找交易 / 收支统计. A platform gate would
            # never fire here, which is why this screen can only be recognised by
            # its own words.
            strong=("查找交易", "收支统计"),
            list_markers=LIST_MARKERS,
        ),
        extraction=ExtractionSpec(
            strategy="list-rows",
            direction_markers=(("收入", "income"), ("支出", "expense")),
            status_markers=(("待入账", "pending"), ("已入账", "posted"), ("已到账", "posted")),
            refund_markers=("退款",),
            # WeChat bills are CNY even when the recogniser drops every `¥`. The
            # assumption is surfaced as `currency_assumed`, not presented as read.
            default_currency="CNY",
        ),
        notes="真实样本：8 笔（含 3 笔转账）金额/日期/时间/商户/方向全对。",
    ),
    LayoutDescriptor(
        id="wechat-bill-cards",
        label="微信账单卡片列表（分组日期 + 卡片）",
        page_type="transaction-list",
        platform="WECHAT",
        verified=True,
        sample="real-samples/2026-10-20 微信支付账单列表 2 张（含记账日报 1 张；文本不入库）",
        features=LayoutFeatures(
            structure="list",
            platform_markers=WECHAT_MARKERS,
            # 账单详情 is on every card and on no other WeChat screen.
            required_markers=("账单详情",),
            strong=("使用零钱支付", "账单详情"),
            weak=("微信记账本", "记账日报"),
            list_markers=("账单",),
        ),
        extraction=ExtractionSpec(
            strategy="custom",
            custom_extractor="wechat-bill-cards",
            default_currency="CNY",
        ),
        notes="日期在卡片上方的分组头（10月12日晚上9:04 / 星期三下午6:34）；记账日报块整块排除。",
    ),
    LayoutDescriptor(
        id="wechat-transaction-list",
        label="微信交易记录列表",
        page_type="transaction-list",
        platform="WECHAT",
        verified=False,
        sample=None,
        features=LayoutFeatures(
            structure="list",
            platform_markers=WECHAT_MARKERS,
            strong=("交易记录",),
            weak=("全部账单", "月账单", "收支明细"),
            list_markers=LIST_MARKERS,
        ),
        extraction=ExtractionSpec(
            strategy="list-rows",
            direction_markers=(("收入", "income"), ("支出", "expense")),
            status_markers=(("待入账", "pending"), ("已入账", "posted"), ("已到账", "posted")),
            refund_markers=("退款",),
            default_currency="CNY",
        ),
        notes="没有真实样本的微信「交易记录」行式样；卡片式与账单首页各有自己的版式。",
    ),
    LayoutDescriptor(
        id="alipay-transaction-list",
        label="支付宝交易记录列表",
        page_type="transaction-list",
        platform="ALIPAY",
        verified=True,
        sample="real-samples/2026-10-20 支付宝交易记录列表 1 张（5 笔；文本不入库）",
        features=LayoutFeatures(
            structure="list",
            # The real screen does not print 支付宝 either; these three are its
            # own chrome (a search box, the expense-analysis button, the saved
            # banner). They gate the layout the same way a brand name would - a
            # page that prints none of them is not claimed as Alipay.
            platform_markers=("搜索交易记录", "收支分析", "本月已省") + ALIPAY_MARKERS,
            strong=("搜索交易记录", "收支分析", "本月已省"),
            weak=ALIPAY_MARKERS,
            list_markers=LIST_MARKERS,
        ),
        extraction=ExtractionSpec(
            strategy="custom",
            custom_extractor="alipay-bill-rows",
            direction_markers=(("收入", "income"), ("支出", "expense")),
            status_markers=(("待入账", "pending"), ("已入账", "posted"), ("已到账", "posted")),
            refund_markers=("退款",),
            default_currency="CNY",
        ),
        notes="相对日期（今天/昨天）用截图日期换算；金额右对齐才认；顶部汇总与「收支分析」按钮排除。",
    ),
    # --- 美团 / 京东 / 淘宝（2026-10-21 三平台 6 张真实截图） -------------------
    #
    # These three screens are *order* lists, not bill lists, and that changes two
    # things the bill layouts never had to answer:
    #
    #   * the amount is the **order total** that the card prints, while the same
    #     card also prints a count (`共2件`), a duration (`使用时长：73分钟`) and a
    #     discount (`共减￥x`). Only a right-aligned money line is an amount;
    #   * the card's **date is optional** (JD prints none at all) and, on Taobao,
    #     the date next to `实付款` is the order date - the promo window
    #     (`限时补款：2026年9月20日-…`) and the shipping promise
    #     (`预售，7月18日09:27前发货`) are not.
    #
    # A closed order (交易关闭 / 超时关闭) never became a payment, so it must not be
    # filed as an expense; the `order_closed` issue sends that question back to the
    # user instead of deciding it here.
    #
    # 待发货 / 待收货 are **posted**, not pending: the money has already left the
    # account (owner, 2026-10-21: "这笔钱付出去了，那就应该被算作支出"). A later
    # return is a separate refund (income), which the refund rules already handle;
    # only `待付款` has not paid yet and stays `pending`.
    LayoutDescriptor(
        id="meituan-order-list",
        label="美团外卖订单列表",
        page_type="transaction-list",
        platform="MEITUAN",
        verified=True,
        sample="real-samples/2026-10-21_美团订单列表 1 张（4 笔；文本不入库）",
        features=LayoutFeatures(
            structure="list",
            # Like the WeChat/Alipay screens, this one never prints its own brand
            # in the body (only the logo does). 再来一单 / 领神券 / 下单： are 美团's
            # own buttons and row labels, and 准时宝 / 打赏骑手 only exist here.
            platform_markers=("美团", "再来一单", "领神券", "神抢手", "准时宝", "打赏骑手", "联系商家"),
            strong=("再来一单", "领神券", "下单：", "已完成"),
            weak=("外卖", "订单", "配送"),
            list_markers=("订单",),
        ),
        extraction=ExtractionSpec(
            strategy="custom",
            custom_extractor="meituan-order-rows",
            status_markers=(
                ("订单已完成", "posted"),
                ("已完成", "posted"),
                ("待付款", "pending"),
                ("待收货", "posted"),
                ("待使用", "pending"),
                ("退款成功", "退款成功"),
                ("已退款", "已退款"),
                ("已取消", "已取消"),
            ),
            default_direction="expense",
            default_currency="CNY",
        ),
        notes="卡片 = 店铺名 + 状态 + 金额（右对齐￥）+ 下单时间/时间；`共N件`、`使用时长`、`领神券` 与底部广告不是金额。",
    ),
    LayoutDescriptor(
        id="meituan-order-detail",
        label="美团外卖订单详情",
        page_type="single-detail",
        platform="MEITUAN",
        verified=True,
        sample="real-samples/2026-10-21_美团订单详情 1 张（1 笔；文本不入库）",
        features=LayoutFeatures(
            structure="single-detail",
            platform_markers=("美团", "准时宝", "打赏骑手", "联系商家", "再来一单", "订单已完成"),
            # The total row is what makes this screen a detail; it is also the
            # field the extractor reads, so a page without it is not claimed.
            required_markers=("合计",),
            strong=("订单信息", "商品费用", "合计", "准时宝", "配送地址"),
            weak=("感谢您对", "费用明细", "已完成"),
            min_detail_labels=0,
            tolerate_list_structure=True,
        ),
        extraction=ExtractionSpec(
            strategy="custom",
            custom_extractor="cn-order-detail",
            amount_labels=("应付款", "实付款", "合计", "总计", "订单金额", "实付"),
            status_markers=(("订单已完成", "posted"), ("已完成", "posted"), ("已取消", "已取消")),
            default_direction="expense",
            default_currency="CNY",
        ),
        notes="金额取「合计￥xx.xx」（不是共2件）；页面不显示下单时间 → missing_date；支付方式折叠时不猜。",
    ),
    LayoutDescriptor(
        id="jd-order-list",
        label="京东订单列表",
        page_type="transaction-list",
        platform="JD",
        verified=True,
        sample="real-samples/2026-10-21_京东订单列表 1 张（3 笔；文本不入库）",
        features=LayoutFeatures(
            structure="list",
            platform_markers=("京东", "京豆", "PLUS", "京东服务", "京东自营", "卖了换钱", "秒送外卖"),
            strong=("京东服务", "自营", "再次购买", "退换/售后", "去查看"),
            weak=("搜索我的订单", "待收货", "订单", "完成"),
            list_markers=("订单",),
        ),
        extraction=ExtractionSpec(
            strategy="custom",
            custom_extractor="jd-order-rows",
            status_markers=(
                ("已完成", "posted"),
                ("待付款", "pending"),
                ("待收货", "posted"),
                ("待使用", "pending"),
                ("交易关闭", "交易关闭"),
                ("退款成功", "退款成功"),
            ),
            default_direction="expense",
            default_currency="CNY",
        ),
        notes="卡片 = 店铺名 + 商品 + 右侧￥金额 + 共N件；这一屏**不打印下单日期** → 保持缺失并标 missing_date，不猜。",
    ),
    LayoutDescriptor(
        id="jd-order-detail",
        label="京东订单详情",
        page_type="single-detail",
        platform="JD",
        verified=True,
        sample="real-samples/2026-10-21_京东订单详情 1 张（1 笔；文本不入库）",
        features=LayoutFeatures(
            structure="single-detail",
            platform_markers=("京东", "京豆", "PLUS", "京东服务"),
            required_markers=("实付款",),
            strong=("实付款", "订单编号", "支付方式", "全部订单信息"),
            weak=("进店", "评价晒单", "查看物流", "再次购买"),
            min_detail_labels=0,
            tolerate_list_structure=True,
        ),
        extraction=ExtractionSpec(
            strategy="custom",
            custom_extractor="cn-order-detail",
            amount_labels=("应付款", "实付款", "合计", "总计", "订单金额", "实付"),
            status_markers=(("已完成", "posted"), ("待收货", "posted"), ("交易关闭", "交易关闭")),
            default_direction="expense",
            default_currency="CNY",
        ),
        notes="金额取「实付款」行的「合计￥xx」，不是商品原价、也不是「共减￥x」；支付方式「微信支付」可读。",
    ),
    LayoutDescriptor(
        id="taobao-order-list",
        label="淘宝/天猫订单列表",
        page_type="transaction-list",
        platform="TAOBAO",
        verified=True,
        sample="real-samples/2026-10-21_淘宝订单列表 1 张（2 笔；文本不入库）",
        features=LayoutFeatures(
            structure="list",
            # 天猫/淘宝 words do print on this screen (the shop row carries the
            # 天猫 badge), unlike WeChat/Alipay. 再买一单 / 闪购 / 申请开票 are
            # Taobao's own, and 实付款 is its own row label.
            platform_markers=("天猫", "淘宝", "闪购", "再买一单", "实付款", "待发货", "申请开票", "退款/售后"),
            strong=("天猫", "实付款", "交易关闭", "待发货", "再买一单"),
            weak=("淘宝", "申请开票", "催发货", "退款"),
            list_markers=("订单",),
        ),
        extraction=ExtractionSpec(
            strategy="custom",
            custom_extractor="taobao-order-rows",
            status_markers=(
                ("交易关闭", "交易关闭"),
                ("超时关闭", "交易关闭"),
                ("待付款", "pending"),
                ("待发货", "posted"),
                ("待收货", "posted"),
                ("退款成功", "退款成功"),
                ("已完成", "posted"),
            ),
            default_direction="expense",
            default_currency="CNY",
        ),
        notes="金额取「实付款￥xx」行；日期只认同一行的 `09.21`（年份按截图推断并标注）；限时补款/预售发货日不是交易日期。",
    ),
    LayoutDescriptor(
        id="taobao-order-detail",
        label="淘宝/天猫订单详情（含交易关闭）",
        page_type="single-detail",
        platform="TAOBAO",
        verified=True,
        sample="real-samples/2026-10-21_淘宝交易关闭详情 1 张（1 笔；文本不入库）",
        features=LayoutFeatures(
            structure="single-detail",
            # 淘宝 order details do not always print the brand word; 交易关闭 /
            # 应付款 / 实付价 / 号码保护中 are this screen's own wording.
            platform_markers=("淘宝", "天猫", "交易关闭", "超时关闭", "应付款", "实付价", "号码保护中", "订单保障"),
            required_markers=("应付款",),
            strong=("应付款", "实付价", "订单信息", "订单保障", "加入购物车"),
            weak=("订单", "退款", "进店逛逛"),
            min_detail_labels=0,
            tolerate_list_structure=True,
        ),
        extraction=ExtractionSpec(
            strategy="custom",
            custom_extractor="cn-order-detail",
            amount_labels=("应付款", "实付款", "合计", "总计", "订单金额", "实付价", "实付"),
            status_markers=(("交易关闭", "交易关闭"), ("超时关闭", "交易关闭"), ("退款成功", "退款成功")),
            default_direction="expense",
            default_currency="CNY",
        ),
        notes="金额取「应付款￥xx」；`交易关闭/超时关闭` → 方向未知 + order_closed，不当已支付消费；日期来自「凭据：…下单…」并标 date_hint。",
    ),
    LayoutDescriptor(
        id="boa-activity-list",
        label="Bank of America 交易活动列表",
        page_type="transaction-list",
        platform="BANK",
        verified=True,
        sample="real-samples/2026-10-20 BOA 交易列表 2 张（滚动重叠；文本不入库）",
        features=LayoutFeatures(
            structure="list",
            # The recogniser drops the spaces in `Provided by Bank of America`,
            # so both spellings are needed for the gate to fire on real samples.
            platform_markers=(
                "Bank of America",
                "BANK OF AMERICA",
                "BankofAmerica",
                "BANKOFAMERICA",
                "bankofamerica",
                "BofA",
                "BOFA",
            ),
            strong=("Recent transactions", "Account and routing numbers", "Available balance"),
            weak=("Description", "Amount", "Balance", "Posted Date"),
            list_markers=("Posted", "Pending", "Transactions", "Activity"),
        ),
        extraction=ExtractionSpec(
            strategy="custom",
            custom_extractor="boa-activity-rows",
            status_markers=(("Pending", "pending"), ("Posted", "posted")),
            # BOA statements are USD; the assumption is surfaced as a visible
            # `currency_assumed` issue rather than silently presented as read.
            default_currency="USD",
        ),
        notes="真实样本：日期头分行、金额列与运行余额列靠字号/符号区分、描述 2–4 行合并。",
    ),
    # Fallback: structure alone. It classifies *how many* transactions there are
    # but knows nothing about the source, so every item it yields carries the
    # unverified-layout flag and the interface says so.
    LayoutDescriptor(
        id="generic-transaction-list",
        label="通用交易列表（仅按结构）",
        page_type="transaction-list",
        platform=None,
        verified=False,
        sample=None,
        features=LayoutFeatures(
            structure="list",
            list_markers=(),
            min_amount_rows=2,
        ),
        extraction=ExtractionSpec(strategy="list-rows"),
        notes="只按“多组金额+日期行”判断，来源和字段语义都未验证。",
    ),
)

reset_layouts()
