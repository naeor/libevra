"""Assemble one batch into what the overview screen shows.

S15-B layer 7 support (design direction §3): the interface needs the *whole*
batch before it draws a single card - counts at the top, one item per
transaction, 有疑问/可能重复 marks, and a default selection that does not
require the user to click through every row.

This module only computes data. It does not confirm anything and has no write
path: 统一确认 is a user action in the interface, and the actual save must go
through the existing single-entry flow (design direction §3.4/§10.5). So there is
deliberately no "confirm" function here to accidentally call.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Sequence

from dedupe import DuplicateOptions, DuplicateReport, ExistingEntry, find_duplicates, mark_duplicates
from extract import Line
from layouts import PAGE_TYPE_LABELS
from model import Candidate
from multi_extract import PageExtraction, extract_pages


@dataclass(frozen=True)
class OverviewSummary:
    """The numbers the design direction asks the page to show at the top."""

    total: int
    """Every extracted candidate, whatever its state."""
    complete: int
    """No blocking issue, not a duplicate, all required fields present."""
    questionable: int
    """Anything the user should look at: missing/conflicting fields, duplicates."""
    duplicates: int
    """Candidates involved in at least one suspected-duplicate group."""
    unknown_pages: int
    """Pages whose transaction count could not be decided; the user must choose."""
    pages_requiring_choice: int
    selected_by_default: tuple[str, ...]
    """Ids preselected because they are complete and not suspected duplicates.

    Preselected is not confirmed: the design direction requires the user to
    execute one final confirmation before anything could be written.
    """

    def to_dict(self) -> dict[str, object]:
        return {
            "total": self.total,
            "complete": self.complete,
            "questionable": self.questionable,
            "duplicates": self.duplicates,
            "unknown_pages": self.unknown_pages,
            "pages_requiring_choice": self.pages_requiring_choice,
            "selected_by_default": list(self.selected_by_default),
        }


@dataclass(frozen=True)
class Overview:
    pages: tuple[PageExtraction, ...]
    candidates: tuple[Candidate, ...]
    duplicates: DuplicateReport
    summary: OverviewSummary
    warnings: tuple[str, ...]
    requires_user_choice: bool
    """At least one page needs the 按单笔/按多笔 answer before anything else."""

    def candidate(self, candidate_id: str) -> Candidate | None:
        return next(
            (candidate for candidate in self.candidates if candidate.candidate_id == candidate_id),
            None,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "pages": [page.to_dict() for page in self.pages],
            "candidates": [candidate.to_dict() for candidate in self.candidates],
            "duplicates": self.duplicates.to_dict(),
            "summary": self.summary.to_dict(),
            "warnings": list(self.warnings),
            "requires_user_choice": self.requires_user_choice,
        }


def build_overview(
    pages: Sequence[tuple[int, Sequence[Line]]],
    *,
    existing_entries: Sequence[ExistingEntry] = (),
    options: DuplicateOptions | None = None,
    reference_year: int | None = None,
    reference_date: str | None = None,
) -> Overview:
    """Classify, extract and de-duplicate a whole upload. Pure and deterministic.

    `existing_entries` are ledger rows the caller already holds; this module does
    not fetch them, because detection must not need a database to be tested.
    `reference_date` is the day the screenshots were taken; without it a
    `今天 20:53` or `星期三 下午6:34` row cannot become a calendar date.
    """

    extractions = extract_pages(
        pages, reference_year=reference_year, reference_date=reference_date
    )
    candidates = [candidate for extraction in extractions for candidate in extraction.candidates]

    duplicates = find_duplicates(candidates, list(existing_entries), options)
    mark_duplicates(candidates, duplicates)

    selected_by_default = tuple(
        candidate.candidate_id
        for candidate in candidates
        if candidate.is_complete and not candidate.is_questionable
    )

    complete = sum(1 for candidate in candidates if candidate.is_complete and not candidate.is_questionable)
    questionable = sum(
        1 for candidate in candidates if candidate.is_questionable or not candidate.is_complete
    )
    unknown_pages = sum(1 for extraction in extractions if extraction.classification.page_type == "unknown")
    pages_requiring_choice = sum(1 for extraction in extractions if extraction.requires_user_choice)

    summary = OverviewSummary(
        total=len(candidates),
        complete=complete,
        questionable=questionable,
        duplicates=len(duplicates.duplicate_candidate_ids),
        unknown_pages=unknown_pages,
        pages_requiring_choice=pages_requiring_choice,
        selected_by_default=selected_by_default,
    )

    warnings = [warning for extraction in extractions for warning in extraction.warnings]

    return Overview(
        pages=tuple(extractions),
        candidates=tuple(candidates),
        duplicates=duplicates,
        summary=summary,
        warnings=tuple(warnings),
        requires_user_choice=any(extraction.requires_user_choice for extraction in extractions),
    )


def describe_overview(overview: Overview) -> str:
    """A short text rendering of a batch, for the OCR probe scripts and logs.

    The interface renders its own cards; this is for looking at a whole page of
    results in a terminal without standing up the web app.
    """

    summary = overview.summary
    lines = [
        f"共 {summary.total} 笔：可直接确认 {summary.complete} 笔，"
        f"有疑问 {summary.questionable} 笔，可能重复 {summary.duplicates} 笔。",
    ]

    if summary.unknown_pages > 0:
        lines.append(f"有 {summary.unknown_pages} 张截图无法判断页面类型，需要用户选择。")

    for extraction in overview.pages:
        page = extraction.classification
        lines.append(
            f"- 图 {extraction.image_index + 1}：{PAGE_TYPE_LABELS[page.page_type]}"
            f"（{page.layout_label or '版式未识别'}"
            f"{'，已验证' if page.verified else '，未验证'}），"
            f"{len(extraction.candidates)} 笔"
        )

    for candidate in overview.candidates:
        amount = candidate.amount if candidate.amount is not None else "待确认"
        merchant = candidate.merchant if candidate.merchant is not None else "待确认"
        marks = "、".join(issue.code for issue in candidate.issues) or "无问题"
        lines.append(
            f"  {candidate.candidate_id}  {amount} {candidate.currency or '币种待确认'}  "
            f"{merchant}  [{marks}]"
        )

    if overview.warnings:
        lines.append("提示：")
        lines.extend(f"  - {warning}" for warning in overview.warnings)

    return "\n".join(lines)
