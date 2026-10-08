# RAG 适配边界与接口约定

## 1. 职责边界

RAG 同事负责：

- 文档切块、索引、向量和召回
- 精确检索与语义检索
- 返回文档、页码、片段和原始证据定位信息

知索前端与网关负责：

- 文件上传、解析进度、重试和删除交互
- PDF/Word 的录入编排（Excel 上传入口已移除）
- 前端只上传原始文件，不按页拆分 PDF；原文件、页面坐标和全局页码由 RAG 服务维护
- LLM 接口适配、流式回答和失败回退
- 检索结果结构化、差异分析和格式转写
- PDF 证据打开、Excel/Word/Markdown 导出
- 登录、会话、任务状态和最终交付界面

前端不得直接依赖 RAG 同事的接口格式。所有 RAG 能力统一由网关适配后暴露给前端。

## 2. 网关对前端的稳定接口

### 精确检索

`POST /api/exact-search`

```json
{
  "datasetId": "string",
  "query": "string",
  "pageSize": 10
}
```

返回统一结构：

```json
{
  "code": 0,
  "data": {
    "chunks": [
      {
        "id": "chunk-id",
        "content": "命中原文",
        "highlight": "带 <em> 标记的原文",
        "document_id": "document-id",
        "document_keyword": "文件名.pdf",
        "dataset_id": "dataset-id",
        "similarity": 0.93,
        "term_similarity": 0.93,
        "vector_similarity": 0,
        "positions": [1]
      }
    ],
    "total": 1
  }
}
```

### 相似检索

由 `/api/chat` 内部调用，统一返回相同 `chunks` 结构。相似检索必须提供：

- `content`
- `document_id`
- `document_keyword`
- `similarity`
- `positions`

可选增强字段：

- `vector_similarity`
- `term_similarity`
- `page_image_url`
- `bbox`
- `element_type`
- `field_values`

## 3. RAG Provider 最小接口

网关内部适配器需要实现：

```ts
interface RagProvider {
  exactSearch(input: SearchInput): Promise<SearchResult>;
  semanticSearch(input: SearchInput): Promise<SearchResult>;
}
```

未来接入其他 RAG 服务时，只替换 Provider，不修改：

- 前端 Chat
- 检索结果表
- 相似差异视图
- 格式转写
- Office 导出

## 4. 可选的全页证据接口

为了支持 PDF 原页、bbox、截图和置信度，RAG Provider 后续应补充：

```json
{
  "document_id": "document-id",
  "page": 3,
  "page_image_url": "/api/assets/page/...",
  "blocks": [
    {
      "id": "block-id",
      "type": "text|table|image|chart|seal|formula",
      "bbox": [10, 20, 300, 400],
      "content": "文本或结构化内容",
      "confidence": 0.97
    }
  ]
}
```

没有这些字段时，前端仍能展示 chunk 级别证据和原 PDF 页码；字段出现后无需改变页面结构。

## 5. 生成式能力

LLM 服务由外部团队部署和运维，包括模型、GPU、推理框架、并发和可用性。知索不负责模型部署，只负责：

- 配置 OpenAI-compatible Base URL、模型名和 API Key
- 流式 token 转发和前端展示
- 超时、失败和降级回退
- 组装回答、差异分析和格式转写提示词

其他业务能力由知索网关统一封装：

- 回答生成：`/api/chat`
- 流式回答：网关转发 token 事件
- 差异分析：统一输出差异字段和风险说明
- 格式转写：统一输出 Markdown，再由前端转换为 DOCX/XLSX

这样 RAG 只负责“找出资料”，其余“理解、比对、整理和交付”都由知索侧负责。
