function exactTokens(query) {
  const splitIdentifier = String(query || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  const normalized = splitIdentifier.toLowerCase().replace(/[，。！？、；：,.!?;:()[\]{}"'“”‘’]/g, ' ');
  const tokens = normalized.match(/[a-z0-9][a-z0-9._/-]{1,}/g) || [];
  const cjkRuns = normalized.match(/[\u3400-\u9fff]+/g) || [];
  for (const run of cjkRuns) {
    if (run.length === 1) tokens.push(run);
    for (let index = 0; index < run.length - 1; index += 1) tokens.push(run.slice(index, index + 2));
  }
  return [...new Set(tokens)].slice(0, 24);
}

function identifierPrefixes(query) {
  const compactTokens = String(query || '').toLowerCase().match(/[a-z0-9][a-z0-9]{4,}/g) || [];
  const prefixes = [];
  for (const token of compactTokens) {
    for (let size = 4; size <= Math.min(8, token.length - 1); size += 1) {
      prefixes.push(token.slice(0, size));
    }
  }
  return [...new Set(prefixes)].slice(0, 32);
}

export function stripHtml(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeChunk(chunk, datasetId) {
  return {
    id: chunk.id || chunk.chunk_id || chunk._id || '',
    content: chunk.content || chunk.content_with_weight || chunk.highlight || '',
    highlight: chunk.highlight || '',
    document_id: chunk.document_id || chunk.doc_id || '',
    document_keyword: chunk.document_keyword || chunk.docnm_kwd || '',
    dataset_id: chunk.dataset_id || chunk.kb_id || datasetId,
    similarity: Number(chunk.similarity || 0),
    term_similarity: Number(chunk.term_similarity || 0),
    vector_similarity: Number(chunk.vector_similarity || 0),
    positions: chunk.positions || chunk.position_int || [],
    bbox: chunk.bbox || null,
    page_image_url: chunk.page_image_url || '',
    element_type: chunk.element_type || chunk.doc_type_kwd || '',
    confidence: chunk.confidence ?? null,
  };
}

export function createRagFlowProvider({ ragflowBaseUrl, esUrl, esUser, esPassword }) {
  async function listDocumentIds(apiKey, datasetId) {
    const ids = new Set();
    let page = 1;
    while (page <= 20) {
      const response = await fetch(`${ragflowBaseUrl}/api/v1/datasets/${encodeURIComponent(datasetId)}/documents?page=${page}&page_size=100`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const payload = await response.json();
      if (!response.ok || payload.code !== 0) throw new Error(payload?.message || '文档列表读取失败');
      const docs = payload.data?.docs || [];
      docs.forEach((doc) => doc.id && ids.add(doc.id));
      if (docs.length < 100) break;
      page += 1;
    }
    return ids;
  }

  async function filterDeletedDocuments(apiKey, datasetId, chunks) {
    try {
      const existing = await listDocumentIds(apiKey, datasetId);
      if (!existing.size) return [];
      return chunks.filter((chunk) => !chunk.document_id || existing.has(chunk.document_id));
    } catch {
      return chunks;
    }
  }

  async function exactSearch(apiKey, datasetId, query, pageSize = 8) {
    const datasetResponse = await fetch(`${ragflowBaseUrl}/api/v1/datasets?id=${encodeURIComponent(datasetId)}&page=1&page_size=1`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const datasetPayload = await datasetResponse.json();
    if (!datasetResponse.ok || datasetPayload.code !== 0 || !datasetPayload.data?.[0]) {
      const error = new Error(datasetPayload?.message || '知识库数据不存在');
      error.status = datasetResponse.status || 401;
      throw error;
    }

    const tenantId = datasetPayload.data[0].tenant_id;
    const tokens = exactTokens(query);
    const prefixes = identifierPrefixes(query);
    const should = [
      { match_phrase: { content_ltks: { query: tokens.join(' '), slop: 3, boost: 4 } } },
      { match: { content_ltks: { query: tokens.join(' '), operator: 'and', boost: 3 } } },
      { match: { content_sm_ltks: { query: tokens.join(' '), operator: 'and', boost: 2 } } },
    ];
    const rawNumber = String(query).match(/[a-zA-Z0-9][a-zA-Z0-9._/-]{2,}/)?.[0];
    if (rawNumber) should.push({ wildcard: { content_ltks: { value: `*${rawNumber.toLowerCase()}*`, boost: 8 } } });

    const compactQuery = String(query).replace(/\s+/g, '');
    const cjkRuns = compactQuery.match(/[\u3400-\u9fff]+/g) || [];
    const grams = new Set();
    for (const run of cjkRuns) {
      for (let size = 2; size <= Math.min(4, run.length); size += 1) {
        for (let index = 0; index <= run.length - size; index += 1) grams.add(run.slice(index, index + size));
      }
    }
    for (const gram of [...grams].slice(0, 40)) should.push({ wildcard: { content_ltks: { value: `*${gram}*`, boost: 1.5 } } });
    if (compactQuery) should.push({ wildcard: { content_ltks: { value: `*${compactQuery.toLowerCase()}*`, boost: 6 } } });
    for (const prefix of prefixes) should.push({ wildcard: { content_ltks: { value: `*${prefix}*`, boost: 1.8 } } });

    const esResponse = await fetch(`${esUrl}/ragflow_${tenantId}/_search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${esUser}:${esPassword}`).toString('base64')}`,
      },
      body: JSON.stringify({
        size: Math.min(Number(pageSize) || 8, 30),
        query: { bool: { filter: [{ term: { kb_id: datasetId } }], should, minimum_should_match: 1 } },
        highlight: { pre_tags: ['<em>'], post_tags: ['</em>'], fields: { content_ltks: {} } },
      }),
    });
    const esPayload = await esResponse.json();
    if (!esResponse.ok) throw new Error(esPayload?.error?.reason || '精确检索失败');

    const hits = esPayload.hits?.hits || [];
    const maxScore = Math.max(...hits.map((hit) => Number(hit._score) || 0), 1);
    const chunks = hits.map((hit) => {
      const source = hit._source || {};
      return normalizeChunk({
        id: source.id || hit._id,
        content: source.content_with_weight || '',
        highlight: hit.highlight?.content_ltks?.join(' ... ') || source.content_with_weight || '',
        document_id: source.doc_id || '',
        document_keyword: source.docnm_kwd || '',
        dataset_id: source.kb_id || datasetId,
        similarity: (Number(hit._score) || 0) / maxScore,
        term_similarity: (Number(hit._score) || 0) / maxScore,
        vector_similarity: 0,
        positions: source.position_int || [],
      }, datasetId);
    });
    const existingChunks = await filterDeletedDocuments(apiKey, datasetId, chunks);
    return { chunks: existingChunks, total: existingChunks.length };
  }

  async function semanticSearch(apiKey, datasetId, query, pageSize = 8) {
    const response = await fetch(`${ragflowBaseUrl}/api/v1/retrieval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        question: query,
        dataset_ids: [datasetId],
        page: 1,
        page_size: pageSize,
        similarity_threshold: 0.35,
        vector_similarity_weight: 1,
        knn_top_k: 256,
        knn_num_candidates: 512,
        rerank_candidates_count: 64,
        keyword: false,
        highlight: true,
        include_knowledge_compilation: true,
      }),
    });
    const payload = await response.json();
    if (!response.ok || payload.code !== 0) {
      const error = new Error(payload?.message || '相似检索失败');
      error.status = response.status;
      throw error;
    }
    const chunks = (payload.data?.chunks || []).map((chunk) => normalizeChunk(chunk, datasetId));
    const existingChunks = await filterDeletedDocuments(apiKey, datasetId, chunks);
    return { chunks: existingChunks, total: existingChunks.length };
  }

  async function getDocumentChunks(apiKey, datasetId, documentId, pageSize = 200) {
    const response = await fetch(`${ragflowBaseUrl}/api/v1/datasets/${encodeURIComponent(datasetId)}/documents/${encodeURIComponent(documentId)}/chunks?page=1&page_size=${Math.min(Number(pageSize) || 100, 100)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const payload = await response.json();
    if (!response.ok || payload.code !== 0) {
      const error = new Error(payload?.message || '文档分片读取失败');
      error.status = response.status;
      throw error;
    }
    const chunks = (payload.data?.chunks || []).map((chunk) => ({
      ...normalizeChunk(chunk, datasetId),
      document_id: chunk.document_id || payload.data?.doc?.id || documentId,
      document_keyword: chunk.docnm_kwd || payload.data?.doc?.name || '',
    }));
    return { chunks, doc: payload.data?.doc || null, total: payload.data?.total || chunks.length };
  }

  return { exactSearch, semanticSearch, getDocumentChunks };
}
