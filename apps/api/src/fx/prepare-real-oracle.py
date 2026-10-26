"""独立 Decimal 参照：只读已下载公开响应，不联网，不用生产数据。"""
import csv
import io
import json
from decimal import Decimal, ROUND_HALF_UP, getcontext
from pathlib import Path

getcontext().prec = 80
directory = Path(__file__).parent / "fixtures" / "live-20261026"
capture = json.loads((directory / "requests.json").read_text(encoding="utf-8"))
records = {row["name"]: row for row in capture["records"]}
currencies = ["CNY", "USD", "EUR", "JPY", "HKD", "GBP"]
def body(name):
    return json.loads(records[name]["body"], parse_float=Decimal)
def latest(name):
    rows = body(name)
    day = max(row["date"] for row in rows)
    return day, {"EUR": Decimal(1), **{row["quote"]: Decimal(row["rate"]) for row in rows if row["date"] == day}}

expected = []
for name, date in [("weekday", "2024-05-15"), ("early", "1999-01-04"), ("adapter-recent", "2026-10-23")]:
    actual, rates = latest(name)
    for source in currencies:
        for target in currencies:
            amount = 12345
            value = None
            if source == target:
                value = amount
            elif source in rates and target in rates:
                exponent = (0 if target == "JPY" else 2) - (0 if source == "JPY" else 2)
                value = int((Decimal(amount) * rates[target] / rates[source] * Decimal(10) ** exponent).quantize(Decimal(1), rounding=ROUND_HALF_UP))
            expected.append({"sample": name, "date": date, "rateDate": actual, "source": source, "target": target, "minor": amount, "expectedMinor": str(value) if value is not None else None})

_, rates = latest("weekday")
official = {row["CURRENCY"]: Decimal(row["OBS_VALUE"]) for row in csv.DictReader(io.StringIO(records["ecb-official"]["body"]))}
assert all(rates[currency] == rate for currency, rate in official.items())
assert all(rates[currency] == Decimal(rate) for currency, rate in body("v1")["rates"].items())
comparisons = []
for row in body("usd-base"):
    quote = row["quote"]
    derived = rates[quote] / rates["USD"]
    published = Decimal(row["rate"])
    tolerance = Decimal(10) ** published.as_tuple().exponent / 2
    difference = abs(derived - published)
    assert difference <= tolerance
    comparisons.append({"quote": quote, "derived": str(derived), "directApi": str(published), "absoluteDifference": str(difference), "halfPublishedUnit": str(tolerance)})

max_adjacent_ratio = Decimal(1)
for name in ["weekday", "weekend", "holiday", "adapter-recent"]:
    previous = {}
    for row in sorted(body(name), key=lambda r: (r["date"], r["quote"])):
        rate = Decimal(row["rate"])
        if row["quote"] in previous:
            old = previous[row["quote"]]
            max_adjacent_ratio = max(max_adjacent_ratio, rate / old, old / rate)
        previous[row["quote"]] = rate
output = {"method": "Python Decimal precision=80, ROUND_HALF_UP; EUR reference bridge; no double arithmetic", "officialAndV1Match": True, "sampleMaxAdjacentRatio": str(max_adjacent_ratio), "usdBaseComparisons": comparisons, "cases": expected}
(directory / "oracle.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"独立 Decimal 校验 {len(expected)} 组；ECB 原始 CSV 与 v1 完全一致；USD 基准差异均在上游报价舍入范围内")
