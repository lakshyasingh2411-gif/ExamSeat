// Password hashing (scrypt) and JWT (HS256) using only Node's crypto module.
const crypto = require('crypto');
const b64 = v => Buffer.from(v).toString('base64url');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return salt.toString('hex') + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function verifyPassword(pw, stored) {
  const [s, h] = String(stored).split(':');
  if (!s || !h) return false;
  const want = Buffer.from(h, 'hex'), got = crypto.scryptSync(pw, Buffer.from(s, 'hex'), want.length);
  return crypto.timingSafeEqual(want, got);
}
function sign(payload, secret, ttl = 8 * 3600) {
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttl }));
  const sig = crypto.createHmac('sha256', secret).update(head + '.' + body).digest('base64url');
  return head + '.' + body + '.' + sig;
}
function verify(token, secret) {
  const p = String(token).split('.');
  if (p.length !== 3) return null;
  const want = crypto.createHmac('sha256', secret).update(p[0] + '.' + p[1]).digest();
  const got = Buffer.from(p[2], 'base64url');
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  try {
    const b = JSON.parse(Buffer.from(p[1], 'base64url').toString());
    return b.exp > Date.now() / 1000 ? b : null;
  } catch { return null; }
}
module.exports = { hashPassword, verifyPassword, sign, verify };
