# -*- coding: utf-8 -*-
"""索引：分块 -> 向量化 -> Qdrant + SQLite + BM25。"""
import os
import json
import sqlite3

import jieba
from rank_bm25 import BM25Okapi
from qdrant_client import QdrantClient
from qdrant_client.http import models as rest

from .embed import DenseEmbedder


class Indexer:
    def __init__(self, cfg):
        self.cfg = cfg
        os.makedirs(cfg["data_dir"], exist_ok=True)
        self.qdrant = QdrantClient(path=cfg["qdrant_path"])
        self.sqlite = sqlite3.connect(cfg["sqlite_path"])
        self._init_db()

    def _init_db(self):
        cur = self.sqlite.cursor()
        cur.execute("""CREATE TABLE IF NOT EXISTS docs(
            doc_id TEXT PRIMARY KEY, name TEXT, chunks_json TEXT)""")
        cur.execute("""CREATE TABLE IF NOT EXISTS chunks(
            chunk_id INTEGER PRIMARY KEY, doc_id TEXT, section TEXT,
            start_page INTEGER, text TEXT)""")
        self.sqlite.commit()

    def index(self, doc_id, doc_name, chunks):
        embedder = DenseEmbedder(self.cfg["model_dir"], self.cfg["embed"].get("device", "cpu"))
        texts = [c["text"] for c in chunks]
        vecs = embedder.encode(texts)

        coll = self.cfg["collection"]
        if self.qdrant.collection_exists(coll):
            self.qdrant.delete_collection(coll)
        self.qdrant.create_collection(
            collection_name=coll,
            vectors_config=rest.VectorParams(size=vecs.shape[1], distance=rest.Distance.COSINE),
        )
        points = [
            rest.PointStruct(
                id=i, vector=vecs[i].tolist(),
                payload={"section": chunks[i]["section"],
                         "start_page": chunks[i]["start_page"],
                         "doc_id": doc_id, "text": chunks[i]["text"]},
            )
            for i in range(len(chunks))
        ]
        self.qdrant.upsert(collection_name=coll, points=points)

        cur = self.sqlite.cursor()
        cur.execute("INSERT OR REPLACE INTO docs(doc_id, name, chunks_json) VALUES(?,?,?)",
                    (doc_id, doc_name, json.dumps(chunks, ensure_ascii=False)))
        for i, c in enumerate(chunks):
            cur.execute("INSERT OR REPLACE INTO chunks(chunk_id, doc_id, section, start_page, text) VALUES(?,?,?,?,?)",
                        (i, doc_id, c["section"], c["start_page"], c["text"]))
        self.sqlite.commit()

        # BM25 落地
        tokens = [list(jieba.cut(t)) for t in texts]
        bm25 = BM25Okapi(tokens)
        with open(os.path.join(self.cfg["data_dir"], "bm25.json"), "w", encoding="utf-8") as f:
            json.dump({"texts": texts, "tokens": tokens}, f, ensure_ascii=False)
        return len(chunks)
