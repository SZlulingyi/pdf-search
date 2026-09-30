import { config, joinUrl } from "./config";
import type { Reference } from "./types";
import { mockBlock, mockPage, mockReview, mockSearch } from "./mock";

async function backendFetch(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(joinUrl(config.backendBaseUrl, path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Backend ${response.status}: ${body.slice(0, 500)}`);
  }
  return response.json();
}

export async function searchExact(query: string, topK = 10): Promise<unknown> {
  if (config.agentMock) {
    return mockSearch(query, topK);
  }
  return backendFetch("/v1/search/exact", {
    method: "POST",
    body: JSON.stringify({ query, top_k: topK }),
  });
}

export async function searchHybrid(query: string, topK = 10): Promise<unknown> {
  if (config.agentMock) {
    return mockSearch(query, topK);
  }
  return backendFetch("/v1/search/hybrid", {
    method: "POST",
    body: JSON.stringify({ query, top_k: topK }),
  });
}

export async function getDocumentBlock(docId: string, blockId: string): Promise<unknown> {
  if (config.agentMock) {
    return mockBlock(docId, blockId);
  }
  return backendFetch(
    `/v1/documents/${encodeURIComponent(docId)}/blocks/${encodeURIComponent(blockId)}`,
  );
}

export async function renderDocumentPage(docId: string, page: number): Promise<unknown> {
  if (config.agentMock) {
    return mockPage(docId, page);
  }
  return backendFetch(
    `/v1/documents/${encodeURIComponent(docId)}/pages/${encodeURIComponent(String(page))}/image`,
  );
}

export async function reviewWord(fileName: string): Promise<unknown> {
  if (config.agentMock) {
    return mockReview(fileName);
  }
  return backendFetch("/v1/review/word", {
    method: "POST",
    body: JSON.stringify({ file_name: fileName }),
  });
}

export function extractReferences(result: unknown): Reference[] {
  if (!result) {
    return [];
  }
  if (Array.isArray(result)) {
    return result.filter(isReferenceLike) as Reference[];
  }
  if (typeof result !== "object") {
    return [];
  }
  const record = result as Record<string, unknown>;
  for (const key of ["references", "results", "data", "items"]) {
    if (Array.isArray(record[key])) {
      return (record[key] as unknown[]).filter(isReferenceLike) as Reference[];
    }
  }
  return isReferenceLike(result) ? [result as Reference] : [];
}

function isReferenceLike(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return Boolean(
    record.doc_id ||
      record.docId ||
      record.page ||
      record.block_id ||
      record.blockId ||
      record.text,
  );
}
