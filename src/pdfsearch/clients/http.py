# -*- coding: utf-8 -*-
"""HTTP 客户端公共逻辑。"""
from __future__ import annotations

import time
from typing import Any, Dict, Optional
import httpx


class ServiceHTTPError(RuntimeError):
    """远程模型服务调用失败。"""


class BaseHTTPClient:
    """带鉴权、超时和有限重试的基础 HTTP 客户端。"""

    def __init__(
        self,
        base_url: str,
        api_key: Optional[str] = None,
        timeout: float = 120.0,
        retries: int = 2,
        transport: Optional[httpx.BaseTransport] = None,
        extra_headers: Optional[Dict[str, str]] = None,
        trust_env: bool = False,
    ) -> None:
        if not base_url:
            raise ValueError("base_url 不能为空")
        self.base_url = base_url.rstrip("/") + "/"
        self.retries = max(0, int(retries))
        headers: Dict[str, str] = {}
        if api_key:
            headers["Authorization"] = "Bearer " + api_key
        if extra_headers:
            headers.update(extra_headers)
        self._client = httpx.Client(
            timeout=timeout,
            headers=headers,
            transport=transport,
            trust_env=trust_env,
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "BaseHTTPClient":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    def _url(self, endpoint: str) -> str:
        if endpoint.startswith("http://") or endpoint.startswith("https://"):
            return endpoint
        return self.base_url + endpoint.lstrip("/")

    def request(self, method: str, endpoint: str, **kwargs: Any) -> httpx.Response:
        url = self._url(endpoint)
        last_error: Optional[Exception] = None
        for attempt in range(self.retries + 1):
            try:
                response = self._client.request(method, url, **kwargs)
            except httpx.TransportError as exc:
                last_error = exc
                if attempt >= self.retries:
                    break
                time.sleep(0.5 * (2 ** attempt))
                continue

            if response.status_code >= 500 and attempt < self.retries:
                time.sleep(0.5 * (2 ** attempt))
                continue

            if response.is_error:
                body = response.text[:2000]
                raise ServiceHTTPError(
                    "HTTP {} 调用失败: status={}, body={}".format(
                        method.upper(), response.status_code, body
                    )
                )
            return response

        raise ServiceHTTPError("HTTP {} 调用失败: {}".format(method.upper(), last_error))
