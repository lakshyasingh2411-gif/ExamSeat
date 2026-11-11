// One small data layer, two drivers: SQLite (local, zero setup) and Azure SQL (mssql).
// Queries use "?" placeholders and plain SQL that runs on both.
const fs = require('fs'), path = require('path'), cfg = require('./config');
const db = { driver: cfg.dbDriver };

if (db.driver === 'mssql') {
  const sql = require('mssql');
  let pool;
  const mk = target => {
    const exec = (s, p = []) => {
      const r = new sql.Request(target); let i = 0;
      p.forEach((v, j) => r.input('p' + j, v));
      return r.query(s.replace(/\?/g, () => '@p' + i++));
    };
    return {
      all: async (s, p) => (await exec(s, p)).recordset,
      get: async (s, p) => ((await exec(s, p)).recordset || [])[0] || null,
      run: async (s, p) => (await exec(s, p)).rowsAffected[0] || 0,
      insert: async (s, p) => Number((await exec(s + ';SELECT SCOPE_IDENTITY() AS id', p)).recordset[0].id)
    };
  };
  db.connect = async () => {
    pool = await new sql.ConnectionPool(cfg.mssql).connect();
    Object.assign(db, mk(pool));
    db.tx = async fn => {
      const t = new sql.Transaction(pool);
      await t.begin();
      try { const r = await fn(mk(t)); await t.commit(); return r; }
      catch (e) { try { await t.rollback(); } catch {} throw e; }
    };
  };
} else {
  const { DatabaseSync } = require('node:sqlite');
  let d;
  const mk = () => ({
    all: async (s, p = []) => d.prepare(s).all(...p),
    get: async (s, p = []) => d.prepare(s).get(...p) || null,
    run: async (s, p = []) => Number(d.prepare(s).run(...p).changes),
    insert: async (s, p = []) => Number(d.prepare(s).run(...p).lastInsertRowid)
  });
  db.connect = async () => {
    d = new DatabaseSync(cfg.sqliteFile);
    d.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    Object.assign(db, mk());
    db.tx = async fn => {
      d.exec('BEGIN');
      try { const r = await fn(mk()); d.exec('COMMIT'); return r; }
      catch (e) { d.exec('ROLLBACK'); throw e; }
    };
  };
}

db.init = async () => {
  await db.connect();
  const file = path.join(__dirname, 'db', db.driver === 'mssql' ? 'schema.mssql.sql' : 'schema.sqlite.sql');
  for (const st of fs.readFileSync(file, 'utf8').split(';').map(s => s.trim()).filter(Boolean)) await db.run(st);
  if (!(await db.get('SELECT COUNT(*) AS n FROM users')).n) await require('./seed')(db);
};
module.exports = db;
