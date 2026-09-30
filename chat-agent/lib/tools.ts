import {
  getDocumentBlock,
  renderDocumentPage,
  reviewWord,
  searchExact,
  searchHybrid,
} from "./backend";

export const TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "search_exact",
      description: "在已入库 PDF 中精确检索关键词，返回页码、段落、高亮 offset 和 bbox。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "要精确检索的关键词" },
          top_k: { type: "integer", description: "最多返回多少条", default: 10 },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_hybrid",
      description: "使用 BGE + BM25/稀疏检索做语义混合检索，返回证据位置。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "自然语言检索问题" },
          top_k: { type: "integer", description: "最多返回多少条", default: 10 },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_document_block",
      description: "读取一个 PDF block 的完整上下文和位置信息。",
      parameters: {
        type: "object",
        properties: {
          doc_id: { type: "string" },
          block_id: { type: "string" },
        },
        required: ["doc_id", "block_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "render_document_page",
      description: "获取指定 PDF 页面的预览图或渲染信息。",
      parameters: {
        type: "object",
        properties: {
          doc_id: { type: "string" },
          page: { type: "integer" },
        },
        required: ["doc_id", "page"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "review_word",
      description: "提交 Word 文件名或文件 ID，启动一致性审核任务。",
      parameters: {
        type: "object",
        properties: {
          file_name: { type: "string" },
        },
        required: ["file_name"],
      },
    },
  },
];

export async function executeTool(name: string, rawArguments: string): Promise<unknown> {
  const args = parseArguments(rawArguments);
  switch (name) {
    case "search_exact":
      return searchExact(String(args.query || ""), Number(args.top_k || 10));
    case "search_hybrid":
      return searchHybrid(String(args.query || ""), Number(args.top_k || 10));
    case "get_document_block":
      return getDocumentBlock(String(args.doc_id || ""), String(args.block_id || ""));
    case "render_document_page":
      return renderDocumentPage(String(args.doc_id || ""), Number(args.page || 1));
    case "review_word":
      return reviewWord(String(args.file_name || ""));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function parseArguments(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    throw new Error(`Invalid tool arguments: ${raw}`);
  }
}
