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
    """未验证形状: a BOA activity list with US slash dates, no group date headers.

    This is the *old* assumed shape (and the reason the real screenshot broke the
    generic cutter): it has no `Oct 19, 2026` header, so `boa-activity-rows`
    cannot cut it and the generic rule handles it. Kept as the fallback case.
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


def boa_activity_list_with_balance_column() -> list[Line]:
    """未验证形状: two numbers per row, one signed and one not.

    The signed column is the transaction amount and the unsigned one is the
    running balance - the shape the real BOA screenshots show. Equal font sizes
    here on purpose: the sign alone has to be enough.
    """

    return [
        L("9:41", 20, 40, 20),
        L("Bank of America", 60, 36, 30),
        L("Transactions", 110, 36, 28),
        L("09/21/2026", 300, 36, 24),
        L("APPLE.COM/BILL  CUPERTINO", 300, 150, 24),
        L("-328.00", 300, 640, 24),
        L("1,672.00", 300, 760, 24),
        L("09/21/2026", 360, 36, 24),
        L("PAYROLL  ACME CORP", 360, 150, 24),
        L("+2,500.00", 360, 640, 24),
        L("4,172.00", 360, 760, 24),
    ]


def boa_activity_list_two_unsigned_columns() -> list[Line]:
    """未验证形状: two unsigned numbers, same font size — genuinely ambiguous.

    No sign and no size difference leaves the reader no evidence at all, so the
    amount must stay empty with an `amount_uncertain` issue rather than becoming
    the rightmost number (the balance).
    """

    return [
        L("9:41", 20, 40, 20),
        L("Bank of America", 60, 36, 30),
        L("Transactions", 110, 36, 28),
        L("09/21/2026", 300, 36, 24),
        L("PAYROLL  ACME CORP", 300, 150, 24),
        L("2,500.00", 300, 640, 24),
        L("4,172.00", 300, 760, 24),
        L("09/21/2026", 360, 36, 24),
        L("INTEREST PAID", 360, 150, 24),
        L("0.42", 360, 640, 24),
        L("4,172.42", 360, 760, 24),
    ]


def boa_deals_list() -> list[Line]:
    """The real BOA list shape (3 transactions), reduced to its geometry.

    Geometry copied from the 2026-10-20 BOA activity screenshots; **every name,
    merchant and account tail is replaced with a placeholder**, so what is left
    is the layout evidence and nothing personal:

      * the account banner prints `$417.50` in a 94px font **above** the list -
        a balance, never an amount;
      * each transaction starts with its own `Oct 19, 2026` group date;
      * the description runs 2-4 rows at x≈46;
      * the amount column (55px, signed) sits at x≈888 and the running balance
        column (40px, unsigned) at x≈904;
      * the bottom navigation bar prints the word `Transfer` - which made every
        row look like a transfer until the description band got a ceiling.
    """

    return [
        L("6:15 m", 61.8, 125.8, 52.8),
        L("Account", 210.0, 175.3, 49.0),
        L("Provided byBankofAmerica", 494.7, 729.3, 42.5),
        L("ADVSAFEBALANCEBANKING-0000", 602.9, 141.0, 42.5),
        L("$417.50", 769.1, 405.3, 94.0),
        L("Availablebalance", 891.5, 402.7, 34.8),
        L("Recent transactions", 1348.9, 49.5, 46.4),
        # --- transaction 1
        L("Oct 19,2026", 1468.7, 45.7, 41.2),
        L("COFFEE SHOP", 1522.8, 49.5, 42.5),
        L("-$4.19", 1562.7, 888.1, 56.7),
        L("10/19 MOBILE", 1580.8, 48.3, 50.2),
        L("$417.50", 1623.3, 904.6, 39.9),
        L("PURCHASE ANYTOWN", 1645.2, 49.5, 42.5),
        L("CA", 1701.9, 45.7, 50.2),
        # --- transaction 2
        L("Oct 19,2026", 1830.7, 47.0, 42.5),
        L("Zelle payment to", 1883.5, 48.3, 51.5),
        L("-$23.00", 1896.4, 852.5, 54.1),
        L("PAYEE NAME Conf#", 1946.6, 49.5, 42.5),
        L("$421.69", 1955.6, 899.5, 39.9),
        L("a1b2c3d4e", 2000.7, 43.2, 56.7),
        # --- transaction 3: the row that overlaps the scrolled screenshot
        L("Oct 19,2026", 2130.9, 45.7, 42.5),
        L("FOOD DELIVERY *EATS", 2185.0, 49.5, 43.8),
        L("-$14.60", 2226.2, 861.4, 56.7),
        L("HELP.EXAMPLE.CO 10/18", 2245.5, 47.0, 50.2),
        L("S44460", 2285.5, 891.9, 29.6),
        L("Pay&Transfer", 2414.3, 334.1, 34.8),
        L("Accounts", 2415.6, 75.0, 34.8),
        L("DepositChecks", 2415.6, 621.3, 34.8),
        L("Invest", 2416.9, 985.9, 32.2),
    ]


def boa_deals_list_scrolled() -> list[Line]:
    """The same list as `boa_deals_list`, scrolled so one row overlaps it.

    Two transactions are shared with `boa_deals_list` (23.00 and 14.60) and one
    (`-$20.78`) is only in this screenshot. This is the cross-image duplicate
    case: the same money in two overlapping screenshots.
    """

    return [
        L("6:15", 59.3, 124.5, 55.4),
        L("ProvidedbyBankofAmerica", 498.6, 731.8, 34.8),
        L("Oct19,2026", 588.8, 47.0, 38.6),
        L("Zelle payment to", 637.7, 47.0, 54.1),
        L("-$23.00", 650.6, 852.5, 55.4),
        L("PAYEE NAME Conf#", 699.6, 49.5, 46.4),
        L("$421.69", 711.1, 899.5, 39.9),
        L("a1b2c3d4e", 754.9, 43.2, 60.6),
        L("Oct 19, 2026", 887.6, 45.7, 42.5),
        L("FOOD DELIVERY *EATS", 941.8, 48.3, 42.5),
        L("-$14.60", 984.3, 863.9, 52.8),
        L("HELP.EXAMPLE.CO 10/18", 999.7, 45.7, 52.8),
        L("$444.69", 1038.4, 889.3, 47.7),
        L("PURCHASE XXX-", 1064.1, 49.5, 42.5),
        L("XX28996 CA", 1122.1, 48.3, 46.4),
        L("Oct19,2026", 1250.9, 47.0, 38.6),
        L("BURGER 21823", 1302.5, 48.3, 46.4),
        L("-$20.78", 1316.6, 860.1, 51.5),
        L("10/17 PURCHASE", 1363.0, 47.0, 49.0),
        L("$459.29", 1374.6, 894.4, 39.9),
        L("ANYTOWN CA", 1424.9, 49.5, 43.8),
        L("BKOFAMERICAATM", 2215.9, 48.3, 45.1),
        L("Pay&Transfer", 2414.3, 334.1, 34.8),
    ]


def bank_single_detail() -> list[Line]:
    """The real BOA `Transaction Details` shape (labels above *or* beside values).

    Geometry copied from the 2026-10-20 BOA detail screenshot; merchant and
    account replaced with placeholders. The Description field carries `10/16`,
    which must **not** become the transaction date.
    """

    return [
        L("6:15 m", 61.8, 125.8, 52.8),
        L("Transaction Details", 204.8, 373.5, 46.4),
        L("Merchant Name", 390.4, 48.3, 46.4),
        L("BURGER PLACE", 447.0, 45.7, 38.6),
        L("-$44.76", 561.7, 942.7, 56.7),
        L("Amount", 568.1, 48.3, 49.0),
        L("10/19/2026", 698.3, 871.5, 56.7),
        L("Transaction date", 702.1, 49.5, 46.4),
        L("Type", 842.6, 44.5, 60.6),
        L("Mobile Payment", 847.7, 767.4, 47.7),
        L("Online Purchase", 975.2, 49.5, 50.2),
        L("Transaction category", 1107.9, 47.0, 58.0),
        L("Restaurants&Dining:Restaurants/Dining", 1168.5, 47.0, 42.5),
        L("Description", 1289.6, 48.3, 51.5),
        L("BURGERPLACE2182310/16PURCHASEANYTOWNCA", 1350.1, 45.7, 37.4),
        L("View more information", 1470.0, 49.5, 46.4),
        L("DISPUTETRANSACTION", 1615.5, 336.7, 41.2),
    ]


def bank_transfer_confirmation() -> list[Line]:
    """The real BOA `Your payment is sent` shape.

    Geometry copied from the 2026-10-20 BOA transfer screenshot; the payee's
    name, email and the account tail are replaced with placeholders. The funding
    account's last digits must not end up in `account`.
    """

    return [
        L("6:03", 60.6, 155.0, 54.1),
        L("Success", 203.6, 490.4, 52.8),
        L("Your payment is sent", 542.4, 261.7, 70.9),
        L("TransactiondatesarebasedonEasternTime", 631.3, 147.4, 41.2),
        L("Print or Save", 800.0, 855.0, 51.5),
        L("To", 928.9, 43.2, 54.1),
        L("PAYEE NAME", 928.9, 726.7, 47.7),
        L("EnrolledasPAYEENAME", 1035.8, 594.6, 38.6),
        L("Adv SafeBalance Banking-", 1151.7, 513.3, 63.1),
        L("From", 1154.3, 43.2, 59.3),
        L("0000", 1216.2, 1010.0, 52.8),
        L("$23.00", 1352.7, 965.6, 52.8),
        L("Amount", 1356.6, 48.3, 47.7),
        L("Oct 18,2026", 1486.7, 836.0, 55.4),
        L("Date", 1488.0, 45.7, 51.5),
        L("a1b2c3d4e", 1616.8, 918.6, 63.1),
        L("Confirmation", 1622.0, 49.5, 47.7),
        L("Number", 1681.2, 45.7, 49.0),
        L("DONE", 2326.7, 526.0, 45.1),
    ]


def wechat_bill_cards() -> list[Line]:
    """The real WeChat bill-card shape (2 cards), geometry from the samples.

    Geometry copied from the 2026-10-20 WeChat card screenshots; merchant names
    are placeholders. The date is a header *above* the card, the merchant is the
    card's own title and `使用零钱支付` names the account. The third date header
    at the bottom has no card under it and must yield nothing.
    """

    return [
        L("6:14 m", 59.3, 123.2, 56.7),
        L("微信支付", 199.7, 484.1, 58.0),
        L("10月12日晚上9:04", 356.9, 402.7, 46.4),
        L("某某云费用账户-移动支付", 510.2, 208.4, 46.4),
        L("使用零钱支付", 744.6, 456.1, 47.7),
        L("¥120.00", 856.7, 369.7, 104.4),
        L("账单详情>", 1031.9, 481.5, 47.7),
        L("10月13日下午5:20", 1285.7, 404.0, 49.0),
        L("某某智能科技", 1439.0, 205.8, 47.7),
        L("使用零钱支付", 1674.8, 454.8, 47.7),
        L("￥50.00", 1784.3, 396.4, 110.8),
        L("账单详情>", 1962.1, 481.5, 47.7),
        L("10月13日晚上7:08", 2218.5, 407.8, 42.5),
        L("优惠", 2343.4, 960.5, 54.1),
        L("我的账单", 2346.0, 231.2, 49.0),
        L("支付服务", 2346.0, 576.8, 49.0),
    ]


def wechat_bill_cards_with_daily_report() -> list[Line]:
    """One card plus WeChat's 记账日报 summary block.

    Geometry copied from the 2026-10-20 WeChat screenshot that contains the
    daily report; the merchant is a placeholder. The block prints `￥40.00，共1笔`
    and a bare `￥40.00` - money-shaped numbers that are statistics, not
    transactions, so the whole block has to go.
    """

    return [
        L("6:15 m", 61.8, 125.8, 52.8),
        L("微信支付", 199.7, 484.1, 58.0),
        L("星期三下午6:34", 338.8, 434.5, 42.5),
        L("某某游戏平台", 487.0, 205.8, 50.2),
        L("某游戏", 490.8, 109.3, 43.8),
        L("使用零钱支付", 721.5, 454.8, 54.1),
        L("¥316.86", 836.1, 371.0, 106.9),
        L("账单详情>", 1012.6, 481.5, 47.7),
        L("星期三晚上7:08", 1269.0, 435.8, 42.5),
        L("微信记账本", 1414.6, 213.4, 51.5),
        L("记账日报", 1600.1, 118.2, 56.7),
        L("10月14日（周三）日报", 1676.1, 119.4, 46.4),
        L("昨日支出", 1786.9, 119.4, 49.0),
        L("￥50.00，共1笔", 1788.2, 369.7, 47.7),
        L("昨日入账", 1877.1, 119.4, 49.0),
        L("￥40.00，共1笔", 1878.4, 369.7, 47.7),
        L("本月统计", 1967.2, 119.4, 49.0),
        L("10月已支出￥230.10，已入账", 1969.8, 371.0, 46.4),
        L("￥40.00", 2021.4, 367.2, 47.7),
        L("点击查看昨日收支明细，还能补充其他收支", 2115.4, 124.5, 42.5),
        L("优惠", 2342.1, 959.2, 56.7),
        L("我的账单", 2346.0, 231.2, 49.0),
        L("支付服务", 2346.0, 576.8, 49.0),
    ]


def wechat_bill_home_list() -> list[Line]:
    """The real WeChat 账单 home shape: rows, no platform word anywhere.

    Geometry copied from the 2026-10-20 WeChat 全部列表 screenshot; counterparties
    are placeholders. The page never prints 微信; it prints 全部账单 / 查找交易 /
    收支统计 and a month header whose summary line
    (`支出￥546.96收入￥180.00`) is not a row.
    """

    return [
        L("6:13", 60.6, 123.2, 55.4),
        L("账单", 197.1, 531.1, 61.8),
        L("收支统计>", 368.5, 924.9, 51.5),
        L("全部账单", 369.7, 80.0, 49.0),
        L("查找交易", 371.0, 467.5, 49.0),
        L("2026年10月", 557.8, 48.3, 51.5),
        L("支出￥546.96收入￥180.00", 561.7, 573.0, 42.5),
        L("+140.00", 727.9, 947.8, 54.1),
        L("转账-来自张三", 729.2, 240.1, 51.5),
        L("10月15日19:04", 811.6, 238.8, 42.5),
        L("某某游戏平台", 970.1, 242.7, 51.5),
        L("-316.86", 971.4, 947.8, 49.0),
        L("10月14日18:34", 1053.8, 241.4, 38.6),
        L("+40.00", 1207.1, 968.1, 55.4),
        L("转账-来自李四", 1209.7, 240.1, 51.5),
        L("10月14日08:59", 1292.2, 240.1, 42.5),
    ]


def alipay_bill_with_relative_dates() -> list[Line]:
    """The real Alipay list shape: summary on top, right-aligned amounts, relative dates.

    Geometry copied from the 2026-10-20 Alipay screenshot; merchant names are
    placeholders. Three numbers on the page are **not** transactions: the month
    summary's `￥0.00` / `￥2,631.78` (left-aligned, under their labels) and the
    「收支分析」button. One row carries only a status (`已报销`).
    """

    return [
        L("6:14", 60.6, 130.9, 54.1),
        L("搜索交易记录", 206.1, 219.8, 47.7),
        L("全部", 338.8, 71.1, 58.0),
        L("支出", 338.8, 257.9, 58.0),
        L("收入", 338.8, 445.9, 58.0),
        L("转账", 340.1, 634.0, 56.7),
        L("退款", 338.8, 823.3, 58.0),
        L("筛选", 341.4, 996.1, 52.8),
        L("10月", 496.0, 75.0, 109.5),
        L("支出", 617.1, 83.9, 49.0),
        L("收入", 618.4, 477.7, 47.7),
        L("￥0.00", 673.8, 473.9, 52.8),
        L("￥ 2,631.78", 676.4, 81.3, 51.5),
        L("收支分析", 769.1, 912.2, 45.1),
        L("本月已省1.04元", 788.4, 87.7, 42.5),
        L("这笔账单已经报销了", 931.4, 252.8, 50.2),
        L("报销详情", 932.7, 912.2, 45.1),
        L("限时福利", 935.3, 86.4, 39.9),
        # --- row 1: full date, reimbursed
        L("1.00", 1050.0, 982.1, 51.5),
        L("某应用商店订阅；10.17购买", 1056.4, 202.0, 49.0),
        L("已报销1.00元", 1138.9, 872.8, 43.8),
        L("2026-10-1717:35:20", 1142.7, 203.3, 34.8),
        # --- row 2: relative day, no status
        L("某大模型服务(abc*******", 1297.3, 205.8, 50.2),
        L("-50.00", 1298.6, 946.5, 49.0),
        L("教育培训", 1381.1, 204.5, 45.1),
        L("今天20:53", 1454.5, 205.8, 47.7),
        # --- row 3: month-day glued to the clock
        L("-6.00", 1614.2, 975.7, 58.0),
        L("某应用商店订阅", 1624.6, 208.4, 42.5),
        L("文化休闲", 1700.6, 203.3, 45.1),
        L("自动扣款成功", 1705.7, 879.2, 42.5),
        L("10-1823:58", 1780.4, 205.8, 38.6),
        # --- row 4
        L("-198.00", 1936.3, 923.6, 56.7),
        L("某应用商店订阅", 1944.1, 205.8, 46.4),
        L("文化休闲", 2022.6, 205.8, 45.1),
        L("自动扣款成功", 2025.2, 879.2, 42.5),
        L("10-1819:56", 2101.2, 205.8, 38.6),
        # --- row 5
        L("-1.00", 2258.4, 984.6, 55.4),
        L("某应用商店订阅", 2262.3, 205.8, 49.0),
        L("文化休闲", 2343.4, 204.5, 45.1),
        L("自动扣款成功", 2346.0, 880.4, 45.1),
        L("10-1717:35", 2422.0, 207.1, 38.6),
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


# --- 美团 / 京东 / 淘宝 (2026-10-21, three platforms × list + detail) ----------
#
# Geometry (tops, lefts, heights) is copied from the six real screenshots; the
# **content is synthetic**: shop names are public brand names, and every amount,
# personal name, phone number, address and order number below is made up
# ("示例/0000", 7.40 / 12.30 …). No line of a real screenshot is reproduced here.
# What is faithful is the OCR *shape* - including the recogniser's own mistakes
# (`下单：2026-09-0217:56` with the space dropped, `09.211` where `09.21 |` was
# printed), because those are what the rules have to survive.


def meituan_order_list() -> list[Line]:
    """美团外卖订单列表: 4 cards, one of them a voucher, one with the banner on top.

    Traps this fixture carries:
      * the first card is a 充电宝 rental with **no shop row** - its title is the
        only thing naming the order;
      * `完成` / `共2件` / `使用时长：73分钟` are not amounts and not dates;
      * the fourth card's header is covered by the system's
        `开启通知，及时获取订单进度` banner, so its status is not readable.
    """

    return [
        L("6:17", 61.8, 161.4, 51.5),
        L("Q搜索我的订单", 213.9, 170.2, 46.4),
        L("筛选", 247.4, 954.1, 38.6),
        L("发票", 247.4, 1072.3, 38.6),
        # Status filter chips: page chrome, not an order. 美团 glues two together.
        L("全部", 344.0, 44.5, 58.0),
        L("待付款", 344.0, 221.1, 54.1),
        L("待收货/待使用", 342.7, 444.7, 54.1),
        L("评价", 342.7, 820.7, 56.7),
        L("退款/售后", 345.3, 999.9, 52.8),
        # --- card 1: a rental, no shop row
        L("充电宝", 484.4, 134.7, 61.8),
        L("已完成", 488.3, 991.0, 54.1),
        L("2026-09-13 18:45:25", 627.4, 302.4, 45.1),
        L("￥7.40", 666.1, 988.4, 54.1),
        L("使用时长：73分钟", 697.0, 303.6, 46.4),
        L("更多", 865.7, 57.2, 51.5),
        L("再来一单", 867.0, 909.7, 49.0),
        # --- card 2: drinks, the date is printed *below* the amount
        L("爷爷不泡茶(济南高新万达店）>", 1042.2, 139.8, 54.1),
        L("已完成", 1043.5, 992.2, 54.1),
        L("[冷]", 1149.2, 230.0, 25.8),
        L("￥12.30", 1230.3, 965.6, 52.8),
        L("共2件", 1296.0, 1010.0, 46.4),
        L("马蹄爆爆珠", 1382.4, 310.0, 46.4),
        L("香椰芒果...", 1384.9, 75.0, 43.8),
        L("下单：2026-09-0217:56", 1472.5, 62.3, 42.5),
        L("更多", 1596.2, 55.9, 52.8),
        L("领神券", 1596.2, 655.6, 54.1),
        L("再来一单", 1598.8, 909.7, 49.0),
        # --- card 3
        L("大师卤肉饭(济南高新万达店）>", 1776.6, 137.2, 50.2),
        L("已完成", 1776.6, 992.2, 54.1),
        L("软骨卤肉", 1887.4, 223.6, 105.6),
        L("大师软骨卤肉拌饭", 1919.6, 303.6, 46.4),
        L("￥18.6", 1953.1, 984.6, 54.1),
        L("下单：2026-09-0119:51", 1987.9, 306.2, 38.6),
        L("领神券", 2148.9, 654.3, 56.7),
        L("更多", 2151.5, 57.2, 52.8),
        L("再来一单", 2154.0, 909.7, 49.0),
        # --- card 4: a voucher order with the same amount and minute as card 3
        L("【神抢手】大师卤肉饭外卖兑换券", 2330.5, 142.3, 50.2),
        L("去开启", 2380.8, 860.1, 46.4),
        L("开启通知，及时获取订单进度", 2382.1, 82.6, 42.5),
        L("骨卤肉", 2455.5, 224.9, 88.9),
        L("大师软骨卤肉拌饭·1张", 2455.5, 304.9, 36.1),
        L("下单：2026-09-0119:51", 2508.3, 307.5, 39.9),
        L("￥18.6", 2509.6, 985.9, 45.1),
    ]


def meituan_order_detail() -> list[Line]:
    """美团外卖订单详情: one order, `合计￥12.30`, **no date anywhere**.

    Traps:
      * the address row names a hotel, so it ends in `店` and would win the
        merchant field if addresses were not excluded;
      * `配送骑手/支付方式等` is a *collapsed* row: the payment method is not on
        screen and must not be invented;
      * the bottom ad (`再省一单！` + `低至5折起`) carries money-shaped numbers.
    """

    return [
        L("6:18", 61.8, 160.1, 51.5),
        L("订单已完成", 284.7, 64.8, 78.6),
        L("感谢您对美团外卖的信任，请节约用餐，美味不浪费。", 395.5, 66.1, 38.6),
        L("准时宝：保障已结束>", 508.9, 118.2, 38.6),
        L("更多", 637.7, 57.2, 47.7),
        L("联系商家", 639.0, 681.0, 47.7),
        L("打赏骑手", 640.3, 434.5, 43.8),
        L("再来一单", 639.0, 926.2, 47.7),
        L("订单信息", 836.1, 58.4, 52.8),
        L("配送地址 示例大厦（某市示例路1号） (5楼511房间)", 955.9, 59.7, 46.4),
        L("王**(先生）138****0000", 1013.9, 255.4, 50.2),
        L("申请开票", 1124.7, 942.7, 47.7),
        L("发票信息您暂未添加发票信息", 1126.0, 59.7, 49.0),
        L("配送骑手/支付方式等", 1235.5, 397.7, 34.8),
        L("商品费用", 1397.8, 59.7, 52.8),
        L("进商家粉丝群", 1513.8, 862.7, 38.6),
        L("爷爷不泡茶（济南高新万达店）>", 1515.0, 62.3, 37.4),
        L("合计￥12.30", 1641.3, 869.0, 54.1),
        L("共2件", 1650.3, 329.1, 46.4),
        L("费用明细√", 1785.6, 498.0, 39.9),
        L("再省一单！", 1985.3, 55.9, 123.7),
        L("热卖好物低至5折起", 2150.2, 115.6, 46.4),
        L("水果饮料零食全都有", 2309.9, 410.4, 46.4),
        L("等餐顺手买", 2387.2, 425.6, 39.9),
        L("最快30分钟送达", 2449.1, 425.6, 38.6),
        L("限时特惠", 2526.4, 665.7, 28.3),
    ]


def jd_order_list() -> list[Line]:
    """京东订单列表: 3 cards, **no date printed on any of them**.

    Traps:
      * the right side of every header is a grey `完成` chip (the recogniser reads
        it without the `已`), which must not be turned into a status;
      * `京东服务 为爱机添加一份保障…` is an ad row inside the first card;
      * `共1件` / `共2件` are counts, and the third card's `外卖` is a badge.
    """

    return [
        L("6:20", 58.0, 153.7, 58.0),
        L("搜索我的订单", 217.7, 240.1, 43.8),
        L("全部", 344.0, 54.6, 67.0),
        L("购物", 347.8, 263.0, 61.8),
        L("秒送外卖", 345.3, 463.7, 64.4),
        L("服务", 350.4, 771.2, 56.7),
        L("健康", 354.3, 891.9, 43.8),
        L("待付款", 475.4, 64.8, 54.1),
        L("待收货", 474.1, 296.0, 54.1),
        L("待使用", 474.1, 528.5, 54.1),
        L("已完成", 475.4, 762.3, 54.1),
        L("待", 472.8, 989.7, 56.7),
        L("筛选", 505.0, 1073.6, 42.5),
        # --- card 1
        L("自营", 641.6, 54.6, 42.5),
        L("前行者（EWEADN）京东自营旗舰店>", 640.3, 142.3, 46.4),
        L("完成", 640.3, 1049.4, 49.0),
        L("前行者", 734.3, 55.9, 21.9),
        L("V102三模版", 760.1, 66.1, 18.0),
        L("前行者（EWEADN）V102Ultra", 766.5, 313.8, 42.5),
        L("￥328.00", 780.7, 957.9, 56.7),
        L("白色等高线【三模/RGB】标准版", 828.4, 315.1, 37.4),
        L("共1件", 856.7, 1022.7, 50.2),
        L("支持7天无理由退货7天价保", 892.8, 311.3, 37.4),
        L("去查看>", 1026.8, 957.9, 43.8),
        L("京东服务", 1030.6, 78.8, 39.9),
        L("为爱机添加一份保障，京东延保限时领取", 1030.6, 223.6, 38.6),
        L("更多", 1159.5, 45.7, 52.8),
        L("卖了换钱", 1162.1, 371.0, 49.0),
        L("退换/售后", 1160.8, 631.4, 52.8),
        L("再次购买", 1158.2, 917.3, 55.4),
        # --- card 2
        L("完成", 1365.6, 1049.4, 49.0),
        L("优品数码专营店>", 1368.2, 52.1, 46.4),
        L("笔记本", 1462.2, 58.4, 32.2),
        L("烧烤支架", 1488.0, 58.4, 30.9),
        L("olevo笔记本烧烤架游戏本散热", 1494.4, 313.8, 38.6),
        L("￥64.50", 1509.9, 970.6, 54.1),
        L("电脑烧烤支架【黑色】43cm*28cm*6", 1553.7, 312.5, 39.9),
        L("共1件", 1585.9, 1024.0, 46.4),
        L("支持7天无理由退货", 1620.7, 312.5, 34.8),
        L("更多", 1753.4, 44.5, 55.4),
        L("卖了换钱", 1757.2, 371.0, 49.0),
        L("退换/售后", 1757.2, 632.7, 49.0),
        L("再次购买", 1756.0, 918.6, 52.8),
        # --- card 3
        L("塔斯汀·中国汉堡（望京街店）>", 1960.8, 138.5, 50.2),
        L("完成", 1962.1, 1049.4, 49.0),
        L("外卖", 1964.7, 53.4, 41.2),
        L("￥9.90", 2103.8, 980.8, 56.7),
        L("共2件", 2179.8, 1018.9, 50.2),
        L("中国汉堡", 2252.0, 63.5, 27.1),
        L("更多", 2349.9, 44.5, 55.4),
        L("查看发票", 2349.9, 367.2, 55.4),
        L("退换/售后", 2351.2, 631.4, 52.8),
        L("再次购买", 2353.7, 919.8, 49.0),
    ]


def jd_order_detail() -> list[Line]:
    """京东订单详情: `实付款` row carrying `共减￥16.50合计￥64.50`.

    Traps:
      * the original price `￥79.9` and the discount `共减￥16.50` are on the same
        screen as the paid total;
      * `①到手￥64.50` repeats the total inside a sentence;
      * `20京豆` / `PLUS会员·领10元无门槛红包` / `企业新客9000元` are ad numbers;
      * the order number is 17 digits and must not be read as a date or an amount.
    """

    return [
        L("6:20", 61.8, 157.5, 51.5),
        L("完成", 195.8, 564.1, 70.9),
        L("优品数码专营店", 355.6, 53.4, 47.7),
        L("进店>", 353.0, 989.7, 50.2),
        L("①到手￥64.50", 449.6, 849.9, 55.4),
        L("笔记本", 456.1, 57.2, 39.9),
        L("olevo笔记本烧烤架...", 456.1, 341.8, 46.4),
        L("烧烤支架", 485.7, 58.4, 34.8),
        L("￥79.9", 517.9, 1020.2, 45.1),
        L("数量×1，电脑烧烤支架", 529.5, 340.5, 38.6),
        L("支持7天无理由退货", 605.5, 340.5, 38.6),
        L("20京豆", 718.9, 250.3, 39.9),
        L("评价晒单", 765.3, 185.5, 47.7),
        L("送朋友", 762.7, 432.0, 49.0),
        L("卖了换钱", 766.5, 696.2, 43.8),
        L("申请售后", 766.5, 942.7, 45.1),
        L("实付款", 881.2, 47.0, 54.1),
        L("共减￥16.50合计￥64.50>", 882.5, 607.3, 50.2),
        L("订单编号", 979.1, 48.3, 47.7),
        L("00000000000000000复制", 976.5, 613.6, 50.2),
        L("支付方式", 1068.0, 47.0, 55.4),
        L("微信支付>", 1070.6, 913.5, 51.5),
        L("全部订单信息", 1172.4, 438.3, 50.2),
        L("快速解决问题", 1355.3, 52.1, 51.5),
        L("商品降价怎么办", 1489.3, 102.9, 46.4),
        L("怎么申请售后", 1488.0, 562.8, 47.7),
        L("更多", 1485.4, 980.8, 52.8),
        L("店铺客服", 1615.5, 531.1, 49.0),
        L("PLUS", 1795.9, 50.8, 36.1),
        L("PLUS会员·领10元无门槛红包", 1788.2, 125.8, 50.2),
        L("去看看>", 1793.3, 966.8, 45.1),
        L("购物再享折上95折", 1877.1, 49.5, 42.5),
        L("专属权益", 2034.2, 36.8, 56.7),
        L("京东企业会员", 2154.0, 162.6, 50.2),
        L("企业新客9000元限...", 2246.8, 76.2, 38.6),
        L("您的订单专属权益>", 2246.8, 641.6, 38.6),
        L("更多", 2376.9, 33.0, 56.7),
        L("查看物流", 2380.8, 382.4, 49.0),
        L("退换/售后", 2378.2, 645.4, 54.1),
        L("再次购买", 2379.5, 935.1, 51.5),
    ]


def taobao_order_list() -> list[Line]:
    """淘宝/天猫订单列表: 2 full cards + a third one cut off by the screen bottom.

    Traps, both of them dates that are **not** the order date:
      * card 1 prints a promo window `限时补款：2026年9月20日-2026…`;
      * card 2 prints a shipping promise `预售，7月18日09:27前发货`;
      * the order date is the `09.21` next to `实付款` (the recogniser turns the
        `|` separator into a digit: `09.211`);
      * card 1 is closed *and* refunded (`交易关闭` + `退款成功 支付宝 ￥168.00`).
    """

    return [
        L("6:20", 61.8, 157.5, 51.5),
        L("搜索订单", 203.6, 243.9, 55.4),
        L("AI助手", 244.8, 705.1, 36.1),
        L("筛选", 243.5, 834.7, 38.6),
        L("管理", 242.2, 963.0, 42.5),
        L("全部", 333.7, 85.1, 58.0),
        L("购物", 333.7, 265.5, 58.0),
        L("闪购", 333.7, 452.3, 56.7),
        L("飞猪", 332.4, 630.2, 61.8),
        L("全部订单", 463.8, 82.6, 49.0),
        L("待付款", 461.2, 341.8, 54.1),
        L("待发货", 459.9, 560.3, 54.1),
        L("待收货", 461.2, 780.1, 54.1),
        L("退款/售后", 463.8, 1004.9, 49.0),
        L("闪购暂无进行中的订单", 605.5, 73.7, 47.7),
        L("查看全部>", 605.5, 899.5, 47.7),
        # --- card 1: paid, refunded, then closed
        L("天猫原神旗舰店>", 785.9, 48.3, 51.5),
        L("交易关闭", 785.9, 950.3, 52.8),
        L("【原神官方/尾款】哥伦比娅·嘉年", 883.8, 374.8, 42.5),
        L("￥168", 883.8, 1021.5, 45.1),
        L("限时补款：2026年9月20日-2026...", 958.5, 368.4, 37.4),
        L("×1", 962.4, 1086.3, 36.1),
        L("不支持7天无理由假一赔四", 1024.2, 371.0, 37.4),
        L("）退款成功支付宝￥168.00", 1105.4, 404.0, 42.5),
        L("实付款￥168", 1203.3, 877.9, 51.5),
        L("09.211", 1211.0, 745.8, 39.9),
        L("更多", 1315.4, 44.5, 56.7),
        L("申请开票", 1320.5, 398.9, 49.0),
        L("加入购物车", 1321.8, 641.6, 47.7),
        L("再买一单", 1319.2, 923.6, 51.5),
        # --- card 2: paid, waiting to ship
        L("天猫原神旗舰店>", 1497.0, 48.3, 51.5),
        L("待发货", 1499.6, 996.1, 50.2),
        L("【原神官方/定金】纳西妲·白草净", 1596.2, 372.2, 42.5),
        L("￥128", 1596.2, 1031.6, 46.4),
        L("点击则同意定金发特典，定金须先确...", 1672.2, 371.0, 37.4),
        L("x1", 1673.5, 1083.7, 41.2),
        L("不支持7天无理由假一赔四", 1736.6, 369.7, 38.6),
        L("1件赠品", 1929.9, 45.7, 52.8),
        L("待发货", 2065.2, 144.8, 45.1),
        L("预售，7月18日09:27前发货", 2066.4, 316.3, 42.5),
        L("实付款￥128", 2178.5, 890.6, 52.8),
        L("09.21", 2186.3, 753.4, 39.9),
        L("申请开票", 2291.9, 396.4, 55.4),
        L("更多", 2293.2, 45.7, 52.8),
        L("催发货", 2294.5, 681.0, 50.2),
        L("修改地址", 2295.8, 926.2, 47.7),
        # --- card 3: only the header is on screen
        L("天猫原神旗舰店>", 2473.5, 47.0, 51.5),
        L("待发货", 2474.8, 994.8, 50.2),
    ]


def taobao_order_detail() -> list[Line]:
    """淘宝/天猫交易关闭详情: one order that never became a payment.

    Traps:
      * `交易关闭` + `超时关闭`: the amount (`应付款￥66.5`) is real but the money
        most likely never moved, so the direction is unknown, not expense;
      * the shop's own promises (`平均22小时退款` / `极速退款`) contain the word
        退款 but are not a refund;
      * the only date is inside a sentence: `凭据：6月25日下单交易快照`.
    """

    return [
        L("6:21", 58.0, 157.5, 58.0),
        L("交易关闭", 204.8, 462.5, 65.7),
        L("超时关闭", 288.6, 505.6, 49.0),
        L("示例路1号2单元301室", 416.1, 141.0, 42.5),
        L("王先生 138-138****0000", 489.6, 133.4, 45.1),
        L("号码保护中", 493.4, 608.6, 41.2),
        L("boxkok旗舰店", 655.7, 186.8, 47.7),
        L("进店逛逛>", 682.8, 919.8, 51.5),
        L("好评率89%，平均22小时退款", 721.5, 188.0, 38.6),
        L("定制亚克力高底台展示盒适用...√￥66.5", 838.7, 337.9, 49.0),
        L("30cm;30cm;30cm", 912.1, 340.5, 38.6),
        L("X1", 912.1, 1088.8, 38.6),
        L("假一赔四极速退款7天无理由退换>", 974.0, 339.2, 38.6),
        L("实付价￥66.5", 1041.0, 337.9, 47.7),
        L("买后必看", 1149.2, 134.7, 43.8),
        L("顶盖卡扣怎么合更严密", 1149.2, 287.1, 42.5),
        L("去看看", 1147.9, 937.6, 45.1),
        L("加入购物车", 1294.7, 898.2, 47.7),
        L("应付款", 1426.2, 47.0, 61.8),
        L("￥66.5", 1417.1, 895.7, 70.9),
        L("订单信息共5项", 1592.3, 52.1, 46.4),
        L("0000000000000000000|复制", 1591.1, 569.2, 42.5),
        L("订单保障", 1713.4, 48.3, 47.7),
        L("共3项", 1718.6, 212.2, 39.9),
        L("凭据：6月25日下单交易快照>", 1717.3, 560.3, 42.5),
        L("HeyDolls", 1864.2, 457.4, 34.8),
        L("国家自然博物馆", 1910.6, 786.4, 29.6),
        L("删除订单", 2340.9, 330.3, 47.7),
        L("加入购物车", 2340.9, 604.7, 47.7),
        L("再买一单", 2340.9, 921.1, 49.0),
        L("客服", 2378.2, 39.4, 42.5),
    ]
