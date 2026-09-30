# -*- coding: utf-8 -*-
import json
import os
import tempfile
import unittest

import httpx
import numpy as np

from pdfsearch.clients import HTTPEmbeddingClient, HTTPOCRClient


class RemoteClientTests(unittest.TestCase):
    def test_openai_embeddings_response(self):
        def handler(request: httpx.Request) -> httpx.Response:
            body = json.loads(request.content.decode("utf-8"))
            self.assertEqual(body["model"], "bge-m3")
            self.assertEqual(body["input"], ["甲", "乙"])
            return httpx.Response(
                200,
                json={
                    "data": [
                        {"index": 1, "embedding": [0.0, 1.0]},
                        {"index": 0, "embedding": [1.0, 0.0]},
                    ],
                    "model": "bge-m3",
                },
            )

        client = HTTPEmbeddingClient(
            "http://bge.test",
            model="bge-m3",
            transport=httpx.MockTransport(handler),
        )
        result = client.encode(["甲", "乙"])
        self.assertEqual(result.shape, (2, 2))
        np.testing.assert_allclose(result[0], [1.0, 0.0])
        np.testing.assert_allclose(result[1], [0.0, 1.0])

    def test_embeddings_vectors_format_and_normalize(self):
        def handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"vectors": [[3.0, 4.0]]})

        client = HTTPEmbeddingClient(
            "http://bge.test",
            transport=httpx.MockTransport(handler),
            normalize=True,
        )
        result = client.encode(["文本"])
        self.assertEqual(result.shape, (1, 2))
        np.testing.assert_allclose(result[0], [0.6, 0.8])

    def test_ocr_pages_with_bbox(self):
        def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(request.method, "POST")
            self.assertIn("multipart/form-data", request.headers["content-type"])
            return httpx.Response(
                200,
                json={
                    "pages": [
                        {
                            "page": 5,
                            "lines": [
                                {
                                    "text": "氮化镓",
                                    "bbox": [10, 20, 30, 40],
                                    "score": 0.98,
                                }
                            ],
                        }
                    ]
                },
            )

        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as handle:
            handle.write(b"fake-image")
            path = handle.name
        try:
            client = HTTPOCRClient(
                "http://ocr.test",
                transport=httpx.MockTransport(handler),
            )
            pages = client.recognize_file(path, default_page=1)
        finally:
            os.unlink(path)

        self.assertEqual(len(pages), 1)
        self.assertEqual(pages[0].page, 5)
        self.assertEqual(pages[0].lines[0].text, "氮化镓")
        self.assertEqual(pages[0].lines[0].bbox, [10.0, 20.0, 30.0, 40.0])
        self.assertAlmostEqual(pages[0].lines[0].confidence, 0.98)

    def test_ocr_result_wrapper_and_polygon(self):
        def handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "result": {
                        "pages": [
                            {
                                "page_index": 0,
                                "lines": [
                                    {
                                        "rec_text": "示例",
                                        "poly": [[1, 2], [5, 2], [5, 8], [1, 8]],
                                        "confidence": 0.9,
                                    }
                                ],
                            }
                        ]
                    }
                },
            )

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as handle:
            handle.write(b"%PDF-fake")
            path = handle.name
        try:
            client = HTTPOCRClient(
                "http://ocr.test",
                transport=httpx.MockTransport(handler),
            )
            pages = client.recognize_file(path)
        finally:
            os.unlink(path)

        self.assertEqual(pages[0].page, 1)
        self.assertEqual(pages[0].lines[0].bbox, [1.0, 2.0, 5.0, 8.0])


if __name__ == "__main__":
    unittest.main()
