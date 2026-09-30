export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  role: Role;
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolResult {
  id: string;
  name: string;
  result: unknown;
  isError?: boolean;
}

export interface Reference {
  doc_id?: string;
  file_name?: string;
  page?: number;
  block_id?: string;
  section?: string;
  text?: string;
  highlight?: {
    start: number;
    end: number;
  };
  bbox?: number[];
  score?: number;
}

export interface AgentResponse {
  message: ChatMessage;
  toolResults: ToolResult[];
  references: Reference[];
  mode: "mock" | "qwen";
}

export interface HealthResponse {
  status: "ok";
  mock: boolean;
  backendBaseUrl: string;
  qwenConfigured: boolean;
}
