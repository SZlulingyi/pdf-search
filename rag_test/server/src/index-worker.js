import { createPdfSearchProvider } from './pdfsearch-provider.js';
import { claimNextQueuedDocument, updateDocument } from './document-store.js';

const PDFSEARCH_BASE_URL = process.env.PDFSEARCH_BASE_URL || 'http://127.0.0.1:8000';
const PDFSEARCH_API_KEY = process.env.PDFSEARCH_API_KEY || '';
const worker = createPdfSearchProvider({ baseUrl: PDFSEARCH_BASE_URL, apiKey: PDFSEARCH_API_KEY });

export function startIndexWorker({ intervalMs = 2000 } = {}) {
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      const document = await claimNextQueuedDocument();
      if (document) {
        try {
          const result = await worker.indexDocument(document.storagePath, document.fileName);
          await updateDocument(document.userId, document.id, {
            backendDocId: result.doc_id || result.file_name || document.fileName,
            status: 'indexed',
          });
          console.log(`[index-worker] indexed ${document.fileName}`);
        } catch (error) {
          await updateDocument(document.userId, document.id, {
            status: 'failed',
            errorMessage: String(error?.message || error),
          });
          console.error(`[index-worker] failed ${document.fileName}:`, error);
        }
      }
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => void tick(), Math.max(500, Number(intervalMs) || 2000));
  void tick();
  return () => clearInterval(timer);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startIndexWorker();
}
