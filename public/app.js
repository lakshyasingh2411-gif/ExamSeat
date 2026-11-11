'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const letter = i => String.fromCharCode(65 + i);
const seatLabel = (n, cols) => letter(Math.floor((n - 1) / cols)) + ((n - 1) % cols + 1);
const fmtDate = d => new Date(d + 'T00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const empty = (t, p) => `<div class="empty"><h3>${esc(t)}</h3><p class="hint">${esc(p)}</p></div>`;
const TABS = {
  admin: [['overview', 'Overview'], ['exams', 'Exams'], ['seating', 'Seating'], ['rooms', 'Rooms'], ['students', 'Students'], ['audit', 'Audit log']],
  invigilator: [['attendance', 'Mark attendance']],
  student: [['mine', 'My exams']]
};
const DEMO = { admin: 'admin@examseat.edu / admin123', invigilator: 'inv@examseat.edu / inv123', student: 'CSE001 / student123' };

let token = sessionStorage.getItem('es_token');
let me = JSON.parse(sessionStorage.getItem('es_me') || 'null');
const S = { tab: null, role: 'admin', exam: null, room: null, sel: null, exams: [], seating: null, result: null };
let timer;

/* ---------- helpers ---------- */
function toast(msg, bad) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg;
  $('#toasts').append(t); setTimeout(() => t.remove(), 4500);
}
function ask(title, text, ok) {
  return new Promise(res => {
    const d = $('#dlg');
    d.returnValue = '';
    d.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3><p>${esc(text)}</p><div class="row end"><button value="no">Cancel</button><button class="pri" value="yes">${esc(ok)}</button></div></form>`;
    d.onclose = () => res(d.returnValue === 'yes');
    d.showModal();
  });
}
async function api(path, opt = {}) {
  const r = await fetch('/api' + path, {
    method: opt.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: opt.body ? JSON.stringify(opt.body) : undefined
  });
  const d = (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text();
  if (r.status === 401 && token && !path.startsWith('/auth')) { logout(); throw new Error('Your session has ended. Please sign in again.'); }
  if (!r.ok) throw new Error(d.error || 'Request failed.');
  return d;
}
const brand = `<div class="brand"><span class="mark"><i></i><i></i><i class="f"></i></span>ExamSeat</div>`;

/* ---------- sign in ---------- */
function loginHtml() {
  const rows = ['a.pa.p', 'pa..ap', '.apa.a', 'pa.pa.'];
  const art = rows.map((r, y) => [...r].map((c, x) => `<span class="seat ${c === 'p' ? 'p' : c === 'a' ? 'a' : ''}">${letter(y)}${x + 1}</span>`).join('')).join('');
  return `<div class="login"><section class="login-art"><div class="sheet"><div class="hallwrap"><div class="hall" style="grid-template-columns:repeat(6,42px)">${art}</div></div></div>
  <h1>Every student in the right seat.</h1></section>
  <section class="login-form"><form class="lf" data-form="login">${brand}<h1>Sign in</h1>
  <div class="seg" role="group" aria-label="Sign in as">${['admin', 'invigilator', 'student'].map(r => `<button type="button" data-act="role" data-v="${r}" aria-pressed="${S.role === r}">${r[0].toUpperCase() + r.slice(1)}</button>`).join('')}</div>
  <label>${S.role === 'student' ? 'Roll number' : 'Email'}<input name="u" required autocomplete="username"></label>
  <label>Password<input name="p" type="password" required autocomplete="current-password"></label>
  <p id="lerr" class="err" role="alert"></p><button class="pri">Sign in</button>
  <p class="hint">Demo account: ${DEMO[S.role]}</p></form></section></div>`;
}
function shellHtml() {
  return `<div class="shell"><aside class="side no-print">${brand}
  <nav class="nav" aria-label="Sections">${TABS[me.role].map(([k, l]) => `<button data-act="tab" data-v="${k}" ${S.tab === k ? 'aria-current="page"' : ''}>${l}</button>`).join('')}</nav>
  <div class="who"><b>${esc(me.name)}</b><span class="hint">${me.role}</span><button data-act="logout">Sign out</button></div></aside><main id="main" class="main"></main></div>`;
}
function logout() {
  sessionStorage.clear(); token = null; me = null; S.tab = null; S.exam = S.room = S.sel = null; S.seating = null; S.result = null;
  clearInterval(timer); $('#toasts').innerHTML = ''; render();
}
async function render(quiet) {
  clearInterval(timer);
  if (!me) { $('#app').innerHTML = loginHtml(); return; }
  if (!TABS[me.role].some(t => t[0] === S.tab)) S.tab = TABS[me.role][0][0];
  if (!quiet || !$('#main')) $('#app').innerHTML = shellHtml();
  const m = $('#main');
  if (!quiet) m.innerHTML = '<p class="hint">Loading…</p>';
  try { await V[S.tab](m); }
  catch (e) { m.innerHTML = `<h1>This page could not load</h1><p>${esc(e.message)}</p><button data-act="retry">Try again</button>`; }
}

/* ---------- views ---------- */
const V = {};
const examTable = rows => rows.length ? `<div class="tw"><table><tr><th>Exam</th><th>Date</th><th>Enrolled</th><th>Seated</th><th>Present</th><th>Progress</th></tr>${rows.map(e => {
  const pc = e.seated ? Math.round(e.present / e.seated * 100) : 0;
  return `<tr><td><b>${esc(e.code)}</b></td><td>${fmtDate(e.exam_date)}</td><td>${e.enrolled}</td><td>${e.seated}</td><td>${e.present}</td><td><div class="bar" role="img" aria-label="${pc}% present"><i style="width:${pc}%"></i></div></td></tr>`;
}).join('')}</table></div>` : empty('No exams yet', 'Add an exam, then allocate seats to see progress here.');

V.overview = async m => {
  const d = await api('/stats'), todo = d.exams.find(x => !x.seated && x.enrolled);
  m.innerHTML = `<h1>Overview</h1><p class="hint">Seating and attendance across all exams.</p>
  <dl class="ledger">${[['Students', d.students], ['Rooms', d.rooms], ['Exams', d.exams.length], ['Seats assigned', d.seated], ['Marked present', d.present]].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
  ${todo ? `<div class="result"><span><b>${esc(todo.code)}</b> has no seats yet.</span><button class="pri" data-act="seat-exam" data-id="${todo.id}">Open seating</button></div>` : ''}
  <h2>Attendance by exam</h2>${examTable(d.exams)}`;
};

V.exams = async m => {
  const ex = await api('/exams');
  m.innerHTML = `<h1>Exams</h1><p class="hint">New exams enrol every current student.</p>
  <details class="add"><summary class="btn pri">Add exam</summary><form class="fgrid" data-form="exam">
   <label>Course code<input name="code" required maxlength="30"></label><label class="grow">Title<input name="title" required maxlength="160"></label>
   <label>Date<input name="exam_date" type="date" required></label><label>Start<input name="start_time" type="time" required></label><label>End<input name="end_time" type="time" required></label>
   <button class="pri">Save exam</button></form></details>
  ${ex.length ? `<div class="tw"><table><tr><th>Code</th><th>Title</th><th>Date</th><th>Time</th><th>Students</th><th></th></tr>${ex.map(e => `<tr><td><b>${esc(e.code)}</b></td><td>${esc(e.title)}</td><td>${fmtDate(e.exam_date)}</td><td>${e.start_time}–${e.end_time}</td><td>${e.enrolled}</td>
   <td class="act"><button data-act="seat-exam" data-id="${e.id}">Seating</button><button data-act="report" data-id="${e.id}" data-code="${esc(e.code)}">Download report</button><button class="danger" data-act="del" data-kind="exams" data-id="${e.id}" data-name="${esc(e.code)}">Delete</button></td></tr>`).join('')}</table></div>` : empty('No exams yet', 'Add your first exam to start seating students.')}`;
};

V.rooms = async m => {
  const rs = await api('/rooms');
  m.innerHTML = `<h1>Rooms</h1><p class="hint">Seats are numbered row by row, like A1, A2, B1.</p>
  <details class="add"><summary class="btn pri">Add room</summary><form class="fgrid" data-form="room">
   <label class="grow">Room name<input name="name" required maxlength="80"></label><label>Rows<input name="rows" type="number" min="1" max="20" value="4" required></label>
   <label>Seats per row<input name="cols" type="number" min="1" max="20" value="5" required></label><button class="pri">Save room</button></form></details>
  ${rs.length ? `<div class="tw"><table><tr><th>Room</th><th>Layout</th><th>Capacity</th><th></th></tr>${rs.map(r => `<tr><td><b>${esc(r.name)}</b></td><td>${r.rows} rows × ${r.cols} seats</td><td>${r.capacity}</td><td class="act"><button class="danger" data-act="del" data-kind="rooms" data-id="${r.id}" data-name="${esc(r.name)}">Delete</button></td></tr>`).join('')}</table></div>` : empty('No rooms yet', 'Add a room so seats can be allocated.')}`;
};

V.students = async m => {
  const st = await api('/students'), depts = [...new Set(st.map(s => s.dept))].sort();
  m.innerHTML = `<h1>Students</h1><p class="hint">New students are enrolled in every exam. Their first password is set by the server settings unless you enter one.</p>
  <div class="row"><details class="add"><summary class="btn pri">Add student</summary><form class="fgrid" data-form="student">
   <label>Roll number<input name="roll" required maxlength="30"></label><label class="grow">Name<input name="name" required maxlength="120"></label>
   <label>Department<input name="dept" required maxlength="30"></label><label>Password (optional)<input name="password" type="text" autocomplete="off"></label><button class="pri">Save student</button></form></details>
  <details class="add"><summary class="btn">Import from CSV</summary><form data-form="import"><p class="hint">One student per line: roll,name,department</p><textarea name="csv" placeholder="CSE037,Neha Kapoor,CSE"></textarea><div class="row end"><button class="pri">Import students</button></div></form></details></div>
  <div class="fgrid"><label>Search<input id="q" type="search" placeholder="Name or roll number"></label><label>Department<select id="dp"><option value="">All</option>${depts.map(d => `<option>${esc(d)}</option>`).join('')}</select></label><span class="hint" id="cnt">${st.length} shown</span></div>
  ${st.length ? `<div class="tw"><table id="stbl"><tr><th>Roll</th><th>Name</th><th>Department</th><th></th></tr>${st.map(s => `<tr data-s="${esc((s.roll + ' ' + s.name).toLowerCase())}" data-d="${esc(s.dept)}"><td><b>${esc(s.roll)}</b></td><td>${esc(s.name)}</td><td>${esc(s.dept)}</td><td class="act"><button class="danger" data-act="del" data-kind="students" data-id="${s.id}" data-name="${esc(s.roll)}">Delete</button></td></tr>`).join('')}</table></div>` : empty('No students yet', 'Add a student or import a CSV list.')}`;
};

V.audit = async m => {
  const rows = await api('/audit');
  m.innerHTML = `<h1>Audit log</h1><p class="hint">The latest 100 actions.</p>` + (rows.length ? `<div class="tw"><table><tr><th>Time</th><th>User</th><th>Action</th></tr>${rows.map(r => `<tr><td>${esc(new Date(r.at).toLocaleString())}</td><td>${esc(r.actor)}</td><td>${esc(r.action)}</td></tr>`).join('')}</table></div>` : empty('Nothing logged yet', 'Actions appear here as people use ExamSeat.'));
};

/* ----- seating (admin) and attendance (invigilator) share the hall ----- */
async function loadSeating() {
  S.exams = await api('/exams');
  if (!S.exams.length) { S.seating = null; return; }
  if (!S.exams.some(x => x.id == S.exam)) S.exam = S.exams[0].id;
  S.seating = await api('/exams/' + S.exam + '/seating');
  if (!S.seating.rooms.some(r => r.id === S.room)) S.room = S.seating.rooms[0] ? S.seating.rooms[0].id : null;
}
const curRoom = () => S.seating && (S.seating.rooms.find(r => r.id === S.room) || S.seating.rooms[0]);
const examSelect = () => `<label>Exam<select data-sel="exam">${S.exams.map(e => `<option value="${e.id}" ${e.id == S.exam ? 'selected' : ''}>${esc(e.code)}: ${esc(e.title)}</option>`).join('')}</select></label>`;

function hallHtml(r) {
  const cells = ['<span></span>', ...Array.from({ length: r.cols }, (_, i) => `<span class="cl">${i + 1}</span>`)];
  for (let i = 0; i < r.rows; i++) {
    cells.push(`<span class="cl">${letter(i)}</span>`);
    for (let c = 0; c < r.cols; c++) {
      const n = i * r.cols + c + 1, s = r.seats.find(x => x.seat === n), lab = letter(i) + (c + 1);
      cells.push(`<button class="seat ${s ? (s.present ? 'p' : 'a') : ''}" data-act="pick" data-n="${n}" aria-pressed="${S.sel === n}" aria-label="Seat ${lab}: ${s ? esc(s.name) + (s.present ? ', present' : ', not yet present') : 'empty'}">${lab}</button>`);
    }
  }
  return `<div class="hallwrap"><div class="hall" style="grid-template-columns:24px repeat(${r.cols},42px)">${cells.join('')}</div></div>
  <div class="legend"><span><i class="seat"></i>Empty</span><span><i class="seat a"></i>Assigned</span><span><i class="seat p"></i>Present</span></div>`;
}
function panelHtml(r, role) {
  if (!S.sel) return `<h3>Seat details</h3><p class="hint">Select a seat to see who sits there.</p>`;
  const s = r.seats.find(x => x.seat === S.sel), lab = seatLabel(S.sel, r.cols);
  if (!s) return `<h3>Seat ${lab}</h3><p class="hint">This seat is empty.</p>`;
  return `<h3>Seat ${lab}</h3><p><b>${esc(s.name)}</b></p><p class="hint">${esc(s.roll)} · ${esc(s.dept)}</p>
  <p><span class="chip ${s.present ? 'ok' : ''}">${s.present ? 'Present' : 'Not marked yet'}</span></p>
  ${s.code ? `<p class="hint">Code ${esc(s.code)}</p>` : ''}
  ${role === 'invigilator' && !s.present ? `<button class="pri" data-act="manual" data-roll="${esc(s.roll)}">Mark present</button>` : ''}`;
}
function liveHtml(role) {
  const d = S.seating;
  if (!d || !d.rooms.length) return empty('No seats allocated yet', role === 'admin' ? 'Choose “Allocate seats” and ExamSeat will place every enrolled student.' : 'Ask the exam admin to allocate seats for this exam.');
  const r = curRoom(), pc = r.seated ? Math.round(r.present / r.seated * 100) : 0;
  const tabs = d.rooms.length > 1 ? `<div class="seg tabs no-print" role="group" aria-label="Room">${d.rooms.map(x => `<button data-act="room" data-id="${x.id}" aria-pressed="${x.id === r.id}">${esc(x.name)} · ${x.present}/${x.seated}</button>`).join('')}</div>` : '';
  const list = role === 'admin' ? `<h2>Seat list: ${esc(r.name)}</h2><div class="tw"><table><tr><th>Seat</th><th>Roll</th><th>Name</th><th>Department</th><th>QR code</th><th>Status</th></tr>${r.seats.map(s => `<tr><td><b>${seatLabel(s.seat, r.cols)}</b></td><td>${esc(s.roll)}</td><td>${esc(s.name)}</td><td>${esc(s.dept)}</td><td>${esc(s.code)}</td><td>${s.present ? 'Present' : 'Not marked'}</td></tr>`).join('')}</table></div>`
    : `<details class="no-print"><summary class="btn">Not yet arrived (${r.seated - r.present})</summary><div class="tw"><table>${r.seats.filter(s => !s.present).map(s => `<tr><td><b>${seatLabel(s.seat, r.cols)}</b></td><td>${esc(s.roll)}</td><td>${esc(s.name)}</td></tr>`).join('') || '<tr><td>Everyone has arrived.</td></tr>'}</table></div></details>`;
  return `${tabs}<div class="split"><section class="sheet"><h3>${esc(r.name)}</h3><p class="hint">${r.present} of ${r.seated} present</p><div class="bar" role="img" aria-label="${pc}% present"><i style="width:${pc}%"></i></div>${hallHtml(r)}</section><aside class="panel">${panelHtml(r, role)}</aside></div>${list}`;
}
async function refreshLive() {
  S.seating = await api('/exams/' + S.exam + '/seating');
  if (!S.seating.rooms.some(r => r.id === S.room)) S.room = S.seating.rooms[0] ? S.seating.rooms[0].id : null;
  const l = $('#live'); if (l) l.innerHTML = liveHtml(me.role);
}
const startPolling = () => { timer = setInterval(() => { if (!document.hidden && !$('#dlg').open) refreshLive().catch(() => {}); }, 10000); };

V.seating = async m => {
  await loadSeating();
  if (!S.exams.length) { m.innerHTML = `<h1>Seating</h1>${empty('No exams yet', 'Add an exam first, then come back to allocate seats.')}`; return; }
  m.innerHTML = `<h1>Seating</h1><p class="hint">Students from different departments are mixed so neighbours differ where possible. Rooms already booked at the same time are skipped.</p>
  <div class="fgrid no-print">${examSelect()}<button class="pri" data-act="alloc">Allocate seats</button><button data-act="print">Print seat plan</button></div>
  <div id="live">${liveHtml('admin')}</div>`;
  startPolling();
};

V.attendance = async m => {
  await loadSeating();
  if (!S.exams.length) { m.innerHTML = `<h1>Mark attendance</h1>${empty('No exams yet', 'The exam admin has not added any exams.')}`; return; }
  m.innerHTML = `<h1>Mark attendance</h1><p class="hint">Scan a student’s QR code, or type their roll number if their phone is unavailable.</p>
  <div class="fgrid no-print">${examSelect()}</div>
  <form class="fgrid no-print" style="margin-top:14px" data-form="mark"><label class="grow">QR code or roll number<input name="code" autocomplete="off" autocapitalize="characters" required autofocus></label>
   <button class="pri">Mark present</button>${'BarcodeDetector' in window ? '<button type="button" data-act="cam">Scan with camera</button>' : ''}</form>
  <div id="res"></div><div id="live">${liveHtml('invigilator')}</div>`;
  showResult(); startPolling();
};
function showResult() {
  const r = $('#res'); if (!r) return;
  r.innerHTML = S.result ? `<div class="result ${S.result[0]}" role="status">${esc(S.result[1])}</div>` : '';
}
async function doMark(body) {
  try {
    const r = await api('/attendance', { method: 'POST', body: { ...body, examId: S.exam, roomId: S.room } });
    S.result = ['ok', `${r.name} is marked present. Seat ${r.seat}, ${r.room}.`];
  } catch (e) { S.result = ['bad', e.message]; }
  showResult();
  try { await refreshLive(); } catch {}
}

V.mine = async m => {
  const rows = await api('/my/seats');
  const days = d => { const n = Math.ceil((new Date(d + 'T00:00') - new Date()) / 864e5); return n > 1 ? `in ${n} days` : n === 1 ? 'tomorrow' : n === 0 ? 'today' : ''; };
  m.innerHTML = `<h1>My exams</h1><p class="hint">Show your QR code to the invigilator when you enter the hall.</p>` + (rows.length ? rows.map(r => r.code
    ? `<article class="ticket"><div class="qr" id="qr${r.exam_id}"></div><div><h3>${esc(r.title)} <span class="hint">${esc(r.exam_code)}</span></h3><div class="big">${seatLabel(r.seat_no, r.col_count)}</div><p>${esc(r.room_name)}</p>
       <p>${fmtDate(r.exam_date)}, ${r.start_time}–${r.end_time} <span class="hint">${days(r.exam_date)}</span></p>
       <p><span class="chip ${r.marked_at ? 'ok' : ''}">${r.marked_at ? 'Attendance marked' : 'Not marked yet'}</span></p>
       <p class="hint">Backup code: ${esc(r.code)}</p><button class="no-print" data-act="print">Print ticket</button></div></article>`
    : `<article class="ticket pending"><div><h3>${esc(r.title)} <span class="hint">${esc(r.exam_code)}</span></h3><p>${fmtDate(r.exam_date)}, ${r.start_time}–${r.end_time}</p><p class="hint">Your seat appears here after the exam admin allocates seats.</p></div></article>`).join('')
    : empty('No exams yet', 'You are not enrolled in any exams.'));
  rows.filter(r => r.code).forEach(r => {
    const el = $('#qr' + r.exam_id);
    if (el && window.QRCode) new QRCode(el, { text: r.code, width: 132, height: 132 }); else if (el) el.textContent = r.code;
  });
};

/* ---------- actions (clicks) ---------- */
const A = {
  role: el => { S.role = el.dataset.v; render(); },
  tab: el => { S.tab = el.dataset.v; S.sel = null; S.result = null; render(); },
  logout: () => logout(),
  retry: () => render(),
  print: () => window.print(),
  'seat-exam': el => { S.exam = +el.dataset.id; S.room = null; S.sel = null; S.tab = 'seating'; render(); },
  room: el => { S.room = +el.dataset.id; S.sel = null; $('#live').innerHTML = liveHtml(me.role); },
  pick: el => {
    S.sel = +el.dataset.n; $('#live').innerHTML = liveHtml(me.role);
    const b = document.querySelector(`#live .seat[data-n="${S.sel}"]`); if (b) b.focus();
  },
  manual: el => doMark({ roll: el.dataset.roll }),
  alloc: async () => {
    if (S.seating && S.seating.rooms.length && !await ask('Allocate seats again?', 'This replaces the current seat plan and issues new QR codes. Students must reload their ticket.', 'Allocate again')) return;
    const r = await api('/exams/' + S.exam + '/allocate', { method: 'POST' });
    toast(`Seated ${r.seated} students across ${r.rooms} ${r.rooms === 1 ? 'room' : 'rooms'}.`);
    S.room = null; S.sel = null; render(true);
  },
  del: async el => {
    if (!await ask(`Delete ${el.dataset.name}?`, 'This also removes any seats and attendance linked to it. It cannot be undone.', 'Delete')) return;
    await api('/' + el.dataset.kind + '/' + el.dataset.id, { method: 'DELETE' });
    toast(`Deleted ${el.dataset.name}.`); render(true);
  },
  report: async el => {
    const t = await api('/exams/' + el.dataset.id + '/report');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([t], { type: 'text/csv' })); a.download = el.dataset.code + '-attendance.csv';
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  },
  cam: async () => {
    const d = $('#dlg'); let stream, on = true;
    d.returnValue = '';
    d.innerHTML = '<form method="dialog"><h3>Scan QR code</h3><video id="vid" playsinline muted style="width:100%;border-radius:6px"></video><div class="row end"><button>Close</button></div></form>';
    d.onclose = () => { on = false; if (stream) stream.getTracks().forEach(t => t.stop()); };
    d.showModal();
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); }
    catch { d.close(); return toast('Camera access was blocked. Allow it in your browser, or type the code instead.', true); }
    const v = $('#vid'); v.srcObject = stream; await v.play();
    const det = new BarcodeDetector({ formats: ['qr_code'] });
    while (on) {
      try { const c = await det.detect(v); if (c.length) { d.close(); await doMark({ code: c[0].rawValue }); break; } } catch {}
      await new Promise(r => setTimeout(r, 300));
    }
  }
};
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el || !A[el.dataset.act]) return;
  try { await A[el.dataset.act](el); } catch (err) { toast(err.message, true); }
});

/* ---------- forms ---------- */
const data = f => Object.fromEntries(new FormData(f));
const F = {
  login: async f => {
    const d = data(f);
    try {
      const r = await api('/auth/login', { method: 'POST', body: { role: S.role, identifier: d.u, password: d.p } });
      token = r.token; me = r.user; S.tab = null;
      sessionStorage.setItem('es_token', token); sessionStorage.setItem('es_me', JSON.stringify(me));
      render();
    } catch (err) { $('#lerr').textContent = err.message; }
  },
  exam: async f => { await api('/exams', { method: 'POST', body: data(f) }); toast('Exam added.'); render(true); },
  room: async f => { await api('/rooms', { method: 'POST', body: data(f) }); toast('Room added.'); render(true); },
  student: async f => { await api('/students', { method: 'POST', body: data(f) }); toast('Student added and enrolled in every exam.'); render(true); },
  import: async f => {
    const r = await api('/students/import', { method: 'POST', body: data(f) });
    toast(`Imported ${r.added} students.` + (r.skipped.length ? ` Skipped ${r.skipped.length}. ${r.skipped[0]}` : ''), r.added === 0);
    render(true);
  },
  mark: async f => {
    const code = f.elements.code.value.trim(); f.elements.code.value = '';
    await doMark({ code }); f.elements.code.focus();
  }
};
document.addEventListener('submit', async e => {
  const f = e.target.closest('form[data-form]'); if (!f) return;
  e.preventDefault();
  const b = f.querySelector('button.pri'); if (b) b.disabled = true;
  try { await F[f.dataset.form](f); } catch (err) { toast(err.message, true); }
  finally { if (b) b.disabled = false; }
});
document.addEventListener('change', e => {
  if (e.target.dataset.sel === 'exam') { S.exam = +e.target.value; S.room = null; S.sel = null; S.result = null; render(true); }
});
document.addEventListener('input', e => {
  if (e.target.id !== 'q' && e.target.id !== 'dp') return;
  const q = $('#q').value.toLowerCase(), dp = $('#dp').value; let n = 0;
  document.querySelectorAll('#stbl tr[data-s]').forEach(r => {
    const show = r.dataset.s.includes(q) && (!dp || r.dataset.d === dp); r.hidden = !show; if (show) n++;
  });
  $('#cnt').textContent = n + ' shown';
});

render();
