# -*- coding: utf-8 -*-
"""BGE/Embedding HTTP 服务适配。"""
from __future__ import annotations

from typing import Any, List, Optional, Sequence

import numpy as np

from .http import BaseHTTPClient


def _as_vector(value: Any) -> List[float]:
    if not isinstance(value, (list, tuple)):
        raise ValueError("embedding 必须是数组")
    return [float(x) for x in value]


def _extract_embeddings(payload: Any) -> List[List[float]]:
    """兼容 OpenAI、embeddings、vectors 和直接数组等常见返回格式。"""
    if isinstance(payload, list):
        if not payload:
            return []
        if all(isinstance(item, dict) for item in payload):
            items = list(payload)
            if any("index" in item for item in items):
                items.sort(key=lambda item: int(item.get("index", 0)))
            vectors = []
            for item in items:
                value = item.get("embedding")
                if value is None:
                    value = item.get("vector")
                if value is None:
                    raise ValueError("embedding 响应缺少 embedding/vector 字段")
                vectors.append(_as_vector(value))
            return vectors
        return [_as_vector(item) for item in payload]

    if isinstance(payload, dict):
        if "embedding" in payload:
            return [_as_vector(payload["embedding"])]
        for key in ("data", "embeddings", "vectors", "result"):
            if key in payload:
                return _extract_embeddings(payload[key])

    raise ValueError("无法识别 embedding 响应格式")


class HTTPEmbeddingClient(BaseHTTPClient):
    """调用远程 BGE 服务，对外提供 encode() 接口。"""

    def __init__(
        self,
        base_url: str,
        api_key: Optional[str] = None,
        endpoint: str = "/v1/embeddings",
        model: Optional[str] = None,
        timeout: float = 120.0,
        batch_size: int = 16,
        normalize: bool = False,
        retries: int = 2,
        transport: Optional[Any] = None,
    ) -> None:
        super().__init__(
            base_url=base_url,
            api_key=api_key,
            timeout=timeout,
            retries=retries,
            transport=transport,
        )
        self.endpoint = endpoint
        self.model = model
        self.batch_size = max(1, int(batch_size))
        self.normalize = bool(normalize)

    def encode(self, texts: Sequence[str], batch_size: Optional[int] = None) -> np.ndarray:
        text_list = [str(text) for text in texts]
        if not text_list:
            return np.empty((0, 0), dtype=np.float32)
        size = max(1, int(batch_size or self.batch_size))
        vectors: List[List[float]] = []
        for start in range(0, len(text_list), size):
            batch = text_list[start:start + size]
            payload = {"input": batch}
            if self.model:
                payload["model"] = self.model
            response = self.request("POST", self.endpoint, json=payload)
            vectors.extend(_extract_embeddings(response.json()))

        if len(vectors) != len(text_list):
            raise ValueError(
                "embedding 数量不一致: 输入 {} 条，返回 {} 条".format(
                    len(text_list), len(vectors)
                )
            )
        array = np.asarray(vectors, dtype=np.float32)
        if array.ndim != 2:
            raise ValueError("embedding 返回值不是二维数组")
        if self.normalize:
            norms = np.linalg.norm(array, axis=1, keepdims=True)
            norms[norms == 0] = 1.0
            array = array / norms
        return array

    def health(self) -> dict:
        response = self.request("GET", "/health")
        return response.json()
