"""Tests for the overview batch: counts, default selection, and duplicate marks.

The overview's job is to let the user confirm quickly: 没有问题的项不要求逐笔点开,
有疑问的项才重点核对. So the counts have to be exactly the list's counts, and the
default selection may only contain items that truly need no attention.
"""

from __future__ import annotations

import json
import unittest

from dedupe import ExistingEntry
from overview import build_overview, describe_overview
from tests import fixtures


class CleanBatchTest(unittest.TestCase):
    def test_a_complete_wechat_detail_is_selected_by_default(self) -> None:
        overview = build_overview([(0, fixtures.wechat_single_detail())])

        summary = overview.summary
        self.assertEqual(summary.total, 1)
        self.assertEqual(summary.complete, 1)
        self.assertEqual(summary.questionable, 0)
        self.assertEqual(summary.duplicates, 0)
        self.assertEqual(summary.unknown_pages, 0)
        self.assertEqual(summary.selected_by_default, ("img0-1",))
        self.assertFalse(overview.requires_user_choice)
        self.assertEqual(overview.warnings, ())

    def test_counts_always_match_the_candidate_list(self) -> None:
        pages = [
            (0, fixtures.wechat_single_detail()),
            (1, fixtures.wechat_transaction_list()),
        ]
        overview = build_overview(pages)
        summary = overview.summary

        self.assertEqual(summary.total, len(overview.candidates))
        self.assertEqual(
            summary.questionable,
            sum(1 for item in overview.candidates if item.is_questionable or not item.is_complete),
        )
        self.assertEqual(
            summary.duplicates,
            sum(1 for item in overview.candidates if item.duplicate_suspected),
        )


class QuestionableBatchTest(unittest.TestCase):
    def test_a_list_without_a_year_needs_attention_and_is_not_preselected(self) -> None:
        overview = build_overview([(0, fixtures.wechat_transaction_list())])

        summary = overview.summary
        self.assertEqual(summary.total, 3)
        self.assertEqual(summary.complete, 0)
        self.assertEqual(summary.questionable, 3)
        # A layout with no real sample is never presented as safe to confirm.
        self.assertEqual(summary.selected_by_default, ())

    def test_an_unverified_layout_flag_is_visible_on_every_item(self) -> None:
        overview = build_overview([(0, fixtures.boa_activity_list())])

        for candidate in overview.candidates:
            self.assertTrue(any(issue.code == "layout_unverified" for issue in candidate.issues))

    def test_an_unknown_page_asks_instead_of_choosing_a_count(self) -> None:
        overview = build_overview([(0, fixtures.unknown_page())])

        summary = overview.summary
        self.assertEqual(summary.total, 0)
        self.assertEqual(summary.unknown_pages, 1)
        self.assertEqual(summary.pages_requiring_choice, 1)
        self.assertTrue(overview.requires_user_choice)
        self.assertTrue(any("选择按单笔还是按多笔" in warning for warning in overview.warnings))

    def test_an_upload_mixing_a_readable_page_and_an_unknown_one_still_reports_both(self) -> None:
        pages = [
            (0, fixtures.wechat_single_detail()),
            (1, fixtures.unknown_page()),
        ]
        overview = build_overview(pages)

        self.assertEqual(overview.summary.total, 1)
        self.assertEqual(overview.summary.unknown_pages, 1)
        self.assertEqual(overview.summary.selected_by_default, ("img0-1",))
        self.assertTrue(overview.requires_user_choice)


class DuplicateBatchTest(unittest.TestCase):
    def test_the_same_list_uploaded_twice_is_marked_but_kept(self) -> None:
        lines = fixtures.alipay_transaction_list()
        overview = build_overview([(0, lines), (1, lines)])

        self.assertEqual(overview.summary.total, 6)
        self.assertEqual(overview.summary.duplicates, 6)
        self.assertEqual(overview.summary.selected_by_default, ())
        self.assertEqual(overview.duplicates.cross_image_count, 3)
        # Nothing is removed: the user settles the duplicates.
        self.assertEqual(len(overview.candidates), 6)
        for candidate in overview.candidates:
            self.assertTrue(candidate.duplicate_suspected)
            self.assertTrue(any(issue.code == "duplicate_suspected" for issue in candidate.issues))

    def test_an_existing_ledger_entry_is_marked_as_a_possible_duplicate(self) -> None:
        existing = [
            ExistingEntry(
                entry_id="tx-1",
                direction="expense",
                amount_minor=2000,
                currency="CNY",
                occurred_local_date="2026-10-09",
                occurred_time="12:34",
            )
        ]
        overview = build_overview([(0, fixtures.wechat_single_detail())], existing_entries=existing)

        self.assertEqual(overview.duplicates.existing_count, 1)
        candidate = overview.candidates[0]
        self.assertIn("duplicate_suspected", {issue.code for issue in candidate.issues})
        self.assertEqual(overview.summary.selected_by_default, ())
        self.assertEqual(overview.summary.duplicates, 1)


class SerialisationTest(unittest.TestCase):
    def test_the_overview_is_json_serialisable_for_the_sidecar_protocol(self) -> None:
        lines = fixtures.alipay_transaction_list()
        payload = build_overview([(0, lines), (1, lines)]).to_dict()

        encoded = json.dumps(payload, ensure_ascii=False)
        decoded = json.loads(encoded)

        self.assertEqual(decoded["summary"]["total"], 6)
        self.assertEqual(decoded["summary"]["duplicates"], 6)
        self.assertIn("pages", decoded)
        self.assertIn("candidates", decoded)
        self.assertIn("duplicates", decoded)
        # The serialised candidate keeps nulls rather than dropping them: the
        # interface needs to know the difference between "not read" and "absent".
        first = decoded["candidates"][0]
        self.assertIn("occurred_local_date", first)
        self.assertIn("currency", first)
        self.assertIn("issues", first)

    def test_describe_overview_reports_the_counts(self) -> None:
        overview = build_overview([(0, fixtures.wechat_single_detail())])
        text = describe_overview(overview)

        self.assertIn("共 1 笔", text)
        self.assertIn("可直接确认 1 笔", text)


if __name__ == "__main__":
    unittest.main()
