# -*- coding: utf-8 -*-
"""本地模型与远程 FastAPI 服务的 Provider 工厂。"""
from __future__ import annotations

from typing import List, Optional, Protocol, Sequence

import numpy as np

from .parse import Block


class Embedder(Protocol):
    def encode(self, texts: Sequence[str], batch_size: Optional[int] = None) -> np.ndarray:
        ...


class OCRProvider(Protocol):
    def recognize(self, pdf_path: str) -> List[Block]:
        ...

    def close(self) -> None:
        ...


def create_embedder(cfg: dict) -> Embedder:
    """根据配置创建本地或 HTTP BGE 客户端。"""
    section = cfg.get("embed", {})
    provider = str(section.get("provider", "local")).lower()
    if provider == "http":
        from .clients.embedding import HTTPEmbeddingClient

        return HTTPEmbeddingClient(
            base_url=section["base_url"],
            api_key=section.get("api_key"),
            endpoint=section.get("endpoint", "/v1/embeddings"),
            model=section.get("model"),
            timeout=float(section.get("timeout", 120)),
            batch_size=int(section.get("batch_size", 16)),
            normalize=bool(section.get("normalize", False)),
        )

    from .embed import DenseEmbedder

    return DenseEmbedder(
        model_dir=cfg["model_dir"],
        device=section.get("device", "cpu"),
    )


class LocalOCRProvider:
    def __init__(self, cache_dir: str, lang: str = "ch", dpi: int = 200) -> None:
        self.cache_dir = cache_dir
        self.lang = lang
        self.dpi = dpi

    def recognize(self, pdf_path: str) -> List[Block]:
        from .ocr import ocr_scan_pages

        return ocr_scan_pages(
            pdf_path,
            cache_dir=self.cache_dir,
            lang=self.lang,
            dpi=self.dpi,
        )

    def close(self) -> None:
        return None


class RemoteOCRProvider:
    """把远程 OCR 结果转换成现有 Block 结构。"""

    def __init__(
        self,
        client,
        cache_dir: str,
        lang: str = "ch",
        dpi: int = 200,
        mode: str = "scan",
    ) -> None:
        self.client = client
        self.cache_dir = cache_dir
        self.lang = lang
        self.dpi = dpi
        self.mode = mode

    def recognize(self, pdf_path: str) -> List[Block]:
        if self.mode == "pdf":
            pages = self.client.recognize_file(pdf_path)
        else:
            from .ocr import iter_scan_page_images

            pages = []
            for _page_idx, printed_page, image_path in iter_scan_page_images(
                pdf_path,
                cache_dir=self.cache_dir,
                dpi=self.dpi,
            ):
                pages.extend(
                    self.client.recognize_image(
                        image_path,
                        default_page=printed_page,
                    )
                )
        return self._to_blocks(pages)

    def _to_blocks(self, pages) -> List[Block]:
        blocks: List[Block] = []
        for page in pages:
            printed_page = int(page.page)
            for line in page.lines:
                blocks.append(
                    Block(
                        type="paragraph",
                        text=line.text,
                        page=max(printed_page - 1, 0),
                        printed_page=printed_page,
                        section="扫描页",
                        level=0,
                        bbox=list(line.bbox),
                        confidence=float(line.confidence),
                    )
                )
        return blocks

    def close(self) -> None:
        self.client.close()


def create_ocr_provider(cfg: dict) -> OCRProvider:
    """根据配置创建本地或 HTTP OCR Provider。"""
    section = cfg.get("ocr", {})
    provider = str(section.get("provider", "local")).lower()
    cache_dir = section.get("cache_dir", "data/ocr_cache")
    if provider == "http":
        from .clients.ocr import HTTPOCRClient

        client = HTTPOCRClient(
            base_url=section["base_url"],
            api_key=section.get("api_key"),
            endpoint=section.get("endpoint", "/v1/ocr"),
            timeout=float(section.get("timeout", 300)),
            page_base=int(section.get("page_base", 1)),
            file_field=section.get("file_field", "file"),
        )
        return RemoteOCRProvider(
            client=client,
            cache_dir=cache_dir,
            lang=section.get("lang", "ch"),
            dpi=int(section.get("dpi", 200)),
            mode=section.get("mode", "scan"),
        )

    return LocalOCRProvider(
        cache_dir=cache_dir,
        lang=section.get("lang", "ch"),
        dpi=int(section.get("dpi", 200)),
    )
