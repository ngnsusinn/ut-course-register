const db = require('./db');
const fetch = require('node-fetch');

const callApi = async (endpoint, method, token, body) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
        const response = await fetch(`https://portal.ut.edu.vn/api/v1${endpoint}`, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined
        });
        const data = await response.json();
        return { success: response.ok, status: response.status, body: data };
    } catch (error) {
        console.error(`Error calling ${endpoint}:`, error);
        return { success: false, message: error.message };
    }
};

const checkVIPStatus = async (userId) => {
    const [rows] = await db.query('SELECT * FROM vip_users WHERE user_id = ? AND expiry_date > NOW()', [userId]);
    return rows.length > 0 ? { hasVIP: true, expiryDate: rows[0].expiry_date } : { hasVIP: false };
};

module.exports = async (req, res) => {
    const { action, payload } = req.body;
    const token = req.headers.authorization?.split('Bearer ')[1];
    let result = { success: false };

    try {
        switch (action) {
            case 'login': {
                const { username, password } = payload;
                if (!username || !password) {
                    return res.status(400).json({ success: false, message: 'Missing username or password' });
                }
                const loginRes = await callApi('/user/login', 'POST', null, { username, password });
                if (!loginRes.success || !loginRes.body) {
                    return res.status(loginRes.status || 500).json({ success: false, message: loginRes.message || 'Login failed' });
                }
                // Ensure token is returned in a consistent format
                const loginToken = loginRes.body.token || loginRes.body.accessToken || loginRes.body;
                if (!loginToken || typeof loginToken !== 'string') {
                    console.error('Invalid token in login response:', loginRes.body);
                    return res.status(500).json({ success: false, message: 'Invalid token received from login API' });
                }
                result = {
                    success: true,
                    body: {
                        token: loginToken,
                        maSinhVien: loginRes.body.maSinhVien || username,
                        username
                    }
                };
                break;
            }
            case 'getInitialData': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const profileRes = await callApi('/user/getSummaryProfile', 'GET', token);
                const dotsRes = await callApi(`/getDot`, 'GET', token);
                const latestDot = (dotsRes.success && dotsRes.body.length) 
                    ? dotsRes.body.reduce((max, d) => d.id > max.id ? d : max)
                    : null;
                const userId = profileRes.body?.maSinhVien || profileRes.body?.username;
                const vipStatus = await checkVIPStatus(userId);
                result = {
                    success: profileRes.success && !!latestDot,
                    profile: profileRes.body,
                    dot: latestDot,
                    vip: vipStatus
                };
                break;
            }
            case 'getFullSchedule': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { dotId, fetchPrerequisites, userId } = payload;
                const vipStatus = await checkVIPStatus(userId);
                const sources = ['dkhp'];
                if (fetchPrerequisites && vipStatus.hasVIP) sources.push('dkhpdk');
                const schedule = [];
                const subjectTypes = {};
                for (const source of sources) {
                    const res = await callApi(`/class?dotId=${dotId}&source=${source}`, 'GET', token);
                    if (res.success) {
                        schedule.push(...res.body.map(cls => ({ ...cls, source })));
                        const subjectRes = await callApi(`/subject?dotId=${dotId}&source=${source}`, 'GET', token);
                        if (subjectRes.success) {
                            subjectRes.body.forEach(s => {
                                subjectTypes[s.maHocPhan] = s.isBatBuoc;
                            });
                        }
                    }
                }
                for (const cls of schedule) {
                    const detailsRes = await callApi(`/class/${cls.id}/schedule?dotId=${dotId}&source=${cls.source}`, 'GET', token);
                    cls.scheduleDetails = detailsRes.success ? detailsRes.body : [];
                }
                result = { success: true, schedule, subjectTypes };
                break;
            }
            case 'getRegisteredClasses': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { dotId, fetchPrerequisites, userId } = payload;
                const vipStatus = await checkVIPStatus(userId);
                const sources = ['dkhp'];
                if (fetchPrerequisites && vipStatus.hasVIP) sources.push('dkhpdk');
                const registrations = [];
                for (const source of sources) {
                    const res = await callApi(`/registration?dotId=${dotId}&source=${source}`, 'GET', token);
                    if (res.success) {
                        registrations.push(...res.body.map(reg => ({ ...reg, source })));
                    }
                }
                for (const reg of registrations) {
                    const detailsRes = await callApi(`/class/${reg.lopHocPhanId}/schedule?dotId=${dotId}&source=${reg.source}`, 'GET', token);
                    reg.scheduleDetails = detailsRes.success ? detailsRes.body : [];
                }
                result = { success: true, body: registrations };
                break;
            }
            case 'register': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { classId, source } = payload;
                const res = await callApi(`/registration?source=${source}`, 'POST', token, { lopHocPhanId: classId });
                result = res;
                break;
            }
            case 'cancel': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { registrationId, source } = payload;
                const res = await callApi(`/registration/${registrationId}?source=${source}`, 'DELETE', token);
                result = res;
                break;
            }
            case 'checkClassStatus': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { dotId, maHocPhan, source } = payload;
                const res = await callApi(`/class?dotId=${dotId}&maHocPhan=${maHocPhan}&source=${source}`, 'GET', token);
                result = res;
                break;
            }
            case 'getVIPPlans': {
                result = {
                    success: true,
                    plans: {
                        basic: { name: 'Gói Cơ Bản', price: 50000, duration: 30 },
                        premium: { name: 'Gói Cao Cấp', price: 100000, duration: 90 },
                        ultimate: { name: 'Gói Tối Ưu', price: 180000, duration: 180 }
                    },
                    sepayConfig: {
                        bankName: process.env.SEPAY_BANK_NAME,
                        accountNumber: process.env.SEPAY_ACCOUNT_NUMBER,
                        accountName: process.env.SEPAY_ACCOUNT_NAME
                    }
                };
                break;
            }
            case 'createVIPOrder': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { userId, plan } = payload;
                const plans = {
                    basic: { price: 50000, duration: 30 },
                    premium: { price: 100000, duration: 90 },
                    ultimate: { price: 180000, duration: 180 }
                };
                const selectedPlan = plans[plan];
                if (!selectedPlan) return res.status(400).json({ success: false, message: 'Invalid plan' });
                const [result] = await db.query(
                    'INSERT INTO vip_orders (user_id, plan, amount, status) VALUES (?, ?, ?, ?)',
                    [userId, plan, selectedPlan.price, 'Pending']
                );
                result = { success: true, order: { id: result.insertId, amount: selectedPlan.price } };
                break;
            }
            case 'checkOrderStatus': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { orderId } = payload;
                const [rows] = await db.query('SELECT * FROM vip_orders WHERE id = ?', [orderId]);
                if (rows.length === 0) return res.status(404).json({ success: false, message: 'Order not found' });
                result = { success: true, order: rows[0] };
                break;
            }
            case 'checkVIPStatus': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { userId } = payload;
                const vipStatus = await checkVIPStatus(userId);
                result = { success: true, vip: vipStatus };
                break;
            }
            default:
                return res.status(400).json({ success: false, message: 'Invalid action' });
        }
        res.json(result);
    } catch (error) {
        console.error(`Error handling ${action}:`, error);
        res.status(500).json({ success: false, message: error.message });
    }
};