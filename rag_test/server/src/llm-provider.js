function chatCompletionsUrl(baseUrl) {
  return `${String(baseUrl || '').replace(/\/$/, '')}/chat/completions`;
}

function parseSseData(raw) {
  const lines = String(raw || '').split('\n');
  const values = [];
  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    const value = line.slice(5).trim();
    if (value) values.push(value);
  }
  return values;
}

export function createLlmProvider({ baseUrl, apiKey, model }) {
  const enabled = Boolean(baseUrl && model);

  function headers() {
    return {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    };
  }

  async function complete(messages, options = {}) {
    if (!enabled) throw new Error('LLM is not configured');
    const response = await fetch(chatCompletionsUrl(baseUrl), {
      method: 'POST',
      headers: headers(),
      signal: options.signal,
      body: JSON.stringify({
        model,
        temperature: options.temperature ?? 0.1,
        max_tokens: options.maxTokens,
        messages,
      }),
    });
    const payload = await response.json().catch(() => null);
    const answer = payload?.choices?.[0]?.message?.content;
    if (!response.ok || !answer) {
      throw new Error(payload?.error?.message || payload?.message || `LLM request failed: HTTP ${response.status}`);
    }
    return String(answer).trim();
  }

  async function stream(messages, onToken, options = {}) {
    if (!enabled) throw new Error('LLM is not configured');
    const response = await fetch(chatCompletionsUrl(baseUrl), {
      method: 'POST',
      headers: headers(),
      signal: options.signal,
      body: JSON.stringify({
        model,
        temperature: options.temperature ?? 0.1,
        max_tokens: options.maxTokens,
        stream: true,
        messages,
      }),
    });
    if (!response.ok || !response.body) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error?.message || payload?.message || `LLM request failed: HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let answer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';
      for (const event of events) {
        for (const data of parseSseData(event)) {
          if (data === '[DONE]') continue;
          let payload;
          try {
            payload = JSON.parse(data);
          } catch {
            continue;
          }
          const delta = payload?.choices?.[0]?.delta?.content;
          if (delta) {
            answer += delta;
            onToken?.(String(delta));
          }
        }
      }
    }
    return answer;
  }

  return { enabled, complete, stream };
}
