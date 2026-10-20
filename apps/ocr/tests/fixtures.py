"""Synthetic OCR-line fixtures for the S15-B tests.

These are **not** screenshots: they are the text+boxes an OCR engine returns,
hand-built to match the layouts the real samples showed. That keeps the tests
fast, deterministic and free of any real user screenshot, which the design
direction forbids adding to the repository.

Every fixture that represents a layout nobody has a real sample for is marked
`未验证` in its name or comment, and the classifier says so too.
"""

from __future__ import annotations

from extract import Line


def L(text: str, top: float, left: float, height: float = 26.0, score: float = 0.99) -> Line:
    """One recognised line. Width is not used by the pipeline, only height/top/left."""

    return Line(text=text, score=score, height=height, top=top, left=left)


def wechat_single_detail() -> list[Line]:
    """Synthetic WeChat payment detail, matching `make_samples.py`'s rows.

    Real screenshots of the same screen are recorded in `real-samples/README.md`.
    """

    return [
        L("9:41", 20, 40, 20),
        L("微信支付", 60, 380, 34),
        L("支付成功", 112, 380, 24),
        L("¥", 250, 400, 40),
        L("20.00", 350, 340, 110),
        L("已支付", 425, 380, 22),
        L("当前状态", 543, 36),
        L("支付成功", 543, 600),
        L("商品", 631, 36),
        L("扫二维码付款", 631, 560),
        L("商户全称", 719, 36),
        L("老王便利店", 719, 600),
        L("支付方式", 807, 36),
        L("零钱", 807, 640),
        L("支付时间", 895, 36),
        L("2026年10月9日 12:34", 895, 500),
        L("交易单号", 983, 36),
        L("4200002318202610091234567890", 983, 380),
        L("商户单号", 1071, 36),
        L("20261009123456789012", 1071, 400),
    ]


def alipay_single_detail() -> list[Line]:
    """Synthetic Alipay money-received detail; real screenshots recorded in real-samples README."""

    return [
        L("9:41", 20, 40, 20),
        L("支付宝", 60, 380, 34),
        L("收款成功", 112, 380, 24),
        L("￥", 250, 400, 40),
        L("1,280.00", 350, 300, 110),
        L("已到账", 425, 380, 22),
        L("当前状态", 543, 36),
        L("收款成功", 543, 610),
        L("付款方", 631, 36),
        L("张*", 631, 650),
        L("收款方", 719, 36),
        L("我的余额", 719, 610),
        L("收款时间", 807, 36),
        L("2026年10月9日 08:15", 807, 500),
        L("交易号", 895, 36),
        L("2026100922001234567890", 895, 400),
        L("备注", 983, 36),
        L("10 月房租", 983, 640),
    ]


def bank_transfer_detail() -> list[Line]:
    """Synthetic bank transfer detail — 未验证: no real bank App screenshot exists yet."""

    return [
        L("9:41", 20, 40, 20),
        L("转账详情", 60, 380, 34),
        L("转账成功", 112, 380, 24),
        L("¥", 250, 400, 40),
        L("3,500.00", 350, 300, 110),
        L("转账成功", 425, 380, 22),
        L("交易状态", 543, 36),
        L("交易成功", 543, 610),
        L("付款账户", 631, 36),
        L("尾号 6688", 631, 620),
        L("收款账户", 719, 36),
        L("陈*", 719, 660),
        L("转账时间", 807, 36),
        L("2026年10月8日 19:02", 807, 490),
        L("转账说明", 895, 36),
        L("还款", 895, 660),
        L("交易流水号", 983, 36),
        L("20261008190233445566", 983, 380),
    ]


def wechat_transaction_list() -> list[Line]:
    """未验证: a WeChat bill list drawn from the field names the detail screen uses.

    No real list screenshot has been supplied (real-samples/README.md §2), so the
    geometry here is our assumption, not an observation.
    """

    return [
        L("9:41", 20, 40, 20),
        L("微信支付", 60, 380, 34),
        L("账单", 110, 380, 30),
        L("2026年10月", 160, 36),
        L("全部账单", 210, 36),
        L("麦当劳", 320, 36),
        L("-32.00", 320, 700),
        L("10月9日 12:34", 360, 36, 22),
        L("小杨生煎", 460, 36),
        L("-18.50", 460, 700),
        L("10月9日 09:12", 500, 36, 22),
        L("转账-来自张三", 600, 36),
        L("+100.00", 600, 692),
        L("10月8日 21:03", 640, 36, 22),
    ]


def alipay_transaction_list() -> list[Line]:
    """未验证: an Alipay bill list; same caveat as the WeChat one."""

    return [
        L("9:41", 20, 40, 20),
        L("支付宝", 60, 380, 34),
        L("账单", 110, 380, 30),
        L("账单管理", 160, 36),
        L("收支明细", 210, 36),
        L("上海米哈游网络科技股份有限公司", 320, 36),
        L("-98.00", 320, 690),
        L("2026-10-08 12:29", 360, 36, 22),
        L("美团外卖", 460, 36),
        L("-35.60", 460, 700),
        L("2026-10-08 11:02", 500, 36, 22),
        L("退款-美团外卖", 600, 36),
        L("+35.60", 600, 690),
        L("2026-10-08 12:40", 640, 36, 22),
    ]


def boa_activity_list() -> list[Line]:
    """未验证: a BOA activity list assembled from general knowledge only.

    The owner has not supplied a BOA screenshot, so neither the wording nor the
    column positions are evidence — the classifier reports it as unverified.
    """

    return [
        L("9:41", 20, 40, 20),
        L("Bank of America", 60, 36, 30),
        L("Transactions", 110, 36, 28),
        L("09/21/2026", 300, 36, 24),
        L("APPLE.COM/BILL  CUPERTINO", 300, 150, 24),
        L("-328.00", 300, 700, 24),
        L("09/21/2026", 360, 36, 24),
        L("PAYROLL  ACME CORP", 360, 150, 24),
        L("+2,500.00", 360, 690, 24),
    ]


def unknown_page() -> list[Line]:
    """A settings screen: text but no transaction structure at all."""

    return [
        L("9:41", 20, 40, 20),
        L("设置", 100, 380, 32),
        L("通用", 200, 36),
        L("关于本机", 260, 36),
        L("版本 1.0.0", 320, 36),
        L("深色模式", 380, 36),
    ]
