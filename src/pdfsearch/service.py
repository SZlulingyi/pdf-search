# -*- coding: utf-8 -*-
"""可复用的 PDF 入库服务。"""
import os

from .chunk import chunk_blocks
from .index import Indexer
from .parse import blocks_to_markdown, parse_pdf
from .providers import create_ocr_provider


def index_pdf(cfg: dict, pdf_path: str) -> dict:
    """解析、OCR、切块并写入本地索引，返回结构化结果。"""
    blocks = parse_pdf(pdf_path)
    if cfg.get("ocr", {}).get("enabled"):
        ocr_provider = create_ocr_provider(cfg)
        try:
            scan_blocks = ocr_provider.recognize(pdf_path)
        finally:
            ocr_provider.close()
        blocks += scan_blocks
        blocks.sort(key=lambda b: (b.page, 0))

    os.makedirs(cfg["data_dir"], exist_ok=True)
    name = os.path.basename(pdf_path)
    md_path = os.path.join(cfg["data_dir"], "document.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(blocks_to_markdown(blocks))

    chunks = chunk_blocks(blocks, cfg["chunk"]["max_chars"])
    n = Indexer(cfg).index(name, name, chunks, pdf_path=pdf_path)
    return {
        "doc_id": name,
        "file_name": name,
        "pdf_path": pdf_path,
        "markdown_path": md_path,
        "block_count": len(blocks),
        "chunk_count": n,
    }
