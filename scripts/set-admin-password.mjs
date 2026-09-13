// Đặt lại mật khẩu admin (username từ ADMIN_USER env, mặc định 'admin').
// Hash scrypt với đúng tham số api/admin-handler.js, tự kiểm tra ngược trước khi ghi.
// Usage: MONGODB_URI=... NEW_PASSWORD=... node scripts/set-admin-password.mjs
import { MongoClient } from 'mongodb';
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
const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI là bắt buộc');
  process.exit(2);
}
let dbName = process.env.MONGODB_DB;
if (!dbName) {
  const at = uri.lastIndexOf('@');
  const slash = at !== -1 ? uri.indexOf('/', at + 1) : -1;
  if (slash !== -1) {
    const q = uri.indexOf('?', slash);
    dbName = decodeURIComponent(uri.slice(slash + 1, q === -1 ? undefined : q));
  }
  dbName = dbName || 'uth_registration';
}

const client = await MongoClient.connect(uri, { serverSelectionTimeoutMS: 10000 });
try {
  const admins = client.db(dbName).collection('admins');

  const hash = scryptHash(NEW_PW, crypto.randomBytes(16));
  if (!scryptVerify(hash, NEW_PW)) { console.error('BUG: self-test failed — không ghi DB'); process.exit(3); }

  const admin = await admins.findOne({ username: ADMIN_USER, is_active: 1 }, { projection: { id: 1 } });
  if (!admin) { console.error('Không tìm thấy admin:', ADMIN_USER); process.exit(4); }

  const res = await admins.updateOne({ id: admin.id }, { $set: { password_hash: hash, updated_at: new Date() } });

  const check = await admins.findOne({ id: admin.id }, { projection: { password_hash: 1 } });
  const stored = check.password_hash;
  console.log(`✅ Đã cập nhật ${res.modifiedCount} tài liệu cho '${ADMIN_USER}' (id=${admin.id})`);
  console.log(`   Stored: prefix=${String(stored).slice(0, 7)} len=${stored.length}`);
  console.log(`   Verify ngược bằng mật khẩu bạn nhập: ${scryptVerify(stored, NEW_PW) ? 'OK ✅' : 'FAIL ❌'}`);
} finally {
  await client.close();
}
