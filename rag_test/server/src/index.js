import express from 'express';
import path from 'node:path';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createPdfSearchProvider } from './pdfsearch-provider.js';
import { createLlmProvider } from './llm-provider.js';
import { initDb, checkDb } from './db.js';
import {
  addCitations,
  addMessage,
  createConversation,
  deleteConversation,
  getConversation,
  listConversationsWithMessages,
  loadConversationMessages,
  updateConversation,
} from './conversation-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 8787);
const PDFSEARCH_BASE_URL = process.env.PDFSEARCH_BASE_URL || 'http://127.0.0.1:8000';
const PDFSEARCH_API_KEY = process.env.PDFSEARCH_API_KEY || '';
const CONSOLE_USER = process.env.CONSOLE_USER || 'admin';
const CONSOLE_PASSWORD = process.env.CONSOLE_PASSWORD || 'admin';
const SESSION_COOKIE = 'zhisuo_session';
const VIRTUAL_DATASET_ID = 'pdfsearch';

const app = express();
const sessions = new Map();
const pdfsearch = createPdfSearchProvider({
  baseUrl: PDFSEARCH_BASE_URL,
  apiKey: PDFSEARCH_API_KEY,
});
const llm = createLlmProvider({
  baseUrl: process.env.LLM_BASE_URL || '',
  apiKey: process.env.LLM_API_KEY || '',
  model: process.env.LLM_MODEL || '',
});

try {
  await initDb();
} catch (error) {
  console.error('[zhisuo] PostgreSQL initialization failed:', error);
  process.exit(1);
}

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => {
    const [key, ...rest] = part.trim().split('=');
    return [key, decodeURIComponent(rest.join('=') || '')];
  }).filter(([key]) => key));
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function currentSession(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  const session = token ? sessions.get(token) : null;
  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  return { token, ...session };
}

function requireSession(req, res, next) {
  const session = currentSession(req);
  if (!session) return res.status(401).json({ code: 401, message: '请先登录' });
  req.zhisuoUser = session.user;
  return next();
}

function datasetPayload() {
  return {
    id: VIRTUAL_DATASET_ID,
    name: 'pdf-search 知识库',
    description: '由 pdf-search FastAPI 提供检索能力',
    document_count: 0,
    chunk_count: 0,
    done_count: 0,
    embedding_model: 'BGE-M3',
  };
}

function toFrontendChunk(result, datasetId = VIRTUAL_DATASET_ID) {
  const score = Number(result.score || 0);
  return {
    id: result.block_id || `${result.doc_id || 'doc'}:${result.page || 0}`,
    content: result.text || '',
    highlight: result.text || '',
    document_id: result.doc_id || '',
    document_keyword: result.file_name || result.doc_id || '',
    dataset_id: datasetId,
    similarity: score,
    term_similarity: score,
    vector_similarity: score,
    page: Number(result.page || 0),
    positions: result.page ? [result.page] : [],
    bbox: result.bbox || null,
  };
}


function extractSearchTerm(question) {
  const value = String(question || '').trim();
  const stripped = value
    .replace(/^(请|麻烦|帮我|帮忙)?\s*(搜索|查找|检索|查询|查一下|找一下|搜一下)\s*[：:]?\s*/u, '')
    .replace(/[？?。！!]+$/u, '')
    .trim();
  return stripped || value;
}

function uniqueResults(exact = [], similar = []) {
  const out = [];
  const seen = new Set();
  for (const item of [...exact, ...similar]) {
    const chunk = toFrontendChunk(item);
    const key = `${chunk.document_id}:${chunk.id}:${chunk.content.slice(0, 100)}`;
    if (!chunk.content || seen.has(key)) continue;
    seen.add(key);
    out.push(chunk);
  }
  return out;
}

async function generateAnswer(question, exact, similar) {
  const chunks = uniqueResults(exact, similar);
  if (llm.enabled && chunks.length) {
    const evidence = chunks
      .slice(0, 6)
      .map((chunk, index) => `[${index + 1}] ${chunk.content}`)
      .join('\n\n');
    return llm.complete([
      {
        role: 'system',
        content: '你是知索，一个严谨的中文知识库助手。只能依据检索资料回答；资料不足时明确说明，不要编造。回答简洁，并保留来源信息。',
      },
      { role: 'user', content: `问题：${question}\n\n检索资料：\n${evidence}` },
    ]);
  }
  if (!chunks.length) return '当前 pdf-search 知识库中没有找到相关内容。';
  const primary = chunks[0].content.slice(0, 1200);
  const extra = chunks
    .slice(1, 3)
    .map((chunk) => `- ${chunk.content.slice(0, 260)}`)
    .join('\n');
  return `我在 pdf-search 中找到了以下相关内容：\n\n${primary}${extra ? `\n\n补充信息：\n${extra}` : ''}`;
}

app.post('/api/auth/login', express.json({ limit: '16kb' }), (req, res) => {
  const { username, password } = req.body || {};
  if (!safeEqual(username || '', CONSOLE_USER) || !safeEqual(password || '', CONSOLE_PASSWORD)) {
    return res.status(401).json({ code: 401, message: '账号或密码不正确' });
  }
  const token = randomBytes(32).toString('hex');
  sessions.set(token, { user: CONSOLE_USER, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 });
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
  return res.json({ code: 0, data: { username: CONSOLE_USER } });
});

app.get('/api/auth/session', (req, res) => {
  const session = currentSession(req);
  if (!session) return res.status(401).json({ code: 401, authenticated: false });
  return res.json({ code: 0, authenticated: true, data: { username: session.user } });
});

app.post('/api/auth/logout', (req, res) => {
  const session = currentSession(req);
  if (session) sessions.delete(session.token);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  return res.json({ code: 0 });
});

app.get('/api/health', async (_req, res) => {
  const started = Date.now();
  try {
    await Promise.all([pdfsearch.health(), checkDb()]);
    return res.json({
      ok: true,
      apiKeyConfigured: true,
      checks: [
        {
          id: 'pdf-search',
          label: 'pdf-search FastAPI',
          reachable: true,
          httpStatus: 200,
          latencyMs: Date.now() - started,
          url: PDFSEARCH_BASE_URL,
          detail: '服务可达',
        },
      ],
    });
  } catch (error) {
    return res.json({
      ok: false,
      apiKeyConfigured: true,
      checks: [
        {
          id: 'pdf-search',
          label: 'pdf-search FastAPI',
          reachable: false,
          httpStatus: null,
          latencyMs: Date.now() - started,
          url: PDFSEARCH_BASE_URL,
          detail: String(error?.message || error),
        },
      ],
    });
  }
});

app.get('/api/config', (_req, res) => {
  res.json({ apiKeyConfigured: true, mode: 'pdfsearch' });
});

app.get('/api/setup', (_req, res) => {
  res.json({
    links: { pdfsearchApi: PDFSEARCH_BASE_URL },
    model: { embedding: 'BGE-M3', parser: 'pdf-search backend' },
  });
});

app.get('/api/ragflow/datasets', requireSession, (_req, res) => {
  res.json({ code: 0, data: [datasetPayload()] });
});

app.post('/api/ragflow/datasets', requireSession, (_req, res) => {
  res.json({ code: 0, data: datasetPayload() });
});

app.get('/api/ragflow/datasets/:datasetId/documents', requireSession, (req, res) => {
  if (req.params.datasetId !== VIRTUAL_DATASET_ID) {
    return res.status(404).json({ code: 404, message: 'dataset not found' });
  }
  return res.json({ code: 0, data: { docs: [], total: 0 } });
});

app.post('/api/ragflow/datasets/:datasetId/documents', requireSession, (_req, res) => {
  return res.status(501).json({
    code: 501,
    message: 'pdf-search 当前不提供上传/索引接口，请先通过 pdf-search CLI 或索引流程完成 PDF 入库。',
  });
});

app.post('/api/ragflow/datasets/:datasetId/chunks', requireSession, (_req, res) => {
  return res.status(501).json({
    code: 501,
    message: 'pdf-search 当前不提供远程分块接口，请先通过 pdf-search CLI 或索引流程完成 PDF 入库。',
  });
});

app.get('/api/pdfsearch/documents/:docId/pages/:page/image', requireSession, async (req, res) => {
  try {
    const payload = await pdfsearch.pageImage(req.params.docId, req.params.page);
    return res.json({ code: 0, data: payload });
  } catch (error) {
    return res.status(error?.status || 502).json({ code: error?.status || 502, message: String(error?.message || error) });
  }
});

app.get('/api/pdfsearch/documents/:docId/blocks/:blockId', requireSession, async (req, res) => {
  try {
    const payload = await pdfsearch.block(req.params.docId, req.params.blockId);
    return res.json({ code: 0, data: payload });
  } catch (error) {
    return res.status(error?.status || 502).json({ code: error?.status || 502, message: String(error?.message || error) });
  }
});

app.get('/api/conversations', requireSession, async (req, res) => {
  try {
    const conversations = await listConversationsWithMessages(req.zhisuoUser);
    return res.json({ code: 0, data: conversations });
  } catch (error) {
    return res.status(500).json({ code: 500, message: String(error?.message || error) });
  }
});

app.post('/api/conversations', requireSession, async (req, res) => {
  try {
    const conversation = await createConversation(
      req.zhisuoUser,
      req.body?.title || '新会话',
    );
    return res.json({ code: 0, data: { ...conversation, messages: [] } });
  } catch (error) {
    return res.status(500).json({ code: 500, message: String(error?.message || error) });
  }
});

app.get('/api/conversations/:conversationId', requireSession, async (req, res) => {
  try {
    const conversation = await getConversation(req.zhisuoUser, req.params.conversationId);
    if (!conversation) return res.status(404).json({ code: 404, message: 'conversation not found' });
    const messages = await loadConversationMessages(req.zhisuoUser, conversation.id);
    return res.json({ code: 0, data: { ...conversation, messages } });
  } catch (error) {
    return res.status(500).json({ code: 500, message: String(error?.message || error) });
  }
});

app.patch('/api/conversations/:conversationId', requireSession, async (req, res) => {
  try {
    const conversation = await updateConversation(
      req.zhisuoUser,
      req.params.conversationId,
      req.body || {},
    );
    if (!conversation) return res.status(404).json({ code: 404, message: 'conversation not found' });
    return res.json({ code: 0, data: conversation });
  } catch (error) {
    return res.status(500).json({ code: 500, message: String(error?.message || error) });
  }
});

app.delete('/api/conversations/:conversationId', requireSession, async (req, res) => {
  try {
    const deleted = await deleteConversation(req.zhisuoUser, req.params.conversationId);
    if (!deleted) return res.status(404).json({ code: 404, message: 'conversation not found' });
    return res.json({ code: 0 });
  } catch (error) {
    return res.status(500).json({ code: 500, message: String(error?.message || error) });
  }
});

app.post('/api/chat', requireSession, async (req, res) => {
  const { question, conversationId } = req.body || {};
  const cleanQuestion = String(question || '').trim();
  if (!cleanQuestion) return res.status(400).json({ code: 400, message: 'question is required' });

  let conversation = null;
  try {
    conversation = conversationId
      ? await getConversation(req.zhisuoUser, conversationId)
      : null;
    if (!conversation) {
      conversation = await createConversation(
        req.zhisuoUser,
        cleanQuestion.slice(0, 40),
        conversationId || randomUUID(),
      );
    }

    const userMessage = await addMessage(req.zhisuoUser, conversation.id, {
      role: 'user',
      content: cleanQuestion,
      status: 'complete',
    });

    const exactTerm = extractSearchTerm(cleanQuestion);
    const startedAt = Date.now();
    const [exactResult, hybridResult] = await Promise.allSettled([
      pdfsearch.exact(exactTerm, 8),
      pdfsearch.hybrid(cleanQuestion, 8),
    ]);
    const exactRaw = exactResult.status === 'fulfilled' ? exactResult.value?.results || [] : [];
    const similarRaw = hybridResult.status === 'fulfilled' ? hybridResult.value?.results || [] : [];
    const exact = exactRaw.map((item) => toFrontendChunk(item));
    const similar = similarRaw.map((item) => toFrontendChunk(item));

    let answer;
    let assistantStatus = 'complete';
    let errorMessage = null;
    if (!exact.length && !similar.length) {
      const reason = exactResult.status === 'rejected'
        ? exactResult.reason?.message
        : hybridResult.status === 'rejected'
          ? hybridResult.reason?.message
          : '没有检索到相关内容';
      answer = `没有在 pdf-search 中找到相关内容。${reason ? `（${reason}）` : ''}`;
    } else {
      try {
        answer = await generateAnswer(cleanQuestion, exactRaw, similarRaw);
      } catch (error) {
        assistantStatus = 'error';
        errorMessage = String(error?.message || error);
        answer = '检索已命中，但回答模型暂时不可用。请查看下方引用依据。';
      }
    }

    const latencyMs = Date.now() - startedAt;
    const assistantMessage = await addMessage(req.zhisuoUser, conversation.id, {
      role: 'assistant',
      content: answer,
      status: assistantStatus,
      model: llm.enabled ? process.env.LLM_MODEL || null : null,
      latencyMs,
      errorMessage,
    });
    await addCitations(assistantMessage.id, 'exact', exact);
    await addCitations(assistantMessage.id, 'similar', similar);

    return res.json({
      code: 0,
      data: {
        conversationId: conversation.id,
        userMessage,
        assistantMessage: { ...assistantMessage, exact, similar },
        answer,
        exact,
        similar,
      },
    });
  } catch (error) {
    return res.status(500).json({ code: 500, message: String(error?.message || error) });
  }
});

const webDist = path.resolve(__dirname, '../../web/dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
    },
  }));
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[zhisuo] gateway listening on http://127.0.0.1:${PORT}`);
  console.log(`[zhisuo] pdf-search: ${PDFSEARCH_BASE_URL}`);
});
