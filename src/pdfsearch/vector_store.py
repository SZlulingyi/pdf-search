# -*- coding: utf-8 -*-
"""Qdrant 客户端工厂：支持本地文件模式和服务端模式。"""
from qdrant_client import QdrantClient


def create_qdrant_client(cfg: dict) -> QdrantClient:
    url = cfg.get("qdrant_url")
    if url:
        return QdrantClient(
            url=url,
            api_key=cfg.get("qdrant_api_key") or None,
            trust_env=False,
            check_compatibility=False,
        )
    return QdrantClient(path=cfg["qdrant_path"])
