"""The OCR sidecar.

A long-lived process that reads one JSON request per line on stdin and writes
one JSON response per line on stdout. Node starts it on the first recognition
request rather than at boot, and then talks to it for the life of the server.

Three decisions worth stating.

**Long-lived, not one process per request.** Loading the models takes about two
seconds. Per-request processes would add that to every recognition, turning a
1.5-second feature into a 3.5-second one for no benefit.

**stdin/stdout, not HTTP.** A local HTTP service would need a port, and a port
needs deciding who may reach it. A pipe has no address, so there is nothing to
expose and nothing to authenticate.

**Base64 in the message, never a file path.** The images are payment
screenshots. They are decoded in memory, recognised, and dropped. Nothing is
written to disk at any point, so there is no temporary file to clean up, no
backup that quietly keeps a copy, and no path to get wrong.

Protocol, one JSON object per line:

    -> {"id": "1", "image": "<base64>", "image_index": 0}
    <- {"id": "1", "ok": true, "draft": {...}, "page_type": "...",
        "candidates": [...], "lines": 19, "seconds": 1.2}

**The old per-image fields stay.** `draft` is still what the single-entry screen
reads, and a response that only had a `draft` is still valid (S15-B adds fields;
it does not replace the S5 contract). The new fields answer a different question:
*how many transactions does this screenshot contain?* `page_type` says what the
page looks like, `candidates` carries every transaction cut out of it, and
`requires_user_choice` says the count must be decided by the user. This is
deliberately **not** a batch endpoint: one request still recognises one image, so
the API keeps its existing upload loop and the client keeps assembling the batch.

On startup it prints {"ready": true} so the caller knows the models are loaded
rather than guessing with a sleep.
"""

from __future__ import annotations

import base64
import binascii
import io
import json
import sys
import time
import traceback
from dataclasses import asdict
from datetime import date
from typing import Sequence

from PIL import Image, UnidentifiedImageError
from rapidocr_onnxruntime import RapidOCR

from extract import Line, extract, to_lines
from layouts import classify
from multi_extract import extract_page

# Refuse anything unreasonable before decoding it. The API enforces this too;
# both ends check because either could be called by something else one day.
MAX_IMAGE_BYTES = 10 * 1024 * 1024


def describe_page(
    lines: Sequence[Line],
    *,
    image_index: int = 0,
    reference_year: int | None = None,
    reference_date: str | None = None,
) -> dict:
    """Classify one page and cut its transactions out. Pure: no OCR, no I/O.

    Kept separate from `recognise` so the protocol shape can be tested without
    loading the models, and so the API's contract is decided in one place rather
    than assembled from `classify`/`extract_page` at the call site.

    `reference_date` is the day the screenshots were taken. It is the only input
    that turns `今天 20:53` or `星期三 下午6:34` into a calendar date; callers that
    do not know it still get every printed date, and a relative one stays
    unresolved (and flagged) rather than being guessed.
    """

    classification = classify(lines)
    extraction = extract_page(
        lines,
        classification,
        image_index=image_index,
        reference_year=reference_year,
        reference_date=reference_date,
    )

    return {
        "image_index": image_index,
        "page_type": classification.page_type,
        "page_type_label": classification.page_type_label,
        "layout_id": classification.layout_id,
        "layout_label": classification.layout_label,
        "platform": classification.platform,
        "verified": classification.verified,
        "confidence": round(classification.confidence, 3),
        "requires_user_choice": extraction.requires_user_choice,
        "candidates": [candidate.to_dict() for candidate in extraction.candidates],
        "warnings": list(extraction.warnings),
    }


def recognise(
    engine: RapidOCR,
    payload: str,
    *,
    image_index: int = 0,
    reference_date: str | None = None,
) -> dict:
    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError):
        return {"ok": False, "error": "image_not_base64", "message": "图片数据无法解码。"}

    if len(raw) > MAX_IMAGE_BYTES:
        return {"ok": False, "error": "image_too_large", "message": "图片超过 10MB。"}

    # Open through Pillow rather than handing the recogniser raw bytes: it gives
    # a clear failure for a file that is not an image at all, and normalises
    # modes the recogniser would otherwise have to guess at.
    try:
        with Image.open(io.BytesIO(raw)) as image:
            image.load()
            converted = image.convert("RGB")
    except (UnidentifiedImageError, OSError):
        return {"ok": False, "error": "not_an_image", "message": "这不是一张图片。"}

    started = time.perf_counter()
    result, _ = engine(converted)
    elapsed = time.perf_counter() - started

    lines = to_lines(result or [])
    draft = extract(lines)

    # The day the screenshots were taken. The service cannot ask the browser —
    # and must not delay recognition to do so — so it uses the machine's date.
    # A server in a different timezone can make a `今天` row land a day off; the
    # candidate keeps `relative_date` as a visible issue, and the overview lets
    # the user correct the date before anything is written.
    taken_on = reference_date or date.today().isoformat()
    taken_on_year = _year_of(taken_on)
    year = taken_on_year if taken_on_year is not None else date.today().year

    page = describe_page(
        lines,
        image_index=image_index,
        reference_year=year,
        reference_date=taken_on,
    )

    scores = [line.score for line in lines]

    return {
        "ok": True,
        "draft": asdict(draft),
        **page,
        "lineCount": len(lines),
        "averageConfidence": round(sum(scores) / len(scores), 4) if scores else 0.0,
        "seconds": round(elapsed, 3),
    }


def _year_of(value: str) -> int | None:
    """The year of a `YYYY-MM-DD` string, or None when it is not that shape."""

    try:
        return date.fromisoformat(value).year
    except ValueError:
        return None


def main() -> None:
    engine = RapidOCR()

    # Tell the caller the models are loaded. Without this the caller has to
    # sleep and hope, which is either too slow or occasionally too fast.
    print(json.dumps({"ready": True}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if line == "":
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            print(json.dumps({"ok": False, "error": "bad_request", "message": "请求不是有效 JSON。"}), flush=True)
            continue

        request_id = request.get("id")

        # The upload position, so two screenshots' candidates cannot share an id
        # (`img0-1`). The API sends it; a bare request still works and is image 0.
        raw_index = request.get("image_index", 0)
        image_index = raw_index if isinstance(raw_index, int) and raw_index >= 0 else 0

        try:
            response = recognise(
                engine,
                request.get("image", ""),
                image_index=image_index,
            )
        except Exception:  # noqa: BLE001 - the service must not die on one bad image
            response = {
                "ok": False,
                "error": "recognition_failed",
                "message": "识别过程出错。",
                "detail": traceback.format_exc(limit=3),
            }

        response["id"] = request_id
        print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
