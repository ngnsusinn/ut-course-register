const mysql = require('mysql2/promise');

// Tạo một pool kết nối để tái sử dụng, giúp tăng hiệu năng
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // Thêm cấu hình SSL nếu database của bạn yêu cầu (ví dụ: PlanetScale)
  // ssl: {
  //   "rejectUnauthorized": true
  // }
});

module.exports = pool;