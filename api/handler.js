const fetch = require('node-fetch');
const db = require('./db'); // Import kết nối DB

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
        // Kiểm tra nếu response là JSON rỗng thì trả về object rỗng thay vì lỗi
        const text = await response.text();
        return text ? JSON.parse(text) : {};
    } catch (error) {
        return { success: false, message: error.message };
    }
}

async function getScheduleDetails(classId, token, source) {
    const result = await callApi(`/getLichHoc?idLopHocPhan=${classId}`, 'GET', token, null, source);
    if (result && result.body) {
        return result.body.map(item =>
            `Thứ ${item.thu} (Tiết ${item.tietBatDau}-${item.tietKetThuc}) tại ${item.tenPhong}`
        ).join(', ');
    }
    return 'Không có thông tin lịch học';
}

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        return res.status(200).end();
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    const { action, payload } = req.body;
    const token = req.headers.authorization ? req.headers.authorization.split(' ')[1] : null;

    try {
        let result;
        switch (action) {
            case 'login': {
                const { username, password } = payload;
                const tokenUrl = `https://portal.ut.edu.vn/api/v1/auth/token?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
                const response = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
                const tokenData = await response.json();

                if (tokenData && tokenData.token) {
                    const [rows] = await db.execute('SELECT * FROM users WHERE username = ?', [username]);
                    let user = rows[0];
                    if (!user) {
                        await db.execute('INSERT INTO users (username) VALUES (?)', [username]);
                        user = { vip_until: null }; // Set default for new user
                    }
                    const isVip = user && user.vip_until && new Date(user.vip_until) > new Date();
                    result = { ...tokenData, isVip };
                } else {
                    result = tokenData;
                }
                break;
            }

            case 'getInitialData': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const profileRes = await callApi('/user/getSummaryProfile', 'GET', token);
                const dotRes = await callApi('/getDotHienTai', 'GET', token);
                if (!profileRes.success || !dotRes.success) {
                    return res.status(500).json({ success: false, message: "Không thể lấy dữ liệu ban đầu." });
                }
                const [userRows] = await db.execute('SELECT vip_until FROM users WHERE username = ?', [profileRes.body.tenDangNhap]);
                const isVip = userRows[0] && userRows[0].vip_until && new Date(userRows[0].vip_until) > new Date();
                
                result = {
                    success: true,
                    profile: profileRes.body,
                    dot: dotRes.body,
                    isVip: isVip
                };
                break;
            }

            case 'createPayment': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { planDays } = payload;
                const prices = { 1: 5000, 3: 15000, 7: 35000 };
                const amount = prices[planDays];

                if (!amount) return res.status(400).json({ success: false, message: 'Gói không hợp lệ.' });

                const profileRes = await callApi('/user/getSummaryProfile', 'GET', token);
                if (!profileRes.success) return res.status(401).json({ success: false, message: 'Không lấy được thông tin user.' });
                
                const [userRows] = await db.execute('SELECT id FROM users WHERE username = ?', [profileRes.body.tenDangNhap]);
                if (userRows.length === 0) return res.status(404).json({ success: false, message: 'User không tồn tại.' });
                
                const userId = userRows[0].id;

                const [insertResult] = await db.execute(
                    'INSERT INTO transactions (user_id, plan_days, amount, status) VALUES (?, ?, ?, ?)',
                    [userId, planDays, amount, 'pending']
                );
                const transactionId = insertResult.insertId;

                // --- TẠO MÃ VIETQR ---
                // Thay thế `accountNo`, `accountName`, `acqId` bằng thông tin của bạn
                const qrCodeUrl = `https://api.vietqr.io/v2/generate?accountNo=0987654321&accountName=NGUYEN%20VAN%20A&acqId=970415&amount=${amount}&addInfo=UTHVIP${transactionId}&template=compact`;

                result = { success: true, qrCodeUrl: qrCodeUrl };
                break;
            }

            case 'getFullSchedule': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { idDot, isCay, source } = payload;
                let scheduleUrl = `/getDanhSachLopHocPhan?idDot=${idDot}`;
                if (isCay) {
                    scheduleUrl = `/getDsLhpTrongNganh?idDot=${idDot}&isFilter=true`;
                }
                const scheduleData = await callApi(scheduleUrl, 'GET', token, null, source);
                if (!scheduleData.success || !Array.isArray(scheduleData.body)) {
                    return res.status(500).json({ success: false, message: "Lỗi khi tải lịch học." });
                }
                const detailedSchedule = await Promise.all(scheduleData.body.map(async (cls) => {
                    cls.lichHocChiTiet = await getScheduleDetails(cls.id, token, source);
                    return cls;
                }));
                result = { success: true, data: detailedSchedule };
                break;
            }

            case 'getRegisteredClasses': {
                 if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                 const { idDot, source } = payload;
                 result = await callApi(`/getDanhSachLopHocPhanDaDangKy?idDot=${idDot}`, 'GET', token, null, source);
                 break;
            }
            
            case 'register': {
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