# 知索 · 中文 PDF 知识库桌面版

当前版本已适配 **pdf-search FastAPI**：前端仍保留知索控制台，检索和问答由 pdf-search 提供。历史 RAGFlow 集成代码与脚本保留在 `ragflow/` 和 `scripts/`。

它把复杂中文 PDF 拆成两条检索通道：

- **精确查找**：关键词、短语、数值、发票号等命中。
- **相似性查找**：BGE-M3 向量召回，适合问答式、模糊表达和语义近似。

前端是独立的中文桌面控制台，检索、页码、段落、bbox 和引用由 pdf-search FastAPI 提供。

## 接入 pdf-search

先启动 pdf-search FastAPI（默认 `http://127.0.0.1:8000`）：

```bash
pdfsearch serve --host 0.0.0.0 --port 8000
```

再启动当前 Chat 前端：

```bash
cd rag_test
npm install
PDFSEARCH_BASE_URL=http://127.0.0.1:8000 npm run dev
```

浏览器访问：

```text
http://127.0.0.1:8787
```

当前 BFF 使用以下 pdf-search 接口：

```text
GET  /health
POST /v1/search/exact
POST /v1/search/hybrid
```

注意：pdf-search 当前 FastAPI 没有上传/索引入口。请先通过 `pdfsearch index <pdf>` 完成入库，再在前端提问。

## Web 功能

当前 Web 版包含：

```text
PostgreSQL 用户登录
会话列表、重命名、删除
消息和引用持久化
PDF 上传并自动索引
流式聊天 SSE
PDF 页面预览和 bbox 高亮
```

流式聊天接口：

```text
POST /api/chat/stream
```

PDF 上传入口沿用前端知识库上传按钮，后端自动调用 pdf-search：

```text
POST /v1/documents/index
```

## Qdrant Server

Web 多进程部署建议使用 Qdrant Server，避免本地文件锁冲突：

```yaml
qdrant_url: "http://127.0.0.1:6333"
qdrant_api_key: ""
```

未配置 `qdrant_url` 时仍使用本地 `qdrant_path`。

## 会话存储

Web 版使用 PostgreSQL 保存：

```text
conversations
messages
message_citations
```

启动数据库：

```bash
docker compose -f docker-compose.postgres.yml up -d
```

配置：

```env
DATABASE_URL=postgres://zhisuo:zhisuo@127.0.0.1:5432/zhisuo
```

前端不再使用 localStorage 作为正式会话存储。会话、消息、页码、block_id、bbox 和引用都会写入 PostgreSQL。

## 架构

```text
浏览器（React + Vite 控制台）
        │
        ▼
rag_test/server（BFF / 登录 / 结果转换）
        │
        ▼
pdf-search FastAPI
  ├─ /v1/search/exact
  ├─ /v1/search/hybrid
  ├─ /v1/documents/{doc_id}/blocks/{block_id}
  └─ /v1/documents/{doc_id}/pages/{page}/image
        │
        ▼
Qdrant + SQLite + BM25
  ├─ BGE-M3 向量
  └─ PyMuPDF / OCR 解析结果
```

## 目录

```text
zhisuo-kb/
├── ragflow/                  RAGFlow v0.27.2 Docker Compose
├── scripts/
│   ├── kbctl.sh              统一控制脚本
│   ├── paddleocr-up.sh       安装并启动 PP-StructureV3
│   ├── paddleocr-down.sh
│   ├── ragflow-up.sh
│   └── ragflow-down.sh
├── server/                   API Key 安全的本地代理网关
├── web/                      React + Vite 中文控制台
└── .env.example              本地端口和地址
```

## 启动

### 0. 前置条件

- macOS / Linux
- Docker Desktop
- Node.js 20+
- `uv`
- 建议至少 32 GB 内存；BGE-M3 和 Elasticsearch 同时运行比较占资源

### 1. 安装前端依赖

```bash
cd zhisuo-kb
./scripts/kbctl.sh setup
```

### 2. 启动 PaddleOCR、RAGFlow、Elasticsearch 和 BGE-M3

```bash
./scripts/kbctl.sh up
```

首次启动会：

1. 下载 RAGFlow、Elasticsearch、MySQL、Redis、MinIO 和 TEI 镜像。
2. 创建 Python 虚拟环境并安装 PaddleOCR/PaddlePaddle。
3. 下载 PP-StructureV3 模型。
4. 下载 `BAAI/bge-m3` 并启动 TEI。

首次启动耗时较长，后续会使用本地缓存。

### 3. 打开自定义前端控制台

上一步的 `up` 会在后台启动自定义控制台。也可以用下面命令单独管理：

```bash
./scripts/kbctl.sh console-up
./scripts/kbctl.sh console-down
```

访问：

- 知索控制台：http://127.0.0.1:8787
- RAGFlow 原生控制台：http://127.0.0.1:8081
- RAGFlow API：http://127.0.0.1:9380
- PaddleOCR：http://127.0.0.1:8080
- BGE-M3 / TEI：http://127.0.0.1:6380

## 登录

知索控制台自带登录页，默认账号为：

```text
账号：admin
密码：admin
```

可在 `.env` 中修改：

```bash
CONSOLE_USER=admin
CONSOLE_PASSWORD=your-password
```

修改后执行 `./scripts/kbctl.sh console-down && ./scripts/kbctl.sh console-up` 重启控制台。

## 首次配置

RAGFlow 的 Docker 环境会自动注册：

- PDF 解析器：`PaddleOCR`
- PaddleOCR 算法：`PP-StructureV3`
- 默认 embedding：`BAAI/bge-m3`
- PP-StructureV3：已启用表格、印章、公式和图表解析

你还需要在 RAGFlow 原生控制台做一次用户初始化：

1. 打开 http://127.0.0.1:8081
2. 注册首个账号
3. 进入 **API** 页面创建 API Key
4. 回到知索控制台 http://127.0.0.1:8787
5. 将 API Key 粘贴到“连接 RAGFlow”

API Key 只保存在当前浏览器的 `localStorage`，不会写入服务端配置。

## 使用流程

> 知索采用单知识库模式。连接 RAGFlow 后，系统会自动准备唯一资料库，用户不需要选择或创建知识库。

1. 一次拖入多个 PDF，或以后分批继续追加。
2. 上传完成后会自动提交 PP-StructureV3 解析和 BGE-M3 向量化。
3. 等待状态从“待解析”变成“已入库”。
4. 输入问题，点击“同时查找”。
5. 左栏查看精确命中，右栏查看语义相似结果。

已经完成的文档不会因为新增一批 PDF 而重复解析。解析失败或取消的文档可以用“重试失败”按钮统一处理。

自动创建的默认知识库使用以下解析配置：

```json
{
  "layout_recognize": "PaddleOCR",
  "paddleocr_algorithm": "PP-StructureV3",
  "chunk_token_num": 512
}
```

## 停止与日志

```bash
./scripts/kbctl.sh status
./scripts/kbctl.sh logs
./scripts/kbctl.sh paddle-logs
./scripts/kbctl.sh down
```

## 说明

- RAGFlow 负责知识库、全文/向量索引、向量检索和引用。
- 自定义网关直接读取 RAGFlow 的 Elasticsearch，实现不依赖聊天模型的精确 BM25/短语检索。
- PaddleOCR 作为独立服务运行，RAGFlow 通过 `PADDLEOCR_API_URL` 调用。
- BGE-M3 通过 RAGFlow 的 `tei-cpu` profile 自动注册。
- 图表中的精确数值仍然建议保留原页面截图并做人工抽检，VLM 对复杂图表数值可能产生偏差。
