# 技术链路说明

## 1. 入库

1. 前端上传 PDF 到 RAGFlow。
2. RAGFlow 根据数据集配置选择 `PaddleOCR` 解析器。
3. RAGFlow 将 PDF 以 Base64 发送给本机 PP-StructureV3 服务。
4. PP-StructureV3 返回版面、表格、图片、图表和 Markdown/JSON。
5. RAGFlow 根据结构化结果切块，并调用 BGE-M3 生成向量。
6. Elasticsearch 同时保存全文和向量。

## 2. 精确查找

前端调用知索网关的 `/api/exact-search`。网关先通过 RAGFlow API 校验数据集归属，再直接查询 RAGFlow 自己的 Elasticsearch 索引：

```text
ragflow_{tenant_id}
filter: kb_id = dataset_id
```

查询同时使用中文 n-gram、数字/编号通配符和 RAGFlow 的 `content_ltks` 字段，因此不需要额外配置聊天模型。适合：

- 发票号
- 合同编号
- 人名、公司名、税号
- 金额、日期、指标数字

## 3. 相似性查找

前端向 RAGFlow `/api/v1/retrieval` 发送：

```json
{
  "keyword": false,
  "vector_similarity_weight": 1,
  "similarity_threshold": 0.2
}
```

BGE-M3 召回语义相近的段落，再由 RAGFlow 综合排序。

## 4. 表格、图片和图表

- 表格：PP-StructureV3 输出结构化 HTML/Markdown 和单元格信息。
- 图片：保留在页面中，图片文字由 OCR 提取。
- 图表：PP-StructureV3 的图表理解输出描述或表格，前端结果保留来源文档和位置。
- 精确数字：建议 UI 同时展示 PDF 原页，避免只依赖 VLM 描述。
