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
