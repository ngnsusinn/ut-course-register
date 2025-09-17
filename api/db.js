// ut/api/db.js
const mysql = require('mysql2/promise');

// Thay thế các thông tin sau bằng thông tin cấu hình database của bạn
// Bạn nên sử dụng biến môi trường (environment variables) trên Vercel để bảo mật
const dbConfig = {
  host: process.env.DB_HOST 
  user: process.env.DB_USER 
  password: process.env.DB_PASSWORD 
  database: process.env.DB_NAME 
};

async function query(sql, params) {
  const connection = await mysql.createConnection(dbConfig);
  const [results, ] = await connection.execute(sql, params);
  await connection.end();
  return results;
}

module.exports = { query };