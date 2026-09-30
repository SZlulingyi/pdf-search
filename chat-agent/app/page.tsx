"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { AgentResponse, ChatMessage, Reference, ToolResult } from "@/lib/types";

interface Health {
  status: string;
  mock: boolean;
  backendBaseUrl: string;
  qwenConfigured: boolean;
}

export default function HomePage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "你好，我是 PDF 检索 Agent。你可以说“搜索 氮化镓”，也可以问自然语言问题。",
    },
  ]);
  const [toolResults, setToolResults] = useState<ToolResult[]>([]);
  const [references, setReferences] = useState<Reference[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((response) => response.json())
      .then((payload: Health) => setHealth(payload))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const content = input.trim();
    if (!content || loading) {
      return;
    }

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });
      const payload = (await response.json()) as AgentResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setMessages([...nextMessages, payload.message]);
      setToolResults(payload.toolResults || []);
      setReferences(payload.references || []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>PDF Chat Agent</h1>
          <p>检索、证据定位和审核任务入口</p>
        </div>
        <div className={`status ${health?.mock ? "mock" : "live"}`}>
          {health ? (health.mock ? "Mock 模式" : "真实后端") : "连接中"}
        </div>
      </header>

      <section className="workspace">
        <div className="chat-panel">
          <div className="messages">
            {messages.map((message, index) => (
              <article key={`${message.role}-${index}`} className={`bubble ${message.role}`}>
                <div className="role">{message.role === "user" ? "你" : "Agent"}</div>
                <div className="content">{message.content}</div>
              </article>
            ))}
            {loading ? (
              <article className="bubble assistant">
                <div className="role">Agent</div>
                <div className="content">正在调用工具并整理证据...</div>
              </article>
            ) : null}
            <div ref={bottomRef} />
          </div>

          {error ? <div className="error">{error}</div> : null}

          <form className="composer" onSubmit={sendMessage}>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="例如：搜索 氮化镓"
              disabled={loading}
            />
            <button type="submit" disabled={loading || !input.trim()}>
              发送
            </button>
          </form>
        </div>

        <aside className="evidence-panel">
          <div className="panel-title">工具调用</div>
          {toolResults.length ? (
            toolResults.map((tool) => (
              <div key={tool.id} className="tool-card">
                <strong>{tool.name}</strong>
                <span>{tool.isError ? "失败" : "成功"}</span>
              </div>
            ))
          ) : (
            <p className="muted">还没有工具调用。</p>
          )}

          <div className="panel-title">引用证据</div>
          {references.length ? (
            references.map((reference, index) => (
              <ReferenceCard key={`${reference.block_id}-${index}`} reference={reference} />
            ))
          ) : (
            <p className="muted">搜索后会在这里显示页码、段落和 bbox。</p>
          )}

          {health ? (
            <div className="debug">
              <div>后端：{health.backendBaseUrl}</div>
              <div>Qwen：{health.qwenConfigured ? "已配置" : "未配置"}</div>
            </div>
          ) : null}
        </aside>
      </section>
    </main>
  );
}

function ReferenceCard({ reference }: { reference: Reference }) {
  const text = reference.text || "";
  const start = reference.highlight?.start ?? -1;
  const end = reference.highlight?.end ?? -1;
  const hasHighlight = start >= 0 && end > start && end <= text.length;

  return (
    <article className="reference-card">
      <div className="reference-meta">
        <span>第 {reference.page ?? "?"} 页</span>
        <span>{reference.section || "未知章节"}</span>
      </div>
      <p>
        {hasHighlight ? (
          <>
            {text.slice(0, start)}
            <mark>{text.slice(start, end)}</mark>
            {text.slice(end)}
          </>
        ) : (
          text || "无原文"
        )}
      </p>
      <div className="reference-footer">
        <span>{reference.block_id || reference.doc_id || "unknown"}</span>
        {reference.bbox?.length ? <span>bbox: {reference.bbox.join(", ")}</span> : null}
      </div>
    </article>
  );
}
