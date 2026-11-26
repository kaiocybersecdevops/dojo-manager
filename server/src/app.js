import { verifyPassword, signToken, verifyToken, can } from './auth.js';
import { BELTS, audit, newCheckinCode } from './db.js';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const send = (res, status, data) => {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  });
  res.end(data === undefined ? '' : JSON.stringify(data));
};

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new HttpError(413, 'Payload too large');
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

const cleanName = (value) => {
  const name = String(value || '').trim();
  if (name.length < 2 || name.length > 80) throw new HttpError(422, 'Name must be 2-80 characters');
  return name;
};

export function createApp(db) {
  const routes = [];
  const route = (method, pattern, permission, handler) => {
    const keys = [];
    const regex = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '(\\d+)'; }) + '$');
    routes.push({ method, regex, keys, permission, handler });
  };

  route('POST', '/api/auth/login', null, async ({ body, ip }) => {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(body.email || '').toLowerCase());
    if (!user || !verifyPassword(String(body.password || ''), user.password_hash)) {
      audit(db, { action: 'login_failed', details: { email: body.email }, ip });
      throw new HttpError(401, 'Invalid email or password');
    }
    audit(db, { userId: user.id, action: 'login', ip });
    const token = signToken({ sub: user.id, role: user.role, studentId: user.student_id });
    return { token, user: { id: user.id, name: user.name, role: user.role, studentId: user.student_id } };
  });

  route('GET', '/api/students', 'students:read', () =>
    db.prepare(`SELECT s.*, (SELECT MAX(created_at) FROM checkins c WHERE c.student_id = s.id) AS last_checkin
                FROM students s WHERE active = 1 ORDER BY name`).all());

  route('POST', '/api/students', 'students:write', ({ body, user, ip }) => {
    const name = cleanName(body.name);
    const belt = body.belt || 'white';
    if (!BELTS.includes(belt)) throw new HttpError(422, 'Unknown belt');
    const code = newCheckinCode();
    const id = Number(db.prepare('INSERT INTO students (name, belt, checkin_code) VALUES (?, ?, ?)').run(name, belt, code).lastInsertRowid);
    audit(db, { userId: user.sub, action: 'student_created', entity: 'student', entityId: id, details: { name, belt }, ip });
    return { status: 201, data: db.prepare('SELECT * FROM students WHERE id = ?').get(id) };
  });

  route('PATCH', '/api/students/:id/promote', 'belts:promote', ({ params, body, user, ip }) => {
    const student = db.prepare('SELECT * FROM students WHERE id = ?').get(params.id);
    if (!student) throw new HttpError(404, 'Student not found');
    let { belt, stripes } = student;
    if (body.type === 'stripe') {
      if (stripes >= 4) throw new HttpError(422, 'Four stripes already: promote to the next belt');
      stripes += 1;
    } else if (body.type === 'belt') {
      const next = BELTS[BELTS.indexOf(belt) + 1];
      if (!next) throw new HttpError(422, 'Already at black belt');
      belt = next; stripes = 0;
    } else {
      throw new HttpError(422, "type must be 'stripe' or 'belt'");
    }
    db.prepare('UPDATE students SET belt = ?, stripes = ? WHERE id = ?').run(belt, stripes, student.id);
    audit(db, { userId: user.sub, action: 'promotion', entity: 'student', entityId: student.id,
      details: { from: `${student.belt}/${student.stripes}`, to: `${belt}/${stripes}` }, ip });
    return db.prepare('SELECT * FROM students WHERE id = ?').get(student.id);
  });

  route('POST', '/api/checkins', 'checkins:create', ({ body, user, ip }) => {
    let student;
    if (user.role === 'student') {
      // Students may only check themselves in, and must present their own code.
      student = db.prepare('SELECT * FROM students WHERE checkin_code = ? AND active = 1').get(String(body.code || '').toUpperCase());
      if (!student || student.id !== user.studentId) {
        audit(db, { userId: user.sub, action: 'checkin_rejected', details: { code: body.code }, ip });
        throw new HttpError(403, 'Invalid check-in code');
      }
    } else {
      student = db.prepare('SELECT * FROM students WHERE id = ? AND active = 1').get(Number(body.studentId));
      if (!student) throw new HttpError(404, 'Student not found');
    }
    const already = db.prepare(`SELECT id FROM checkins WHERE student_id = ? AND date(created_at) = date('now')`).get(student.id);
    if (already) throw new HttpError(409, `${student.name} is already checked in today`);
    const method = user.role === 'student' ? 'code' : 'staff';
    const id = Number(db.prepare('INSERT INTO checkins (student_id, method, created_by) VALUES (?, ?, ?)').run(student.id, method, user.sub).lastInsertRowid);
    audit(db, { userId: user.sub, action: 'checkin', entity: 'student', entityId: student.id, details: { method }, ip });
    return { status: 201, data: { id, studentId: student.id, name: student.name, method } };
  });

  route('GET', '/api/checkins/today', 'checkins:read', () =>
    db.prepare(`SELECT c.id, c.created_at, c.method, s.id AS student_id, s.name, s.belt, s.stripes
                FROM checkins c JOIN students s ON s.id = c.student_id
                WHERE date(c.created_at) = date('now') ORDER BY c.created_at DESC`).all());

  route('GET', '/api/audit', 'audit:read', () =>
    db.prepare(`SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
                ORDER BY a.id DESC LIMIT 100`).all());

  return async function handler(req, res) {
    if (req.method === 'OPTIONS') return send(res, 204);
    const url = new URL(req.url, 'http://localhost');
    const match = routes.map((r) => ({ r, m: r.regex.exec(url.pathname) })).find(({ r, m }) => m && r.method === req.method);
    try {
      if (!match) throw new HttpError(404, 'Not found');
      const { r, m } = match;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, Number(m[i + 1])]));
      let user = null;
      if (r.permission) {
        user = verifyToken((req.headers.authorization || '').replace(/^Bearer /, ''));
        if (!user) throw new HttpError(401, 'Authentication required');
        if (!can(user.role, r.permission)) throw new HttpError(403, 'You do not have permission for this action');
      }
      const body = ['POST', 'PATCH'].includes(req.method) ? await readJson(req) : {};
      const result = await r.handler({ params, body, user, ip: req.socket.remoteAddress });
      if (result && result.status) return send(res, result.status, result.data);
      return send(res, 200, result);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      console.error(err);
      return send(res, 500, { error: 'Internal server error' });
    }
  };
}
