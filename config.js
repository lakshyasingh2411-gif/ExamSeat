const fs = require('fs'), path = require('path');
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach(l => {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (e) { /* no .env file, use defaults */ }
const e = process.env;
if (e.NODE_ENV === 'production' && !e.JWT_SECRET) throw new Error('Set JWT_SECRET before running in production.');
module.exports = {
  port: +e.PORT || 3000,
  secret: e.JWT_SECRET || 'dev-only-secret-change-me',
  dbDriver: (e.DB_DRIVER || 'sqlite').toLowerCase(),
  sqliteFile: path.resolve(__dirname, e.SQLITE_FILE || 'examseat.db'),
  mssql: {
    server: e.DB_SERVER, database: e.DB_NAME, user: e.DB_USER, password: e.DB_PASSWORD,
    options: { encrypt: true, trustServerCertificate: false }, pool: { max: 10 }
  },
  adminPassword: e.ADMIN_PASSWORD || 'admin123',
  invigilatorPassword: e.INVIGILATOR_PASSWORD || 'inv123',
  studentPassword: e.DEFAULT_STUDENT_PASSWORD || 'student123'
};
