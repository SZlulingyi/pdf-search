import { randomUUID } from 'node:crypto';
import { pool } from './db.js';

function docFromRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    fileName: row.file_name,
    fileSize: Number(row.file_size || 0),
    fileHash: row.file_hash,
    storagePath: row.storage_path,
    backendDocId: row.backend_doc_id,
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toFrontendDocument(row) {
  const status = row.status === 'indexed'
    ? 'DONE'
    : row.status === 'failed'
      ? 'FAIL'
      : 'RUNNING';
  return {
    id: row.id,
    name: row.fileName,
    run: status,
    size: row.fileSize,
    chunk_count: row.status === 'indexed' ? 1 : 0,
    progress: row.status === 'indexed' ? 100 : 0,
    progress_msg: row.errorMessage || row.status,
  };
}

export async function listDocuments(userId) {
  const { rows } = await pool.query(
    `SELECT * FROM documents WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map(docFromRow);
}

export async function getDocument(userId, documentId) {
  const { rows } = await pool.query(
    'SELECT * FROM documents WHERE id = $1 AND user_id = $2 LIMIT 1',
    [documentId, userId],
  );
  return rows[0] ? docFromRow(rows[0]) : null;
}

export async function documentStats(userId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS document_count,
            COUNT(*) FILTER (WHERE status = 'indexed')::int AS done_count
       FROM documents
      WHERE user_id = $1`,
    [userId],
  );
  const documentCount = rows[0]?.document_count || 0;
  return {
    document_count: documentCount,
    done_count: rows[0]?.done_count || 0,
    chunk_count: 0,
  };
}

export async function createDocument(userId, file) {
  const { rows } = await pool.query(
    `INSERT INTO documents (
       id, user_id, file_name, file_size, file_hash, storage_path, status
     ) VALUES ($1,$2,$3,$4,$5,$6,'processing')
     RETURNING *`,
    [
      randomUUID(),
      userId,
      file.fileName,
      file.fileSize,
      file.fileHash,
      file.storagePath,
    ],
  );
  return docFromRow(rows[0]);
}

export async function updateDocument(userId, documentId, patch) {
  const { rows } = await pool.query(
    `UPDATE documents
        SET backend_doc_id = COALESCE($3, backend_doc_id),
            status = COALESCE($4, status),
            error_message = $5,
            updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING *`,
    [
      documentId,
      userId,
      patch.backendDocId || null,
      patch.status || null,
      patch.errorMessage || null,
    ],
  );
  return rows[0] ? docFromRow(rows[0]) : null;
}

export async function deleteDocument(userId, documentId) {
  const { rowCount } = await pool.query(
    'DELETE FROM documents WHERE id = $1 AND user_id = $2',
    [documentId, userId],
  );
  return rowCount > 0;
}
