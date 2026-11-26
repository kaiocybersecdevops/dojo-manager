import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDb, seed } from '../src/db.js';
import { createApp } from '../src/app.js';

let server, base;

before(async () => {
  const db = openDb(':memory:');
  seed(db);
  server = createServer(createApp(db));
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: res.status === 204 ? null : await res.json() };
};
const login = async (email) => (await api('POST', '/api/auth/login', { body: { email, password: 'demo1234' } })).data.token;

test('rejects a wrong password and records it in the audit log', async () => {
  const bad = await api('POST', '/api/auth/login', { body: { email: 'admin@dojo.dev', password: 'nope' } });
  assert.equal(bad.status, 401);
  const audit = await api('GET', '/api/audit', { token: await login('admin@dojo.dev') });
  assert.ok(audit.data.some((e) => e.action === 'login_failed'));
});

test('requires a valid token for protected routes', async () => {
  assert.equal((await api('GET', '/api/students')).status, 401);
  assert.equal((await api('GET', '/api/students', { token: 'forged.token.value' })).status, 401);
});

test('enforces role-based access: students cannot read the roster or the audit log', async () => {
  const student = await login('ana@dojo.dev');
  assert.equal((await api('GET', '/api/students', { token: student })).status, 403);
  assert.equal((await api('GET', '/api/audit', { token: student })).status, 403);
  const coach = await login('coach@dojo.dev');
  assert.equal((await api('GET', '/api/audit', { token: coach })).status, 403);
});

test('instructor creates a student with a generated check-in code', async () => {
  const coach = await login('coach@dojo.dev');
  const res = await api('POST', '/api/students', { token: coach, body: { name: 'Pedro Alves' } });
  assert.equal(res.status, 201);
  assert.match(res.data.checkin_code, /^[0-9A-F]{6}$/);
  assert.equal((await api('POST', '/api/students', { token: coach, body: { name: 'x' } })).status, 422);
});

test('student checks in with own code once per day, and cannot use another code', async () => {
  const student = await login('ana@dojo.dev');
  assert.equal((await api('POST', '/api/checkins', { token: student, body: { code: 'D4E5F6' } })).status, 403);
  assert.equal((await api('POST', '/api/checkins', { token: student, body: { code: 'a1b2c3' } })).status, 201);
  assert.equal((await api('POST', '/api/checkins', { token: student, body: { code: 'A1B2C3' } })).status, 409);
});

test('promotions follow the belt order and reset stripes', async () => {
  const coach = await login('coach@dojo.dev');
  const lucas = (await api('GET', '/api/students', { token: coach })).data.find((s) => s.name === 'Lucas Lima');
  const stripe = await api('PATCH', `/api/students/${lucas.id}/promote`, { token: coach, body: { type: 'stripe' } });
  assert.equal(stripe.data.stripes, 4);
  assert.equal((await api('PATCH', `/api/students/${lucas.id}/promote`, { token: coach, body: { type: 'stripe' } })).status, 422);
  const belt = await api('PATCH', `/api/students/${lucas.id}/promote`, { token: coach, body: { type: 'belt' } });
  assert.deepEqual([belt.data.belt, belt.data.stripes], ['blue', 0]);
});

test('every sensitive action lands in the audit trail', async () => {
  const actions = (await api('GET', '/api/audit', { token: await login('admin@dojo.dev') })).data.map((e) => e.action);
  for (const a of ['login', 'student_created', 'checkin', 'checkin_rejected', 'promotion']) assert.ok(actions.includes(a), a);
});
