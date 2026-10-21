"""本机内存解析文档；不写磁盘，不记录原文，JSON 仅通过进程管道返回 API。

只使用 Python 标准库：生产环境没有 pypdf/pdfminer（也不允许为导入临时安装网络依赖），
所以 PDF 文本层由本文件内的最小解析器读取（zlib 解压 + 对象/内容流/ToUnicode）。
输出带坐标，让 TypeScript 端的账单状态机可以区分「首列日期 / 中间描述 / 末列金额」。
"""
import base64
import io
import json
import re
import sys
import zipfile
import zlib
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta

MAX_BYTES = 10 * 1024 * 1024
MAX_EXPANDED = 40 * 1024 * 1024
MAX_TEXT = 2_000_000
MAX_PAGES = 30
MAX_OBJECTS = 4000
MAX_STREAM = 8 * 1024 * 1024
MAX_ROWS = 20200
MAX_COLUMNS = 100
MAX_CELL = 10000
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def xml(data):
    # 外部文件不能带 DTD：实体展开是压缩炸弹之外的另一种内存放大方式。
    if b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper():
        raise ValueError("unsafe_xml")
    return ET.fromstring(data)


def _sheet_targets(archive, names):
    """返回 [(sheet 名, zip 内路径)]；名称来自 workbook.xml，路径来自关系文件。"""
    workbook = xml(archive.read("xl/workbook.xml"))
    relationships = {}
    if "xl/_rels/workbook.xml.rels" in names:
        rels = xml(archive.read("xl/_rels/workbook.xml.rels"))
        for rel in rels:
            rid = rel.get("Id")
            target = rel.get("Target", "")
            if not rid or not target:
                continue
            target = target.lstrip("/")
            if not target.startswith("xl/"):
                target = "xl/" + target
            relationships[rid] = target
    sheets = []
    for sheet in workbook.findall("s:sheets/s:sheet", NS):
        name = sheet.get("name") or f"Sheet{len(sheets) + 1}"
        rid = sheet.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
        target = relationships.get(rid or "")
        if target in names:
            sheets.append((name, target))
    if not sheets:
        # 关系文件损坏时仍按工作表顺序解析；交易识别只看内容，不依赖名字。
        sheets = [
            (f"Sheet{index + 1}", name)
            for index, name in enumerate(sorted(n for n in names if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n)))
        ]
    return sheets


def xlsx(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        infos = archive.infolist()
        if len(infos) > 256 or sum(i.file_size for i in infos) > MAX_EXPANDED:
            raise ValueError("document_limit")
        if len(set(i.filename for i in infos)) != len(infos):
            raise ValueError("unsafe_zip")
        for info in infos:
            if info.flag_bits & 1 or info.file_size > 20 * 1024 * 1024:
                raise ValueError("document_limit")
            if info.file_size > max(1, info.compress_size) * 200:
                raise ValueError("document_limit")
        names = set(archive.namelist())
        if "xl/workbook.xml" not in names:
            raise ValueError("unsupported_format")
        book = xml(archive.read("xl/workbook.xml"))
        props = book.find("s:workbookPr", NS)
        date1904 = props is not None and props.get("date1904") in ("1", "true")

        strings = []
        if "xl/sharedStrings.xml" in names:
            root = xml(archive.read("xl/sharedStrings.xml"))
            for item in root.findall("s:si", NS):
                # 富文本被拆成多个 <t>，拼起来才是单元格真实内容。
                value = "".join(item.itertext())
                if len(value) > MAX_CELL:
                    raise ValueError("document_limit")
                strings.append(value)
            if len(strings) > 200000:
                raise ValueError("document_limit")

        date_styles = set()
        if "xl/styles.xml" in names:
            root = xml(archive.read("xl/styles.xml"))
            formats = {
                int(node.get("numFmtId")): node.get("formatCode", "")
                for node in root.findall("s:numFmts/s:numFmt", NS)
            }
            for index, node in enumerate(root.findall("s:cellXfs/s:xf", NS)):
                fmt = int(node.get("numFmtId", "0"))
                code = re.sub(r'"[^"]*"|\[[^\]]*\]|\\.', "", formats.get(fmt, "")).lower()
                # Excel 内置日期格式 + 自定义格式里的 y/d/h/s；只看样式，不看单元格文本。
                if fmt in range(14, 23) or fmt in range(45, 48) or re.search(r"[ydhs]", code):
                    date_styles.add(index)

        sheets = []
        for name, path in _sheet_targets(archive, names):
            rows = []
            root = xml(archive.read(path))
            for row in root.findall("s:sheetData/s:row", NS):
                if len(rows) >= MAX_ROWS:
                    raise ValueError("document_limit")
                cells = []
                for cell in row.findall("s:c", NS):
                    letters = re.match(r"[A-Z]+", cell.get("r", ""))
                    if not letters:
                        raise ValueError("invalid_xlsx")
                    column = 0
                    for char in letters.group():
                        column = column * 26 + ord(char) - 64
                    if column > MAX_COLUMNS:
                        raise ValueError("document_limit")
                    while len(cells) < column:
                        cells.append("")
                    if cell.find("s:f", NS) is not None:
                        raise ValueError("xlsx_formula")
                    value = cell.findtext("s:v", "", NS)
                    kind = cell.get("t", "n")
                    if kind == "s":
                        try:
                            value = strings[int(value)]
                        except (ValueError, IndexError):
                            raise ValueError("invalid_xlsx")
                    elif kind == "inlineStr":
                        inline = cell.find("s:is", NS)
                        value = "".join(inline.itertext()) if inline is not None else ""
                    elif kind == "e":
                        raise ValueError("invalid_xlsx")
                    elif kind == "d" and value:
                        # t="d" 是 Excel 2010 之后的 ISO 日期字面量，直接保留日期时间。
                        value = value.replace("T", " ").split(".")[0]
                    elif value and kind == "n" and int(cell.get("s", "0")) in date_styles:
                        serial = float(value)
                        if serial < 1 or serial > 100000:
                            raise ValueError("invalid_date")
                        base = datetime(1904, 1, 1) if date1904 else datetime(1899, 12, 30)
                        value = (base + timedelta(seconds=round(serial * 86400))).strftime("%Y-%m-%d %H:%M:%S")
                    # 数字形式的交易单号保留 XML 原文，不经过 float（39 位会丢精度）。
                    if len(value) > MAX_CELL:
                        raise ValueError("document_limit")
                    cells[column - 1] = value
                rows.append({"line": int(row.get("r", len(rows) + 1)), "cells": cells})
            sheets.append({"name": name, "rows": rows})
        return {"format": "xlsx", "sheets": sheets}


# ---------------------------------------------------------------------------
# PDF：标准库最小解析器
# ---------------------------------------------------------------------------

OBJ_RE = re.compile(rb"(?<![0-9])(\d+)\s+(\d+)\s+obj\b")
REF_RE = re.compile(rb"(\d+)\s+0\s+R")
WHITE = b"\x00\t\n\x0c\r "
DELIM = b"()<>[]{}/%"


def _find_dict_end(data, start):
    depth = 0
    index = data.find(b"<<", start)
    if index < 0:
        return -1
    while index < len(data) - 1:
        if data[index:index + 2] == b"<<":
            depth += 1
            index += 2
        elif data[index:index + 2] == b">>":
            depth -= 1
            index += 2
            if depth == 0:
                return index
        else:
            index += 1
    return -1


def _dict_value(head, key):
    """取 /Key 后的原始值；只做“够用”的单层扫描，不做完整 PDF 对象模型。"""
    match = re.search(rb"/" + key + rb"(?![A-Za-z0-9])\s*", head)
    if not match:
        return None
    rest = head[match.end():]
    if rest.startswith(b"<<"):
        end = _find_dict_end(rest, 0)
        return rest[:end] if end > 0 else rest
    if rest.startswith(b"["):
        depth = 0
        for index, char in enumerate(rest):
            if char == 0x5B:
                depth += 1
            elif char == 0x5D:
                depth -= 1
                if depth == 0:
                    return rest[:index + 1]
        return rest
    if rest.startswith(b"("):
        depth = 0
        index = 0
        while index < len(rest):
            if rest[index] == 0x5C:
                index += 2
                continue
            if rest[index] == 0x28:
                depth += 1
            elif rest[index] == 0x29:
                depth -= 1
                if depth == 0:
                    return rest[:index + 1]
            index += 1
        return rest
    if rest.startswith(b"/"):
        return re.match(rb"/[^\s/<>\[\]]+", rest).group()
    reference = re.match(rb"\d+\s+\d+\s+R", rest)
    if reference:
        return reference.group()
    return re.match(rb"[^\s/>\]\[<]+", rest).group()


def _load_objects(data):
    objects = {}
    position = 0
    while True:
        match = OBJ_RE.search(data, position)
        if not match:
            break
        number = int(match.group(1))
        start = match.end()
        dict_end = _find_dict_end(data, start)
        if dict_end < 0:
            break
        head = data[start:dict_end + 2]
        length = None
        direct = re.search(rb"/Length\s+(\d+)(?!\s+\d+\s+R)", head)
        if direct:
            length = int(direct.group(1))
        stream_match = re.match(rb"\s*stream\r?\n", data[dict_end:dict_end + 40])
        if stream_match:
            stream_start = dict_end + stream_match.end()
            stream_end = stream_start + length if length is not None else data.find(b"endstream", stream_start)
            if stream_end < stream_start:
                stream_end = stream_start
            objects[number] = (head, data[stream_start:stream_end])
            end = data.find(b"endobj", stream_end)
            position = end + 6 if end > 0 else stream_end
        else:
            objects[number] = (head, None)
            end = data.find(b"endobj", start)
            position = end + 6 if end > 0 else start + 1
        if len(objects) > MAX_OBJECTS:
            raise ValueError("document_limit")
    return objects


def _expand_object_streams(objects):
    """把 /ObjStm 内含的字体、页面对象取出来；不少导出的 PDF 只有这种压缩对象。"""
    for _, (head, stream) in list(objects.items()):
        if stream is None or b"/ObjStm" not in head:
            continue
        raw = _decode_stream(head, stream)
        count = _dict_value(head, b"N")
        first = _dict_value(head, b"First")
        if not count or not first:
            continue
        try:
            count_value = int(count)
            first_value = int(first)
        except ValueError:
            continue
        header = raw[:first_value].split()
        if len(header) < count_value * 2:
            continue
        for index in range(count_value):
            try:
                number = int(header[index * 2])
                offset = int(header[index * 2 + 1])
            except (ValueError, IndexError):
                continue
            relative = offset + first_value
            end = len(raw)
            for later in range(index + 1, count_value):
                try:
                    end = min(end, int(header[later * 2 + 1]) + first_value)
                except (ValueError, IndexError):
                    pass
            fragment = raw[relative:end].strip()
            if number not in objects and fragment.startswith(b"<<"):
                close = _find_dict_end(fragment, 0)
                objects[number] = (fragment[:close] if close > 0 else fragment, None)


def _decode_stream(head, raw):
    filters = _dict_value(head, b"Filter") or b""
    names = re.findall(rb"/([A-Za-z0-9]+)", filters)
    if not names:
        output = raw
    else:
        output = raw
        for name in names:
            if name == b"FlateDecode":
                try:
                    output = zlib.decompress(output)
                except zlib.error:
                    try:
                        output = zlib.decompressobj().decompress(output)
                    except zlib.error:
                        return b""
            elif name == b"ASCII85Decode":
                try:
                    output = base64.a85decode(output, adobe=output.lstrip().startswith(b"<~"))
                except (ValueError, TypeError):
                    return b""
            elif name == b"ASCIIHexDecode":
                try:
                    output = bytes.fromhex(re.sub(rb"[^0-9A-Fa-f]", b"", output.split(b">")[0]).decode())
                except ValueError:
                    return b""
            else:
                return b""
    if len(output) > MAX_STREAM:
        output = output[:MAX_STREAM]
    return output


def _parse_unicode_cmap(text):
    mapping = {}
    for block in re.findall(rb"beginbfchar(.*?)endbfchar", text, re.S):
        for source, target in re.findall(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", block):
            try:
                mapping[bytes.fromhex(source.decode())] = bytes.fromhex(target.decode()).decode("utf-16-be", "ignore")
            except ValueError:
                continue
    for block in re.findall(rb"beginbfrange(.*?)endbfrange", text, re.S):
        for low, high, target in re.findall(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", block):
            try:
                low_value = int(low, 16)
                high_value = int(high, 16)
                base = int(target, 16)
                width = len(bytes.fromhex(low.decode()))
            except ValueError:
                continue
            for offset, code in enumerate(range(low_value, high_value + 1)):
                if offset > 65535:
                    break
                mapping[code.to_bytes(width, "big")] = chr(base + offset)
        for low, high, array in re.findall(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[(.*?)\]", block, re.S):
            try:
                low_value = int(low, 16)
                high_value = int(high, 16)
                width = len(bytes.fromhex(low.decode()))
            except ValueError:
                continue
            items = re.findall(rb"<([0-9A-Fa-f]+)>", array)
            for offset, code in enumerate(range(low_value, high_value + 1)):
                if offset >= len(items):
                    break
                try:
                    mapping[code.to_bytes(width, "big")] = bytes.fromhex(items[offset].decode()).decode("utf-16-be", "ignore")
                except ValueError:
                    continue
    return mapping


GLYPHS = {
    b"space": " ", b"hyphen": "-", b"period": ".", b"comma": ",", b"slash": "/", b"parenleft": "(",
    b"parenright": ")", b"dollar": "$", b"numbersign": "#", b"percent": "%", b"ampersand": "&",
    b"apostrophe": "'", b"quotedbl": '"', b"colon": ":", b"semicolon": ";", b"question": "?",
    b"endash": "\u2013", b"emdash": "\u2014", b"bullet": "\u2022", b"zero": "0", b"one": "1",
    b"two": "2", b"three": "3", b"four": "4", b"five": "5", b"six": "6", b"seven": "7",
    b"eight": "8", b"nine": "9", b"at": "@", b"plus": "+", b"equal": "=", b"underscore": "_",
}


def _glyph_name_to_text(name):
    if name in GLYPHS:
        return GLYPHS[name]
    if name.startswith(b"uni") and len(name) >= 7:
        try:
            return chr(int(name[3:7], 16))
        except ValueError:
            return ""
    if len(name) == 1:
        return name.decode("latin-1")
    return ""


def _resolve(objects, value):
    """把 `/Resources 7 0 R` 这类间接引用换成对象头。"""
    if not value:
        return None
    reference = REF_RE.match(value.strip())
    if reference:
        target = objects.get(int(reference.group(1)))
        return target[0] if target else None
    return value


def _font_decoder(objects, number):
    target = objects.get(number)
    if not target:
        return None
    head = target[0]
    cmap = {}
    unicode_ref = re.search(rb"/ToUnicode\s+(\d+)\s+0\s+R", head)
    if unicode_ref:
        unicode_target = objects.get(int(unicode_ref.group(1)))
        if unicode_target and unicode_target[1] is not None:
            cmap = _parse_unicode_cmap(_decode_stream(unicode_target[0], unicode_target[1]))
    differences = {}
    encoding = _resolve(objects, _dict_value(head, b"Encoding"))
    if encoding and b"/Differences" in encoding:
        tokens = re.findall(rb"(\d+)|/([^\s/\[\]]+)", encoding[encoding.find(b"/Differences") + 12:])
        code = None
        for number_token, name in tokens:
            if number_token:
                code = int(number_token)
            elif name is not None and code is not None:
                differences[bytes([code])] = _glyph_name_to_text(name)
                code += 1
    subtype = _dict_value(head, b"Subtype") or b""
    return {
        "cmap": cmap,
        "differences": differences,
        "two_byte": b"Type0" in subtype,
    }


def _decode_text(raw, font):
    if font is None:
        return raw.decode("latin-1")
    cmap = font["cmap"]
    if cmap:
        size = 2 if font["two_byte"] else min(len(key) for key in cmap)
        output = []
        for index in range(0, len(raw) - size + 1, size):
            key = raw[index:index + size]
            output.append(cmap.get(key, font["differences"].get(key, "")))
        return "".join(output)
    output = []
    for byte in raw:
        key = bytes([byte])
        output.append(font["differences"].get(key, key.decode("latin-1")))
    return "".join(output)


def _tokens(data):
    index = 0
    length = len(data)
    while index < length:
        char = data[index]
        if char in WHITE:
            index += 1
            continue
        if char == 0x25:
            end = data.find(b"\n", index)
            index = length if end < 0 else end + 1
            continue
        if char == 0x28:
            depth = 1
            index += 1
            buffer = bytearray()
            while index < length and depth:
                current = data[index]
                if current == 0x5C:
                    index += 1
                    if index >= length:
                        break
                    escaped = data[index]
                    mapping = {0x6E: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12}
                    if escaped in mapping:
                        buffer.append(mapping[escaped])
                    elif escaped in b"()\\":
                        buffer.append(escaped)
                    elif 0x30 <= escaped <= 0x37:
                        digits = bytes([escaped])
                        for _ in range(2):
                            if index + 1 < length and 0x30 <= data[index + 1] <= 0x37:
                                index += 1
                                digits += bytes([data[index]])
                        buffer.append(int(digits, 8) & 0xFF)
                    elif escaped in (0x0A, 0x0D):
                        if escaped == 0x0D and index + 1 < length and data[index + 1] == 0x0A:
                            index += 1
                    else:
                        buffer.append(escaped)
                    index += 1
                    continue
                if current == 0x28:
                    depth += 1
                elif current == 0x29:
                    depth -= 1
                    if depth == 0:
                        index += 1
                        break
                buffer.append(current)
                index += 1
            yield ("str", bytes(buffer))
            continue
        if char == 0x3C:
            if data[index:index + 2] == b"<<":
                yield ("<<", b"")
                index += 2
                continue
            end = data.find(b">", index + 1)
            if end < 0:
                break
            hex_text = re.sub(rb"[^0-9A-Fa-f]", b"", data[index + 1:end])
            if len(hex_text) % 2:
                hex_text += b"0"
            try:
                yield ("str", bytes.fromhex(hex_text.decode()))
            except ValueError:
                yield ("str", b"")
            index = end + 1
            continue
        if char == 0x3E:
            if data[index:index + 2] == b">>":
                yield (">>", b"")
                index += 2
                continue
            index += 1
            continue
        if char in b"[]{}":
            yield (chr(char), b"")
            index += 1
            continue
        if char == 0x2F:
            end = index + 1
            while end < length and data[end] not in WHITE and data[end] not in DELIM:
                end += 1
            yield ("name", data[index + 1:end])
            index = end
            continue
        end = index
        while end < length and data[end] not in WHITE and data[end] not in DELIM:
            end += 1
        word = data[index:end]
        try:
            yield ("num", float(word))
        except ValueError:
            yield ("op", word)
        index = end


def _multiply(left, right):
    return [
        left[0] * right[0] + left[1] * right[2],
        left[0] * right[1] + left[1] * right[3],
        left[2] * right[0] + left[3] * right[2],
        left[2] * right[1] + left[3] * right[3],
        left[4] * right[0] + left[5] * right[2] + right[4],
        left[4] * right[1] + left[5] * right[3] + right[5],
    ]


def _page_pieces(page_head, inherited_resources, objects):
    contents = []
    for reference in REF_RE.findall(_dict_value(page_head, b"Contents") or b""):
        target = objects.get(int(reference))
        if target and target[1] is not None:
            contents.append(_decode_stream(target[0], target[1]))
    content = b"\n".join(contents)
    resources = _resolve(objects, _dict_value(page_head, b"Resources")) or inherited_resources
    fonts = {}
    if resources:
        font_dict = _dict_value(resources, b"Font")
        if font_dict:
            for name, reference in re.findall(rb"/([^\s/<>\[\]]+)\s+(\d+)\s+0\s+R", font_dict):
                fonts[name] = _font_decoder(objects, int(reference))

    pieces = []
    stack = []
    ctm = [1, 0, 0, 1, 0, 0]
    saved = []
    text_matrix = [1, 0, 0, 1, 0, 0]
    line_matrix = [1, 0, 0, 1, 0, 0]
    leading = 0.0
    font = None
    size = 12.0

    def show(raw):
        nonlocal text_matrix
        text = _decode_text(raw, font)
        if text:
            matrix = _multiply(text_matrix, ctm)
            pieces.append((round(matrix[5], 2), round(matrix[4], 2), text, abs(size * ctm[3]) or 10.0))
        # 字体宽度表没有解析；按字符数推进，足够把同一行的先后片段排对顺序。
        text_matrix = _multiply([1, 0, 0, 1, len(raw) * size * 0.5, 0], text_matrix)

    for kind, value in _tokens(content):
        if kind in ("num", "str", "name", "<<", ">>", "[", "]"):
            stack.append((kind, value))
            continue
        if kind != "op":
            continue
        operator = value
        if operator == b"q":
            saved.append((list(ctm), leading))
        elif operator == b"Q":
            if saved:
                ctm, leading = saved.pop()
        elif operator == b"cm" and len(stack) >= 6:
            ctm = _multiply([entry[1] for entry in stack[-6:]], ctm)
        elif operator == b"BT":
            text_matrix = [1, 0, 0, 1, 0, 0]
            line_matrix = [1, 0, 0, 1, 0, 0]
        elif operator == b"Tm" and len(stack) >= 6:
            text_matrix = [entry[1] for entry in stack[-6:]]
            line_matrix = list(text_matrix)
        elif operator in (b"Td", b"TD") and len(stack) >= 2:
            tx, ty = stack[-2][1], stack[-1][1]
            if operator == b"TD":
                leading = -ty
            line_matrix = _multiply([1, 0, 0, 1, tx, ty], line_matrix)
            text_matrix = list(line_matrix)
        elif operator == b"T*":
            line_matrix = _multiply([1, 0, 0, 1, 0, -leading], line_matrix)
            text_matrix = list(line_matrix)
        elif operator == b"TL" and stack:
            leading = stack[-1][1]
        elif operator == b"Tf" and len(stack) >= 2:
            font = fonts.get(stack[-2][1])
            size = stack[-1][1]
        elif operator == b"Tj" and stack:
            show(stack[-1][1])
        elif operator == b"TJ" and stack:
            start = next((index for index in range(len(stack) - 1, -1, -1) if stack[index][0] == "["), None)
            if start is not None:
                for entry in stack[start + 1:]:
                    if entry[0] == "str":
                        show(entry[1])
                    elif entry[0] == "num":
                        text_matrix = _multiply([1, 0, 0, 1, -entry[1] / 1000 * size, 0], text_matrix)
                del stack[start:]
        elif operator == b"'" and stack:
            line_matrix = _multiply([1, 0, 0, 1, 0, -leading], line_matrix)
            text_matrix = list(line_matrix)
            show(stack[-1][1])
        elif operator == b'"' and len(stack) >= 3:
            line_matrix = _multiply([1, 0, 0, 1, 0, -leading], line_matrix)
            text_matrix = list(line_matrix)
            show(stack[-1][1])
        arity = {
            b"cm": 6, b"Tm": 6, b"Td": 2, b"TD": 2, b"TL": 1, b"Tf": 2, b"Tj": 1, b"TJ": 1,
            b"'": 1, b'"': 3, b"T*": 0, b"BT": 0, b"ET": 0, b"q": 0, b"Q": 0,
        }.get(operator)
        if arity:
            del stack[-arity:]
    return pieces


def _pages(data, objects):
    page_heads = []
    catalog = None
    for _, (head, _stream) in objects.items():
        if re.search(rb"/Type\s*/Catalog", head):
            catalog = head
            break

    def walk(reference, seen, inherited):
        if reference in seen or len(page_heads) >= MAX_PAGES:
            return
        seen.add(reference)
        target = objects.get(reference)
        if not target:
            return
        head = target[0]
        resources = _resolve(objects, _dict_value(head, b"Resources")) or inherited
        if re.search(rb"/Type\s*/Pages", head):
            for kid in REF_RE.findall(_dict_value(head, b"Kids") or b""):
                walk(int(kid), seen, resources)
        elif re.search(rb"/Type\s*/Page([^s]|$)", head):
            page_heads.append((head, resources))

    if catalog is not None:
        for reference in REF_RE.findall(_dict_value(catalog, b"Pages") or b""):
            walk(int(reference), set(), None)
    if not page_heads:
        for number in sorted(objects):
            head = objects[number][0]
            if re.search(rb"/Type\s*/Page([^s]|$)", head):
                page_heads.append((head, None))
    pages = []
    total = 0
    for head, resources in page_heads[:MAX_PAGES]:
        pieces = _page_pieces(head, resources, objects)
        lines = []
        for y, x, text, size in sorted(pieces, key=lambda item: (-item[0], item[1])):
            tolerance = max(2.0, min(size * 0.6, 6.0))
            group = next((item for item in lines[-3:] if abs(item[0] - y) < tolerance), None)
            if group is None:
                group = [y, []]
                lines.append(group)
            group[1].append((x, text))
            total += len(text)
            if total > MAX_TEXT:
                raise ValueError("document_limit")
        pages.append([
            {"y": group[0], "spans": [{"x": x, "text": value} for x, value in sorted(group[1])]}
            for group in lines
        ])
    if total < 40:
        raise ValueError("scanned_pdf")
    return pages


def pdf(data):
    if re.search(rb"/Encrypt\s+\d+\s+0\s+R", data[:8000]) or re.search(rb"/Encrypt\s*<<", data):
        raise ValueError("encrypted_pdf")
    objects = _load_objects(data)
    _expand_object_streams(objects)
    pages = _pages(data, objects)
    if len(pages) > MAX_PAGES:
        raise ValueError("document_limit")
    return {"format": "pdf", "pages": pages}


def main():
    # Windows 下 Python 管道默认用系统代码页（如 cp936）；统一成 UTF-8，
    # 否则中文单元格会在 stdout 上变成无法解码的字节。
    sys.stdout.reconfigure(encoding="utf-8")
    data = sys.stdin.buffer.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("document_limit")
    if data.startswith(b"%PDF-"):
        result = pdf(data)
    elif data.startswith(b"PK"):
        result = xlsx(data)
    else:
        raise ValueError("unsupported_format")
    sys.stdout.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")))


ALLOWED = {
    "document_limit", "unsafe_xml", "unsafe_zip", "unsupported_format", "invalid_xlsx",
    "xlsx_formula", "invalid_date", "encrypted_pdf", "scanned_pdf",
}

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # 第三方异常文本可能夹带文档字节；只回白名单错误码。
        safe = str(error) if type(error) is ValueError else "document_invalid"
        sys.stdout.write(json.dumps({"error": safe if safe in ALLOWED else "document_invalid"}))
        sys.exit(1)
