# -*- coding: utf-8 -*-
"""索引：分块 -> 向量化 -> Qdrant + SQLite + BM25。"""
import json
import os
import sqlite3
import uuid
from typing import Optional

import jieba
from qdrant_client.http import models as rest

from .providers import Embedder, create_embedder
from .vector_store import create_qdrant_client


class Indexer:
    def __init__(self, cfg, embedder: Optional[Embedder] = None):
        self.cfg = cfg
        os.makedirs(cfg["data_dir"], exist_ok=True)
        self.qdrant = create_qdrant_client(cfg)
        self.sqlite = sqlite3.connect(cfg["sqlite_path"])
        self.embedder = embedder or create_embedder(cfg)
        self._init_db()

    def _init_db(self):
        cur = self.sqlite.cursor()
        cur.execute("""CREATE TABLE IF NOT EXISTS docs(
            doc_id TEXT PRIMARY KEY, name TEXT, pdf_path TEXT, chunks_json TEXT)""")

        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='chunks'")
        exists = cur.fetchone() is not None
        if exists:
            info = cur.execute("PRAGMA table_info(chunks)").fetchall()
            chunk_type = next((row[2] for row in info if row[1] == "chunk_id"), "")
            if "INT" in str(chunk_type).upper():
                cur.execute("ALTER TABLE chunks RENAME TO chunks_legacy")
                cur.execute("""CREATE TABLE chunks(
                    chunk_id TEXT PRIMARY KEY, doc_id TEXT, doc_name TEXT,
                    block_id TEXT, section TEXT, page INTEGER, pdf_page INTEGER,
                    bbox TEXT, text TEXT)""")
                rows = cur.execute("""SELECT chunk_id, doc_id, doc_name, block_id, section,
                    page, pdf_page, bbox, text FROM chunks_legacy""").fetchall()
                for row in rows:
                    old_id, doc_id = row[0], row[1] or ""
                    new_id = f"{doc_id}:{old_id}" if doc_id else str(old_id)
                    cur.execute("""INSERT OR REPLACE INTO chunks(
                        chunk_id, doc_id, doc_name, block_id, section, page,
                        pdf_page, bbox, text) VALUES(?,?,?,?,?,?,?,?,?)""",
                        (new_id, *row[1:]))
                cur.execute("DROP TABLE chunks_legacy")
        else:
            cur.execute("""CREATE TABLE chunks(
                chunk_id TEXT PRIMARY KEY, doc_id TEXT, doc_name TEXT,
                block_id TEXT, section TEXT, page INTEGER, pdf_page INTEGER,
                bbox TEXT, text TEXT)""")
        self.sqlite.commit()

    def _delete_qdrant_document(self, collection: str, doc_id: str):
        if not self.qdrant.collection_exists(collection):
            return
        self.qdrant.delete(
            collection_name=collection,
            points_selector=rest.Filter(
                must=[rest.FieldCondition(key="doc_id", match=rest.MatchValue(value=doc_id))]
            ),
        )

    def _load_bm25_items(self) -> list:
        path = os.path.join(self.cfg["data_dir"], "bm25.json")
        if not os.path.exists(path):
            return []
        try:
            payload = json.load(open(path, encoding="utf-8"))
        except Exception:
            return []
        if "items" in payload:
            return payload["items"]
        # Migrate the old single-document format.
        return [
            {"doc_id": "", "chunk_id": str(i), "text": text, "tokens": payload["tokens"][i]}
            for i, text in enumerate(payload.get("texts", []))
        ]

    def _save_bm25(self, doc_id: str, texts: list, chunk_ids: list):
        items = [item for item in self._load_bm25_items() if item.get("doc_id") != doc_id]
        for text, chunk_id in zip(texts, chunk_ids):
            items.append({
                "doc_id": doc_id,
                "chunk_id": chunk_id,
                "text": text,
                "tokens": list(jieba.cut(text)),
            })
        path = os.path.join(self.cfg["data_dir"], "bm25.json")
        with open(path, "w", encoding="utf-8") as output:
            json.dump({"items": items}, output, ensure_ascii=False)

    def index(self, doc_id, doc_name, chunks, pdf_path=None):
        texts = [c["text"] for c in chunks]
        vecs = self.embedder.encode(texts)
        collection = self.cfg["collection"]

        if not self.qdrant.collection_exists(collection):
            self.qdrant.create_collection(
                collection_name=collection,
                vectors_config=rest.VectorParams(
                    size=vecs.shape[1],
                    distance=rest.Distance.COSINE,
                ),
            )
        else:
            self._delete_qdrant_document(collection, doc_id)

        chunk_ids = [
            str(uuid.uuid5(uuid.NAMESPACE_URL, f"{doc_id}:{chunk.get('block_id') or index}:{chunk['start_page']}"))
            for index, chunk in enumerate(chunks)
        ]
        points = [
            rest.PointStruct(
                id=chunk_ids[index],
                vector=vecs[index].tolist(),
                payload={
                    "section": chunks[index]["section"],
                    "start_page": chunks[index]["start_page"],
                    "block_id": chunks[index].get("block_id", ""),
                    "bbox": chunks[index].get("bbox", []),
                    "doc_id": doc_id,
                    "doc_name": doc_name,
                    "text": chunks[index]["text"],
                },
            )
            for index in range(len(chunks))
        ]
        if points:
            self.qdrant.upsert(collection_name=collection, points=points)

        cur = self.sqlite.cursor()
        cur.execute("DELETE FROM chunks WHERE doc_id=?", (doc_id,))
        cur.execute(
            "INSERT OR REPLACE INTO docs(doc_id, name, pdf_path, chunks_json) VALUES(?,?,?,?)",
            (doc_id, doc_name, pdf_path, json.dumps(chunks, ensure_ascii=False)),
        )
        for chunk_id, chunk in zip(chunk_ids, chunks):
            cur.execute("""INSERT OR REPLACE INTO chunks(
                chunk_id, doc_id, doc_name, block_id, section, page, pdf_page,
                bbox, text) VALUES(?,?,?,?,?,?,?,?,?)""",
                (
                    chunk_id,
                    doc_id,
                    doc_name,
                    chunk.get("block_id", ""),
                    chunk["section"],
                    chunk["start_page"],
                    chunk.get("pdf_page", 0),
                    json.dumps(chunk.get("bbox", [])),
                    chunk["text"],
                ),
            )
        self.sqlite.commit()
        self._save_bm25(doc_id, texts, chunk_ids)
        return len(chunks)

    def delete_document(self, doc_id: str) -> bool:
        cur = self.sqlite.cursor()
        existing = cur.execute("SELECT 1 FROM docs WHERE doc_id=?", (doc_id,)).fetchone()
        if not existing:
            return False
        self._delete_qdrant_document(self.cfg["collection"], doc_id)
        cur.execute("DELETE FROM chunks WHERE doc_id=?", (doc_id,))
        cur.execute("DELETE FROM docs WHERE doc_id=?", (doc_id,))
        self.sqlite.commit()
        items = [item for item in self._load_bm25_items() if item.get("doc_id") != doc_id]
        with open(os.path.join(self.cfg["data_dir"], "bm25.json"), "w", encoding="utf-8") as output:
            json.dump({"items": items}, output, ensure_ascii=False)
        return True
