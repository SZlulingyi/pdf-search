# -*- coding: utf-8 -*-
"""混合检索：相似度(稠密) + 关键词(BM25) + RRF。"""
import os
import json
import sqlite3
import threading
from typing import Optional

import jieba
from rank_bm25 import BM25Okapi
from qdrant_client.http import models as rest

from .providers import Embedder, create_embedder
from .vector_store import create_qdrant_client


class Searcher:
    def __init__(self, cfg, embedder: Optional[Embedder] = None):
        self.cfg = cfg
        self.qdrant = create_qdrant_client(cfg)
        self.sqlite = sqlite3.connect(cfg["sqlite_path"], check_same_thread=False)
        self._lock = threading.Lock()
        self.embedder = embedder or create_embedder(cfg)
        self._load_bm25()

    def _fetchone(self, sql, params=()):
        with self._lock:
            return self.sqlite.execute(sql, params).fetchone()

    def _fetchall(self, sql, params=()):
        with self._lock:
            return self.sqlite.execute(sql, params).fetchall()

    def delete_document(self, doc_id: str) -> bool:
        existing = self._fetchone("SELECT 1 FROM docs WHERE doc_id=?", (doc_id,))
        if not existing:
            return False
        if self.qdrant.collection_exists(self.cfg["collection"]):
            self.qdrant.delete(
                collection_name=self.cfg["collection"],
                points_selector=rest.Filter(
                    must=[rest.FieldCondition(key="doc_id", match=rest.MatchValue(value=doc_id))]
                ),
            )
        with self._lock:
            self.sqlite.execute("DELETE FROM chunks WHERE doc_id=?", (doc_id,))
            self.sqlite.execute("DELETE FROM docs WHERE doc_id=?", (doc_id,))
            self.sqlite.commit()

        path = os.path.join(self.cfg["data_dir"], "bm25.json")
        if os.path.exists(path):
            payload = json.load(open(path, encoding="utf-8"))
            if "items" in payload:
                items = [item for item in payload["items"] if item.get("doc_id") != doc_id]
            else:
                items = []
            with open(path, "w", encoding="utf-8") as output:
                json.dump({"items": items}, output, ensure_ascii=False)
        self._load_bm25()
        return True

    def _load_bm25(self):
        p = os.path.join(self.cfg["data_dir"], "bm25.json")
        if not os.path.exists(p):
            self.bm25 = None
            self.bm25_chunk_ids = []
            return
        payload = json.load(open(p, encoding="utf-8"))
        if "items" in payload:
            items = payload["items"]
            self.bm25_chunk_ids = [item["chunk_id"] for item in items]
            self.bm25 = BM25Okapi([item["tokens"] for item in items]) if items else None
        else:
            self.bm25_chunk_ids = [str(index) for index in range(len(payload.get("tokens", [])))]
            self.bm25 = BM25Okapi(payload["tokens"]) if payload.get("tokens") else None

    def _chunk(self, cid):
        row = self._fetchone(
            """SELECT doc_id, doc_name, block_id, section, page, pdf_page, bbox, text
               FROM chunks WHERE chunk_id=?""", (cid,))
        if not row:
            return None
        return {
            "doc_id": row[0], "doc_name": row[1], "block_id": row[2],
            "section": row[3], "page": row[4],
            "pdf_page": row[5],
            "bbox": json.loads(row[6]) if row[6] else [],
            "text": row[7],
        }

    def _evidence(self, c, query, score):
        start = c["text"].find(query)
        if start < 0:
            for tok in jieba.cut(query):
                start = c["text"].find(tok)
                if start >= 0:
                    break
        if start < 0:
            start = 0
        return {
            "doc_id": c["doc_id"], "file_name": c["doc_name"],
            "page": c["page"], "block_id": c["block_id"],
            "section": c["section"], "text": c["text"],
            "highlight": {"start": start, "end": start + len(query)},
            "bbox": c["bbox"], "score": round(score, 5),
        }

    def search(self, query, top_k=None):
        top_k = top_k or self.cfg["top_k"]
        qvec = self.embedder.encode([query])[0].tolist()
        dense = self.qdrant.query_points(
            collection_name=self.cfg["collection"], query=qvec, limit=top_k).points
        dense_ids = [p.id for p in dense]

        kw_ids = []
        if self.bm25 is not None:
            scores = self.bm25.get_scores(list(jieba.cut(query)))
            ranked = sorted(range(len(scores)), key=lambda index: -scores[index])[:top_k]
            kw_ids = [self.bm25_chunk_ids[index] for index in ranked if index < len(self.bm25_chunk_ids)]

        def rrf(rankings, k=60):
            s = {}
            for r in rankings:
                for rank, it in enumerate(r, 1):
                    s[it] = s.get(it, 0) + 1.0 / (k + rank)
            return sorted(s.items(), key=lambda x: -x[1])
        fused = rrf([dense_ids, kw_ids], k=self.cfg["rrf_k"])

        out = []
        for cid, score in fused:
            c = self._chunk(cid)
            if c:
                out.append(self._evidence(c, query, score))
        return out

    def search_exact(self, query, top_k=None):
        """精确关键词检索：文本包含 query 子串即命中。"""
        top_k = top_k or self.cfg["top_k"]
        rows = self._fetchall(
            "SELECT chunk_id FROM chunks WHERE text LIKE ? LIMIT ?",
            (f"%{query}%", top_k))
        out = []
        for (cid,) in rows:
            c = self._chunk(cid)
            if c:
                score = 1.0 - len(c["text"]) / max(len(c["text"]) + len(query), 1)
                out.append(self._evidence(c, query, score))
        return out

    def get_block(self, doc_id, block_id):
        row = self._fetchone(
            """SELECT doc_name, block_id, section, page, bbox, text
               FROM chunks WHERE doc_id=? AND block_id=?""", (doc_id, block_id))
        if not row:
            return None
        return {
            "doc_id": doc_id, "file_name": row[0], "block_id": row[1],
            "section": row[2], "page": row[3],
            "bbox": json.loads(row[4]) if row[4] else [], "text": row[5],
        }

    def get_doc_path(self, doc_id):
        row = self._fetchone(
            "SELECT pdf_path FROM docs WHERE doc_id=?", (doc_id,))
        return row[0] if row else None

    def get_pdf_page(self, doc_id, printed_page):
        row = self._fetchone(
            "SELECT pdf_page FROM chunks WHERE doc_id=? AND page=? LIMIT 1",
            (doc_id, printed_page))
        return row[0] if row else None
