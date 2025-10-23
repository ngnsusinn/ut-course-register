require('dotenv').config();
const fetch = require('node-fetch');
const mysql = require('mysql2/promise');

// Database connection pool
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Utility: Call internal API
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
            return { success: false, message: `API Error: Status ${response.status}`, status: response.status };
        }
        return await response.json();
    } catch (error) {
        return { success: false, message: error.message };
    }
}

// Utility: Get schedule details
async function getScheduleDetails(classId, token, source) {
    const result = await callApi(`/getLopHocPhanDetail?idLopHocPhan=${classId}`, 'GET', token, null, source);
    return (result && result.success) ? result.body : { error: true, message: result.message };
}

// Main handler
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

    const { action, payload } = req.body;
    const token = req.headers.authorization ? req.headers.authorization.split(' ')[1] : null;

    try {
        let result;
        let connection;

        switch (action) {
            // Login action with role management
            case 'login': {
                const { username, password } = payload;
                result = await callApi('/user/login', 'POST', null, { username, password });

                if (result && result.token) {
                    connection = await pool.getConnection();
                    try {
                        // Check if user exists
                        const [rows] = await connection.query('SELECT * FROM users WHERE username = ?', [username]);
                        if (rows.length === 0) {
                            // Insert new user with role 'none'
                            await connection.query('INSERT INTO users (username, role) VALUES (?, ?)', [username, 'none']);
                            result.role = 'none';
                        } else {
                            result.role = rows[0].role;
                        }
                    } finally {
                        connection.release();
                    }
                }
                break;
            }

            case 'getInitialData': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const profileRes = await callApi('/user/getSummaryProfile', 'GET', token);
                const dotsRes = await callApi(`/getDot`, 'GET', token);
                const latestDot = (dotsRes.success && dotsRes.body.length)
                    ? dotsRes.body.reduce((max, d) => d.id > max.id ? d : max)
                    : null;

                // Get user role
                connection = await pool.getConnection();
                try {
                    const [rows] = await connection.query('SELECT role FROM users WHERE username = ?', [profileRes.body.username]);
                    result = {
                        success: profileRes.success && !!latestDot,
                        profile: profileRes.body,
                        dot: latestDot,
                        role: rows.length > 0 ? rows[0].role : 'none'
                    };
                } finally {
                    connection.release();
                }
                break;
            }

            // Create payment order
            case 'createPayment': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { amount, username } = payload;
                if (!amount || !isNumeric(amount) || amount <= 0) {
                    return res.status(400).json({ success: false, message: 'Invalid amount' });
                }

                connection = await pool.getConnection();
                try {
                    const name = "VIP Subscription";
                    const [result] = await connection.query(
                        'INSERT INTO tb_orders (total, name, username) VALUES (?, ?, ?)',
                        [amount, name, username]
                    );
                    const orderId = result.insertId;
                    res.status(200).json({ success: true, orderId });
                } catch (error) {
                    res.status(500).json({ success: false, message: `Database error: ${error.message}` });
                } finally {
                    connection.release();
                }
                break;
            }

            // Check payment status
            case 'checkPaymentStatus': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { orderId } = payload;
                if (!orderId || !isNumeric(orderId)) {
                    return res.status(400).json({ success: false, message: 'Invalid order ID' });
                }

                connection = await pool.getConnection();
                try {
                    const [rows] = await connection.query('SELECT payment_status FROM tb_orders WHERE id = ?', [orderId]);
                    if (rows.length > 0) {
                        res.status(200).json({ success: true, payment_status: rows[0].payment_status });
                    } else {
                        res.status(404).json({ success: false, payment_status: 'order_not_found' });
                    }
                } finally {
                    connection.release();
                }
                break;
            }

            // Get order details for payment page
            case 'getOrderDetails': {
                const { orderId } = payload;
                if (!orderId || !isNumeric(orderId)) {
                    return res.status(400).json({ success: false, message: 'Invalid order ID' });
                }

                connection = await pool.getConnection();
                try {
                    const [rows] = await connection.query('SELECT id, total, name, payment_status FROM tb_orders WHERE id = ?', [orderId]);
                    if (rows.length > 0) {
                        res.status(200).json({ success: true, order: rows[0] });
                    } else {
                        res.status(404).json({ success: false, message: 'Order not found' });
                    }
                } finally {
                    connection.release();
                }
                break;
            }

            case 'getFullSchedule': {
                connection = await pool.getConnection();
                try {
                    const [rows] = await connection.query('SELECT role FROM users WHERE username = ?', [payload.username]);
                    if (rows.length === 0 || rows[0].role !== 'vip') {
                        return res.status(403).json({ success: false, message: 'VIP role required' });
                    }
                } finally {
                    connection.release();
                }
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { dotId, fetchPrerequisites } = payload;
                const sources = fetchPrerequisites ? ['dkhp', 'dkhpdk'] : ['dkhp'];
                let allClassData = [];
                let subjectTypeMap = {};

                for (const source of sources) {
                    const subjectsRes = await callApi(`/getHocPhanHocMoi?idDot=${dotId}`, 'GET', token, null, source);
                    if (!subjectsRes.success || !Array.isArray(subjectsRes.body)) continue;

                    if (source === 'dkhp') {
                        subjectsRes.body.forEach(s => subjectTypeMap[s.maHocPhan] = s.isBatBuoc);
                    }

                    await Promise.all(subjectsRes.body.map(async (subject) => {
                        const classEndpoint = source === 'dkhpdk'
                            ? `/getLopHocPhan?idDot=${dotId}&maHocPhan=${subject.maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`
                            : `/getLopHocPhanChoDangKy?idDot=${dotId}&maHocPhan=${subject.maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`;
                        const classRes = await callApi(classEndpoint, 'GET', token, null, source);

                        if (classRes.success && Array.isArray(classRes.body)) {
                            await Promise.all(classRes.body.map(async (cls) => {
                                const scheduleDetails = await getScheduleDetails(cls.id, token, source);
                                allClassData.push({ ...subject, ...cls, source, scheduleDetails });
                            }));
                        }
                    }));
                }
                result = { success: true, schedule: allClassData, subjectTypes: subjectTypeMap };
                break;
            }

            case 'getRegisteredClasses': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { dotId, fetchPrerequisites } = payload;
                const sources = fetchPrerequisites ? ['dkhp', 'dkhpdk'] : ['dkhp'];
                let registeredData = [];

                for (const source of sources) {
                    const regRes = await callApi(`/getLHPDaDangKy?idDot=${dotId}`, 'GET', token, null, source);
                    if (regRes.success && Array.isArray(regRes.body)) {
                        await Promise.all(regRes.body.map(async (reg) => {
                            const detailRes = await callApi(`/getLichHoc?idDangKy=${reg.id}`, 'GET', token, null, 'dkhp');
                            const scheduleDetails = (detailRes && detailRes.success) ? detailRes.body : { error: true, message: detailRes.message };
                            registeredData.push({ ...reg, source, scheduleDetails });
                        }));
                    }
                }
                result = { success: true, body: registeredData };
                break;
            }

            case 'checkClassStatus': {
                connection = await pool.getConnection();
                try {
                    const [rows] = await connection.query('SELECT role FROM users WHERE username = ?', [payload.username]);
                    if (rows.length === 0 || rows[0].role !== 'vip') {
                        return res.status(403).json({ success: false, message: 'VIP role required' });
                    }
                } finally {
                    connection.release();
                }
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { dotId, maHocPhan, source } = payload;
                const classEndpoint = source === 'dkhpdk'
                    ? `/getLopHocPhan?idDot=${dotId}&maHocPhan=${maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`
                    : `/getLopHocPhanChoDangKy?idDot=${dotId}&maHocPhan=${maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`;
                result = await callApi(classEndpoint, 'GET', token, null, source);
                break;
            }

            case 'register': {
                connection = await pool.getConnection();
                try {
                    const [rows] = await connection.query('SELECT role FROM users WHERE username = ?', [payload.username]);
                    if (rows.length === 0 || rows[0].role !== 'vip') {
                        return res.status(403).json({ success: false, message: 'VIP role required' });
                    }
                } finally {
                    connection.release();
                }
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { classId, source } = payload;
                result = await callApi(`/dangKyLopHocPhan?idLopHocPhan=${classId}`, 'POST', token, null, source);
                break;
            }

            case 'cancel': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { registrationId, source } = payload;
                result = await callApi(`/huyDangKy?idDangKy=${registrationId}`, 'DELETE', token, null, source);
                break;
            }

            // SePay webhook handler
            case 'sepayWebhook': {
                const data = req.body;
                if (!data || !data.content) {
                    return res.status(400).json({ success: false, message: 'No data' });
                }

                const { gateway, transactionDate, accountNumber, subAccount, transferType, transferAmount, accumulated, code, content, referenceCode, description } = data;
                let amountIn = transferType === 'in' ? transferAmount : 0;
                let amountOut = transferType === 'out' ? transferAmount : 0;

                connection = await pool.getConnection();
                try {
                    // Insert transaction
                    await connection.query(
                        'INSERT INTO tb_transactions (gateway, transaction_date, account_number, sub_account, amount_in, amount_out, accumulated, code, transaction_content, reference_number, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [gateway, transactionDate, accountNumber, subAccount, amountIn, amountOut, accumulated, code, content, referenceCode, description]
                    );

                    // Extract order ID from content
                    const regex = /DH(\d+)/;
                    const matches = content.match(regex);
                    if (!matches || !matches[1]) {
                        return res.status(400).json({ success: false, message: `Order not found. Content: ${content}` });
                    }
                    const payOrderId = matches[1];

                    // Find order and update user role
                    const [orders] = await connection.query(
                        'SELECT username FROM tb_orders WHERE id = ? AND total = ? AND payment_status = ?',
                        [payOrderId, amountIn, 'Unpaid']
                    );

                    if (orders.length === 0) {
                        return res.status(404).json({ success: false, message: `Order not found. Order_id: ${payOrderId}` });
                    }

                    await connection.query('UPDATE tb_orders SET payment_status = ? WHERE id = ?', ['Paid', payOrderId]);
                    await connection.query('UPDATE users SET role = ? WHERE username = ?', ['vip', orders[0].username]);
                    res.status(200).json({ success: true });
                } catch (error) {
                    res.status(500).json({ success: false, message: `Database error: ${error.message}` });
                } finally {
                    connection.release();
                }
                break;
            }

            default:
                return res.status(400).json({ success: false, message: 'Invalid action.' });
        }
        res.status(200).json(result);

    } catch (error) {
        res.status(500).json({ success: false, message: 'Handler Error: ' + error.message });
    }
};

// Utility to check if a value is numeric
function isNumeric(value) {
    return !isNaN(parseFloat(value)) && isFinite(value);
}