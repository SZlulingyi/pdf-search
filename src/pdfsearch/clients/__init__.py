# -*- coding: utf-8 -*-
"""远程模型服务客户端。"""

from .embedding import HTTPEmbeddingClient
from .ocr import HTTPOCRClient, OCRLine, OCRPage

__all__ = [
    "HTTPEmbeddingClient",
    "HTTPOCRClient",
    "OCRLine",
    "OCRPage",
]
