# -*- coding: utf-8 -*-
"""混合检索：相似度(稠密) + 关键词(BM25) + RRF。"""
import os
import json
import sqlite3

import jieba
from rank_bm25 import BM25Okapi
from qdrant_client import QdrantClient

from .embed import DenseEmbedder


class Searcher:
    def __init__(self, cfg):
        self.cfg = cfg
        self.qdrant = QdrantClient(path=cfg["qdrant_path"])
        self.sqlite = sqlite3.connect(cfg["sqlite_path"])
        self.embedder = DenseEmbedder(cfg["model_dir"], cfg["embed"].get("device", "cpu"))
        self._load_bm25()

    def _load_bm25(self):
        p = os.path.join(self.cfg["data_dir"], "bm25.json")
        if os.path.exists(p):
            d = json.load(open(p, encoding="utf-8"))
            self.bm25 = BM25Okapi(d["tokens"])
        else:
            self.bm25 = None

    def _chunk_text(self, cid):
        row = self.sqlite.execute(
            "SELECT section, start_page, text FROM chunks WHERE chunk_id=?", (cid,)).fetchone()
        return {"section": row[0], "start_page": row[1], "text": row[2]} if row else None

    def search(self, query, top_k=None):
        top_k = top_k or self.cfg["top_k"]
        qvec = self.embedder.encode([query])[0].tolist()
        dense = self.qdrant.query_points(
            collection_name=self.cfg["collection"], query=qvec, limit=top_k).points
        dense_ids = [p.id for p in dense]

        kw_ids = []
        if self.bm25 is not None:
            scores = self.bm25.get_scores(list(jieba.cut(query)))
            kw_ids = sorted(range(len(scores)), key=lambda i: -scores[i])[:top_k]

        def rrf(rankings, k=60):
            s = {}
            for r in rankings:
                for rank, it in enumerate(r, 1):
                    s[it] = s.get(it, 0) + 1.0 / (k + rank)
            return sorted(s.items(), key=lambda x: -x[1])
        fused = rrf([dense_ids, kw_ids], k=self.cfg["rrf_k"])

        out = []
        for cid, score in fused:
            c = self._chunk_text(cid)
            if c:
                out.append({"页码": c["start_page"], "章节": c["section"],
                            "段落": c["text"][:200], "score": round(score, 5)})
        return out
