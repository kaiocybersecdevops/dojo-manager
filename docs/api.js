// Two interchangeable back ends behind one interface:
//  - HttpApi talks to the real Node.js API in /server
//  - DemoApi runs the same rules in the browser (localStorage), so the live demo works on GitHub Pages
const BELTS = ['white', 'blue', 'purple', 'brown', 'black'];

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export class HttpApi {
  constructor(baseUrl) { this.baseUrl = baseUrl.replace(/\/$/, ''); this.token = null; this.mode = 'live'; }
  async request(method, path, body) {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = res.status === 204 ? null : await res.json();
    if (!res.ok) throw new ApiError(res.status, data?.error || 'Request failed');
    return data;
  }
  async login(email, password) { const r = await this.request('POST', '/api/auth/login', { email, password }); this.token = r.token; return r.user; }
  logout() { this.token = null; }
  students() { return this.request('GET', '/api/students'); }
  addStudent(name, belt) { return this.request('POST', '/api/students', { name, belt }); }
  promote(id, type) { return this.request('PATCH', `/api/students/${id}/promote`, { type }); }
  checkinByCode(code) { return this.request('POST', '/api/checkins', { code }); }
  checkinStudent(studentId) { return this.request('POST', '/api/checkins', { studentId }); }
  todayCheckins() { return this.request('GET', '/api/checkins/today'); }
  audit() { return this.request('GET', '/api/audit'); }
}

const PERMISSIONS = {
  'students:read': ['admin', 'instructor'], 'students:write': ['admin', 'instructor'],
  'belts:promote': ['admin', 'instructor'], 'checkins:create': ['admin', 'instructor', 'student'],
  'checkins:read': ['admin', 'instructor'], 'audit:read': ['admin'],
};
export const can = (role, perm) => (PERMISSIONS[perm] || []).includes(role);

const KEY = 'dojo-manager-demo-v1';
const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();

function freshState() {
  return {
    seq: 10,
    students: [
      { id: 1, name: 'Ana Souza', belt: 'blue', stripes: 2, checkin_code: 'A1B2C3', active: 1 },
      { id: 2, name: 'Lucas Lima', belt: 'white', stripes: 3, checkin_code: 'D4E5F6', active: 1 },
      { id: 3, name: 'Marina Costa', belt: 'purple', stripes: 1, checkin_code: '7A8B9C', active: 1 },
      { id: 4, name: 'Rafael Nunes', belt: 'brown', stripes: 0, checkin_code: 'B7C8D9', active: 1 },
    ],
    users: [
      { id: 1, name: 'Demo Admin', email: 'admin@dojo.dev', role: 'admin', student_id: null },
      { id: 2, name: 'Demo Instructor', email: 'coach@dojo.dev', role: 'instructor', student_id: null },
      { id: 3, name: 'Ana Souza', email: 'ana@dojo.dev', role: 'student', student_id: 1 },
    ],
    checkins: [{ id: 1, student_id: 3, method: 'staff', created_by: 2, created_at: now() }],
    audit: [],
  };
}

export class DemoApi {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage; this.user = null; this.mode = 'demo';
    try { this.state = JSON.parse(storage.getItem(KEY)) || freshState(); } catch { this.state = freshState(); }
  }
  save() { try { this.storage.setItem(KEY, JSON.stringify(this.state)); } catch { /* storage may be unavailable */ } }
  reset() { this.state = freshState(); this.save(); }
  id() { return ++this.state.seq; }
  log(action, entity = null, entityId = null, details = null) {
    this.state.audit.unshift({ id: this.id(), user_id: this.user?.id ?? null, user_name: this.user?.name ?? null, action, entity, entity_id: entityId, details: details && JSON.stringify(details), created_at: now() });
    this.save();
  }
  guard(perm) {
    if (!this.user) throw new ApiError(401, 'Authentication required');
    if (!can(this.user.role, perm)) throw new ApiError(403, 'You do not have permission for this action');
  }
  async login(email, password) {
    const user = this.state.users.find((u) => u.email === String(email).toLowerCase());
    if (!user || password !== 'demo1234') { this.log('login_failed', null, null, { email }); throw new ApiError(401, 'Invalid email or password'); }
    this.user = user; this.log('login');
    return { id: user.id, name: user.name, role: user.role, studentId: user.student_id };
  }
  logout() { this.user = null; }
  async students() {
    this.guard('students:read');
    return this.state.students.filter((s) => s.active).map((s) => ({
      ...s, last_checkin: this.state.checkins.filter((c) => c.student_id === s.id).map((c) => c.created_at).sort().pop() || null,
    })).sort((a, b) => a.name.localeCompare(b.name));
  }
  async addStudent(name, belt = 'white') {
    this.guard('students:write');
    name = String(name || '').trim();
    if (name.length < 2 || name.length > 80) throw new ApiError(422, 'Name must be 2-80 characters');
    if (!BELTS.includes(belt)) throw new ApiError(422, 'Unknown belt');
    const code = Math.random().toString(16).slice(2, 8).toUpperCase().padEnd(6, '0');
    const s = { id: this.id(), name, belt, stripes: 0, checkin_code: code, active: 1 };
    this.state.students.push(s); this.log('student_created', 'student', s.id, { name, belt });
    return s;
  }
  async promote(id, type) {
    this.guard('belts:promote');
    const s = this.state.students.find((x) => x.id === id);
    if (!s) throw new ApiError(404, 'Student not found');
    const from = `${s.belt}/${s.stripes}`;
    if (type === 'stripe') {
      if (s.stripes >= 4) throw new ApiError(422, 'Four stripes already: promote to the next belt');
      s.stripes += 1;
    } else {
      const next = BELTS[BELTS.indexOf(s.belt) + 1];
      if (!next) throw new ApiError(422, 'Already at black belt');
      s.belt = next; s.stripes = 0;
    }
    this.log('promotion', 'student', s.id, { from, to: `${s.belt}/${s.stripes}` });
    return { ...s };
  }
  doCheckin(student, method) {
    if (this.state.checkins.some((c) => c.student_id === student.id && c.created_at.slice(0, 10) === today())) {
      throw new ApiError(409, `${student.name} is already checked in today`);
    }
    const c = { id: this.id(), student_id: student.id, method, created_by: this.user.id, created_at: now() };
    this.state.checkins.push(c); this.log('checkin', 'student', student.id, { method });
    return { id: c.id, studentId: student.id, name: student.name, method };
  }
  async checkinByCode(code) {
    this.guard('checkins:create');
    const s = this.state.students.find((x) => x.checkin_code === String(code || '').trim().toUpperCase() && x.active);
    if (!s || (this.user.role === 'student' && s.id !== this.user.student_id)) {
      this.log('checkin_rejected', null, null, { code }); throw new ApiError(403, 'Invalid check-in code');
    }
    return this.doCheckin(s, this.user.role === 'student' ? 'code' : 'staff');
  }
  async checkinStudent(studentId) {
    this.guard('checkins:read');
    const s = this.state.students.find((x) => x.id === studentId && x.active);
    if (!s) throw new ApiError(404, 'Student not found');
    return this.doCheckin(s, 'staff');
  }
  async todayCheckins() {
    this.guard('checkins:read');
    return this.state.checkins.filter((c) => c.created_at.slice(0, 10) === today())
      .map((c) => { const s = this.state.students.find((x) => x.id === c.student_id); return { id: c.id, created_at: c.created_at, method: c.method, student_id: s.id, name: s.name, belt: s.belt, stripes: s.stripes }; })
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async audit() { this.guard('audit:read'); return this.state.audit.slice(0, 100); }
}

export function createApi() {
  const params = new URLSearchParams(location.search);
  const apiUrl = params.get('api');
  return apiUrl ? new HttpApi(apiUrl) : new DemoApi();
}
