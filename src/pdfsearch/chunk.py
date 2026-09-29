# -*- coding: utf-8 -*-
"""按 Markdown 标题层级分块，保留页码与章节。"""
from .parse import Block


def chunk_blocks(blocks: list[Block], max_chars: int = 800):
    """返回 [{text, section, start_page, end_page, kind}]。"""
    chunks = []
    section = ""
    buf = []
    start_page = None

    def flush():
        nonlocal buf, start_page
        if not buf:
            return
        text = "\n".join(buf).strip()
        if text:
            for piece in _split_long(text, max_chars):
                chunks.append({
                    "text": piece,
                    "section": section,
                    "start_page": start_page,
                    "end_page": start_page,
                    "kind": "md",
                })
        buf = []

    for b in blocks:
        if b.type == "heading":
            flush()
            section = b.text
            start_page = b.printed_page
            buf.append(("#" * max(b.level, 1)) + " " + b.text)
        else:
            if start_page is None:
                start_page = b.printed_page
            buf.append(b.text)
    flush()
    return chunks


def _split_long(text: str, max_chars: int):
    if len(text) <= max_chars:
        return [text]
    parts, cur = [], ""
    for para in text.split("\n"):
        if len(cur) + len(para) > max_chars and cur:
            parts.append(cur)
            cur = para
        else:
            cur = (cur + "\n" + para).strip()
    if cur:
        parts.append(cur)
    return parts
