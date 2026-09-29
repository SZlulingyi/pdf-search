# -*- coding: utf-8 -*-
"""命令行入口。"""
import argparse
import os
import sys

from .config import load_config
from .parse import parse_pdf, blocks_to_markdown
from .chunk import chunk_blocks
from .index import Indexer
from .search import Searcher


def _load(cfg_path):
    cfg = load_config(cfg_path)
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return cfg


def cmd_index(cfg, pdf_path):
    blocks = parse_pdf(pdf_path)
    if cfg.get("ocr", {}).get("enabled"):
        from .ocr import ocr_scan_pages
        scan_blocks = ocr_scan_pages(
            pdf_path, cfg["ocr"].get("cache_dir", "data/ocr_cache"),
            cfg["ocr"].get("lang", "ch"))
        print(f"  OCR 扫描页 {len(scan_blocks)} 个")
        blocks += scan_blocks
        blocks.sort(key=lambda b: (b.page, 0))
    md = blocks_to_markdown(blocks)
    md_path = os.path.join(cfg["data_dir"], "document.md")
    os.makedirs(cfg["data_dir"], exist_ok=True)
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(md)
    chunks = chunk_blocks(blocks, cfg["chunk"]["max_chars"])
    name = os.path.basename(pdf_path)
    n = Indexer(cfg).index(name, name, chunks)
    print(f"[解析] {name}")
    print(f"  Markdown -> {md_path}")
    print(f"  内容块 {len(blocks)} 个，chunk {n} 个")


def cmd_query(cfg, query):
    for r in Searcher(cfg).search(query):
        print(f"[第{r['页码']}页|{r['章节']}] {r['段落']}")


def main():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["index", "query"])
    parser.add_argument("value", nargs="?", default=None)
    parser.add_argument("--config", default=os.path.join(here, "..", "config.yaml"))
    args = parser.parse_args()
    cfg = _load(args.config)
    if args.action == "index":
        cmd_index(cfg, args.value)
    else:
        cmd_query(cfg, args.value)


if __name__ == "__main__":
    main()
