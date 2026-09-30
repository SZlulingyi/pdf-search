# PDF Chat Agent

这是一个独立的 Chat Agent 前端/BFF，不依赖兄弟目录的 Python 包，只通过 HTTP 调后端工具接口。

## 本地验证

```bash
cd chat-agent
cp .env.example .env.local
npm install
npm run dev
```

打开：

```text
http://localhost:3000
```

默认配置是 mock 模式，不需要 OCR、BGE、Qwen 或后端：

```env
AGENT_MOCK=true
AGENT_MOCK_LLM=true
```

输入：

```text
搜索 氮化镓
```

右侧会显示工具调用和带页码、block_id、bbox、高亮的引用卡片。

## Docker 本地验证

在仓库根目录执行：

```bash
AGENT_MOCK=true AGENT_MOCK_LLM=true docker compose -f docker-compose.chat-agent.yml up --build
```

访问 `http://localhost:3000`。

## 接真实服务

```env
AGENT_MOCK=false
AGENT_MOCK_LLM=false
BACKEND_BASE_URL=http://他的后端地址
QWEN_BASE_URL=http://Qwen地址/v1
QWEN_API_KEY=xxx
QWEN_MODEL=实际模型名
```

预期后端工具接口：

```text
POST /v1/search/exact
POST /v1/search/hybrid
POST /v1/review/word
GET  /v1/documents/{doc_id}/blocks/{block_id}
GET  /v1/documents/{doc_id}/pages/{page}/image
```

## Agent 编排

`lib/agent.ts` 负责：

1. 调用 Qwen Chat Completions；
2. 解析 tool_calls；
3. 通过 `lib/tools.ts` 调用后端；
4. 把工具结果回填给模型；
5. 汇总引用证据。

`lib/tools.ts` 中的工具定义是双方接口契约的核心。
