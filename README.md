# ExamSeat: Smart Exam Seating & Attendance System

Three-tier web app: browser frontend, Node.js + Express API, SQL database.
Roles: **admin** (exams, rooms, students, seat allocation, reports, audit log),
**invigilator** (QR / roll-number attendance), **student** (seat + QR hall ticket).

## Run it

```bash
npm install
npm start          # http://localhost:3000
```

Needs Node.js 22.13 or newer for the built-in SQLite mode. The database file
(`examseat.db`) and demo data are created on first run.

| Role        | Sign in with                    |
|-------------|---------------------------------|
| Admin       | admin@examseat.edu / admin123   |
| Invigilator | inv@examseat.edu / inv123       |
| Student     | CSE001 / student123             |

Change these before any real use (see `.env.example`).

## Use Azure SQL Database

1. Create an Azure SQL Database and allow your IP in the server firewall.
2. Copy `.env.example` to `.env` and set `DB_DRIVER=mssql`, `DB_SERVER`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, and a long random `JWT_SECRET`.
3. `npm start`. Tables and demo data are created on first run. The same schema is in `db/schema.mssql.sql` if you prefer to run it yourself in the Azure Query editor.

## How it fits together

```
public/        index.html, app.css, app.js   (frontend, no build step)
server.js      Express routes, validation, JWT + role checks
db.js          one data layer, SQLite or Azure SQL (mssql)
db/            schema.sqlite.sql, schema.mssql.sql
allocate.js    seat planning (mixes departments, fills rooms in order)
auth.js        scrypt password hashing, HS256 JWT
seed.js        demo data (first run only)
```

Tables: `users`, `students`, `rooms`, `exams`, `enrollments`, `allocations`, `attendance`, `audit_logs`
(primary and foreign keys, UNIQUE and CHECK constraints; a seat or a student can never be double-booked).

## What changed from the prototype

- Real backend and database instead of browser localStorage; passwords are hashed, sessions use JWT, every route checks the role.
- QR codes are random per seat (not guessable from a roll number) and are re-issued when seats are re-allocated.
- Seats lock once attendance starts, so a re-allocation cannot wipe attendance.
- Invigilators can scan with the camera (Chrome/Edge/Android), paste a code, type a roll number, or tap a seat.
- New: CSV student import, CSV attendance report per exam, delete with confirmation, search and filter, print seat plan and hall ticket, live refresh every 10 seconds, five failed sign-ins locks that login for a minute.

## Notes

- The QR image uses the qrcodejs library from cdnjs, so students need internet to see the QR picture. The backup code is always shown.
- Camera scanning needs HTTPS or localhost.
- Allocation rule: rooms already booked for an exam at an overlapping time on the same date are skipped.
