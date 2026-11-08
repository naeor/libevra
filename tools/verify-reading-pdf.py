"""本地阅读版验证：重新打开、中文与标题、缺字、页面边界；不替代代表页视觉检查。"""
import json
import re
import sys
from pathlib import Path
import pymupdf as fitz

def verify(source, pdf_path):
    src=Path(source).read_text(encoding="utf-8")
    doc=fitz.open(pdf_path)
    if not len(doc): raise ValueError("PDF 没有页面")
    # 页脚不能插入跨页段落中间；正文内容在底部 16 mm 留白以上。
    text="\n".join(p.get_text(clip=fitz.Rect(0,0,p.rect.width,p.rect.height-40)) for p in doc)
    if len(re.findall(r"[\u4e00-\u9fff]",src))>30 and len(re.findall(r"[\u4e00-\u9fff]",text))<30:
        raise ValueError("中文内容未正确提取")
    if "\ufffd" in text: raise ValueError("出现 Unicode 替代字符")
    clean=lambda s:re.sub(r"[^\w]","",s,flags=re.UNICODE)
    plain=clean(text)
    code=False; missing=[]
    for line in src.splitlines():
        if line.lstrip().startswith(("```","~~~")): code=not code;continue
        if code:continue
        m=re.match(r"^#{1,3}\s+(.+)",line)
        if m:
            title=re.sub(r"\[([^\]]+)\]\([^)]+\)",r"\1",m[1]);title=clean(title)
            if title and title not in plain: missing.append(m[1])
    if code: raise ValueError("Markdown 代码围栏未闭合")
    if missing: raise ValueError("标题未完整出现在 PDF："+" / ".join(missing[:4]))
    # 目录中出现标题不代表正文完整，另外检查正文段落的首尾文本。
    code=False; lost=[]
    for line in src.splitlines():
        if line.lstrip().startswith(("```","~~~")): code=not code;continue
        if code or line.lstrip().startswith(("#","|","<!--","![")):continue
        line=re.sub(r"\[([^\]]+)\]\([^)]+\)",r"\1",line)
        value=clean(line.lstrip("> -*0123456789."))
        if len(value)<36:continue
        for fragment in (value[:36],value[-36:]):
            if fragment not in plain:lost.append(fragment)
    if lost:raise ValueError("正文片段未完整提取："+repr(lost[:4]))
    overflow=[]
    for number,page in enumerate(doc,1):
        if not page.get_text().strip():raise ValueError(f"第 {number} 页无文本")
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines",[]):
                for span in line["spans"]:
                    x0,y0,x1,y1=span["bbox"]
                    if x0 < -1 or y0 < -1 or x1 > page.rect.width+1 or y1 > page.rect.height+1:
                        overflow.append((number,span["text"][:30]))
    if overflow:raise ValueError("文本越过页面边界："+repr(overflow[:4]))
    return {"pages":len(doc),"characters":len(text)}

if __name__=="__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(verify(*sys.argv[1:3]),ensure_ascii=False))
