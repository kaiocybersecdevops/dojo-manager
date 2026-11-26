import { h, render } from 'https://esm.sh/preact@10.24.3';
import { useState, useEffect, useCallback } from 'https://esm.sh/preact@10.24.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { createApi, can } from './api.js';

const html = htm.bind(h);
const api = createApi();

const fmtTime = (iso) => (iso ? new Date(iso.endsWith('Z') || iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z').toLocaleString() : '—');

function Belt({ belt, stripes }) {
  return html`<span class=${`belt belt-${belt}`} title=${`${belt} belt, ${stripes} stripe(s)`}>
    <span class="bar">${Array.from({ length: stripes }, (_, i) => html`<i key=${i}></i>`)}</span>
  </span>`;
}

function Login({ onLogin, notify }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const submit = async (e, creds) => {
    e?.preventDefault();
    try { onLogin(await api.login(creds?.email ?? email, creds?.password ?? password)); }
    catch (err) { notify(err.message, 'err'); }
  };
  const demo = [
    ['Admin', 'admin@dojo.dev', 'full access, including the audit log'],
    ['Instructor', 'coach@dojo.dev', 'roster, check-ins, promotions'],
    ['Student', 'ana@dojo.dev', 'self check-in with code A1B2C3'],
  ];
  return html`<div class="login card">
    <h1>🥋 Dojo <span style="color:var(--accent)">Manager</span></h1>
    <p>Check-in, belt tracking and audit trail for a Brazilian Jiu-Jitsu academy.</p>
    <form onSubmit=${submit}>
      <input placeholder="Email" value=${email} onInput=${(e) => setEmail(e.target.value)} />
      <input placeholder="Password" type="password" value=${password} onInput=${(e) => setPassword(e.target.value)} />
      <button class="btn">Sign in</button>
    </form>
    <p class="label">Try a demo account (password <code>demo1234</code>):</p>
    <div class="demo-users">
      ${demo.map(([role, mail, desc]) => html`<button class="btn ghost" onClick=${() => submit(null, { email: mail, password: 'demo1234' })}>
        <b>${role}</b> <span class="muted">· ${desc}</span></button>`)}
    </div>
  </div>`;
}

function Dashboard({ notify }) {
  const [data, setData] = useState(null);
  useEffect(() => { Promise.all([api.students(), api.todayCheckins()]).then(([s, c]) => setData({ s, c })).catch((e) => notify(e.message, 'err')); }, []);
  if (!data) return html`<p class="muted">Loading…</p>`;
  const byBelt = ['white', 'blue', 'purple', 'brown', 'black'].map((b) => [b, data.s.filter((x) => x.belt === b).length]);
  return html`<div>
    <h1>Today on the mat</h1>
    <div class="grid">
      <div class="card"><div class="stat">${data.c.length}</div><div class="label">check-ins today</div></div>
      <div class="card"><div class="stat">${data.s.length}</div><div class="label">active students</div></div>
      <div class="card"><div class="stat">${data.s.length ? Math.round((data.c.length / data.s.length) * 100) : 0}%</div><div class="label">attendance rate today</div></div>
    </div>
    <div class="grid">
      <div class="card"><h3>Latest check-ins</h3>
        ${data.c.length ? html`<table><tbody>${data.c.map((c) => html`<tr key=${c.id}><td>${c.name}</td><td><${Belt} belt=${c.belt} stripes=${c.stripes} /></td><td class="muted">${fmtTime(c.created_at)}</td></tr>`)}</tbody></table>` : html`<p class="muted">Nobody yet today.</p>`}
      </div>
      <div class="card"><h3>Students by belt</h3>
        <table><tbody>${byBelt.map(([b, n]) => html`<tr key=${b}><td><${Belt} belt=${b} stripes=${0} /></td><td>${b}</td><td><b>${n}</b></td></tr>`)}</tbody></table>
      </div>
    </div>
  </div>`;
}

function Students({ user, notify }) {
  const [list, setList] = useState([]);
  const [name, setName] = useState('');
  const load = useCallback(() => api.students().then(setList).catch((e) => notify(e.message, 'err')), []);
  useEffect(() => { load(); }, []);
  const act = async (fn, msg) => { try { const r = await fn(); notify(msg(r), 'ok'); load(); } catch (e) { notify(e.message, 'err'); } };
  return html`<div>
    <h1>Students</h1>
    ${can(user.role, 'students:write') && html`<form class="row card" style="margin-bottom:16px" onSubmit=${(e) => { e.preventDefault(); act(() => api.addStudent(name), (s) => `Added ${s.name}. Check-in code: ${s.checkin_code}`); setName(''); }}>
      <input placeholder="New student name" value=${name} onInput=${(e) => setName(e.target.value)} />
      <button class="btn">Add student</button>
    </form>`}
    <div class="card"><table>
      <thead><tr><th>Name</th><th>Belt</th><th>Check-in code</th><th>Last check-in</th><th></th></tr></thead>
      <tbody>${list.map((s) => html`<tr key=${s.id}>
        <td>${s.name}</td><td><${Belt} belt=${s.belt} stripes=${s.stripes} /> <span class="muted">${s.belt} · ${s.stripes}</span></td>
        <td><code>${s.checkin_code}</code></td><td class="muted">${fmtTime(s.last_checkin)}</td>
        <td class="row">
          <button class="btn small ghost" onClick=${() => act(() => api.checkinStudent(s.id), (r) => `${r.name} checked in`)}>Check in</button>
          ${can(user.role, 'belts:promote') && html`
            <button class="btn small ghost" onClick=${() => act(() => api.promote(s.id, 'stripe'), (r) => `${r.name}: ${r.stripes} stripe(s)`)}>+ Stripe</button>
            <button class="btn small ghost" onClick=${() => act(() => api.promote(s.id, 'belt'), (r) => `${r.name} promoted to ${r.belt} belt`)}>Promote</button>`}
        </td></tr>`)}</tbody>
    </table></div>
  </div>`;
}

function Kiosk({ user, notify }) {
  const [code, setCode] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try { const r = await api.checkinByCode(code); notify(`Welcome, ${r.name}! Oss 🥋`, 'ok'); setCode(''); }
    catch (err) { notify(err.message, 'err'); }
  };
  return html`<div class="kiosk card">
    <h1>Check-in kiosk</h1>
    <p class="muted">${user.role === 'student' ? 'Enter your personal check-in code. (Demo: A1B2C3)' : 'Students type their code at the front desk tablet.'}</p>
    <form class="row" onSubmit=${submit}>
      <input maxlength="6" value=${code} onInput=${(e) => setCode(e.target.value)} placeholder="CODE" />
      <button class="btn" disabled=${code.trim().length !== 6}>Check in</button>
    </form>
  </div>`;
}

function Audit({ notify }) {
  const [rows, setRows] = useState([]);
  useEffect(() => { api.audit().then(setRows).catch((e) => notify(e.message, 'err')); }, []);
  return html`<div>
    <h1>Audit trail</h1>
    <p class="muted">Every login, failed attempt, check-in and promotion is recorded: who, what and when.</p>
    <div class="card"><table>
      <thead><tr><th>When</th><th>User</th><th>Action</th><th>Details</th></tr></thead>
      <tbody>${rows.map((r) => html`<tr key=${r.id}><td class="muted">${fmtTime(r.created_at)}</td><td>${r.user_name || '—'}</td><td><code>${r.action}</code></td><td class="muted">${r.details || ''}</td></tr>`)}</tbody>
    </table></div>
  </div>`;
}

function App() {
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState('dashboard');
  const [toast, setToast] = useState(null);
  const notify = useCallback((text, kind = 'ok') => { setToast({ text, kind }); setTimeout(() => setToast(null), 3500); }, []);

  const tabs = [
    ['dashboard', 'Dashboard', 'checkins:read'], ['students', 'Students', 'students:read'],
    ['kiosk', 'Check-in', 'checkins:create'], ['audit', 'Audit log', 'audit:read'],
  ].filter(([, , perm]) => user && can(user.role, perm));

  const onLogin = (u) => { setUser(u); setTab(can(u.role, 'checkins:read') ? 'dashboard' : 'kiosk'); };
  const logout = () => { api.logout(); setUser(null); };
  const views = { dashboard: Dashboard, students: Students, kiosk: Kiosk, audit: Audit };
  const View = views[tab];

  return html`<div>
    <header class="topbar">
      <div class="brand">🥋 Dojo <span>Manager</span></div>
      ${api.mode === 'demo' && html`<span class="badge demo" title="Data is stored in your browser only">Demo mode</span>`}
      <div class="spacer"></div>
      ${user && html`<span class="who">${user.name} · ${user.role}</span><button class="btn small ghost" onClick=${logout}>Sign out</button>`}
      ${api.mode === 'demo' && html`<button class="btn small ghost" onClick=${() => { api.reset(); logout(); notify('Demo data reset'); }}>Reset demo</button>`}
    </header>
    ${user ? html`<nav class="tabs">${tabs.map(([id, label]) => html`<button class=${'tab' + (tab === id ? ' active' : '')} onClick=${() => setTab(id)}>${label}</button>`)}</nav>
      <main><${View} user=${user} notify=${notify} key=${tab} /></main>`
    : html`<main><${Login} onLogin=${onLogin} notify=${notify} /></main>`}
    <footer>Prototype by <a href="https://www.linkedin.com/in/kaio-cybersec-devops/">Kaio Bertocchi Ribeiro</a> · <a href="https://github.com/kaiocybersecdevops/dojo-manager">Source on GitHub</a></footer>
    ${toast && html`<div class=${'toast ' + toast.kind}>${toast.text}</div>`}
  </div>`;
}

render(html`<${App} />`, document.getElementById('root'));
