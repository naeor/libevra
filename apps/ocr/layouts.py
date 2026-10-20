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

## 已知 / 未验证 版式（2026-10-20）

| layout id | 依据 | 状态 |
|---|---|---|
| wechat-single-detail | `real-samples/README.md` 记录的 6 张真实截图 + `make_samples.py` 合成样本 | 已验证 |
| alipay-single-detail | 同上 | 已验证 |
| bank-transfer-detail | 仅 `make_samples.py` 合成样本；真实银行 App 截图仍缺失 | **未验证** |
| wechat-transaction-list | **没有真实列表截图**；按微信常见字段先建框架 | **未验证** |
| alipay-transaction-list | **没有真实列表截图**；按支付宝常见字段先建框架 | **未验证** |
| boa-activity-list | **没有 BOA 截图**；关键词仅来自常识，不是样本 | **未验证** |
| generic-transaction-list | 纯结构规则（多组"金额 + 日期"行） | **未验证** |

The table above is the honest answer to "支持哪些版式": only the two single
detail layouts have been checked against screenshots that once existed on this
machine. Everything list-shaped is a framework waiting for its samples.

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
    DATE_DASHED,
    DATE_WITH_MARKERS,
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


def _label_of(text: str) -> str | None:
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

    for band in bands:
        # A band whose text includes a **field label** is a detail-page field
        # row (`付款账户` → `尾号 6688`), so any number in it is a field value,
        # not a second transaction. Without this, a numeric account/尾号 value
        # classified a bank transfer detail page as a transaction list.
        if any(_label_of(line.text) is not None for line in band):
            continue

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

    detail_label_count = sum(1 for line in body if _label_of(line.text) is not None)

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
        if structure.list_like:
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
        ),
        notes="没有真实列表截图；行切分是通用几何规则，字段名未验证。",
    ),
    LayoutDescriptor(
        id="alipay-transaction-list",
        label="支付宝交易记录列表",
        page_type="transaction-list",
        platform="ALIPAY",
        verified=False,
        sample=None,
        features=LayoutFeatures(
            structure="list",
            platform_markers=ALIPAY_MARKERS,
            strong=("交易记录", "收支明细"),
            weak=("全部账单", "月账单", "账单管理"),
            list_markers=LIST_MARKERS,
        ),
        extraction=ExtractionSpec(
            strategy="list-rows",
            direction_markers=(("收入", "income"), ("支出", "expense")),
            status_markers=(("待入账", "pending"), ("已入账", "posted"), ("已到账", "posted")),
            refund_markers=("退款",),
        ),
        notes="没有真实列表截图；行切分是通用几何规则，字段名未验证。",
    ),
    LayoutDescriptor(
        id="boa-activity-list",
        label="Bank of America 交易活动列表",
        page_type="transaction-list",
        platform="BANK",
        verified=False,
        sample=None,
        features=LayoutFeatures(
            structure="list",
            platform_markers=("Bank of America", "BANK OF AMERICA", "bankofamerica", "BofA", "BOFA"),
            strong=("Transactions", "Activity"),
            weak=("Description", "Amount", "Balance", "Posted Date"),
            list_markers=("Posted", "Pending", "Transactions", "Activity"),
        ),
        extraction=ExtractionSpec(
            strategy="list-rows",
            status_markers=(("Pending", "pending"), ("Posted", "posted")),
        ),
        notes="没有 BOA 截图；关键词来自常识而不是样本，行式样（金额列位置）未验证。",
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
