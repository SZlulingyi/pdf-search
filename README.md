# pdfsearch

PDF → Markdown → 分段 → 向量化 → 混合检索的企业级文档检索引擎。

面向"解析 PDF 后按关键词/相似度检索、并定位到具体页码段落"的场景（如 HR 简历、申报材料）。

## 特性

- **PDF → Markdown**：基于 PyMuPDF，保留标题层级、表格、图片引用，并记录每块的页码与坐标。
- **扫描页 OCR 双轨**：文本页走解析，扫描页走 PaddleOCR（`ocr` extra）。
- **Markdown 标题分块**：按标题层级切分，保留页码与章节元数据。
- **混合检索**：BGE-M3 稠密相似度 + BM25 关键词 + RRF 融合。
- **企业级结构**：`src/` 布局、`pyproject.toml`、类型标注、CLI。

## 安装

```bash
pip install -e .            # 核心
pip install -e ".[ocr]"     # 需要扫描页 OCR 时
```

依赖的 BGE-M3 模型通过 `config.yaml` 的 `model_dir` 指向本地目录（可用 ModelScope 下载 `BAAI/bge-m3`）。

## 使用

```bash
# 索引（PDF -> Markdown -> 分块 -> 向量化）
pdfsearch index "F:/path/to/xxx.pdf"

# 检索（返回页码 + 章节 + 段落）
pdfsearch query "碳纳米管晶圆 工艺开发"
```

输出示例：

```
[第32页|四、项目信息] 项目名称 面向存算一体AI芯片的碳纳米管晶圆和工艺开发
[第36页|四、项目信息] 考核指标 实现8英寸碳纳米管阵列晶圆的量产...
[第19页|二、团队情况] 王慧 从事碳纳米管晶圆研发及工程化制备...
```

## 架构

```
PDF
 ├─ 文本页 ── parse.py (PyMuPDF) ── Markdown + 块(page/bbox/标题)
 ├─ 扫描页 ── ocr.py   (PaddleOCR) ── 文字（双轨）
        │
        ▼
   chunk.py ── 标题层级分块，保留页码/章节
        │
        ▼
   embed.py (BGE-M3) ── 稠密向量
        │
        ▼
   index.py ── Qdrant + SQLite + BM25
        │
        ▼
   search.py ── 相似度 + 关键词 + RRF ── 页码/章节/段落
```

## 配置

`config.yaml` 关键项：

| 项 | 说明 |
|---|---|
| `model_dir` | BGE-M3 本地模型目录 |
| `pdf_dir` | 批量索引的 PDF 目录 |
| `embed.device` | `cpu` / `cuda`（GPU 显著加速） |
| `chunk.max_chars` | 分块最大长度 |
| `ocr.enabled` | 是否启用扫描页 OCR |

## 性能说明

- 文本提取：PyMuPDF 单页毫秒级；`find_tables` 是主要耗时点。
- 向量化：BGE-M3 在 **CPU 上较慢**（千级 chunk 约十几分钟），强烈建议 `embed.device: cuda`（3060 可提速约 10~50 倍）。
- 千份 PDF 建议离线批量 + 断点续跑（后续版本补充）。

## License

MIT
