import { config, joinUrl } from "./config";
import { executeTool, TOOL_DEFINITIONS } from "./tools";
import { extractReferences } from "./backend";
import type { AgentResponse, ChatMessage, Reference, ToolCall, ToolResult } from "./types";

const SYSTEM_PROMPT = `你是一个 PDF 文档检索 Agent。
你必须先调用工具获取证据，再回答用户问题。
不要编造页码、段落、文件名或引用。
工具结果必须包含 doc_id、page、block_id、text、bbox 时，要在回答中保留这些引用信息。
如果用户只是问候，可以直接回答。
如果工具没有找到证据，明确说“未找到匹配内容”。
回答使用中文，简洁但可追溯。`;

export async function runAgent(messages: ChatMessage[]): Promise<AgentResponse> {
  const cleanMessages = normalizeMessages(messages);
  if (config.agentMockLlm || !config.qwenBaseUrl) {
    return runDeterministicAgent(cleanMessages);
  }

  const working: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...cleanMessages,
  ];
  const toolResults: ToolResult[] = [];
  const references: Reference[] = [];

  for (let step = 0; step < config.maxSteps; step += 1) {
    const assistant = await callQwen(working);
    if (!assistant.tool_calls?.length) {
      return {
        message: { role: "assistant", content: assistant.content || "" },
        toolResults,
        references: dedupeReferences(references),
        mode: "qwen",
      };
    }

    working.push(assistant);
    for (const call of assistant.tool_calls) {
      const executed = await executeToolCall(call);
      toolResults.push(executed);
      references.push(...extractReferences(executed.result));
      working.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.function.name,
        content: JSON.stringify(executed.result),
      });
    }
  }

  return {
    message: {
      role: "assistant",
      content: "已达到最大工具调用轮次，请缩小问题范围或指定文档。",
    },
    toolResults,
    references: dedupeReferences(references),
    mode: "qwen",
  };
}

async function callQwen(messages: ChatMessage[]): Promise<ChatMessage> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.qwenTimeoutMs);
  try {
    const response = await fetch(joinUrl(config.qwenBaseUrl, "/chat/completions"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.qwenApiKey}`,
      },
      body: JSON.stringify({
        model: config.qwenModel,
        messages,
        tools: TOOL_DEFINITIONS,
        tool_choice: "auto",
        temperature: 0.1,
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Qwen ${response.status}: ${body.slice(0, 500)}`);
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: ChatMessage }>;
    };
    const message = payload.choices?.[0]?.message;
    if (!message) {
      throw new Error("Qwen response missing choices[0].message");
    }
    return message;
  } finally {
    clearTimeout(timeout);
  }
}

async function executeToolCall(call: ToolCall): Promise<ToolResult> {
  try {
    const result = await executeTool(call.function.name, call.function.arguments);
    return { id: call.id, name: call.function.name, result };
  } catch (error) {
    return {
      id: call.id,
      name: call.function.name,
      result: { error: error instanceof Error ? error.message : String(error) },
      isError: true,
    };
  }
}

async function runDeterministicAgent(messages: ChatMessage[]): Promise<AgentResponse> {
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  const query = extractQuery(lastUser?.content || "");
  const toolResults: ToolResult[] = [];
  const references: Reference[] = [];

  const exact = await executeToolCall({
    id: "mock-exact",
    type: "function",
    function: { name: "search_exact", arguments: JSON.stringify({ query, top_k: 10 }) },
  });
  toolResults.push(exact);
  references.push(...extractReferences(exact.result));

  if (references.length === 0) {
    const hybrid = await executeToolCall({
      id: "mock-hybrid",
      type: "function",
      function: { name: "search_hybrid", arguments: JSON.stringify({ query, top_k: 10 }) },
    });
    toolResults.push(hybrid);
    references.push(...extractReferences(hybrid.result));
  }

  const unique = dedupeReferences(references);
  const content =
    unique.length === 0
      ? `未找到与“${query}”匹配的内容。`
      : `找到 ${unique.length} 条与“${query}”相关的证据，已附上页码、段落和高亮位置，请在右侧引用区查看。`;

  return {
    message: { role: "assistant", content },
    toolResults,
    references: unique,
    mode: "mock",
  };
}

function extractQuery(content: string): string {
  const value = content.trim();
  const match = value.match(/(?:搜索|查找|检索|查一下|查询)\s*[：:]?\s*(.+)$/);
  if (match?.[1]) {
    return match[1].trim().replace(/[。！!？?]+$/, "");
  }
  return value || "氮化镓";
}

function normalizeMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-12)
    .map((message) => ({
      role: message.role,
      content: typeof message.content === "string" ? message.content : "",
    }));
}

function dedupeReferences(references: Reference[]): Reference[] {
  const seen = new Set<string>();
  const output: Reference[] = [];
  for (const reference of references) {
    const key = [
      reference.doc_id || "",
      reference.page || "",
      reference.block_id || "",
      reference.highlight?.start ?? "",
      reference.highlight?.end ?? "",
    ].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(reference);
  }
  return output.slice(0, 20);
}
