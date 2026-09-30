# -*- coding: utf-8 -*-
"""PDF -> Markdown：用 PyMuPDF 提取文本/标题/表格/图片，并保留页码与坐标。"""
import os
import re
from dataclasses import dataclass, field, asdict
from collections import Counter

import fitz  # PyMuPDF


@dataclass
class Block:
    """一个内容块（段落/标题/表格/图片），带定位信息。"""
    type: str              # heading / paragraph / table / image
    text: str
    page: int              # pdf 0-based 页索引
    printed_page: int      # 印刷页码
    section: str = ""      # 所属章节（暂空，chunk 阶段再填充）
    level: int = 0         # 标题层级，非标题为 0
    bbox: list = field(default_factory=list)
    confidence: float = 0.0  # OCR 置信度，文本解析默认 0


def _printed_page(text: str, page_idx: int) -> int:
    """从页文本里取首个独立数字作为印刷页码，取不到则退回 page_idx+1。"""
    for line in text.split("\n"):
        s = line.strip()
        if re.fullmatch(r"\d{1,3}", s):
            return int(s)
    return page_idx + 1


def _body_size(spans) -> float:
    """用出现最多的字号作为正文字号。"""
    sizes = [round(s["size"], 1) for s in spans if s.get("text", "").strip()]
    if not sizes:
        return 0.0
    return Counter(sizes).most_common(1)[0][0]


def _heading_level(size: float, body: float) -> int:
    """按字号相对正文判定标题层级。"""
    if body <= 0:
        return 0
    ratio = size / body
    if ratio >= 1.5:
        return 1
    if ratio >= 1.25:
        return 2
    if ratio >= 1.1:
        return 3
    return 0


def parse_pdf(pdf_path: str, max_pages: int = 0) -> list[Block]:
    """把整份 PDF 解析为内容块列表。"""
    doc = fitz.open(pdf_path)
    blocks: list[Block] = []
    for page_idx, page in enumerate(doc):
        if max_pages and page_idx >= max_pages:
            break
        text = page.get_text("text")
        printed = _printed_page(text, page_idx)
        d = page.get_text("dict")
        all_spans = [s for b in d["blocks"] if b["type"] == 0
                     for l in b["lines"] for s in l["spans"]]
        body = _body_size(all_spans)

        # 表格检测：每页只调一次；扫描页（无文本）跳过
        tables = []
        if len(text.strip()) >= 30:
            tables = page.find_tables().tables
        table_rects = [t.bbox for t in tables]

        for b in d["blocks"]:
            if b["type"] != 0:
                continue
            btext = "".join(s["text"] for l in b["lines"] for s in l["spans"]).strip()
            if not btext:
                continue
            # 跳过落入表格区域的文本块（表格单独渲染）
            if any(fitz.Rect(b["bbox"]) in fitz.Rect(tb) or
                   fitz.Rect(b["bbox"]).intersects(fitz.Rect(tb)) for tb in table_rects):
                continue
            max_size = max((s["size"] for l in b["lines"] for s in l["spans"]), default=body)
            lvl = _heading_level(max_size, body)
            blocks.append(Block(
                type="heading" if lvl else "paragraph",
                text=btext,
                page=page_idx,
                printed_page=printed,
                level=lvl,
                bbox=list(b["bbox"]),
            ))

        # 表格
        for t in tables:
            rows = [[(c or "").replace("\n", "").strip() for c in row] for row in t.extract()]
            md = _table_to_markdown(rows)
            if md:
                blocks.append(Block(
                    type="table", text=md, page=page_idx,
                    printed_page=printed, bbox=list(t.bbox),
                ))

        # 图片
        for img in page.get_images(full=True):
            blocks.append(Block(
                type="image", text=f"![图片 p{printed}](images/p{printed}_{img[0]}.png)",
                page=page_idx, printed_page=printed, bbox=[],
            ))
    doc.close()
    print(f"  已解析 {len(blocks)} 个内容块")
    return blocks


def _table_to_markdown(rows) -> str:
    if not rows:
        return ""
    ncol = max(len(r) for r in rows)
    out = []
    for i, r in enumerate(rows):
        r = (r + [""] * ncol)[:ncol]
        out.append("| " + " | ".join(r) + " |")
        if i == 0:
            out.append("| " + " | ".join(["---"] * ncol) + " |")
    return "\n".join(out)


def blocks_to_markdown(blocks: list[Block]) -> str:
    """把块列表拼接成 Markdown 文本。"""
    parts = []
    for b in blocks:
        if b.type == "heading":
            parts.append(("#" * b.level) + " " + b.text)
        elif b.type in ("paragraph", "table", "image"):
            parts.append(b.text)
    return "\n\n".join(parts)
