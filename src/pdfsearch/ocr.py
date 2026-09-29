# -*- coding: utf-8 -*-
"""扫描页 OCR（PaddleOCR 双轨）：无文本层的页面渲染成图后识别。"""
import os
import re

import fitz

from .parse import Block


_engine = None


def _prepare_env(cache_dir: str):
    os.environ["PADDLE_PDX_CACHE_HOME"] = cache_dir
    os.environ["HOME"] = cache_dir
    os.environ["USERPROFILE"] = cache_dir
    os.environ["FLAGS_use_mkldnn"] = "0"
    os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
    os.makedirs(cache_dir, exist_ok=True)


def _get_engine(cache_dir: str, lang: str):
    global _engine
    if _engine is None:
        _prepare_env(cache_dir)
        from paddleocr import PaddleOCR  # 延迟导入，避免未装 OCR 依赖时崩溃
        _engine = PaddleOCR(
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            lang=lang, enable_mkldnn=False, device="cpu",
        )
    return _engine


def _ocr_text(img_path: str, cache_dir: str, lang: str) -> str:
    engine = _get_engine(cache_dir, lang)
    lines = []
    for page in engine.predict(img_path):
        for t, s in zip(page.get("rec_texts", []), page.get("rec_scores", [])):
            if float(s) >= 0.4:
                lines.append(t)
    return "\n".join(lines)


def _page_offset(doc) -> int:
    """从首个文本页反推印刷页码偏移。"""
    for page_idx, page in enumerate(doc):
        t = page.get_text("text")
        if len(t.strip()) < 30:
            continue
        for line in t.split("\n"):
            s = line.strip()
            if re.fullmatch(r"\d{1,3}", s):
                return int(s) - page_idx
        break
    return 1


def ocr_scan_pages(pdf_path: str, cache_dir: str, lang: str = "ch",
                   max_pages: int = 0, dpi: int = 200) -> list[Block]:
    """对无文本层的扫描页做 OCR，返回 Block 列表。"""
    doc = fitz.open(pdf_path)
    offset = _page_offset(doc)
    blocks: list[Block] = []
    tmp_dir = os.path.join(cache_dir, "tmp")
    os.makedirs(tmp_dir, exist_ok=True)
    for page_idx, page in enumerate(doc):
        if max_pages and page_idx >= max_pages:
            break
        if len(page.get_text("text").strip()) >= 30:
            continue  # 文本页，跳过
        img_path = os.path.join(tmp_dir, f"scan_p{page_idx}.png")
        page.get_pixmap(dpi=dpi).save(img_path)
        txt = _ocr_text(img_path, cache_dir, lang)
        if txt.strip():
            blocks.append(Block(
                type="paragraph", text=txt, page=page_idx,
                printed_page=page_idx + offset, section="扫描页", level=0, bbox=[],
            ))
    doc.close()
    return blocks
