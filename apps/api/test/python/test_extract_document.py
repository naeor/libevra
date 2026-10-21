"""extract_document.py 的合成夹具测试。

真实账单样本绝不进仓库：这里用最小的 XLSX zip 和手写 PDF 内容流，
只验证“格式识别、日期序列、长单号保真、坐标成行、安全限制”这些机制。
"""

from __future__ import annotations

import datetime
import io
import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "src" / "import" / "extract_document.py"

NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def run_extractor(data: bytes) -> tuple[int, dict]:
    result = subprocess.run(
        [sys.executable, str(SCRIPT)],
        input=data,
        capture_output=True,
        check=False,
        timeout=30,
    )
    return result.returncode, json.loads(result.stdout.decode("utf-8"))


def make_xlsx(shared_strings: list[str], sheet_rows: list[str], *, styles: str | None = None,
              shared_extra: str = "") -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "xl/workbook.xml",
            f'<workbook xmlns="{NS}" xmlns:r="{REL_NS}"><sheets>'
            '<sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
        )
        archive.writestr(
            "xl/_rels/workbook.xml.rels",
            f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/>'
            "</Relationships>",
        )
        items = "".join(f"<si><t>{value}</t></si>" for value in shared_strings)
        archive.writestr(
            "xl/sharedStrings.xml",
            f'<sst xmlns="{NS}">{items}{shared_extra}</sst>',
        )
        archive.writestr(
            "xl/worksheets/sheet1.xml",
            f'<worksheet xmlns="{NS}"><sheetData>{"".join(sheet_rows)}</sheetData></worksheet>',
        )
        if styles is not None:
            archive.writestr("xl/styles.xml", f'<styleSheet xmlns="{NS}">{styles}</styleSheet>')
    return buffer.getvalue()


def make_pdf(lines: list[str]) -> bytes:
    """最小的单页 PDF：对象顺序扫描即可解析，不依赖 xref。"""
    content_parts = ["BT", "/F1 12 Tf", "72 720 Td"]
    for index, text in enumerate(lines):
        if index > 0:
            content_parts.append("0 -18 Td")
        content_parts.append(f"({text}) Tj")
    content_parts.append("ET")
    content = ("\n".join(content_parts) + "\n").encode("latin-1")

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length " + str(len(content)).encode("ascii") + b" >>\nstream\n" + content + b"endstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    output = bytearray(b"%PDF-1.4\n")
    for index, body in enumerate(objects, start=1):
        output.extend(f"{index} 0 obj\n".encode("ascii"))
        output.extend(body)
        output.extend(b"\nendobj\n")
    output.extend(b"trailer\n<< /Root 1 0 R >>\n%%EOF\n")
    return bytes(output)


DATE_STYLES = (
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm:ss"/></numFmts>'
    '<cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs>'
)


class PdfExtractionTest(unittest.TestCase):
    def test_text_layer_is_grouped_into_lines(self) -> None:
        code, payload = run_extractor(
            make_pdf([
                "Statement line one for testing",
                "Second line here for testing",
            ])
        )
        self.assertEqual(code, 0)
        self.assertEqual(payload["format"], "pdf")
        self.assertEqual(len(payload["pages"]), 1)
        lines = payload["pages"][0]
        self.assertEqual(len(lines), 2)
        self.assertEqual(lines[0]["spans"][0]["text"], "Statement line one for testing")
        self.assertEqual(lines[1]["spans"][0]["text"], "Second line here for testing")
        self.assertEqual(lines[0]["spans"][0]["x"], 72)
        self.assertLess(lines[1]["y"], lines[0]["y"])

    def test_pdf_without_text_is_reported_as_scanned(self) -> None:
        code, payload = run_extractor(make_pdf([""]))
        self.assertEqual(code, 1)
        self.assertEqual(payload["error"], "scanned_pdf")

    def test_encrypted_pdf_is_rejected(self) -> None:
        data = make_pdf(["Statement line one for testing"])
        data = data.replace(b"trailer", b"/Encrypt 9 0 R\ntrailer", 1)
        code, payload = run_extractor(data)
        self.assertEqual(code, 1)
        self.assertEqual(payload["error"], "encrypted_pdf")

    def test_unsupported_binary_is_rejected_without_leaking_bytes(self) -> None:
        code, payload = run_extractor(b"GIF89a secret document bytes")
        self.assertEqual(code, 1)
        self.assertEqual(payload["error"], "unsupported_format")


class XlsxExtractionTest(unittest.TestCase):
    def test_date_serial_and_long_order_number(self) -> None:
        serial = (
            datetime.datetime(2026, 9, 22, 12, 0)
            - datetime.datetime(1899, 12, 30)
        ).total_seconds() / 86400
        long_order = "4200000000000000000000000000000000001234"
        data = make_xlsx(
            ["交易时间", "收/支", "金额(元)", "交易单号", "支出", long_order],
            [
                '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c>'
                '<c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>',
                f'<row r="2"><c r="A2" s="1"><v>{serial}</v></c><c r="B2" t="s"><v>4</v></c>'
                f'<c r="C2"><v>18</v></c><c r="D2" t="s"><v>5</v></c></row>',
            ],
            styles=DATE_STYLES,
        )
        code, payload = run_extractor(data)
        self.assertEqual(code, 0)
        self.assertEqual(payload["format"], "xlsx")
        self.assertEqual(payload["sheets"][0]["name"], "Sheet1")
        rows = payload["sheets"][0]["rows"]
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[1]["cells"][0], "2026-09-22 12:00:00")
        self.assertEqual(rows[1]["cells"][3], long_order)
        self.assertEqual(rows[1]["cells"][2], "18")

    def test_doctype_in_shared_strings_is_refused(self) -> None:
        data = make_xlsx(
            [],
            ['<row r="1"><c r="A1" t="s"><v>0</v></c></row>'],
            shared_extra='<!DOCTYPE foo [<!ENTITY x "y">]><si><t>&x;</t></si>',
        )
        code, payload = run_extractor(data)
        self.assertEqual(code, 1)
        self.assertEqual(payload["error"], "unsafe_xml")

    def test_formula_cell_is_refused(self) -> None:
        data = make_xlsx(
            ["金额"],
            [
                '<row r="1"><c r="A1" t="s"><v>0</v></c></row>',
                '<row r="2"><c r="A2"><f>1+1</f><v>2</v></c></row>',
            ],
        )
        code, payload = run_extractor(data)
        self.assertEqual(code, 1)
        self.assertEqual(payload["error"], "xlsx_formula")

    def test_zip_without_workbook_is_unsupported(self) -> None:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("random.txt", "hello")
        code, payload = run_extractor(buffer.getvalue())
        self.assertEqual(code, 1)
        self.assertEqual(payload["error"], "unsupported_format")


class InputLimitTest(unittest.TestCase):
    def test_oversized_input_is_refused_before_parsing(self) -> None:
        code, payload = run_extractor(b"%PDF-" + b"0" * (10 * 1024 * 1024 + 1))
        self.assertEqual(code, 1)
        self.assertEqual(payload["error"], "document_limit")


if __name__ == "__main__":
    unittest.main()
