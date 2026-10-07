# -*- coding: utf-8 -*-
"""按 Markdown 标题层级分块，保留页码与章节。"""
from .parse import Block


def chunk_blocks(blocks: list[Block], max_chars: int = 800):
    """一个 Block 一个 chunk，保留 block_id/bbox 供检索定位。"""
    chunks = []
    for b in blocks:
        if b.type == "image":
            continue  # 图片块不参与文本检索
        text = b.text.strip()
        if not text:
            continue
        if b.type == "heading":
            text = ("#" * max(b.level, 1)) + " " + text
        pieces = _split_long(text, max_chars)
        for pi, piece in enumerate(pieces):
            block_id = b.block_id if len(pieces) == 1 else "{}-{}".format(b.block_id, pi)
            chunks.append({
                "text": piece,
                "section": b.section,
                "start_page": b.printed_page,
                "pdf_page": b.page,
                "block_id": block_id,
                "bbox": list(b.bbox),
                "kind": b.type,
            })
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
