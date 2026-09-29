# -*- coding: utf-8 -*-
"""配置加载与路径解析。"""
import os
import yaml


def load_config(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    base = os.path.dirname(os.path.abspath(path))
    for k in ("data_dir", "qdrant_path", "sqlite_path"):
        if not os.path.isabs(cfg[k]):
            cfg[k] = os.path.join(base, cfg[k].replace("/", os.sep))
    if "ocr" in cfg and "cache_dir" in cfg["ocr"] and not os.path.isabs(cfg["ocr"]["cache_dir"]):
        cfg["ocr"]["cache_dir"] = os.path.join(base, cfg["ocr"]["cache_dir"].replace("/", os.sep))
    return cfg
