const fetch = require('node-fetch');
const mysql = require('mysql2/promise');
const url = require('url');

// Đọc thông tin cấu hình từ biến môi trường của Vercel
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
};

const sepayConfig = {
    accountNumber: process.env.SEPAY_ACCOUNT_NUMBER,
    bank: process.env.SEPAY_BANK 
};

let dbPool;

async function getDbPool() {
    if (!dbPool) {
        dbPool = mysql.createPool(dbConfig);
        // Khởi tạo bảng nếu chưa có
        try {
            const connection = await dbPool.getConnection();
            await connection.query(`
                CREATE TABLE IF NOT EXISTS users (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(255) NOT NULL UNIQUE,
                    user_type ENUM('free', 'vip') NOT NULL DEFAULT 'free',
                    vip_expires_at DATETIME NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);
            connection.release();
        } catch (error) {
            console.error("Lỗi khi khởi tạo bảng 'users':", error);
        }
    }
    return dbPool;
}


// --- Tiện ích gọi API của trường ---
async function callApi(endpoint, method, token, body = null, source = 'dkhp') {
    let baseApiUrl;
    if (endpoint.startsWith('/user/')) {
        baseApiUrl = 'https://portal.ut.edu.vn/api/v1';
    } else if (source === 'dkhpdk') {
        baseApiUrl = 'https://portal.ut.edu.vn/api/v1/dkhpdk';
    } else {
        baseApiUrl = 'https://portal.ut.edu.vn/api/v1/dkhp';
    }
    const targetUrl = baseApiUrl + endpoint;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const options = { method, headers, body: body ? JSON.stringify(body) : null, timeout: 30000 };

    try {
        const response = await fetch(targetUrl, options);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API Error ${response.status}: ${errorText}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`Lỗi khi gọi ${targetUrl}:`, error);
        throw error;
    }
}

// --- Xử lý Webhook từ SePay ---
async function handleWebhook(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }
    try {
        const body = req.body;
        console.log("Received SePay Webhook:", body);

        const { status, amount, description, transactionId } = body;

        if (status === "SUCCESS") {
            const parts = description.split(' ');
            if (parts.length < 2 || parts[0].toUpperCase() !== 'VIP') {
                 console.log("Webhook description không hợp lệ, bỏ qua.");
                 return res.status(200).json({ message: 'OK, ignored' });
            }
            const username = parts[1];

            let daysToAdd = 0;
            if (amount === 10000) daysToAdd = 1;
            else if (amount === 20000) daysToAdd = 3;
            else if (amount === 50000) daysToAdd = 7;

            if (daysToAdd > 0) {
                const pool = await getDbPool();
                const [users] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
                
                if (users.length > 0) {
                    const user = users[0];
                    const now = new Date();
                    let newExpiryDate;

                    if (user.user_type === 'vip' && user.vip_expires_at && new Date(user.vip_expires_at) > now) {
                        newExpiryDate = new Date(user.vip_expires_at);
                    } else {
                        newExpiryDate = now;
                    }
                    newExpiryDate.setDate(newExpiryDate.getDate() + daysToAdd);

                    await pool.query(
                        'UPDATE users SET user_type = ?, vip_expires_at = ? WHERE username = ?',
                        ['vip', newExpiryDate, username]
                    );
                    console.log(`Cập nhật VIP thành công cho user ${username}. Hết hạn vào: ${newExpiryDate}`);
                } else {
                     console.log(`Webhook: Không tìm thấy user ${username}`);
                }
            } else {
                console.log(`Webhook: Số tiền ${amount} không khớp với gói VIP nào.`);
            }
        }
        res.status(200).json({ message: 'Webhook received' });
    } catch (error) {
        console.error('Lỗi xử lý webhook:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
}

// --- Handler chính ---
module.exports = async (req, res) => {
    // Định tuyến cho webhook
    const parsedUrl = url.parse(req.url, true);
    if (parsedUrl.pathname === '/api/webhook') {
        return handleWebhook(req, res);
    }
    
    // Xử lý các API call thông thường
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        const { action, payload } = req.body;
        let result;

        switch (action) {
            case 'login': {
                const { username, password } = payload;
                const loginPayload = {
                    tenDangNhap: username,
                    matKhau: Buffer.from(password).toString('base64'),
                    isNhoMatKhau: true
                };
                const loginResult = await callApi('/user/login', 'POST', null, loginPayload);
                const token = loginResult.data.token;
                const userInfo = await callApi('/user/info', 'GET', token);
                
                const pool = await getDbPool();
                let [users] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
                let user;

                if (users.length === 0) {
                    await pool.query('INSERT INTO users (username, user_type) VALUES (?, ?)', [username, 'free']);
                    user = { username, user_type: 'free', vip_expires_at: null };
                } else {
                    user = users[0];
                    if (user.user_type === 'vip' && user.vip_expires_at && new Date(user.vip_expires_at) < new Date()) {
                        await pool.query("UPDATE users SET user_type = 'free', vip_expires_at = NULL WHERE username = ?", [username]);
                        user.user_type = 'free';
                    }
                }
                
                result = {
                    token: token,
                    fullName: userInfo.data.hoTen,
                    is_vip: user.user_type === 'vip'
                };
                break;
            }

            case 'create-payment': {
                const { username, price } = payload;
                if (!username || !price) throw new Error("Thiếu thông tin");
                
                const description = `VIP ${username}`;

                result = {
                    accountNumber: sepayConfig.accountNumber,
                    bank: sepayConfig.bank,
                    amount: price,
                    description: encodeURIComponent(description)
                };
                break;
            }

            case 'getRegistered':
                result = await callApi('/getDanhSachLopHocPhanDaDangKy', 'GET', payload.token);
                result = result.data.dsLopHocPhanDaDangKy.map(item => ({ ...item, source: 'dkhp' }))
                         .concat(result.data.dsLopHocPhanDaDangKy_DKHPDotPhu.map(item => ({...item, source: 'dkhpdk'})));
                break;

            case 'getSchedule': {
                const { token, dotId, source } = payload;
                const subjects = await callApi(`/getMonHocTrongDot?idDot=${dotId}`, 'GET', token, null, source);
                let allSchedules = [];
                for (const subject of subjects.data) {
                    const classes = await callApi(`/getLopHocPhan?idDot=${dotId}&maHocPhan=${subject.maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`, 'GET', token, null, source);
                    allSchedules.push(...classes.data);
                }
                result = allSchedules;
                break;
            }
                
            case 'getClassDetails': {
                const { token, dotId, maHocPhan, source } = payload;
                const classEndpoint = source === 'dkhpdk'
                    ? `/getLopHocPhan?idDot=${dotId}&maHocPhan=${maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`
                    : `/getLopHocPhanChoDangKy?idDot=${dotId}&maHocPhan=${maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`;
                result = await callApi(classEndpoint, 'GET', token, null, source);
                break;
            }

            case 'register': {
                if (!payload.token) return res.status(401).json({ message: 'Unauthorized' });
                const registerPayload = { IdLopHocPhan: [payload.classId] };
                result = await callApi('/dangKy', 'POST', payload.token, registerPayload, payload.source);
                break;
            }

            case 'unregister': {
                 if (!payload.token) return res.status(401).json({ message: 'Unauthorized' });
                const unregisterPayload = { ID: payload.regId };
                result = await callApi('/huyDangKy', 'POST', payload.token, unregisterPayload, payload.source);
                break;
            }

            case 'insert': {
                if (!payload.token) return res.status(401).json({ message: 'Unauthorized' });
                const insertPayload = { IdLopHocPhan: payload.classId, IsChen: true };
                result = await callApi('/dangKy', 'POST', payload.token, insertPayload, payload.source);
                break;
            }
                
            default:
                throw new Error('Hành động không hợp lệ');
        }
        res.status(200).json(result);
    } catch (error) {
        console.error('Lỗi handler:', error);
        res.status(500).json({ message: error.message || 'Đã có lỗi xảy ra' });
    }
};