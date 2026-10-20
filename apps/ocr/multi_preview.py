"""Preview the S15-B multi-transaction pipeline on image files.

This is a **verification tool for the owner**, not part of the product path:
it runs the real local OCR (RapidOCR) on the images you name, then prints the
page classification and the overview batch. The API still goes through
`service.py` and the existing single-entry flow; batch saving is not wired,
because that boundary is an owner decision (design direction §10.5).

Usage, from `apps/ocr` with the OCR virtualenv:

    python multi_preview.py samples/wechat-pay.png samples/alipay-receive.png
    python multi_preview.py --json samples/*.png

Images are opened in memory only. Nothing is written anywhere, and this script
must never be pointed at a folder of real payment screenshots from the
repository - real screenshots do not belong in the repo at all.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image
from rapidocr_onnxruntime import RapidOCR

from extract import to_lines
from overview import build_overview, describe_overview


def lines_of(engine: RapidOCR, path: Path) -> list:
    with Image.open(path) as image:
        image.load()
        converted = image.convert("RGB")
    result, _ = engine(converted)
    return to_lines(result or [])


def main() -> None:
    # Windows consoles default to a legacy code page; the pipeline prints
    # Chinese and currency marks, so force UTF-8 rather than crash halfway.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="预览 S15-B 多笔识别结果")
    parser.add_argument("images", nargs="+", help="一张或多张截图路径")
    parser.add_argument("--json", action="store_true", help="输出完整 JSON（概览页数据）")
    parser.add_argument(
        "--reference-year",
        type=int,
        default=None,
        help="截图日期缺年份时使用的参考年份（会标记为 year_inferred）",
    )
    args = parser.parse_args()

    engine = RapidOCR()
    pages = []
    for index, raw_path in enumerate(args.images):
        path = Path(raw_path)
        if not path.is_file():
            parser.error(f"找不到图片：{path}")
        pages.append((index, lines_of(engine, path)))

    overview = build_overview(pages, reference_year=args.reference_year)

    if args.json:
        print(json.dumps(overview.to_dict(), ensure_ascii=False, indent=2))
    else:
        print(describe_overview(overview))


if __name__ == "__main__":
    main()
