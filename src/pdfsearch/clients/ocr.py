# -*- coding: utf-8 -*-
"""OCR HTTP 服务适配。"""
from __future__ import annotations

import mimetypes
import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence

from .http import BaseHTTPClient


@dataclass
class OCRLine:
    text: str
    bbox: List[float] = field(default_factory=list)
    confidence: float = 0.0


@dataclass
class OCRPage:
    page: int
    lines: List[OCRLine] = field(default_factory=list)


def _first_value(item: Dict[str, Any], keys: Sequence[str], default: Any = None) -> Any:
    for key in keys:
        if key in item and item[key] is not None:
            return item[key]
    return default


def _normalize_bbox(value: Any) -> List[float]:
    if not value:
        return []
    if (
        isinstance(value, (list, tuple))
        and len(value) == 4
        and all(not isinstance(x, (list, tuple)) for x in value)
    ):
        try:
            return [float(x) for x in value]
        except (TypeError, ValueError):
            return []
    if isinstance(value, (list, tuple)):
        points = []
        for point in value:
            if isinstance(point, (list, tuple)) and len(point) >= 2:
                try:
                    points.append((float(point[0]), float(point[1])))
                except (TypeError, ValueError):
                    continue
        if points:
            xs = [point[0] for point in points]
            ys = [point[1] for point in points]
            return [min(xs), min(ys), max(xs), max(ys)]
    return []


def _iter_pages(payload: Any) -> List[Dict[str, Any]]:
    """兼容 pages/results/data/result 和单页 lines 格式。"""
    if isinstance(payload, dict):
        if "pages" in payload:
            return _iter_pages(payload["pages"])
        if "results" in payload:
            return _iter_pages(payload["results"])
        if "data" in payload:
            return _iter_pages(payload["data"])
        if "result" in payload:
            return _iter_pages(payload["result"])
        if "lines" in payload or "text" in payload or "rec_texts" in payload:
            return [payload]
        return []

    if isinstance(payload, list):
        if not payload:
            return []
        if all(isinstance(item, dict) for item in payload):
            if all(("lines" in item or "pages" in item) for item in payload):
                pages: List[Dict[str, Any]] = []
                for item in payload:
                    pages.extend(_iter_pages(item))
                return pages
            return [{"lines": payload}]
    return []


def _line_text(item: Dict[str, Any]) -> str:
    value = _first_value(item, ("text", "rec_text", "content", "value"), "")
    return str(value or "").strip()


def _line_confidence(item: Dict[str, Any]) -> float:
    value = _first_value(item, ("confidence", "score", "rec_score"), 0.0)
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


class HTTPOCRClient(BaseHTTPClient):
    """调用远程 OCR 服务，返回带坐标的 OCRPage 列表。"""

    def __init__(
        self,
        base_url: str,
        api_key: Optional[str] = None,
        endpoint: str = "/v1/ocr",
        timeout: float = 300.0,
        page_base: int = 1,
        file_field: str = "file",
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
        self.page_base = int(page_base)
        self.file_field = file_field

    def recognize_file(
        self,
        file_path: str,
        default_page: int = 1,
        mime_type: Optional[str] = None,
    ) -> List[OCRPage]:
        path = os.fspath(file_path)
        guessed = mime_type or mimetypes.guess_type(path)[0] or "application/octet-stream"
        with open(path, "rb") as handle:
            files = {self.file_field: (os.path.basename(path), handle, guessed)}
            response = self.request("POST", self.endpoint, files=files)
        return self._parse_pages(response.json(), default_page=default_page)

    def recognize_image(
        self,
        image_path: str,
        default_page: int = 1,
        mime_type: Optional[str] = None,
    ) -> List[OCRPage]:
        return self.recognize_file(
            image_path,
            default_page=default_page,
            mime_type=mime_type or "image/png",
        )

    def health(self) -> dict:
        response = self.request("GET", "/health")
        return response.json()

    def _parse_pages(self, payload: Any, default_page: int = 1) -> List[OCRPage]:
        raw_pages = _iter_pages(payload)
        pages: List[OCRPage] = []
        for index, raw_page in enumerate(raw_pages):
            page_number = self._page_number(raw_page, index, default_page)
            raw_lines = _first_value(raw_page, ("lines", "items", "results"), None)
            if raw_lines is None and "text" in raw_page:
                raw_lines = [raw_page]
            if not isinstance(raw_lines, list):
                raw_lines = []

            lines: List[OCRLine] = []
            for raw_line in raw_lines:
                if not isinstance(raw_line, dict):
                    continue
                text = _line_text(raw_line)
                if not text:
                    continue
                bbox = _normalize_bbox(
                    _first_value(raw_line, ("bbox", "box", "poly", "polygon", "points"))
                )
                lines.append(
                    OCRLine(
                        text=text,
                        bbox=bbox,
                        confidence=_line_confidence(raw_line),
                    )
                )
            pages.append(OCRPage(page=page_number, lines=lines))
        return pages

    def _page_number(self, page: Dict[str, Any], index: int, default_page: int) -> int:
        if "page_index" in page:
            try:
                return int(page["page_index"]) + 1
            except (TypeError, ValueError):
                pass
        value = _first_value(page, ("page", "page_num", "page_number"), None)
        if value is None:
            return int(default_page)
        try:
            number = int(value)
        except (TypeError, ValueError):
            return int(default_page)
        if self.page_base == 0:
            number += 1
        return number
