const DEFAULT_BACKEND_BASE_URL = "http://127.0.0.1:8000";
const DEFAULT_QWEN_BASE_URL = "http://127.0.0.1:8001/v1";

export const config = {
  agentMock: process.env.AGENT_MOCK === "true",
  agentMockLlm: process.env.AGENT_MOCK_LLM === "true",
  backendBaseUrl: (process.env.BACKEND_BASE_URL || DEFAULT_BACKEND_BASE_URL).replace(/\/+$/, ""),
  qwenBaseUrl: (process.env.QWEN_BASE_URL || DEFAULT_QWEN_BASE_URL).replace(/\/+$/, ""),
  qwenApiKey: process.env.QWEN_API_KEY || "EMPTY",
  qwenModel: process.env.QWEN_MODEL || "qwen3.5-7b",
  qwenTimeoutMs: Number(process.env.QWEN_TIMEOUT_MS || 120000),
  maxSteps: Number(process.env.AGENT_MAX_STEPS || 4),
};

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
