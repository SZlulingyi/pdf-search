import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { pool } from './db.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SCRYPT_KEY_LENGTH = 64;

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), salt, SCRYPT_KEY_LENGTH).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  const [algorithm, salt, expected] = String(stored || '').split('$');
  if (algorithm !== 'scrypt' || !salt || !expected) return false;
  const actual = scryptSync(String(password), salt, SCRYPT_KEY_LENGTH).toString('hex');
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

function userFromRow(row) {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

export async function ensureBootstrapAdmin(username, password) {
  const normalized = String(username || 'admin').trim() || 'admin';
  const existing = await pool.query('SELECT id FROM users WHERE username = $1', [normalized]);
  if (existing.rowCount) return;
  await pool.query(
    `INSERT INTO users (id, username, password_hash, role)
     VALUES ($1, $2, $3, 'admin')`,
    [randomUUID(), normalized, hashPassword(password)],
  );
}

export async function findUserByUsername(username) {
  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1 LIMIT 1', [String(username || '')]);
  return rows[0] ? userFromRow(rows[0]) : null;
}

export async function createUser(username, password, role = 'member') {
  const { rows } = await pool.query(
    `INSERT INTO users (id, username, password_hash, role)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [randomUUID(), String(username || '').trim(), hashPassword(password), role === 'admin' ? 'admin' : 'member'],
  );
  return userFromRow(rows[0]);
}

export async function updateUser(userId, patch) {
  const fields = [];
  const values = [];
  if (patch.role !== undefined) {
    values.push(patch.role === 'admin' ? 'admin' : 'member');
    fields.push(`role = $${values.length}`);
  }
  if (patch.status !== undefined) {
    values.push(patch.status === 'active' ? 'active' : 'disabled');
    fields.push(`status = $${values.length}`);
  }
  if (patch.password) {
    values.push(hashPassword(patch.password));
    fields.push(`password_hash = $${values.length}`);
  }
  if (!fields.length) return null;
  values.push(userId);
  const { rows } = await pool.query(
    `UPDATE users SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING *`,
    values,
  );
  return rows[0] ? userFromRow(rows[0]) : null;
}

export async function listUsers() {
  const { rows } = await pool.query(
    'SELECT * FROM users ORDER BY created_at ASC',
  );
  return rows.map(userFromRow);
}

export async function deleteUser(userId) {
  const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  return rowCount > 0;
}

export async function createAuthSession(userId) {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await pool.query(
    `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [randomUUID(), userId, sha256(token), expiresAt],
  );
  return { token, expiresAt };
}

export async function getAuthSession(token) {
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT s.id AS session_id, s.expires_at, u.*
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.status = 'active'
      LIMIT 1`,
    [sha256(token)],
  );
  if (!rows[0]) return null;
  return {
    sessionId: rows[0].session_id,
    expiresAt: rows[0].expires_at,
    user: userFromRow(rows[0]),
  };
}

export async function deleteAuthSession(token) {
  if (!token) return;
  await pool.query('DELETE FROM auth_sessions WHERE token_hash = $1', [sha256(token)]);
}

export async function touchLastLogin(userId) {
  await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [userId]);
}
