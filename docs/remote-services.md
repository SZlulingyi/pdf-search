# 远程 OCR / BGE 接入说明

现有项目支持把 OCR 和 BGE 模型放在其他机器，通过 FastAPI/HTTP 调用。

## 配置

复制 `config.http.example.yaml` 为 `config.yaml`，填写：

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
```

## BGE 接口

请求：

```http
POST /v1/embeddings
Authorization: Bearer <key>
Content-Type: application/json
```

```json
{
  "model": "bge-m3",
  "input": ["文本一", "文本二"]
}
```

响应至少包含：

```json
{
  "data": [
    {"index": 0, "embedding": [0.01, -0.02]},
    {"index": 1, "embedding": [0.03, 0.04]}
  ],
  "model": "bge-m3"
}
```

客户端也兼容 `embeddings`、`vectors` 和 `result` 包装。

## OCR 接口

请求：

```http
POST /v1/ocr
Authorization: Bearer <key>
Content-Type: multipart/form-data
```

文件字段默认是 `file`，可以配置：

```yaml
ocr:
  file_field: "file"
```

推荐响应：

```json
{
  "pages": [
    {
      "page": 5,
      "lines": [
        {
          "text": "本项目采用氮化镓材料",
          "bbox": [120, 330, 430, 380],
          "confidence": 0.98
        }
      ]
    }
  ]
}
```

客户端也兼容：

- `result.pages`
- 单页 `lines`
- `rec_text`、`score`
- `poly`、`polygon`、`points` 坐标
- `page_index` 从 0 开始

## 本地模式

如果远程服务暂时不可用，把配置改回：

```yaml
embed:
  provider: "local"
ocr:
  provider: "local"
```

本地 BGE 使用 `model_dir`，本地 OCR 使用 PaddleOCR。

## 注意

1. 建索引和查询必须使用同一个 BGE 模型及同一维度。
2. 如果 OCR 不返回 `bbox`，仍可显示文本段落，但不能在 PDF 页面上精确框选。
3. 远程 OCR 建议在 PDF 入库阶段调用，不要每次检索都重新 OCR。
