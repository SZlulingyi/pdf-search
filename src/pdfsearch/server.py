# -*- coding: utf-8 -*-
"""FastAPI 后端：暴露检索/文档/审核工具接口给 chat-agent。"""
import base64
import os
import uuid
from pathlib import Path

import fitz
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .config import load_config
from .search import Searcher
from .service import index_pdf


app = FastAPI(title="pdfsearch-backend", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class SearchRequest(BaseModel):
    query: str
    top_k: int = 10


class ReviewRequest(BaseModel):
    file_name: str


_searcher = None


def get_config() -> dict:
    cfg_path = os.environ.get("PDFSEARCH_CONFIG", "config.yaml")
    return load_config(cfg_path)


def get_searcher() -> Searcher:
    global _searcher
    if _searcher is None:
        _searcher = Searcher(get_config())
    return _searcher


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/v1/search/exact")
def search_exact(req: SearchRequest):
    results = get_searcher().search_exact(req.query, req.top_k)
    return {"query": req.query, "results": results}


@app.post("/v1/search/hybrid")
def search_hybrid(req: SearchRequest):
    results = get_searcher().search(req.query, req.top_k)
    return {"query": req.query, "results": results}


@app.post("/v1/documents/index")
async def index_document(file: UploadFile = File(...)):
    cfg = get_config()
    upload_dir = os.path.join(cfg["data_dir"], "uploads")
    os.makedirs(upload_dir, exist_ok=True)
    safe_name = Path(file.filename or "upload.pdf").name
    target = os.path.join(upload_dir, f"{uuid.uuid4().hex}_{safe_name}")
    try:
        with open(target, "wb") as output:
            while chunk := await file.read(1024 * 1024):
                output.write(chunk)
        return index_pdf(cfg, target)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/v1/documents/{doc_id}/blocks/{block_id}")
def get_document_block(doc_id: str, block_id: str):
    block = get_searcher().get_block(doc_id, block_id)
    if not block:
        raise HTTPException(status_code=404, detail="block not found")
    return block


@app.get("/v1/documents/{doc_id}/pages/{page}/image")
def render_document_page(doc_id: str, page: int):
    s = get_searcher()
    pdf_path = s.get_doc_path(doc_id)
    if not pdf_path or not os.path.exists(pdf_path):
        raise HTTPException(status_code=404, detail="document not found")
    pdf_page = s.get_pdf_page(doc_id, page)
    if pdf_page is None:
        pdf_page = page - 1
    doc = fitz.open(pdf_path)
    try:
        if pdf_page < 0 or pdf_page >= len(doc):
            raise HTTPException(status_code=404, detail="page not found")
        rendered = doc[pdf_page]
        pix = rendered.get_pixmap(dpi=150)
        data = base64.b64encode(pix.tobytes("png")).decode()
        return {
            "doc_id": doc_id,
            "page": page,
            "image": "data:image/png;base64," + data,
            "width": pix.width,
            "height": pix.height,
            "page_width": rendered.rect.width,
            "page_height": rendered.rect.height,
        }
    finally:
        doc.close()


@app.post("/v1/review/word")
def review_word(req: ReviewRequest):
    # 一致性审核（HR 改动 vs 原始 PDF）——TODO：接入 Word 解析与字段级 diff
    return {
        "task_id": str(uuid.uuid4()),
        "status": "pending",
        "file_name": req.file_name,
        "issues": [],
    }
