# -*- coding: utf-8 -*-
"""命令行入口。"""
import argparse
import os
import sys

from .config import load_config
from .service import index_pdf
from .index import Indexer
from .providers import create_ocr_provider
from .search import Searcher


def _load(cfg_path):
    cfg = load_config(cfg_path)
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return cfg


def cmd_index(cfg, pdf_path):
    result = index_pdf(cfg, pdf_path)
    print(f"[解析] {result['file_name']}")
    print(f"  Markdown -> {result['markdown_path']}")
    print(f"  内容块 {result['block_count']} 个，chunk {result['chunk_count']} 个")


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
