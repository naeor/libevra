"""Suspected-duplicate detection - by pure functions, never by deleting.

S15-B layer 6 (design direction §4). Three scopes, all required by the
direction:

  1. **same image** - a long scrolling screenshot can show the same row in an
     overlap, or OCR can read one row twice;
  2. **across images** - the same transaction in two overlapping screenshots,
     or in a detail screenshot and a list screenshot;
  3. **against the ledger** - the transaction may already have been recorded,
     which is the situation the existing single-entry duplicate dialog handles.

What this module deliberately does **not** do:

  * no deletion, no merging, no automatic exclusion - a duplicate here only
    means 让用户核对. The design direction is explicit that cross-image duplicates
    are marked as 可能重复 rather than removed;
  * no database. Ledger entries are passed in as plain values, so the rules can
    be tested without a server;
  * no guessing of missing fields. A candidate without an amount or a date
    cannot be matched by values (only by a printed serial number), because
    matching two unknowns would flag unrelated rows.

The matching rules are the same ones the existing single-entry duplicate check
uses (date/time/amount/currency/kind), extended with the transaction serial
number when a screenshot printed one. 口径 for 跨来源重复 (same money recorded
through two different apps) is **not** decided here - that needs the owner's
answer to design direction §10.4, so this module only compares amounts that are
actually equal.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from difflib import SequenceMatcher

from model import ISSUE_DUPLICATE_SUSPECTED, Candidate

# Two printed times within this many seconds count as the same moment. Matches
# the window the existing single-entry duplicate check uses; a list row usually
# prints only minutes, so an exact match is the common case anyway.
DUPLICATE_TIME_TOLERANCE_SECONDS = 60

# A serial shorter than this is not distinctive enough to match on (e.g. a
# four-digit order suffix on unrelated rows).
MIN_SERIAL_LENGTH = 8

# How similar two merchant strings must be before they count as the same party.
# Screenshots of the same row normally produce identical text; the ratio only
# absorbs OCR differences like a dropped space or punctuation.
MERCHANT_SIMILARITY = 0.85


@dataclass(frozen=True)
class ExistingEntry:
    """A ledger entry, as a plain value. No database, no Prisma types."""

    entry_id: str
    direction: str  # "expense" | "income"
    amount_minor: int
    currency: str
    occurred_local_date: str
    occurred_time: str | None = None


@dataclass(frozen=True)
class DuplicateOptions:
    time_tolerance_seconds: int = DUPLICATE_TIME_TOLERANCE_SECONDS
    min_serial_length: int = MIN_SERIAL_LENGTH


@dataclass(frozen=True)
class DuplicateGroup:
    """One component of "these look like the same money", for the user to settle."""

    group_id: str
    kind: str  # "same-image" | "cross-image" | "existing-entry"
    candidate_ids: tuple[str, ...]
    existing_entry_ids: tuple[str, ...]
    reason: str
    message: str

    def to_dict(self) -> dict[str, object]:
        return {
            "group_id": self.group_id,
            "kind": self.kind,
            "candidate_ids": list(self.candidate_ids),
            "existing_entry_ids": list(self.existing_entry_ids),
            "reason": self.reason,
            "message": self.message,
        }


@dataclass(frozen=True)
class DuplicateReport:
    groups: tuple[DuplicateGroup, ...] = ()
    same_image_count: int = 0
    cross_image_count: int = 0
    existing_count: int = 0
    duplicate_candidate_ids: frozenset[str] = frozenset()

    @property
    def empty(self) -> bool:
        return len(self.groups) == 0

    def groups_for(self, candidate_id: str) -> tuple[DuplicateGroup, ...]:
        return tuple(group for group in self.groups if candidate_id in group.candidate_ids)

    def to_dict(self) -> dict[str, object]:
        return {
            "groups": [group.to_dict() for group in self.groups],
            "same_image_count": self.same_image_count,
            "cross_image_count": self.cross_image_count,
            "existing_count": self.existing_count,
            "duplicate_candidate_ids": sorted(self.duplicate_candidate_ids),
        }


# --- value comparison -------------------------------------------------------


def amount_value(candidate: Candidate) -> Decimal | None:
    """The candidate's amount as a comparable number, or None if unreadable."""

    if candidate.amount is None:
        return None
    try:
        return Decimal(candidate.amount.replace(",", ""))
    except (InvalidOperation, ValueError):
        return None


def _entry_amount_value(entry: ExistingEntry) -> Decimal:
    return Decimal(entry.amount_minor) / Decimal(100)


def _merchant_key(text: str | None) -> str:
    if text is None:
        return ""
    normalised = unicodedata.normalize("NFKC", text).casefold()
    return re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", normalised)


def merchants_comparable(left: str | None, right: str | None) -> bool:
    """Whether two merchant strings could name the same party.

    When either side did not read a merchant, the comparison is skipped (the
    other evidence decides). When both were read and they are clearly different,
    it is *not* the same transaction - this is what stops two unrelated purchases
    of the same amount on the same day from being flagged.
    """

    left_key = _merchant_key(left)
    right_key = _merchant_key(right)
    if left_key == "" or right_key == "":
        return True
    if left_key == right_key:
        return True
    if len(left_key) >= 2 and len(right_key) >= 2 and (left_key in right_key or right_key in left_key):
        return True
    return SequenceMatcher(None, left_key, right_key).ratio() >= MERCHANT_SIMILARITY


def _time_to_seconds(value: str | None) -> int | None:
    if value is None:
        return None
    match = re.fullmatch(r"(\d{1,2}):(\d{2})", value.strip())
    if match is None:
        return None
    return int(match.group(1)) * 3600 + int(match.group(2)) * 60


def _times_close(left: str | None, right: str | None, tolerance: int) -> bool:
    left_seconds = _time_to_seconds(left)
    right_seconds = _time_to_seconds(right)
    if left_seconds is None or right_seconds is None:
        # One side printing no time is weak evidence, not a contradiction; the
        # caller notes that in the group's reason.
        return True
    return abs(left_seconds - right_seconds) <= tolerance


def _serial(candidate: Candidate, options: DuplicateOptions) -> str | None:
    if candidate.serial is None:
        return None
    serial = candidate.serial.strip()
    return serial if len(serial) >= options.min_serial_length else None


def _compare_candidates(
    left: Candidate,
    right: Candidate,
    options: DuplicateOptions,
) -> str | None:
    """Why these two look like one transaction, or None if they do not."""

    left_serial = _serial(left, options)
    right_serial = _serial(right, options)
    if left_serial is not None and right_serial is not None:
        if left_serial != right_serial:
            # Two different serials mean two different transactions, whatever
            # else happens to be equal. This is a strong negative.
            return None
        if left.amount != right.amount:
            return "交易单号相同但金额不同，疑似同一笔，请核对"
        return "交易单号相同"

    # A single serial with nothing to compare against still narrows the match
    # down, but only when the other side's evidence agrees.
    left_amount = amount_value(left)
    right_amount = amount_value(right)
    if left_amount is None or right_amount is None:
        return None
    if left_amount != right_amount:
        return None
    if left.currency is None or right.currency is None or left.currency != right.currency:
        return None
    if left.occurred_local_date is None or right.occurred_local_date is None:
        return None
    if left.occurred_local_date != right.occurred_local_date:
        return None
    if left.direction == "unknown" or right.direction == "unknown":
        # Direction is half of "same money"; without it, the values alone are
        # not enough evidence to raise a duplicate.
        return None
    if left.direction != right.direction:
        return None
    if not _times_close(left.occurred_time, right.occurred_time, options.time_tolerance_seconds):
        return None
    if not merchants_comparable(left.merchant, right.merchant):
        return None

    if left.occurred_time is None or right.occurred_time is None:
        return "金额、币种、方向、日期相同（时间缺失，可能无法区分同日多笔）"
    return "金额、币种、方向、日期、时间都相同"


def _compare_with_entry(
    candidate: Candidate,
    entry: ExistingEntry,
    options: DuplicateOptions,
) -> str | None:
    """The existing single-entry rule: date/time/amount/currency/direction."""

    candidate_amount = amount_value(candidate)
    if candidate_amount is None:
        return None
    if candidate_amount != _entry_amount_value(entry):
        return None
    if candidate.currency is None or candidate.currency != entry.currency:
        return None
    if candidate.direction == "unknown" or candidate.direction != entry.direction:
        return None
    if candidate.occurred_local_date is None:
        return None
    if candidate.occurred_local_date != entry.occurred_local_date:
        return None
    if not _times_close(candidate.occurred_time, entry.occurred_time, options.time_tolerance_seconds):
        return None
    return "账本里已有一笔金额、币种、方向、日期相同的账目"


# --- graph grouping ---------------------------------------------------------


class _UnionFind:
    def __init__(self) -> None:
        self.parent: dict[str, str] = {}

    def find(self, node: str) -> str:
        self.parent.setdefault(node, node)
        while self.parent[node] != node:
            self.parent[node] = self.parent[self.parent[node]]
            node = self.parent[node]
        return node

    def union(self, left: str, right: str) -> None:
        left_root = self.find(left)
        right_root = self.find(right)
        if left_root != right_root:
            self.parent[right_root] = left_root


def _groups_from_pairs(
    pairs: list[tuple[str, str, str]],
    *,
    kind: str,
    order: dict[str, int],
    group_prefix: str,
) -> tuple[DuplicateGroup, ...]:
    """Turn pairwise matches into connected components.

    Components rather than pairs, for the same reason the ledger-import duplicate
    check uses them: one candidate in two overlapping screenshots belongs to one
    group, and the user should make one decision about it, not two conflicting
    ones.
    """

    if not pairs:
        return ()

    forest = _UnionFind()
    reasons: dict[tuple[str, str], str] = {}
    for left_id, right_id, reason in pairs:
        forest.union(left_id, right_id)
        reasons[(left_id, right_id)] = reason

    components: dict[str, list[str]] = {}
    for pair in pairs:
        for candidate_id in pair[:2]:
            components.setdefault(forest.find(candidate_id), []).append(candidate_id)

    groups: list[DuplicateGroup] = []
    for index, members in enumerate(components.values(), start=1):
        unique_members = sorted(set(members), key=lambda candidate_id: order[candidate_id])
        if len(unique_members) < 2:
            continue
        # The reason shown to the user is the first match inside the component,
        # which is enough to explain why the group exists.
        reason = next(
            (
                reason_text
                for (left_id, right_id), reason_text in reasons.items()
                if left_id in unique_members and right_id in unique_members
            ),
            "特征相同",
        )
        if kind == "cross-image":
            message = "这些交易可能来自截图重叠或重复上传，被标记为可能重复，请核对后决定保留哪些。"
        else:
            message = "同一张截图里出现了可能相同的交易，请核对是否为截图重叠或 OCR 重复。"
        groups.append(
            DuplicateGroup(
                group_id=f"{group_prefix}-{index}",
                kind=kind,
                candidate_ids=tuple(unique_members),
                existing_entry_ids=(),
                reason=reason,
                message=message,
            )
        )

    return tuple(groups)


def find_within_image(
    candidates: list[Candidate],
    options: DuplicateOptions | None = None,
) -> tuple[DuplicateGroup, ...]:
    """Candidate pairs inside the same image."""

    effective = options or DuplicateOptions()
    order = {candidate.candidate_id: index for index, candidate in enumerate(candidates)}
    pairs: list[tuple[str, str, str]] = []

    for left_index, left in enumerate(candidates):
        for right in candidates[left_index + 1 :]:
            if left.image_index != right.image_index:
                continue
            reason = _compare_candidates(left, right, effective)
            if reason is not None:
                pairs.append((left.candidate_id, right.candidate_id, reason))

    return _groups_from_pairs(pairs, kind="same-image", order=order, group_prefix="dup-same")


def find_cross_image(
    candidates: list[Candidate],
    options: DuplicateOptions | None = None,
) -> tuple[DuplicateGroup, ...]:
    """Candidate pairs from different images (overlapping screenshots, re-uploads)."""

    effective = options or DuplicateOptions()
    order = {candidate.candidate_id: index for index, candidate in enumerate(candidates)}
    pairs: list[tuple[str, str, str]] = []

    for left_index, left in enumerate(candidates):
        for right in candidates[left_index + 1 :]:
            if left.image_index == right.image_index:
                continue
            reason = _compare_candidates(left, right, effective)
            if reason is not None:
                pairs.append((left.candidate_id, right.candidate_id, reason))

    return _groups_from_pairs(pairs, kind="cross-image", order=order, group_prefix="dup-cross")


def find_against_existing(
    candidates: list[Candidate],
    existing_entries: list[ExistingEntry],
    options: DuplicateOptions | None = None,
) -> tuple[DuplicateGroup, ...]:
    """Suspected duplicates between extracted candidates and ledger entries.

    No database access: the caller passes the entries it already has (the
    existing single-entry flow fetches them through the API).
    """

    effective = options or DuplicateOptions()
    groups: list[DuplicateGroup] = []

    for candidate in candidates:
        matched = [
            entry
            for entry in existing_entries
            if _compare_with_entry(candidate, entry, effective) is not None
        ]
        if not matched:
            continue
        groups.append(
            DuplicateGroup(
                group_id=f"dup-existing-{len(groups) + 1}",
                kind="existing-entry",
                candidate_ids=(candidate.candidate_id,),
                existing_entry_ids=tuple(entry.entry_id for entry in matched),
                reason=(
                    "账本里已有一笔金额、币种、方向、日期相同的账目"
                    if len(matched) == 1
                    else f"账本里已有 {len(matched)} 笔金额、币种、方向、日期相同的账目"
                ),
                message="账本里可能已经记过这笔账，请确认是保留一笔、还是两笔都留。",
            )
        )

    return tuple(groups)


def find_duplicates(
    candidates: list[Candidate],
    existing_entries: list[ExistingEntry] | None = None,
    options: DuplicateOptions | None = None,
) -> DuplicateReport:
    """All three scopes in one call.

    Returns groups plus the set of candidate ids involved, so the overview screen
    can show 可能重复 count and mark the cards without any further pass.
    """

    same_image = find_within_image(candidates, options)
    cross_image = find_cross_image(candidates, options)
    existing = find_against_existing(candidates, existing_entries or [], options)

    duplicate_ids: set[str] = set()
    for group in (*same_image, *cross_image, *existing):
        duplicate_ids.update(group.candidate_ids)

    return DuplicateReport(
        groups=(*same_image, *cross_image, *existing),
        same_image_count=len(same_image),
        cross_image_count=len(cross_image),
        existing_count=len(existing),
        duplicate_candidate_ids=frozenset(duplicate_ids),
    )


def mark_duplicates(candidates: list[Candidate], report: DuplicateReport) -> None:
    """Attach group ids and one visible issue to each involved candidate.

    A duplicate mark never removes anything: it only turns the item into one the
    user is asked about, which is why it is added as an issue rather than a flag
    the interface could silently filter on.
    """

    for candidate in candidates:
        groups = report.groups_for(candidate.candidate_id)
        if not groups:
            continue
        candidate.duplicate_group_ids = [group.group_id for group in groups]
        group = groups[0]
        candidate.add_issue(
            ISSUE_DUPLICATE_SUSPECTED,
            f"{group.message}（{group.reason}）",
            None,
        )
