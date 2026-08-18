import { Hono } from 'hono';

type Bindings = {
  DB: D1Database;
  BUCKET: R2Bucket;
};

const app = new Hono<{ Bindings: Bindings }>();

// Helper for error envelope
function writeError(c: any, status: number, code: string, message: string, details?: any) {
  const err: any = { code, message };
  if (details !== undefined && details !== null) {
    Object.assign(err, details);
  }
  return c.json({ error: err }, status);
}

async function hashPassword(plain: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(plain), 'PBKDF2', false, ['deriveBits']);
  const iterations = 100000;
  const derivedBits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, keyMaterial, 256);
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = Array.from(new Uint8Array(derivedBits)).map(b => b.toString(16).padStart(2, '0')).join('');
  return '$pbkdf2$' + iterations + '$' + saltHex + '$' + hashHex;
}

async function verifyPassword(plain: string, storedHash: string): Promise<boolean> {
  if (!storedHash || !storedHash.startsWith('$pbkdf2$')) {
    return false;
  }
  const parts = storedHash.split('$');
  if (parts.length !== 5) return false;
  const iterations = parseInt(parts[2], 10);
  const saltHex = parts[3];
  const expectedHashHex = parts[4];

  const saltBytes = new Uint8Array(saltHex.match(/.{1,2}/g)?.map(b => parseInt(b, 16)) || []);
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(plain), 'PBKDF2', false, ['deriveBits']);
  const derivedBits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' }, keyMaterial, 256);
  const derivedHashHex = Array.from(new Uint8Array(derivedBits)).map(b => b.toString(16).padStart(2, '0')).join('');
  return derivedHashHex === expectedHashHex;
}

function sanitizeRecord(record: any, passwordFields: string[]) {
  if (!record) return record;
  const copy = { ...record };
  for (const pf of passwordFields) {
    delete copy[pf];
  }
  return copy;
}

function escapeHTML(str: any): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeHTML(html: string): string {
  if (!html) return '';
  return String(html)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/on\w+\s*=\s*'[^']*'/gi, '')
    .replace(/on\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:[^\s"']*/gi, '#');
}

interface AuthUser {
  id: any;
  role: string;
}

// Resolves authenticated user strictly from session cookie token stored in D1.
// Supports both alcohol_log_session (Google OAuth) and mold_session.
// Security Note: Unverified HTTP headers like x-user-id / x-user-role are explicitly rejected
// to prevent client-side header spoofing attacks.
async function getAuthUser(c: any): Promise<AuthUser | null> {
  const cookieHeader = c.req.header('Cookie') || '';

  // 1. Check alcohol_log_session (primary session from Google OAuth)
  const alcoholMatch = cookieHeader.match(/alcohol_log_session=([^;]+)/);
  if (alcoholMatch) {
    const token = decodeURIComponent(alcoholMatch[1]);
    try {
      const sess = await c.env.DB.prepare('SELECT user_id FROM "oauth_sessions" WHERE id = ? AND expires_at > ?').bind(token, new Date().toISOString()).first<{ user_id: any }>();
      if (sess && sess.user_id != null) {
        const u = await c.env.DB.prepare('SELECT * FROM "users" WHERE id = ?').bind(sess.user_id).first<any>();
        if (u) {
          return { id: u.id, role: u.role || 'user' };
        }
      }
    } catch (e) {
      // Ignore if oauth_sessions query fails
    }
  }

  // 2. Fallback: Check mold_session
  const match = cookieHeader.match(/mold_session=([^;]+)/);
  if (match) {
    const token = match[1];
    try {
      const sess = await c.env.DB.prepare('SELECT user_id FROM "_mold_sessions" WHERE id = ? AND expires_at > ?').bind(token, new Date().toISOString()).first<{ user_id: any }>();
      if (sess && sess.user_id != null) {
        const u = await c.env.DB.prepare('SELECT * FROM "users" WHERE id = ?').bind(sess.user_id).first<any>();
        if (u) {
          return { id: u.id, role: u.role || 'user' };
        }
      }
    } catch (e) {
      // Ignore if session table not present
    }
  }
  return null;
}

app.get('/', (c) => c.text('Mold Cloudflare Workers Target API'));

const relMetadata: Record<string, Record<string, { kind: string; targetTable: string; fk: string; permRead: string; ownershipField: string; softDelete: boolean; pwdFields: string[] }>> = {
  'tags': {
    'owner': { kind: 'belongs_to', targetTable: 'users', fk: 'owner_id', permRead: 'authenticated', ownershipField: 'id', softDelete: false, pwdFields: [] },
  },
  'users': {
  },
  'record_tags': {
    'sake_record': { kind: 'belongs_to', targetTable: 'sake_records', fk: 'sake_record_id', permRead: 'owner', ownershipField: 'owner_id', softDelete: false, pwdFields: [] },
    'tag': { kind: 'belongs_to', targetTable: 'tags', fk: 'tag_id', permRead: 'owner', ownershipField: 'owner_id', softDelete: false, pwdFields: [] },
  },
  'sake_images': {
    'owner': { kind: 'belongs_to', targetTable: 'users', fk: 'owner_id', permRead: 'authenticated', ownershipField: 'id', softDelete: false, pwdFields: [] },
    'record': { kind: 'belongs_to', targetTable: 'sake_records', fk: 'record_id', permRead: 'owner', ownershipField: 'owner_id', softDelete: false, pwdFields: [] },
  },
  'sake_records': {
    'owner': { kind: 'belongs_to', targetTable: 'users', fk: 'owner_id', permRead: 'authenticated', ownershipField: 'id', softDelete: false, pwdFields: [] },
    'images': { kind: 'has_many', targetTable: 'sake_images', fk: 'record_id', permRead: 'owner', ownershipField: 'owner_id', softDelete: false, pwdFields: [] },
    'record_tags': { kind: 'has_many', targetTable: 'record_tags', fk: 'sake_record_id', permRead: 'authenticated', ownershipField: '', softDelete: false, pwdFields: [] },
  },
};

async function processIncludes(c: any, currentTable: string, records: any[], includeStr: string | undefined, authUser: AuthUser | null): Promise<any> {
  if (!includeStr || records.length === 0) return null;
  const currentRels = relMetadata[currentTable] || {};
  const items = includeStr.split(',').map(s => s.trim()).filter(Boolean);

  const validRels: Array<{ name: string; info: any }> = [];
  for (const item of items) {
    const info = currentRels[item];
    if (!info || info.kind !== 'belongs_to') {
      return writeError(c, 400, 'INVALID_INCLUDE', `invalid relation '${item}' for include`);
    }
    validRels.push({ name: item, info });
  }

  for (const rel of validRels) {
    const fkCol = rel.info.fk;
    const targetTable = rel.info.targetTable;
    const fkVals = Array.from(new Set(records.map(r => r[fkCol]).filter(v => v !== null && v !== undefined && v !== '')));

    for (const r of records) {
      r[rel.name] = null;
    }

    if (fkVals.length === 0) continue;

    const placeholders = fkVals.map(() => '?').join(', ');
    const softCond = rel.info.softDelete ? ' AND "deleted_at" IS NULL' : '';
    const sql = `SELECT * FROM "${targetTable}" WHERE id IN (${placeholders})${softCond}`;
    const { results } = await c.env.DB.prepare(sql).bind(...fkVals).all();

    const targetMap = new Map<any, any>();
    for (const tRec of (results || []) as any[]) {
      const idVal = tRec.id;
      if (idVal === null || idVal === undefined) continue;

      let allowed = true;
      if (rel.info.permRead === 'owner' && rel.info.ownershipField) {
        const ownerVal = tRec[rel.info.ownershipField];
        if (ownerVal !== null && ownerVal !== undefined) {
          if (!authUser || (authUser.role !== 'admin' && ownerVal != authUser.id)) {
            allowed = false;
          }
        }
      } else if (rel.info.permRead.startsWith('role:')) {
        const role = rel.info.permRead.substring(5);
        if (!authUser || (authUser.role !== role && authUser.role !== 'admin')) {
          allowed = false;
        }
      } else if (rel.info.permRead === 'authenticated') {
        if (!authUser) {
          allowed = false;
        }
      }

      if (allowed) {
        targetMap.set(idVal, sanitizeRecord(tRec, rel.info.pwdFields));
      }
    }

    for (const r of records) {
      const fkVal = r[fkCol];
      if (fkVal !== null && fkVal !== undefined && targetMap.has(fkVal)) {
        r[rel.name] = targetMap.get(fkVal);
      } else {
        r[rel.name] = null;
      }
    }
  }

  return null;
}


// LIST /api/tags
app.get('/api/tags', async (c) => {
  const authUser = await getAuthUser(c);
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 100);
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10), 0);

  const whereConds: string[] = [];
  const params: any[] = [];
  if (!authUser || authUser.role !== 'admin') {
    if (authUser) {
      whereConds.push('("owner_id" = ? OR "owner_id" IS NULL)');
      params.push(authUser.id);
    } else {
      whereConds.push('"owner_id" IS NULL');
    }
  }
  const whereClause = whereConds.length > 0 ? ' WHERE ' + whereConds.join(' AND ') : '';
  const countSql = `SELECT COUNT(*) as total FROM "tags"${whereClause}`;
  const countStmt = await c.env.DB.prepare(countSql).bind(...params).first<{ total: number }>();
  const total = countStmt ? countStmt.total : 0;
  const querySql = `SELECT * FROM "tags"${whereClause} ORDER BY id ASC LIMIT ? OFFSET ?`;
  const { results } = await c.env.DB.prepare(querySql).bind(...params, limit, offset).all();
  const sanitized = (results || []).map((r: any) => sanitizeRecord(r, []));
  const incErr = await processIncludes(c, 'tags', sanitized, c.req.query('include'), authUser);
  if (incErr) return incErr;
  return c.json({
    data: sanitized,
    meta: { total, limit, offset }
  });
});

// DETAIL /api/tags/:id
app.get('/api/tags/:id', async (c) => {
  const authUser = await getAuthUser(c);
  const id = c.req.param('id');
  const record = await c.env.DB.prepare('SELECT * FROM "tags" WHERE id = ?').bind(id).first();
  if (!record) {
    return writeError(c, 404, 'NOT_FOUND', 'record not found');
  }
  const ownerVal = (record as any)['owner_id'];
  if (ownerVal !== null && ownerVal !== undefined) {
    if (!authUser) {
      return writeError(c, 401, 'UNAUTHORIZED', 'authentication required');
    }
    if (authUser.role !== 'admin' && ownerVal != authUser.id) {
      return writeError(c, 403, 'FORBIDDEN', 'forbidden');
    }
  }
  const sanitized = sanitizeRecord(record, []);
  const incErr = await processIncludes(c, 'tags', [sanitized], c.req.query('include'), authUser);
  if (incErr) return incErr;
  return c.json({ data: sanitized });
});

// CREATE /api/tags
app.post('/api/tags', async (c) => {
  const authUser = await getAuthUser(c);
  if (!authUser) {
    return writeError(c, 401, 'UNAUTHORIZED', 'authentication required');
  }
  let body: any = {};
  let formData: FormData | null = null;
  const rawHeader = c.req.header('content-type') || c.req.header('Content-Type') || (c.req.raw && c.req.raw.headers ? c.req.raw.headers.get('content-type') : '') || '';
  const contentType = String(rawHeader).toLowerCase();
  if (contentType.includes('multipart/form-data')) {
    try {
      formData = await c.req.formData();
      formData.forEach((val, key) => {
        if (typeof val === 'string') { body[key] = (val !== '' && !isNaN(Number(val))) ? Number(val) : val; }
      });
    } catch (e) {
      return writeError(c, 400, 'INVALID_MULTIPART', 'failed to parse multipart body');
    }
  } else {
    try {
      body = await c.req.json();
    } catch (e) {
      return writeError(c, 400, 'INVALID_JSON', 'failed to parse json body');
    }
  }

  if (body['role'] === 'admin' && (!authUser || authUser.role !== 'admin')) {
    return writeError(c, 403, 'FORBIDDEN', 'cannot grant admin role');
  }
  if (authUser) {
    body['owner_id'] = authUser.id;
  } else {
    delete body['owner_id'];
  }
  if (body['legacy_id'] !== undefined && body['legacy_id'] !== null && typeof body['legacy_id'] !== 'string') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field legacy_id must be a string');
  }
  if (body['owner_id'] !== undefined && body['owner_id'] !== null && typeof body['owner_id'] !== 'string') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field owner_id must be a string');
  }
  if (body['drink_type'] !== undefined && body['drink_type'] !== null && typeof body['drink_type'] !== 'string') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field drink_type must be a string');
  }
  if (body['tag_group'] === undefined || body['tag_group'] === null) {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field tag_group is required');
  }
  if (body['label'] === undefined || body['label'] === null) {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field label is required');
  }
  if (body['label'] !== undefined && body['label'] !== null && typeof body['label'] !== 'string') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field label must be a string');
  }
  if (body['is_default'] !== undefined && body['is_default'] !== null && typeof body['is_default'] !== 'boolean') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field is_default must be a boolean');
  }

  const now = new Date().toISOString();
  const insertSql = `INSERT INTO "tags" ("legacy_id", "owner_id", "drink_type", "tag_group", "label", "is_default", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`;
  let created: any = null;
  try {
    created = await c.env.DB.prepare(insertSql).bind(body['legacy_id'] !== undefined ? body['legacy_id'] : null, body['owner_id'] !== undefined ? body['owner_id'] : null, body['drink_type'] !== undefined ? body['drink_type'] : 'sake', body['tag_group'] !== undefined ? body['tag_group'] : null, body['label'] !== undefined ? body['label'] : null, body['is_default'] !== undefined ? (body['is_default'] ? 1 : 0) : false, now, now).first<any>();
  } catch (err: any) {
    const errMsg = String(err?.message || err);
    if (errMsg.includes('UNIQUE constraint failed') || errMsg.includes('SQLITE_CONSTRAINT')) {
      return writeError(c, 400, 'INVALID_INPUT', `unique constraint failed: ${errMsg}`);
    }
    return writeError(c, 400, 'INVALID_INPUT', errMsg);
  }
  return c.json({ data: sanitizeRecord(created, []) }, 201);
});

// UPDATE /api/tags/:id
app.put('/api/tags/:id', async (c) => {
  const authUser = await getAuthUser(c);
  if (!authUser) {
    return writeError(c, 401, 'UNAUTHORIZED', 'authentication required');
  }
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM "tags" WHERE id = ?').bind(id).first();
  if (!existing) {
    return writeError(c, 404, 'NOT_FOUND', 'record not found');
  }
  const ownerVal = (existing as any)['owner_id'];
  if (ownerVal === null || ownerVal === undefined) {
    if (authUser.role !== 'admin') {
      return writeError(c, 403, 'FORBIDDEN', 'forbidden');
    }
  } else if (authUser.role !== 'admin' && ownerVal != authUser.id) {
    return writeError(c, 403, 'FORBIDDEN', 'forbidden');
  }
  let body: any;
  try {
    body = await c.req.json();
  } catch (e) {
    return writeError(c, 400, 'INVALID_JSON', 'failed to parse json body');
  }

  if (body['role'] !== undefined && body['role'] !== (existing as any)['role'] && body['role'] === 'admin' && (!authUser || authUser.role !== 'admin')) {
    return writeError(c, 403, 'FORBIDDEN', 'cannot grant admin role');
  }
  const now = new Date().toISOString();
  const updateSql = `UPDATE "tags" SET "legacy_id" = ?, "owner_id" = ?, "drink_type" = ?, "tag_group" = ?, "label" = ?, "is_default" = ?, "updated_at" = ? WHERE id = ? RETURNING *`;
  let updated: any = null;
  try {
    updated = await c.env.DB.prepare(updateSql).bind(body['legacy_id'] !== undefined ? body['legacy_id'] : (existing as any)['legacy_id'], body['owner_id'] !== undefined ? body['owner_id'] : (existing as any)['owner_id'], body['drink_type'] !== undefined ? body['drink_type'] : (existing as any)['drink_type'], body['tag_group'] !== undefined ? body['tag_group'] : (existing as any)['tag_group'], body['label'] !== undefined ? body['label'] : (existing as any)['label'], body['is_default'] !== undefined ? body['is_default'] : (existing as any)['is_default'], now, id).first();
  } catch (err: any) {
    const errMsg = String(err?.message || err);
    if (errMsg.includes('UNIQUE constraint failed') || errMsg.includes('SQLITE_CONSTRAINT')) {
      return writeError(c, 400, 'INVALID_INPUT', `unique constraint failed: ${errMsg}`);
    }
    return writeError(c, 400, 'INVALID_INPUT', errMsg);
  }
  if (!updated) {
    return writeError(c, 404, 'NOT_FOUND', 'record not found');
  }
  return c.json({ data: sanitizeRecord(updated, []) });
});

// DELETE /api/tags/:id
app.delete('/api/tags/:id', async (c) => {
  const authUser = await getAuthUser(c);
  if (!authUser) {
    return writeError(c, 401, 'UNAUTHORIZED', 'authentication required');
  }
  const id = c.req.param('id');
  const parsedId = isNaN(Number(id)) ? id : Number(id);
  const existing = await c.env.DB.prepare('SELECT * FROM "tags" WHERE id = ?').bind(id).first();
  if (!existing) {
    return writeError(c, 404, 'NOT_FOUND', 'record not found');
  }
  const ownerVal = (existing as any)['owner_id'];
  if (ownerVal === null || ownerVal === undefined) {
    if (authUser.role !== 'admin') {
      return writeError(c, 403, 'FORBIDDEN', 'forbidden');
    }
  } else if (authUser.role !== 'admin' && ownerVal != authUser.id) {
    return writeError(c, 403, 'FORBIDDEN', 'forbidden');
  }
  const res = await c.env.DB.prepare('DELETE FROM "tags" WHERE id = ?').bind(id).run();
  if (!res.meta.changes) {
    return writeError(c, 404, 'NOT_FOUND', 'record not found');
  }
  return c.json({ data: { deleted: true, id: parsedId } });
});

// VIEW LIST /view/tags
app.get('/view/tags', async (c) => {
  const authUser = await getAuthUser(c);
  const whereConds: string[] = [];
  const params: any[] = [];
  if (!authUser || authUser.role !== 'admin') {
    if (authUser) {
      whereConds.push('("owner_id" = ? OR "owner_id" IS NULL)');
      params.push(authUser.id);
    } else {
      whereConds.push('"owner_id" IS NULL');
    }
  }
  const whereClause = whereConds.length > 0 ? ' WHERE ' + whereConds.join(' AND ') : '';
  const { results } = await c.env.DB.prepare(`SELECT * FROM "tags"${whereClause} ORDER BY id ASC`).bind(...params).all();
  const viewRecs = (results || []) as any[];
  const incErr = await processIncludes(c, 'tags', viewRecs, c.req.query('include'), authUser);
  if (incErr) return incErr;
  let html = `<!DOCTYPE html><html><head><title>Tag List</title></head><body>`;
  html += `<h1>Tag List</h1>`;
  html += `<a href="/view/tags/new">+ New Tag</a><br/><br/><table border="1"><thead><tr><th>id</th>`;
  html += `<th>legacy_id</th>`;
  html += `<th>owner_id</th>`;
  html += `<th>drink_type</th>`;
  html += `<th>tag_group</th>`;
  html += `<th>label</th>`;
  html += `<th>is_default</th>`;
  html += `<th>Actions</th></tr></thead><tbody>`;
  for (const row of viewRecs) {
    html += `<tr><td>${(row as any).id}</td>`;
    html += `<td>${escapeHTML((row as any)['legacy_id'])}</td>`;
    html += `<td>${escapeHTML((row as any)['owner_id'])}</td>`;
    html += `<td>${escapeHTML((row as any)['drink_type'])}</td>`;
    html += `<td>${escapeHTML((row as any)['tag_group'])}</td>`;
    html += `<td>${escapeHTML((row as any)['label'])}</td>`;
    html += `<td>${escapeHTML((row as any)['is_default'])}</td>`;
    html += `<td><a href="/view/tags/${(row as any).id}">Detail</a> <a href="/view/tags/${(row as any).id}/edit">Edit</a></td></tr>`;
  }
  html += `</tbody></table></body></html>`;
  return c.html(html);
});

// VIEW NEW /view/tags/new
app.get('/view/tags/new', async (c) => {
  let html = `<!DOCTYPE html><html><head><title>New Tag</title></head><body><h1>New Tag</h1><form method="POST" action="/view/tags">`;
  html += `<label>legacy_id: <input type="text" name="legacy_id" /></label><br/><br/>`;
  html += `<label>owner_id: <input type="text" name="owner_id" /></label><br/><br/>`;
  html += `<label>drink_type: <input type="text" name="drink_type" /></label><br/><br/>`;
  html += `<label>tag_group: <input type="text" name="tag_group" /></label><br/><br/>`;
  html += `<label>label: <input type="text" name="label" /></label><br/><br/>`;
  html += `<label>is_default: <input type="text" name="is_default" /></label><br/><br/>`;
  html += `<button type="submit">Save</button></form></body></html>`;
  return c.html(html);
});

// VIEW CREATE SUBMIT /view/tags
app.post('/view/tags', async (c) => {
  const formData = await c.req.formData();
  const body: any = {};
  formData.forEach((value, key) => { body[key] = value; });
  const now = new Date().toISOString();
  const insertSql = `INSERT INTO "tags" ("legacy_id", "owner_id", "drink_type", "tag_group", "label", "is_default", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  await c.env.DB.prepare(insertSql).bind(body['legacy_id'] !== undefined ? body['legacy_id'] : null, body['owner_id'] !== undefined ? body['owner_id'] : null, body['drink_type'] !== undefined ? body['drink_type'] : 'sake', body['tag_group'] !== undefined ? body['tag_group'] : null, body['label'] !== undefined ? body['label'] : null, body['is_default'] !== undefined ? (body['is_default'] ? 1 : 0) : false, now, now).run();
  return c.redirect('/view/tags', 303);
});

// VIEW DETAIL /view/tags/:id
app.get('/view/tags/:id', async (c) => {
  const id = c.req.param('id');
  const record = await c.env.DB.prepare('SELECT * FROM "tags" WHERE id = ?').bind(id).first<any>();
  if (!record) return c.html('<h1>404 Not Found</h1>', 404);
  const authUser = await getAuthUser(c);
  const incErr = await processIncludes(c, 'tags', [record], c.req.query('include'), authUser);
  if (incErr) return incErr;
  let html = `<!DOCTYPE html><html><head><title>Tag Detail</title></head><body><h1>Tag #${id}</h1><dl>`;
  html += `<dt>legacy_id</dt><dd>${escapeHTML(record['legacy_id'])}</dd>`;
  html += `<dt>owner_id</dt><dd>${escapeHTML(record['owner_id'])}</dd>`;
  html += `<dt>drink_type</dt><dd>${escapeHTML(record['drink_type'])}</dd>`;
  html += `<dt>tag_group</dt><dd>${escapeHTML(record['tag_group'])}</dd>`;
  html += `<dt>label</dt><dd>${escapeHTML(record['label'])}</dd>`;
  html += `<dt>is_default</dt><dd>${escapeHTML(record['is_default'])}</dd>`;
  html += `</dl></body></html>`;
  return c.html(html);
});

// LIST /api/users
app.get('/api/users', async (c) => {
  const authUser = await getAuthUser(c);
  if (!authUser) {
    return writeError(c, 401, 'UNAUTHORIZED', 'authentication required');
  }
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 100);
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10), 0);

  const whereConds: string[] = [];
  const params: any[] = [];
  const whereClause = whereConds.length > 0 ? ' WHERE ' + whereConds.join(' AND ') : '';
  const countSql = `SELECT COUNT(*) as total FROM "users"${whereClause}`;
  const countStmt = await c.env.DB.prepare(countSql).bind(...params).first<{ total: number }>();
  const total = countStmt ? countStmt.total : 0;
  const querySql = `SELECT * FROM "users"${whereClause} ORDER BY id ASC LIMIT ? OFFSET ?`;
  const { results } = await c.env.DB.prepare(querySql).bind(...params, limit, offset).all();
  const sanitized = (results || []).map((r: any) => sanitizeRecord(r, []));
  const incErr = await processIncludes(c, 'users', sanitized, c.req.query('include'), authUser);
  if (incErr) return incErr;
  return c.json({
    data: sanitized,
    meta: { total, limit, offset }
  });
});

// DETAIL /api/users/:id
app.get('/api/users/:id', async (c) => {
  const authUser = await getAuthUser(c);
  if (!authUser) {
    return writeError(c, 401, 'UNAUTHORIZED', 'authentication required');
  }
  const id = c.req.param('id');
  const record = await c.env.DB.prepare('SELECT * FROM "users" WHERE id = ?').bind(id).first();
  if (!record) {
    return writeError(c, 404, 'NOT_FOUND', 'record not found');
  }
  const sanitized = sanitizeRecord(record, []);
  const incErr = await processIncludes(c, 'users', [sanitized], c.req.query('include'), authUser);
  if (incErr) return incErr;
  return c.json({ data: sanitized });
});

// CREATE /api/users
app.post('/api/users', async (c) => {
  const authUser = await getAuthUser(c);
  let body: any = {};
  let formData: FormData | null = null;
  const rawHeader = c.req.header('content-type') || c.req.header('Content-Type') || (c.req.raw && c.req.raw.headers ? c.req.raw.headers.get('content-type') : '') || '';
  const contentType = String(rawHeader).toLowerCase();
  if (contentType.includes('multipart/form-data')) {
    try {
      formData = await c.req.formData();
      formData.forEach((val, key) => {
        if (typeof val === 'string') { body[key] = (val !== '' && !isNaN(Number(val))) ? Number(val) : val; }
      });
    } catch (e) {
      return writeError(c, 400, 'INVALID_MULTIPART', 'failed to parse multipart body');
    }
  } else {
    try {
      body = await c.req.json();
    } catch (e) {
      return writeError(c, 400, 'INVALID_JSON', 'failed to parse json body');
    }
  }

  if (body['role'] === 'admin' && (!authUser || authUser.role !== 'admin')) {
    return writeError(c, 403, 'FORBIDDEN', 'cannot grant admin role');
  }
  if (body['provider'] === undefined || body['provider'] === null) {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field provider is required');
  }
  if (body['provider'] !== undefined && body['provider'] !== null && typeof body['provider'] !== 'string') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field provider must be a string');
  }
  if (body['provider_user_id'] === undefined || body['provider_user_id'] === null) {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field provider_user_id is required');
  }
  if (body['provider_user_id'] !== undefined && body['provider_user_id'] !== null && typeof body['provider_user_id'] !== 'string') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field provider_user_id must be a string');
  }
  if (body['email'] !== undefined && body['email'] !== null && typeof body['email'] !== 'string') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field email must be a string');
  }
  if (body['display_name'] !== undefined && body['display_name'] !== null && typeof body['display_name'] !== 'string') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field display_name must be a string');
  }
  if (body['avatar_url'] !== undefined && body['avatar_url'] !== null && typeof body['avatar_url'] !== 'string') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field avatar_url must be a string');
  }

  const now = new Date().toISOString();
  const insertSql = `INSERT INTO "users" ("provider", "provider_user_id", "email", "display_name", "avatar_url", "last_login_at", "role", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`;
  let created: any = null;
  try {
    created = await c.env.DB.prepare(insertSql).bind(body['provider'] !== undefined ? body['provider'] : null, body['provider_user_id'] !== undefined ? body['provider_user_id'] : null, body['email'] !== undefined ? body['email'] : null, body['display_name'] !== undefined ? body['display_name'] : null, body['avatar_url'] !== undefined ? body['avatar_url'] : null, body['last_login_at'] !== undefined ? body['last_login_at'] : null, body['role'] !== undefined ? body['role'] : 'user', now, now).first<any>();
  } catch (err: any) {
    const errMsg = String(err?.message || err);
    if (errMsg.includes('UNIQUE constraint failed') || errMsg.includes('SQLITE_CONSTRAINT')) {
      return writeError(c, 400, 'INVALID_INPUT', `unique constraint failed: ${errMsg}`);
    }
    return writeError(c, 400, 'INVALID_INPUT', errMsg);
  }
  return c.json({ data: sanitizeRecord(created, []) }, 201);
});

// UPDATE /api/users/:id
app.put('/api/users/:id', async (c) => {
  const authUser = await getAuthUser(c);
  if (!authUser) {
    return writeError(c, 401, 'UNAUTHORIZED', 'authentication required');
  }
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM "users" WHERE id = ?').bind(id).first();
  if (!existing) {
    return writeError(c, 404, 'NOT_FOUND', 'record not found');
  }
  const ownerVal = (existing as any)['id'];
  if (ownerVal === null || ownerVal === undefined) {
    if (authUser.role !== 'admin') {
      return writeError(c, 403, 'FORBIDDEN', 'forbidden');
    }
  } else if (authUser.role !== 'admin' && ownerVal != authUser.id) {
    return writeError(c, 403, 'FORBIDDEN', 'forbidden');
  }
  let body: any;
  try {
    body = await c.req.json();
  } catch (e) {
    return writeError(c, 400, 'INVALID_JSON', 'failed to parse json body');
  }

  if (body['role'] !== undefined && body['role'] !== (existing as any)['role'] && body['role'] === 'admin' && (!authUser || authUser.role !== 'admin')) {
    return writeError(c, 403, 'FORBIDDEN', 'cannot grant admin role');
  }
  const now = new Date().toISOString();
  const updateSql = `UPDATE "users" SET "provider" = ?, "provider_user_id" = ?, "email" = ?, "display_name" = ?, "avatar_url" = ?, "last_login_at" = ?, "role" = ?, "updated_at" = ? WHERE id = ? RETURNING *`;
  let updated: any = null;
  try {
    updated = await c.env.DB.prepare(updateSql).bind(body['provider'] !== undefined ? body['provider'] : (existing as any)['provider'], body['provider_user_id'] !== undefined ? body['provider_user_id'] : (existing as any)['provider_user_id'], body['email'] !== undefined ? body['email'] : (existing as any)['email'], body['display_name'] !== undefined ? body['display_name'] : (existing as any)['display_name'], body['avatar_url'] !== undefined ? body['avatar_url'] : (existing as any)['avatar_url'], body['last_login_at'] !== undefined ? body['last_login_at'] : (existing as any)['last_login_at'], body['role'] !== undefined ? body['role'] : (existing as any)['role'], now, id).first();
  } catch (err: any) {
    const errMsg = String(err?.message || err);
    if (errMsg.includes('UNIQUE constraint failed') || errMsg.includes('SQLITE_CONSTRAINT')) {
      return writeError(c, 400, 'INVALID_INPUT', `unique constraint failed: ${errMsg}`);
    }
    return writeError(c, 400, 'INVALID_INPUT', errMsg);
  }
  if (!updated) {
    return writeError(c, 404, 'NOT_FOUND', 'record not found');
  }
  return c.json({ data: sanitizeRecord(updated, []) });
});

// DELETE /api/users/:id
app.delete('/api/users/:id', async (c) => {
  const authUser = await getAuthUser(c);
  if (!authUser) {
    return writeError(c, 401, 'UNAUTHORIZED', 'authentication required');
  }
  const id = c.req.param('id');
  const parsedId = isNaN(Number(id)) ? id : Number(id);
  const existing = await c.env.DB.prepare('SELECT * FROM "users" WHERE id = ?').bind(id).first();
  if (!existing) {
    return writeError(c, 404, 'NOT_FOUND', 'record not found');
  }
  if (!authUser || authUser.role !== 'admin') {
    return writeError(c, 403, 'FORBIDDEN', 'forbidden');
  }
  const res = await c.env.DB.prepare('DELETE FROM "users" WHERE id = ?').bind(id).run();
  if (!res.meta.changes) {
    return writeError(c, 404, 'NOT_FOUND', 'record not found');
  }
  return c.json({ data: { deleted: true, id: parsedId } });
});

// VIEW LIST /view/users
app.get('/view/users', async (c) => {
  const authUser = await getAuthUser(c);
  const whereConds: string[] = [];
  const params: any[] = [];
  const whereClause = whereConds.length > 0 ? ' WHERE ' + whereConds.join(' AND ') : '';
  const { results } = await c.env.DB.prepare(`SELECT * FROM "users"${whereClause} ORDER BY id ASC`).bind(...params).all();
  const viewRecs = (results || []) as any[];
  const incErr = await processIncludes(c, 'users', viewRecs, c.req.query('include'), authUser);
  if (incErr) return incErr;
  let html = `<!DOCTYPE html><html><head><title>User List</title></head><body>`;
  html += `<h1>User List</h1>`;
  html += `<a href="/view/users/new">+ New User</a><br/><br/><table border="1"><thead><tr><th>id</th>`;
  html += `<th>provider</th>`;
  html += `<th>provider_user_id</th>`;
  html += `<th>email</th>`;
  html += `<th>display_name</th>`;
  html += `<th>avatar_url</th>`;
  html += `<th>last_login_at</th>`;
  html += `<th>role</th>`;
  html += `<th>Actions</th></tr></thead><tbody>`;
  for (const row of viewRecs) {
    html += `<tr><td>${(row as any).id}</td>`;
    html += `<td>${escapeHTML((row as any)['provider'])}</td>`;
    html += `<td>${escapeHTML((row as any)['provider_user_id'])}</td>`;
    html += `<td>${escapeHTML((row as any)['email'])}</td>`;
    html += `<td>${escapeHTML((row as any)['display_name'])}</td>`;
    html += `<td>${escapeHTML((row as any)['avatar_url'])}</td>`;
    html += `<td>${escapeHTML((row as any)['last_login_at'])}</td>`;
    html += `<td>${escapeHTML((row as any)['role'])}</td>`;
    html += `<td><a href="/view/users/${(row as any).id}">Detail</a> <a href="/view/users/${(row as any).id}/edit">Edit</a></td></tr>`;
  }
  html += `</tbody></table></body></html>`;
  return c.html(html);
});

// VIEW NEW /view/users/new
app.get('/view/users/new', async (c) => {
  let html = `<!DOCTYPE html><html><head><title>New User</title></head><body><h1>New User</h1><form method="POST" action="/view/users">`;
  html += `<label>provider: <input type="text" name="provider" /></label><br/><br/>`;
  html += `<label>provider_user_id: <input type="text" name="provider_user_id" /></label><br/><br/>`;
  html += `<label>email: <input type="text" name="email" /></label><br/><br/>`;
  html += `<label>display_name: <input type="text" name="display_name" /></label><br/><br/>`;
  html += `<label>avatar_url: <input type="text" name="avatar_url" /></label><br/><br/>`;
  html += `<label>last_login_at: <input type="text" name="last_login_at" /></label><br/><br/>`;
  html += `<label>role: <input type="text" name="role" /></label><br/><br/>`;
  html += `<button type="submit">Save</button></form></body></html>`;
  return c.html(html);
});

// VIEW CREATE SUBMIT /view/users
app.post('/view/users', async (c) => {
  const formData = await c.req.formData();
  const body: any = {};
  formData.forEach((value, key) => { body[key] = value; });
  const now = new Date().toISOString();
  const insertSql = `INSERT INTO "users" ("provider", "provider_user_id", "email", "display_name", "avatar_url", "last_login_at", "role", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  await c.env.DB.prepare(insertSql).bind(body['provider'] !== undefined ? body['provider'] : null, body['provider_user_id'] !== undefined ? body['provider_user_id'] : null, body['email'] !== undefined ? body['email'] : null, body['display_name'] !== undefined ? body['display_name'] : null, body['avatar_url'] !== undefined ? body['avatar_url'] : null, body['last_login_at'] !== undefined ? body['last_login_at'] : null, body['role'] !== undefined ? body['role'] : 'user', now, now).run();
  return c.redirect('/view/users', 303);
});

// VIEW DETAIL /view/users/:id
app.get('/view/users/:id', async (c) => {
  const id = c.req.param('id');
  const record = await c.env.DB.prepare('SELECT * FROM "users" WHERE id = ?').bind(id).first<any>();
  if (!record) return c.html('<h1>404 Not Found</h1>', 404);
  const authUser = await getAuthUser(c);
  const incErr = await processIncludes(c, 'users', [record], c.req.query('include'), authUser);
  if (incErr) return incErr;
  let html = `<!DOCTYPE html><html><head><title>User Detail</title></head><body><h1>User #${id}</h1><dl>`;
  html += `<dt>provider</dt><dd>${escapeHTML(record['provider'])}</dd>`;
  html += `<dt>provider_user_id</dt><dd>${escapeHTML(record['provider_user_id'])}</dd>`;
  html += `<dt>email</dt><dd>${escapeHTML(record['email'])}</dd>`;
  html += `<dt>display_name</dt><dd>${escapeHTML(record['display_name'])}</dd>`;
  html += `<dt>avatar_url</dt><dd>${escapeHTML(record['avatar_url'])}</dd>`;
  html += `<dt>last_login_at</dt><dd>${escapeHTML(record['last_login_at'])}</dd>`;
  html += `<dt>role</dt><dd>${escapeHTML(record['role'])}</dd>`;
  html += `</dl></body></html>`;
  return c.html(html);
});

// LIST /api/record_tags
app.get('/api/record_tags', async (c) => {
  const authUser = await getAuthUser(c);
  if (!authUser) {
    return writeError(c, 401, 'UNAUTHORIZED', 'authentication required');
  }
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 100);
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10), 0);

  const whereConds: string[] = [];
  const params: any[] = [];
  const whereClause = whereConds.length > 0 ? ' WHERE ' + whereConds.join(' AND ') : '';
  const countSql = `SELECT COUNT(*) as total FROM "record_tags"${whereClause}`;
  const countStmt = await c.env.DB.prepare(countSql).bind(...params).first<{ total: number }>();
  const total = countStmt ? countStmt.total : 0;
  const querySql = `SELECT * FROM "record_tags"${whereClause} ORDER BY id ASC LIMIT ? OFFSET ?`;
  const { results } = await c.env.DB.prepare(querySql).bind(...params, limit, offset).all();
  const sanitized = (results || []).map((r: any) => sanitizeRecord(r, []));
  const incErr = await processIncludes(c, 'record_tags', sanitized, c.req.query('include'), authUser);
  if (incErr) return incErr;
  return c.json({
    data: sanitized,
    meta: { total, limit, offset }
  });
});

// DETAIL /api/record_tags/:id
app.get('/api/record_tags/:id', async (c) => {
  const authUser = await getAuthUser(c);
  if (!authUser) {
    return writeError(c, 401, 'UNAUTHORIZED', 'authentication required');
  }
  const id = c.req.param('id');
  const record = await c.env.DB.prepare('SELECT * FROM "record_tags" WHERE id = ?').bind(id).first();
  if (!record) {
    return writeError(c, 404, 'NOT_FOUND', 'record not found');
  }
  const sanitized = sanitizeRecord(record, []);
  const incErr = await processIncludes(c, 'record_tags', [sanitized], c.req.query('include'), authUser);
  if (incErr) return incErr;
  return c.json({ data: sanitized });
});

// CREATE /api/record_tags
app.post('/api/record_tags', async (c) => {
  const authUser = await getAuthUser(c);
  if (!authUser) {
    return writeError(c, 401, 'UNAUTHORIZED', 'authentication required');
  }
  let body: any = {};
  let formData: FormData | null = null;
  const rawHeader = c.req.header('content-type') || c.req.header('Content-Type') || (c.req.raw && c.req.raw.headers ? c.req.raw.headers.get('content-type') : '') || '';
  const contentType = String(rawHeader).toLowerCase();
  if (contentType.includes('multipart/form-data')) {
    try {
      formData = await c.req.formData();
      formData.forEach((val, key) => {
        if (typeof val === 'string') { body[key] = (val !== '' && !isNaN(Number(val))) ? Number(val) : val; }
      });
    } catch (e) {
      return writeError(c, 400, 'INVALID_MULTIPART', 'failed to parse multipart body');
    }
  } else {
    try {
      body = await c.req.json();
    } catch (e) {
      return writeError(c, 400, 'INVALID_JSON', 'failed to parse json body');
    }
  }

  if (body['role'] === 'admin' && (!authUser || authUser.role !== 'admin')) {
    return writeError(c, 403, 'FORBIDDEN', 'cannot grant admin role');
  }
  if (body['sake_record_id'] === undefined || body['sake_record_id'] === null) {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field sake_record_id is required');
  }
  if (body['sake_record_id'] !== undefined && body['sake_record_id'] !== null && typeof body['sake_record_id'] !== 'number') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field sake_record_id must be a number');
  }
  if (body['tag_id'] === undefined || body['tag_id'] === null) {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field tag_id is required');
  }
  if (body['tag_id'] !== undefined && body['tag_id'] !== null && typeof body['tag_id'] !== 'string') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field tag_id must be a string');
  }

  const now = new Date().toISOString();
  const insertSql = `INSERT INTO "record_tags" ("sake_record_id", "tag_id", "created_at", "updated_at") VALUES (?, ?, ?, ?) RETURNING *`;
  let created: any = null;
  try {
    created = await c.env.DB.prepare(insertSql).bind(body['sake_record_id'] !== undefined ? body['sake_record_id'] : null, body['tag_id'] !== undefined ? body['tag_id'] : null, now, now).first<any>();
  } catch (err: any) {
    const errMsg = String(err?.message || err);
    if (errMsg.includes('UNIQUE constraint failed') || errMsg.includes('SQLITE_CONSTRAINT')) {
      return writeError(c, 400, 'INVALID_INPUT', `unique constraint failed: ${errMsg}`);
    }
    return writeError(c, 400, 'INVALID_INPUT', errMsg);
  }
  return c.json({ data: sanitizeRecord(created, []) }, 201);
});

// UPDATE /api/record_tags/:id
app.put('/api/record_tags/:id', async (c) => {
  const authUser = await getAuthUser(c);
  if (!authUser) {
    return writeError(c, 401, 'UNAUTHORIZED', 'authentication required');
  }
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM "record_tags" WHERE id = ?').bind(id).first();
  if (!existing) {
    return writeError(c, 404, 'NOT_FOUND', 'record not found');
  }
  let body: any;
  try {
    body = await c.req.json();
  } catch (e) {
    return writeError(c, 400, 'INVALID_JSON', 'failed to parse json body');
  }

  if (body['role'] !== undefined && body['role'] !== (existing as any)['role'] && body['role'] === 'admin' && (!authUser || authUser.role !== 'admin')) {
    return writeError(c, 403, 'FORBIDDEN', 'cannot grant admin role');
  }
  const now = new Date().toISOString();
  const updateSql = `UPDATE "record_tags" SET "sake_record_id" = ?, "tag_id" = ?, "updated_at" = ? WHERE id = ? RETURNING *`;
  let updated: any = null;
  try {
    updated = await c.env.DB.prepare(updateSql).bind(body['sake_record_id'] !== undefined ? body['sake_record_id'] : (existing as any)['sake_record_id'], body['tag_id'] !== undefined ? body['tag_id'] : (existing as any)['tag_id'], now, id).first();
  } catch (err: any) {
    const errMsg = String(err?.message || err);
    if (errMsg.includes('UNIQUE constraint failed') || errMsg.includes('SQLITE_CONSTRAINT')) {
      return writeError(c, 400, 'INVALID_INPUT', `unique constraint failed: ${errMsg}`);
    }
    return writeError(c, 400, 'INVALID_INPUT', errMsg);
  }
  if (!updated) {
    return writeError(c, 404, 'NOT_FOUND', 'record not found');
  }
  return c.json({ data: sanitizeRecord(updated, []) });
});

// DELETE /api/record_tags/:id
app.delete('/api/record_tags/:id', async (c) => {
  const authUser = await getAuthUser(c);
  if (!authUser) {
    return writeError(c, 401, 'UNAUTHORIZED', 'authentication required');
  }
  const id = c.req.param('id');
  const parsedId = isNaN(Number(id)) ? id : Number(id);
  const existing = await c.env.DB.prepare('SELECT * FROM "record_tags" WHERE id = ?').bind(id).first();
  if (!existing) {
    return writeError(c, 404, 'NOT_FOUND', 'record not found');
  }
  const res = await c.env.DB.prepare('DELETE FROM "record_tags" WHERE id = ?').bind(id).run();
  if (!res.meta.changes) {
    return writeError(c, 404, 'NOT_FOUND', 'record not found');
  }
  return c.json({ data: { deleted: true, id: parsedId } });
});

// VIEW LIST /view/record_tags
app.get('/view/record_tags', async (c) => {
  const authUser = await getAuthUser(c);
  const whereConds: string[] = [];
  const params: any[] = [];
  const whereClause = whereConds.length > 0 ? ' WHERE ' + whereConds.join(' AND ') : '';
  const { results } = await c.env.DB.prepare(`SELECT * FROM "record_tags"${whereClause} ORDER BY id ASC`).bind(...params).all();
  const viewRecs = (results || []) as any[];
  const incErr = await processIncludes(c, 'record_tags', viewRecs, c.req.query('include'), authUser);
  if (incErr) return incErr;
  let html = `<!DOCTYPE html><html><head><title>RecordTag List</title></head><body>`;
  html += `<h1>RecordTag List</h1>`;
  html += `<a href="/view/record_tags/new">+ New RecordTag</a><br/><br/><table border="1"><thead><tr><th>id</th>`;
  html += `<th>sake_record_id</th>`;
  html += `<th>tag_id</th>`;
  html += `<th>Actions</th></tr></thead><tbody>`;
  for (const row of viewRecs) {
    html += `<tr><td>${(row as any).id}</td>`;
    html += `<td>${escapeHTML((row as any)['sake_record_id'])}</td>`;
    html += `<td>${escapeHTML((row as any)['tag_id'])}</td>`;
    html += `<td><a href="/view/record_tags/${(row as any).id}">Detail</a> <a href="/view/record_tags/${(row as any).id}/edit">Edit</a></td></tr>`;
  }
  html += `</tbody></table></body></html>`;
  return c.html(html);
});

// VIEW NEW /view/record_tags/new
app.get('/view/record_tags/new', async (c) => {
  let html = `<!DOCTYPE html><html><head><title>New RecordTag</title></head><body><h1>New RecordTag</h1><form method="POST" action="/view/record_tags">`;
  html += `<label>sake_record_id: <input type="number" name="sake_record_id" /></label><br/><br/>`;
  html += `<label>tag_id: <input type="text" name="tag_id" /></label><br/><br/>`;
  html += `<button type="submit">Save</button></form></body></html>`;
  return c.html(html);
});

// VIEW CREATE SUBMIT /view/record_tags
app.post('/view/record_tags', async (c) => {
  const formData = await c.req.formData();
  const body: any = {};
  formData.forEach((value, key) => { body[key] = value; });
  const now = new Date().toISOString();
  const insertSql = `INSERT INTO "record_tags" ("sake_record_id", "tag_id", "created_at", "updated_at") VALUES (?, ?, ?, ?)`;
  await c.env.DB.prepare(insertSql).bind(body['sake_record_id'] !== undefined ? body['sake_record_id'] : null, body['tag_id'] !== undefined ? body['tag_id'] : null, now, now).run();
  return c.redirect('/view/record_tags', 303);
});

// VIEW DETAIL /view/record_tags/:id
app.get('/view/record_tags/:id', async (c) => {
  const id = c.req.param('id');
  const record = await c.env.DB.prepare('SELECT * FROM "record_tags" WHERE id = ?').bind(id).first<any>();
  if (!record) return c.html('<h1>404 Not Found</h1>', 404);
  const authUser = await getAuthUser(c);
  const incErr = await processIncludes(c, 'record_tags', [record], c.req.query('include'), authUser);
  if (incErr) return incErr;
  let html = `<!DOCTYPE html><html><head><title>RecordTag Detail</title></head><body><h1>RecordTag #${id}</h1><dl>`;
  html += `<dt>sake_record_id</dt><dd>${escapeHTML(record['sake_record_id'])}</dd>`;
  html += `<dt>tag_id</dt><dd>${escapeHTML(record['tag_id'])}</dd>`;
  html += `</dl></body></html>`;
  return c.html(html);
});

// LIST /api/sake_images
app.get('/api/sake_images', async (c) => {
  const authUser = await getAuthUser(c);
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 100);
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10), 0);

  const whereConds: string[] = [];
  const params: any[] = [];
  if (!authUser || authUser.role !== 'admin') {
    if (authUser) {
      whereConds.push('("owner_id" = ? OR "owner_id" IS NULL)');
      params.push(authUser.id);
    } else {
      whereConds.push('"owner_id" IS NULL');
    }
  }
  const whereClause = whereConds.length > 0 ? ' WHERE ' + whereConds.join(' AND ') : '';
  const countSql = `SELECT COUNT(*) as total FROM "sake_images"${whereClause}`;
  const countStmt = await c.env.DB.prepare(countSql).bind(...params).first<{ total: number }>();
  const total = countStmt ? countStmt.total : 0;
  const querySql = `SELECT * FROM "sake_images"${whereClause} ORDER BY id ASC LIMIT ? OFFSET ?`;
  const { results } = await c.env.DB.prepare(querySql).bind(...params, limit, offset).all();
  const sanitized = (results || []).map((r: any) => sanitizeRecord(r, []));
  const incErr = await processIncludes(c, 'sake_images', sanitized, c.req.query('include'), authUser);
  if (incErr) return incErr;
  return c.json({
    data: sanitized,
    meta: { total, limit, offset }
  });
});

// DETAIL /api/sake_images/:id
app.get('/api/sake_images/:id', async (c) => {
  const authUser = await getAuthUser(c);
  const id = c.req.param('id');
  const record = await c.env.DB.prepare('SELECT * FROM "sake_images" WHERE id = ?').bind(id).first();
  if (!record) {
    return writeError(c, 404, 'NOT_FOUND', 'record not found');
  }
  const ownerVal = (record as any)['owner_id'];
  if (ownerVal !== null && ownerVal !== undefined) {
    if (!authUser) {
      return writeError(c, 401, 'UNAUTHORIZED', 'authentication required');
    }
    if (authUser.role !== 'admin' && ownerVal != authUser.id) {
      return writeError(c, 403, 'FORBIDDEN', 'forbidden');
    }
  }
  const sanitized = sanitizeRecord(record, []);
  const incErr = await processIncludes(c, 'sake_images', [sanitized], c.req.query('include'), authUser);
  if (incErr) return incErr;
  return c.json({ data: sanitized });
});

// CREATE /api/sake_images
app.post('/api/sake_images', async (c) => {
  const authUser = await getAuthUser(c);
  if (!authUser) {
    return writeError(c, 401, 'UNAUTHORIZED', 'authentication required');
  }
  let body: any = {};
  let formData: FormData | null = null;
  const rawHeader = c.req.header('content-type') || c.req.header('Content-Type') || (c.req.raw && c.req.raw.headers ? c.req.raw.headers.get('content-type') : '') || '';
  const contentType = String(rawHeader).toLowerCase();
  if (contentType.includes('multipart/form-data')) {
    try {
      formData = await c.req.formData();
      formData.forEach((val, key) => {
        if (typeof val === 'string') { body[key] = (val !== '' && !isNaN(Number(val))) ? Number(val) : val; }
      });
    } catch (e) {
      return writeError(c, 400, 'INVALID_MULTIPART', 'failed to parse multipart body');
    }
  } else {
    try {
      body = await c.req.json();
    } catch (e) {
      return writeError(c, 400, 'INVALID_JSON', 'failed to parse json body');
    }
  }

  if (body['role'] === 'admin' && (!authUser || authUser.role !== 'admin')) {
    return writeError(c, 403, 'FORBIDDEN', 'cannot grant admin role');
  }
  if (authUser) {
    body['owner_id'] = authUser.id;
  } else {
    delete body['owner_id'];
  }
  if (body['legacy_id'] !== undefined && body['legacy_id'] !== null && typeof body['legacy_id'] !== 'string') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field legacy_id must be a string');
  }
  if (body['owner_id'] === undefined || body['owner_id'] === null) {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field owner_id is required');
  }
  if (body['owner_id'] !== undefined && body['owner_id'] !== null && typeof body['owner_id'] !== 'string') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field owner_id must be a string');
  }
  if (body['record_id'] === undefined || body['record_id'] === null) {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field record_id is required');
  }
  if (body['record_id'] !== undefined && body['record_id'] !== null && typeof body['record_id'] !== 'number') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field record_id must be a number');
  }
  if (body['mime_type'] === undefined || body['mime_type'] === null) {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field mime_type is required');
  }
  if (body['mime_type'] !== undefined && body['mime_type'] !== null && typeof body['mime_type'] !== 'string') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field mime_type must be a string');
  }
  if (body['file_name'] === undefined || body['file_name'] === null) {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field file_name is required');
  }
  if (body['file_name'] !== undefined && body['file_name'] !== null && typeof body['file_name'] !== 'string') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field file_name must be a string');
  }
  if (body['display_order'] !== undefined && body['display_order'] !== null && typeof body['display_order'] !== 'number') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field display_order must be a number');
  }

  const now = new Date().toISOString();
  const insertSql = `INSERT INTO "sake_images" ("legacy_id", "owner_id", "record_id", "image_key", "thumbnail_key", "mime_type", "file_name", "display_order", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`;
  let created: any = null;
  try {
    created = await c.env.DB.prepare(insertSql).bind(body['legacy_id'] !== undefined ? body['legacy_id'] : null, body['owner_id'] !== undefined ? body['owner_id'] : null, body['record_id'] !== undefined ? body['record_id'] : null, null, null, body['mime_type'] !== undefined ? body['mime_type'] : null, body['file_name'] !== undefined ? body['file_name'] : null, body['display_order'] !== undefined ? body['display_order'] : 0, now, now).first<any>();
  } catch (err: any) {
    const errMsg = String(err?.message || err);
    if (errMsg.includes('UNIQUE constraint failed') || errMsg.includes('SQLITE_CONSTRAINT')) {
      return writeError(c, 400, 'INVALID_INPUT', `unique constraint failed: ${errMsg}`);
    }
    return writeError(c, 400, 'INVALID_INPUT', errMsg);
  }
  if (created && formData) {
    const uploadedBlobKeys: string[] = [];
    let blobUploadError: any = null;
    if (!blobUploadError) {
      const file_image_key = formData.get('image_key');
      if (file_image_key !== null && file_image_key !== undefined && file_image_key !== '') {
        let fileData_image_key: any = file_image_key;
        let mimeType_image_key = 'application/octet-stream';
        let ext_image_key = '';
        if (typeof file_image_key === 'object') {
          mimeType_image_key = (file_image_key as any).type || mimeType_image_key;
          if ((file_image_key as any).name) { ext_image_key = (file_image_key as any).name.substring((file_image_key as any).name.lastIndexOf('.')); }
          if (typeof (file_image_key as any).stream === 'function') { fileData_image_key = (file_image_key as any).stream(); }
        }
        const key = `blobs/sake_images/${created.id}/image_key_${Date.now()}${ext_image_key}`;
        try {
          await c.env.BUCKET.put(key, fileData_image_key, { httpMetadata: { contentType: mimeType_image_key } });
          uploadedBlobKeys.push(key);
          await c.env.DB.prepare('UPDATE "sake_images" SET "image_key" = ? WHERE id = ?').bind(key, created.id).run();
          created['image_key'] = key;
        } catch (err) {
          blobUploadError = err;
        }
      }
    }
    if (!blobUploadError) {
      const file_thumbnail_key = formData.get('thumbnail_key');
      if (file_thumbnail_key !== null && file_thumbnail_key !== undefined && file_thumbnail_key !== '') {
        let fileData_thumbnail_key: any = file_thumbnail_key;
        let mimeType_thumbnail_key = 'application/octet-stream';
        let ext_thumbnail_key = '';
        if (typeof file_thumbnail_key === 'object') {
          mimeType_thumbnail_key = (file_thumbnail_key as any).type || mimeType_thumbnail_key;
          if ((file_thumbnail_key as any).name) { ext_thumbnail_key = (file_thumbnail_key as any).name.substring((file_thumbnail_key as any).name.lastIndexOf('.')); }
          if (typeof (file_thumbnail_key as any).stream === 'function') { fileData_thumbnail_key = (file_thumbnail_key as any).stream(); }
        }
        const key = `blobs/sake_images/${created.id}/thumbnail_key_${Date.now()}${ext_thumbnail_key}`;
        try {
          await c.env.BUCKET.put(key, fileData_thumbnail_key, { httpMetadata: { contentType: mimeType_thumbnail_key } });
          uploadedBlobKeys.push(key);
          await c.env.DB.prepare('UPDATE "sake_images" SET "thumbnail_key" = ? WHERE id = ?').bind(key, created.id).run();
          created['thumbnail_key'] = key;
        } catch (err) {
          blobUploadError = err;
        }
      }
    }
    if (blobUploadError) {
      // Order rationale: Execute D1 hard delete BEFORE R2 compensating deletion to ensure
      // HTTP GET requests immediately return 404 NOT_FOUND instead of 200 OK with a broken image link
      // (dangling reference) while R2 orphan objects are being deleted.
      let d1RollbackFailed = false;
      try {
        await c.env.DB.prepare('DELETE FROM "sake_images" WHERE id = ?').bind(created.id).run();
      } catch (rollbackErr) {
        d1RollbackFailed = true;
      }
      const failedCleanupKeys: string[] = [];
      for (const key of uploadedBlobKeys) {
        try {
          await c.env.BUCKET.delete(key);
        } catch (cleanupErr) {
          failedCleanupKeys.push(key);
        }
      }
      if (failedCleanupKeys.length > 0) {
        return writeError(c, 500, 'BLOB_ORPHAN_CLEANUP_FAILED', 'failed uploading blob; some R2 orphan objects could not be cleaned up', { orphan_keys: failedCleanupKeys, d1_rollback_failed: d1RollbackFailed });
      } else if (d1RollbackFailed) {
        return writeError(c, 500, 'BLOB_STORE_FAILED_RECORD_PRESERVED', 'failed uploading blob and failed rolling back record');
      } else {
        return writeError(c, 500, 'BLOB_STORE_FAILED', 'failed uploading blob; record creation rolled back');
      }
    }
  }
  return c.json({ data: sanitizeRecord(created, []) }, 201);
});

// UPDATE /api/sake_images/:id
app.put('/api/sake_images/:id', async (c) => {
  const authUser = await getAuthUser(c);
  if (!authUser) {
    return writeError(c, 401, 'UNAUTHORIZED', 'authentication required');
  }
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM "sake_images" WHERE id = ?').bind(id).first();
  if (!existing) {
    return writeError(c, 404, 'NOT_FOUND', 'record not found');
  }
  const ownerVal = (existing as any)['owner_id'];
  if (ownerVal === null || ownerVal === undefined) {
    if (authUser.role !== 'admin') {
      return writeError(c, 403, 'FORBIDDEN', 'forbidden');
    }
  } else if (authUser.role !== 'admin' && ownerVal != authUser.id) {
    return writeError(c, 403, 'FORBIDDEN', 'forbidden');
  }
  let body: any;
  try {
    body = await c.req.json();
  } catch (e) {
    return writeError(c, 400, 'INVALID_JSON', 'failed to parse json body');
  }

  if (body['role'] !== undefined && body['role'] !== (existing as any)['role'] && body['role'] === 'admin' && (!authUser || authUser.role !== 'admin')) {
    return writeError(c, 403, 'FORBIDDEN', 'cannot grant admin role');
  }
  const now = new Date().toISOString();
  const updateSql = `UPDATE "sake_images" SET "legacy_id" = ?, "owner_id" = ?, "record_id" = ?, "image_key" = ?, "thumbnail_key" = ?, "mime_type" = ?, "file_name" = ?, "display_order" = ?, "updated_at" = ? WHERE id = ? RETURNING *`;
  let updated: any = null;
  try {
    updated = await c.env.DB.prepare(updateSql).bind(body['legacy_id'] !== undefined ? body['legacy_id'] : (existing as any)['legacy_id'], body['owner_id'] !== undefined ? body['owner_id'] : (existing as any)['owner_id'], body['record_id'] !== undefined ? body['record_id'] : (existing as any)['record_id'], body['image_key'] !== undefined ? body['image_key'] : (existing as any)['image_key'], body['thumbnail_key'] !== undefined ? body['thumbnail_key'] : (existing as any)['thumbnail_key'], body['mime_type'] !== undefined ? body['mime_type'] : (existing as any)['mime_type'], body['file_name'] !== undefined ? body['file_name'] : (existing as any)['file_name'], body['display_order'] !== undefined ? body['display_order'] : (existing as any)['display_order'], now, id).first();
  } catch (err: any) {
    const errMsg = String(err?.message || err);
    if (errMsg.includes('UNIQUE constraint failed') || errMsg.includes('SQLITE_CONSTRAINT')) {
      return writeError(c, 400, 'INVALID_INPUT', `unique constraint failed: ${errMsg}`);
    }
    return writeError(c, 400, 'INVALID_INPUT', errMsg);
  }
  if (!updated) {
    return writeError(c, 404, 'NOT_FOUND', 'record not found');
  }
  return c.json({ data: sanitizeRecord(updated, []) });
});

// DELETE /api/sake_images/:id
app.delete('/api/sake_images/:id', async (c) => {
  const authUser = await getAuthUser(c);
  if (!authUser) {
    return writeError(c, 401, 'UNAUTHORIZED', 'authentication required');
  }
  const id = c.req.param('id');
  const parsedId = isNaN(Number(id)) ? id : Number(id);
  const existing = await c.env.DB.prepare('SELECT * FROM "sake_images" WHERE id = ?').bind(id).first();
  if (!existing) {
    return writeError(c, 404, 'NOT_FOUND', 'record not found');
  }
  const ownerVal = (existing as any)['owner_id'];
  if (ownerVal === null || ownerVal === undefined) {
    if (authUser.role !== 'admin') {
      return writeError(c, 403, 'FORBIDDEN', 'forbidden');
    }
  } else if (authUser.role !== 'admin' && ownerVal != authUser.id) {
    return writeError(c, 403, 'FORBIDDEN', 'forbidden');
  }
  const res = await c.env.DB.prepare('DELETE FROM "sake_images" WHERE id = ?').bind(id).run();
  if (!res.meta.changes) {
    return writeError(c, 404, 'NOT_FOUND', 'record not found');
  }
  return c.json({ data: { deleted: true, id: parsedId } });
});

// VIEW LIST /view/sake_images
app.get('/view/sake_images', async (c) => {
  const authUser = await getAuthUser(c);
  const whereConds: string[] = [];
  const params: any[] = [];
  if (!authUser || authUser.role !== 'admin') {
    if (authUser) {
      whereConds.push('("owner_id" = ? OR "owner_id" IS NULL)');
      params.push(authUser.id);
    } else {
      whereConds.push('"owner_id" IS NULL');
    }
  }
  const whereClause = whereConds.length > 0 ? ' WHERE ' + whereConds.join(' AND ') : '';
  const { results } = await c.env.DB.prepare(`SELECT * FROM "sake_images"${whereClause} ORDER BY id ASC`).bind(...params).all();
  const viewRecs = (results || []) as any[];
  const incErr = await processIncludes(c, 'sake_images', viewRecs, c.req.query('include'), authUser);
  if (incErr) return incErr;
  let html = `<!DOCTYPE html><html><head><title>SakeImage List</title></head><body>`;
  html += `<h1>SakeImage List</h1>`;
  html += `<a href="/view/sake_images/new">+ New SakeImage</a><br/><br/><table border="1"><thead><tr><th>id</th>`;
  html += `<th>legacy_id</th>`;
  html += `<th>owner_id</th>`;
  html += `<th>record_id</th>`;
  html += `<th>image_key</th>`;
  html += `<th>thumbnail_key</th>`;
  html += `<th>mime_type</th>`;
  html += `<th>file_name</th>`;
  html += `<th>display_order</th>`;
  html += `<th>Actions</th></tr></thead><tbody>`;
  for (const row of viewRecs) {
    html += `<tr><td>${(row as any).id}</td>`;
    html += `<td>${escapeHTML((row as any)['legacy_id'])}</td>`;
    html += `<td>${escapeHTML((row as any)['owner_id'])}</td>`;
    html += `<td>${escapeHTML((row as any)['record_id'])}</td>`;
    html += `<td>${escapeHTML((row as any)['image_key'])}</td>`;
    html += `<td>${escapeHTML((row as any)['thumbnail_key'])}</td>`;
    html += `<td>${escapeHTML((row as any)['mime_type'])}</td>`;
    html += `<td>${escapeHTML((row as any)['file_name'])}</td>`;
    html += `<td>${escapeHTML((row as any)['display_order'])}</td>`;
    html += `<td><a href="/view/sake_images/${(row as any).id}">Detail</a> <a href="/view/sake_images/${(row as any).id}/edit">Edit</a></td></tr>`;
  }
  html += `</tbody></table></body></html>`;
  return c.html(html);
});

// VIEW NEW /view/sake_images/new
app.get('/view/sake_images/new', async (c) => {
  let html = `<!DOCTYPE html><html><head><title>New SakeImage</title></head><body><h1>New SakeImage</h1><form method="POST" action="/view/sake_images">`;
  html += `<label>legacy_id: <input type="text" name="legacy_id" /></label><br/><br/>`;
  html += `<label>owner_id: <input type="text" name="owner_id" /></label><br/><br/>`;
  html += `<label>record_id: <input type="number" name="record_id" /></label><br/><br/>`;
  html += `<label>image_key: <input type="text" name="image_key" /></label><br/><br/>`;
  html += `<label>thumbnail_key: <input type="text" name="thumbnail_key" /></label><br/><br/>`;
  html += `<label>mime_type: <input type="text" name="mime_type" /></label><br/><br/>`;
  html += `<label>file_name: <input type="text" name="file_name" /></label><br/><br/>`;
  html += `<label>display_order: <input type="number" name="display_order" /></label><br/><br/>`;
  html += `<button type="submit">Save</button></form></body></html>`;
  return c.html(html);
});

// VIEW CREATE SUBMIT /view/sake_images
app.post('/view/sake_images', async (c) => {
  const formData = await c.req.formData();
  const body: any = {};
  formData.forEach((value, key) => { body[key] = value; });
  const now = new Date().toISOString();
  const insertSql = `INSERT INTO "sake_images" ("legacy_id", "owner_id", "record_id", "image_key", "thumbnail_key", "mime_type", "file_name", "display_order", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  await c.env.DB.prepare(insertSql).bind(body['legacy_id'] !== undefined ? body['legacy_id'] : null, body['owner_id'] !== undefined ? body['owner_id'] : null, body['record_id'] !== undefined ? body['record_id'] : null, null, null, body['mime_type'] !== undefined ? body['mime_type'] : null, body['file_name'] !== undefined ? body['file_name'] : null, body['display_order'] !== undefined ? body['display_order'] : 0, now, now).run();
  return c.redirect('/view/sake_images', 303);
});

// VIEW DETAIL /view/sake_images/:id
app.get('/view/sake_images/:id', async (c) => {
  const id = c.req.param('id');
  const record = await c.env.DB.prepare('SELECT * FROM "sake_images" WHERE id = ?').bind(id).first<any>();
  if (!record) return c.html('<h1>404 Not Found</h1>', 404);
  const authUser = await getAuthUser(c);
  const incErr = await processIncludes(c, 'sake_images', [record], c.req.query('include'), authUser);
  if (incErr) return incErr;
  let html = `<!DOCTYPE html><html><head><title>SakeImage Detail</title></head><body><h1>SakeImage #${id}</h1><dl>`;
  html += `<dt>legacy_id</dt><dd>${escapeHTML(record['legacy_id'])}</dd>`;
  html += `<dt>owner_id</dt><dd>${escapeHTML(record['owner_id'])}</dd>`;
  html += `<dt>record_id</dt><dd>${escapeHTML(record['record_id'])}</dd>`;
  html += `<dt>image_key</dt><dd>${escapeHTML(record['image_key'])}</dd>`;
  html += `<dt>thumbnail_key</dt><dd>${escapeHTML(record['thumbnail_key'])}</dd>`;
  html += `<dt>mime_type</dt><dd>${escapeHTML(record['mime_type'])}</dd>`;
  html += `<dt>file_name</dt><dd>${escapeHTML(record['file_name'])}</dd>`;
  html += `<dt>display_order</dt><dd>${escapeHTML(record['display_order'])}</dd>`;
  html += `</dl></body></html>`;
  return c.html(html);
});

// OVERWRITE UPLOAD /api/sake_images/:id/upload/image_key
app.post('/api/sake_images/:id/upload/image_key', async (c) => {
  const authUser = await getAuthUser(c);
  if (!authUser) {
    return writeError(c, 401, 'UNAUTHORIZED', 'authentication required');
  }
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM "sake_images" WHERE id = ?').bind(id).first<any>();
  if (!existing) {
    return writeError(c, 404, 'NOT_FOUND', 'record not found');
  }
  const ownerVal = existing['owner_id'];
  if (ownerVal === null || ownerVal === undefined) {
    if (authUser.role !== 'admin') {
      return writeError(c, 403, 'FORBIDDEN', 'forbidden');
    }
  } else if (authUser.role !== 'admin' && ownerVal != authUser.id) {
    return writeError(c, 403, 'FORBIDDEN', 'forbidden');
  }
  const formData = await c.req.formData().catch(() => null);
  const file = formData ? formData.get('image_key') as File : null;
  if (!file) {
    return writeError(c, 400, 'VALIDATION_FAILED', 'missing file payload');
  }
  const ext = file.name ? file.name.substring(file.name.lastIndexOf('.')) : '';
  const key = `blobs/sake_images/${id}/image_key_${Date.now()}${ext}`;
  await c.env.BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
  await c.env.DB.prepare('UPDATE "sake_images" SET "image_key" = ? WHERE id = ?').bind(key, id).run();
  return c.json({ data: { image_key: key } });
});

// DOWNLOAD BLOB /api/sake_images/:id/blob/image_key
app.get('/api/sake_images/:id/blob/image_key', async (c) => {
  const authUser = await getAuthUser(c);
  const id = c.req.param('id');
  const record = await c.env.DB.prepare('SELECT * FROM "sake_images" WHERE id = ?').bind(id).first<any>();
  if (!record) {
    return writeError(c, 404, 'NOT_FOUND', 'record not found');
  }
  const ownerVal = record['owner_id'];
  if (ownerVal !== null && ownerVal !== undefined) {
    if (!authUser) {
      return writeError(c, 401, 'UNAUTHORIZED', 'authentication required');
    }
    if (authUser.role !== 'admin' && ownerVal != authUser.id) {
      return writeError(c, 403, 'FORBIDDEN', 'forbidden');
    }
  }
  const key = record['image_key'];
  if (!key) {
    return writeError(c, 404, 'NOT_FOUND', 'blob key not found');
  }
  const object = await c.env.BUCKET.get(key);
  if (!object) {
    return writeError(c, 404, 'NOT_FOUND', 'blob object not found in R2');
  }
  c.header('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
  return c.body(object.body);
});

// DELETE BLOB /api/sake_images/:id/blob/image_key
app.delete('/api/sake_images/:id/blob/image_key', async (c) => {
  const authUser = await getAuthUser(c);
  if (!authUser) {
    return writeError(c, 401, 'UNAUTHORIZED', 'authentication required');
  }
  const id = c.req.param('id');
  const record = await c.env.DB.prepare('SELECT * FROM "sake_images" WHERE id = ?').bind(id).first<any>();
  if (!record) {
    return writeError(c, 404, 'NOT_FOUND', 'record not found');
  }
  const ownerVal = record['owner_id'];
  if (ownerVal === null || ownerVal === undefined) {
    if (authUser.role !== 'admin') {
      return writeError(c, 403, 'FORBIDDEN', 'forbidden');
    }
  } else if (authUser.role !== 'admin' && ownerVal != authUser.id) {
    return writeError(c, 403, 'FORBIDDEN', 'forbidden');
  }
  const key = record['image_key'];
  if (key) {
    await c.env.BUCKET.delete(key);
    await c.env.DB.prepare('UPDATE "sake_images" SET "image_key" = NULL WHERE id = ?').bind(id).run();
  }
  return c.json({ data: { deleted: true } });
});

// OVERWRITE UPLOAD /api/sake_images/:id/upload/thumbnail_key
app.post('/api/sake_images/:id/upload/thumbnail_key', async (c) => {
  const authUser = await getAuthUser(c);
  if (!authUser) {
    return writeError(c, 401, 'UNAUTHORIZED', 'authentication required');
  }
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM "sake_images" WHERE id = ?').bind(id).first<any>();
  if (!existing) {
    return writeError(c, 404, 'NOT_FOUND', 'record not found');
  }
  const ownerVal = existing['owner_id'];
  if (ownerVal === null || ownerVal === undefined) {
    if (authUser.role !== 'admin') {
      return writeError(c, 403, 'FORBIDDEN', 'forbidden');
    }
  } else if (authUser.role !== 'admin' && ownerVal != authUser.id) {
    return writeError(c, 403, 'FORBIDDEN', 'forbidden');
  }
  const formData = await c.req.formData().catch(() => null);
  const file = formData ? formData.get('thumbnail_key') as File : null;
  if (!file) {
    return writeError(c, 400, 'VALIDATION_FAILED', 'missing file payload');
  }
  const ext = file.name ? file.name.substring(file.name.lastIndexOf('.')) : '';
  const key = `blobs/sake_images/${id}/thumbnail_key_${Date.now()}${ext}`;
  await c.env.BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
  await c.env.DB.prepare('UPDATE "sake_images" SET "thumbnail_key" = ? WHERE id = ?').bind(key, id).run();
  return c.json({ data: { thumbnail_key: key } });
});

// DOWNLOAD BLOB /api/sake_images/:id/blob/thumbnail_key
app.get('/api/sake_images/:id/blob/thumbnail_key', async (c) => {
  const authUser = await getAuthUser(c);
  const id = c.req.param('id');
  const record = await c.env.DB.prepare('SELECT * FROM "sake_images" WHERE id = ?').bind(id).first<any>();
  if (!record) {
    return writeError(c, 404, 'NOT_FOUND', 'record not found');
  }
  const ownerVal = record['owner_id'];
  if (ownerVal !== null && ownerVal !== undefined) {
    if (!authUser) {
      return writeError(c, 401, 'UNAUTHORIZED', 'authentication required');
    }
    if (authUser.role !== 'admin' && ownerVal != authUser.id) {
      return writeError(c, 403, 'FORBIDDEN', 'forbidden');
    }
  }
  const key = record['thumbnail_key'];
  if (!key) {
    return writeError(c, 404, 'NOT_FOUND', 'blob key not found');
  }
  const object = await c.env.BUCKET.get(key);
  if (!object) {
    return writeError(c, 404, 'NOT_FOUND', 'blob object not found in R2');
  }
  c.header('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
  return c.body(object.body);
});

// DELETE BLOB /api/sake_images/:id/blob/thumbnail_key
app.delete('/api/sake_images/:id/blob/thumbnail_key', async (c) => {
  const authUser = await getAuthUser(c);
  if (!authUser) {
    return writeError(c, 401, 'UNAUTHORIZED', 'authentication required');
  }
  const id = c.req.param('id');
  const record = await c.env.DB.prepare('SELECT * FROM "sake_images" WHERE id = ?').bind(id).first<any>();
  if (!record) {
    return writeError(c, 404, 'NOT_FOUND', 'record not found');
  }
  const ownerVal = record['owner_id'];
  if (ownerVal === null || ownerVal === undefined) {
    if (authUser.role !== 'admin') {
      return writeError(c, 403, 'FORBIDDEN', 'forbidden');
    }
  } else if (authUser.role !== 'admin' && ownerVal != authUser.id) {
    return writeError(c, 403, 'FORBIDDEN', 'forbidden');
  }
  const key = record['thumbnail_key'];
  if (key) {
    await c.env.BUCKET.delete(key);
    await c.env.DB.prepare('UPDATE "sake_images" SET "thumbnail_key" = NULL WHERE id = ?').bind(id).run();
  }
  return c.json({ data: { deleted: true } });
});

// LIST /api/sake_records
app.get('/api/sake_records', async (c) => {
  const authUser = await getAuthUser(c);
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 100);
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10), 0);

  const whereConds: string[] = [];
  const params: any[] = [];
  if (!authUser || authUser.role !== 'admin') {
    if (authUser) {
      whereConds.push('("owner_id" = ? OR "owner_id" IS NULL)');
      params.push(authUser.id);
    } else {
      whereConds.push('"owner_id" IS NULL');
    }
  }
  const whereClause = whereConds.length > 0 ? ' WHERE ' + whereConds.join(' AND ') : '';
  const countSql = `SELECT COUNT(*) as total FROM "sake_records"${whereClause}`;
  const countStmt = await c.env.DB.prepare(countSql).bind(...params).first<{ total: number }>();
  const total = countStmt ? countStmt.total : 0;
  const querySql = `SELECT * FROM "sake_records"${whereClause} ORDER BY id ASC LIMIT ? OFFSET ?`;
  const { results } = await c.env.DB.prepare(querySql).bind(...params, limit, offset).all();
  const sanitized = (results || []).map((r: any) => sanitizeRecord(r, []));
  const incErr = await processIncludes(c, 'sake_records', sanitized, c.req.query('include'), authUser);
  if (incErr) return incErr;
  return c.json({
    data: sanitized,
    meta: { total, limit, offset }
  });
});

// DETAIL /api/sake_records/:id
app.get('/api/sake_records/:id', async (c) => {
  const authUser = await getAuthUser(c);
  const id = c.req.param('id');
  const record = await c.env.DB.prepare('SELECT * FROM "sake_records" WHERE id = ?').bind(id).first();
  if (!record) {
    return writeError(c, 404, 'NOT_FOUND', 'record not found');
  }
  const ownerVal = (record as any)['owner_id'];
  if (ownerVal !== null && ownerVal !== undefined) {
    if (!authUser) {
      return writeError(c, 401, 'UNAUTHORIZED', 'authentication required');
    }
    if (authUser.role !== 'admin' && ownerVal != authUser.id) {
      return writeError(c, 403, 'FORBIDDEN', 'forbidden');
    }
  }
  const sanitized = sanitizeRecord(record, []);
  const incErr = await processIncludes(c, 'sake_records', [sanitized], c.req.query('include'), authUser);
  if (incErr) return incErr;
  return c.json({ data: sanitized });
});

// CREATE /api/sake_records
app.post('/api/sake_records', async (c) => {
  const authUser = await getAuthUser(c);
  if (!authUser) {
    return writeError(c, 401, 'UNAUTHORIZED', 'authentication required');
  }
  let body: any = {};
  let formData: FormData | null = null;
  const rawHeader = c.req.header('content-type') || c.req.header('Content-Type') || (c.req.raw && c.req.raw.headers ? c.req.raw.headers.get('content-type') : '') || '';
  const contentType = String(rawHeader).toLowerCase();
  if (contentType.includes('multipart/form-data')) {
    try {
      formData = await c.req.formData();
      formData.forEach((val, key) => {
        if (typeof val === 'string') { body[key] = (val !== '' && !isNaN(Number(val))) ? Number(val) : val; }
      });
    } catch (e) {
      return writeError(c, 400, 'INVALID_MULTIPART', 'failed to parse multipart body');
    }
  } else {
    try {
      body = await c.req.json();
    } catch (e) {
      return writeError(c, 400, 'INVALID_JSON', 'failed to parse json body');
    }
  }

  if (body['role'] === 'admin' && (!authUser || authUser.role !== 'admin')) {
    return writeError(c, 403, 'FORBIDDEN', 'cannot grant admin role');
  }
  if (authUser) {
    body['owner_id'] = authUser.id;
  } else {
    delete body['owner_id'];
  }
  if (body['legacy_id'] !== undefined && body['legacy_id'] !== null && typeof body['legacy_id'] !== 'string') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field legacy_id must be a string');
  }
  if (body['owner_id'] === undefined || body['owner_id'] === null) {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field owner_id is required');
  }
  if (body['owner_id'] !== undefined && body['owner_id'] !== null && typeof body['owner_id'] !== 'string') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field owner_id must be a string');
  }
  if (body['drink_type'] !== undefined && body['drink_type'] !== null && typeof body['drink_type'] !== 'string') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field drink_type must be a string');
  }
  if (body['name'] === undefined || body['name'] === null) {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field name is required');
  }
  if (body['name'] !== undefined && body['name'] !== null && typeof body['name'] !== 'string') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field name must be a string');
  }
  if (body['region'] !== undefined && body['region'] !== null && typeof body['region'] !== 'string') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field region must be a string');
  }
  if (body['brewery'] !== undefined && body['brewery'] !== null && typeof body['brewery'] !== 'string') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field brewery must be a string');
  }
  if (body['rice'] !== undefined && body['rice'] !== null && typeof body['rice'] !== 'string') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field rice must be a string');
  }
  if (body['sake_type'] !== undefined && body['sake_type'] !== null && typeof body['sake_type'] !== 'string') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field sake_type must be a string');
  }
  if (body['sake_meter_value'] !== undefined && body['sake_meter_value'] !== null && typeof body['sake_meter_value'] !== 'string') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field sake_meter_value must be a string');
  }
  if (body['abv'] !== undefined && body['abv'] !== null && typeof body['abv'] !== 'string') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field abv must be a string');
  }
  if (body['volume'] !== undefined && body['volume'] !== null && typeof body['volume'] !== 'string') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field volume must be a string');
  }
  if (body['price'] !== undefined && body['price'] !== null && typeof body['price'] !== 'string') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field price must be a string');
  }
  if (body['one_line_note'] !== undefined && body['one_line_note'] !== null && typeof body['one_line_note'] !== 'string') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field one_line_note must be a string');
  }
  if (body['place'] !== undefined && body['place'] !== null && typeof body['place'] !== 'string') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field place must be a string');
  }
  if (body['consumed_date'] === undefined || body['consumed_date'] === null) {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field consumed_date is required');
  }
  if (body['companions'] !== undefined && body['companions'] !== null && typeof body['companions'] !== 'string') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field companions must be a string');
  }
  if (body['food_pairing'] !== undefined && body['food_pairing'] !== null && typeof body['food_pairing'] !== 'string') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field food_pairing must be a string');
  }
  if (body['sweet_dry'] !== undefined && body['sweet_dry'] !== null && typeof body['sweet_dry'] !== 'number') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field sweet_dry must be a number');
  }
  if (body['aroma_intensity'] !== undefined && body['aroma_intensity'] !== null && typeof body['aroma_intensity'] !== 'number') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field aroma_intensity must be a number');
  }
  if (body['acidity'] !== undefined && body['acidity'] !== null && typeof body['acidity'] !== 'number') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field acidity must be a number');
  }
  if (body['clean_umami'] !== undefined && body['clean_umami'] !== null && typeof body['clean_umami'] !== 'number') {
    return writeError(c, 400, 'VALIDATION_FAILED', 'field clean_umami must be a number');
  }

  const now = new Date().toISOString();
  const insertSql = `INSERT INTO "sake_records" ("legacy_id", "owner_id", "drink_type", "name", "region", "brewery", "rice", "sake_type", "sake_meter_value", "abv", "volume", "price", "one_line_note", "place", "consumed_date", "companions", "food_pairing", "drink_again", "sweet_dry", "aroma_intensity", "acidity", "clean_umami", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`;
  let created: any = null;
  try {
    created = await c.env.DB.prepare(insertSql).bind(body['legacy_id'] !== undefined ? body['legacy_id'] : null, body['owner_id'] !== undefined ? body['owner_id'] : null, body['drink_type'] !== undefined ? body['drink_type'] : 'sake', body['name'] !== undefined ? body['name'] : null, body['region'] !== undefined ? body['region'] : null, body['brewery'] !== undefined ? body['brewery'] : null, body['rice'] !== undefined ? body['rice'] : null, body['sake_type'] !== undefined ? body['sake_type'] : null, body['sake_meter_value'] !== undefined ? body['sake_meter_value'] : null, body['abv'] !== undefined ? body['abv'] : null, body['volume'] !== undefined ? body['volume'] : null, body['price'] !== undefined ? body['price'] : null, body['one_line_note'] !== undefined ? body['one_line_note'] : null, body['place'] !== undefined ? body['place'] : null, body['consumed_date'] !== undefined ? body['consumed_date'] : null, body['companions'] !== undefined ? body['companions'] : null, body['food_pairing'] !== undefined ? body['food_pairing'] : null, body['drink_again'] !== undefined ? body['drink_again'] : null, body['sweet_dry'] !== undefined ? body['sweet_dry'] : null, body['aroma_intensity'] !== undefined ? body['aroma_intensity'] : null, body['acidity'] !== undefined ? body['acidity'] : null, body['clean_umami'] !== undefined ? body['clean_umami'] : null, now, now).first<any>();
  } catch (err: any) {
    const errMsg = String(err?.message || err);
    if (errMsg.includes('UNIQUE constraint failed') || errMsg.includes('SQLITE_CONSTRAINT')) {
      return writeError(c, 400, 'INVALID_INPUT', `unique constraint failed: ${errMsg}`);
    }
    return writeError(c, 400, 'INVALID_INPUT', errMsg);
  }
  return c.json({ data: sanitizeRecord(created, []) }, 201);
});

// UPDATE /api/sake_records/:id
app.put('/api/sake_records/:id', async (c) => {
  const authUser = await getAuthUser(c);
  if (!authUser) {
    return writeError(c, 401, 'UNAUTHORIZED', 'authentication required');
  }
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM "sake_records" WHERE id = ?').bind(id).first();
  if (!existing) {
    return writeError(c, 404, 'NOT_FOUND', 'record not found');
  }
  const ownerVal = (existing as any)['owner_id'];
  if (ownerVal === null || ownerVal === undefined) {
    if (authUser.role !== 'admin') {
      return writeError(c, 403, 'FORBIDDEN', 'forbidden');
    }
  } else if (authUser.role !== 'admin' && ownerVal != authUser.id) {
    return writeError(c, 403, 'FORBIDDEN', 'forbidden');
  }
  let body: any;
  try {
    body = await c.req.json();
  } catch (e) {
    return writeError(c, 400, 'INVALID_JSON', 'failed to parse json body');
  }

  if (body['role'] !== undefined && body['role'] !== (existing as any)['role'] && body['role'] === 'admin' && (!authUser || authUser.role !== 'admin')) {
    return writeError(c, 403, 'FORBIDDEN', 'cannot grant admin role');
  }
  const now = new Date().toISOString();
  const updateSql = `UPDATE "sake_records" SET "legacy_id" = ?, "owner_id" = ?, "drink_type" = ?, "name" = ?, "region" = ?, "brewery" = ?, "rice" = ?, "sake_type" = ?, "sake_meter_value" = ?, "abv" = ?, "volume" = ?, "price" = ?, "one_line_note" = ?, "place" = ?, "consumed_date" = ?, "companions" = ?, "food_pairing" = ?, "drink_again" = ?, "sweet_dry" = ?, "aroma_intensity" = ?, "acidity" = ?, "clean_umami" = ?, "updated_at" = ? WHERE id = ? RETURNING *`;
  let updated: any = null;
  try {
    updated = await c.env.DB.prepare(updateSql).bind(body['legacy_id'] !== undefined ? body['legacy_id'] : (existing as any)['legacy_id'], body['owner_id'] !== undefined ? body['owner_id'] : (existing as any)['owner_id'], body['drink_type'] !== undefined ? body['drink_type'] : (existing as any)['drink_type'], body['name'] !== undefined ? body['name'] : (existing as any)['name'], body['region'] !== undefined ? body['region'] : (existing as any)['region'], body['brewery'] !== undefined ? body['brewery'] : (existing as any)['brewery'], body['rice'] !== undefined ? body['rice'] : (existing as any)['rice'], body['sake_type'] !== undefined ? body['sake_type'] : (existing as any)['sake_type'], body['sake_meter_value'] !== undefined ? body['sake_meter_value'] : (existing as any)['sake_meter_value'], body['abv'] !== undefined ? body['abv'] : (existing as any)['abv'], body['volume'] !== undefined ? body['volume'] : (existing as any)['volume'], body['price'] !== undefined ? body['price'] : (existing as any)['price'], body['one_line_note'] !== undefined ? body['one_line_note'] : (existing as any)['one_line_note'], body['place'] !== undefined ? body['place'] : (existing as any)['place'], body['consumed_date'] !== undefined ? body['consumed_date'] : (existing as any)['consumed_date'], body['companions'] !== undefined ? body['companions'] : (existing as any)['companions'], body['food_pairing'] !== undefined ? body['food_pairing'] : (existing as any)['food_pairing'], body['drink_again'] !== undefined ? body['drink_again'] : (existing as any)['drink_again'], body['sweet_dry'] !== undefined ? body['sweet_dry'] : (existing as any)['sweet_dry'], body['aroma_intensity'] !== undefined ? body['aroma_intensity'] : (existing as any)['aroma_intensity'], body['acidity'] !== undefined ? body['acidity'] : (existing as any)['acidity'], body['clean_umami'] !== undefined ? body['clean_umami'] : (existing as any)['clean_umami'], now, id).first();
  } catch (err: any) {
    const errMsg = String(err?.message || err);
    if (errMsg.includes('UNIQUE constraint failed') || errMsg.includes('SQLITE_CONSTRAINT')) {
      return writeError(c, 400, 'INVALID_INPUT', `unique constraint failed: ${errMsg}`);
    }
    return writeError(c, 400, 'INVALID_INPUT', errMsg);
  }
  if (!updated) {
    return writeError(c, 404, 'NOT_FOUND', 'record not found');
  }
  return c.json({ data: sanitizeRecord(updated, []) });
});

// DELETE /api/sake_records/:id
app.delete('/api/sake_records/:id', async (c) => {
  const authUser = await getAuthUser(c);
  if (!authUser) {
    return writeError(c, 401, 'UNAUTHORIZED', 'authentication required');
  }
  const id = c.req.param('id');
  const parsedId = isNaN(Number(id)) ? id : Number(id);
  const existing = await c.env.DB.prepare('SELECT * FROM "sake_records" WHERE id = ?').bind(id).first();
  if (!existing) {
    return writeError(c, 404, 'NOT_FOUND', 'record not found');
  }
  const ownerVal = (existing as any)['owner_id'];
  if (ownerVal === null || ownerVal === undefined) {
    if (authUser.role !== 'admin') {
      return writeError(c, 403, 'FORBIDDEN', 'forbidden');
    }
  } else if (authUser.role !== 'admin' && ownerVal != authUser.id) {
    return writeError(c, 403, 'FORBIDDEN', 'forbidden');
  }
  const res = await c.env.DB.prepare('DELETE FROM "sake_records" WHERE id = ?').bind(id).run();
  if (!res.meta.changes) {
    return writeError(c, 404, 'NOT_FOUND', 'record not found');
  }
  return c.json({ data: { deleted: true, id: parsedId } });
});

// VIEW LIST /view/sake_records
app.get('/view/sake_records', async (c) => {
  const authUser = await getAuthUser(c);
  const whereConds: string[] = [];
  const params: any[] = [];
  if (!authUser || authUser.role !== 'admin') {
    if (authUser) {
      whereConds.push('("owner_id" = ? OR "owner_id" IS NULL)');
      params.push(authUser.id);
    } else {
      whereConds.push('"owner_id" IS NULL');
    }
  }
  const whereClause = whereConds.length > 0 ? ' WHERE ' + whereConds.join(' AND ') : '';
  const { results } = await c.env.DB.prepare(`SELECT * FROM "sake_records"${whereClause} ORDER BY id ASC`).bind(...params).all();
  const viewRecs = (results || []) as any[];
  const incErr = await processIncludes(c, 'sake_records', viewRecs, c.req.query('include'), authUser);
  if (incErr) return incErr;
  let html = `<!DOCTYPE html><html><head><title>SakeRecord List</title></head><body>`;
  html += `<h1>SakeRecord List</h1>`;
  html += `<a href="/view/sake_records/new">+ New SakeRecord</a><br/><br/><table border="1"><thead><tr><th>id</th>`;
  html += `<th>legacy_id</th>`;
  html += `<th>owner_id</th>`;
  html += `<th>drink_type</th>`;
  html += `<th>name</th>`;
  html += `<th>region</th>`;
  html += `<th>brewery</th>`;
  html += `<th>rice</th>`;
  html += `<th>sake_type</th>`;
  html += `<th>sake_meter_value</th>`;
  html += `<th>abv</th>`;
  html += `<th>volume</th>`;
  html += `<th>price</th>`;
  html += `<th>one_line_note</th>`;
  html += `<th>place</th>`;
  html += `<th>consumed_date</th>`;
  html += `<th>companions</th>`;
  html += `<th>food_pairing</th>`;
  html += `<th>drink_again</th>`;
  html += `<th>sweet_dry</th>`;
  html += `<th>aroma_intensity</th>`;
  html += `<th>acidity</th>`;
  html += `<th>clean_umami</th>`;
  html += `<th>Actions</th></tr></thead><tbody>`;
  for (const row of viewRecs) {
    html += `<tr><td>${(row as any).id}</td>`;
    html += `<td>${escapeHTML((row as any)['legacy_id'])}</td>`;
    html += `<td>${escapeHTML((row as any)['owner_id'])}</td>`;
    html += `<td>${escapeHTML((row as any)['drink_type'])}</td>`;
    html += `<td>${escapeHTML((row as any)['name'])}</td>`;
    html += `<td>${escapeHTML((row as any)['region'])}</td>`;
    html += `<td>${escapeHTML((row as any)['brewery'])}</td>`;
    html += `<td>${escapeHTML((row as any)['rice'])}</td>`;
    html += `<td>${escapeHTML((row as any)['sake_type'])}</td>`;
    html += `<td>${escapeHTML((row as any)['sake_meter_value'])}</td>`;
    html += `<td>${escapeHTML((row as any)['abv'])}</td>`;
    html += `<td>${escapeHTML((row as any)['volume'])}</td>`;
    html += `<td>${escapeHTML((row as any)['price'])}</td>`;
    html += `<td>${escapeHTML((row as any)['one_line_note'])}</td>`;
    html += `<td>${escapeHTML((row as any)['place'])}</td>`;
    html += `<td>${escapeHTML((row as any)['consumed_date'])}</td>`;
    html += `<td>${escapeHTML((row as any)['companions'])}</td>`;
    html += `<td>${escapeHTML((row as any)['food_pairing'])}</td>`;
    html += `<td>${escapeHTML((row as any)['drink_again'])}</td>`;
    html += `<td>${escapeHTML((row as any)['sweet_dry'])}</td>`;
    html += `<td>${escapeHTML((row as any)['aroma_intensity'])}</td>`;
    html += `<td>${escapeHTML((row as any)['acidity'])}</td>`;
    html += `<td>${escapeHTML((row as any)['clean_umami'])}</td>`;
    html += `<td><a href="/view/sake_records/${(row as any).id}">Detail</a> <a href="/view/sake_records/${(row as any).id}/edit">Edit</a></td></tr>`;
  }
  html += `</tbody></table></body></html>`;
  return c.html(html);
});

// VIEW NEW /view/sake_records/new
app.get('/view/sake_records/new', async (c) => {
  let html = `<!DOCTYPE html><html><head><title>New SakeRecord</title></head><body><h1>New SakeRecord</h1><form method="POST" action="/view/sake_records">`;
  html += `<label>legacy_id: <input type="text" name="legacy_id" /></label><br/><br/>`;
  html += `<label>owner_id: <input type="text" name="owner_id" /></label><br/><br/>`;
  html += `<label>drink_type: <input type="text" name="drink_type" /></label><br/><br/>`;
  html += `<label>name: <input type="text" name="name" /></label><br/><br/>`;
  html += `<label>region: <input type="text" name="region" /></label><br/><br/>`;
  html += `<label>brewery: <input type="text" name="brewery" /></label><br/><br/>`;
  html += `<label>rice: <input type="text" name="rice" /></label><br/><br/>`;
  html += `<label>sake_type: <input type="text" name="sake_type" /></label><br/><br/>`;
  html += `<label>sake_meter_value: <input type="text" name="sake_meter_value" /></label><br/><br/>`;
  html += `<label>abv: <input type="text" name="abv" /></label><br/><br/>`;
  html += `<label>volume: <input type="text" name="volume" /></label><br/><br/>`;
  html += `<label>price: <input type="text" name="price" /></label><br/><br/>`;
  html += `<label>one_line_note: <textarea name="one_line_note"></textarea></label><br/><br/>`;
  html += `<label>place: <input type="text" name="place" /></label><br/><br/>`;
  html += `<label>consumed_date: <input type="text" name="consumed_date" /></label><br/><br/>`;
  html += `<label>companions: <input type="text" name="companions" /></label><br/><br/>`;
  html += `<label>food_pairing: <input type="text" name="food_pairing" /></label><br/><br/>`;
  html += `<label>drink_again: <input type="text" name="drink_again" /></label><br/><br/>`;
  html += `<label>sweet_dry: <input type="number" name="sweet_dry" /></label><br/><br/>`;
  html += `<label>aroma_intensity: <input type="number" name="aroma_intensity" /></label><br/><br/>`;
  html += `<label>acidity: <input type="number" name="acidity" /></label><br/><br/>`;
  html += `<label>clean_umami: <input type="number" name="clean_umami" /></label><br/><br/>`;
  html += `<button type="submit">Save</button></form></body></html>`;
  return c.html(html);
});

// VIEW CREATE SUBMIT /view/sake_records
app.post('/view/sake_records', async (c) => {
  const formData = await c.req.formData();
  const body: any = {};
  formData.forEach((value, key) => { body[key] = value; });
  const now = new Date().toISOString();
  const insertSql = `INSERT INTO "sake_records" ("legacy_id", "owner_id", "drink_type", "name", "region", "brewery", "rice", "sake_type", "sake_meter_value", "abv", "volume", "price", "one_line_note", "place", "consumed_date", "companions", "food_pairing", "drink_again", "sweet_dry", "aroma_intensity", "acidity", "clean_umami", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  await c.env.DB.prepare(insertSql).bind(body['legacy_id'] !== undefined ? body['legacy_id'] : null, body['owner_id'] !== undefined ? body['owner_id'] : null, body['drink_type'] !== undefined ? body['drink_type'] : 'sake', body['name'] !== undefined ? body['name'] : null, body['region'] !== undefined ? body['region'] : null, body['brewery'] !== undefined ? body['brewery'] : null, body['rice'] !== undefined ? body['rice'] : null, body['sake_type'] !== undefined ? body['sake_type'] : null, body['sake_meter_value'] !== undefined ? body['sake_meter_value'] : null, body['abv'] !== undefined ? body['abv'] : null, body['volume'] !== undefined ? body['volume'] : null, body['price'] !== undefined ? body['price'] : null, body['one_line_note'] !== undefined ? body['one_line_note'] : null, body['place'] !== undefined ? body['place'] : null, body['consumed_date'] !== undefined ? body['consumed_date'] : null, body['companions'] !== undefined ? body['companions'] : null, body['food_pairing'] !== undefined ? body['food_pairing'] : null, body['drink_again'] !== undefined ? body['drink_again'] : null, body['sweet_dry'] !== undefined ? body['sweet_dry'] : null, body['aroma_intensity'] !== undefined ? body['aroma_intensity'] : null, body['acidity'] !== undefined ? body['acidity'] : null, body['clean_umami'] !== undefined ? body['clean_umami'] : null, now, now).run();
  return c.redirect('/view/sake_records', 303);
});

// VIEW DETAIL /view/sake_records/:id
app.get('/view/sake_records/:id', async (c) => {
  const id = c.req.param('id');
  const record = await c.env.DB.prepare('SELECT * FROM "sake_records" WHERE id = ?').bind(id).first<any>();
  if (!record) return c.html('<h1>404 Not Found</h1>', 404);
  const authUser = await getAuthUser(c);
  const incErr = await processIncludes(c, 'sake_records', [record], c.req.query('include'), authUser);
  if (incErr) return incErr;
  let html = `<!DOCTYPE html><html><head><title>SakeRecord Detail</title></head><body><h1>SakeRecord #${id}</h1><dl>`;
  html += `<dt>legacy_id</dt><dd>${escapeHTML(record['legacy_id'])}</dd>`;
  html += `<dt>owner_id</dt><dd>${escapeHTML(record['owner_id'])}</dd>`;
  html += `<dt>drink_type</dt><dd>${escapeHTML(record['drink_type'])}</dd>`;
  html += `<dt>name</dt><dd>${escapeHTML(record['name'])}</dd>`;
  html += `<dt>region</dt><dd>${escapeHTML(record['region'])}</dd>`;
  html += `<dt>brewery</dt><dd>${escapeHTML(record['brewery'])}</dd>`;
  html += `<dt>rice</dt><dd>${escapeHTML(record['rice'])}</dd>`;
  html += `<dt>sake_type</dt><dd>${escapeHTML(record['sake_type'])}</dd>`;
  html += `<dt>sake_meter_value</dt><dd>${escapeHTML(record['sake_meter_value'])}</dd>`;
  html += `<dt>abv</dt><dd>${escapeHTML(record['abv'])}</dd>`;
  html += `<dt>volume</dt><dd>${escapeHTML(record['volume'])}</dd>`;
  html += `<dt>price</dt><dd>${escapeHTML(record['price'])}</dd>`;
  html += `<dt>one_line_note</dt><dd>${escapeHTML(record['one_line_note'])}</dd>`;
  html += `<dt>place</dt><dd>${escapeHTML(record['place'])}</dd>`;
  html += `<dt>consumed_date</dt><dd>${escapeHTML(record['consumed_date'])}</dd>`;
  html += `<dt>companions</dt><dd>${escapeHTML(record['companions'])}</dd>`;
  html += `<dt>food_pairing</dt><dd>${escapeHTML(record['food_pairing'])}</dd>`;
  html += `<dt>drink_again</dt><dd>${escapeHTML(record['drink_again'])}</dd>`;
  html += `<dt>sweet_dry</dt><dd>${escapeHTML(record['sweet_dry'])}</dd>`;
  html += `<dt>aroma_intensity</dt><dd>${escapeHTML(record['aroma_intensity'])}</dd>`;
  html += `<dt>acidity</dt><dd>${escapeHTML(record['acidity'])}</dd>`;
  html += `<dt>clean_umami</dt><dd>${escapeHTML(record['clean_umami'])}</dd>`;
  html += `</dl></body></html>`;
  return c.html(html);
});

// LOGIN
app.post('/login', async (c) => {
  let username = '';
  let password = '';
  const contentType = c.req.header('Content-Type') || '';
  if (contentType.includes('application/json')) {
    const body = await c.req.json().catch(() => ({}));
    username = body.username || body.email || '';
    password = body.password || '';
  } else {
    const formData = await c.req.formData().catch(() => new FormData());
    username = (formData.get('username') || formData.get('email') || '').toString();
    password = (formData.get('password') || '').toString();
  }

  if (!username || !password) {
    return writeError(c, 400, 'VALIDATION_FAILED', 'username and password are required');
  }

  let user: any = null;
  try {
    user = await c.env.DB.prepare('SELECT * FROM "users" WHERE email = ? AND ("deleted_at" IS NULL OR "deleted_at" = \'\')').bind(username).first<any>();
  } catch (e) {}

  if (!user || !(await verifyPassword(password, user.password))) {
    return writeError(c, 401, 'INVALID_CREDENTIALS', 'invalid email or password');
  }

  const sessionId = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  try {
    await c.env.DB.prepare('INSERT INTO "_mold_sessions" (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(sessionId, user.id, now.toISOString(), expiresAt).run();
  } catch (e) {}

  c.header('Set-Cookie', 'mold_session=' + sessionId + '; Path=/; HttpOnly; SameSite=Lax');
  return c.json({ data: { user: sanitizeRecord(user, ['password']), session_id: sessionId } });
});

// LOGOUT
app.post('/logout', async (c) => {
  const cookieHeader = c.req.header('Cookie') || '';
  const match = cookieHeader.match(/mold_session=([^;]+)/);
  if (match) {
    const token = match[1];
    try {
      await c.env.DB.prepare('DELETE FROM "_mold_sessions" WHERE id = ?').bind(token).run();
    } catch (e) {}
  }
  c.header('Set-Cookie', 'mold_session=; Path=/; HttpOnly; Max-Age=0');
  return c.json({ data: { logged_out: true } });
});

export default app;

export { app as moldApp };
