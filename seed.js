// Demo data created on first run only.
const cfg = require('./config'), { hashPassword } = require('./auth');
module.exports = async db => {
  await db.run('INSERT INTO users(role,email,name,password_hash) VALUES(?,?,?,?)', ['admin', 'admin@examseat.edu', 'Exam Admin', hashPassword(cfg.adminPassword)]);
  await db.run('INSERT INTO users(role,email,name,password_hash) VALUES(?,?,?,?)', ['invigilator', 'inv@examseat.edu', 'Hall Invigilator', hashPassword(cfg.invigilatorPassword)]);
  const first = ['Aarav','Diya','Kabir','Meera','Riya','Arjun','Isha','Vihaan','Anaya','Rohan','Sara','Dev'];
  const last = ['Sharma','Verma','Gupta','Singh','Rao','Khan'], depts = ['CSE','ECE','MECH'];
  const pw = hashPassword(cfg.studentPassword);
  await db.tx(async t => {
    for (let i = 0; i < 36; i++) {
      const dept = depts[i % 3];
      await t.run('INSERT INTO students(roll,name,dept,password_hash) VALUES(?,?,?,?)',
        [dept + String(Math.floor(i / 3) + 1).padStart(3, '0'), first[i % 12] + ' ' + last[(i * 5 + 1) % 6], dept, pw]);
    }
    await t.run('INSERT INTO rooms(name,row_count,col_count) VALUES(?,?,?)', ['Hall A-101', 4, 5]);
    await t.run('INSERT INTO rooms(name,row_count,col_count) VALUES(?,?,?)', ['Hall A-102', 4, 5]);
    const id = await t.insert('INSERT INTO exams(code,title,exam_date,start_time,end_time) VALUES(?,?,?,?,?)', ['DBMS201', 'Database Management Systems', '2026-11-12', '10:00', '13:00']);
    await t.run('INSERT INTO enrollments(exam_id,student_id) SELECT ?, id FROM students', [id]);
  });
};
