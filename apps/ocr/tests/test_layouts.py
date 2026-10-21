"""Tests for the page/layout classifier.

What matters here is the product rule from the design direction: a page whose
type cannot be told must come back as `unknown` and require the user to choose,
never silently as "one transaction" or "many".
"""

from __future__ import annotations

import unittest

from extract import Line
from layouts import (
    LayoutDescriptor,
    LayoutFeatures,
    classify,
    explain,
    register_layout,
    registered_layouts,
    reset_layouts,
)
from multi_extract import CUSTOM_EXTRACTORS
from tests import fixtures


class ClassifyKnownLayoutsTest(unittest.TestCase):
    def test_wechat_payment_detail_is_one_page(self) -> None:
        result = classify(fixtures.wechat_single_detail())

        self.assertEqual(result.page_type, "single-detail")
        self.assertEqual(result.layout_id, "wechat-single-detail")
        self.assertEqual(result.platform, "WECHAT")
        self.assertTrue(result.verified)
        self.assertFalse(result.requires_user_choice)
        self.assertGreaterEqual(result.confidence, 0.8)
        self.assertTrue(any("微信支付" in item for item in result.evidence))

    def test_alipay_detail_is_recognised_as_alipay(self) -> None:
        result = classify(fixtures.alipay_single_detail())

        self.assertEqual(result.page_type, "single-detail")
        self.assertEqual(result.platform, "ALIPAY")
        self.assertTrue(result.verified)

    def test_bank_transfer_detail_is_single_but_unverified(self) -> None:
        result = classify(fixtures.bank_transfer_detail())

        self.assertEqual(result.page_type, "single-detail")
        self.assertEqual(result.layout_id, "bank-transfer-detail")
        # No real bank screenshot exists; the classifier must say so rather than
        # present a guess as verified.
        self.assertFalse(result.verified)
        self.assertIn("未验证版式（没有对应样本）", result.evidence)

    def test_a_transfer_detail_with_a_numeric_account_value_is_not_a_list(self) -> None:
        # 尾号/账号 values can look like numbers; a field value must not be
        # mistaken for a second transaction. This is the bug the label-value
        # exclusion in `analyse_structure` exists for.
        lines = fixtures.bank_transfer_detail()
        lines.append(fixtures.L("6688", 631, 640))
        result = classify(lines)

        self.assertEqual(result.page_type, "single-detail")
        self.assertEqual(result.layout_id, "bank-transfer-detail")


class ClassifyListsTest(unittest.TestCase):
    def test_wechat_bill_list_is_transaction_list(self) -> None:
        result = classify(fixtures.wechat_transaction_list())

        self.assertEqual(result.page_type, "transaction-list")
        self.assertEqual(result.layout_id, "wechat-transaction-list")
        self.assertEqual(result.platform, "WECHAT")
        self.assertFalse(result.verified)  # no real sample of this row shape

    def test_alipay_bill_list_is_transaction_list(self) -> None:
        result = classify(fixtures.alipay_transaction_list())

        self.assertEqual(result.page_type, "transaction-list")
        self.assertEqual(result.layout_id, "alipay-transaction-list")

    def test_boa_list_is_matched_against_a_real_sample(self) -> None:
        result = classify(fixtures.boa_activity_list())

        self.assertEqual(result.page_type, "transaction-list")
        self.assertEqual(result.layout_id, "boa-activity-list")
        self.assertTrue(result.verified)
        self.assertTrue(any("Bank" in item for item in result.evidence))

    def test_a_list_with_no_known_source_falls_back_to_structure(self) -> None:
        # Structure is still evidence of "several transactions", so the page type
        # is claimed; what is *not* claimed is that the fields are understood,
        # which the unverified flag and the layout id make visible.
        page = [
            fixtures.L("9:41", 20, 40, 20),
            fixtures.L("某银行", 60, 36, 30),
            fixtures.L("咖啡", 300, 36),
            fixtures.L("-25.00", 300, 700),
            fixtures.L("10月9日 08:00", 340, 36, 22),
            fixtures.L("地铁", 440, 36),
            fixtures.L("-6.00", 440, 700),
            fixtures.L("10月9日 07:30", 480, 36, 22),
        ]
        result = classify(page)

        self.assertEqual(result.page_type, "transaction-list")
        self.assertEqual(result.layout_id, "generic-transaction-list")
        self.assertIsNone(result.platform)
        self.assertFalse(result.verified)


class ClassifyRealListShapesTest(unittest.TestCase):
    """The four list shapes the 2026-10-20 real samples brought."""

    def test_wechat_bill_home_without_the_word_wechat_is_still_wechat(self) -> None:
        # The screen's title is just 账单: no 微信 / 零钱 / 财付通 anywhere. It is
        # recognised by its own chrome (全部账单 / 查找交易 / 收支统计).
        result = classify(fixtures.wechat_bill_home_list())

        self.assertEqual(result.page_type, "transaction-list")
        self.assertEqual(result.layout_id, "wechat-bill-list")
        self.assertEqual(result.platform, "WECHAT")
        self.assertTrue(result.verified)
        self.assertFalse(result.requires_user_choice)

    def test_wechat_bill_cards_are_their_own_layout(self) -> None:
        result = classify(fixtures.wechat_bill_cards())

        self.assertEqual(result.page_type, "transaction-list")
        self.assertEqual(result.layout_id, "wechat-bill-cards")
        self.assertTrue(result.verified)
        # Not the plain row list, even though both are WeChat bills.
        self.assertNotEqual(result.layout_id, "wechat-transaction-list")

    def test_alipay_list_is_recognised_without_the_word_alipay(self) -> None:
        result = classify(fixtures.alipay_bill_with_relative_dates())

        self.assertEqual(result.page_type, "transaction-list")
        self.assertEqual(result.layout_id, "alipay-transaction-list")
        self.assertEqual(result.platform, "ALIPAY")
        self.assertTrue(result.verified)

    def test_a_page_with_no_evidence_at_all_cannot_borrow_a_platform(self) -> None:
        # The Alipay layout's gate is its own chrome, not "any list page": a page
        # that prints none of it must not be claimed as Alipay.
        page = [
            fixtures.L("9:41", 20, 40, 20),
            fixtures.L("流水", 60, 36, 30),
            fixtures.L("咖啡", 300, 36),
            fixtures.L("-25.00", 300, 700),
            fixtures.L("10月9日 08:00", 340, 36, 22),
            fixtures.L("地铁", 440, 36),
            fixtures.L("-6.00", 440, 700),
            fixtures.L("10月9日 07:30", 480, 36, 22),
        ]
        result = classify(page)

        self.assertNotEqual(result.layout_id, "alipay-transaction-list")
        self.assertIsNone(result.platform)


class ClassifyBankDetailTest(unittest.TestCase):
    def test_boa_single_detail_is_one_page(self) -> None:
        result = classify(fixtures.bank_single_detail())

        self.assertEqual(result.page_type, "single-detail")
        self.assertEqual(result.layout_id, "bank-single-detail")
        self.assertEqual(result.platform, "BANK")
        # One sample only: the layout must still say it is unchecked.
        self.assertFalse(result.verified)

    def test_boa_transfer_confirmation_is_one_page(self) -> None:
        result = classify(fixtures.bank_transfer_confirmation())

        self.assertEqual(result.page_type, "single-detail")
        self.assertEqual(result.layout_id, "bank-transfer-confirmation")
        self.assertFalse(result.verified)

    def test_an_account_tail_under_its_label_does_not_make_a_detail_a_list(self) -> None:
        # `From` / `Adv SafeBalance Banking-` / the account's last digits on their
        # own row: that wrap-around value used to be counted as a second amount
        # row, which blocked every single-detail layout and left the page unknown.
        result = classify(fixtures.bank_transfer_confirmation())

        self.assertEqual(result.structure_signals[0], "0 个金额行")
        self.assertEqual(result.page_type, "single-detail")


class ClassifyOrderPlatformsTest(unittest.TestCase):
    """美团 / 京东 / 淘宝 order screens (2026-10-21 samples).

    One list and one detail per platform, because the two answer different
    questions: how many transactions are on the page, and is this page an order
    at all. The same platform word appears on both, so the gate that separates
    them is the page's structure, not its vocabulary.
    """

    def test_meituan_order_list_is_a_transaction_list(self) -> None:
        result = classify(fixtures.meituan_order_list())

        self.assertEqual(result.page_type, "transaction-list")
        self.assertEqual(result.layout_id, "meituan-order-list")
        self.assertEqual(result.platform, "MEITUAN")
        self.assertTrue(result.verified)
        self.assertFalse(result.requires_user_choice)

    def test_meituan_order_detail_is_one_page(self) -> None:
        result = classify(fixtures.meituan_order_detail())

        self.assertEqual(result.page_type, "single-detail")
        self.assertEqual(result.layout_id, "meituan-order-detail")
        self.assertEqual(result.platform, "MEITUAN")

    def test_jd_order_list_is_a_transaction_list(self) -> None:
        result = classify(fixtures.jd_order_list())

        self.assertEqual(result.page_type, "transaction-list")
        self.assertEqual(result.layout_id, "jd-order-list")
        self.assertEqual(result.platform, "JD")
        self.assertTrue(result.verified)

    def test_jd_order_detail_is_one_page(self) -> None:
        result = classify(fixtures.jd_order_detail())

        self.assertEqual(result.page_type, "single-detail")
        self.assertEqual(result.layout_id, "jd-order-detail")
        self.assertEqual(result.platform, "JD")

    def test_taobao_order_list_is_a_transaction_list(self) -> None:
        result = classify(fixtures.taobao_order_list())

        self.assertEqual(result.page_type, "transaction-list")
        self.assertEqual(result.layout_id, "taobao-order-list")
        self.assertEqual(result.platform, "TAOBAO")

    def test_taobao_closed_order_detail_is_one_page(self) -> None:
        result = classify(fixtures.taobao_order_detail())

        self.assertEqual(result.page_type, "single-detail")
        self.assertEqual(result.layout_id, "taobao-order-detail")
        self.assertEqual(result.platform, "TAOBAO")

    def test_the_order_list_does_not_print_its_brand_and_is_still_recognised(self) -> None:
        # 美团's list prints no 美团 anywhere (only the logo); 京东's prints it
        # inside a shop name. Neither may need the brand word to be read.
        meituan = fixtures.meituan_order_list()
        self.assertFalse(any("美团" in line.text for line in meituan))
        self.assertIn("meituan-order-list", classify(meituan).layout_id)

    def test_an_order_detail_without_its_money_label_is_not_claimed(self) -> None:
        # The detail layouts require their own money label (合计/实付款/应付款),
        # so a page that merely *mentions* 京东 or 淘宝 is not cut into one order.
        lines = [line for line in fixtures.jd_order_detail() if "实付款" not in line.text]

        result = classify(lines)

        self.assertNotEqual(result.layout_id, "jd-order-detail")


class ClassifyUnknownTest(unittest.TestCase):
    def test_a_page_with_no_transaction_structure_requires_a_choice(self) -> None:
        result = classify(fixtures.unknown_page())

        self.assertEqual(result.page_type, "unknown")
        self.assertTrue(result.requires_user_choice)
        self.assertIsNone(result.layout_id)
        self.assertIn("没有匹配到已注册版式", result.evidence)

    def test_empty_input_is_unknown_not_a_transaction(self) -> None:
        result = classify([])

        self.assertEqual(result.page_type, "unknown")
        self.assertTrue(result.requires_user_choice)

    def test_a_single_amount_detail_without_a_registered_layout_asks(self) -> None:
        # Structure looks like a detail page but the source is unknown: the
        # design direction says let the user choose, not "one transaction".
        page = [
            fixtures.L("9:41", 20, 40, 20),
            fixtures.L("付款详情", 60, 380, 34),
            fixtures.L("12.00", 350, 340, 100),
            fixtures.L("收款方", 543, 36),
            fixtures.L("便利店", 543, 620),
            fixtures.L("付款时间", 631, 36),
            fixtures.L("2026年10月9日 12:00", 631, 500),
        ]
        result = classify(page)

        self.assertEqual(result.page_type, "unknown")
        self.assertTrue(result.requires_user_choice)


class RegistryExtensionTest(unittest.TestCase):
    def tearDown(self) -> None:
        reset_layouts()

    def test_a_new_layout_is_registered_without_touching_the_main_flow(self) -> None:
        register_layout(
            LayoutDescriptor(
                id="test-bank-list",
                label="测试银行交易列表",
                page_type="transaction-list",
                platform="BANK",
                verified=False,
                sample=None,
                features=LayoutFeatures(
                    structure="list",
                    platform_markers=("测试银行",),
                    list_markers=("交易明细",),
                ),
            )
        )
        page = [
            fixtures.L("9:41", 20, 40, 20),
            fixtures.L("测试银行", 60, 36, 30),
            fixtures.L("交易明细", 110, 36),
            fixtures.L("咖啡", 300, 36),
            fixtures.L("-25.00", 300, 700),
            fixtures.L("10月9日 08:00", 340, 36, 22),
            fixtures.L("地铁", 440, 36),
            fixtures.L("-6.00", 440, 700),
            fixtures.L("10月9日 07:30", 480, 36, 22),
        ]

        result = classify(page)

        self.assertEqual(result.layout_id, "test-bank-list")
        self.assertEqual(result.page_type, "transaction-list")
        self.assertTrue(any("测试银行" in item for item in result.evidence))

    def test_duplicate_layout_ids_are_refused(self) -> None:
        with self.assertRaises(ValueError):
            register_layout(
                LayoutDescriptor(
                    id="generic-transaction-list",
                    label="重复 id",
                    page_type="transaction-list",
                    platform=None,
                    verified=False,
                    sample=None,
                    features=LayoutFeatures(structure="list"),
                )
            )

    def test_builtin_registry_covers_the_documented_layouts(self) -> None:
        ids = {layout.id for layout in registered_layouts()}

        self.assertIn("wechat-single-detail", ids)
        self.assertIn("alipay-single-detail", ids)
        self.assertIn("bank-transfer-detail", ids)
        self.assertIn("bank-single-detail", ids)
        self.assertIn("bank-transfer-confirmation", ids)
        self.assertIn("wechat-bill-list", ids)
        self.assertIn("wechat-bill-cards", ids)
        self.assertIn("wechat-transaction-list", ids)
        self.assertIn("alipay-transaction-list", ids)
        self.assertIn("boa-activity-list", ids)
        self.assertIn("generic-transaction-list", ids)
        self.assertIn("meituan-order-list", ids)
        self.assertIn("meituan-order-detail", ids)
        self.assertIn("jd-order-list", ids)
        self.assertIn("jd-order-detail", ids)
        self.assertIn("taobao-order-list", ids)
        self.assertIn("taobao-order-detail", ids)

    def test_verified_flags_match_the_documented_evidence(self) -> None:
        by_id = {layout.id: layout for layout in registered_layouts()}

        self.assertTrue(by_id["wechat-single-detail"].verified)
        self.assertTrue(by_id["alipay-single-detail"].verified)
        # Read end-to-end against the 2026-10-20 screenshots.
        for layout_id in (
            "wechat-bill-list",
            "wechat-bill-cards",
            "alipay-transaction-list",
            "boa-activity-list",
        ):
            self.assertTrue(by_id[layout_id].verified, layout_id)
        # Read end-to-end against the 2026-10-21 美团/京东/淘宝 screenshots: one
        # sample per layout, and every field it printed came out right.
        for layout_id in (
            "meituan-order-list",
            "meituan-order-detail",
            "jd-order-list",
            "jd-order-detail",
            "taobao-order-list",
            "taobao-order-detail",
        ):
            self.assertTrue(by_id[layout_id].verified, layout_id)
        # Still unverified: one sample each (bank detail pages), synthetic only
        # (generic transfer detail), or no sample at all (the WeChat row list).
        for layout_id in (
            "bank-transfer-detail",
            "bank-single-detail",
            "bank-transfer-confirmation",
            "wechat-transaction-list",
            "generic-transaction-list",
        ):
            self.assertFalse(by_id[layout_id].verified, layout_id)

    def test_every_registered_extractor_exists(self) -> None:
        for layout in registered_layouts():
            spec = layout.extraction
            if spec.strategy != "custom":
                continue
            self.assertIn(
                spec.custom_extractor,
                CUSTOM_EXTRACTORS,
                f"{layout.id} 指向了未注册的抽取器",
            )


class ExplainTest(unittest.TestCase):
    def test_explain_reports_page_type_and_evidence(self) -> None:
        text = explain(classify(fixtures.wechat_single_detail()))

        self.assertIn("单笔详情", text)
        self.assertIn("微信", text)
        self.assertIn("依据", text)


if __name__ == "__main__":
    unittest.main()
