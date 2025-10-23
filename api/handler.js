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

// Utility: Call internal UTH API
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

// Utility: Call SePay API to check payment status
async function checkSepayPaymentStatus(orderId) {
    try {
        const response = await fetch('https://api.sepay.vn/check-transaction', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.SEPAY_API_KEY}`
            },
            body: JSON.stringify({ orderId: `DH${orderId}` })
        });
        if (!response.ok) {
            return { success: false, message: `SePay API Error: Status ${response.status}` };
        }
        const data = await response.json();
        return {
            success: true,
            payment_status: data.status === 'success' ? 'Paid' : 'Unpaid',
            amount: data.amount,
            transactionId: data.transactionId
        };
    } catch (error) {
        return { success: false, message: `SePay API Error: ${error.message}` };
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
                        const [rows] = await connection.query('SELECT * FROM users WHERE username = ?', [username]);
                        if (rows.length === 0) {
                            await connection.query('INSERT INTO users (username, role) VALUES (?, ?)', [username, 'none']);
                            result.role = 'none';
                        } else {
                            result.role = rows[0].role;
                        }
                    } catch (dbError) {
                        console.error('DB Error in login:', dbError);
                        return res.status(500).json({ success: false, message: `Database error: ${dbError.message}` });
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
                let { amount, username } = payload;
                if (!amount || !isNumeric(amount) || amount <= 0) {
                    return res.status(400).json({ success: false, message: 'Invalid amount' });
                }

                // If username is not provided in payload, fetch it from profile
                if (!username) {
                    const profileRes = await callApi('/user/getSummaryProfile', 'GET', token);
                    if (!profileRes.success || !profileRes.body.username) {
                        return res.status(400).json({ success: false, message: 'Unable to fetch username from profile' });
                    }
                    username = profileRes.body.username;
                }

                connection = await pool.getConnection();
                try {
                    const name = "VIP Subscription";
                    const [result] = await connection.query(
                        'INSERT INTO tb_orders (total, name, username, payment_status) VALUES (?, ?, ?, ?)',
                        [amount, name, username, 'Unpaid']
                    );
                    const orderId = result.insertId;
                    res.status(200).json({ success: true, orderId });
                } catch (error) {
                    console.error('DB Error in createPayment:', error);
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

            // Check SePay payment status and update order
            case 'checkSepayPayment': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                let { orderId, username } = payload;
                if (!orderId || !isNumeric(orderId)) {
                    return res.status(400).json({ success: false, message: 'Invalid order ID' });
                }

                // If username is not provided, fetch it from profile
                if (!username) {
                    const profileRes = await callApi('/user/getSummaryProfile', 'GET', token);
                    if (!profileRes.success || !profileRes.body.username) {
                        return res.status(400).json({ success: false, message: 'Unable to fetch username from profile' });
                    }
                    username = profileRes.body.username;
                }

                connection = await pool.getConnection();
                try {
                    const [orders] = await connection.query('SELECT total, payment_status FROM tb_orders WHERE id = ? AND username = ?', [orderId, username]);
                    if (orders.length === 0) {
                        return res.status(404).json({ success: false, message: 'Order not found' });
                    }
                    if (orders[0].payment_status === 'Paid') {
                        return res.status(200).json({ success: true, payment_status: 'Paid' });
                    }

                    // Query SePay API
                    const sepayResult = await checkSepayPaymentStatus(orderId);
                    if (sepayResult.success && sepayResult.payment_status === 'Paid') {
                        if (sepayResult.amount === orders[0].total) {
                            await connection.query('UPDATE tb_orders SET payment_status = ? WHERE id = ?', ['Paid', orderId]);
                            await connection.query('UPDATE users SET role = ? WHERE username = ?', ['vip', username]);
                            res.status(200).json({ success: true, payment_status: 'Paid' });
                        } else {
                            res.status(400).json({ success: false, message: 'Payment amount mismatch' });
                        }
                    } else {
                        res.status(200).json({ success: true, payment_status: 'Unpaid' });
                    }
                } catch (error) {
                    console.error('DB Error in checkSepayPayment:', error);
                    res.status(500).json({ success: false, message: `Error: ${error.message}` });
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

            default:
                return res.status(400).json({ success: false, message: 'Invalid action.' });
        }
        res.status(200).json(result);

    } catch (error) {
        console.error('Handler Error:', error);
        res.status(500).json({ success: false, message: 'Handler Error: ' + error.message });
    }
};

// Utility to check if a value is numeric
function isNumeric(value) {
    return !isNaN(parseFloat(value)) && isFinite(value);
}