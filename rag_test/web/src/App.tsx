import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  FileText,
  Files,
  Library,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Menu,
  MoreHorizontal,
  MessageSquarePlus,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Pencil,
  UploadCloud,
  UserRound,
  X,
  XCircle,
} from 'lucide-react';
import './App.css';

type AuthState = 'checking' | 'anonymous' | 'authenticated';

type ServiceHealth = {
  id: string;
  label: string;
  reachable: boolean;
  latencyMs: number;
  detail: string;
  url: string;
};

type HealthPayload = {
  ok: boolean;
  apiKeyConfigured?: boolean;
  checks: ServiceHealth[];
};

type Dataset = {
  id: string;
  name: string;
  document_count: number;
  chunk_count: number;
  done_count?: number;
  embedding_model: string;
};

type RagDocument = {
  id: string;
  name: string;
  run: string;
  size: number;
  chunk_count?: number;
  progress?: number;
  progress_msg?: string;
};

type Chunk = {
  id: string;
  content: string;
  highlight?: string;
  document_id: string;
  document_keyword: string;
  dataset_id: string;
  similarity: number;
  term_similarity: number;
  vector_similarity: number;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  exact?: Chunk[];
  similar?: Chunk[];
  pending?: boolean;
  error?: boolean;
  createdAt: number;
};

type ChatSession = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
};

const SESSION_KEY = 'zhisuo.sessions.v2';

function createSession(): ChatSession {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: '新会话',
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

function loadInitialSessions() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) || '[]') as ChatSession[];
    if (Array.isArray(parsed) && parsed.length) {
      return { sessions: parsed, activeId: parsed[0].id };
    }
  } catch {
    // Ignore malformed local sessions.
  }
  return { sessions: [], activeId: '' };
}

const initialSessionState = loadInitialSessions();

function stripHtml(value: string) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

const runMeta: Record<string, { label: string; tone: string }> = {
  UNSTART: { label: '等待处理', tone: 'waiting' },
  RUNNING: { label: '解析中', tone: 'running' },
  DONE: { label: '已入库', tone: 'done' },
  FAIL: { label: '失败', tone: 'failed' },
  CANCEL: { label: '已取消', tone: 'waiting' },
  SCHEDULE: { label: '排队中', tone: 'running' },
};

function App() {
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [consoleUser, setConsoleUser] = useState('');
  const [loginUsername, setLoginUsername] = useState('admin');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState('');

  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState('');
  const [documents, setDocuments] = useState<RagDocument[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);

  const [sessions, setSessions] = useState<ChatSession[]>(initialSessionState.sessions);
  const [activeSessionId, setActiveSessionId] = useState(initialSessionState.activeId);
  const [input, setInput] = useState('');
  const [editingSessionId, setEditingSessionId] = useState('');
  const [editingTitle, setEditingTitle] = useState('');
  const [openSessionMenuId, setOpenSessionMenuId] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [systemOpen, setSystemOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const selectedDataset = useMemo(
    () => datasets.find((item) => item.id === selectedDatasetId),
    [datasets, selectedDatasetId],
  );
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId),
    [activeSessionId, sessions],
  );
  const completedCount = documents.filter((document) => document.run === 'DONE').length;
  const processingCount = documents.filter((document) => ['UNSTART', 'RUNNING', 'SCHEDULE'].includes(document.run)).length;
  const failedCount = documents.filter((document) => ['FAIL', 'CANCEL'].includes(document.run)).length;
  const sessionIsRunning = Boolean(activeSession?.messages.some((message) => message.pending));

  useEffect(() => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessions.slice(0, 30)));
  }, [sessions]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSession?.messages]);

  const api = useCallback(async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(`/api/ragflow${path}`, {
      ...init,
      headers: {
        ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(init.headers || {}),
      },
    });
    const payload = await response.json().catch(() => null);
    if (response.status === 401) {
      setAuthState('anonymous');
      throw new Error(payload?.message || '登录已过期，请重新登录');
    }
    if (!response.ok || (payload && payload.code !== 0)) {
      throw new Error(payload?.message || `请求失败: HTTP ${response.status}`);
    }
    return payload as T;
  }, []);

  const checkSession = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/session');
      const payload = await response.json().catch(() => null);
      if (response.ok && payload?.authenticated) {
        setConsoleUser(payload.data?.username || 'admin');
        setAuthState('authenticated');
      } else {
        setAuthState('anonymous');
      }
    } catch {
      setAuthState('anonymous');
    }
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      const response = await fetch('/api/health');
      setHealth(await response.json());
    } catch {
      setHealth(null);
    }
  }, []);

  const refreshDatasets = useCallback(async (silent = false) => {
    if (!silent) setWorkspaceLoading(true);
    try {
      const payload = await api<{ data: Dataset[] }>('/datasets?page=1&page_size=100&include_parsing_status=true');
      let nextDatasets = payload.data || [];
      if (!nextDatasets.length) {
        const created = await api<{ data: Dataset }>('/datasets', {
          method: 'POST',
          body: JSON.stringify({
            name: '默认知识库',
            language: 'Chinese',
            description: '知索单知识库模式自动创建',
            chunk_method: 'naive',
            parser_config: {
              layout_recognize: 'PaddleOCR',
              paddleocr_algorithm: 'PP-StructureV3',
              chunk_token_num: 512,
              delimiter: '\n',
              auto_keywords: 0,
              auto_questions: 0,
            },
          }),
        });
        nextDatasets = [created.data];
      }
      setDatasets(nextDatasets);
      setSelectedDatasetId((current) => (
        current && nextDatasets.some((dataset) => dataset.id === current)
          ? current
          : nextDatasets[0]?.id || ''
      ));
    } catch (error) {
      if (error instanceof Error && error.message.includes('登录')) setAuthState('anonymous');
    } finally {
      if (!silent) setWorkspaceLoading(false);
    }
  }, [api]);

  const refreshDocuments = useCallback(async (silent = false) => {
    if (!selectedDatasetId) return;
    if (!silent) setWorkspaceLoading(true);
    try {
      const payload = await api<{ data: { docs: RagDocument[] } | RagDocument[] }>(
        `/datasets/${selectedDatasetId}/documents?page=1&page_size=100&orderby=create_time&desc=true`,
      );
      setDocuments(Array.isArray(payload.data) ? payload.data : payload.data.docs || []);
    } finally {
      if (!silent) setWorkspaceLoading(false);
    }
  }, [api, selectedDatasetId]);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  useEffect(() => {
    if (authState !== 'authenticated') return;
    void refreshHealth();
    void refreshDatasets();
  }, [authState, refreshDatasets, refreshHealth]);

  useEffect(() => {
    if (authState !== 'authenticated' || !selectedDatasetId) return;
    void refreshDocuments();
  }, [authState, refreshDocuments, selectedDatasetId]);

  useEffect(() => {
    if (!processingCount || !selectedDatasetId) return;
    const timer = window.setInterval(() => {
      void refreshDocuments(true);
      void refreshDatasets(true);
    }, 3500);
    return () => window.clearInterval(timer);
  }, [processingCount, refreshDatasets, refreshDocuments, selectedDatasetId]);

  const login = async () => {
    setLoginLoading(true);
    setLoginError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUsername, password: loginPassword }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.code !== 0) throw new Error(payload?.message || '登录失败');
      setConsoleUser(payload.data?.username || loginUsername);
      setLoginPassword('');
      setAuthState('authenticated');
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoginLoading(false);
    }
  };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
    setAuthState('anonymous');
    setSystemOpen(false);
    setKnowledgeOpen(false);
    setDatasets([]);
    setDocuments([]);
    setSelectedDatasetId('');
  };

  const updateSession = (sessionId: string, updater: (session: ChatSession) => ChatSession) => {
    setSessions((current) => current.map((session) => (
      session.id === sessionId ? updater(session) : session
    )));
  };

  const newSession = () => {
    setActiveSessionId('');
    setInput('');
    setEditingSessionId('');
    setOpenSessionMenuId('');
    setDeleteConfirmId('');
    setSidebarOpen(false);
  };

  const startRename = (session: ChatSession) => {
    setEditingSessionId(session.id);
    setEditingTitle(session.title || '新会话');
    setOpenSessionMenuId('');
    setDeleteConfirmId('');
  };

  const saveRename = (sessionId: string) => {
    const title = editingTitle.trim();
    if (title) {
      updateSession(sessionId, (session) => ({ ...session, title: title.slice(0, 40) }));
    }
    setEditingSessionId('');
    setEditingTitle('');
  };

  const cancelRename = () => {
    setEditingSessionId('');
    setEditingTitle('');
  };

  const deleteSession = (sessionId: string) => {
    const next = sessions.filter((session) => session.id !== sessionId);
    setSessions(next);
    if (activeSessionId === sessionId) setActiveSessionId(next[0]?.id || '');
    setDeleteConfirmId('');
    setOpenSessionMenuId('');
  };

  const uploadPdfs = async (files: FileList | File[]) => {
    if (!selectedDatasetId || !files.length) return;
    const form = new FormData();
    Array.from(files).forEach((file) => form.append('file', file));
    setUploading(true);
    try {
      const uploadPayload = await api<{ data: RagDocument[] }>(`/datasets/${selectedDatasetId}/documents`, {
        method: 'POST',
        body: form,
      });
      const documentIds = (uploadPayload.data || []).map((document) => document.id).filter(Boolean);
      if (documentIds.length) {
        await api(`/datasets/${selectedDatasetId}/chunks`, {
          method: 'POST',
          body: JSON.stringify({ document_ids: documentIds }),
        });
      }
      await refreshDocuments();
      await refreshDatasets(true);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const retryDocuments = async () => {
    const ids = documents.filter((document) => ['UNSTART', 'FAIL', 'CANCEL'].includes(document.run)).map((document) => document.id);
    if (!ids.length) return;
    setWorkspaceLoading(true);
    try {
      await api(`/datasets/${selectedDatasetId}/chunks`, {
        method: 'POST',
        body: JSON.stringify({ document_ids: ids }),
      });
      await refreshDocuments();
    } finally {
      setWorkspaceLoading(false);
    }
  };

  const sendMessage = async (preset?: string) => {
    const question = (preset ?? input).trim();
    if (!question || sessionIsRunning) return;
    if (!selectedDatasetId) {
      setKnowledgeOpen(true);
      return;
    }

    let sessionId = activeSession?.id;
    if (!sessionId) {
      const session = createSession();
      sessionId = session.id;
      setSessions((current) => [session, ...current]);
      setActiveSessionId(session.id);
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: question,
      createdAt: Date.now(),
    };
    const assistantId = crypto.randomUUID();
    const pendingMessage: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '正在检索知识库…',
      pending: true,
      createdAt: Date.now(),
    };

    setInput('');
    setSessions((current) => current.map((session) => {
      if (session.id !== sessionId) return session;
      const messages = [...session.messages, userMessage, pendingMessage];
      return {
        ...session,
        title: session.messages.length === 0 ? question.slice(0, 18) : session.title,
        messages,
        updatedAt: Date.now(),
      };
    }));

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ datasetId: selectedDatasetId, question }),
      });
      const payload = await response.json().catch(() => null);
      if (response.status === 401) {
        setAuthState('anonymous');
        throw new Error('登录已过期，请重新登录');
      }
      if (!response.ok || payload?.code !== 0) throw new Error(payload?.message || '回答失败');

      updateSession(sessionId, (session) => ({
        ...session,
        messages: session.messages.map((message) => (
          message.id === assistantId
            ? {
                ...message,
                content: payload.data.answer,
                exact: payload.data.exact || [],
                similar: payload.data.similar || [],
                pending: false,
              }
            : message
        )),
        updatedAt: Date.now(),
      }));
    } catch (error) {
      updateSession(sessionId, (session) => ({
        ...session,
        messages: session.messages.map((message) => (
          message.id === assistantId
            ? {
                ...message,
                content: error instanceof Error ? error.message : String(error),
                error: true,
                pending: false,
              }
            : message
        )),
      }));
    }
  };

  const allServicesOnline = health?.checks?.every((service) => service.reachable) ?? false;

  if (authState === 'checking') {
    return (
      <div className="auth-page">
        <div className="auth-loading"><LoaderCircle size={26} className="spin" /><span>正在进入知索…</span></div>
      </div>
    );
  }

  if (authState === 'anonymous') {
    return (
      <LoginScreen
        username={loginUsername}
        password={loginPassword}
        error={loginError}
        loading={loginLoading}
        onUsernameChange={setLoginUsername}
        onPasswordChange={setLoginPassword}
        onSubmit={() => void login()}
      />
    );
  }

  return (
    <div className="chat-app">
      <aside className={`chat-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <span className="brand-mark">知</span>
          <strong>知索</strong>
          <button className="mobile-close" onClick={() => setSidebarOpen(false)} aria-label="关闭侧边栏"><X size={18} /></button>
        </div>

        <button className="new-chat-button" onClick={newSession}>
          <MessageSquarePlus size={18} />新建会话
        </button>

        <section className="sidebar-section sessions-section">
          <div className="sidebar-section-heading">
            <span>会话</span>
            <small>{sessions.length}</small>
          </div>
          <div className="session-list">
          {sessions.map((session) => {
            const running = session.messages.some((message) => message.pending);
            const editing = editingSessionId === session.id;
            const menuOpen = openSessionMenuId === session.id;
            return (
              <div className={`session-item ${session.id === activeSession?.id ? 'active' : ''} ${running ? 'running' : ''} ${menuOpen ? 'menu-open' : ''}`} key={session.id}>
                {editing ? (
                  <input
                    className="session-title-input"
                    value={editingTitle}
                    autoFocus
                    onChange={(event) => setEditingTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') saveRename(session.id);
                      if (event.key === 'Escape') cancelRename();
                    }}
                    onBlur={() => saveRename(session.id)}
                  />
                ) : (
                  <button className="session-select" onClick={() => {
                    setActiveSessionId(session.id);
                    setOpenSessionMenuId('');
                    setDeleteConfirmId('');
                    setSidebarOpen(false);
                  }}>
                    <span>{session.title || '新会话'}</span>
                    <small>{new Date(session.updatedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</small>
                  </button>
                )}

                <div
                  className="session-menu-anchor"
                  onClick={(event) => event.stopPropagation()}
                  onMouseDown={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  {running && <span className="session-running" title="正在执行"><LoaderCircle size={13} className="spin" /></span>}
                  {!editing && (
                    <button className="session-more" onClick={(event) => {
                      event.stopPropagation();
                      setOpenSessionMenuId(menuOpen ? '' : session.id);
                      setDeleteConfirmId('');
                    }} aria-label="会话操作">
                      <MoreHorizontal size={15} />
                    </button>
                  )}

                  {menuOpen && (
                    <div className="session-popover">
                      {deleteConfirmId === session.id ? (
                        <div className="session-confirm">
                          <span>确认删除这个会话？</span>
                          <div>
                            <button className="danger" onClick={(event) => { event.stopPropagation(); deleteSession(session.id); }}>删除</button>
                            <button onClick={(event) => { event.stopPropagation(); setDeleteConfirmId(''); }}>取消</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <button onClick={(event) => { event.stopPropagation(); startRename(session); }}><Pencil size={13} />重命名</button>
                          <button onClick={(event) => { event.stopPropagation(); setDeleteConfirmId(session.id); }}><Trash2 size={13} />删除会话</button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          </div>
        </section>

        <section className="sidebar-management">
          <div className="sidebar-section-heading"><span>管理</span></div>
          <button className="sidebar-tool" onClick={() => setKnowledgeOpen(true)}>
            <span className="sidebar-tool-icon"><Library size={17} /></span>
            <span className="sidebar-tool-copy"><strong>知识库</strong><small>{completedCount} 份文档已入库</small></span>
            <ChevronRight size={15} />
          </button>
          <button className="sidebar-tool" onClick={() => setSystemOpen(true)}>
            <span className="sidebar-tool-icon"><Settings2 size={17} /></span>
            <span className="sidebar-tool-copy"><strong>系统设置</strong><small>服务状态与退出</small></span>
            <ChevronRight size={15} />
          </button>
        </section>
      </aside>

      {sidebarOpen && <div className="mobile-backdrop" onClick={() => setSidebarOpen(false)} />}

      <main className="chat-main">
        <header className="chat-header">
          <button className="mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="打开会话列表"><Menu size={20} /></button>
          <div>
            <strong>{activeSession?.title || '新会话'}</strong>
            <span className={`status-dot ${allServicesOnline ? 'online' : 'offline'}`} />
            {sessionIsRunning && <span className="header-running"><LoaderCircle size={12} className="spin" />执行中</span>}
          </div>
        </header>

        <section className={`chat-scroll ${activeSession?.messages.length ? 'has-messages' : 'empty-chat'}`}>
          {!activeSession?.messages.length ? (
            <div className="chat-welcome">
              <span className="welcome-icon"><Sparkles size={28} /></span>
              <h1>你好，我是知索</h1>
              <p>我目前只处理当前知识库里的问题：可以查找明确文字，也可以直接描述想问的内容。其他通用聊天暂不支持。</p>
              <div className="suggestion-row">
                <button onClick={() => void sendMessage('帮我总结一下当前知识库的主要内容')}>总结已上传资料</button>
                <button onClick={() => void sendMessage('帮我查找发票号码相关的信息')}>查找发票内容</button>
                <button onClick={() => setKnowledgeOpen(true)}>上传新的 PDF</button>
              </div>
            </div>
          ) : (
            <div className="message-list">
              {activeSession.messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}

        </section>

        <div className="composer-dock">
          <div className="composer-wrap">
            <div className="composer">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder="仅支持知识库问题：查找文字或直接提问…"
                rows={activeSession?.messages.length ? 1 : 2}
              />
              <div className="composer-footer">
                <button className="composer-tool" onClick={() => fileInputRef.current?.click()} title="上传 PDF">
                  <Paperclip size={18} />
                  <span>上传 PDF</span>
                </button>
                <span>{completedCount ? `${completedCount} 份文档可检索` : '先上传资料再提问'}</span>
                <button className="send-button" onClick={() => void sendMessage()} disabled={!input.trim() || sessionIsRunning}>
                  {sessionIsRunning ? <LoaderCircle size={18} className="spin" /> : <Send size={18} />}
                </button>
              </div>
            </div>
            <small>仅知识库检索 · Enter 发送 · Shift + Enter 换行</small>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          hidden
          onChange={(event) => event.target.files && void uploadPdfs(event.target.files)}
        />
      </main>

      {knowledgeOpen && (
        <KnowledgeDrawer
          dataset={selectedDataset}
          documents={documents}
          completedCount={completedCount}
          processingCount={processingCount}
          failedCount={failedCount}
          uploading={uploading}
          loading={workspaceLoading}
          onUpload={uploadPdfs}
          onRefresh={() => void refreshDocuments()}
          onRetry={() => void retryDocuments()}
          onClose={() => setKnowledgeOpen(false)}
        />
      )}

      {systemOpen && (
        <SystemDrawer
          health={health}
          username={consoleUser}
          onRefresh={() => void refreshHealth()}
          onLogout={() => void logout()}
          onClose={() => setSystemOpen(false)}
        />
      )}
    </div>
  );
}

function LoginScreen({
  username,
  password,
  error,
  loading,
  onUsernameChange,
  onPasswordChange,
  onSubmit,
}: {
  username: string;
  password: string;
  error: string;
  loading: boolean;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand"><span className="brand-mark">知</span><strong>知索</strong></div>
        <h1>欢迎回来</h1>
        <label className="auth-field">
          <span>账号</span>
          <div><UserRound size={17} /><input value={username} onChange={(event) => onUsernameChange(event.target.value)} autoComplete="username" /></div>
        </label>
        <label className="auth-field">
          <span>密码</span>
          <div><LockKeyhole size={17} /><input type="password" value={password} onChange={(event) => onPasswordChange(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && onSubmit()} autoComplete="current-password" /></div>
        </label>
        {error && <div className="auth-error"><XCircle size={16} />{error}</div>}
        <button className="button primary auth-submit" onClick={onSubmit} disabled={loading || !username.trim() || !password}>
          {loading ? <LoaderCircle size={18} className="spin" /> : <ShieldCheck size={18} />}登录
        </button>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const sources = [...(message.exact || []), ...(message.similar || [])];
  if (message.role === 'user') {
    return <div className="message-row user"><div className="message-bubble">{message.content}</div></div>;
  }

  return (
    <div className="message-row assistant">
      <span className="assistant-avatar">知</span>
      <div className="assistant-content">
        <div className={`message-bubble ${message.error ? 'error' : ''}`}>
          {message.pending ? (
            <span className="typing"><i /><i /><i /></span>
          ) : (
            <p>{message.content}</p>
          )}
        </div>
        {!!sources.length && !message.pending && (
          <details className="source-panel">
            <summary><Search size={14} />查看检索依据 <span>{sources.length}</span></summary>
            <div className="source-groups">
              <SourceGroup title="精确命中" chunks={message.exact || []} tone="exact" />
              <SourceGroup title="相似结果" chunks={message.similar || []} tone="similar" />
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

function SourceGroup({ title, chunks, tone }: { title: string; chunks: Chunk[]; tone: 'exact' | 'similar' }) {
  if (!chunks.length) return null;
  return (
    <div className={`source-group ${tone}`}>
      <h4>{title}</h4>
      {chunks.slice(0, 3).map((chunk, index) => (
        <div className="source-item" key={`${chunk.id}-${index}`}>
          <div><FileText size={13} /><span>{chunk.document_keyword || 'PDF 文档'}</span><strong>{Math.round((chunk.similarity || 0) * 100)}%</strong></div>
          <p>{stripHtml(chunk.highlight || chunk.content).slice(0, 260)}</p>
        </div>
      ))}
    </div>
  );
}

function KnowledgeDrawer({
  dataset,
  documents,
  completedCount,
  processingCount,
  failedCount,
  uploading,
  loading,
  onUpload,
  onRefresh,
  onRetry,
  onClose,
}: {
  dataset?: Dataset;
  documents: RagDocument[];
  completedCount: number;
  processingCount: number;
  failedCount: number;
  uploading: boolean;
  loading: boolean;
  onUpload: (files: FileList | File[]) => void;
  onRefresh: () => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer knowledge-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-header">
          <div><span className="eyebrow">知识库</span><h2>已上传资料</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="关闭知识库"><X size={19} /></button>
        </div>

        <div className="knowledge-metrics">
          <div><strong>{documents.length}</strong><span>全部文档</span></div>
          <div><strong>{completedCount}</strong><span>已入库</span></div>
          <div><strong>{processingCount}</strong><span>处理中</span></div>
        </div>

        <div className="drawer-upload" onClick={() => inputRef.current?.click()}>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,application/pdf"
            multiple
            hidden
            onChange={(event) => event.target.files && onUpload(event.target.files)}
          />
          {uploading ? <LoaderCircle size={25} className="spin" /> : <UploadCloud size={25} />}
          <div><strong>{uploading ? '正在上传…' : '上传 PDF'}</strong><span>支持一次多选和后续分批追加</span></div>
        </div>

        <div className="drawer-document-actions">
          <button className="button secondary compact" onClick={onRefresh} disabled={loading}><RefreshCw size={15} />刷新</button>
          {failedCount > 0 && <button className="button secondary compact" onClick={onRetry}><RefreshCw size={15} />重试失败</button>}
        </div>

        <div className="drawer-document-list">
          {documents.map((document) => {
            const meta = runMeta[document.run] || runMeta.UNSTART;
            return (
              <div className="drawer-document" key={document.id}>
                <span className="document-icon"><FileText size={17} /></span>
                <div><strong>{document.name}</strong><small>{formatBytes(document.size)} · {document.chunk_count || 0} 个片段</small></div>
                <span className={`status-pill ${meta.tone}`}>{meta.label}</span>
              </div>
            );
          })}
          {!documents.length && (
            <div className="drawer-empty">
              <Files size={30} />
              <strong>还没有上传 PDF</strong>
              <span>上传后会自动解析并加入检索。</span>
            </div>
          )}
        </div>
        <p className="drawer-footnote">{dataset ? '所有 PDF 自动进入当前唯一知识库。' : '正在准备知识库…'}</p>
      </aside>
    </div>
  );
}

function SystemDrawer({
  health,
  username,
  onRefresh,
  onLogout,
  onClose,
}: {
  health: HealthPayload | null;
  username: string;
  onRefresh: () => void;
  onLogout: () => void;
  onClose: () => void;
}) {
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-header">
          <div><span className="eyebrow">系统设置</span><h2>服务状态</h2><p className="drawer-user">当前账号：{username}</p></div>
          <button className="icon-button" onClick={onClose} aria-label="关闭系统设置"><X size={19} /></button>
        </div>
        <div className="service-list">
          {(health?.checks || []).map((service) => (
            <div className="service-row" key={service.id}>
              <span className={`status-dot ${service.reachable ? 'online' : 'offline'}`} />
              <div><strong>{service.label}</strong><small>{service.reachable ? `${service.detail} · ${service.latencyMs}ms` : service.detail}</small></div>
            </div>
          ))}
          {!health?.checks?.length && <div className="drawer-empty"><Server size={24} /><strong>正在读取服务状态</strong></div>}
        </div>
        <div className="drawer-actions">
          <button className="button secondary" onClick={onRefresh}><RefreshCw size={16} />重新检查</button>
          <button className="button ghost" onClick={onLogout}><LogOut size={16} />退出登录</button>
        </div>
      </aside>
    </div>
  );
}

export default App;
