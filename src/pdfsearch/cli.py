# -*- coding: utf-8 -*-
"""命令行入口。"""
import argparse
import os
import sys

from .config import load_config
from .parse import parse_pdf, blocks_to_markdown
from .chunk import chunk_blocks
from .index import Indexer
from .providers import create_ocr_provider
from .search import Searcher


def _load(cfg_path):
    cfg = load_config(cfg_path)
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return cfg


def cmd_index(cfg, pdf_path):
    blocks = parse_pdf(pdf_path)
    if cfg.get("ocr", {}).get("enabled"):
        ocr_provider = create_ocr_provider(cfg)
        try:
            scan_blocks = ocr_provider.recognize(pdf_path)
        finally:
            ocr_provider.close()
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
    n = Indexer(cfg).index(name, name, chunks, pdf_path=pdf_path)
    print(f"[解析] {name}")
    print(f"  Markdown -> {md_path}")
    print(f"  内容块 {len(blocks)} 个，chunk {n} 个")


def cmd_query(cfg, query):
    for r in Searcher(cfg).search(query):
        print(f"[第{r['页码']}页|{r['章节']}] {r['段落']}")


def cmd_serve(cfg, host="127.0.0.1", port=8000):
    import uvicorn
    from .server import app
    uvicorn.run(app, host=host, port=int(port))


def main():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["index", "query", "serve"])
    parser.add_argument("value", nargs="?", default=None)
    parser.add_argument("--config", default=os.path.join(here, "..", "config.yaml"))
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    cfg = _load(args.config)
    if args.action == "index":
        cmd_index(cfg, args.value)
    elif args.action == "query":
        cmd_query(cfg, args.value)
    else:
        cmd_serve(cfg, args.host, args.port)


if __name__ == "__main__":
    main()
