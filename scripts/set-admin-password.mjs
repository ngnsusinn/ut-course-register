// Đặt lại mật khẩu admin (username từ ADMIN_USER env, mặc định 'admin').
// Hash scrypt với đúng tham số api/admin-handler.js, tự kiểm tra ngược trước khi ghi.
// Usage: DB_PASSWORD=... NEW_PASSWORD=... node scripts/set-admin-password.mjs
import mysql from 'mysql2/promise';
import crypto from 'crypto';

const N = 16384, r = 8, p = 1, KEYLEN = 64;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const NEW_PW = process.env.NEW_PASSWORD;

function scryptHash(pw, salt) {
  const d = crypto.scryptSync(String(pw), salt, KEYLEN, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', N, r, p, salt.toString('base64'), d.toString('base64')].join('$');
}
function scryptVerify(stored, pw) {
  try {
    const parts = String(stored).split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, n, rr, pp, saltB64, hashB64] = parts;
    const d = crypto.scryptSync(String(pw), Buffer.from(saltB64, 'base64'), KEYLEN,
      { N: Number(n), r: Number(rr), p: Number(pp), maxmem: 64 * 1024 * 1024 });
    const a = Buffer.from(d), b = Buffer.from(hashB64, 'base64');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

if (!NEW_PW || NEW_PW.length < 8) {
  console.error('NEW_PASSWORD thiếu hoặc quá ngắn (<8 ký tự)');
  process.exit(2);
}

const c = await mysql.createConnection({
  host: process.env.DB_HOST || '103.97.126.29', port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'roacqgfa_reg', password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'roacqgfa_reg', connectTimeout: 10000,
});

const hash = scryptHash(NEW_PW, crypto.randomBytes(16));
if (!scryptVerify(hash, NEW_PW)) { console.error('BUG: self-test failed — không ghi DB'); process.exit(3); }

const [rows] = await c.query('SELECT id FROM admins WHERE username = ? AND is_active = 1', [ADMIN_USER]);
if (rows.length === 0) { console.error('Không tìm thấy admin:', ADMIN_USER); process.exit(4); }

const [res] = await c.query('UPDATE admins SET password_hash = ?, updated_at = NOW() WHERE id = ?', [hash, rows[0].id]);
const [check] = await c.query('SELECT password_hash FROM admins WHERE id = ?', [rows[0].id]);
const stored = check[0].password_hash;
console.log(`✅ Đã cập nhật ${res.affectedRows} dòng cho '${ADMIN_USER}' (id=${rows[0].id})`);
console.log(`   Stored: prefix=${String(stored).slice(0, 7)} len=${stored.length}`);
console.log(`   Verify ngược bằng mật khẩu bạn nhập: ${scryptVerify(stored, NEW_PW) ? 'OK ✅' : 'FAIL ❌'}`);
await c.end();
