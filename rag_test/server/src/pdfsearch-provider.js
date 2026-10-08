function joinUrl(baseUrl, path) {
  return `${String(baseUrl || '').replace(/\/+$/, '')}/${String(path || '').replace(/^\/+/, '')}`;
}

export function createPdfSearchProvider({ baseUrl, apiKey = '' }) {
  async function request(path, options = {}) {
    const response = await fetch(joinUrl(baseUrl, path), {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { detail: text };
    }
    if (!response.ok) {
      const error = new Error(payload?.detail || payload?.message || `pdf-search HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function exact(query, topK = 8) {
    return request('/v1/search/exact', {
      method: 'POST',
      body: JSON.stringify({ query, top_k: topK }),
    });
  }

  async function hybrid(query, topK = 8) {
    return request('/v1/search/hybrid', {
      method: 'POST',
      body: JSON.stringify({ query, top_k: topK }),
    });
  }

  async function health() {
    return request('/health');
  }

  return { exact, hybrid, health };
}
