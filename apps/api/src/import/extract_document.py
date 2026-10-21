"""本机内存解析；不写磁盘，不记录原文。JSON 仅通过进程管道返回 API。"""
import io
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta

MAX_BYTES = 10 * 1024 * 1024
MAX_EXPANDED = 40 * 1024 * 1024
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def xml(data):
    if b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper():
        raise ValueError("unsafe_xml")
    return ET.fromstring(data)


def xlsx(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        infos = archive.infolist()
        if len(infos) > 256 or sum(i.file_size for i in infos) > MAX_EXPANDED:
            raise ValueError("document_limit")
        if len(set(i.filename for i in infos)) != len(infos):
            raise ValueError("unsafe_zip")
        for i in infos:
            if i.flag_bits & 1 or i.file_size > 20 * 1024 * 1024 or i.file_size > max(1, i.compress_size) * 200:
                raise ValueError("document_limit")
        names = set(archive.namelist())
        if "xl/workbook.xml" not in names:
            raise ValueError("unsupported_format")
        workbook = xml(archive.read("xl/workbook.xml"))
        props = workbook.find("s:workbookPr", NS)
        date1904 = props is not None and props.get("date1904") in ("1", "true")
        strings = []
        if "xl/sharedStrings.xml" in names:
            root = xml(archive.read("xl/sharedStrings.xml"))
            strings = ["".join(n.itertext()) for n in root.findall("s:si", NS)]
        date_styles = set()
        if "xl/styles.xml" in names:
            root = xml(archive.read("xl/styles.xml"))
            formats = {int(n.get("numFmtId")): n.get("formatCode", "") for n in root.findall("s:numFmts/s:numFmt", NS)}
            for idx, n in enumerate(root.findall("s:cellXfs/s:xf", NS)):
                fmt = int(n.get("numFmtId", "0"))
                code = re.sub(r'"[^"]*"|\[[^\]]*\]|\\.', '', formats.get(fmt, "")).lower()
                if fmt in range(14, 23) or fmt in range(45, 48) or re.search(r"[ydhs]", code):
                    date_styles.add(idx)
        sheets = []
        for name in sorted(n for n in names if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n)):
            rows = []
            root = xml(archive.read(name))
            for row in root.findall("s:sheetData/s:row", NS):
                if len(rows) > 20200:
                    raise ValueError("document_limit")
                cells = []
                for cell in row.findall("s:c", NS):
                    ref = cell.get("r", "")
                    letters = re.match(r"[A-Z]+", ref)
                    if not letters:
                        raise ValueError("invalid_xlsx")
                    col = 0
                    for c in letters.group():
                        col = col * 26 + ord(c) - 64
                    if col > 100:
                        raise ValueError("document_limit")
                    while len(cells) < col:
                        cells.append("")
                    if cell.find("s:f", NS) is not None:
                        raise ValueError("xlsx_formula")
                    value = cell.findtext("s:v", "", NS)
                    kind = cell.get("t", "n")
                    if kind == "s":
                        value = strings[int(value)]
                    elif kind == "inlineStr":
                        value = "".join(cell.find("s:is", NS).itertext())
                    elif kind == "e":
                        raise ValueError("invalid_xlsx")
                    elif value and kind == "n" and int(cell.get("s", "0")) in date_styles:
                        serial = float(value)
                        if serial < 1 or serial > 100000:
                            raise ValueError("invalid_date")
                        base = datetime(1904, 1, 1) if date1904 else datetime(1899, 12, 30)
                        value = (base + timedelta(seconds=round(serial * 86400))).strftime("%Y-%m-%d %H:%M:%S")
                    # Numeric order IDs are not converted to float, preserving the XML literal.
                    if len(value) > 10000:
                        raise ValueError("document_limit")
                    cells[col - 1] = value
                rows.append({"line": int(row.get("r", len(rows) + 1)), "cells": cells})
            sheets.append(rows)
        return {"sheets": sheets}


def pdf(data):
    from pypdf import PdfReader
    from pdfminer.high_level import extract_pages
    from pdfminer.layout import LTTextContainer, LTTextLine
    reader = PdfReader(io.BytesIO(data), strict=True)
    if reader.is_encrypted:
        raise ValueError("encrypted_pdf")
    if len(reader.pages) > 30:
        raise ValueError("document_limit")
    pages = []
    size = 0
    for layout in extract_pages(io.BytesIO(data)):
        pieces = []
        for container in layout:
            if isinstance(container, LTTextContainer):
                for line in container:
                    if isinstance(line, LTTextLine):
                        value = line.get_text().strip()
                        size += len(value)
                        if size > 2000000:
                            raise ValueError("document_limit")
                        pieces.append((round(line.y0, 1), line.x0, value))
        # Column boxes become a single visual row; date / description / amount remain ordered.
        groups = []
        for y, x, value in sorted(pieces, key=lambda p: (-p[0], p[1])):
            group = next((g for g in groups[-3:] if abs(g[0] - y) < 2.5), None)
            if group is None:
                group = [y, []]
                groups.append(group)
            group[1].append((x, value))
        pages.append(["  ".join(v for _, v in sorted(g[1])) for g in groups])
    if sum(len(s) for page in pages for s in page) < 40:
        raise ValueError("scanned_pdf")
    return {"pages": pages}


try:
    data = sys.stdin.buffer.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("document_limit")
    result = pdf(data) if data.startswith(b"%PDF-") else xlsx(data)
    sys.stdout.write(json.dumps(result, ensure_ascii=True))
except Exception as error:
    # Never include exception text from third-party libraries: it may contain document bytes.
    safe = str(error) if type(error) is ValueError else "document_invalid"
    allowed = {"document_limit", "unsafe_xml", "unsafe_zip", "unsupported_format", "invalid_xlsx", "xlsx_formula", "invalid_date", "encrypted_pdf", "scanned_pdf"}
    sys.stdout.write(json.dumps({"error": safe if safe in allowed else "document_invalid"}))
    sys.exit(1)
