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

## 远程 OCR / BGE

默认使用本地模型，也可以通过 HTTP 调用其他机器上的 FastAPI 服务：

```yaml
embed:
  provider: "http"
  base_url: "http://100.64.0.10:8002"
  endpoint: "/v1/embeddings"
  api_key: "bge-key-xxxx"
  model: "bge-m3"

ocr:
  provider: "http"
  base_url: "http://100.64.0.10:8001"
  endpoint: "/v1/ocr"
  api_key: "ocr-key-xxxx"
  page_base: 1
```

完整的接口约定见 [docs/remote-services.md](docs/remote-services.md)。

## Chat Agent

仓库内包含独立的 Chat Agent 前端与 Agent 编排应用，目录：

```text
chat-agent/
```

它不 import Python 检索代码，只通过 HTTP 调后端工具接口。默认 mock 模式可脱离 OCR、BGE、Qwen 和后端独立验证：

```bash
cd chat-agent
npm install
cp .env.example .env.local
npm run dev
```

浏览器访问 `http://localhost:3000`，输入：

```text
搜索 氮化镓
```

也可以从仓库根目录使用 Docker Compose：

```bash
AGENT_MOCK=true AGENT_MOCK_LLM=true docker compose -f docker-compose.chat-agent.yml up --build
```

Agent 工具接口约定见 [chat-agent/README.md](chat-agent/README.md)。

## License

MIT
