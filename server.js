const path = require('path'), crypto = require('crypto');
const express = require('express');
const cfg = require('./config'), db = require('./db'), auth = require('./auth'), { plan } = require('./allocate');

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const E = (s, m) => new HttpError(s, m);
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- validation helpers ----------
const str = (v, label, max) => {
  const s = String(v ?? '').trim();
  if (!s) throw E(400, `${label} is required.`);
  if (s.length > max) throw E(400, `${label} must be ${max} characters or fewer.`);
  return s;
};
const int = (v, label, min, max) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw E(400, `${label} must be a whole number from ${min} to ${max}.`);
  return n;
};
const ID = (v, label = 'ID') => int(v, label, 1, 2147483647);
const DATE = /^\d{4}-\d{2}-\d{2}$/, TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const letter = i => String.fromCharCode(65 + i);
const seatLabel = (n, cols) => letter(Math.floor((n - 1) / cols)) + ((n - 1) % cols + 1);
const newCode = () => 'ES-' + crypto.randomBytes(5).toString('hex').toUpperCase();
const audit = (actor, action, conn = db) =>
  conn.run('INSERT INTO audit_logs(at,actor,action) VALUES(?,?,?)', [new Date().toISOString(), String(actor).slice(0, 120), String(action).slice(0, 240)]);
const isUnique = e => /UNIQUE constraint|duplicate key/i.test(e.message || '') || [2601, 2627].includes(e.number);

// ---------- auth middleware ----------
const need = (...roles) => (req, res, next) => {
  const u = auth.verify((req.headers.authorization || '').replace(/^Bearer /, ''), cfg.secret);
  if (!u) return res.status(401).json({ error: 'Your session has ended. Please sign in again.' });
  if (roles.length && !roles.includes(u.role)) return res.status(403).json({ error: 'You do not have access to this.' });
  req.user = u; next();
};

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '300kb' }));
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
  next();
});

// ---------- login (with simple brute-force lock) ----------
const fails = new Map();
app.post('/api/auth/login', wrap(async (req, res) => {
  const { role, identifier, password } = req.body || {};
  if (!['admin', 'invigilator', 'student'].includes(role) || typeof identifier !== 'string' || typeof password !== 'string')
    throw E(400, 'Enter your sign-in details.');
  const key = req.ip + '|' + role + '|' + identifier.toLowerCase();
  const f = fails.get(key), locked = f && Date.now() < f.until;
  if (locked && f.n >= 5) throw E(429, 'Too many attempts. Try again in a minute.');
  const id = identifier.trim();
  const u = role === 'student'
    ? await db.get('SELECT id,name,password_hash FROM students WHERE roll=?', [id.toUpperCase()])
    : await db.get('SELECT id,name,password_hash FROM users WHERE email=? AND role=?', [id.toLowerCase(), role]);
  if (!u || !auth.verifyPassword(password, u.password_hash)) {
    fails.set(key, { n: (locked ? f.n : 0) + 1, until: Date.now() + 60000 });
    await audit(id.slice(0, 60), `Failed sign-in (${role})`);
    throw E(401, 'Wrong ID or password for this role.');
  }
  fails.delete(key);
  await audit(u.name, 'Signed in');
  res.json({ token: auth.sign({ sub: u.id, role, name: u.name }, cfg.secret), user: { id: u.id, role, name: u.name } });
}));
app.get('/api/me', need(), (req, res) => res.json({ id: req.user.sub, role: req.user.role, name: req.user.name }));

// ---------- exams ----------
const examRows = () => db.all(`SELECT e.id,e.code,e.title,e.exam_date,e.start_time,e.end_time,
  (SELECT COUNT(*) FROM enrollments n WHERE n.exam_id=e.id) AS enrolled,
  (SELECT COUNT(*) FROM allocations a WHERE a.exam_id=e.id) AS seated,
  (SELECT COUNT(*) FROM allocations a JOIN attendance t ON t.allocation_id=a.id WHERE a.exam_id=e.id) AS present
  FROM exams e ORDER BY e.exam_date,e.start_time,e.code`);

app.get('/api/stats', need('admin'), wrap(async (req, res) => {
  const c = t => db.get(`SELECT COUNT(*) AS n FROM ${t}`).then(r => r.n);
  const [students, rooms, seated, present, exams] = await Promise.all([c('students'), c('rooms'), c('allocations'), c('attendance'), examRows()]);
  res.json({ students, rooms, seated, present, exams });
}));
app.get('/api/exams', need('admin', 'invigilator'), wrap(async (req, res) => res.json(await examRows())));

app.post('/api/exams', need('admin'), wrap(async (req, res) => {
  const b = req.body || {};
  const code = str(b.code, 'Course code', 30).toUpperCase(), title = str(b.title, 'Title', 160);
  if (!DATE.test(b.exam_date || '')) throw E(400, 'Choose a valid exam date.');
  if (!TIME.test(b.start_time || '') || !TIME.test(b.end_time || '')) throw E(400, 'Choose valid start and end times.');
  if (b.end_time <= b.start_time) throw E(400, 'End time must be after start time.');
  if (await db.get('SELECT id FROM exams WHERE code=?', [code])) throw E(409, `An exam with code ${code} already exists.`);
  await db.tx(async t => {
    const id = await t.insert('INSERT INTO exams(code,title,exam_date,start_time,end_time) VALUES(?,?,?,?,?)', [code, title, b.exam_date, b.start_time, b.end_time]);
    await t.run('INSERT INTO enrollments(exam_id,student_id) SELECT ?, id FROM students', [id]);
    await audit(req.user.name, `Created exam ${code}`, t);
  });
  res.status(201).json({ ok: true });
}));

app.delete('/api/exams/:id', need('admin'), wrap(async (req, res) => {
  const id = ID(req.params.id), e = await db.get('SELECT code FROM exams WHERE id=?', [id]);
  if (!e) throw E(404, 'Exam not found.');
  await db.tx(async t => {
    await t.run('DELETE FROM attendance WHERE allocation_id IN (SELECT id FROM allocations WHERE exam_id=?)', [id]);
    await t.run('DELETE FROM allocations WHERE exam_id=?', [id]);
    await t.run('DELETE FROM enrollments WHERE exam_id=?', [id]);
    await t.run('DELETE FROM exams WHERE id=?', [id]);
    await audit(req.user.name, `Deleted exam ${e.code}`, t);
  });
  res.json({ ok: true });
}));

// ---------- rooms ----------
app.get('/api/rooms', need('admin', 'invigilator'), wrap(async (req, res) => {
  const rows = await db.all('SELECT id,name,row_count,col_count FROM rooms ORDER BY name');
  res.json(rows.map(r => ({ id: r.id, name: r.name, rows: r.row_count, cols: r.col_count, capacity: r.row_count * r.col_count })));
}));
app.post('/api/rooms', need('admin'), wrap(async (req, res) => {
  const b = req.body || {}, name = str(b.name, 'Room name', 80);
  const rows = int(b.rows, 'Rows', 1, 20), cols = int(b.cols, 'Seats per row', 1, 20);
  if (await db.get('SELECT id FROM rooms WHERE LOWER(name)=?', [name.toLowerCase()])) throw E(409, 'A room with that name already exists.');
  await db.insert('INSERT INTO rooms(name,row_count,col_count) VALUES(?,?,?)', [name, rows, cols]);
  await audit(req.user.name, `Added room ${name}`);
  res.status(201).json({ ok: true });
}));
app.delete('/api/rooms/:id', need('admin'), wrap(async (req, res) => {
  const id = ID(req.params.id), r = await db.get('SELECT name FROM rooms WHERE id=?', [id]);
  if (!r) throw E(404, 'Room not found.');
  if ((await db.get('SELECT COUNT(*) AS n FROM allocations WHERE room_id=?', [id])).n)
    throw E(409, 'Seats in this room are assigned to an exam. Delete that exam or allocate again first.');
  await db.run('DELETE FROM rooms WHERE id=?', [id]);
  await audit(req.user.name, `Deleted room ${r.name}`);
  res.json({ ok: true });
}));

// ---------- students ----------
app.get('/api/students', need('admin'), wrap(async (req, res) =>
  res.json(await db.all('SELECT id,roll,name,dept FROM students ORDER BY roll'))));

async function addStudent(conn, roll, name, dept, hash) {
  const id = await conn.insert('INSERT INTO students(roll,name,dept,password_hash) VALUES(?,?,?,?)', [roll, name, dept, hash]);
  await conn.run('INSERT INTO enrollments(exam_id,student_id) SELECT id, ? FROM exams', [id]);
}
app.post('/api/students', need('admin'), wrap(async (req, res) => {
  const b = req.body || {};
  const roll = str(b.roll, 'Roll number', 30).toUpperCase(), name = str(b.name, 'Name', 120), dept = str(b.dept, 'Department', 30).toUpperCase();
  const pw = String(b.password || '').trim() || cfg.studentPassword;
  if (pw.length < 6) throw E(400, 'Password must be at least 6 characters.');
  if (await db.get('SELECT id FROM students WHERE roll=?', [roll])) throw E(409, 'That roll number is already registered.');
  await db.tx(async t => { await addStudent(t, roll, name, dept, auth.hashPassword(pw)); await audit(req.user.name, `Added student ${roll}`, t); });
  res.status(201).json({ ok: true });
}));
app.post('/api/students/import', need('admin'), wrap(async (req, res) => {
  const lines = String((req.body || {}).csv || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) throw E(400, 'Paste at least one line: roll,name,department');
  if (lines.length > 1000) throw E(400, 'Import up to 1000 students at a time.');
  const have = new Set((await db.all('SELECT roll FROM students')).map(r => r.roll)), skipped = [], good = [];
  lines.forEach((l, i) => {
    const [roll, name, dept] = l.split(',').map(x => (x || '').trim());
    if (i === 0 && /^roll/i.test(roll)) return;
    if (!/^[A-Za-z0-9-]{2,30}$/.test(roll || '') || !name || name.length > 120 || !dept || dept.length > 30) return skipped.push(`Line ${i + 1}: expected roll,name,department`);
    const r = roll.toUpperCase();
    if (have.has(r)) return skipped.push(`Line ${i + 1}: ${r} is already registered`);
    have.add(r); good.push([r, name, dept.toUpperCase()]);
  });
  const hash = auth.hashPassword(cfg.studentPassword);
  await db.tx(async t => {
    for (const g of good) await addStudent(t, g[0], g[1], g[2], hash);
    await audit(req.user.name, `Imported ${good.length} students`, t);
  });
  res.json({ added: good.length, skipped });
}));
app.delete('/api/students/:id', need('admin'), wrap(async (req, res) => {
  const id = ID(req.params.id), s = await db.get('SELECT roll FROM students WHERE id=?', [id]);
  if (!s) throw E(404, 'Student not found.');
  await db.tx(async t => {
    await t.run('DELETE FROM attendance WHERE allocation_id IN (SELECT id FROM allocations WHERE student_id=?)', [id]);
    await t.run('DELETE FROM allocations WHERE student_id=?', [id]);
    await t.run('DELETE FROM enrollments WHERE student_id=?', [id]);
    await t.run('DELETE FROM students WHERE id=?', [id]);
    await audit(req.user.name, `Deleted student ${s.roll}`, t);
  });
  res.json({ ok: true });
}));

// ---------- seat allocation ----------
app.post('/api/exams/:id/allocate', need('admin'), wrap(async (req, res) => {
  const id = ID(req.params.id), e = await db.get('SELECT * FROM exams WHERE id=?', [id]);
  if (!e) throw E(404, 'Exam not found.');
  if ((await db.get('SELECT COUNT(*) AS n FROM attendance t JOIN allocations a ON a.id=t.allocation_id WHERE a.exam_id=?', [id])).n)
    throw E(409, 'Attendance has already been marked for this exam, so its seats are locked.');
  const students = await db.all('SELECT s.id,s.roll,s.dept FROM students s JOIN enrollments n ON n.student_id=s.id WHERE n.exam_id=?', [id]);
  if (!students.length) throw E(400, 'No students are enrolled in this exam.');
  const busy = new Set((await db.all(
    'SELECT DISTINCT a.room_id FROM allocations a JOIN exams o ON o.id=a.exam_id WHERE o.id<>? AND o.exam_date=? AND o.start_time<? AND ?<o.end_time',
    [id, e.exam_date, e.end_time, e.start_time])).map(r => r.room_id));
  const rooms = (await db.all('SELECT id,name,row_count,col_count FROM rooms ORDER BY name')).filter(r => !busy.has(r.id));
  const cap = rooms.reduce((n, r) => n + r.row_count * r.col_count, 0);
  if (cap < students.length) throw E(400, `Not enough seats: ${students.length} students but only ${cap} free seats. Add a room first.`);
  const out = plan(students, rooms);
  await db.tx(async t => {
    await t.run('DELETE FROM allocations WHERE exam_id=?', [id]);
    for (const p of out) await t.run('INSERT INTO allocations(exam_id,student_id,room_id,seat_no,code) VALUES(?,?,?,?,?)', [id, p.student_id, p.room_id, p.seat_no, newCode()]);
    await audit(req.user.name, `Allocated ${out.length} students for ${e.code}`, t);
  });
  res.json({ seated: out.length, rooms: new Set(out.map(p => p.room_id)).size });
}));

app.get('/api/exams/:id/seating', need('admin', 'invigilator'), wrap(async (req, res) => {
  const id = ID(req.params.id), exam = await db.get('SELECT id,code,title FROM exams WHERE id=?', [id]);
  if (!exam) throw E(404, 'Exam not found.');
  const rows = await db.all(`SELECT a.room_id,a.seat_no,a.code,s.roll,s.name,s.dept,t.marked_at FROM allocations a
    JOIN students s ON s.id=a.student_id LEFT JOIN attendance t ON t.allocation_id=a.id WHERE a.exam_id=? ORDER BY a.room_id,a.seat_no`, [id]);
  const used = new Set(rows.map(r => r.room_id));
  const rooms = (await db.all('SELECT id,name,row_count,col_count FROM rooms ORDER BY name')).filter(r => used.has(r.id)).map(r => {
    const seats = rows.filter(x => x.room_id === r.id).map(x => ({
      seat: x.seat_no, roll: x.roll, name: x.name, dept: x.dept, present: !!x.marked_at, marked_at: x.marked_at,
      ...(req.user.role === 'admin' ? { code: x.code } : {})
    }));
    return { id: r.id, name: r.name, rows: r.row_count, cols: r.col_count, seated: seats.length, present: seats.filter(s => s.present).length, seats };
  });
  res.json({ exam, rooms });
}));

// ---------- attendance ----------
app.post('/api/attendance', need('admin', 'invigilator'), wrap(async (req, res) => {
  const b = req.body || {}, examId = b.examId ? ID(b.examId, 'Exam') : null, roomId = b.roomId ? ID(b.roomId, 'Room') : null;
  const key = str(b.roll || b.code, 'Code', 60).toUpperCase();
  const base = `SELECT a.id,a.exam_id,a.room_id,a.seat_no,s.name,s.roll,r.name AS room_name,r.col_count
    FROM allocations a JOIN students s ON s.id=a.student_id JOIN rooms r ON r.id=a.room_id`;
  let a = b.roll ? null : await db.get(base + ' WHERE a.code=?', [key]), manual = false;
  if (!a && examId) { a = await db.get(base + ' WHERE a.exam_id=? AND s.roll=?', [examId, key]); manual = !!a; }
  if (!a) throw E(404, 'No student matches that code or roll number in this exam.');
  if (examId && a.exam_id !== examId) throw E(409, `${a.name} sits a different exam.`);
  if (roomId && a.room_id !== roomId) throw E(409, `Wrong room. ${a.name} sits in ${a.room_name}, seat ${seatLabel(a.seat_no, a.col_count)}.`);
  if (await db.get('SELECT id FROM attendance WHERE allocation_id=?', [a.id])) throw E(409, `${a.name} is already marked present.`);
  try { await db.insert('INSERT INTO attendance(allocation_id,marked_by,marked_at) VALUES(?,?,?)', [a.id, req.user.name, new Date().toISOString()]); }
  catch (e) { if (isUnique(e)) throw E(409, `${a.name} is already marked present.`); throw e; }
  await audit(req.user.name, `Marked ${a.roll} present${manual ? ' (typed roll number)' : ''}`);
  res.json({ name: a.name, roll: a.roll, seat: seatLabel(a.seat_no, a.col_count), room: a.room_name });
}));

// ---------- student view ----------
app.get('/api/my/seats', need('student'), wrap(async (req, res) => res.json(await db.all(`
  SELECT e.id AS exam_id,e.code AS exam_code,e.title,e.exam_date,e.start_time,e.end_time,
         a.code,a.seat_no,r.name AS room_name,r.col_count,t.marked_at
  FROM enrollments n JOIN exams e ON e.id=n.exam_id
  LEFT JOIN allocations a ON a.exam_id=e.id AND a.student_id=n.student_id
  LEFT JOIN rooms r ON r.id=a.room_id LEFT JOIN attendance t ON t.allocation_id=a.id
  WHERE n.student_id=? ORDER BY e.exam_date,e.start_time`, [req.user.sub]))));

// ---------- reports and audit ----------
const csvCell = v => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
app.get('/api/exams/:id/report', need('admin'), wrap(async (req, res) => {
  const id = ID(req.params.id);
  const rows = await db.all(`SELECT s.roll,s.name,s.dept,r.name AS room_name,r.col_count,a.seat_no,t.marked_at
    FROM enrollments n JOIN students s ON s.id=n.student_id
    LEFT JOIN allocations a ON a.exam_id=n.exam_id AND a.student_id=s.id
    LEFT JOIN rooms r ON r.id=a.room_id LEFT JOIN attendance t ON t.allocation_id=a.id
    WHERE n.exam_id=? ORDER BY s.roll`, [id]);
  const out = [['Roll', 'Name', 'Department', 'Room', 'Seat', 'Status', 'Marked at']].concat(rows.map(r =>
    [r.roll, r.name, r.dept, r.room_name || '', r.seat_no ? seatLabel(r.seat_no, r.col_count) : '', r.marked_at ? 'Present' : r.seat_no ? 'Not marked' : 'No seat', r.marked_at || '']));
  res.type('text/csv').send(out.map(r => r.map(csvCell).join(',')).join('\r\n'));
}));
app.get('/api/audit', need('admin'), wrap(async (req, res) => res.json(await db.all(
  'SELECT id,at,actor,action FROM audit_logs WHERE id > (SELECT COALESCE(MAX(id),0)-100 FROM audit_logs) ORDER BY id DESC'))));

// ---------- static frontend + errors ----------
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, req, res, next) => {
  const msg = err.message || '';
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.type === 'entity.parse.failed' ? 'Invalid request.' : msg });
  if (isUnique(err)) return res.status(409).json({ error: 'That already exists.' });
  if (/FOREIGN KEY|REFERENCE constraint/i.test(msg)) return res.status(409).json({ error: 'This item is still in use.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

db.init().then(() => app.listen(cfg.port, () => {
  console.log(`ExamSeat running at http://localhost:${cfg.port}  (database: ${db.driver})`);
})).catch(e => { console.error('Could not start:', e.message); process.exit(1); });
